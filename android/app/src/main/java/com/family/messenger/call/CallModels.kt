package com.family.messenger.call

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** The other person in a call. */
@Serializable
data class CallPeer(val id: Long, val displayName: String = "")

/** A call signal from the server: { type: "call", action, callId, ... } (see server/src/calls.js). */
@Serializable
data class CallSignal(
    val type: String,
    val action: String,
    val callId: String = "",
    val video: Boolean = false,
    val from: CallPeer? = null,
    val sdp: String? = null,
    val candidate: JsonObject? = null,
    val except: String? = null,
    val message: String? = null,
    /** On "renegotiate": "offer" or "answer". */
    val kind: String? = null,
    /** On "media": the other person's microphone / camera is off. */
    val muted: Boolean = false,
    val cameraOff: Boolean = false,
)

/** A call still ringing for me, e.g. after the app reconnects. */
@Serializable
data class PendingCall(
    val callId: String,
    val from: CallPeer,
    val video: Boolean,
    val sdp: String,
    val candidates: List<JsonObject> = emptyList(),
)

@Serializable
data class IceServerInfo(
    /** A single URL or a list of URLs. */
    val urls: JsonElement,
    val username: String? = null,
    val credential: String? = null,
)

@Serializable
data class IceConfig(val iceServers: List<IceServerInfo> = emptyList(), val relay: Boolean = false)
