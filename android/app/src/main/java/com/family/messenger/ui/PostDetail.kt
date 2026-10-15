package com.family.messenger.ui

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.ThumbDown
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.family.messenger.FamilyApp
import com.family.messenger.data.Comment
import com.family.messenger.data.Post
import com.family.messenger.data.PostMedia
import com.family.messenger.data.User

/** One post, laid out like an Instagram post page. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PostDetailScreen(
    app: FamilyApp,
    viewModel: FeedViewModel,
    post: Post,
    me: User,
    onBack: () -> Unit,
    onEdit: () -> Unit,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var viewing by remember { mutableStateOf<Int?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("게시물", style = MaterialTheme.typography.titleLarge) },
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
                .verticalScroll(rememberScrollState()),
        ) {
            PostHeader(post, mine = post.authorId == me.id, onEdit = onEdit, onDelete = { confirmDelete = true })
            if (post.media.isNotEmpty()) MediaPager(app, post.media) { viewing = it }
            ActionRow(post, onReact = { viewModel.react(post, it) }, onComments = { viewModel.openComments(post) })
            ReactionSummary(post)
            if (post.text.isNotBlank()) {
                Text(
                    buildAnnotatedString {
                        withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(post.authorName) }
                        append("  ")
                        append(post.text)
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 2.dp),
                )
            }
            Text(
                if (post.commentCount > 0) "댓글 ${post.commentCount}개 모두 보기" else "댓글 달기...",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .clickable { viewModel.openComments(post) }
                    .padding(horizontal = 14.dp, vertical = 4.dp),
            )
            Text(
                formatAgo(post.createdAt) + if (post.editedAt != null) " · 수정됨" else "",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 14.dp, end = 14.dp, top = 2.dp, bottom = 24.dp),
            )
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(14.dp)) }
        }
    }

    if (state.commentsFor == post.id) {
        CommentsSheet(
            comments = state.comments,
            me = me,
            postId = post.id,
            onDismiss = { viewModel.closeComments() },
            onSend = { viewModel.addComment(it) },
            onDelete = { viewModel.deleteComment(it) },
        )
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("게시물을 삭제할까요?") },
            text = { Text("댓글과 반응도 함께 삭제되며 되돌릴 수 없어요.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    viewModel.delete(post)
                }) { Text("삭제", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("취소") } },
        )
    }

    viewing?.let { index -> MediaViewer(app, post.media, index, onDismiss = { viewing = null }) }
}

@Composable
private fun PostHeader(post: Post, mine: Boolean, onEdit: () -> Unit, onDelete: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(start = 12.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(post.authorName, size = 36.dp, ring = true)
        Spacer(Modifier.width(10.dp))
        Text(post.authorName, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        if (mine) {
            var menu by remember { mutableStateOf(false) }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreHoriz, contentDescription = "더보기") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text("수정") },
                        leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                        onClick = {
                            menu = false
                            onEdit()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("삭제", color = MaterialTheme.colorScheme.error) },
                        leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                        onClick = {
                            menu = false
                            onDelete()
                        },
                    )
                }
            }
        } else {
            Spacer(Modifier.size(48.dp))
        }
    }
}

/** Swipeable photos/videos with a page counter; the dots sit under the media like Instagram. */
@Composable
private fun MediaPager(app: FamilyApp, media: List<PostMedia>, onClick: (Int) -> Unit) {
    val pager = rememberPagerState { media.size }
    Box(Modifier.fillMaxWidth().aspectRatio(1f).background(MaterialTheme.colorScheme.surfaceVariant)) {
        HorizontalPager(state = pager, modifier = Modifier.fillMaxSize()) { page ->
            val item = media[page]
            Box(Modifier.fillMaxSize().clickable { onClick(page) }) {
                AsyncImage(
                    model = app.api.url(item.posterUrl ?: item.url),
                    contentDescription = if (item.isVideo) "동영상" else "사진",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
                if (item.isVideo) {
                    Icon(
                        Icons.Filled.PlayCircle,
                        contentDescription = "재생",
                        tint = Color.White.copy(alpha = 0.9f),
                        modifier = Modifier.align(Alignment.Center).size(64.dp),
                    )
                }
            }
        }
        if (media.size > 1) {
            Text(
                "${pager.currentPage + 1}/${media.size}",
                color = Color.White,
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(12.dp)
                    .background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(12.dp))
                    .padding(horizontal = 8.dp, vertical = 3.dp),
            )
        }
    }
    if (media.size > 1) {
        Row(
            Modifier.fillMaxWidth().padding(top = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterHorizontally),
        ) {
            repeat(media.size) { i ->
                Box(
                    Modifier
                        .size(6.dp)
                        .background(
                            if (i == pager.currentPage) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                            CircleShape,
                        ),
                )
            }
        }
    }
}

@Composable
private fun ActionRow(post: Post, onReact: (String) -> Unit, onComments: () -> Unit) {
    val my = post.myReactions
    Row(Modifier.padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        ActionIcon(
            if ("heart" in my) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
            "하트",
            tint = if ("heart" in my) HeartRed else null,
        ) { onReact("heart") }
        ActionIcon(Icons.Outlined.ChatBubbleOutline, "댓글", onClick = onComments)
        Spacer(Modifier.weight(1f))
        ActionIcon(
            if ("like" in my) Icons.Filled.ThumbUp else Icons.Outlined.ThumbUp,
            "좋아요",
            tint = if ("like" in my) MaterialTheme.colorScheme.primary else null,
        ) { onReact("like") }
        ActionIcon(
            if ("dislike" in my) Icons.Filled.ThumbDown else Icons.Outlined.ThumbDown,
            "싫어요",
        ) { onReact("dislike") }
    }
}

@Composable
private fun ActionIcon(icon: ImageVector, label: String, tint: Color? = null, onClick: () -> Unit) {
    IconButton(onClick = onClick) {
        Icon(icon, contentDescription = label, tint = tint ?: MaterialTheme.colorScheme.onSurface, modifier = Modifier.size(27.dp))
    }
}

/** "하트 3개 · 좋아요 2개 · 싫어요 1개", in bold like Instagram's like count. */
@Composable
private fun ReactionSummary(post: Post) {
    val r = post.reactions
    val parts = listOfNotNull(
        "하트 ${r.heart}개".takeIf { r.heart > 0 },
        "좋아요 ${r.like}개".takeIf { r.like > 0 },
        "싫어요 ${r.dislike}개".takeIf { r.dislike > 0 },
    )
    Text(
        if (parts.isEmpty()) "가장 먼저 하트를 눌러보세요" else parts.joinToString(" · "),
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = if (parts.isEmpty()) FontWeight.Normal else FontWeight.SemiBold,
        modifier = Modifier.padding(horizontal = 14.dp, vertical = 2.dp),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CommentsSheet(
    comments: List<Comment>,
    me: User,
    postId: Long,
    onDismiss: () -> Unit,
    onSend: (String) -> Unit,
    onDelete: (Comment) -> Unit,
) {
    var draft by rememberSaveable(postId) { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().imePadding()) {
            Text(
                "댓글",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = 8.dp),
            )
            HorizontalDivider()
            LazyColumn(
                Modifier.fillMaxWidth().heightIn(min = 160.dp, max = 440.dp),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                if (comments.isEmpty()) {
                    item {
                        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("아직 댓글이 없습니다", style = MaterialTheme.typography.titleMedium)
                            Text("댓글을 남겨보세요.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                items(comments, key = { it.id }) { comment ->
                    Row(verticalAlignment = Alignment.Top) {
                        Avatar(comment.authorName, size = 32.dp)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(comment.authorName, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                                Spacer(Modifier.width(6.dp))
                                Text(
                                    formatAgo(comment.createdAt),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Text(comment.text, style = MaterialTheme.typography.bodyMedium)
                            if (comment.authorId == me.id) {
                                Text(
                                    "삭제",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.clickable { onDelete(comment) }.padding(top = 4.dp),
                                )
                            }
                        }
                    }
                }
            }
            HorizontalDivider()
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(me.displayName, size = 36.dp)
                Spacer(Modifier.width(10.dp))
                Box(
                    Modifier
                        .weight(1f)
                        .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(22.dp))
                        .padding(horizontal = 16.dp, vertical = 11.dp),
                ) {
                    if (draft.isEmpty()) {
                        Text("${me.displayName}(으)로 댓글 달기...", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    BasicTextField(
                        value = draft,
                        onValueChange = { draft = it },
                        textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                        maxLines = 4,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                TextButton(
                    onClick = {
                        onSend(draft.trim())
                        draft = ""
                    },
                    enabled = draft.isNotBlank(),
                ) { Text("게시", fontWeight = FontWeight.SemiBold) }
            }
        }
    }
}
