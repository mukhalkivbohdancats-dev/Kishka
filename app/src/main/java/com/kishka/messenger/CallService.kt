package com.kishka.messenger

import android.app.*
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

class CallService : Service() {

    private lateinit var audioManager: AudioManager
    private var wakeLock: PowerManager.WakeLock? = null
    private var isMuted = false
    private var isSpeakerOn = false

    companion object {
        const val CHANNEL_ID = "KishkaCallChannel"
        const val NOTIFICATION_ID = 1001

        const val ACTION_START_CALL = "ACTION_START_CALL"
        const val ACTION_END_CALL = "ACTION_END_CALL"
        const val ACTION_TOGGLE_MUTE = "ACTION_TOGGLE_MUTE"
        const val ACTION_TOGGLE_SPEAKER = "ACTION_TOGGLE_SPEAKER"

        const val EXTRA_TARGET_NAME = "EXTRA_TARGET_NAME"
        const val EXTRA_TARGET_PHONE = "EXTRA_TARGET_PHONE"
    }

    override fun onCreate() {
        super.onCreate()
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START_CALL -> {
                val name = intent.getStringExtra(EXTRA_TARGET_NAME) ?: "Співрозмовник"
                val phone = intent.getStringExtra(EXTRA_TARGET_PHONE) ?: ""
                startForegroundCall(name, phone)
                enableHighQualityAudio()
                acquireProximityWakeLock()
            }
            ACTION_END_CALL -> {
                stopCall()
            }
            ACTION_TOGGLE_MUTE -> {
                isMuted = !isMuted
                audioManager.isMicrophoneMute = isMuted
            }
            ACTION_TOGGLE_SPEAKER -> {
                isSpeakerOn = !isSpeakerOn
                audioManager.isSpeakerphoneOn = isSpeakerOn
            }
        }
        return START_NOT_STICKY
    }

    /**
     * Налаштування аудіотракту за стандартом VoIP (Viber/WhatsApp):
     * вмикає системний AEC (Echo Cancellation) та Noise Suppression.
     */
    private fun enableHighQualityAudio() {
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .build()
            audioManager.requestAudioFocus(focusRequest)
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(
                null,
                AudioManager.STREAM_VOICE_CALL,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
            )
        }
    }

    private fun startForegroundCall(name: String, phone: String) {
        val notification = createCallNotification(name, phone)
        startForeground(NOTIFICATION_ID, notification)
    }

    private fun createCallNotification(name: String, phone: String): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val endCallIntent = Intent(this, CallService::class.java).apply {
            action = ACTION_END_CALL
        }
        val endCallPendingIntent = PendingIntent.getService(
            this, 1, endCallIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Голосовий дзвінок: $name")
            .setContentText("Триває розмова ($phone)...")
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Завершити", endCallPendingIntent)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Дзвінки Kishka Messenger",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Фонова служба голосових дзвінків"
                setSound(null, null)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    /**
     * Автоматично гасить екран при піднесенні до вуха.
     */
    private fun acquireProximityWakeLock() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        if (powerManager.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
            wakeLock = powerManager.newWakeLock(
                PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK,
                "KishkaMessenger::ProximityWakeLock"
            )
            wakeLock?.acquire(2 * 60 * 60 * 1000L)
        }
    }

    private fun stopCall() {
        audioManager.mode = AudioManager.MODE_NORMAL
        audioManager.isSpeakerphoneOn = false
        audioManager.isMicrophoneMute = false

        if (wakeLock?.isHeld == true) {
            wakeLock?.release()
        }

        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        stopCall()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
