package com.family.messenger.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.HowToVote
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import com.family.messenger.FamilyApp
import com.family.messenger.call.CallActivity
import com.family.messenger.call.CallPeer
import com.family.messenger.data.Message
import com.family.messenger.data.MessageBus
import com.family.messenger.data.User
import com.family.messenger.service.Notifications
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val EMOJIS = listOf("❤️", "👍", "😂", "😮", "😢", "🙏")
private val dayFormat = DateTimeFormatter.ofPattern("yyyy년 M월 d일 EEEE", Locale.KOREAN)

private fun Message.day(): LocalDate = Instant.ofEpochMilli(createdAt).atZone(ZoneId.systemDefault()).toLocalDate()

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(app: FamilyApp, conversationId: String, title: String, me: User, onBack: () -> Unit) {
    val viewModel: ChatViewModel = viewModel(key = conversationId) { ChatViewModel(app, conversationId) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val users by app.directory.users.collectAsStateWithLifecycle()
    val isGroup = conversationId == "family"
    var draft by rememberSaveable(conversationId) { mutableStateOf("") }
    var viewing by remember { mutableStateOf<String?>(null) }
    var actionsFor by remember { mutableStateOf<Message?>(null) }
    var attachMenu by remember { mutableStateOf(false) }
    var composingPoll by rememberSaveable { mutableStateOf(false) }
    val listState = rememberLazyListState()

    // Only count as "reading" this chat while it's actually on screen (not when the app is in the background).
    LifecycleResumeEffect(conversationId) {
        MessageBus.activeConversation.value = conversationId
        Notifications.cancel(app, conversationId)
        viewModel.markRead()
        onPauseOrDispose {
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
                title = { Text(title, style = MaterialTheme.typography.titleLarge) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "뒤로") }
                },
                actions = {
                    // 1:1 rooms ("dm-3-7") can call the other person.
                    val peerId = conversationId.removePrefix("dm-").split("-").mapNotNull(String::toLongOrNull)
                        .takeIf { conversationId.startsWith("dm-") && it.size == 2 }
                        ?.firstOrNull { it != me.id }
                    if (peerId != null) {
                        val call = { video: Boolean ->
                            app.startActivity(
                                CallActivity.startIntent(app, CallPeer(peerId, title), video)
                                    .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
                            )
                        }
                        IconButton(onClick = { call(false) }) { Icon(Icons.Filled.Call, contentDescription = "음성통화") }
                        IconButton(onClick = { call(true) }) { Icon(Icons.Filled.Videocam, contentDescription = "영상통화") }
                    }
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
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                ) {
                    if (state.hasOlder) {
                        item {
                            TextButton(onClick = { viewModel.loadOlder() }, modifier = Modifier.fillMaxWidth()) {
                                Text("이전 메시지 더 보기")
                            }
                        }
                    }
                    itemsIndexed(state.messages, key = { _, m -> m.id }) { index, message ->
                        val previous = state.messages.getOrNull(index - 1)
                        val newDay = previous == null || previous.day() != message.day()
                        if (newDay) DaySeparator(message)
                        val mine = message.senderId == me.id
                        val firstOfRun = newDay || previous?.senderId != message.senderId
                        MessageRow(
                            message = message,
                            mine = mine,
                            firstOfRun = firstOfRun,
                            showName = isGroup && !mine && firstOfRun,
                            avatarUrl = app.avatarUrl(users[message.senderId]),
                            senderName = users[message.senderId]?.displayName ?: message.senderName,
                            // Every family member's messages show in their own color, for everyone.
                            color = bubbleColor(users[message.senderId]?.color),
                            unread = state.unreadCount(message),
                            me = me,
                            imageUrl = message.imageUrl?.let(app.api::url),
                            onImageClick = { viewing = it },
                            onLongPress = { if (!message.deleted) actionsFor = message },
                            onReact = { viewModel.react(message, it) },
                            onVote = { viewModel.vote(message, it) },
                        )
                    }
                }
            }

            state.error?.let {
                Text(
                    it,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier
                        .clickable { viewModel.clearError() }
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                )
            }

            state.replyingTo?.let { target ->
                ReplyBar(
                    name = users[target.senderId]?.displayName ?: target.senderName,
                    preview = target.preview,
                    onCancel = { viewModel.replyTo(null) },
                )
            }

            Surface(color = MaterialTheme.colorScheme.surface) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box {
                        IconButton(onClick = { attachMenu = true }, enabled = !state.sending) {
                            Icon(Icons.Filled.Add, contentDescription = "보내기 메뉴")
                        }
                        DropdownMenu(expanded = attachMenu, onDismissRequest = { attachMenu = false }) {
                            DropdownMenuItem(
                                text = { Text("사진") },
                                leadingIcon = { Icon(Icons.Outlined.Image, contentDescription = null) },
                                onClick = {
                                    attachMenu = false
                                    pickPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("투표 만들기") },
                                leadingIcon = { Icon(Icons.Outlined.HowToVote, contentDescription = null) },
                                onClick = {
                                    attachMenu = false
                                    composingPoll = true
                                },
                            )
                        }
                    }
                    OutlinedTextField(
                        value = draft,
                        onValueChange = { draft = it },
                        placeholder = { Text("메시지 보내기...") },
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

    actionsFor?.let { message ->
        MessageActions(
            message = message,
            mine = message.senderId == me.id,
            myEmoji = message.reactions.firstOrNull { me.id in it.userIds }?.emoji,
            onDismiss = { actionsFor = null },
            onReact = {
                viewModel.react(message, it)
                actionsFor = null
            },
            onReply = {
                viewModel.replyTo(message)
                actionsFor = null
            },
            onDelete = {
                viewModel.delete(message)
                actionsFor = null
            },
        )
    }

    if (composingPoll) {
        PollComposer(
            onDismiss = { composingPoll = false },
            onCreate = { question, options, multiple ->
                viewModel.createPoll(question, options, multiple)
                composingPoll = false
            },
        )
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
private fun DaySeparator(message: Message) {
    Box(Modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
        Text(
            message.day().format(dayFormat),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(12.dp))
                .padding(horizontal = 12.dp, vertical = 4.dp),
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MessageRow(
    message: Message,
    mine: Boolean,
    firstOfRun: Boolean,
    showName: Boolean,
    avatarUrl: String?,
    senderName: String,
    color: Color,
    unread: Int,
    me: User,
    imageUrl: String?,
    onImageClick: (String) -> Unit,
    onLongPress: () -> Unit,
    onReact: (String) -> Unit,
    onVote: (List<Long>) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = if (firstOfRun) 8.dp else 2.dp),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Top,
    ) {
        if (!mine) {
            // Avatar only on the first message of a run, like Instagram DMs.
            Box(Modifier.width(36.dp)) {
                if (firstOfRun) Avatar(senderName, size = 30.dp, imageUrl = avatarUrl, color = color)
            }
            Spacer(Modifier.width(6.dp))
        }
        Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
            if (showName) {
                Text(
                    senderName,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = color,
                    modifier = Modifier.padding(start = 4.dp, bottom = 2.dp),
                )
            }
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (mine) Meta(message, unread, alignEnd = true)
                val bubbleModifier = Modifier.combinedClickable(
                    onClick = { if (imageUrl != null) onImageClick(imageUrl) },
                    onLongClick = onLongPress,
                )
                when {
                    message.deleted -> DeletedBubble()
                    message.isPoll && message.poll != null -> PollCard(message, me, bubbleModifier, onVote)
                    imageUrl != null -> ImageBubble(message, imageUrl, mine, bubbleModifier)
                    else -> TextBubble(message, color, bubbleModifier)
                }
                if (!mine) Meta(message, unread, alignEnd = false)
            }
            if (message.reactions.isNotEmpty()) {
                Row(
                    Modifier.padding(top = 2.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    message.reactions.forEach { reaction ->
                        val minePick = me.id in reaction.userIds
                        Text(
                            "${reaction.emoji} ${reaction.userIds.size}",
                            style = MaterialTheme.typography.labelMedium,
                            modifier = Modifier
                                .clip(RoundedCornerShape(12.dp))
                                .background(
                                    if (minePick) MaterialTheme.colorScheme.primary.copy(alpha = 0.15f)
                                    else MaterialTheme.colorScheme.surfaceVariant,
                                )
                                .border(
                                    1.dp,
                                    if (minePick) MaterialTheme.colorScheme.primary else Color.Transparent,
                                    RoundedCornerShape(12.dp),
                                )
                                .clickable { onReact(reaction.emoji) }
                                .padding(horizontal = 8.dp, vertical = 2.dp),
                        )
                    }
                }
            }
        }
    }
}

/** Time, and how many haven't read it yet (like KakaoTalk's "1"). */
@Composable
private fun Meta(message: Message, unread: Int, alignEnd: Boolean) {
    Column(horizontalAlignment = if (alignEnd) Alignment.End else Alignment.Start) {
        if (unread > 0 && !message.deleted) {
            Text(
                unread.toString(),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
            )
        }
        Text(
            formatTime(message.createdAt, alwaysTime = true),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun TextBubble(message: Message, background: Color, modifier: Modifier) {
    // All bubble colors are dark enough for white text.
    val content = Color.White
    Column(
        modifier
            .widthIn(max = 270.dp)
            .clip(RoundedCornerShape(20.dp))
            .background(background)
            .padding(horizontal = 14.dp, vertical = 9.dp),
    ) {
        message.replyTo?.let { ReplyQuote(it.senderName, it.preview, content) }
        Text(message.text.orEmpty(), color = content)
    }
}

@Composable
private fun ImageBubble(message: Message, imageUrl: String, mine: Boolean, modifier: Modifier) {
    Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
        message.replyTo?.let {
            Box(
                Modifier
                    .widthIn(max = 240.dp)
                    .padding(bottom = 4.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(horizontal = 10.dp, vertical = 6.dp),
            ) { ReplyQuote(it.senderName, it.preview, MaterialTheme.colorScheme.onSurface) }
        }
        AsyncImage(
            model = imageUrl,
            contentDescription = "사진",
            contentScale = ContentScale.Crop,
            modifier = modifier
                .widthIn(max = 240.dp)
                .heightIn(min = 120.dp, max = 320.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
        )
    }
}

@Composable
private fun ReplyQuote(name: String, preview: String, color: Color) {
    Row(Modifier.padding(bottom = 6.dp)) {
        Box(Modifier.width(3.dp).height(34.dp).background(color.copy(alpha = 0.5f), RoundedCornerShape(2.dp)))
        Spacer(Modifier.width(8.dp))
        Column {
            Text("$name 님에게 답장", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = color.copy(alpha = 0.85f))
            Text(preview, style = MaterialTheme.typography.bodySmall, color = color.copy(alpha = 0.75f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun DeletedBubble() {
    Text(
        "삭제된 메시지입니다",
        fontStyle = FontStyle.Italic,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(20.dp))
            .padding(horizontal = 14.dp, vertical = 9.dp),
    )
}

/** A vote in the chat: tap an option to choose it, tap again to take it back. */
@Composable
private fun PollCard(message: Message, me: User, modifier: Modifier, onVote: (List<Long>) -> Unit) {
    val poll = message.poll ?: return
    val voters = poll.options.flatMap { it.voterIds }.toSet()
    val mine = poll.options.filter { me.id in it.voterIds }.map { it.id }
    Column(
        modifier
            .width(270.dp)
            .clip(RoundedCornerShape(18.dp))
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(18.dp))
            .background(MaterialTheme.colorScheme.surface)
            .padding(14.dp),
    ) {
        Text("📊 투표", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
        Text(poll.question, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp, bottom = 8.dp))
        poll.options.forEach { option ->
            val chosen = option.id in mine
            val share = if (voters.isEmpty()) 0f else option.voterIds.size.toFloat() / voters.size
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .clickable {
                        val next = when {
                            chosen -> mine - option.id
                            poll.multiple -> mine + option.id
                            else -> listOf(option.id)
                        }
                        onVote(next)
                    }
                    .padding(vertical = 6.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        if (chosen) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked,
                        contentDescription = null,
                        tint = if (chosen) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(20.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(option.text, modifier = Modifier.weight(1f), fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Normal)
                    Text("${option.voterIds.size}명", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                LinearProgressIndicator(
                    progress = { share },
                    modifier = Modifier.fillMaxWidth().padding(start = 28.dp, top = 4.dp).height(4.dp).clip(CircleShape),
                    trackColor = MaterialTheme.colorScheme.surfaceVariant,
                )
            }
        }
        Text(
            "${voters.size}명 참여" + if (poll.multiple) " · 여러 개 선택 가능" else "",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 6.dp),
        )
    }
}

@Composable
private fun ReplyBar(name: String, preview: String, onCancel: () -> Unit) {
    Column {
        HorizontalDivider()
        Row(
            Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainerLow).padding(start = 16.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.AutoMirrored.Filled.Reply, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("$name 님에게 답장", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                Text(preview, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            IconButton(onClick = onCancel) { Icon(Icons.Filled.Close, contentDescription = "답장 취소") }
        }
    }
}

/** Long-press menu: emoji reactions on top, then reply / copy / delete. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MessageActions(
    message: Message,
    mine: Boolean,
    myEmoji: String?,
    onDismiss: () -> Unit,
    onReact: (String) -> Unit,
    onReply: () -> Unit,
    onDelete: () -> Unit,
) {
    val clipboard = LocalClipboardManager.current
    var confirmDelete by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.navigationBarsPadding().padding(bottom = 8.dp)) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                EMOJIS.forEach { emoji ->
                    Text(
                        emoji,
                        fontSize = 30.sp,
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(if (emoji == myEmoji) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent)
                            .clickable { onReact(emoji) }
                            .padding(8.dp),
                    )
                }
            }
            HorizontalDivider()
            ListItem(
                headlineContent = { Text("답장") },
                leadingContent = { Icon(Icons.AutoMirrored.Filled.Reply, contentDescription = null) },
                modifier = Modifier.clickable(onClick = onReply),
            )
            if (!message.text.isNullOrEmpty() && !message.isPoll) {
                ListItem(
                    headlineContent = { Text("복사") },
                    leadingContent = { Icon(Icons.Outlined.ContentCopy, contentDescription = null) },
                    modifier = Modifier.clickable {
                        clipboard.setText(AnnotatedString(message.text))
                        onDismiss()
                    },
                )
            }
            if (mine) {
                ListItem(
                    headlineContent = { Text("삭제", color = MaterialTheme.colorScheme.error) },
                    leadingContent = { Icon(Icons.Outlined.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                    modifier = Modifier.clickable { confirmDelete = true },
                )
            }
        }
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("메시지를 삭제할까요?") },
            text = { Text("모든 가족의 화면에서 \"삭제된 메시지입니다\"로 바뀌어요.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    onDelete()
                }) { Text("삭제", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("취소") } },
        )
    }
}

@Composable
private fun PollComposer(onDismiss: () -> Unit, onCreate: (String, List<String>, Boolean) -> Unit) {
    var question by rememberSaveable { mutableStateOf("") }
    val options = remember { mutableStateListOf("", "") }
    var multiple by rememberSaveable { mutableStateOf(false) }
    val filled = options.map { it.trim() }.filter { it.isNotEmpty() }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("투표 만들기") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = question,
                    onValueChange = { question = it },
                    label = { Text("질문 (예: 저녁 뭐 먹을까?)") },
                    modifier = Modifier.fillMaxWidth(),
                )
                options.forEachIndexed { i, value ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(
                            value = value,
                            onValueChange = { options[i] = it },
                            label = { Text("선택지 ${i + 1}") },
                            singleLine = true,
                            modifier = Modifier.weight(1f),
                        )
                        if (options.size > 2) {
                            IconButton(onClick = { options.removeAt(i) }) { Icon(Icons.Filled.Close, contentDescription = "선택지 빼기") }
                        }
                    }
                }
                if (options.size < 10) {
                    TextButton(onClick = { options.add("") }) {
                        Icon(Icons.Filled.Add, contentDescription = null)
                        Text("선택지 추가")
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("여러 개 선택 가능", modifier = Modifier.weight(1f))
                    Switch(checked = multiple, onCheckedChange = { multiple = it })
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onCreate(question.trim(), filled, multiple) }, enabled = question.isNotBlank() && filled.size >= 2) {
                Text("올리기", fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("취소") } },
    )
}
