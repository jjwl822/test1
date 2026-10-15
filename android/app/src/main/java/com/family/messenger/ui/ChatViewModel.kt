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
    )

    private val app = application as FamilyApp
    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        loadLatest()
        viewModelScope.launch {
            MessageBus.messages.filter { it.conversationId == conversationId }.collect(::merge)
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
            latest.forEach(::merge)
            _state.value = _state.value.copy(
                loading = false,
                hasOlder = if (first) latest.size >= PAGE else _state.value.hasOlder,
                error = null,
            )
        } catch (e: Exception) {
            _state.value = _state.value.copy(loading = false, error = e.message)
        }
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

    fun sendText(text: String) = send { app.api.sendText(conversationId, text) }

    fun sendImage(uri: Uri) = send {
        val jpeg = ImageCompressor.compress(app, uri)
        app.api.sendImage(conversationId, jpeg)
    }

    private fun send(block: suspend () -> Message) = viewModelScope.launch {
        _state.value = _state.value.copy(sending = true, error = null)
        try {
            merge(block())
        } catch (e: Exception) {
            _state.value = _state.value.copy(error = e.message ?: "전송에 실패했습니다.")
        } finally {
            _state.value = _state.value.copy(sending = false)
        }
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
