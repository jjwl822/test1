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
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.family.messenger.data.MessageBus
import com.family.messenger.data.User
import com.family.messenger.service.MessageService
import com.family.messenger.ui.ChatScreen
import com.family.messenger.ui.ConversationsScreen
import com.family.messenger.ui.FeedScreen
import com.family.messenger.ui.FamilyTheme
import com.family.messenger.ui.LoginScreen
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

    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }

    LaunchedEffect(auth != null) {
        if (auth != null) {
            if (Build.VERSION.SDK_INT >= 33) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            MessageService.start(app)
        } else {
            MessageService.stop(app)
            chatId = null
        }
    }

    val pending by pendingChat.collectAsStateWithLifecycle()
    LaunchedEffect(pending, auth != null) {
        val target = pending ?: return@LaunchedEffect
        if (auth != null) {
            if (target.first == MessageBus.FEED) {
                chatId = null
                tab = TAB_STORY
            } else {
                chatId = target.first
                chatTitle = target.second
            }
        }
        pendingChat.value = null
    }

    val user = auth?.user
    val openChat = chatId
    when {
        user == null -> LoginScreen(app)
        openChat != null -> {
            BackHandler { chatId = null }
            ChatScreen(app, openChat, chatTitle, me = user, onBack = { chatId = null })
        }
        else -> Home(app, user, tab, onTab = { tab = it }, onOpenChat = { id, title ->
            chatId = id
            chatTitle = title
        })
    }
}

private const val TAB_CHATS = 0
private const val TAB_STORY = 1

@Composable
private fun Home(app: FamilyApp, me: User, tab: Int, onTab: (Int) -> Unit, onOpenChat: (String, String) -> Unit) {
    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = tab == TAB_CHATS,
                    onClick = { onTab(TAB_CHATS) },
                    icon = { Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = null) },
                    label = { Text("채팅") },
                )
                NavigationBarItem(
                    selected = tab == TAB_STORY,
                    onClick = { onTab(TAB_STORY) },
                    icon = { Icon(Icons.Filled.PhotoLibrary, contentDescription = null) },
                    label = { Text("스토리") },
                )
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
                else -> ConversationsScreen(app, me = me, onOpen = onOpenChat)
            }
        }
    }
}
