package com.family.messenger.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.ThumbDown
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import com.family.messenger.FamilyApp
import com.family.messenger.data.Comment
import com.family.messenger.data.MessageBus
import com.family.messenger.data.Post
import com.family.messenger.data.User
import com.family.messenger.service.Notifications

private val HeartRed = Color(0xFFE53950)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedScreen(app: FamilyApp, me: User) {
    val viewModel: FeedViewModel = viewModel { FeedViewModel(app) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    var composing by rememberSaveable { mutableStateOf(false) }
    var viewing by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf<Post?>(null) }

    DisposableEffect(Unit) {
        MessageBus.activeConversation.value = MessageBus.FEED
        Notifications.cancel(app, MessageBus.FEED)
        onDispose {
            if (MessageBus.activeConversation.value == MessageBus.FEED) MessageBus.activeConversation.value = null
        }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("가족 스토리") }) },
        floatingActionButton = {
            FloatingActionButton(onClick = {
                viewModel.clearError()
                composing = true
            }) {
                Icon(Icons.Filled.Add, contentDescription = "스토리 올리기")
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.loading && state.posts.isNotEmpty(),
            onRefresh = { viewModel.refresh() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 88.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                state.error?.let { error ->
                    item {
                        Text(
                            error,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.clickable { viewModel.clearError() }.padding(4.dp),
                        )
                    }
                }
                if (!state.loading && state.posts.isEmpty()) {
                    item {
                        Text(
                            "아직 스토리가 없어요.\n오른쪽 아래 + 버튼으로 첫 스토리를 올려보세요!",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(24.dp),
                        )
                    }
                }
                items(state.posts, key = { it.id }) { post ->
                    PostCard(
                        post = post,
                        mine = post.authorId == me.id,
                        imageUrl = post.imageUrl?.let(app.api::url),
                        onReact = { kind -> viewModel.react(post, kind) },
                        onComments = { viewModel.openComments(post) },
                        onDelete = { confirmDelete = post },
                        onImageClick = { viewing = it },
                    )
                }
                if (state.hasOlder) {
                    item {
                        TextButton(onClick = { viewModel.loadOlder() }, modifier = Modifier.fillMaxWidth()) {
                            Text("이전 스토리 더 보기")
                        }
                    }
                }
            }
            if (state.loading && state.posts.isEmpty()) CircularProgressIndicator(Modifier.align(Alignment.Center))
        }
    }

    if (composing) {
        ComposeDialog(
            posting = state.posting,
            error = state.error,
            onDismiss = { composing = false },
            onSubmit = { text, photo -> viewModel.create(text, photo) { composing = false } },
        )
    }

    state.commentsFor?.let { postId ->
        CommentsSheet(
            comments = state.comments,
            me = me,
            onDismiss = { viewModel.closeComments() },
            onSend = { viewModel.addComment(it) },
            onDelete = { viewModel.deleteComment(it) },
            key = postId,
        )
    }

    confirmDelete?.let { post ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("스토리를 삭제할까요?") },
            text = { Text("댓글과 반응도 함께 삭제됩니다.") },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.delete(post)
                    confirmDelete = null
                }) { Text("삭제", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("취소") } },
        )
    }

    viewing?.let { url ->
        Dialog(onDismissRequest = { viewing = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Box(Modifier.fillMaxSize().background(Color.Black).clickable { viewing = null }) {
                AsyncImage(model = url, contentDescription = "사진", contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
            }
        }
    }
}

@Composable
private fun PostCard(
    post: Post,
    mine: Boolean,
    imageUrl: String?,
    onReact: (String) -> Unit,
    onComments: () -> Unit,
    onDelete: () -> Unit,
    onImageClick: (String) -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().padding(start = 12.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Avatar(post.authorName)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(post.authorName, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Text(
                    formatTime(post.createdAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (mine) {
                var menu by remember { mutableStateOf(false) }
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "더보기") }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text("삭제") }, onClick = {
                            menu = false
                            onDelete()
                        })
                    }
                }
            }
        }

        if (imageUrl != null) {
            AsyncImage(
                model = imageUrl,
                contentDescription = "스토리 사진",
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(1f)
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .clickable { onImageClick(imageUrl) },
            )
        }

        Row(
            Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val my = post.myReactions
            ReactionButton(
                icon = if ("heart" in my) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                tint = if ("heart" in my) HeartRed else null,
                count = post.reactions.heart,
                label = "하트",
            ) { onReact("heart") }
            ReactionButton(
                icon = if ("like" in my) Icons.Filled.ThumbUp else Icons.Outlined.ThumbUp,
                tint = if ("like" in my) MaterialTheme.colorScheme.primary else null,
                count = post.reactions.like,
                label = "좋아요",
            ) { onReact("like") }
            ReactionButton(
                icon = if ("dislike" in my) Icons.Filled.ThumbDown else Icons.Outlined.ThumbDown,
                tint = if ("dislike" in my) MaterialTheme.colorScheme.onSurface else null,
                count = post.reactions.dislike,
                label = "싫어요",
            ) { onReact("dislike") }
            Spacer(Modifier.weight(1f))
            TextButton(onClick = onComments) {
                Icon(Icons.Outlined.ChatBubbleOutline, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text(if (post.commentCount > 0) "댓글 ${post.commentCount}" else "댓글 달기")
            }
        }

        if (post.text.isNotBlank()) {
            Text(
                post.text,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(start = 14.dp, end = 14.dp, bottom = 14.dp),
            )
        }
    }
}

@Composable
private fun ReactionButton(icon: ImageVector, tint: Color?, count: Int, label: String, onClick: () -> Unit) {
    Row(
        Modifier
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = label, tint = tint ?: MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(4.dp))
        Text("$count", style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
private fun ComposeDialog(
    posting: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onSubmit: (String, Uri?) -> Unit,
) {
    var text by rememberSaveable { mutableStateOf("") }
    var photo by rememberSaveable { mutableStateOf<Uri?>(null) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) photo = uri
    }
    val pickPhoto = { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }

    Dialog(
        onDismissRequest = { if (!posting) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.surface)
                .systemBarsPadding()
                .imePadding()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onDismiss, enabled = !posting) { Icon(Icons.Filled.Close, contentDescription = "닫기") }
                Text("새 스토리", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                Button(onClick = { onSubmit(text.trim(), photo) }, enabled = !posting && (text.isNotBlank() || photo != null)) {
                    if (posting) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("올리기")
                }
            }

            val current = photo
            if (current != null) {
                Box {
                    AsyncImage(
                        model = current,
                        contentDescription = "선택한 사진",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .fillMaxWidth()
                            .aspectRatio(1f)
                            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(12.dp))
                            .clickable(onClick = pickPhoto),
                    )
                    IconButton(onClick = { photo = null }, modifier = Modifier.align(Alignment.TopEnd)) {
                        Icon(Icons.Filled.Close, contentDescription = "사진 빼기", tint = Color.White)
                    }
                }
            } else {
                OutlinedButton(onClick = pickPhoto, modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp)) {
                    Icon(Icons.Filled.AddPhotoAlternate, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("사진 선택")
                }
            }

            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                placeholder = { Text("가족에게 이야기를 들려주세요") },
                modifier = Modifier.fillMaxWidth().weight(1f, fill = false).heightIn(min = 120.dp),
            )
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CommentsSheet(
    comments: List<Comment>,
    me: User,
    onDismiss: () -> Unit,
    onSend: (String) -> Unit,
    onDelete: (Comment) -> Unit,
    key: Long,
) {
    var draft by rememberSaveable(key) { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().imePadding()) {
            Text("댓글", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 16.dp))
            LazyColumn(
                Modifier.fillMaxWidth().heightIn(max = 420.dp),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                if (comments.isEmpty()) {
                    item { Text("첫 댓글을 남겨보세요", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                items(comments, key = { it.id }) { comment ->
                    Row(verticalAlignment = Alignment.Top) {
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(comment.authorName, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                                Spacer(Modifier.width(6.dp))
                                Text(
                                    formatTime(comment.createdAt),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Text(comment.text, style = MaterialTheme.typography.bodyMedium)
                        }
                        if (comment.authorId == me.id) {
                            TextButton(onClick = { onDelete(comment) }) { Text("삭제") }
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    placeholder = { Text("댓글 달기") },
                    maxLines = 3,
                    shape = RoundedCornerShape(24.dp),
                    modifier = Modifier.weight(1f),
                )
                IconButton(
                    onClick = {
                        onSend(draft.trim())
                        draft = ""
                    },
                    enabled = draft.isNotBlank(),
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "댓글 보내기", tint = MaterialTheme.colorScheme.primary)
                }
            }
        }
    }
}
