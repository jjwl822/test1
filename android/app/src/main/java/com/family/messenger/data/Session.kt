package com.family.messenger.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.encodeToString

/** Stores the logged-in user and server address in SharedPreferences. */
class Session(context: Context) {

    data class Auth(val serverUrl: String, val token: String, val user: User)

    private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)
    private val _auth = MutableStateFlow(load())
    val auth: StateFlow<Auth?> = _auth.asStateFlow()

    /** Last server address typed on the login screen, to prefill it next time. */
    val lastServerUrl: String get() = prefs.getString(KEY_SERVER, "").orEmpty()

    fun save(serverUrl: String, response: AuthResponse) {
        prefs.edit()
            .putString(KEY_SERVER, serverUrl)
            .putString(KEY_TOKEN, response.token)
            .putString(KEY_USER, Api.json.encodeToString(response.user))
            .apply()
        _auth.value = Auth(serverUrl, response.token, response.user)
    }

    fun clear() {
        prefs.edit().remove(KEY_TOKEN).remove(KEY_USER).apply()
        _auth.value = null
    }

    private fun load(): Auth? {
        val server = prefs.getString(KEY_SERVER, null) ?: return null
        val token = prefs.getString(KEY_TOKEN, null) ?: return null
        val user = prefs.getString(KEY_USER, null)
            ?.let { runCatching { Api.json.decodeFromString<User>(it) }.getOrNull() }
            ?: return null
        return Auth(server, token, user)
    }

    private companion object {
        const val KEY_SERVER = "server_url"
        const val KEY_TOKEN = "token"
        const val KEY_USER = "user"
    }
}
