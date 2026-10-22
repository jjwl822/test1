package com.family.messenger.call

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper

/**
 * Where call sound goes: the earpiece, the loudspeaker, or a connected headset (Bluetooth, wired,
 * USB). A headset connected during the call takes over; one disconnected falls back to [fallback].
 * Other apps (music, videos) are asked to be quiet while the call is on.
 */
class CallAudio(context: Context) {
    enum class Route { EARPIECE, SPEAKER, HEADSET }

    private val am = context.getSystemService(AudioManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var focus: AudioFocusRequest? = null
    private var route = Route.EARPIECE
    private var fallback = Route.EARPIECE
    private var hadHeadset = false
    private var active = false

    /** Called with the route in use and whether a headset is connected, whenever either changes. */
    var onChange: ((route: Route, headsetAvailable: Boolean) -> Unit)? = null

    private val devices = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = devicesChanged()
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = devicesChanged()
    }

    /** The route a call should start on: a headset if one is connected, else [preferred]. */
    fun initialRoute(preferred: Route): Route = if (headset() != null) Route.HEADSET else preferred

    /** Starts call audio on [route]; [fallback] is used when a headset in use goes away. */
    fun start(route: Route, fallback: Route) {
        this.route = route
        this.fallback = fallback
        if (!active) {
            active = true
            am.mode = AudioManager.MODE_IN_COMMUNICATION
            focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                .build()
                .also { am.requestAudioFocus(it) }
            hadHeadset = headset() != null
            am.registerAudioDeviceCallback(devices, handler)
        }
        apply()
    }

    fun setRoute(route: Route) {
        this.route = if (route == Route.HEADSET && headset() == null) fallback else route
        apply()
    }

    @Suppress("DEPRECATION")
    fun stop() {
        if (!active) return
        active = false
        am.unregisterAudioDeviceCallback(devices)
        if (Build.VERSION.SDK_INT >= 31) {
            am.clearCommunicationDevice()
        } else {
            if (am.isBluetoothScoOn) {
                am.isBluetoothScoOn = false
                am.stopBluetoothSco()
            }
            am.isSpeakerphoneOn = false
        }
        focus?.let(am::abandonAudioFocusRequest)
        focus = null
        am.mode = AudioManager.MODE_NORMAL
    }

    private fun devicesChanged() {
        if (!active) return
        val has = headset() != null
        if (has && !hadHeadset) route = Route.HEADSET
        if (!has && route == Route.HEADSET) route = fallback
        hadHeadset = has
        apply()
    }

    private fun headset(): AudioDeviceInfo? {
        val outputs = if (Build.VERSION.SDK_INT >= 31) am.availableCommunicationDevices else am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList()
        return HEADSETS.firstNotNullOfOrNull { type -> outputs.firstOrNull { it.type == type } }
    }

    @Suppress("DEPRECATION")
    private fun apply() {
        if (!active) return
        val headset = headset()
        if (route == Route.HEADSET && headset == null) route = fallback
        if (Build.VERSION.SDK_INT >= 31) {
            val target = when (route) {
                Route.HEADSET -> headset
                Route.SPEAKER -> am.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
                Route.EARPIECE -> am.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
            }
            if (target != null && am.communicationDevice?.id != target.id) am.setCommunicationDevice(target)
        } else {
            val bluetooth = route == Route.HEADSET && headset?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
            if (bluetooth && !am.isBluetoothScoOn) {
                am.startBluetoothSco()
                am.isBluetoothScoOn = true
            } else if (!bluetooth && am.isBluetoothScoOn) {
                am.isBluetoothScoOn = false
                am.stopBluetoothSco()
            }
            // A wired headset takes the sound by itself once the loudspeaker is off. Choosing the
            // earpiece with a wired headset plugged in isn't possible on these Android versions.
            am.isSpeakerphoneOn = route == Route.SPEAKER
        }
        onChange?.invoke(route, headset != null)
    }

    private companion object {
        /** In order of preference. */
        val HEADSETS = buildList {
            add(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
            if (Build.VERSION.SDK_INT >= 31) add(AudioDeviceInfo.TYPE_BLE_HEADSET)
            add(AudioDeviceInfo.TYPE_WIRED_HEADSET)
            add(AudioDeviceInfo.TYPE_WIRED_HEADPHONES)
            add(AudioDeviceInfo.TYPE_USB_HEADSET)
        }
    }
}
