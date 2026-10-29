package com.kishka.messenger

import android.annotation.SuppressLint
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
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
import android.net.wifi.WifiManager
import android.os.IBinder
import android.os.PowerManager
import android.os.Process
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class CallService : Service() {

    private lateinit var audioManager: AudioManager
    private lateinit var manager: KishkaManager
    private var wakeLock: PowerManager.WakeLock? = null
    private var cpuWakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var ringtone: Ringtone? = null
    
    @Volatile
    private var isMuted = false
    @Volatile
    private var isCallActive = false
    private var stopped = false
    private var focusRequest: AudioFocusRequest? = null

    private var targetEmail: String = ""
    private var peerName: String = ""
    private var myEmail: String = ""

    private var audioRecord: AudioRecord? = null
    private var audioTrack: AudioTrack? = null

    private var recordingThread: Thread? = null
    private var playbackThread: Thread? = null

    private val audioQueue = LinkedBlockingQueue<ByteArray>()

    private var acousticEchoCanceler: AcousticEchoCanceler? = null
    private var noiseSuppressor: NoiseSuppressor? = null

    @Volatile
    private var captureRate = 0

    companion object {
        const val CHANNEL_ID = "KishkaCallChannel"
        const val NOTIFICATION_ID = 1001

        const val ACTION_START_CALL = "ACTION_START_CALL"   // розмова почалась: вмикаємо звук
        const val ACTION_OUTGOING = "ACTION_OUTGOING"       // ми телефонуємо, чекаємо відповіді
        const val ACTION_INCOMING = "ACTION_INCOMING"       // нам телефонують
        const val ACTION_END_CALL = "ACTION_END_CALL"       // лише зупинити службу (сервер уже знає)
        const val ACTION_HANGUP = "ACTION_HANGUP"           // кнопка "Завершити" в сповіщенні
        const val ACTION_DECLINE = "ACTION_DECLINE"         // кнопка "Відхилити" в сповіщенні
        const val ACTION_APPLY_AUDIO = "ACTION_APPLY_AUDIO" // застосувати мікрофон / динамік / гучність
        const val ACTION_TOGGLE_MUTE = "ACTION_TOGGLE_MUTE"
        const val ACTION_TOGGLE_SPEAKER = "ACTION_TOGGLE_SPEAKER"

        const val EXTRA_TARGET_NAME = "EXTRA_TARGET_NAME"
        const val EXTRA_TARGET_PHONE = "EXTRA_TARGET_PHONE"
        const val EXTRA_MY_EMAIL = "EXTRA_MY_EMAIL"

        // HD-голос: пробуємо 24 кГц, якщо телефон не підтримує — 16 кГц. Пакети по 40 мс.
        private val CAPTURE_RATES = intArrayOf(24000, 16000)
        private const val FRAME_MS = 40
        private const val PREBUFFER_FRAMES = 3      // 120 мс буфера від мережевих "ривків"
        private const val MAX_BACKLOG_FRAMES = 10   // якщо назбиралося більше 400 мс — наздоганяємо
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
        if (intent == null) {
            // Система перезапустила службу без дзвінка — тут нема що продовжувати
            stopSelf()
            return START_NOT_STICKY
        }

        val action = intent.action
        val name = intent.getStringExtra(EXTRA_TARGET_NAME)?.takeIf { it.isNotBlank() }
        val phone = intent.getStringExtra(EXTRA_TARGET_PHONE)?.trim()?.lowercase()
        val mine = intent.getStringExtra(EXTRA_MY_EMAIL)?.trim()?.lowercase()
        if (name != null) peerName = name
        if (!phone.isNullOrEmpty()) targetEmail = phone
        if (!mine.isNullOrEmpty()) myEmail = mine

        when (action) {
            ACTION_INCOMING -> {
                stopped = false
                startFg(buildIncomingNotification(), microphone = false)
                startRingtone()
            }
            ACTION_OUTGOING -> {
                stopped = false
                startFg(buildOngoingNotification(outgoing = true), microphone = true)
            }
            ACTION_START_CALL -> {
                stopped = false
                stopRingtone()
                CallSession.volume = currentVolumeFraction()
                startFg(buildOngoingNotification(outgoing = false), microphone = true)
                enableHighQualityAudio()
                applyAudioState()
                acquireNetworkLocks()
                startAudioStreaming()
                updateProximity()
            }
            ACTION_END_CALL -> stopCall()
            ACTION_HANGUP -> {
                if (CallSession.phase != CallPhase.IDLE) CallCoordinator.end() else stopCall()
            }
            ACTION_DECLINE -> {
                if (CallSession.phase == CallPhase.INCOMING) CallCoordinator.decline() else stopCall()
            }
            ACTION_APPLY_AUDIO -> applyAudioState()
            ACTION_TOGGLE_MUTE -> CallCoordinator.toggleMute()
            ACTION_TOGGLE_SPEAKER -> CallCoordinator.toggleSpeaker()
        }
        return START_NOT_STICKY
    }

    private fun startFg(notification: Notification, microphone: Boolean) {
        try {
            when {
                Build.VERSION.SDK_INT >= 30 -> {
                    var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
                    if (microphone) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                    startForeground(NOTIFICATION_ID, notification, type)
                }
                Build.VERSION.SDK_INT >= 29 ->
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
                else -> startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            e.printStackTrace()
            try {
                startForeground(NOTIFICATION_ID, notification)
            } catch (e2: Exception) {
                e2.printStackTrace()
            }
        }
    }

    private fun currentVolumeFraction(): Float {
        return try {
            val max = audioManager.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL).coerceAtLeast(1)
            (audioManager.getStreamVolume(AudioManager.STREAM_VOICE_CALL).toFloat() / max).coerceIn(0.1f, 1f)
        } catch (e: Exception) {
            0.7f
        }
    }

    /** Застосовує мікрофон, динамік і гучність із CallSession (єдине джерело правди). */
    private fun applyAudioState() {
        isMuted = CallSession.muted
        try {
            audioManager.isMicrophoneMute = isMuted
        } catch (e: Exception) {
            e.printStackTrace()
        }
        try {
            @Suppress("DEPRECATION")
            audioManager.isSpeakerphoneOn = CallSession.speakerOn
        } catch (e: Exception) {
            e.printStackTrace()
        }
        try {
            val max = audioManager.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL).coerceAtLeast(1)
            val index = Math.round(CallSession.volume * max).coerceIn(1, max)
            audioManager.setStreamVolume(AudioManager.STREAM_VOICE_CALL, index, 0)
        } catch (e: Exception) {
            e.printStackTrace()
        }
        updateProximity()
    }

    /** Біля вуха екран гасне; на гучному зв'язку — ні. */
    private fun updateProximity() {
        try {
            if (CallSession.speakerOn) {
                if (wakeLock?.isHeld == true) wakeLock?.release()
            } else if (isCallActive) {
                acquireProximityWakeLock()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun startRingtone() {
        try {
            stopRingtone()
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            ringtone = RingtoneManager.getRingtone(applicationContext, uri)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) ringtone?.isLooping = true
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

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build()
                    )
                    .build()
                this.focusRequest = focusRequest
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

    @SuppressLint("MissingPermission")
    private fun createAudioRecord(): AudioRecord? {
        val sources = intArrayOf(
            MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            MediaRecorder.AudioSource.MIC
        )
        for (rate in CAPTURE_RATES) {
            val minBuf = AudioRecord.getMinBufferSize(rate, CHANNEL_CONFIG_IN, AUDIO_FORMAT)
            if (minBuf <= 0) continue
            val frameBytes = rate * FRAME_MS / 1000 * 2
            for (source in sources) {
                try {
                    val recorder = AudioRecord(
                        source,
                        rate,
                        CHANNEL_CONFIG_IN,
                        AUDIO_FORMAT,
                        maxOf(minBuf * 2, frameBytes * 4)
                    )
                    if (recorder.state == AudioRecord.STATE_INITIALIZED) {
                        try {
                            if (AcousticEchoCanceler.isAvailable()) {
                                acousticEchoCanceler = AcousticEchoCanceler.create(recorder.audioSessionId)
                                acousticEchoCanceler?.enabled = true
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }

                        try {
                            if (NoiseSuppressor.isAvailable()) {
                                noiseSuppressor = NoiseSuppressor.create(recorder.audioSessionId)
                                noiseSuppressor?.enabled = true
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }

                        captureRate = rate
                        return recorder
                    } else {
                        recorder.release()
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }
        return null
    }

    private fun createAudioTrack(rate: Int): AudioTrack? {
        return try {
            val minBuf = AudioTrack.getMinBufferSize(rate, CHANNEL_CONFIG_OUT, AUDIO_FORMAT)
            val frameBytes = rate * FRAME_MS / 1000 * 2
            val builder = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AUDIO_FORMAT)
                        .setSampleRate(rate)
                        .setChannelMask(CHANNEL_CONFIG_OUT)
                        .build()
                )
                .setBufferSizeInBytes(maxOf(minBuf, frameBytes * 3))
                .setTransferMode(AudioTrack.MODE_STREAM)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                builder.setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
            }
            builder.build()
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    @SuppressLint("MissingPermission")
    private fun startAudioStreaming() {
        if (isCallActive) stopAudioStreaming()
        isCallActive = true
        audioQueue.clear()

        try {
            audioRecord = createAudioRecord()
            audioRecord?.startRecording()

            if (myEmail.isNotEmpty()) {
                manager.listenForVoiceChunks(myEmail) { chunk ->
                    if (isCallActive) {
                        audioQueue.offer(chunk)
                    }
                }
            }

            playbackThread = thread(start = true, name = "KishkaVoicePlayback") { runPlayback() }
            recordingThread = thread(start = true, name = "KishkaVoiceCapture") { runCapture() }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /** Мікрофон -> ADPCM-пакети по 40 мс -> сервер. */
    private fun runCapture() {
        try {
            Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        } catch (e: Exception) {
            e.printStackTrace()
        }

        val rec = audioRecord ?: return
        val rate = captureRate
        if (rate <= 0) return

        val rateCode = VoiceCodec.rateToCode(rate)
        val samplesPerFrame = rate * FRAME_MS / 1000
        val pcm = ShortArray(samplesPerFrame)
        val encoderState = VoiceCodec.EncoderState()
        var sequence = 0

        while (isCallActive) {
            var read = 0
            while (read < samplesPerFrame && isCallActive) {
                val n = rec.read(pcm, read, samplesPerFrame - read)
                if (n > 0) {
                    read += n
                } else {
                    try {
                        Thread.sleep(if (n < 0) 10L else 2L)
                    } catch (e: InterruptedException) {
                        return
                    }
                    if (n < 0) break
                }
            }
            if (read < samplesPerFrame) continue

            if (!isMuted && targetEmail.isNotEmpty()) {
                val packet = VoiceCodec.encodePacket(rateCode, sequence and 0xFFFF, pcm, samplesPerFrame, encoderState)
                sequence++
                manager.sendVoiceChunk(targetEmail, packet)
            }
        }
    }

    /** Мережа -> буфер від "ривків" -> декодування -> динамік. */
    private fun runPlayback() {
        try {
            Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        } catch (e: Exception) {
            e.printStackTrace()
        }

        var track: AudioTrack? = null
        var trackRate = 0
        var buffering = true

        try {
            while (isCallActive) {
                if (buffering) {
                    if (audioQueue.size >= PREBUFFER_FRAMES) {
                        buffering = false
                    } else {
                        Thread.sleep(8)
                        continue
                    }
                }

                val polled = audioQueue.poll(FRAME_MS * 3L, TimeUnit.MILLISECONDS)
                if (polled == null) {
                    // Дані не встигли дійти: накопичуємо буфер заново, щоб не було "рубання"
                    buffering = true
                    continue
                }
                var packet: ByteArray = polled

                // Після мережевого "залпу" пропускаємо застарілі пакети, щоб не наростала затримка
                if (audioQueue.size > MAX_BACKLOG_FRAMES) {
                    while (audioQueue.size > PREBUFFER_FRAMES) {
                        val newer = audioQueue.poll() ?: break
                        packet = newer
                    }
                }

                val rate = VoiceCodec.packetSampleRate(packet)
                if (rate == 0) continue

                if (track == null || trackRate != rate) {
                    try {
                        track?.stop()
                        track?.release()
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                    track = createAudioTrack(rate)
                    trackRate = rate
                    audioTrack = track
                    track?.play()
                }

                val pcm = VoiceCodec.decodePacket(packet) ?: continue
                track?.write(pcm, 0, pcm.size)
            }
        } catch (e: InterruptedException) {
            // Дзвінок завершено
        } catch (e: Exception) {
            e.printStackTrace()
        } finally {
            try {
                track?.stop()
                track?.release()
            } catch (e: Exception) {
                e.printStackTrace()
            }
            audioTrack = null
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
            playbackThread?.join(300)
            playbackThread = null
        } catch (e: Exception) {
            e.printStackTrace()
        }

        try {
            recordingThread?.interrupt()
            recordingThread?.join(300)
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

        captureRate = 0
    }

    /** CPU і Wi-Fi не "засинають" під час розмови: це прибирає ривки звуку при вимкненому екрані. */
    private fun acquireNetworkLocks() {
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            cpuWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "KishkaMessenger::CallCpu")
            cpuWakeLock?.setReferenceCounted(false)
            cpuWakeLock?.acquire(2 * 60 * 60 * 1000L)
        } catch (e: Exception) {
            e.printStackTrace()
        }

        try {
            val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            @Suppress("DEPRECATION")
            val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                WifiManager.WIFI_MODE_FULL_LOW_LATENCY
            } else {
                WifiManager.WIFI_MODE_FULL_HIGH_PERF
            }
            wifiLock = wm.createWifiLock(mode, "KishkaMessenger::CallWifi")
            wifiLock?.setReferenceCounted(false)
            wifiLock?.acquire()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun releaseNetworkLocks() {
        try {
            if (cpuWakeLock?.isHeld == true) cpuWakeLock?.release()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        cpuWakeLock = null

        try {
            if (wifiLock?.isHeld == true) wifiLock?.release()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        wifiLock = null
    }

    private fun immutableFlags() = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

    private fun activityIntent(extraAction: String?): Intent =
        Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("EXTRA_SHOW_ON_LOCK", true)
            if (extraAction != null) putExtra(CallCoordinator.EXTRA_CALL_ACTION, extraAction)
        }

    private fun serviceIntent(action: String): Intent =
        Intent(this, CallService::class.java).apply { this.action = action }

    /** Вхідний дзвінок: кнопки "Прийняти" та "Відхилити" реально повідомляють сервер (через CallCoordinator). */
    private fun buildIncomingNotification(): Notification {
        val openPending = PendingIntent.getActivity(this, 10, activityIntent(CallCoordinator.CALL_ACTION_OPEN), immutableFlags())
        val acceptPending = PendingIntent.getActivity(this, 11, activityIntent(CallCoordinator.CALL_ACTION_ACCEPT), immutableFlags())
        val declinePending = PendingIntent.getService(this, 12, serviceIntent(ACTION_DECLINE), immutableFlags())
        val title = AppText.tr(this, "call_incoming_title")
        val text = AppText.tr(this, "call_incoming_from", peerName.ifEmpty { targetEmail })

        val base = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(openPending)
            .setFullScreenIntent(openPending, true)

        return try {
            val person = Person.Builder().setName(peerName.ifEmpty { targetEmail }).setImportant(true).build()
            base.setContentText(text)
                .setStyle(NotificationCompat.CallStyle.forIncomingCall(person, declinePending, acceptPending))
                .build()
        } catch (e: Exception) {
            e.printStackTrace()
            base.setContentTitle(title)
                .setContentText(text)
                .addAction(android.R.drawable.ic_menu_call, AppText.tr(this, "call_accept"), acceptPending)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, AppText.tr(this, "call_decline"), declinePending)
                .build()
        }
    }

    private fun buildOngoingNotification(outgoing: Boolean): Notification {
        val openPending = PendingIntent.getActivity(this, 13, activityIntent(CallCoordinator.CALL_ACTION_OPEN), immutableFlags())
        val hangPending = PendingIntent.getService(this, 14, serviceIntent(ACTION_HANGUP), immutableFlags())
        val who = peerName.ifEmpty { targetEmail }
        val text = if (outgoing) AppText.tr(this, "call_calling", who) else AppText.tr(this, "call_ongoing", who)

        val base = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentText(text)
            .setContentIntent(openPending)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)

        return try {
            val person = Person.Builder().setName(who).setImportant(true).build()
            base.setStyle(NotificationCompat.CallStyle.forOngoingCall(person, hangPending)).build()
        } catch (e: Exception) {
            e.printStackTrace()
            base.setContentTitle(who)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, AppText.tr(this, "call_end"), hangPending)
                .build()
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                AppText.tr(this, "call_channel"),
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = AppText.tr(this@CallService, "call_channel_desc")
                setSound(null, null)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun acquireProximityWakeLock() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        try {
            if (wakeLock?.isHeld == true) return
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
        if (stopped) return
        stopped = true
        stopAudioStreaming()
        stopRingtone()
        try {
            audioManager.mode = AudioManager.MODE_NORMAL
            @Suppress("DEPRECATION")
            audioManager.isSpeakerphoneOn = false
            audioManager.isMicrophoneMute = false
        } catch (e: Exception) {
            e.printStackTrace()
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
            }
            focusRequest = null
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
        releaseNetworkLocks()

        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        stopCall()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
