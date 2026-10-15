package com.family.messenger.ui

import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Collections
import androidx.compose.material.icons.filled.GridOn
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.AddBox
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import com.family.messenger.FamilyApp
import com.family.messenger.data.MessageBus
import com.family.messenger.data.Post
import com.family.messenger.data.User
import com.family.messenger.service.Notifications

private const val NEW_POST = 0L

/** Story tab: an Instagram-profile-style grid; tapping a tile opens the post. */
@Composable
fun FeedScreen(app: FamilyApp, me: User) {
    val viewModel: FeedViewModel = viewModel { FeedViewModel(app) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    var openPostId by rememberSaveable { mutableStateOf<Long?>(null) }
    // null: editor closed, NEW_POST: writing a new post, otherwise the id of the post being edited.
    var editorFor by rememberSaveable { mutableStateOf<Long?>(null) }

    DisposableEffect(Unit) {
        MessageBus.activeConversation.value = MessageBus.FEED
        Notifications.cancel(app, MessageBus.FEED)
        onDispose {
            if (MessageBus.activeConversation.value == MessageBus.FEED) MessageBus.activeConversation.value = null
        }
    }

    val openPost = state.posts.firstOrNull { it.id == openPostId }
    // The open post was deleted (by me or someone else): go back to the grid.
    LaunchedEffect(openPostId, openPost == null, state.loading) {
        if (openPostId != null && openPost == null && !state.loading) openPostId = null
    }

    if (openPost != null) {
        BackHandler { openPostId = null }
        PostDetailScreen(
            app = app,
            viewModel = viewModel,
            post = openPost,
            me = me,
            onBack = { openPostId = null },
            onEdit = {
                viewModel.clearError()
                editorFor = openPost.id
            },
        )
    } else {
        StoryGrid(
            state = state,
            onOpen = { openPostId = it.id },
            onNew = {
                viewModel.clearError()
                editorFor = NEW_POST
            },
            onRefresh = { viewModel.refresh() },
            onLoadOlder = { viewModel.loadOlder() },
            app = app,
        )
    }

    val editing = state.posts.firstOrNull { it.id == editorFor }
    // The post being edited was deleted meanwhile: close the editor.
    LaunchedEffect(editorFor, editing == null) {
        if (editorFor != null && editorFor != NEW_POST && editing == null) editorFor = null
    }
    if (editorFor == NEW_POST || editing != null) {
        PostEditor(
            editing = editing,
            posting = state.posting,
            progress = state.progress,
            error = state.error,
            app = app,
            onDismiss = { editorFor = null },
            onSubmit = { text, drafts -> viewModel.save(editing, text, drafts) { editorFor = null } },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StoryGrid(
    state: FeedViewModel.State,
    onOpen: (Post) -> Unit,
    onNew: () -> Unit,
    onRefresh: () -> Unit,
    onLoadOlder: () -> Unit,
    app: FamilyApp,
) {
    val grid = rememberLazyGridState()
    // Load the next page as the user nears the bottom, like an endless Instagram grid.
    val nearEnd by remember {
        derivedStateOf {
            val last = grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= grid.layoutInfo.totalItemsCount - 6
        }
    }
    LaunchedEffect(nearEnd, state.hasOlder, state.posts.size) {
        if (nearEnd && state.hasOlder) onLoadOlder()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("가족 스토리", style = MaterialTheme.typography.titleLarge) },
                actions = {
                    IconButton(onClick = onNew) {
                        Icon(Icons.Outlined.AddBox, contentDescription = "새 게시물", modifier = Modifier.size(28.dp))
                    }
                },
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.loading && state.posts.isNotEmpty(),
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyVerticalGrid(
                columns = GridCells.Fixed(3),
                state = grid,
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
                contentPadding = PaddingValues(bottom = 16.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                item(span = { GridItemSpan(maxLineSpan) }) { ProfileHeader(state, onNew) }
                state.error?.let { error ->
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp))
                    }
                }
                items(state.posts, key = { it.id }) { post ->
                    GridTile(app, post) { onOpen(post) }
                }
                if (!state.loading && state.posts.isEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }) { EmptyGrid(onNew) }
                }
            }
            if (state.loading && state.posts.isEmpty()) CircularProgressIndicator(Modifier.align(Alignment.Center))
        }
    }
}

/** Like the top of an Instagram profile: ringed avatar, counts, name, then the grid tab icon. */
@Composable
private fun ProfileHeader(state: FeedViewModel.State, onNew: () -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Avatar("우리 가족", isGroup = true, size = 86.dp, ring = true)
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.SpaceEvenly) {
                Stat(state.summary?.posts ?: state.posts.size, "게시물")
                Stat(state.summary?.members, "가족")
            }
        }
        Text(
            "우리 가족",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
        Text(
            "우리끼리 나누는 사진과 이야기",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
        Button(
            onClick = onNew,
            shape = MaterialTheme.shapes.small,
            contentPadding = PaddingValues(vertical = 6.dp),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp).height(36.dp),
        ) { Text("새 게시물 올리기", fontWeight = FontWeight.SemiBold) }
        HorizontalDivider()
        Box(Modifier.fillMaxWidth().padding(vertical = 10.dp), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.GridOn, contentDescription = null)
        }
    }
}

@Composable
private fun Stat(value: Int?, label: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value?.toString() ?: "-", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun GridTile(app: FamilyApp, post: Post, onClick: () -> Unit) {
    val cover = post.media.firstOrNull()
    Box(
        Modifier
            .aspectRatio(1f)
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .clickable(onClick = onClick),
    ) {
        if (cover != null) {
            AsyncImage(
                model = app.api.url(cover.posterUrl ?: cover.url),
                contentDescription = post.text.ifBlank { "${post.authorName}의 게시물" },
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            val badge = when {
                post.media.size > 1 -> Icons.Filled.Collections
                cover.isVideo -> Icons.Filled.PlayArrow
                else -> null
            }
            if (badge != null) {
                Icon(
                    badge,
                    contentDescription = if (post.media.size > 1) "여러 장" else "동영상",
                    tint = Color.White,
                    modifier = Modifier.align(Alignment.TopEnd).padding(6.dp).size(20.dp),
                )
            }
        } else {
            // Text-only post: show the words on a colored tile.
            Box(
                Modifier.fillMaxSize().background(StoryGradient).padding(10.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    post.text,
                    color = Color.White,
                    style = TextStyle(
                        fontWeight = FontWeight.SemiBold,
                        shadow = Shadow(Color.Black.copy(alpha = 0.25f), blurRadius = 4f),
                    ),
                    textAlign = TextAlign.Center,
                    maxLines = 4,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun EmptyGrid(onNew: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Outlined.AddBox, contentDescription = null, modifier = Modifier.size(56.dp))
        Spacer(Modifier.height(12.dp))
        Text("첫 게시물을 올려보세요", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(4.dp))
        Text(
            "가족과 나누고 싶은 사진과 이야기를 올려보세요.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "첫 게시물 올리기",
            color = MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.clickable(onClick = onNew).padding(8.dp),
        )
    }
}
