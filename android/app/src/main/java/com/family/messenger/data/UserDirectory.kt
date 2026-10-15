package com.family.messenger.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Everyone in the family, by id, so any screen can show current names and profile photos. */
class UserDirectory(private val api: Api, private val session: Session) {
    private val _users = MutableStateFlow<Map<Long, User>>(emptyMap())
    val users: StateFlow<Map<Long, User>> = _users.asStateFlow()

    suspend fun refresh() {
        runCatching { api.users() }.onSuccess { list ->
            _users.value = list.associateBy { it.id }
            list.forEach(session::updateUser)
        }
    }

    fun update(user: User) {
        _users.value = _users.value + (user.id to user)
        session.updateUser(user)
    }

    fun clear() {
        _users.value = emptyMap()
    }
}
