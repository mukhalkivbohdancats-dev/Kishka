package com.kishka.messenger

import android.annotation.SuppressLint
import android.app.*
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.Ringtone
import android.media.RingtoneManager
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class CallService : Service() {

    private lateinit var audioManager: AudioManager
    private lateinit var manager: KishkaManager
    private var wakeLock: PowerManager.WakeLock? = null
    private var ringtone: Ringtone? = null
    
    private var isMuted = false
    private var isSpeakerOn = false
    private var isCallActive = false

    private var targetEmail: String = ""
    private var myEmail: String = ""

    private var audioRecord: AudioRecord? = null
    private var audioTrack: AudioTrack? = null

    private var recordingThread: Thread? = null
    private var playbackThread: Thread? = null

    private val audioQueue = LinkedBlockingQueue<ByteArray>()

    private var acousticEchoCanceler: AcousticEchoCanceler? = null
    private var noiseSuppressor: NoiseSuppressor? = null

    companion object {
        const val CHANNEL_ID = "KishkaCallChannel"
        const val NOTIFICATION_ID = 1001

        const val ACTION_START_CALL = "ACTION_START_CALL"
        const val ACTION_INCOMING = "ACTION_INCOMING"
        const val ACTION_END_CALL = "ACTION_END_CALL"
        const val ACTION_TOGGLE_MUTE = "ACTION_TOGGLE_MUTE"
        const val ACTION_TOGGLE_SPEAKER = "ACTION_TOGGLE_SPEAKER"

        const val EXTRA_TARGET_NAME = "EXTRA_TARGET_NAME"
        const val EXTRA_TARGET_PHONE = "EXTRA_TARGET_PHONE"
        const val EXTRA_MY_EMAIL = "EXTRA_MY_EMAIL"

        private const val SAMPLE_RATE = 16000 // HD якість звуку[span_0](start_span)[span_0](end_span)
        private const val CHANNEL_CONFIG_IN = AudioFormat.CHANNEL_IN_MONO
        private const val CHANNEL_CONFIG_OUT = AudioFormat.CHANNEL_OUT_MONO
        private const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT
    }

    override fun onCreate() {
        super.onCreate()
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        manager = KishkaManager(applicationContext)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START_CALL -> {
                stopRingtone()
                val name = intent.getStringExtra(EXTRA_TARGET_NAME) ?: "Співрозмовник"
                targetEmail = intent.getStringExtra(EXTRA_TARGET_PHONE)?.trim()?.lowercase() ?: ""
                myEmail = intent.getStringExtra(EXTRA_MY_EMAIL)?.trim()?.lowercase() ?: ""
                
                isMuted = false
                audioManager.isMicrophoneMute = false
                
                startForegroundCall("Триває розмова: $name", targetEmail)
                enableHighQualityAudio()
                acquireProximityWakeLock()
                startAudioStreaming()
            }
            ACTION_INCOMING -> {
                val caller = intent.getStringExtra(EXTRA_TARGET_NAME) ?: "Невідомий"
                myEmail = intent.getStringExtra(EXTRA_MY_EMAIL)?.trim()?.lowercase() ?: ""
                startRingtone()
                startIncomingCallNotification(caller)
            }
            ACTION_END_CALL -> {
                stopCall()
            }
            ACTION_TOGGLE_MUTE -> {
                isMuted = !isMuted
                try {
                    audioManager.isMicrophoneMute = isMuted
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
            ACTION_TOGGLE_SPEAKER -> {
                isSpeakerOn = !isSpeakerOn
                try {
                    audioManager.isSpeakerphoneOn = isSpeakerOn
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }
        return START_STICKY
    }

    private fun startRingtone() {
        try {
            stopRingtone()
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            ringtone = RingtoneManager.getRingtone(applicationContext, uri)
            ringtone?.play()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun stopRingtone() {
        try {
            ringtone?.stop()
            ringtone = null
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun enableHighQualityAudio() {
        try {
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            audioManager.isMicrophoneMute = false
            audioManager.isSpeakerphoneOn = true // Автоматично вмикаємо динамік для комфортного дзвінка

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
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun createAudioRecord(minBuf: Int): AudioRecord? {
        val sources = intArrayOf(
            MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            MediaRecorder.AudioSource.MIC,
            MediaRecorder.AudioSource.CAMCORDER
        )
        for (source in sources) {
            try {
                val recorder = AudioRecord(
                    source,
                    SAMPLE_RATE,
                    CHANNEL_CONFIG_IN,
                    AUDIO_FORMAT,
                    minBuf * 2
                )
                if (recorder.state == AudioRecord.STATE_INITIALIZED) {
                    // Увімкнення апаратного ехоподавлення (AEC) для усунення відлуння
                    try {
                        if (AcousticEchoCanceler.isAvailable()) {
                            acousticEchoCanceler = AcousticEchoCanceler.create(recorder.audioSessionId)
                            acousticEchoCanceler?.enabled = true
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }

                    // Увімкнення шумозаглушення
                    try {
                        if (NoiseSuppressor.isAvailable()) {
                            noiseSuppressor = NoiseSuppressor.create(recorder.audioSessionId)
                            noiseSuppressor?.enabled = true
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }

                    return recorder
                } else {
                    recorder.release()
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
        return null
    }

    @SuppressLint("MissingPermission")
    private fun startAudioStreaming() {
        if (isCallActive) stopAudioStreaming()
        isCallActive = true
        audioQueue.clear()

        val minRecBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG_IN, AUDIO_FORMAT)
        val minTrackBuf = AudioTrack.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG_OUT, AUDIO_FORMAT)
        val frameSize = 960 // Оптимальний розмір фрейму для передачі без затримок

        try {
            audioRecord = createAudioRecord(minRecBuf)

            audioTrack = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AUDIO_FORMAT)
                        .setSampleRate(SAMPLE_RATE)
                        .setChannelMask(CHANNEL_CONFIG_OUT)
                        .build()
                )
                .setBufferSizeInBytes(minTrackBuf * 2)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()

            audioTrack?.play()
            audioRecord?.startRecording()

            if (myEmail.isNotEmpty()) {
                manager.listenForVoiceChunks(myEmail) { chunk ->
                    if (isCallActive) {
                        // Миттєве очищення черги при переповненні для уникнення затримок
                        if (audioQueue.size > 2) {
                            audioQueue.poll()
                        }
                        audioQueue.offer(chunk)
                    }
                }
            }

            // Потік відтворення вхідного голосу
            playbackThread = thread(start = true) {
                while (isCallActive) {
                    try {
                        val chunk = audioQueue.poll(10, TimeUnit.MILLISECONDS)
                        if (chunk != null && isCallActive) {
                            audioTrack?.write(chunk, 0, chunk.size)
                        }
                    } catch (e: Exception) {
                        break
                    }
                }
            }

            // Потік запису та відправки голосу
            recordingThread = thread(start = true) {
                val buffer = ByteArray(frameSize)

                while (isCallActive) {
                    val rec = audioRecord
                    if (rec == null || rec.state != AudioRecord.STATE_INITIALIZED) {
                        try { Thread.sleep(50) } catch (e: Exception) { break }
                        continue
                    }

                    val read = rec.read(buffer, 0, frameSize)
                    if (read > 0) {
                        if (!isMuted && targetEmail.isNotEmpty()) {
                            val chunkToSend = if (read == frameSize) buffer else buffer.copyOf(read)
                            manager.sendVoiceChunk(targetEmail, chunkToSend)
                        }
                    } else {
                        try {
                            rec.stop()
                            rec.startRecording()
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }
                        try { Thread.sleep(10) } catch (e: Exception) { break }
                    }
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun stopAudioStreaming() {
        isCallActive = false
        if (myEmail.isNotEmpty()) {
            manager.stopListeningForVoiceChunks(myEmail)
        }

        audioQueue.clear()

        try {
            acousticEchoCanceler?.release()
            acousticEchoCanceler = null
        } catch (e: Exception) {
            e.printStackTrace()
        }

        try {
            noiseSuppressor?.release()
            noiseSuppressor = null
        } catch (e: Exception) {
            e.printStackTrace()
        }

        try {
            playbackThread?.interrupt()
            playbackThread?.join(100)
            playbackThread = null
        } catch (e: Exception) {
            e.printStackTrace()
        }

        try {
            recordingThread?.interrupt()
            recordingThread?.join(100)
            recordingThread = null
        } catch (e: Exception) {
            e.printStackTrace()
        }

        try {
            audioRecord?.stop()
            audioRecord?.release()
            audioRecord = null
        } catch (e: Exception) {
            e.printStackTrace()
        }

        try {
            audioTrack?.stop()
            audioTrack?.release()
            audioTrack = null
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun startForegroundCall(title: String, phone: String) {
        val notification = createCallNotification(title, phone)
        startForeground(NOTIFICATION_ID, notification)
    }

    private fun startIncomingCallNotification(callerName: String) {
        val fullScreenIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val fullScreenPendingIntent = PendingIntent.getActivity(
            this, 0, fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val answerIntent = Intent(this, CallService::class.java).apply {
            action = ACTION_START_CALL
            putExtra(EXTRA_TARGET_NAME, callerName)
            putExtra(EXTRA_TARGET_PHONE, callerName)
            putExtra(EXTRA_MY_EMAIL, myEmail)
        }
        val answerPendingIntent = PendingIntent.getService(
            this, 2, answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val endCallIntent = Intent(this, CallService::class.java).apply {
            action = ACTION_END_CALL
        }
        val endCallPendingIntent = PendingIntent.getService(
            this, 1, endCallIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Вхідний виклик Kishka")
            .setContentText("Дзвонить: $callerName")
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(fullScreenPendingIntent)
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .addAction(android.R.drawable.ic_menu_call, "Прийняти", answerPendingIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Відхилити", endCallPendingIntent)
            .build()

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
            .setContentTitle(name)
            .setContentText("Дзвінок Kishka Messenger ($phone)...")
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

    private fun acquireProximityWakeLock() {
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (powerManager.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
                wakeLock = powerManager.newWakeLock(
                    PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK,
                    "KishkaMessenger::ProximityWakeLock"
                )
                wakeLock?.acquire(2 * 60 * 60 * 1000L)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun stopCall() {
        stopAudioStreaming()
        stopRingtone()
        try {
            audioManager.mode = AudioManager.MODE_NORMAL
            audioManager.isSpeakerphoneOn = false
            audioManager.isMicrophoneMute = false
        } catch (e: Exception) {
            e.printStackTrace()
        }

        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        } catch (e: Exception) {
            e.printStackTrace()
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
