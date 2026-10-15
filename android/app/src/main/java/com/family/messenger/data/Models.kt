package com.family.messenger.data

import kotlinx.serialization.Serializable

@Serializable
data class User(
    val id: Long,
    val username: String,
    val displayName: String,
)

@Serializable
data class AuthResponse(
    val token: String,
    val user: User,
)

@Serializable
data class Message(
    val id: Long,
    val conversationId: String,
    val senderId: Long,
    val senderName: String,
    val kind: String,
    val text: String? = null,
    val imageUrl: String? = null,
    val createdAt: Long,
) {
    val isImage: Boolean get() = kind == "image"
    val preview: String get() = if (isImage) "사진" else text.orEmpty()
}

@Serializable
data class Conversation(
    val id: String,
    val kind: String,
    val title: String,
    val lastMessage: Message? = null,
) {
    val isGroup: Boolean get() = kind == "group"
}

@Serializable
data class SocketEvent(
    val type: String,
    val message: Message? = null,
)
