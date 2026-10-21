package com.family.messenger.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.family.messenger.FamilyApp
import com.family.messenger.data.Conversation
import com.family.messenger.data.ImageCompressor
import com.family.messenger.data.User
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationsScreen(
    app: FamilyApp,
    me: User,
    viewModel: ConversationsViewModel,
    onOpen: (id: String, title: String) -> Unit,
) {
    val conversations by viewModel.conversations.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()
    val users by app.directory.users.collectAsStateWithLifecycle()
    var refreshing by remember { mutableStateOf(false) }
    var showProfile by rememberSaveable { mutableStateOf(false) }
    var showSettings by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("가족 메신저", style = MaterialTheme.typography.titleLarge) },
                actions = {
                    Box(Modifier.padding(end = 4.dp).clickable { showProfile = true }) {
                        Avatar(me.displayName, size = 34.dp, imageUrl = app.avatarUrl(users[me.id] ?: me), color = bubbleColor((users[me.id] ?: me).color))
                    }
                    Box {
                        IconButton(onClick = { showSettings = true }) { Icon(Icons.Filled.Settings, contentDescription = "설정") }
                        DropdownMenu(expanded = showSettings, onDismissRequest = { showSettings = false }) {
                            val version = remember { context.packageManager.getPackageInfo(context.packageName, 0).versionName }
                            DropdownMenuItem(text = { Text("현재 버전 $version", color = MaterialTheme.colorScheme.onSurfaceVariant) }, onClick = {}, enabled = false)
                            DropdownMenuItem(
                                text = { Text("최신 버전 다운로드") },
                                onClick = {
                                    showSettings = false
                                    // The browser downloads the APK the server hosts; the timestamp skips Cloudflare's cache.
                                    val apk = app.api.url("/app/family.apk") + "?t=" + System.currentTimeMillis()
                                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(apk)))
                                },
                            )
                        }
                    }
                },
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    viewModel.refresh().join()
                    refreshing = false
                }
            },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(Modifier.fillMaxSize()) {
                item {
                    Text(
                        "${me.displayName}님, 안녕하세요",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }
                error?.let { item { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp)) } }
                items(conversations, key = { it.id }) { conversation ->
                    val person = users[conversation.userId]
                    ConversationRow(conversation, imageUrl = app.avatarUrl(person), color = person?.color?.let(::bubbleColor)) {
                        onOpen(conversation.id, conversation.title)
                    }
                }
                if (conversations.size == 1) {
                    item {
                        Text(
                            "아직 다른 가족이 가입하지 않았어요. 서버 주소와 가족 코드를 알려주세요.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(16.dp),
                        )
                    }
                }
            }
        }
    }

    if (showProfile) ProfileDialog(app, users[me.id] ?: me, onDismiss = { showProfile = false })
}

@Composable
private fun ConversationRow(conversation: Conversation, imageUrl: String?, color: Color?, onClick: () -> Unit) {
    val unread = conversation.unreadCount > 0
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Avatar(conversation.title, conversation.isGroup, size = 56.dp, ring = unread, imageUrl = imageUrl, color = color)
        Column(Modifier.weight(1f)) {
            Text(
                conversation.title,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = if (unread) FontWeight.Bold else FontWeight.Normal,
            )
            val last = conversation.lastMessage
            Text(
                text = when {
                    last == null -> "대화를 시작해 보세요"
                    conversation.isGroup -> "${last.senderName}: ${last.preview}"
                    else -> last.preview
                } + (last?.let { " · ${formatAgo(it.createdAt)}" } ?: ""),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal,
                color = if (unread) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (unread) UnreadBadge(conversation.unreadCount)
    }
}

/** Red count bubble, e.g. on a chat room or the 채팅 tab. */
@Composable
fun UnreadBadge(count: Int, modifier: Modifier = Modifier) {
    Box(
        modifier
            .heightIn(min = 20.dp)
            .widthIn(min = 20.dp)
            .background(HeartRed, CircleShape)
            .padding(horizontal = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            if (count > 99) "99+" else count.toString(),
            color = Color.White,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
        )
    }
}

/**
 * Round avatar: the profile photo when there is one, otherwise the first letter.
 * [ring] adds Instagram's story gradient around it.
 */
@Composable
fun Avatar(
    name: String,
    isGroup: Boolean = false,
    size: Dp = 48.dp,
    ring: Boolean = false,
    imageUrl: String? = null,
    /** Without a photo, the first letter sits on this color (the person's bubble color). */
    color: Color? = null,
) {
    val ringWidth = if (ring) (size.value / 20f).coerceAtLeast(2f).dp else 0.dp
    Box(
        modifier = Modifier
            .size(size)
            .then(if (ring) Modifier.border(ringWidth, StoryGradient, CircleShape) else Modifier)
            .padding(ringWidth * 1.5f)
            .clip(CircleShape)
            .background(if (imageUrl == null && color != null) color else MaterialTheme.colorScheme.primaryContainer),
        contentAlignment = Alignment.Center,
    ) {
        when {
            imageUrl != null -> AsyncImage(
                model = imageUrl,
                contentDescription = name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            isGroup -> Icon(
                Icons.Filled.Groups,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(size * 0.5f),
            )
            else -> Text(
                name.take(1),
                fontSize = (size.value * 0.4f).sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }
    }
}

/** My profile: change photo and name, and log out. */
@Composable
private fun ProfileDialog(app: FamilyApp, me: User, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var name by rememberSaveable { mutableStateOf(me.displayName) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmLogout by remember { mutableStateOf(false) }
    var colors by remember { mutableStateOf<List<String>>(emptyList()) }
    LaunchedEffect(Unit) { colors = runCatching { app.api.bubbleColors() }.getOrDefault(emptyList()) }

    fun launchAction(block: suspend () -> Unit) {
        busy = true
        error = null
        scope.launch {
            try {
                block()
            } catch (e: Exception) {
                error = e.message
            } finally {
                busy = false
            }
        }
    }

    val pickPhoto = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            launchAction {
                val jpeg = ImageCompressor.compress(app, uri, maxSide = 640)
                app.directory.update(app.api.uploadAvatar(jpeg))
            }
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("내 프로필") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                Box(contentAlignment = Alignment.Center) {
                    Avatar(me.displayName, size = 96.dp, ring = true, imageUrl = app.avatarUrl(me), color = bubbleColor(me.color))
                    if (busy) CircularProgressIndicator()
                }
                Row {
                    TextButton(
                        onClick = { pickPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                        enabled = !busy,
                    ) { Text("사진 변경") }
                    if (me.avatarUrl != null) {
                        TextButton(onClick = { launchAction { app.directory.update(app.api.deleteAvatar()) } }, enabled = !busy) {
                            Text("사진 삭제", color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("이름") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (colors.isNotEmpty()) {
                    Text(
                        "내 말풍선 색",
                        style = MaterialTheme.typography.labelLarge,
                        modifier = Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 6.dp),
                    )
                    ColorPicker(colors, selected = me.color, enabled = !busy) { picked ->
                        launchAction { app.directory.update(app.api.updateColor(picked)) }
                    }
                    Text(
                        "안녕! 이렇게 보여요 😊",
                        color = Color.White,
                        modifier = Modifier
                            .padding(top = 10.dp)
                            .clip(RoundedCornerShape(20.dp))
                            .background(bubbleColor(me.color))
                            .padding(horizontal = 14.dp, vertical = 8.dp),
                    )
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                TextButton(onClick = { confirmLogout = true }, modifier = Modifier.padding(top = 8.dp)) {
                    Text("로그아웃", color = MaterialTheme.colorScheme.error)
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    if (name.trim() == me.displayName) {
                        onDismiss()
                    } else {
                        launchAction {
                            app.directory.update(app.api.updateName(name.trim()))
                            onDismiss()
                        }
                    }
                },
                enabled = !busy && name.isNotBlank(),
            ) { Text("완료", fontWeight = FontWeight.SemiBold) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("닫기") } },
    )

    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text("로그아웃할까요?") },
            text = { Text("로그아웃하면 새 메시지 알림을 받을 수 없어요.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmLogout = false
                    scope.launch {
                        runCatching { app.api.logout() }
                        app.directory.clear()
                        app.session.clear()
                    }
                }) { Text("로그아웃", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text("취소") } },
        )
    }
}

/** Round swatches of the bubble colors; the chosen one has a ring and a check. */
@Composable
private fun ColorPicker(colors: List<String>, selected: String?, enabled: Boolean, onPick: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        colors.chunked(5).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { hex ->
                    val on = hex.equals(selected, ignoreCase = true)
                    Box(
                        Modifier
                            .size(38.dp)
                            .then(if (on) Modifier.border(2.dp, MaterialTheme.colorScheme.onSurface, CircleShape) else Modifier)
                            .padding(if (on) 4.dp else 0.dp)
                            .clip(CircleShape)
                            .background(bubbleColor(hex))
                            .clickable(enabled = enabled && !on) { onPick(hex) },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (on) Icon(Icons.Filled.Check, contentDescription = "선택됨", tint = Color.White, modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
    }
}
