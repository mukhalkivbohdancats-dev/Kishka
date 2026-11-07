package com.kishka.messenger

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import io.socket.client.Ack
import io.socket.client.Socket
import io.socket.emitter.Emitter
import org.json.JSONObject

enum class CallPhase { IDLE, OUTGOING, INCOMING, ACTIVE }

/**
 * Стан дзвінка, що живе ПОЗА екраном (як GeminiSession): не зникає при повороті екрана, згортанні,
 * перезаході в застосунок. Екран лише показує цей стан.
 */
object CallSession {
    var phase by mutableStateOf(CallPhase.IDLE)
    var peerEmail by mutableStateOf("")
    var peerName by mutableStateOf("")
    var peerAvatar by mutableStateOf<String?>(null)

    /** Час початку розмови (System.currentTimeMillis), 0 — поки не відповіли. */
    var startedAt by mutableStateOf(0L)
    var muted by mutableStateOf(false)
    var speakerOn by mutableStateOf(false)
    /** Гучність розмови 0..1 = рівень системної гучності дзвінка (кнопки гучності телефона теж її змінюють). */
    var volume by mutableStateOf(0.7f)

    /** Користувач тягне повзунок: у цей час слідкуємо лише за пальцем, а не за системою (інакше повзунок «стрибає»). */
    @Volatile var volumeDragging = false

    /** Екран дзвінка згорнуто в смужку зверху (дзвінок триває). */
    var minimized by mutableStateOf(false)

    /** Камера / екран, увімкнені ще ДО відповіді: вмикаються самі, щойно розмова почалась. "camera" | "screen" | null */
    var pendingVideo by mutableStateOf<String?>(null)
    var pendingProjectionCode: Int = 0
    var pendingProjectionData: Intent? = null

    /** Програмна гучність (0..1): діє лише якщо телефон не дав змінити системну гучність розмови. */
    @Volatile var softGain: Float = 1f
}

/**
 * Єдине місце, що керує дзвінками: слухає сервер (навіть коли застосунок закрито — з фонової служби),
 * змінює CallSession, запускає CallService, пише історію дзвінків.
 */
object CallCoordinator {
    const val EXTRA_CALL_ACTION = "EXTRA_CALL_ACTION"
    const val CALL_ACTION_ACCEPT = "accept"
    const val CALL_ACTION_OPEN = "open"

    private const val RING_TIMEOUT_MS = 65_000L
    private const val MISSED_CHANNEL_ID = "KishkaMissedCalls"

    private val handler = Handler(Looper.getMainLooper())
    private var appContext: Context? = null
    private var manager: KishkaManager? = null
    private var myEmail = ""
    private var registeredFor = ""
    private var timeoutRunnable: Runnable? = null
    private var connectListener: Emitter.Listener? = null

    private var direction = "out"
    private var wasAnswered = false
    private var ringStartedWall = 0L

    private val ctx: Context? get() = appContext

    /** Викликається і з екрана, і з фонової служби (безпечно повторювати). */
    fun init(context: Context, email: String) {
        val clean = email.trim().lowercase()
        if (clean.isEmpty()) return
        appContext = context.applicationContext
        myEmail = clean
        if (manager == null) manager = KishkaManager(appContext!!)
        registerListeners(clean)
    }

    /** Вихід з акаунта. */
    fun reset() {
        if (CallSession.phase != CallPhase.IDLE) end()
        unregisterListeners()
        myEmail = ""
    }

    private fun unregisterListeners() {
        if (registeredFor.isEmpty()) return
        try {
            val s = KishkaManager.getSocket()
            listOf("incoming_call_", "call_answered_", "call_rejected_", "call_ended_", "call_busy_", "call_unavailable_")
                .forEach { s.off(it + registeredFor) }
            connectListener?.let { s.off(Socket.EVENT_CONNECT, it) }
            connectListener = null
        } catch (e: Exception) {
            e.printStackTrace()
        }
        registeredFor = ""
    }

    private fun registerListeners(me: String) {
        if (registeredFor.isNotEmpty() && registeredFor != me) unregisterListeners()
        val socket = KishkaManager.getSocket()
        registeredFor = me

        socket.off("incoming_call_$me")
        socket.on("incoming_call_$me") { args ->
            val obj = args.firstOrNull() as? JSONObject
            if (obj != null) handler.post { onIncoming(obj) }
        }
        socket.off("call_answered_$me")
        socket.on("call_answered_$me") { args ->
            val peer = peerOf(args)
            handler.post { onAnswered(peer) }
        }
        socket.off("call_rejected_$me")
        socket.on("call_rejected_$me") { args ->
            val peer = peerOf(args)
            handler.post { onRejected(peer) }
        }
        socket.off("call_ended_$me")
        socket.on("call_ended_$me") { args ->
            val reason = (args.firstOrNull() as? JSONObject)?.optString("reason", "") ?: ""
            val peer = peerOf(args)
            handler.post { onEnded(reason, peer) }
        }
        socket.off("call_busy_$me")
        socket.on("call_busy_$me") { args ->
            val peer = peerOf(args)
            handler.post { onBusy(peer) }
        }
        socket.off("call_unavailable_$me")
        socket.on("call_unavailable_$me") { args ->
            val peer = peerOf(args)
            handler.post { onUnavailable(peer) }
        }

        // Після кожного відновлення зв'язку питаємо сервер, чи дзвінок ще триває: його могли завершити, поки зв'язку не було
        connectListener?.let { socket.off(Socket.EVENT_CONNECT, it) }
        val listener = Emitter.Listener { handler.post { checkCallAlive() } }
        connectListener = listener
        socket.on(Socket.EVENT_CONNECT, listener)
    }

    /** Хто співрозмовник у події сервера (порожньо, якщо сервер старої версії цього не надсилає). */
    private fun peerOf(args: Array<out Any?>): String =
        ((args.firstOrNull() as? JSONObject)?.optString("peer", "") ?: "").trim().lowercase()

    /**
     * Подія належить іншому (вже завершеному) дзвінку — її треба ігнорувати. Раніше «запізнілий» відбій попереднього
     * дзвінка рвав новий дзвінок, який людина встигла набрати одразу після нього.
     */
    private fun isStale(peer: String): Boolean =
        peer.isNotEmpty() && CallSession.peerEmail.isNotEmpty() && peer != CallSession.peerEmail

    private fun checkCallAlive() {
        val phase = CallSession.phase
        if (phase == CallPhase.IDLE) return
        val peer = CallSession.peerEmail
        if (peer.isEmpty() || myEmail.isEmpty()) return
        val since = if (phase == CallPhase.ACTIVE && CallSession.startedAt > 0L) CallSession.startedAt else ringStartedWall
        // Щойно почався або прийнятий дзвінок: сервер міг ще не встигнути його оформити
        if (System.currentTimeMillis() - since < 4000L) return
        try {
            val json = JSONObject().apply {
                put("me", myEmail)
                put("peer", peer)
            }
            KishkaManager.getSocket().emit("call_check", json, Ack { args ->
                val res = args.firstOrNull() as? JSONObject
                if (res != null) {
                    val active = res.optBoolean("active", true)
                    handler.post {
                        if (!active && CallSession.phase == phase && CallSession.peerEmail == peer) onEnded("lost", peer)
                    }
                }
            })
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // ===================== Дії користувача =====================

    fun startOutgoing(peer: String, name: String?, avatar: String?) {
        val context = ctx ?: return
        val target = peer.trim().lowercase()
        if (target.isEmpty() || myEmail.isEmpty()) return

        if (CallSession.phase != CallPhase.IDLE) {
            if (CallSession.peerEmail == target) {
                CallSession.minimized = false
            } else {
                Notice.show(AppText.tr(context, "line_busy_self"))
            }
            return
        }

        direction = "out"
        wasAnswered = false
        ringStartedWall = System.currentTimeMillis()
        CallSession.peerEmail = target
        CallSession.peerName = name?.takeIf { it.isNotBlank() } ?: (LocalStore.get(context).contactName(myEmail, target) ?: target)
        CallSession.peerAvatar = avatar
        CallSession.startedAt = 0L
        CallSession.muted = false
        CallSession.speakerOn = false
        CallSession.minimized = false
        CallSession.phase = CallPhase.OUTGOING

        manager?.startCall(myEmail, target)
        startService(CallService.ACTION_OUTGOING)
        scheduleTimeout { if (CallSession.phase == CallPhase.OUTGOING) end() }
    }

    fun accept() {
        if (CallSession.phase != CallPhase.INCOMING) return
        cancelTimeout()
        wasAnswered = true
        manager?.answerCall(CallSession.peerEmail, myEmail)
        CallSession.startedAt = System.currentTimeMillis()
        CallSession.minimized = false
        CallSession.phase = CallPhase.ACTIVE
        startService(CallService.ACTION_START_CALL)
        applyPendingVideo()
    }

    fun decline() {
        if (CallSession.phase != CallPhase.INCOMING) return
        manager?.rejectCall(CallSession.peerEmail, myEmail)
        logCall(missed = true, status = "declined")
        finishLocal()
    }

    /** Покласти слухавку (у будь-якому стані). */
    fun end() {
        when (CallSession.phase) {
            CallPhase.IDLE -> return
            CallPhase.INCOMING -> decline()
            else -> {
                manager?.endCall(myEmail, CallSession.peerEmail)
                logCall(missed = !wasAnswered, status = if (wasAnswered) "ended" else "cancelled")
                finishLocal()
            }
        }
    }

    fun minimize() {
        if (CallSession.phase != CallPhase.IDLE) CallSession.minimized = true
    }

    fun expand() {
        CallSession.minimized = false
    }

    fun toggleMute() {
        CallSession.muted = !CallSession.muted
        applyAudio()
    }

    fun toggleSpeaker() {
        CallSession.speakerOn = !CallSession.speakerOn
        applyAudio()
    }

    private fun audioManager(): AudioManager? =
        try {
            ctx?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        } catch (e: Exception) {
            null
        }

    /** Кількість кроків системної гучності розмови (зазвичай 5-7). */
    fun volumeMax(): Int =
        try {
            (audioManager()?.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL) ?: 7).coerceAtLeast(1)
        } catch (e: Exception) {
            7
        }

    /**
     * Повзунок гучності змінює РЕАЛЬНУ системну гучність розмови. Запис іде лише тоді, коли значення справді змінилось, і
     * ніяких додаткових перемикань звуку (раніше кожен рух повзунка перемикав маршрут звуку — гучність «плигала» безкінечно).
     */
    fun setVolume(value: Float) {
        val am = audioManager() ?: return
        val max = volumeMax()
        val index = Math.round(value.coerceIn(0f, 1f) * max).coerceIn(0, max)
        CallSession.volume = index.toFloat() / max
        try {
            if (am.getStreamVolume(AudioManager.STREAM_VOICE_CALL) != index) {
                am.setStreamVolume(AudioManager.STREAM_VOICE_CALL, index, 0)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        // Якщо система не прийняла значення (деякі телефони), гучність змінюється програмно — повзунок працює завжди
        val applied = try {
            am.getStreamVolume(AudioManager.STREAM_VOICE_CALL)
        } catch (e: Exception) {
            index
        }
        CallSession.softGain = if (applied == index) 1f else (CallSession.volume.coerceIn(0.03f, 1f))
    }

    /** Повзунок слідкує за кнопками гучності телефона. Лише читання, без запису назад — зациклення неможливе. */
    fun syncVolume() {
        if (CallSession.volumeDragging) return
        val am = audioManager() ?: return
        try {
            val max = volumeMax()
            val value = am.getStreamVolume(AudioManager.STREAM_VOICE_CALL).toFloat() / max
            // Програмна гучність (система не дала змінити свою): повзунок лишається там, де його поставили
            if (CallSession.softGain < 1f) return
            if (Math.abs(value - CallSession.volume) > 0.001f) CallSession.volume = value
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // ===================== Відео в дзвінку =====================

    private fun videoIntent(action: String, block: (Intent) -> Unit = {}) {
        val context = ctx ?: return
        if (CallSession.phase != CallPhase.ACTIVE) return
        val intent = Intent(context, CallService::class.java).apply {
            this.action = action
            putExtra(CallService.EXTRA_TARGET_NAME, CallSession.peerName)
            putExtra(CallService.EXTRA_TARGET_PHONE, CallSession.peerEmail)
            putExtra(CallService.EXTRA_MY_EMAIL, myEmail)
            block(this)
        }
        try {
            ContextCompat.startForegroundService(context, intent)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun beforeAnswer(): Boolean =
        CallSession.phase == CallPhase.OUTGOING || CallSession.phase == CallPhase.INCOMING

    /**
     * Камера: за замовчуванням задня. Дозвіл CAMERA має бути вже наданий (екран дзвінка питає його перед викликом).
     * Якщо співрозмовник ще не відповів — камера вмикається автоматично, щойно він відповість.
     */
    fun startCamera(front: Boolean = false) {
        if (beforeAnswer()) {
            CallSession.pendingProjectionData = null
            CallSession.pendingVideo = "camera"
            return
        }
        videoIntent(CallService.ACTION_VIDEO_CAMERA) {
            it.putExtra(CallService.EXTRA_VIDEO_FRONT, front)
        }
    }

    fun flipCamera() = videoIntent(CallService.ACTION_VIDEO_FLIP)

    /** Трансляція екрана телефона; resultCode і data дає системне вікно дозволу на запис екрана. */
    fun startScreen(resultCode: Int, data: Intent) {
        if (beforeAnswer()) {
            CallSession.pendingProjectionCode = resultCode
            CallSession.pendingProjectionData = data
            CallSession.pendingVideo = "screen"
            return
        }
        videoIntent(CallService.ACTION_VIDEO_SCREEN) {
            it.putExtra(CallService.EXTRA_PROJECTION_CODE, resultCode)
            it.putExtra(CallService.EXTRA_PROJECTION_DATA, data)
        }
    }

    fun stopVideo() {
        if (CallSession.pendingVideo != null) {
            clearPendingVideo()
            return
        }
        videoIntent(CallService.ACTION_VIDEO_STOP)
    }

    private fun clearPendingVideo() {
        CallSession.pendingVideo = null
        CallSession.pendingProjectionData = null
        CallSession.pendingProjectionCode = 0
    }

    /** Розмова почалась: вмикаємо камеру / екран, які користувач натиснув до відповіді. */
    private fun applyPendingVideo() {
        val kind = CallSession.pendingVideo ?: return
        val data = CallSession.pendingProjectionData
        val code = CallSession.pendingProjectionCode
        clearPendingVideo()
        when (kind) {
            "camera" -> startCamera(false)
            "screen" -> if (data != null) startScreen(code, data)
        }
    }

    private fun applyAudio() {
        val context = ctx ?: return
        try {
            context.startService(Intent(context, CallService::class.java).apply { action = CallService.ACTION_APPLY_AUDIO })
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // ===================== Події сервера =====================

    private fun onIncoming(obj: JSONObject) {
        val context = ctx ?: return
        val caller = obj.optString("callerEmail", "").trim().lowercase()
        if (caller.isEmpty()) return
        if (CallSession.phase != CallPhase.IDLE) return // дубль події або вже розмовляємо (сервер дає "зайнято")

        val serverName = obj.optString("callerName", "")
        val avatar = obj.optString("callerAvatar", "").ifEmpty { null }
        val name = LocalStore.get(context).contactName(myEmail, caller) ?: serverName.ifEmpty { caller }

        clearPendingVideo()
        direction = "in"
        wasAnswered = false
        ringStartedWall = System.currentTimeMillis()
        CallSession.peerEmail = caller
        CallSession.peerName = name
        CallSession.peerAvatar = avatar
        CallSession.startedAt = 0L
        CallSession.muted = false
        CallSession.speakerOn = false
        CallSession.minimized = false
        CallSession.phase = CallPhase.INCOMING

        startService(CallService.ACTION_INCOMING)
        scheduleTimeout {
            if (CallSession.phase == CallPhase.INCOMING) {
                logCall(missed = true, status = "missed")
                showMissedNotification()
                finishLocal()
            }
        }
    }

    private fun onAnswered(peer: String = "") {
        if (CallSession.phase != CallPhase.OUTGOING || isStale(peer)) return
        cancelTimeout()
        wasAnswered = true
        CallSession.startedAt = System.currentTimeMillis()
        CallSession.phase = CallPhase.ACTIVE
        startService(CallService.ACTION_START_CALL)
        applyPendingVideo()
    }

    private fun onRejected(peer: String = "") {
        val context = ctx ?: return
        if (CallSession.phase != CallPhase.OUTGOING || isStale(peer)) return
        logCall(missed = true, status = "declined")
        finishLocal()
        Notice.show(AppText.tr(context, "call_declined_by_peer"))
    }

    private fun onEnded(reason: String, peer: String = "") {
        val context = ctx ?: return
        if (isStale(peer)) return
        when (CallSession.phase) {
            CallPhase.IDLE -> return
            CallPhase.INCOMING -> {
                logCall(missed = true, status = "cancelled")
                showMissedNotification()
                finishLocal()
            }
            CallPhase.OUTGOING -> {
                logCall(missed = true, status = "missed")
                finishLocal()
                if (reason == "no_answer") Notice.show(AppText.tr(context, "call_no_answer"))
            }
            CallPhase.ACTIVE -> {
                logCall(missed = false, status = "ended")
                finishLocal()
            }
        }
    }

    private fun onBusy(peer: String = "") {
        val context = ctx ?: return
        if (CallSession.phase != CallPhase.OUTGOING || isStale(peer)) return
        finishLocal()
        Notice.show(AppText.tr(context, "line_busy"))
    }

    private fun onUnavailable(peer: String = "") {
        val context = ctx ?: return
        if (CallSession.phase != CallPhase.OUTGOING || isStale(peer)) return
        logCall(missed = true, status = "unavailable")
        finishLocal()
        Notice.show(AppText.tr(context, "call_offline"))
    }

    // ===================== Допоміжне =====================

    private fun startService(action: String) {
        val context = ctx ?: return
        val intent = Intent(context, CallService::class.java).apply {
            this.action = action
            putExtra(CallService.EXTRA_TARGET_NAME, CallSession.peerName)
            putExtra(CallService.EXTRA_TARGET_PHONE, CallSession.peerEmail)
            putExtra(CallService.EXTRA_MY_EMAIL, myEmail)
        }
        try {
            ContextCompat.startForegroundService(context, intent)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun scheduleTimeout(action: () -> Unit) {
        cancelTimeout()
        val r = Runnable { action() }
        timeoutRunnable = r
        handler.postDelayed(r, RING_TIMEOUT_MS)
    }

    private fun cancelTimeout() {
        timeoutRunnable?.let { handler.removeCallbacks(it) }
        timeoutRunnable = null
    }

    private fun logCall(missed: Boolean, status: String) {
        val context = ctx ?: return
        if (CallSession.peerEmail.isEmpty() || myEmail.isEmpty()) return
        val started = if (wasAnswered && CallSession.startedAt > 0L) CallSession.startedAt else ringStartedWall
        val duration = if (wasAnswered && CallSession.startedAt > 0L) {
            ((System.currentTimeMillis() - CallSession.startedAt) / 1000L).coerceAtLeast(0L)
        } else 0L
        try {
            LocalStore.get(context).insertCall(
                myEmail, CallSession.peerEmail, CallSession.peerName, direction, started, duration, missed, status
            )
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun finishLocal() {
        cancelTimeout()
        val context = ctx
        CallSession.phase = CallPhase.IDLE
        CallSession.minimized = false
        CallSession.muted = false
        CallSession.speakerOn = false
        CallSession.startedAt = 0L
        CallSession.peerEmail = ""
        CallSession.peerName = ""
        CallSession.peerAvatar = null
        CallSession.softGain = 1f
        clearPendingVideo()
        wasAnswered = false
        if (context != null) {
            try {
                context.stopService(Intent(context, CallService::class.java))
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun showMissedNotification() {
        val context = ctx ?: return
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm.createNotificationChannel(
                    NotificationChannel(MISSED_CHANNEL_ID, AppText.tr(context, "missed_channel"), NotificationManager.IMPORTANCE_HIGH)
                )
            }
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            val pending = PendingIntent.getActivity(
                context, 21, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val n = NotificationCompat.Builder(context, MISSED_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.sym_call_missed)
                .setContentTitle(AppText.tr(context, "missed_call"))
                .setContentText(CallSession.peerName.ifEmpty { CallSession.peerEmail })
                .setAutoCancel(true)
                .setContentIntent(pending)
                .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build()
            nm.notify(CallSession.peerEmail.hashCode() + 77, n)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}
