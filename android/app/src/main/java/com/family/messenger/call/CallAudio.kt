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
 * Where call sound goes: a connected headset (Bluetooth, wired, USB) first, otherwise the earpiece,
 * or the loudspeaker when it's switched on. Follows headsets being plugged in or connected during the
 * call, and asks other apps (music, videos) to be quiet while the call is on.
 */
class CallAudio(context: Context) {
    private val am = context.getSystemService(AudioManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var focus: AudioFocusRequest? = null
    private var speaker = false
    private var active = false

    /** Called with whether a headset is in use, whenever that changes. */
    var onHeadsetChange: ((Boolean) -> Unit)? = null

    private val devices = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = reroute()
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = reroute()
    }

    /** True if a headset is connected right now. */
    fun headsetConnected(): Boolean = headset() != null

    fun start(speaker: Boolean) {
        this.speaker = speaker
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
            am.registerAudioDeviceCallback(devices, handler)
        }
        reroute()
    }

    fun setSpeaker(on: Boolean) {
        speaker = on
        reroute()
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

    private fun headset(): AudioDeviceInfo? {
        val outputs = if (Build.VERSION.SDK_INT >= 31) am.availableCommunicationDevices else am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList()
        return HEADSETS.firstNotNullOfOrNull { type -> outputs.firstOrNull { it.type == type } }
    }

    @Suppress("DEPRECATION")
    private fun reroute() {
        if (!active) return
        val headset = headset()
        if (Build.VERSION.SDK_INT >= 31) {
            val target = if (speaker) {
                am.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
            } else {
                headset ?: am.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
            }
            if (target != null && am.communicationDevice?.id != target.id) am.setCommunicationDevice(target)
        } else {
            val bluetooth = !speaker && headset?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
            if (bluetooth && !am.isBluetoothScoOn) {
                am.startBluetoothSco()
                am.isBluetoothScoOn = true
            } else if (!bluetooth && am.isBluetoothScoOn) {
                am.isBluetoothScoOn = false
                am.stopBluetoothSco()
            }
            // A wired headset takes the sound by itself once the loudspeaker is off.
            am.isSpeakerphoneOn = speaker
        }
        onHeadsetChange?.invoke(!speaker && headset != null)
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
