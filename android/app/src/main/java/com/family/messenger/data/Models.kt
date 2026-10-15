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
data class Reactions(
    val heart: Int = 0,
    val like: Int = 0,
    val dislike: Int = 0,
)

@Serializable
data class Post(
    val id: Long,
    val authorId: Long,
    val authorName: String,
    val text: String,
    val imageUrl: String? = null,
    val createdAt: Long,
    val commentCount: Int,
    val reactions: Reactions,
    val myReactions: List<String>,
)

@Serializable
data class Comment(
    val id: Long,
    val postId: Long,
    val authorId: Long,
    val authorName: String,
    val text: String,
    val createdAt: Long,
)

@Serializable
data class SocketEvent(
    val type: String,
    val message: Message? = null,
    val postId: Long? = null,
    val authorId: Long? = null,
    val authorName: String? = null,
    val postAuthorId: Long? = null,
    val comment: Comment? = null,
)
