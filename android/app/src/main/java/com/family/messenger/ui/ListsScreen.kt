package com.family.messenger.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
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
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.family.messenger.FamilyApp
import com.family.messenger.data.ListItem
import com.family.messenger.data.SourceMessage
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit

private data class SharedList(val key: String, val title: String, val placeholder: String)

private val LISTS = listOf(
    SharedList("shopping", "🛒 장보기", "살 것 추가 (예: 우유, 계란)"),
    SharedList("todo", "✅ 할 일", "할 일 추가 (예: 분리수거)"),
    SharedList("homework", "📚 숙제", "숙제 추가 (예: 수학 익힘책 12쪽)"),
)

private const val HOMEWORK = "homework"

/** The 숙제 tab: the homework list on its own. */
@Composable
fun HomeworkScreen(app: FamilyApp) = ListsScreen(app, keys = listOf(HOMEWORK), title = "📚 숙제")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ListsScreen(app: FamilyApp, keys: List<String> = listOf("shopping", "todo"), title: String = "함께 쓰는 목록") {
    val lists = LISTS.filter { it.key in keys }
    val viewModel: ListsViewModel = viewModel(key = keys.joinToString()) { ListsViewModel(app) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var draft by rememberSaveable { mutableStateOf("") }
    var due by rememberSaveable { mutableStateOf<String?>(null) }
    var pickDue by remember { mutableStateOf(false) }
    var source by remember { mutableStateOf<ListItem?>(null) }
    val list = lists.getOrElse(tab) { lists.first() }
    val homework = list.key == HOMEWORK
    // Homework: soonest due first among the unfinished ones.
    val items = state.items.filter { it.list == list.key }.sortedWith(
        compareBy<ListItem> { it.done }
            .thenBy { if (homework && !it.done) it.due ?: "9999" else "" }
            .thenByDescending { it.id },
    )
    val doneCount = items.count { it.done }

    fun submit() {
        if (draft.isBlank()) return
        viewModel.add(list.key, draft.trim(), if (homework) due else null)
        draft = ""
        due = null
    }

    Scaffold(topBar = { TopAppBar(title = { Text(title, style = MaterialTheme.typography.titleLarge) }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (lists.size > 1) SecondaryTabRow(
                selectedTabIndex = tab,
                indicator = {
                    TabRowDefaults.SecondaryIndicator(
                        Modifier.tabIndicatorOffset(tab),
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                },
            ) {
                lists.forEachIndexed { i, l ->
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
                if (homework) {
                    TextButton(onClick = { pickDue = true }) {
                        Text(due?.let { "~${shortDate(it)}" } ?: "마감일", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                TextButton(onClick = ::submit, enabled = draft.isNotBlank()) { Text("추가", fontWeight = FontWeight.SemiBold) }
            }
            if (homework) {
                Text(
                    "단체방에 📢 공지를 올리거나, 공지 뒤에 \"숙제\"(예: 유이숙제)라고 보내면 자동으로 들어와요.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp),
                )
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
                        ItemRow(
                            item,
                            onToggle = { viewModel.toggle(item) },
                            onDelete = { viewModel.delete(item) },
                            onSource = { source = item },
                        )
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

    if (pickDue) {
        val pickerState = rememberDatePickerState(
            initialSelectedDateMillis = (due?.let(LocalDate::parse) ?: LocalDate.now().plusDays(1))
                .atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
        )
        DatePickerDialog(
            onDismissRequest = { pickDue = false },
            confirmButton = {
                TextButton(onClick = {
                    due = pickerState.selectedDateMillis?.let { Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString() }
                    pickDue = false
                }) { Text("확인") }
            },
            dismissButton = {
                TextButton(onClick = {
                    due = null
                    pickDue = false
                }) { Text("마감 없음") }
            },
        ) { DatePicker(state = pickerState) }
    }

    source?.let { item -> SourceDialog(item, load = { viewModel.source(item) }, onDismiss = { source = null }) }
}

/** "10/20" */
private fun shortDate(date: String): String = LocalDate.parse(date).let { "${it.monthValue}/${it.dayOfMonth}" }

@Composable
private fun DueBadge(due: String, done: Boolean) {
    val days = ChronoUnit.DAYS.between(LocalDate.now(), LocalDate.parse(due))
    val label = when {
        days == 0L -> "오늘까지"
        days == 1L -> "내일까지"
        days < 0 -> "${-days}일 지남"
        else -> "${shortDate(due)}까지"
    }
    val red = MaterialTheme.colorScheme.error
    val shape = RoundedCornerShape(10.dp)
    val modifier = when {
        done -> Modifier.background(MaterialTheme.colorScheme.surfaceVariant, shape)
        days < 0 -> Modifier.border(1.dp, red, shape)
        days <= 1 -> Modifier.background(red, shape)
        else -> Modifier.background(MaterialTheme.colorScheme.surfaceVariant, shape)
    }
    val color = when {
        done -> MaterialTheme.colorScheme.onSurfaceVariant
        days < 0 -> red
        days <= 1 -> Color.White
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Text(
        label,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
        color = color,
        modifier = modifier.padding(horizontal = 7.dp, vertical = 1.dp),
    )
}

/** The chat notice a homework item was taken from. */
@Composable
private fun SourceDialog(item: ListItem, load: suspend () -> List<SourceMessage>, onDismiss: () -> Unit) {
    var messages by remember { mutableStateOf<List<SourceMessage>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(item.id) {
        try {
            messages = load()
        } catch (e: Exception) {
            error = e.message
        }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("원본 메시지") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                if (messages == null && error == null) Text("불러오는 중…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                messages?.forEach { m ->
                    Text(
                        "${m.senderName} · ${formatAgo(m.createdAt)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        m.text.orEmpty(),
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 4.dp, bottom = 10.dp)
                            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(12.dp))
                            .padding(10.dp),
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("닫기") } },
    )
}

@Composable
private fun ItemRow(item: ListItem, onToggle: () -> Unit, onDelete: () -> Unit, onSource: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onToggle)
            .padding(start = 4.dp, end = 4.dp, top = 2.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked = item.done, onCheckedChange = { onToggle() })
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                item.due?.let {
                    DueBadge(it, item.done)
                    Spacer(Modifier.width(6.dp))
                }
                Text(
                    item.text,
                    style = MaterialTheme.typography.bodyLarge,
                    textDecoration = if (item.done) TextDecoration.LineThrough else null,
                    color = if (item.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f, fill = false),
                )
            }
            val who = if (item.list == HOMEWORK && item.assigneeName != null) "${item.assigneeName} · " else ""
            Text(
                if (item.done && item.doneByName != null) "${item.doneByName} 완료"
                else "$who${item.authorName} ${if (item.fromChat) "단체방에서" else "추가"} · ${formatAgo(item.createdAt)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (item.fromChat) {
            TextButton(onClick = onSource) { Text("원본", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        IconButton(onClick = onDelete) {
            Icon(Icons.Outlined.Close, contentDescription = "삭제", tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
