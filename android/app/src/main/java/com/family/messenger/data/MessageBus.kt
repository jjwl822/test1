package com.family.messenger.data

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow

/** Connects the background socket service with the screens. */
object MessageBus {
    /** Every message pushed by the server in real time. */
    val messages = MutableSharedFlow<Message>(extraBufferCapacity = 64)

    /** True while the real-time connection is open. Screens reload when it reconnects. */
    val connected = MutableStateFlow(false)

    /** Conversation currently on screen; no notification is shown for it. */
    val activeConversation = MutableStateFlow<String?>(null)
}
