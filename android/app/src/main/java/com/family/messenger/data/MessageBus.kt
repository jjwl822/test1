package com.family.messenger.data

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow

/** Connects the background socket service with the screens. */
object MessageBus {
    /** Every message pushed by the server in real time. */
    val messages = MutableSharedFlow<Message>(extraBufferCapacity = 64)

    /** True while the real-time connection is open. Screens reload when it reconnects. */
    val connected = MutableStateFlow(false)

    /** A message that was edited in place: deleted, reacted to, or voted on. */
    val messageUpdates = MutableSharedFlow<Message>(extraBufferCapacity = 64)

    data class Read(val conversationId: String, val userId: Long, val lastReadId: Long)

    /** Someone read up to a message (read receipts). */
    val reads = MutableSharedFlow<Read>(extraBufferCapacity = 64)

    /** The family calendar or shared lists changed. */
    val eventsChanged = MutableSharedFlow<Unit>(extraBufferCapacity = 8)
    val listsChanged = MutableSharedFlow<Unit>(extraBufferCapacity = 8)

    /** Id of a story post that was added, changed or deleted. */
    val feedChanges = MutableSharedFlow<Long>(extraBufferCapacity = 64)

    /** Conversation currently on screen (or [FEED] for the story tab); no notification is shown for it. */
    val activeConversation = MutableStateFlow<String?>(null)

    const val FEED = "feed"
    const val CALENDAR = "calendar"
}
