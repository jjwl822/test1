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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.family.messenger.service.MessageService
import com.family.messenger.ui.ChatScreen
import com.family.messenger.ui.ConversationsScreen
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
            chatId = target.first
            chatTitle = target.second
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
        else -> ConversationsScreen(app, me = user, onOpen = { id, title ->
            chatId = id
            chatTitle = title
        })
    }
}
