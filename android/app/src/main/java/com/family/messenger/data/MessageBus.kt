package com.family.messenger.data

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow

/** Connects the background socket service with the screens. */
object MessageBus {
    /** Every message pushed by the server in real time. */
    val messages = MutableSharedFlow<Message>(extraBufferCapacity = 64)

    /** True while the real-time connection is open. Screens reload when it reconnects. */
    val connected = MutableStateFlow(false)

    /** Id of a story post that was added, changed or deleted. */
    val feedChanges = MutableSharedFlow<Long>(extraBufferCapacity = 64)

    /** Conversation currently on screen (or [FEED] for the story tab); no notification is shown for it. */
    val activeConversation = MutableStateFlow<String?>(null)

    const val FEED = "feed"
}
