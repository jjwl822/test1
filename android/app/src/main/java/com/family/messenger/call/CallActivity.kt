package com.family.messenger.call

import android.Manifest
import android.app.PictureInPictureParams
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.util.Rational
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
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
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Headset
import androidx.compose.material.icons.filled.Hearing
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.PictureInPictureAlt
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
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
import kotlin.math.roundToInt

/**
 * Full-screen call screen: ringing, calling, and the call itself. Also shows over the lock screen,
 * and shrinks to a small floating window (picture-in-picture) when leaving a video call.
 */
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

    private var inPip by mutableStateOf(false)

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
                    inPip = inPip,
                    canPip = pipSupported(),
                    onAccept = ::answer,
                    onPip = ::enterPip,
                )
            }
        }

        // Close once the call is over; keep the "통화 중" service running while it's up.
        lifecycleScope.launch {
            var seenCall = false
            CallManager.state.collect { state ->
                if (state.inCall) seenCall = true
                if (state.inCall && state.status != CallManager.Status.INCOMING) CallService.start(this@CallActivity)
                if (Build.VERSION.SDK_INT >= 31 && pipSupported()) {
                    // Going home during a video call shrinks it to a small window by itself.
                    runCatching { setPictureInPictureParams(pipParams().setAutoEnterEnabled(pipAllowed(state)).build()) }
                }
                if (state.status == CallManager.Status.IDLE && (seenCall || afterPermission == null)) finish()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (Build.VERSION.SDK_INT < 31) enterPip()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        inPip = isInPictureInPictureMode
    }

    private fun pipSupported() = packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    private fun pipAllowed(state: CallManager.State) =
        state.video && state.inCall && state.status != CallManager.Status.INCOMING

    private fun pipParams() = PictureInPictureParams.Builder().setAspectRatio(Rational(9, 16))

    private fun enterPip() {
        if (!pipSupported() || !pipAllowed(CallManager.state.value) || inPip) return
        runCatching { enterPictureInPictureMode(pipParams().build()) }
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

private val SMALL_W = 110.dp
private val SMALL_H = 160.dp

@Composable
private fun CallScreen(
    state: CallManager.State,
    peerName: String,
    peerPhoto: String?,
    peerColor: String?,
    inPip: Boolean,
    canPip: Boolean,
    onAccept: () -> Unit,
    onPip: () -> Unit,
) {
    val local by CallManager.localVideo.collectAsState()
    val remote by CallManager.remoteVideo.collectAsState()
    val active = state.status == CallManager.Status.ACTIVE
    // The other person's camera off: their photo instead of a black picture.
    val showRemote = state.video && remote != null && active && !state.peerCameraOff
    val showLocal = state.video && local != null && !state.cameraOff
    // Tapping my small picture swaps it with the big one.
    var swapped by remember { mutableStateOf(false) }
    val swap = swapped && showRemote && showLocal

    // On a video call, tapping the picture hides the buttons; they also hide by themselves.
    var controls by remember { mutableStateOf(true) }
    var touched by remember { mutableIntStateOf(0) }
    LaunchedEffect(showRemote, controls, touched) {
        if (!showRemote) controls = true
        else if (controls) {
            delay(5000)
            controls = false
        }
    }

    if (inPip) {
        PipContent(state, if (showRemote) remote else null, peerName, peerPhoto, peerColor)
        return
    }

    Box(Modifier.fillMaxSize().background(Color(0xFF111111))) {
        key(swap) {
            if (showRemote) {
                VideoView(if (swap) local else remote, mirror = swap, Modifier.fillMaxSize())
            } else if (!active && showLocal) {
                // While ringing, my camera fills the screen (dimmed); once connected it moves to the corner.
                VideoView(local, mirror = true, Modifier.fillMaxSize())
                Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)))
            }
        }
        Box(
            Modifier.fillMaxSize().clickable(remember { MutableInteractionSource() }, indication = null) {
                if (showRemote) {
                    controls = !controls
                    touched++
                }
            },
        )
        if (active && showLocal) {
            key(swap) {
                FloatingVideo(if (swap) remote else local, mirror = !swap) {
                    if (showRemote) swapped = !swapped
                }
            }
        }
        if (state.reconnecting) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.5f)), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Color.White, strokeWidth = 3.dp, modifier = Modifier.size(44.dp))
            }
        }

        // While reconnecting the status always shows.
        AnimatedVisibility(visible = controls || !showRemote || state.reconnecting, enter = fadeIn(), exit = fadeOut()) {
            Controls(state, peerName, peerPhoto, peerColor, showRemote, canPip, onAccept, onPip) { touched++ }
        }
    }
}

@Composable
private fun Controls(
    state: CallManager.State,
    peerName: String,
    peerPhoto: String?,
    peerColor: String?,
    overVideo: Boolean,
    canPip: Boolean,
    onAccept: () -> Unit,
    onPip: () -> Unit,
    onTouch: () -> Unit,
) {
    val active = state.status == CallManager.Status.ACTIVE
    val ringing = state.status == CallManager.Status.INCOMING || state.status == CallManager.Status.OUTGOING ||
        state.status == CallManager.Status.CONNECTING
    val note = listOfNotNull(
        "🔇 상대방이 음소거했어요".takeIf { active && state.peerMuted },
        "상대방이 카메라를 껐어요".takeIf { active && state.video && state.peerCameraOff },
    ).joinToString(" · ")
    val press = { action: () -> Unit -> { onTouch(); action() } }

    Box(Modifier.fillMaxSize()) {
        if (overVideo) {
            // Keeps the name and buttons readable over a bright picture.
            Box(Modifier.fillMaxWidth().height(140.dp).background(Color.Black.copy(alpha = 0.3f)))
            Box(Modifier.fillMaxWidth().height(220.dp).align(Alignment.BottomCenter).background(Color.Black.copy(alpha = 0.35f)))
        }
        Column(
            Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (active && state.video && canPip) {
                Row(Modifier.fillMaxWidth()) {
                    Box(
                        Modifier.size(40.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.2f)).clickable(onClick = onPip),
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.Filled.PictureInPictureAlt, contentDescription = "작게 보기", tint = Color.White, modifier = Modifier.size(22.dp)) }
                }
            }
            Spacer(Modifier.height(if (overVideo) 0.dp else 40.dp))
            if (!overVideo) {
                Ripple(animate = ringing, size = 112.dp) {
                    Avatar(peerName, size = 112.dp, imageUrl = peerPhoto, color = peerColor?.let(::bubbleColor))
                }
                Spacer(Modifier.height(8.dp))
            }
            Text(peerName, color = Color.White, fontSize = if (overVideo) 18.sp else 28.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (active && !state.reconnecting) {
                    QualityBars(state.quality)
                    Spacer(Modifier.width(8.dp))
                }
                Text(statusText(state), color = Color.White.copy(alpha = 0.85f), fontSize = 15.sp)
            }
            if (active && state.quality == 1 && !state.reconnecting) {
                Spacer(Modifier.height(6.dp))
                Text("연결이 약해요", color = Color(0xFFFFD60A), fontSize = 13.sp)
            }
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
                        onClick = press(CallManager::toggleMute),
                    )
                    if (state.video) {
                        RoundButton(
                            if (state.cameraOff) Icons.Filled.VideocamOff else Icons.Filled.Videocam,
                            if (state.cameraOff) "카메라 켜기" else "카메라 끄기",
                            if (state.cameraOff) Color.White else Color.White.copy(alpha = 0.2f),
                            tint = if (state.cameraOff) Color.Black else Color.White,
                            onClick = press(CallManager::toggleCamera),
                        )
                        RoundButton(Icons.Filled.Cameraswitch, "카메라 전환", Color.White.copy(alpha = 0.2f), onClick = press(CallManager::switchCamera))
                    }
                    RouteButton(state, onTouch)
                }
                Spacer(Modifier.height(24.dp))
                RoundButton(Icons.Filled.CallEnd, "끊기", Color(0xFFFF3B30), onClick = { CallManager.hangUp() })
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

/**
 * Speaker on/off; with a headset connected it opens a choice of earpiece, speaker and headset.
 */
@Composable
private fun RouteButton(state: CallManager.State, onTouch: () -> Unit) {
    if (!state.headsetAvailable) {
        RoundButton(
            if (state.speaker) Icons.Filled.VolumeUp else Icons.Filled.VolumeOff,
            "스피커",
            if (state.speaker) Color.White else Color.White.copy(alpha = 0.2f),
            tint = if (state.speaker) Color.Black else Color.White,
            onClick = {
                onTouch()
                CallManager.toggleSpeaker()
            },
        )
        return
    }
    var open by remember { mutableStateOf(false) }
    val (icon, label) = routeLook(state.route)
    Box {
        RoundButton(icon, label, Color.White.copy(alpha = 0.2f), onClick = {
            onTouch()
            open = true
        })
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for (route in listOf(CallAudio.Route.HEADSET, CallAudio.Route.EARPIECE, CallAudio.Route.SPEAKER)) {
                val (itemIcon, itemLabel) = routeLook(route)
                DropdownMenuItem(
                    text = { Text(itemLabel) },
                    leadingIcon = { Icon(itemIcon, contentDescription = null) },
                    trailingIcon = { if (route == state.route) Icon(Icons.Filled.Check, contentDescription = "선택됨") },
                    onClick = {
                        open = false
                        CallManager.setRoute(route)
                    },
                )
            }
        }
    }
}

private fun routeLook(route: CallAudio.Route): Pair<ImageVector, String> = when (route) {
    CallAudio.Route.HEADSET -> Icons.Filled.Headset to "이어폰"
    CallAudio.Route.EARPIECE -> Icons.Filled.Hearing to "휴대폰"
    CallAudio.Route.SPEAKER -> Icons.Filled.VolumeUp to "스피커"
}

/** Signal bars for the connection: 3 good, 2 fair, 1 weak (0: not measured yet). */
@Composable
private fun QualityBars(quality: Int) {
    val color = if (quality == 1) Color(0xFFFFD60A) else Color.White
    Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.height(14.dp)) {
        for (i in 1..3) {
            Box(
                Modifier
                    .padding(end = 2.dp)
                    .width(4.dp)
                    .height((4 + i * 3).dp)
                    .clip(RoundedCornerShape(1.dp))
                    .background(if (quality >= i) color else Color.White.copy(alpha = 0.3f)),
            )
        }
    }
}

/** Rings spreading out from the photo while the call is ringing or connecting. */
@Composable
private fun Ripple(animate: Boolean, size: Dp, content: @Composable () -> Unit) {
    Box(Modifier.size(size * 1.7f), contentAlignment = Alignment.Center) {
        if (animate) {
            val transition = rememberInfiniteTransition(label = "ripple")
            for (i in 0..1) {
                val t by transition.animateFloat(
                    initialValue = 0f,
                    targetValue = 1f,
                    animationSpec = infiniteRepeatable(tween(2000, easing = LinearEasing), RepeatMode.Restart, StartOffset(i * 1000)),
                    label = "ring$i",
                )
                Box(
                    Modifier
                        .size(size)
                        .graphicsLayer {
                            val scale = 1f + 0.7f * t
                            scaleX = scale
                            scaleY = scale
                            alpha = 0.45f * (1f - t)
                        }
                        .clip(CircleShape)
                        .background(Color.White),
                )
            }
        }
        content()
    }
}

/** The small picture in a corner: drag it to another corner, tap it to swap with the big one. */
@Composable
private fun BoxScope.FloatingVideo(track: VideoTrack?, mirror: Boolean, onTap: () -> Unit) {
    BoxWithConstraints(Modifier.matchParentSize().safeDrawingPadding().padding(12.dp)) {
        val density = LocalDensity.current
        val maxX = constraints.maxWidth - with(density) { SMALL_W.toPx() }
        val maxY = constraints.maxHeight - with(density) { SMALL_H.toPx() } - with(density) { 230.dp.toPx() }
        val offset = remember { Animatable(Offset(maxX, 0f), Offset.VectorConverter) }
        val scope = rememberCoroutineScope()
        Box(
            Modifier
                .offset { IntOffset(offset.value.x.roundToInt(), offset.value.y.roundToInt()) }
                .size(SMALL_W, SMALL_H)
                .clip(RoundedCornerShape(12.dp))
                .background(Color.Black),
        ) {
            VideoView(track, mirror, Modifier.fillMaxSize(), overlay = true)
            Box(
                Modifier
                    .fillMaxSize()
                    .pointerInput(maxX, maxY) {
                        detectDragGestures(
                            onDragEnd = {
                                // Snaps to the nearest corner.
                                val v = offset.value
                                scope.launch {
                                    offset.animateTo(Offset(if (v.x < maxX / 2) 0f else maxX, if (v.y < maxY / 2) 0f else maxY.coerceAtLeast(0f)))
                                }
                            },
                        ) { change, drag ->
                            change.consume()
                            val v = offset.value
                            scope.launch {
                                offset.snapTo(Offset((v.x + drag.x).coerceIn(0f, maxX), (v.y + drag.y).coerceIn(0f, maxY.coerceAtLeast(0f))))
                            }
                        }
                    }
                    .pointerInput(Unit) { detectTapGestures(onTap = { onTap() }) },
            )
        }
    }
}

/** The small floating window: just the other person (or their photo). */
@Composable
private fun PipContent(state: CallManager.State, remote: VideoTrack?, peerName: String, peerPhoto: String?, peerColor: String?) {
    Box(Modifier.fillMaxSize().background(Color(0xFF111111)), contentAlignment = Alignment.Center) {
        if (remote != null) {
            VideoView(remote, mirror = false, Modifier.fillMaxSize())
        } else {
            Avatar(peerName, size = 64.dp, imageUrl = peerPhoto, color = peerColor?.let(::bubbleColor))
        }
        if (state.reconnecting) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
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
