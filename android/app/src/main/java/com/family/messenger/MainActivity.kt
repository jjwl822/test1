package com.family.messenger

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.SportsEsports
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.SportsEsports
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.family.messenger.data.GameInfo
import com.family.messenger.data.MessageBus
import com.family.messenger.data.User
import com.family.messenger.service.MessageService
import com.family.messenger.ui.CalendarScreen
import com.family.messenger.ui.ChatScreen
import com.family.messenger.ui.ConversationsScreen
import com.family.messenger.ui.ConversationsViewModel
import com.family.messenger.ui.FamilyTheme
import com.family.messenger.ui.FeedScreen
import com.family.messenger.ui.GamePlayer
import com.family.messenger.ui.GamesScreen
import com.family.messenger.ui.HomeworkScreen
import com.family.messenger.ui.ListsScreen
import com.family.messenger.ui.LoginScreen
import com.family.messenger.ui.UnreadBadge
import kotlinx.coroutines.flow.MutableStateFlow

class MainActivity : ComponentActivity() {

    /** Conversation to open because a notification was tapped. */
    private val pendingChat = MutableStateFlow<Pair<String, String>?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) handleIntent(intent)
        val app = application as FamilyApp
        setContent {
            FamilyTheme {
                App(app, pendingChat)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val id = intent?.getStringExtra(EXTRA_CONVERSATION_ID) ?: return
        pendingChat.value = id to (intent.getStringExtra(EXTRA_TITLE) ?: "대화")
    }

    companion object {
        const val EXTRA_CONVERSATION_ID = "conversation_id"
        const val EXTRA_TITLE = "title"
    }
}

@Composable
private fun App(app: FamilyApp, pendingChat: MutableStateFlow<Pair<String, String>?>) {
    val auth by app.session.auth.collectAsStateWithLifecycle()
    var chatId by rememberSaveable { mutableStateOf<String?>(null) }
    var chatTitle by rememberSaveable { mutableStateOf("") }
    var tab by rememberSaveable { mutableIntStateOf(TAB_CHATS) }
    var playing by remember { mutableStateOf<GameInfo?>(null) }

    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }

    LaunchedEffect(auth != null) {
        if (auth != null) {
            if (Build.VERSION.SDK_INT >= 33) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            MessageService.start(app)
            app.directory.refresh()
        } else {
            MessageService.stop(app)
            chatId = null
        }
    }
    // Names and profile photos may have changed while we were offline.
    LaunchedEffect(Unit) { MessageBus.connected.collect { if (it) app.directory.refresh() } }

    val pending by pendingChat.collectAsStateWithLifecycle()
    LaunchedEffect(pending, auth != null) {
        val target = pending ?: return@LaunchedEffect
        if (auth != null) {
            when (target.first) {
                MessageBus.FEED -> {
                    chatId = null
                    tab = TAB_STORY
                }
                MessageBus.CALENDAR -> {
                    chatId = null
                    tab = TAB_CALENDAR
                }
                MessageBus.LISTS -> {
                    chatId = null
                    tab = TAB_LISTS
                }
                MessageBus.HOMEWORK -> {
                    chatId = null
                    tab = TAB_HOMEWORK
                }
                else -> {
                    chatId = target.first
                    chatTitle = target.second
                }
            }
        }
        pendingChat.value = null
    }

    val user = auth?.user
    if (user == null) {
        LoginScreen(app)
        return
    }
    // Shared by the chat list and the unread badge on the tab bar.
    val conversations: ConversationsViewModel = viewModel(key = "conversations-${user.id}") { ConversationsViewModel(app) }
    val openChat = chatId
    val game = playing
    if (game != null) {
        GamePlayer(app, game, onBack = { playing = null })
    } else if (openChat != null) {
        BackHandler { chatId = null }
        ChatScreen(app, openChat, chatTitle, me = user, onBack = {
            chatId = null
            conversations.refresh()
        })
    } else {
        Home(
            app,
            user,
            conversations,
            tab,
            onTab = { tab = it },
            onOpenChat = { id, title ->
                chatId = id
                chatTitle = title
            },
            onPlay = { playing = it },
        )
    }
}

private const val TAB_CHATS = 0
private const val TAB_STORY = 1
private const val TAB_CALENDAR = 2
private const val TAB_LISTS = 3
private const val TAB_HOMEWORK = 4
private const val TAB_GAMES = 5

private data class TabSpec(val label: String, val selected: ImageVector, val unselected: ImageVector)

private val TABS = listOf(
    TabSpec("채팅", Icons.Filled.ChatBubble, Icons.Outlined.ChatBubbleOutline),
    TabSpec("스토리", Icons.Filled.PhotoLibrary, Icons.Outlined.PhotoLibrary),
    TabSpec("일정", Icons.Filled.CalendarMonth, Icons.Outlined.CalendarMonth),
    TabSpec("목록", Icons.Filled.Checklist, Icons.Outlined.Checklist),
    TabSpec("숙제", Icons.Filled.School, Icons.Outlined.School),
    TabSpec("게임", Icons.Filled.SportsEsports, Icons.Outlined.SportsEsports),
)

@Composable
private fun Home(
    app: FamilyApp,
    me: User,
    conversations: ConversationsViewModel,
    tab: Int,
    onTab: (Int) -> Unit,
    onOpenChat: (String, String) -> Unit,
    onPlay: (GameInfo) -> Unit,
) {
    val rooms by conversations.conversations.collectAsStateWithLifecycle()
    val unread = rooms.sumOf { it.unreadCount }
    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = {
            // Instagram-style bar: plain background, hairline on top, filled icon when selected.
            Column {
                HorizontalDivider()
                NavigationBar(containerColor = MaterialTheme.colorScheme.surface, tonalElevation = 0.dp) {
                    val colors = NavigationBarItemDefaults.colors(
                        indicatorColor = Color.Transparent,
                        selectedIconColor = MaterialTheme.colorScheme.onSurface,
                        selectedTextColor = MaterialTheme.colorScheme.onSurface,
                        unselectedIconColor = MaterialTheme.colorScheme.onSurface,
                        unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    TABS.forEachIndexed { index, spec ->
                        NavigationBarItem(
                            selected = tab == index,
                            onClick = { onTab(index) },
                            icon = {
                                BadgedBox(badge = { if (index == TAB_CHATS && unread > 0) UnreadBadge(unread) }) {
                                    Icon(
                                        if (tab == index) spec.selected else spec.unselected,
                                        contentDescription = null,
                                        modifier = Modifier.size(26.dp),
                                    )
                                }
                            },
                            label = { Text(spec.label) },
                            colors = colors,
                        )
                    }
                }
            }
        },
    ) { padding ->
        // Only the bottom bar's space is reserved here; each tab draws its own top bar.
        Box(
            Modifier
                .fillMaxSize()
                .padding(bottom = padding.calculateBottomPadding())
                .consumeWindowInsets(padding),
        ) {
            when (tab) {
                TAB_STORY -> FeedScreen(app, me)
                TAB_CALENDAR -> CalendarScreen(app)
                TAB_LISTS -> ListsScreen(app)
                TAB_HOMEWORK -> HomeworkScreen(app)
                TAB_GAMES -> GamesScreen(app, onPlay = onPlay)
                else -> ConversationsScreen(app, me = me, viewModel = conversations, onOpen = onOpenChat)
            }
        }
    }
}
