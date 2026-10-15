package com.family.messenger

import com.family.messenger.data.Api
import com.family.messenger.data.AuthResponse
import com.family.messenger.data.CalendarEvent
import com.family.messenger.data.Conversation
import com.family.messenger.data.FeedSummary
import com.family.messenger.data.ListItem
import com.family.messenger.data.Message
import com.family.messenger.data.Post
import com.family.messenger.data.ReadState
import com.family.messenger.data.SocketEvent
import com.family.messenger.data.User
import com.family.messenger.ui.CalendarViewModel
import com.family.messenger.ui.ChatViewModel
import kotlinx.serialization.decodeFromString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/**
 * The fixtures are real responses captured from the server (see server tests), so these checks
 * catch any mismatch between what the server sends and what the app expects.
 */
class ServerContractTest {
    private fun fixture(name: String): String =
        requireNotNull(javaClass.getResource("/fixtures/$name.json")) { "missing fixture $name" }.readText()

    private inline fun <reified T> decode(name: String): T = Api.json.decodeFromString(fixture(name))

    @Test
    fun usersAndAuth() {
        val auth = decode<AuthResponse>("auth")
        assertEquals("엄마", auth.user.displayName)
        val users = decode<List<User>>("users")
        assertTrue(users.first { it.username == "mom" }.avatarUrl!!.startsWith("/api/media/"))
        assertNull(users.first { it.username == "dad" }.avatarUrl)
    }

    @Test
    fun messagesWithRepliesReactionsPollsAndDeletion() {
        val messages = decode<List<Message>>("messages")
        val (hello, deleted, poll) = messages
        assertEquals(listOf(2L), hello.reactions.single { it.emoji == "❤️" }.userIds)
        assertTrue(deleted.deleted)
        assertEquals("삭제된 메시지", deleted.preview)
        assertEquals(hello.id, deleted.replyTo!!.id)
        assertTrue(poll.isPoll)
        assertEquals(listOf("짜장", "짬뽕"), poll.poll!!.options.map { it.text })
        assertEquals("투표: 저녁?", poll.preview)
        assertNotNull(decode<Message>("message_reply").replyTo)
    }

    @Test
    fun conversationsAndReads() {
        val conversations = decode<List<Conversation>>("conversations")
        assertTrue(conversations.first().isGroup)
        assertTrue(conversations.first().unreadCount > 0)
        assertNotNull(conversations[1].userId)
        val reads = decode<List<ReadState>>("reads")
        assertEquals(2, reads.size)
    }

    @Test
    fun storiesCalendarAndLists() {
        val post = decode<List<Post>>("posts").single()
        assertEquals(1, post.media.size)
        assertTrue(post.media.single().name.endsWith(".png"))
        decode<List<Post>>("memories")
        assertEquals(2, decode<FeedSummary>("summary").members)
        val events = decode<List<CalendarEvent>>("events")
        assertEquals("14:30", events.first { it.title == "치과" }.time)
        assertTrue(events.first { it.title == "생일" }.yearly)
        val items = decode<List<ListItem>>("items")
        assertEquals("아빠", items.first { it.text == "우유" }.doneByName)
    }

    @Test
    fun everySocketEventParses() {
        val events = decode<List<SocketEvent>>("socket_events")
        val types = events.map { it.type }.toSet()
        assertTrue(types.containsAll(listOf("message", "messageUpdated", "user", "events", "lists", "reminder")))
        events.filter { it.type == "message" || it.type == "messageUpdated" }.forEach { assertNotNull(it.message) }
        assertNotNull(events.first { it.type == "user" }.user)
        val reminder = events.first { it.type == "reminder" }
        assertEquals("calendar", reminder.target)
        assertNotNull(reminder.text)
    }

    @Test
    fun unreadCountLikeKakaoTalk() {
        val message = decode<List<Message>>("messages").first() // sent by user 1
        val state = ChatViewModel.State(reads = mapOf(1L to message.id, 2L to 0L, 3L to message.id))
        assertEquals(1, state.unreadCount(message)) // only user 2 hasn't read it; the sender doesn't count
    }

    @Test
    fun yearlyEventsRepeatFromTheirFirstYear() {
        val events = decode<List<CalendarEvent>>("events")
        val state = CalendarViewModel.State(events = events, loading = false)
        assertEquals(listOf("생일"), state.on(LocalDate.of(2031, 10, 15)).map { it.title })
        assertTrue(state.on(LocalDate.of(1969, 10, 15)).isEmpty())
        assertEquals(listOf("치과"), state.on(LocalDate.of(2026, 10, 16)).map { it.title })
        val upcoming = state.upcoming(LocalDate.of(2026, 10, 15), count = 2)
        assertEquals(listOf("생일", "치과"), upcoming.map { it.second.title })
    }
}
