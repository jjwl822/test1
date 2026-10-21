package com.family.messenger.data

import kotlinx.serialization.Serializable

@Serializable
data class User(
    val id: Long,
    val username: String,
    val displayName: String,
    val avatarUrl: String? = null,
    /** Chat bubble color, e.g. "#1877F2". */
    val color: String? = null,
)

/** The newest app build on the server (web/app/version.json, written next to family.apk). */
@Serializable
data class AppVersion(val versionCode: Long, val versionName: String)

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
    val deleted: Boolean = false,
    val replyTo: ReplyPreview? = null,
    val reactions: List<MessageReaction> = emptyList(),
    val poll: Poll? = null,
    val createdAt: Long,
) {
    val isImage: Boolean get() = kind == "image"
    val isPoll: Boolean get() = kind == "poll"
    val preview: String
        get() = when {
            deleted -> "삭제된 메시지"
            isImage -> "사진"
            isPoll -> "투표: ${poll?.question ?: text.orEmpty()}"
            else -> text.orEmpty()
        }
}

@Serializable
data class ReplyPreview(
    val id: Long,
    val senderName: String,
    val preview: String,
)

@Serializable
data class MessageReaction(
    val emoji: String,
    val userIds: List<Long>,
)

@Serializable
data class Poll(
    val question: String,
    val multiple: Boolean,
    val options: List<PollOption>,
)

@Serializable
data class PollOption(
    val id: Long,
    val text: String,
    val voterIds: List<Long>,
)

@Serializable
data class ReadState(
    val userId: Long,
    val lastReadId: Long,
)

@Serializable
data class CalendarEvent(
    val id: Long,
    val title: String,
    /** YYYY-MM-DD */
    val date: String,
    /** HH:MM, or null for all-day */
    val time: String? = null,
    val note: String = "",
    /** Repeats every year on the same day (birthdays, anniversaries). */
    val yearly: Boolean = false,
    val authorId: Long,
    val authorName: String,
    val createdAt: Long,
)

@Serializable
data class ListItem(
    val id: Long,
    /** "shopping", "todo" or "homework" */
    val list: String,
    val text: String,
    val done: Boolean,
    val authorId: Long,
    val authorName: String,
    val doneByName: String? = null,
    val createdAt: Long,
    val doneAt: Long? = null,
    /** Homework due date, YYYY-MM-DD. */
    val due: String? = null,
    val assigneeId: Long? = null,
    val assigneeName: String? = null,
    /** Taken from a notice in the family chat ([Api.listItemSource]). */
    val fromChat: Boolean = false,
)

/** A child the 숙제 tab has a page for. */
@Serializable
data class HomeworkPerson(val id: Long, val name: String)

@Serializable
data class SourceMessage(val id: Long, val text: String? = null, val senderName: String, val createdAt: Long)

@Serializable
data class ListItemSource(val messages: List<SourceMessage>)

@Serializable
data class Conversation(
    val id: String,
    val kind: String,
    val title: String,
    /** The other person, for 1:1 chats. */
    val userId: Long? = null,
    val lastMessage: Message? = null,
    val unreadCount: Int = 0,
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
    val media: List<PostMedia> = emptyList(),
    val createdAt: Long,
    val editedAt: Long? = null,
    val commentCount: Int,
    val reactions: Reactions,
    val myReactions: List<String>,
)

@Serializable
data class PostMedia(
    val name: String,
    val url: String,
    val kind: String,
    val posterUrl: String? = null,
) {
    val isVideo: Boolean get() = kind == "video"
}

@Serializable
data class FeedSummary(
    val posts: Int,
    val members: Int,
)

@Serializable
data class Uploaded(
    val name: String,
    val kind: String,
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

/** A game from server/web/games/games.json; [url] is an HTML page on the server. */
@Serializable
data class GameInfo(
    val id: String,
    val title: String,
    val emoji: String = "🎮",
    val description: String = "",
    val url: String,
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
    val user: User? = null,
    val conversationId: String? = null,
    val userId: Long? = null,
    val lastReadId: Long? = null,
    val target: String? = null,
    val title: String? = null,
    val text: String? = null,
)
