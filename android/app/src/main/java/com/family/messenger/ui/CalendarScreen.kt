package com.family.messenger.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.AddBox
import androidx.compose.material.icons.outlined.Cake
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.family.messenger.FamilyApp
import com.family.messenger.data.CalendarEvent
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

private val SundayRed = Color(0xFFE53935)
private val SaturdayBlue = Color(0xFF1E88E5)
private val dayTitle = DateTimeFormatter.ofPattern("M월 d일 EEEE", Locale.KOREAN)
private val shortDay = DateTimeFormatter.ofPattern("M/d (E)", Locale.KOREAN)

/** Shared family calendar: month grid with dots, the chosen day's events, and what's coming up. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CalendarScreen(app: FamilyApp) {
    val viewModel: CalendarViewModel = viewModel { CalendarViewModel(app) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val today = LocalDate.now()
    var month by rememberSaveable { mutableStateOf(YearMonth.from(today).toString()) }
    var selected by rememberSaveable { mutableStateOf(today.toString()) }
    // null: closed; NEW_EVENT: adding; otherwise the id being edited.
    var editing by rememberSaveable { mutableStateOf<Long?>(null) }
    val shownMonth = YearMonth.parse(month)
    val selectedDay = LocalDate.parse(selected)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("가족 일정", style = MaterialTheme.typography.titleLarge) },
                actions = {
                    IconButton(onClick = {
                        viewModel.clearError()
                        editing = NEW_EVENT
                    }) { Icon(Icons.Outlined.AddBox, contentDescription = "일정 추가", modifier = Modifier.size(28.dp)) }
                },
            )
        },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(bottom = 24.dp)) {
            item {
                MonthHeader(
                    month = shownMonth,
                    onPrev = { month = shownMonth.minusMonths(1).toString() },
                    onNext = { month = shownMonth.plusMonths(1).toString() },
                    onToday = {
                        month = YearMonth.from(today).toString()
                        selected = today.toString()
                    },
                )
                MonthGrid(shownMonth, today, selectedDay, state) { selected = it.toString() }
                HorizontalDivider(Modifier.padding(top = 8.dp))
                Text(
                    selectedDay.format(dayTitle),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(start = 16.dp, top = 14.dp, bottom = 4.dp),
                )
            }
            state.error?.let { item { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp)) } }
            val dayEvents = state.on(selectedDay)
            if (dayEvents.isEmpty()) {
                item {
                    Text(
                        "일정이 없어요. 오른쪽 위 + 로 추가하세요.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }
            }
            items(dayEvents, key = { "day-${it.id}" }) { event ->
                EventRow(event, label = event.time ?: "하루 종일", day = selectedDay) { editing = event.id }
            }
            val upcoming = state.upcoming(today).filter { (day, _) -> day != selectedDay }
            if (upcoming.isNotEmpty()) {
                item {
                    Text(
                        "다가오는 일정",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(start = 16.dp, top = 20.dp, bottom = 4.dp),
                    )
                }
                items(upcoming, key = { (day, e) -> "up-$day-${e.id}" }) { (day, event) ->
                    EventRow(event, label = day.format(shortDay), day = day) {
                        month = YearMonth.from(day).toString()
                        selected = day.toString()
                    }
                }
            }
        }
    }

    editing?.let { id ->
        val event = state.events.firstOrNull { it.id == id }
        if (id == NEW_EVENT || event != null) {
            EventEditor(
                event = event,
                initialDate = selectedDay,
                saving = state.saving,
                error = state.error,
                onDismiss = { editing = null },
                onSave = { title, date, time, note, yearly ->
                    viewModel.save(event?.id, title, date, time, note, yearly) {
                        editing = null
                        month = YearMonth.from(date).toString()
                        selected = date.toString()
                    }
                },
                onDelete = { e -> viewModel.delete(e) { editing = null } },
            )
        }
    }
}

private const val NEW_EVENT = 0L

@Composable
private fun MonthHeader(month: YearMonth, onPrev: () -> Unit, onNext: () -> Unit, onToday: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onPrev) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = "이전 달") }
        Text(
            "${month.year}년 ${month.monthValue}월",
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.weight(1f),
        )
        TextButton(onClick = onToday) { Text("오늘") }
        IconButton(onClick = onNext) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "다음 달") }
    }
}

@Composable
private fun MonthGrid(
    month: YearMonth,
    today: LocalDate,
    selected: LocalDate,
    state: CalendarViewModel.State,
    onSelect: (LocalDate) -> Unit,
) {
    val weekdays = listOf("일", "월", "화", "수", "목", "금", "토")
    // Sunday-first grid: blanks before the 1st, then the days of the month.
    val lead = month.atDay(1).dayOfWeek.value % 7
    val cells = List(lead) { null } + (1..month.lengthOfMonth()).map { month.atDay(it) }
    Column(Modifier.padding(horizontal = 8.dp)) {
        Row {
            weekdays.forEachIndexed { i, w ->
                Text(
                    w,
                    modifier = Modifier.weight(1f).padding(vertical = 6.dp),
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.labelMedium,
                    color = when (i) {
                        0 -> SundayRed
                        6 -> SaturdayBlue
                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }
        }
        cells.chunked(7).forEach { week ->
            Row {
                week.forEach { day -> DayCell(day, today, selected, state, onSelect, Modifier.weight(1f)) }
                repeat(7 - week.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun DayCell(
    day: LocalDate?,
    today: LocalDate,
    selected: LocalDate,
    state: CalendarViewModel.State,
    onSelect: (LocalDate) -> Unit,
    modifier: Modifier,
) {
    Box(modifier.aspectRatio(1f), contentAlignment = Alignment.Center) {
        if (day == null) return@Box
        val isSelected = day == selected
        val events = state.on(day)
        Column(
            Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(if (isSelected) MaterialTheme.colorScheme.onSurface else Color.Transparent)
                .then(if (day == today && !isSelected) Modifier.border(1.dp, MaterialTheme.colorScheme.onSurface, CircleShape) else Modifier)
                .clickable { onSelect(day) },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                day.dayOfMonth.toString(),
                fontWeight = if (day == today) FontWeight.Bold else FontWeight.Normal,
                color = when {
                    isSelected -> MaterialTheme.colorScheme.surface
                    day.dayOfWeek.value == 7 -> SundayRed
                    day.dayOfWeek.value == 6 -> SaturdayBlue
                    else -> MaterialTheme.colorScheme.onSurface
                },
            )
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.height(6.dp)) {
                events.take(3).forEach { e ->
                    Box(
                        Modifier
                            .padding(top = 2.dp)
                            .size(4.dp)
                            .background(if (e.yearly) HeartRed else MaterialTheme.colorScheme.primary, CircleShape),
                    )
                }
            }
        }
    }
}

@Composable
private fun EventRow(event: CalendarEvent, label: String, day: LocalDate, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .width(4.dp)
                .height(40.dp)
                .background(if (event.yearly) HeartRed else MaterialTheme.colorScheme.primary, RoundedCornerShape(2.dp)),
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (event.yearly) {
                    Icon(Icons.Outlined.Cake, contentDescription = "매년", tint = HeartRed, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                }
                Text(event.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
            }
            val years = if (event.yearly) day.year - LocalDate.parse(event.date).year else 0
            Text(
                listOfNotNull(
                    label,
                    if (years > 0) "${years}주년" else null,
                    event.note.ifBlank { null },
                    "${event.authorName} 등록",
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EventEditor(
    event: CalendarEvent?,
    initialDate: LocalDate,
    saving: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onSave: (String, LocalDate, String?, String, Boolean) -> Unit,
    onDelete: (CalendarEvent) -> Unit,
) {
    var title by rememberSaveable { mutableStateOf(event?.title.orEmpty()) }
    var date by rememberSaveable { mutableStateOf(event?.date ?: initialDate.toString()) }
    var time by rememberSaveable { mutableStateOf(event?.time) }
    var note by rememberSaveable { mutableStateOf(event?.note.orEmpty()) }
    var yearly by rememberSaveable { mutableStateOf(event?.yearly ?: false) }
    var pickDate by remember { mutableStateOf(false) }
    var pickTime by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val day = LocalDate.parse(date)

    AlertDialog(
        onDismissRequest = { if (!saving) onDismiss() },
        title = { Text(if (event == null) "일정 추가" else "일정 수정") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("제목 (예: 엄마 생일, 치과)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedButton(onClick = { pickDate = true }, modifier = Modifier.fillMaxWidth()) {
                    Text("날짜: ${day.year}년 ${day.format(dayTitle)}")
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(onClick = { pickTime = true }, modifier = Modifier.weight(1f)) {
                        Text(time?.let { "시간: $it" } ?: "시간: 하루 종일")
                    }
                    if (time != null) TextButton(onClick = { time = null }) { Text("지우기") }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("매년 반복")
                        Text("생일·기념일", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(checked = yearly, onCheckedChange = { yearly = it })
                }
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it },
                    label = { Text("메모 (선택)") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    "전날과 당일 아침 9시에 가족 모두에게 알림이 가요.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                if (event != null) {
                    TextButton(onClick = { confirmDelete = true }) { Text("일정 삭제", color = MaterialTheme.colorScheme.error) }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(title.trim(), day, time, note.trim(), yearly) }, enabled = !saving && title.isNotBlank()) {
                Text("저장", fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !saving) { Text("취소") } },
    )

    if (pickDate) {
        val pickerState = rememberDatePickerState(
            initialSelectedDateMillis = day.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
        )
        DatePickerDialog(
            onDismissRequest = { pickDate = false },
            confirmButton = {
                TextButton(onClick = {
                    pickerState.selectedDateMillis?.let {
                        date = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString()
                    }
                    pickDate = false
                }) { Text("확인") }
            },
            dismissButton = { TextButton(onClick = { pickDate = false }) { Text("취소") } },
        ) { DatePicker(state = pickerState) }
    }

    if (pickTime) {
        val (h, m) = (time ?: "09:00").split(":").map(String::toInt)
        val timeState = rememberTimePickerState(initialHour = h, initialMinute = m, is24Hour = false)
        AlertDialog(
            onDismissRequest = { pickTime = false },
            title = { Text("시간 선택") },
            text = { TimePicker(state = timeState) },
            confirmButton = {
                TextButton(onClick = {
                    time = "%02d:%02d".format(timeState.hour, timeState.minute)
                    pickTime = false
                }) { Text("확인") }
            },
            dismissButton = { TextButton(onClick = { pickTime = false }) { Text("취소") } },
        )
    }

    if (confirmDelete && event != null) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("일정을 삭제할까요?") },
            text = { Text("가족 모두의 캘린더에서 사라져요.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    onDelete(event)
                }) { Text("삭제", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("취소") } },
        )
    }
}
