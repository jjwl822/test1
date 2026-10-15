package com.family.messenger.ui

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
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import com.family.messenger.FamilyApp
import com.family.messenger.data.Post

private const val MAX_MEDIA = 10

/** Full-screen editor for a new post, or for changing [editing]'s text and photos/videos. */
@Composable
fun PostEditor(
    editing: Post?,
    posting: Boolean,
    progress: String?,
    error: String?,
    app: FamilyApp,
    onDismiss: () -> Unit,
    onSubmit: (String, List<MediaDraft>) -> Unit,
) {
    var text by rememberSaveable { mutableStateOf(editing?.text.orEmpty()) }
    // Saved as strings so the list survives rotation: existing media by name, picked items by uri.
    val draftSaver = remember(editing) {
        listSaver<MutableState<List<MediaDraft>>, String>(
            save = { state -> state.value.map { it.key } },
            restore = { keys ->
                mutableStateOf(
                    keys.mapNotNull { key ->
                        when {
                            key.startsWith("e:") -> editing?.media?.firstOrNull { it.name == key.drop(2) }?.let(MediaDraft::Existing)
                            else -> MediaDraft.Local(Uri.parse(key.drop(2)))
                        }
                    },
                )
            },
        )
    }
    var drafts by rememberSaveable(saver = draftSaver) {
        mutableStateOf(editing?.media.orEmpty().map(MediaDraft::Existing))
    }
    var notice by remember { mutableStateOf<String?>(null) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(MAX_MEDIA)) { uris ->
        val all = (drafts + uris.map(MediaDraft::Local)).distinctBy { it.key }
        notice = if (all.size > MAX_MEDIA) "사진과 동영상은 ${MAX_MEDIA}개까지 올릴 수 있어요." else null
        drafts = all.take(MAX_MEDIA)
    }
    val openPicker = { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) }
    val canSubmit = !posting && (text.isNotBlank() || drafts.isNotEmpty())

    Dialog(
        onDismissRequest = { if (!posting) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.surface)
                .systemBarsPadding()
                .imePadding(),
        ) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onDismiss, enabled = !posting) { Icon(Icons.Filled.Close, contentDescription = "닫기") }
                Text(
                    if (editing != null) "정보 수정" else "새 게시물",
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.weight(1f),
                )
                if (posting) {
                    CircularProgressIndicator(Modifier.padding(horizontal = 16.dp).size(22.dp), strokeWidth = 2.dp)
                } else {
                    TextButton(onClick = { onSubmit(text.trim(), drafts) }, enabled = canSubmit) {
                        Text(if (editing != null) "완료" else "공유", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                    }
                }
            }
            if (posting) LinearProgressIndicator(Modifier.fillMaxWidth())
            HorizontalDivider()

            progress?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }

            LazyRow(
                contentPadding = PaddingValues(16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                itemsIndexed(drafts, key = { _, d -> d.key }) { index, draft ->
                    DraftTile(app, draft, index, removable = !posting) { drafts = drafts - draft }
                }
                if (drafts.size < MAX_MEDIA && !posting) {
                    item {
                        Column(
                            Modifier
                                .size(110.dp)
                                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(6.dp))
                                .clickable(onClick = openPicker),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) {
                            Icon(Icons.Filled.AddPhotoAlternate, contentDescription = null, modifier = Modifier.size(32.dp))
                            Spacer(Modifier.size(4.dp))
                            Text("사진·동영상", style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
            }
            Text(
                "${drafts.size}/$MAX_MEDIA · 올릴 때 자동으로 크기를 줄여요",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            notice?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp))
            }
            Spacer(Modifier.size(12.dp))
            HorizontalDivider()

            Box(Modifier.fillMaxWidth().heightIn(min = 140.dp).padding(16.dp)) {
                if (text.isEmpty()) {
                    Text("문구를 입력하세요...", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge)
                }
                BasicTextField(
                    value = text,
                    onValueChange = { text = it },
                    enabled = !posting,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            HorizontalDivider()
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp)) }
        }
    }
}

@Composable
private fun DraftTile(app: FamilyApp, draft: MediaDraft, index: Int, removable: Boolean, onRemove: () -> Unit) {
    val context = LocalContext.current
    val (model, isVideo) = when (draft) {
        is MediaDraft.Existing -> app.api.url(draft.media.posterUrl ?: draft.media.url) to draft.media.isVideo
        is MediaDraft.Local -> draft.uri to remember(draft.uri) {
            context.contentResolver.getType(draft.uri)?.startsWith("video/") == true
        }
    }
    Box(Modifier.size(110.dp)) {
        AsyncImage(
            model = model,
            contentDescription = "선택한 항목 ${index + 1}",
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(6.dp)),
        )
        if (isVideo) {
            Icon(
                Icons.Filled.PlayCircle,
                contentDescription = null,
                tint = Color.White.copy(alpha = 0.9f),
                modifier = Modifier.align(Alignment.Center).size(36.dp),
            )
        }
        if (index == 0) {
            Text(
                "대표",
                color = Color.White,
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(6.dp)
                    .background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(4.dp))
                    .padding(horizontal = 6.dp, vertical = 2.dp),
            )
        }
        if (removable) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(4.dp)
                    .size(24.dp)
                    .background(Color.Black.copy(alpha = 0.6f), CircleShape)
                    .clickable(onClick = onRemove),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Close, contentDescription = "빼기", tint = Color.White, modifier = Modifier.size(16.dp))
            }
        }
    }
}
