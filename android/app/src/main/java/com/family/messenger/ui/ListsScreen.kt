package com.family.messenger.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SecondaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.family.messenger.FamilyApp
import com.family.messenger.data.ListItem

private data class SharedList(val key: String, val title: String, val placeholder: String)

private val LISTS = listOf(
    SharedList("shopping", "🛒 장보기", "살 것 추가 (예: 우유, 계란)"),
    SharedList("todo", "✅ 할 일", "할 일 추가 (예: 분리수거)"),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ListsScreen(app: FamilyApp) {
    val viewModel: ListsViewModel = viewModel { ListsViewModel(app) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var draft by rememberSaveable { mutableStateOf("") }
    val list = LISTS[tab]
    val items = state.items.filter { it.list == list.key }.sortedWith(compareBy<ListItem> { it.done }.thenByDescending { it.id })
    val doneCount = items.count { it.done }

    fun submit() {
        if (draft.isBlank()) return
        viewModel.add(list.key, draft.trim())
        draft = ""
    }

    Scaffold(topBar = { TopAppBar(title = { Text("함께 쓰는 목록", style = MaterialTheme.typography.titleLarge) }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            SecondaryTabRow(
                selectedTabIndex = tab,
                indicator = {
                    TabRowDefaults.SecondaryIndicator(
                        Modifier.tabIndicatorOffset(tab),
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                },
            ) {
                LISTS.forEachIndexed { i, l ->
                    val open = state.items.count { it.list == l.key && !it.done }
                    Tab(
                        selected = tab == i,
                        onClick = { tab = i },
                        text = { Text(if (open > 0) "${l.title} $open" else l.title, fontWeight = FontWeight.SemiBold) },
                    )
                }
            }
            Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    placeholder = { Text(list.placeholder) },
                    singleLine = true,
                    shape = RoundedCornerShape(24.dp),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { submit() }),
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = ::submit, enabled = draft.isNotBlank()) { Text("추가", fontWeight = FontWeight.SemiBold) }
            }
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp)) }
            PullToRefreshBox(
                isRefreshing = false,
                onRefresh = { viewModel.refresh() },
                modifier = Modifier.weight(1f),
            ) {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
                    if (items.isEmpty() && !state.loading) {
                        item {
                            Text(
                                "아직 비어 있어요. 위에서 추가하면 가족 모두에게 바로 보여요.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(16.dp),
                            )
                        }
                    }
                    items(items, key = { it.id }) { item ->
                        ItemRow(item, onToggle = { viewModel.toggle(item) }, onDelete = { viewModel.delete(item) })
                        HorizontalDivider(Modifier.padding(start = 56.dp))
                    }
                    if (doneCount > 0) {
                        item {
                            TextButton(onClick = { viewModel.clearDone(list.key) }, modifier = Modifier.padding(8.dp)) {
                                Text("완료한 항목 ${doneCount}개 지우기", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ItemRow(item: ListItem, onToggle: () -> Unit, onDelete: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onToggle)
            .padding(start = 4.dp, end = 4.dp, top = 2.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked = item.done, onCheckedChange = { onToggle() })
        Column(Modifier.weight(1f)) {
            Text(
                item.text,
                style = MaterialTheme.typography.bodyLarge,
                textDecoration = if (item.done) TextDecoration.LineThrough else null,
                color = if (item.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
            )
            Text(
                if (item.done && item.doneByName != null) "${item.doneByName} 완료" else "${item.authorName} 추가 · ${formatAgo(item.createdAt)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(onClick = onDelete) {
            Icon(Icons.Outlined.Close, contentDescription = "삭제", tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
