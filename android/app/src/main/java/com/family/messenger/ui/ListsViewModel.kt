package com.family.messenger.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.family.messenger.FamilyApp
import com.family.messenger.data.ListItem
import com.family.messenger.data.MessageBus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.launch

/** The shared shopping, to-do and homework lists. Changes from anyone show up for everyone right away. */
class ListsViewModel(application: Application) : AndroidViewModel(application) {
    data class State(
        val items: List<ListItem> = emptyList(),
        val loading: Boolean = true,
        val error: String? = null,
    )

    private val app = application as FamilyApp
    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        refresh()
        viewModelScope.launch {
            merge(MessageBus.listsChanged, MessageBus.connected.filter { it }.map { }).collect { refresh() }
        }
    }

    fun refresh() = action { _state.value = _state.value.copy(items = app.api.listItems(), loading = false) }

    fun add(list: String, text: String, due: String? = null) = action {
        app.api.addListItem(list, text, due)
        refresh()
    }

    fun toggle(item: ListItem) {
        // Flip it on screen immediately; the server confirms.
        _state.value = _state.value.copy(items = _state.value.items.map { if (it.id == item.id) it.copy(done = !it.done) else it })
        action {
            app.api.setListItemDone(item.id, !item.done)
            refresh()
        }
    }

    fun delete(item: ListItem) = action {
        app.api.deleteListItem(item.id)
        refresh()
    }

    fun clearDone(list: String) = action {
        app.api.clearDoneItems(list)
        refresh()
    }

    /** The chat messages a homework item came from. */
    suspend fun source(item: ListItem) = app.api.listItemSource(item.id).messages

    private fun action(block: suspend () -> Unit) = viewModelScope.launch {
        try {
            block()
            _state.value = _state.value.copy(error = null)
        } catch (e: Exception) {
            _state.value = _state.value.copy(loading = false, error = e.message)
        }
    }
}
