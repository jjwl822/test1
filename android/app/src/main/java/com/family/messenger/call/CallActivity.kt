package com.family.messenger.call

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Cameraswitch
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.family.messenger.FamilyApp
import com.family.messenger.ui.Avatar
import com.family.messenger.ui.FamilyTheme
import com.family.messenger.ui.bubbleColor
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

/** Full-screen call screen: ringing, calling, and the call itself. Also shows over the lock screen. */
class CallActivity : ComponentActivity() {

    /** What to do once the microphone/camera permission answer comes back. */
    private var afterPermission: (() -> Unit)? = null
    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val run = afterPermission
        afterPermission = null
        if (result[Manifest.permission.RECORD_AUDIO] == false && !has(Manifest.permission.RECORD_AUDIO)) {
            Toast.makeText(this, "통화하려면 마이크 권한이 필요해요.", Toast.LENGTH_LONG).show()
            if (CallManager.state.value.status == CallManager.Status.INCOMING) CallManager.decline()
            if (!CallManager.state.value.inCall) finish()
            return@registerForActivityResult
        }
        run?.invoke()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (savedInstanceState == null) handle(intent)

        val app = application as FamilyApp
        setContent {
            FamilyTheme {
                val state by CallManager.state.collectAsState()
                val users by app.directory.users.collectAsState()
                val peer = state.peer?.let { users[it.id] }
                CallScreen(
                    state = state,
                    peerName = peer?.displayName ?: state.peer?.displayName.orEmpty(),
                    peerPhoto = app.avatarUrl(peer),
                    peerColor = peer?.color,
                    onAccept = ::answer,
                )
            }
        }

        // Close once the call is over; keep the "통화 중" service running while it's up.
        lifecycleScope.launch {
            var seenCall = false
            CallManager.state.collect { state ->
                if (state.inCall) seenCall = true
                if (state.inCall && state.status != CallManager.Status.INCOMING) CallService.start(this@CallActivity)
                if (state.status == CallManager.Status.IDLE && (seenCall || afterPermission == null)) finish()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent) {
        when (intent.action) {
            ACTION_START -> {
                val peer = CallPeer(intent.getLongExtra(EXTRA_PEER_ID, 0), intent.getStringExtra(EXTRA_PEER_NAME).orEmpty())
                val video = intent.getBooleanExtra(EXTRA_VIDEO, false)
                if (peer.id == 0L || CallManager.state.value.inCall) return
                withPermissions(video) { CallManager.startCall(peer, video) }
            }
            ACTION_ANSWER -> answer()
        }
    }

    private fun answer() {
        if (CallManager.state.value.status != CallManager.Status.INCOMING) return
        withPermissions(CallManager.state.value.video) { CallManager.accept() }
    }

    private fun has(permission: String) =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun withPermissions(video: Boolean, action: () -> Unit) {
        val needed = listOfNotNull(
            Manifest.permission.RECORD_AUDIO,
            if (video) Manifest.permission.CAMERA else null,
        ).filterNot(::has)
        if (needed.isEmpty()) return action()
        afterPermission = action
        permissions.launch(needed.toTypedArray())
    }

    companion object {
        const val ACTION_START = "com.family.messenger.call.START"
        const val ACTION_ANSWER = "com.family.messenger.call.ANSWER"
        private const val EXTRA_PEER_ID = "peerId"
        private const val EXTRA_PEER_NAME = "peerName"
        private const val EXTRA_VIDEO = "video"

        fun startIntent(context: Context, peer: CallPeer, video: Boolean): Intent =
            Intent(context, CallActivity::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_PEER_ID, peer.id)
                .putExtra(EXTRA_PEER_NAME, peer.displayName)
                .putExtra(EXTRA_VIDEO, video)

        fun answerIntent(context: Context): Intent =
            Intent(context, CallActivity::class.java)
                .setAction(ACTION_ANSWER)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

        fun showIntent(context: Context): Intent =
            Intent(context, CallActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
}

@Composable
private fun CallScreen(
    state: CallManager.State,
    peerName: String,
    peerPhoto: String?,
    peerColor: String?,
    onAccept: () -> Unit,
) {
    val local by CallManager.localVideo.collectAsState()
    val remote by CallManager.remoteVideo.collectAsState()
    val active = state.status == CallManager.Status.ACTIVE
    // The other person's camera off: their photo instead of a black picture.
    val showRemote = state.video && remote != null && active && !state.peerCameraOff
    val note = listOfNotNull(
        "🔇 상대방이 음소거했어요".takeIf { active && state.peerMuted },
        "상대방이 카메라를 껐어요".takeIf { active && state.video && state.peerCameraOff },
        "🎧 이어폰으로 듣는 중".takeIf { state.headset && state.inCall && state.status != CallManager.Status.INCOMING },
    ).joinToString(" · ")

    Box(Modifier.fillMaxSize().background(Color(0xFF111111))) {
        // While ringing, my camera fills the screen (dimmed); once connected it moves to the corner.
        if (showRemote) {
            VideoView(remote, mirror = false, Modifier.fillMaxSize())
        } else if (!active && state.video && local != null && !state.cameraOff) {
            VideoView(local, mirror = true, Modifier.fillMaxSize())
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)))
        }
        if (active && state.video && local != null && !state.cameraOff) {
            VideoView(
                local,
                mirror = true,
                Modifier
                    .safeDrawingPadding()
                    .padding(12.dp)
                    .align(Alignment.TopEnd)
                    .size(width = 110.dp, height = 160.dp)
                    .clip(RoundedCornerShape(12.dp)),
                overlay = true,
            )
        }

        Column(
            Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(if (showRemote) 0.dp else 56.dp))
            if (!showRemote) {
                Avatar(peerName, size = 112.dp, imageUrl = peerPhoto, color = peerColor?.let(::bubbleColor))
                Spacer(Modifier.height(16.dp))
            }
            Text(peerName, color = Color.White, fontSize = if (showRemote) 18.sp else 28.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(6.dp))
            Text(statusText(state), color = Color.White.copy(alpha = 0.8f), fontSize = 15.sp)
            if (note.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                Text(
                    note,
                    color = Color.White,
                    fontSize = 13.sp,
                    modifier = Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color.Black.copy(alpha = 0.45f))
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                )
            }
            Spacer(Modifier.weight(1f))

            if (state.status == CallManager.Status.INCOMING) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    RoundButton(Icons.Filled.CallEnd, "거절", Color(0xFFFF3B30), onClick = CallManager::decline)
                    RoundButton(
                        if (state.video) Icons.Filled.Videocam else Icons.Filled.Call,
                        "받기",
                        Color(0xFF34C759),
                        onClick = onAccept,
                    )
                }
            } else if (state.status != CallManager.Status.ENDED) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    RoundButton(
                        if (state.muted) Icons.Filled.MicOff else Icons.Filled.Mic,
                        if (state.muted) "음소거 해제" else "음소거",
                        if (state.muted) Color.White else Color.White.copy(alpha = 0.2f),
                        tint = if (state.muted) Color.Black else Color.White,
                        onClick = CallManager::toggleMute,
                    )
                    if (state.video) {
                        RoundButton(
                            if (state.cameraOff) Icons.Filled.VideocamOff else Icons.Filled.Videocam,
                            if (state.cameraOff) "카메라 켜기" else "카메라 끄기",
                            if (state.cameraOff) Color.White else Color.White.copy(alpha = 0.2f),
                            tint = if (state.cameraOff) Color.Black else Color.White,
                            onClick = CallManager::toggleCamera,
                        )
                        RoundButton(Icons.Filled.Cameraswitch, "카메라 전환", Color.White.copy(alpha = 0.2f), onClick = CallManager::switchCamera)
                    }
                    RoundButton(
                        if (state.speaker) Icons.Filled.VolumeUp else Icons.Filled.VolumeOff,
                        "스피커",
                        if (state.speaker) Color.White else Color.White.copy(alpha = 0.2f),
                        tint = if (state.speaker) Color.Black else Color.White,
                        onClick = CallManager::toggleSpeaker,
                    )
                }
                Spacer(Modifier.height(24.dp))
                RoundButton(Icons.Filled.CallEnd, "끊기", Color(0xFFFF3B30), onClick = { CallManager.hangUp() })
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun statusText(state: CallManager.State): String {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(state.status) {
        while (state.status == CallManager.Status.ACTIVE) {
            now = System.currentTimeMillis()
            delay(1000)
        }
    }
    val kind = if (state.video) "영상통화" else "음성통화"
    return when (state.status) {
        CallManager.Status.OUTGOING -> state.message ?: "$kind 거는 중…"
        CallManager.Status.INCOMING -> "$kind 전화가 왔어요"
        CallManager.Status.CONNECTING -> "연결하는 중…"
        CallManager.Status.ACTIVE -> if (state.reconnecting) "연결이 불안정해요. 다시 연결하는 중…" else {
            val seconds = ((now - (state.startedAt ?: now)) / 1000).coerceAtLeast(0)
            "%d:%02d".format(seconds / 60, seconds % 60)
        }
        CallManager.Status.ENDED -> state.message ?: "통화가 끝났어요."
        CallManager.Status.IDLE -> ""
    }
}

@Composable
private fun RoundButton(
    icon: ImageVector,
    label: String,
    background: Color,
    tint: Color = Color.White,
    onClick: () -> Unit,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(76.dp)) {
        Box(
            Modifier
                .size(64.dp)
                .clip(CircleShape)
                .background(background)
                .clickable(onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(28.dp))
        }
        Spacer(Modifier.height(6.dp))
        Text(label, color = Color.White, fontSize = 12.sp, maxLines = 1)
    }
}

/** Shows a WebRTC video track. [overlay] puts it above another video (the small self view). */
@Composable
private fun VideoView(track: VideoTrack?, mirror: Boolean, modifier: Modifier, overlay: Boolean = false) {
    if (track == null) return
    val renderer = remember { arrayOfNulls<SurfaceViewRenderer>(1) }
    AndroidView(
        modifier = modifier,
        factory = { context ->
            SurfaceViewRenderer(context).apply {
                init(CallManager.eglBase.eglBaseContext, null)
                setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                setEnableHardwareScaler(true)
                setMirror(mirror)
                if (overlay) setZOrderMediaOverlay(true)
                renderer[0] = this
            }
        },
    )
    DisposableEffect(track) {
        val view = renderer[0]
        view?.let { runCatching { track.addSink(it) } }
        onDispose { view?.let { runCatching { track.removeSink(it) } } }
    }
    DisposableEffect(Unit) {
        onDispose { renderer[0]?.release() }
    }
}
