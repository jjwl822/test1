package com.family.messenger.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.family.messenger.FamilyApp
import com.family.messenger.data.ImageCompressor
import com.family.messenger.data.Message
import com.family.messenger.data.MessageBus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch

class ChatViewModel(application: Application, private val conversationId: String) : AndroidViewModel(application) {

    data class State(
        val messages: List<Message> = emptyList(),
        val loading: Boolean = true,
        val hasOlder: Boolean = false,
        val sending: Boolean = false,
        val error: String? = null,
        /** How far each person in the room has read: userId -> last read message id. */
        val reads: Map<Long, Long> = emptyMap(),
        /** The message being replied to, shown above the input box. */
        val replyingTo: Message? = null,
        /** Text whose sending failed, to put back in the input box so it can be sent again. */
        val unsentText: String? = null,
    ) {
        /** How many people (other than the sender) haven't read [message] yet — the "1" in KakaoTalk. */
        fun unreadCount(message: Message): Int =
            reads.count { (userId, lastRead) -> userId != message.senderId && lastRead < message.id }
    }

    private val app = application as FamilyApp
    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()
    private val me get() = app.session.auth.value?.user?.id

    init {
        loadLatest()
        viewModelScope.launch {
            MessageBus.messages.filter { it.conversationId == conversationId }.collect {
                merge(it)
                markRead()
            }
        }
        viewModelScope.launch {
            MessageBus.messageUpdates.filter { it.conversationId == conversationId }.collect(::replace)
        }
        viewModelScope.launch {
            MessageBus.reads.filter { it.conversationId == conversationId }.collect { read ->
                updateRead(read.userId, read.lastReadId)
            }
        }
        // Catch up on anything missed while the connection was down.
        viewModelScope.launch {
            MessageBus.connected.drop(1).filter { it }.collect { loadLatest() }
        }
    }

    private fun loadLatest() = viewModelScope.launch {
        try {
            val latest = app.api.messages(conversationId)
            val first = _state.value.messages.isEmpty()
            latest.forEach { if (!replace(it)) merge(it) }
            val reads = app.api.reads(conversationId).associate { it.userId to it.lastReadId }
            _state.value = _state.value.copy(
                loading = false,
                hasOlder = if (first) latest.size >= PAGE else _state.value.hasOlder,
                reads = reads,
                error = null,
            )
            markRead()
        } catch (e: Exception) {
            _state.value = _state.value.copy(loading = false, error = e.message)
        }
    }

    /** Tells the server I've seen everything on screen, but only while this chat is actually open. */
    fun markRead() {
        val newest = _state.value.messages.lastOrNull()?.id ?: return
        val mine = me ?: return
        if (MessageBus.activeConversation.value != conversationId) return
        if ((_state.value.reads[mine] ?: 0) >= newest) return
        updateRead(mine, newest)
        viewModelScope.launch { runCatching { app.api.markRead(conversationId, newest) } }
    }

    private fun updateRead(userId: Long, lastReadId: Long) {
        val reads = _state.value.reads
        if ((reads[userId] ?: 0) >= lastReadId) return
        _state.value = _state.value.copy(reads = reads + (userId to lastReadId))
    }

    fun loadOlder() = viewModelScope.launch {
        val oldest = _state.value.messages.firstOrNull()?.id ?: return@launch
        try {
            val older = app.api.messages(conversationId, before = oldest)
            _state.value = _state.value.copy(
                messages = older + _state.value.messages,
                hasOlder = older.size >= PAGE,
            )
        } catch (e: Exception) {
            _state.value = _state.value.copy(error = e.message)
        }
    }

    fun replyTo(message: Message?) {
        _state.value = _state.value.copy(replyingTo = message)
    }

    fun sendText(text: String) {
        val replyingTo = _state.value.replyingTo
        send(
            onFail = {
                _state.value = _state.value.copy(
                    unsentText = text,
                    replyingTo = replyingTo,
                    error = "${_state.value.error} 쓴 내용은 입력창에 다시 넣어 두었어요.",
                )
            },
        ) { app.api.sendText(conversationId, text, replyingTo?.id) }
    }

    /** The screen took [State.unsentText] back into the input box. */
    fun unsentTextRestored() {
        _state.value = _state.value.copy(unsentText = null)
    }

    fun sendImage(uri: Uri) {
        val replyId = _state.value.replyingTo?.id
        send {
            val jpeg = ImageCompressor.compress(app, uri)
            app.api.sendImage(conversationId, jpeg, replyId)
        }
    }

    fun createPoll(question: String, options: List<String>, multiple: Boolean) =
        send { app.api.createPoll(conversationId, question, options, multiple) }

    fun vote(message: Message, optionIds: List<Long>) = update { app.api.vote(message.id, optionIds) }

    fun react(message: Message, emoji: String) = update { app.api.reactToMessage(message.id, emoji) }

    fun delete(message: Message) = update { app.api.deleteMessage(message.id) }

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }

    private fun send(onFail: () -> Unit = {}, block: suspend () -> Message) = viewModelScope.launch {
        _state.value = _state.value.copy(sending = true, error = null, replyingTo = null)
        try {
            val message = block()
            merge(message)
            me?.let { updateRead(it, message.id) }
        } catch (e: Exception) {
            _state.value = _state.value.copy(error = e.message ?: "전송에 실패했습니다.")
            onFail()
        } finally {
            _state.value = _state.value.copy(sending = false)
        }
    }

    private fun update(block: suspend () -> Message) = viewModelScope.launch {
        try {
            replace(block())
        } catch (e: Exception) {
            _state.value = _state.value.copy(error = e.message)
        }
    }

    /** Swaps in a newer copy of a message already on screen. Returns false if it isn't there. */
    private fun replace(message: Message): Boolean {
        val current = _state.value.messages
        if (current.none { it.id == message.id }) return false
        _state.value = _state.value.copy(messages = current.map { if (it.id == message.id) message else it })
        return true
    }

    /** Adds a message once, keeping the list ordered by id (the socket and the API may both deliver it). */
    private fun merge(message: Message) {
        val current = _state.value.messages
        if (current.any { it.id == message.id }) return
        val updated = if (current.isEmpty() || current.last().id < message.id) {
            current + message
        } else {
            (current + message).sortedBy { it.id }
        }
        _state.value = _state.value.copy(messages = updated)
    }

    private companion object {
        const val PAGE = 50
    }
}
