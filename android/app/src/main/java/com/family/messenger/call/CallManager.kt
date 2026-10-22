package com.family.messenger.call

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import com.family.messenger.FamilyApp
import com.family.messenger.data.Api
import com.family.messenger.data.LiveSocket
import com.family.messenger.service.Notifications
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RTCStatsReport
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * 1:1 voice/video calls. Audio and video go phone to phone with WebRTC (or through Cloudflare's
 * relay); the family server only passes the call signals along over the live connection.
 * Talks the same protocol as the web app (server/web/js/call.js), so Android and iPhone can call
 * each other.
 */
@SuppressLint("StaticFieldLeak") // holds the application context only
object CallManager {
    enum class Status { IDLE, OUTGOING, INCOMING, CONNECTING, ACTIVE, ENDED }

    data class State(
        val status: Status = Status.IDLE,
        val callId: String = "",
        val peer: CallPeer? = null,
        val video: Boolean = false,
        val muted: Boolean = false,
        val cameraOff: Boolean = false,
        /** Where the sound goes: earpiece, loudspeaker or a headset. */
        val route: CallAudio.Route = CallAudio.Route.EARPIECE,
        /** A Bluetooth / wired headset is connected (so it can be picked). */
        val headsetAvailable: Boolean = false,
        /** Connection quality while the call is up: 3 good, 2 fair, 1 weak, 0 unknown. */
        val quality: Int = 0,
        val startedAt: Long? = null,
        val message: String? = null,
        /** The connection dropped (e.g. Wi-Fi → LTE) and is being restored. */
        val reconnecting: Boolean = false,
        val peerMuted: Boolean = false,
        val peerCameraOff: Boolean = false,
    ) {
        val inCall: Boolean get() = status != Status.IDLE && status != Status.ENDED
        val speaker: Boolean get() = route == CallAudio.Route.SPEAKER
    }

    private const val TAG = "CallManager"
    private val deviceId = java.util.UUID.randomUUID().toString()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()
    private val _localVideo = MutableStateFlow<VideoTrack?>(null)
    val localVideo: StateFlow<VideoTrack?> = _localVideo.asStateFlow()
    private val _remoteVideo = MutableStateFlow<VideoTrack?>(null)
    val remoteVideo: StateFlow<VideoTrack?> = _remoteVideo.asStateFlow()

    private lateinit var app: FamilyApp
    val eglBase: EglBase by lazy { EglBase.create() }
    private var factory: PeerConnectionFactory? = null
    private var pc: PeerConnection? = null
    private var audioSource: AudioSource? = null
    private var audioTrack: AudioTrack? = null
    private var videoSource: VideoSource? = null
    private var capturer: CameraVideoCapturer? = null
    private var textureHelper: SurfaceTextureHelper? = null
    private var offerSdp: String? = null
    private val pendingCandidates = mutableListOf<IceCandidate>()
    private var ringer: MediaPlayer? = null
    private var ringback: ToneGenerator? = null
    private var endJob: Job? = null
    /** I started this call. Only the caller restarts a dropped connection, so offers never cross. */
    private var isCaller = false
    private var retryJob: Job? = null
    private var giveUpJob: Job? = null
    private const val GIVE_UP_MS = 30_000L
    /** Tells the server this app understands "renegotiate" and "media" (see server/src/calls.js). */
    private const val PROTOCOL = 2
    private val audio by lazy {
        CallAudio(app).apply {
            onChange = { route, available ->
                val s = _state.value
                if (s.route != route || s.headsetAvailable != available) set { it.copy(route = route, headsetAvailable = available) }
            }
        }
    }
    private var statsJob: Job? = null
    /** Last audio packet counts, to work out the loss since the previous check. */
    private var lastReceived = 0L
    private var lastLost = 0L
    private val proximity by lazy {
        app.getSystemService(PowerManager::class.java)
            .takeIf { it.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK) }
            ?.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "family:call")
            ?.apply { setReferenceCounted(false) }
    }

    fun init(app: FamilyApp) {
        this.app = app
        // A network came back (or a new one, like LTE after Wi-Fi): reconnect a dropped call right away.
        runCatching {
            app.getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(
                object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) {
                        scope.launch { reconnectNow() }
                    }
                },
            )
        }
    }

    private fun set(transform: (State) -> State) {
        _state.value = transform(_state.value)
        Notifications.updateCall(app, _state.value)
        updateProximity()
    }

    /**
     * Turns the screen off while the phone is held to the ear (a voice call on the earpiece), so a
     * cheek can't press buttons.
     */
    private fun updateProximity() {
        val s = _state.value
        val atEar = !s.video && s.route == CallAudio.Route.EARPIECE &&
            (s.status == Status.OUTGOING || s.status == Status.CONNECTING || s.status == Status.ACTIVE)
        val lock = proximity ?: return
        if (atEar && !lock.isHeld) lock.acquire(4 * 60 * 60 * 1000L)
        if (!atEar && lock.isHeld) lock.release(PowerManager.RELEASE_FLAG_WAIT_FOR_NO_PROXIMITY)
    }

    private fun signal(action: String, extra: Map<String, Any?> = emptyMap()): Boolean {
        val body = buildJsonObject {
            put("type", "call")
            put("action", action)
            put("callId", _state.value.callId)
            for ((k, v) in extra) {
                when (v) {
                    is String -> put(k, v)
                    is Boolean -> put(k, v)
                    is Number -> put(k, v)
                    is JsonObject -> put(k, v)
                }
            }
        }
        return LiveSocket.send(Api.json.encodeToString(JsonObject.serializer(), body))
    }

    // ---- WebRTC setup ------------------------------------------------------------------------

    private fun factory(): PeerConnectionFactory = factory ?: run {
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(app).createInitializationOptions())
        PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()
            .also { factory = it }
    }

    private fun startMedia(video: Boolean) {
        val f = factory()
        audioSource = f.createAudioSource(MediaConstraints())
        audioTrack = f.createAudioTrack("audio0", audioSource)
        if (!video) return
        val enumerator = Camera2Enumerator(app)
        val name = enumerator.deviceNames.firstOrNull(enumerator::isFrontFacing) ?: enumerator.deviceNames.firstOrNull() ?: return
        val cam = enumerator.createCapturer(name, null)
        val helper = SurfaceTextureHelper.create("CallCapture", eglBase.eglBaseContext)
        val source = f.createVideoSource(false)
        cam.initialize(helper, app, source.capturerObserver)
        cam.startCapture(1280, 720, 30)
        capturer = cam
        textureHelper = helper
        videoSource = source
        _localVideo.value = f.createVideoTrack("video0", source)
    }

    private suspend fun iceServers(): List<PeerConnection.IceServer> {
        val config = runCatching { app.api.callIce() }.getOrNull()
        val servers = config?.iceServers.orEmpty().mapNotNull { s ->
            val urls = when (val u = s.urls) {
                is JsonArray -> u.mapNotNull { it.jsonPrimitive.contentOrNull }
                is JsonPrimitive -> listOfNotNull(u.contentOrNull)
                else -> emptyList()
            }
            if (urls.isEmpty()) return@mapNotNull null
            PeerConnection.IceServer.builder(urls)
                .apply {
                    s.username?.let(::setUsername)
                    s.credential?.let(::setPassword)
                }
                .createIceServer()
        }
        return servers.ifEmpty { listOf(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer()) }
    }

    private suspend fun makePeer(): PeerConnection {
        val config = PeerConnection.RTCConfiguration(iceServers()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        val peer = factory().createPeerConnection(config, Observer) ?: throw IllegalStateException("통화를 시작할 수 없어요.")
        audioTrack?.let { peer.addTrack(it, listOf("family")) }
        _localVideo.value?.let { peer.addTrack(it, listOf("family")) }
        return peer
    }

    /** WebRTC callbacks come on its own thread; everything is handled on the main thread. */
    private object Observer : PeerConnection.Observer {
        override fun onIceCandidate(candidate: IceCandidate) {
            scope.launch {
                signal(
                    "ice",
                    mapOf(
                        "candidate" to buildJsonObject {
                            put("candidate", candidate.sdp)
                            put("sdpMid", candidate.sdpMid)
                            put("sdpMLineIndex", candidate.sdpMLineIndex)
                        },
                    ),
                )
            }
        }

        override fun onTrack(transceiver: RtpTransceiver) {
            val track = transceiver.receiver.track()
            if (track is VideoTrack) scope.launch { _remoteVideo.value = track }
        }

        override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
            scope.launch {
                val active = _state.value.status == Status.ACTIVE
                when (newState) {
                    PeerConnection.PeerConnectionState.CONNECTED -> {
                        stopRetrying()
                        if (!active) {
                            stopSounds()
                            set { it.copy(status = Status.ACTIVE, startedAt = System.currentTimeMillis(), message = null) }
                            sendMedia()
                            startStats()
                        } else if (_state.value.reconnecting) {
                            set { it.copy(reconnecting = false) }
                        }
                    }
                    PeerConnection.PeerConnectionState.DISCONNECTED -> if (active) lostConnection(failed = false)
                    PeerConnection.PeerConnectionState.FAILED -> if (active) lostConnection(failed = true) else hangUp("연결이 끊겼어요.")
                    else -> Unit
                }
            }
        }

        override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) = Unit
        override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) = Unit
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
        override fun onAddStream(stream: MediaStream) = Unit
        override fun onRemoveStream(stream: MediaStream) = Unit
        override fun onDataChannel(channel: DataChannel) = Unit
        override fun onRenegotiationNeeded() = Unit
    }

    private suspend fun PeerConnection.create(offer: Boolean, iceRestart: Boolean = false): SessionDescription = suspendCancellableCoroutine { cont ->
        val observer = object : SdpObserver {
            override fun onCreateSuccess(sdp: SessionDescription) = cont.resume(sdp)
            override fun onCreateFailure(error: String) = cont.resumeWithException(IllegalStateException(error))
            override fun onSetSuccess() = Unit
            override fun onSetFailure(error: String) = Unit
        }
        val constraints = MediaConstraints().apply {
            if (iceRestart) mandatory.add(MediaConstraints.KeyValuePair("IceRestart", "true"))
        }
        if (offer) createOffer(observer, constraints) else createAnswer(observer, constraints)
    }

    private suspend fun PeerConnection.apply(sdp: SessionDescription, local: Boolean) = suspendCancellableCoroutine { cont ->
        val observer = object : SdpObserver {
            override fun onSetSuccess() = cont.resume(Unit)
            override fun onSetFailure(error: String) = cont.resumeWithException(IllegalStateException(error))
            override fun onCreateSuccess(sdp: SessionDescription) = Unit
            override fun onCreateFailure(error: String) = Unit
        }
        if (local) setLocalDescription(observer, sdp) else setRemoteDescription(observer, sdp)
    }

    private fun candidateOf(json: JsonObject): IceCandidate? {
        val sdp = json["candidate"]?.jsonPrimitive?.contentOrNull ?: return null
        val mid = json["sdpMid"]?.jsonPrimitive?.contentOrNull
        val index = json["sdpMLineIndex"]?.jsonPrimitive?.intOrNull ?: 0
        return IceCandidate(mid, index, sdp)
    }

    private fun addCandidate(candidate: IceCandidate) {
        val peer = pc
        if (peer?.remoteDescription != null) peer.addIceCandidate(candidate) else pendingCandidates += candidate
    }

    private fun flushCandidates() {
        val peer = pc ?: return
        pendingCandidates.forEach(peer::addIceCandidate)
        pendingCandidates.clear()
    }

    // ---- Keeping the call up when the network changes (Wi-Fi ↔ LTE) --------------------------

    /**
     * The connection dropped. "Disconnected" often recovers by itself within seconds; if not (or once
     * it's "failed"), the caller restarts it over the new network routes (ICE restart), retrying until
     * it works or [GIVE_UP_MS] passes.
     */
    private fun lostConnection(failed: Boolean) {
        if (!_state.value.reconnecting) set { it.copy(reconnecting = true) }
        if (giveUpJob == null) {
            giveUpJob = scope.launch {
                delay(GIVE_UP_MS)
                giveUpJob = null
                hangUp("연결이 끊겼어요.")
            }
        }
        if (!isCaller || retryJob != null) return
        retryJob = scope.launch {
            delay(if (failed) 0 else 2000)
            while (true) {
                restartIce()
                delay(4000)
            }
        }
    }

    private fun stopRetrying() {
        retryJob?.cancel()
        retryJob = null
        giveUpJob?.cancel()
        giveUpJob = null
    }

    /** A network or the server connection came back: don't wait for the next retry. */
    private suspend fun reconnectNow() {
        val s = _state.value
        if (s.status == Status.ACTIVE && s.reconnecting && isCaller) restartIce()
    }

    private suspend fun restartIce() {
        val peer = pc ?: return
        if (peer.signalingState() != PeerConnection.SignalingState.STABLE) return
        runCatching {
            val offer = peer.create(offer = true, iceRestart = true)
            peer.apply(offer, local = true)
            signal("renegotiate", mapOf("kind" to "offer", "sdp" to offer.description))
        }.onFailure { Log.w(TAG, "ICE restart", it) }
    }

    private suspend fun onRenegotiate(msg: CallSignal) {
        val peer = pc ?: return
        val sdp = msg.sdp ?: return
        runCatching {
            if (msg.kind == "offer") {
                peer.apply(SessionDescription(SessionDescription.Type.OFFER, sdp), local = false)
                val answer = peer.create(offer = false)
                peer.apply(answer, local = true)
                signal("renegotiate", mapOf("kind" to "answer", "sdp" to answer.description))
            } else if (peer.signalingState() == PeerConnection.SignalingState.HAVE_LOCAL_OFFER) {
                peer.apply(SessionDescription(SessionDescription.Type.ANSWER, sdp), local = false)
            }
        }.onFailure { Log.w(TAG, "renegotiate", it) }
    }

    // ---- Connection quality ------------------------------------------------------------------

    /** Every 2 seconds: how long a round trip takes and how much of the sound gets lost. */
    private fun startStats() {
        statsJob?.cancel()
        lastReceived = 0
        lastLost = 0
        statsJob = scope.launch {
            while (true) {
                delay(2000)
                measure()
            }
        }
    }

    private suspend fun measure() {
        val peer = pc ?: return
        val report = suspendCancellableCoroutine<RTCStatsReport> { cont -> peer.getStats { cont.resume(it) } }
        var rtt: Double? = null
        var received = 0L
        var lost = 0L
        for (s in report.statsMap.values) {
            val m = s.members
            when (s.type) {
                "candidate-pair" -> if (m["nominated"] == true && m["state"] == "succeeded") {
                    (m["currentRoundTripTime"] as? Number)?.let { rtt = it.toDouble() }
                }
                "inbound-rtp" -> if (m["kind"] == "audio") {
                    received += (m["packetsReceived"] as? Number)?.toLong() ?: 0
                    lost += (m["packetsLost"] as? Number)?.toLong() ?: 0
                }
            }
        }
        val newReceived = received - lastReceived
        val newLost = (lost - lastLost).coerceAtLeast(0)
        lastReceived = received
        lastLost = lost
        val loss = if (newReceived + newLost > 0) newLost.toDouble() / (newReceived + newLost) else 1.0
        val r = rtt ?: 1.0
        val quality = when {
            _state.value.reconnecting -> 1
            r < 0.3 && loss < 0.03 -> 3
            r < 0.7 && loss < 0.1 -> 2
            else -> 1
        }
        if (quality != _state.value.quality) set { it.copy(quality = quality) }
    }

    /** Tells the other side whether my microphone / camera is off, so their screen can show it. */
    private fun sendMedia() {
        val s = _state.value
        signal("media", mapOf("muted" to s.muted, "cameraOff" to s.cameraOff))
    }

    // ---- Sound -----------------------------------------------------------------------------

    private fun audioManager() = app.getSystemService(AudioManager::class.java)

    private fun vibrator(): Vibrator =
        if (Build.VERSION.SDK_INT >= 31) {
            app.getSystemService(VibratorManager::class.java).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            app.getSystemService(Vibrator::class.java)
        }

    /** The phone's ringtone (respecting silent / vibrate mode) for an incoming call. */
    private fun startRinging() {
        stopSounds()
        val mode = audioManager().ringerMode
        if (mode == AudioManager.RINGER_MODE_SILENT) return
        vibrator().vibrate(VibrationEffect.createWaveform(longArrayOf(0, 600, 800), 0))
        if (mode != AudioManager.RINGER_MODE_NORMAL) return
        runCatching {
            val uri = RingtoneManager.getActualDefaultRingtoneUri(app, RingtoneManager.TYPE_RINGTONE)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            ringer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                setDataSource(app, uri)
                isLooping = true
                prepare()
                start()
            }
        }.onFailure { Log.w(TAG, "ringtone", it) }
    }

    /** The "뚜— 뚜—" you hear while calling someone. */
    private fun startRingback() {
        stopSounds()
        ringback = runCatching { ToneGenerator(AudioManager.STREAM_VOICE_CALL, 70) }.getOrNull()
        ringback?.startTone(ToneGenerator.TONE_SUP_RINGTONE)
    }

    private fun stopSounds() {
        ringer?.runCatching { stop(); release() }
        ringer = null
        ringback?.runCatching { stopTone(); release() }
        ringback = null
        runCatching { vibrator().cancel() }
    }

    // ---- Actions ---------------------------------------------------------------------------

    fun startCall(peer: CallPeer, video: Boolean) {
        if (_state.value.inCall) return
        endJob?.cancel()
        val callId = "${System.currentTimeMillis().toString(36)}-${(0..Int.MAX_VALUE).random().toString(36)}"
        isCaller = true
        // Video calls use the loudspeaker, unless a headset is connected.
        val preferred = if (video) CallAudio.Route.SPEAKER else CallAudio.Route.EARPIECE
        val route = audio.initialRoute(preferred)
        set { State(status = Status.OUTGOING, callId = callId, peer = peer, video = video, route = route) }
        scope.launch {
            try {
                startMedia(video)
                audio.start(route, fallback = preferred)
                val peerConnection = makePeer().also { pc = it }
                val offer = peerConnection.create(offer = true)
                peerConnection.apply(offer, local = true)
                if (!signal("invite", mapOf("to" to peer.id, "video" to video, "sdp" to offer.description, "v" to PROTOCOL))) {
                    throw IllegalStateException("서버에 연결되어 있지 않아요.")
                }
                startRingback()
            } catch (e: Exception) {
                finish(e.message ?: "전화를 걸 수 없어요.")
            }
        }
    }

    fun accept() {
        if (_state.value.status != Status.INCOMING) return
        stopSounds()
        val video = _state.value.video
        val preferred = if (video) CallAudio.Route.SPEAKER else CallAudio.Route.EARPIECE
        val route = audio.initialRoute(preferred)
        set { it.copy(status = Status.CONNECTING, route = route) }
        scope.launch {
            try {
                startMedia(video)
                audio.start(route, fallback = preferred)
                val peerConnection = makePeer().also { pc = it }
                peerConnection.apply(SessionDescription(SessionDescription.Type.OFFER, offerSdp), local = false)
                flushCandidates()
                val answer = peerConnection.create(offer = false)
                peerConnection.apply(answer, local = true)
                signal("accept", mapOf("sdp" to answer.description, "deviceId" to deviceId, "v" to PROTOCOL))
            } catch (e: Exception) {
                signal("decline")
                finish(e.message ?: "전화를 받을 수 없어요.")
            }
        }
    }

    fun decline() {
        if (_state.value.status != Status.INCOMING) return
        signal("decline")
        finish("거절했어요.")
    }

    fun hangUp(message: String = "통화가 끝났어요.") {
        when (_state.value.status) {
            Status.OUTGOING -> signal("cancel")
            Status.INCOMING -> signal("decline")
            Status.CONNECTING, Status.ACTIVE -> signal("end")
            else -> return
        }
        finish(message)
    }

    fun toggleMute() {
        val muted = !_state.value.muted
        audioTrack?.setEnabled(!muted)
        set { it.copy(muted = muted) }
        sendMedia()
    }

    fun toggleCamera() {
        val off = !_state.value.cameraOff
        _localVideo.value?.setEnabled(!off)
        set { it.copy(cameraOff = off) }
        sendMedia()
    }

    fun switchCamera() {
        capturer?.switchCamera(null)
    }

    /** Earpiece ↔ loudspeaker (with no headset connected; otherwise the screen offers [setRoute]). */
    fun toggleSpeaker() {
        setRoute(if (_state.value.speaker) CallAudio.Route.EARPIECE else CallAudio.Route.SPEAKER)
    }

    fun setRoute(route: CallAudio.Route) {
        set { it.copy(route = route) }
        audio.setRoute(route)
    }

    private fun ring(callId: String, from: CallPeer, video: Boolean, sdp: String, candidates: List<JsonObject>) {
        endJob?.cancel()
        isCaller = false
        offerSdp = sdp
        pendingCandidates.clear()
        candidates.mapNotNullTo(pendingCandidates, ::candidateOf)
        set { State(status = Status.INCOMING, callId = callId, peer = from, video = video) }
        signal("ringing")
        startRinging()
    }

    /** Called when the live connection (re)opens: a call may be ringing that we missed. */
    fun checkPending() {
        if (!::app.isInitialized) return
        if (_state.value.inCall) {
            scope.launch { reconnectNow() }
            return
        }
        scope.launch {
            val pending = runCatching { app.api.pendingCall() }.getOrNull() ?: return@launch
            if (!_state.value.inCall) ring(pending.callId, pending.from, pending.video, pending.sdp, pending.candidates)
        }
    }

    /** Signals from the server, via MessageService. */
    fun onSignal(signal: CallSignal) = scope.launch {
        val current = _state.value
        val mine = signal.callId == current.callId
        when (signal.action) {
            "invite" -> if (!current.inCall && signal.from != null && signal.sdp != null) {
                ring(signal.callId, signal.from, signal.video, signal.sdp, emptyList())
            }
            "ringing" -> if (mine && current.status == Status.OUTGOING) set { it.copy(message = "상대방 전화가 울리고 있어요") }
            "accept" -> if (mine && pc != null && signal.sdp != null) {
                stopSounds()
                set { it.copy(status = Status.CONNECTING, message = null) }
                runCatching {
                    pc?.apply(SessionDescription(SessionDescription.Type.ANSWER, signal.sdp), local = false)
                    flushCandidates()
                }.onFailure { hangUp("연결하지 못했어요.") }
            }
            "ice" -> if (mine) signal.candidate?.let(::candidateOf)?.let(::addCandidate)
            "answered-elsewhere" -> if (mine && current.status == Status.INCOMING && signal.except != deviceId) {
                finish("다른 기기에서 받았어요.")
            }
            "offline" -> if (mine) set { it.copy(message = "상대방이 지금 연결되어 있지 않아요. 알림을 보냈어요.") }
            "renegotiate" -> if (mine && current.status == Status.ACTIVE) onRenegotiate(signal)
            "media" -> if (mine) set { it.copy(peerMuted = signal.muted, peerCameraOff = signal.cameraOff) }
            else -> if (mine && current.inCall) {
                finish(
                    when (signal.action) {
                        "decline" -> "상대방이 전화를 받지 않았어요."
                        "cancel" -> "상대방이 전화를 끊었어요."
                        "missed" -> "전화를 받지 않았어요."
                        "busy" -> "상대방이 다른 통화 중이에요."
                        "error" -> signal.message ?: "전화를 걸 수 없어요."
                        else -> "통화가 끝났어요."
                    },
                )
            }
        }
    }

    /** Releases the call and shows the message briefly before the call screen closes. */
    private fun finish(message: String) {
        stopSounds()
        stopRetrying()
        statsJob?.cancel()
        statsJob = null
        isCaller = false
        pc?.dispose()
        pc = null
        runCatching { capturer?.stopCapture() }
        capturer?.dispose()
        capturer = null
        textureHelper?.dispose()
        textureHelper = null
        _localVideo.value?.dispose()
        _localVideo.value = null
        _remoteVideo.value = null
        videoSource?.dispose()
        videoSource = null
        audioTrack?.dispose()
        audioTrack = null
        audioSource?.dispose()
        audioSource = null
        pendingCandidates.clear()
        offerSdp = null
        audio.stop()
        set { it.copy(status = Status.ENDED, message = message, reconnecting = false) }
        endJob?.cancel()
        endJob = scope.launch {
            delay(1800)
            set { State() }
        }
    }
}
