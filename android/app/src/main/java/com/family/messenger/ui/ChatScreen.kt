package com.family.messenger.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import com.family.messenger.FamilyApp
import com.family.messenger.data.Message
import com.family.messenger.data.MessageBus
import com.family.messenger.data.User
import com.family.messenger.service.Notifications

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(app: FamilyApp, conversationId: String, title: String, me: User, onBack: () -> Unit) {
    val viewModel: ChatViewModel = viewModel(key = conversationId) { ChatViewModel(app, conversationId) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val isGroup = conversationId == "family"
    var draft by rememberSaveable(conversationId) { mutableStateOf("") }
    var viewing by remember { mutableStateOf<String?>(null) }
    val listState = rememberLazyListState()

    DisposableEffect(conversationId) {
        MessageBus.activeConversation.value = conversationId
        Notifications.cancel(app, conversationId)
        onDispose {
            if (MessageBus.activeConversation.value == conversationId) MessageBus.activeConversation.value = null
        }
    }

    val pickPhoto = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) viewModel.sendImage(uri)
    }

    // Keep the newest message in view as messages arrive.
    val lastId = state.messages.lastOrNull()?.id
    LaunchedEffect(lastId) {
        if (state.messages.isNotEmpty()) listState.animateScrollToItem(listState.layoutInfo.totalItemsCount - 1)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "뒤로") }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding(),
        ) {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                if (state.loading && state.messages.isEmpty()) {
                    CircularProgressIndicator(Modifier.align(Alignment.Center))
                }
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
                ) {
                    if (state.hasOlder) {
                        item {
                            TextButton(onClick = { viewModel.loadOlder() }, modifier = Modifier.fillMaxWidth()) {
                                Text("이전 메시지 더 보기")
                            }
                        }
                    }
                    items(state.messages, key = { it.id }) { message ->
                        MessageBubble(
                            message = message,
                            mine = message.senderId == me.id,
                            showName = isGroup,
                            imageUrl = message.imageUrl?.let(app.api::url),
                            onImageClick = { viewing = it },
                        )
                    }
                }
            }

            state.error?.let {
                Text(
                    it,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                )
            }

            Surface(tonalElevation = 2.dp) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(
                        onClick = { pickPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                        enabled = !state.sending,
                    ) {
                        Icon(Icons.Filled.AddPhotoAlternate, contentDescription = "사진 보내기")
                    }
                    OutlinedTextField(
                        value = draft,
                        onValueChange = { draft = it },
                        placeholder = { Text("메시지 입력") },
                        maxLines = 4,
                        shape = RoundedCornerShape(24.dp),
                        modifier = Modifier.weight(1f),
                    )
                    if (state.sending) {
                        CircularProgressIndicator(Modifier.padding(12.dp).size(24.dp), strokeWidth = 2.dp)
                    } else {
                        IconButton(
                            onClick = {
                                viewModel.sendText(draft.trim())
                                draft = ""
                            },
                            enabled = draft.isNotBlank(),
                        ) {
                            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "보내기", tint = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
            }
        }
    }

    viewing?.let { url ->
        Dialog(onDismissRequest = { viewing = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color.Black)
                    .clickable { viewing = null },
                contentAlignment = Alignment.Center,
            ) {
                AsyncImage(model = url, contentDescription = "사진", contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
            }
        }
    }
}

@Composable
private fun MessageBubble(
    message: Message,
    mine: Boolean,
    showName: Boolean,
    imageUrl: String?,
    onImageClick: (String) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (mine) Alignment.End else Alignment.Start,
    ) {
        if (showName && !mine) {
            Text(
                message.senderName,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 4.dp, bottom = 2.dp),
            )
        }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (mine) TimeLabel(message)
            val shape = RoundedCornerShape(18.dp)
            if (imageUrl != null) {
                AsyncImage(
                    model = imageUrl,
                    contentDescription = "사진",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .widthIn(max = 240.dp)
                        .heightIn(min = 120.dp, max = 320.dp)
                        .background(MaterialTheme.colorScheme.surfaceVariant, shape)
                        .clickable { onImageClick(imageUrl) },
                )
            } else {
                Surface(
                    shape = shape,
                    color = if (mine) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = if (mine) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.widthIn(max = 280.dp),
                ) {
                    Text(message.text.orEmpty(), modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp))
                }
            }
            if (!mine) TimeLabel(message)
        }
    }
}

@Composable
private fun TimeLabel(message: Message) {
    Text(
        formatTime(message.createdAt, alwaysTime = true),
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}
