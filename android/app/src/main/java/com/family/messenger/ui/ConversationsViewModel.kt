package com.family.messenger.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.family.messenger.FamilyApp
import com.family.messenger.data.Conversation
import com.family.messenger.data.MessageBus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/** Chat rooms with their last message and unread count; also feeds the unread badge on the tab bar. */
class ConversationsViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application as FamilyApp
    private val _conversations = MutableStateFlow<List<Conversation>>(emptyList())
    val conversations: StateFlow<List<Conversation>> = _conversations.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    init {
        refresh()
        viewModelScope.launch {
            val me = { app.session.auth.value?.user?.id }
            merge(
                MessageBus.messages.map { },
                MessageBus.messageUpdates.map { },
                // Only my own reads change my unread counts.
                MessageBus.reads.filter { it.userId == me() }.map { },
                MessageBus.connected.filter { it }.map { },
            ).collect { refresh() }
        }
    }

    fun refresh() = viewModelScope.launch {
        try {
            _conversations.value = app.api.conversations()
            _error.value = null
        } catch (e: Exception) {
            _error.value = e.message
        }
    }
}
