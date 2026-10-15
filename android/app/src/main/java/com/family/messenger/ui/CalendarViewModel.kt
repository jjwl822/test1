package com.family.messenger.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.family.messenger.FamilyApp
import com.family.messenger.data.CalendarEvent
import com.family.messenger.data.MessageBus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.launch
import java.time.LocalDate

class CalendarViewModel(application: Application) : AndroidViewModel(application) {
    data class State(
        val events: List<CalendarEvent> = emptyList(),
        val loading: Boolean = true,
        val saving: Boolean = false,
        val error: String? = null,
    ) {
        /** Events on [day]; yearly ones (birthdays) show up every year from their first date on. */
        fun on(day: LocalDate): List<CalendarEvent> = events
            .filter { e ->
                val date = LocalDate.parse(e.date)
                date == day || (e.yearly && date.monthValue == day.monthValue && date.dayOfMonth == day.dayOfMonth && !day.isBefore(date))
            }
            .sortedBy { it.time ?: "" }

        /** The next [count] days that have something on, starting today. */
        fun upcoming(from: LocalDate, count: Int = 5, horizonDays: Long = 365): List<Pair<LocalDate, CalendarEvent>> {
            val result = mutableListOf<Pair<LocalDate, CalendarEvent>>()
            var day = from
            while (result.size < count && day.isBefore(from.plusDays(horizonDays))) {
                on(day).forEach { result += day to it }
                day = day.plusDays(1)
            }
            return result.take(count)
        }
    }

    private val app = application as FamilyApp
    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        refresh()
        viewModelScope.launch {
            merge(MessageBus.eventsChanged, MessageBus.connected.filter { it }.map { }).collect { refresh() }
        }
    }

    fun refresh() = viewModelScope.launch {
        try {
            _state.value = _state.value.copy(events = app.api.events(), loading = false, error = null)
        } catch (e: Exception) {
            _state.value = _state.value.copy(loading = false, error = e.message)
        }
    }

    fun save(
        id: Long?,
        title: String,
        date: LocalDate,
        time: String?,
        note: String,
        yearly: Boolean,
        onDone: () -> Unit,
    ) = viewModelScope.launch {
        _state.value = _state.value.copy(saving = true, error = null)
        try {
            app.api.saveEvent(id, title, date.toString(), time, note, yearly)
            onDone()
            refresh()
        } catch (e: Exception) {
            _state.value = _state.value.copy(error = e.message)
        } finally {
            _state.value = _state.value.copy(saving = false)
        }
    }

    fun delete(event: CalendarEvent, onDone: () -> Unit) = viewModelScope.launch {
        try {
            app.api.deleteEvent(event.id)
            onDone()
            refresh()
        } catch (e: Exception) {
            _state.value = _state.value.copy(error = e.message)
        }
    }

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }
}
