package com.kishka.messenger

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
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
    var volume by mutableStateOf(0.7f)

    /** Екран дзвінка згорнуто в смужку зверху (дзвінок триває). */
    var minimized by mutableStateOf(false)
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
        socket.on("call_answered_$me") { handler.post { onAnswered() } }
        socket.off("call_rejected_$me")
        socket.on("call_rejected_$me") { handler.post { onRejected() } }
        socket.off("call_ended_$me")
        socket.on("call_ended_$me") { args ->
            val reason = (args.firstOrNull() as? JSONObject)?.optString("reason", "") ?: ""
            handler.post { onEnded(reason) }
        }
        socket.off("call_busy_$me")
        socket.on("call_busy_$me") { handler.post { onBusy() } }
        socket.off("call_unavailable_$me")
        socket.on("call_unavailable_$me") { handler.post { onUnavailable() } }
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
    }

    fun decline() {
        if (CallSession.phase != CallPhase.INCOMING) return
        manager?.rejectCall(CallSession.peerEmail, myEmail)
        logCall(missed = true)
        finishLocal()
    }

    /** Покласти слухавку (у будь-якому стані). */
    fun end() {
        when (CallSession.phase) {
            CallPhase.IDLE -> return
            CallPhase.INCOMING -> decline()
            else -> {
                manager?.endCall(myEmail, CallSession.peerEmail)
                logCall(missed = !wasAnswered)
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

    fun setVolume(value: Float) {
        CallSession.volume = value.coerceIn(0f, 1f)
        applyAudio()
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
                logCall(missed = true)
                showMissedNotification()
                finishLocal()
            }
        }
    }

    private fun onAnswered() {
        if (CallSession.phase != CallPhase.OUTGOING) return
        cancelTimeout()
        wasAnswered = true
        CallSession.startedAt = System.currentTimeMillis()
        CallSession.phase = CallPhase.ACTIVE
        startService(CallService.ACTION_START_CALL)
    }

    private fun onRejected() {
        val context = ctx ?: return
        if (CallSession.phase != CallPhase.OUTGOING) return
        logCall(missed = true)
        finishLocal()
        Notice.show(AppText.tr(context, "call_declined_by_peer"))
    }

    private fun onEnded(reason: String) {
        val context = ctx ?: return
        when (CallSession.phase) {
            CallPhase.IDLE -> return
            CallPhase.INCOMING -> {
                logCall(missed = true)
                showMissedNotification()
                finishLocal()
            }
            CallPhase.OUTGOING -> {
                logCall(missed = true)
                finishLocal()
                if (reason == "no_answer") Notice.show(AppText.tr(context, "call_no_answer"))
            }
            CallPhase.ACTIVE -> {
                logCall(missed = false)
                finishLocal()
            }
        }
    }

    private fun onBusy() {
        val context = ctx ?: return
        if (CallSession.phase != CallPhase.OUTGOING) return
        finishLocal()
        Notice.show(AppText.tr(context, "line_busy"))
    }

    private fun onUnavailable() {
        val context = ctx ?: return
        if (CallSession.phase != CallPhase.OUTGOING) return
        logCall(missed = true)
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

    private fun logCall(missed: Boolean) {
        val context = ctx ?: return
        if (CallSession.peerEmail.isEmpty() || myEmail.isEmpty()) return
        val started = if (wasAnswered && CallSession.startedAt > 0L) CallSession.startedAt else ringStartedWall
        val duration = if (wasAnswered && CallSession.startedAt > 0L) {
            ((System.currentTimeMillis() - CallSession.startedAt) / 1000L).coerceAtLeast(0L)
        } else 0L
        try {
            LocalStore.get(context).insertCall(
                myEmail, CallSession.peerEmail, CallSession.peerName, direction, started, duration, missed
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
