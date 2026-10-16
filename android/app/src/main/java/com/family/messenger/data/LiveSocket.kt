package com.family.messenger.data

import okhttp3.WebSocket

/** The live connection kept open by MessageService, so other parts of the app can send on it. */
object LiveSocket {
    @Volatile
    var socket: WebSocket? = null

    /** Returns false when not connected. */
    fun send(text: String): Boolean = socket?.send(text) ?: false
}
