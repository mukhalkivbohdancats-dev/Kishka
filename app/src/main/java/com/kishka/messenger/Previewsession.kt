package com.kishka.messenger

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Звʼязок вкладки AI Preview із сервером. Використовує той самий сокет, що й месенджер.
 * Памʼять розмови зберігається на сервері окремо для кожного акаунта.
 * Результат — GeminiResult (reply.imageUrl заповнений, якщо згенеровано зображення).
 */
class PreviewManager(context: Context) {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val socket get() = KishkaManager.getSocket()

    private fun ensureConnected() {
        try {
            if (!socket.connected()) socket.connect()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun parseMessage(obj: JSONObject): GeminiMessage {
        return GeminiMessage(
            id = obj.optString("id", ""),
            role = obj.optString("role", "user"),
            text = if (obj.isNull("text")) "" else obj.optString("text", ""),
            timestamp = obj.optLong("timestamp", System.currentTimeMillis()),
            imageUrl = KishkaManager.absoluteUrl(if (obj.isNull("imageUrl")) null else obj.optString("imageUrl", "").ifEmpty { null }),
            model = if (obj.isNull("model")) null else obj.optString("model", "").ifEmpty { null }
        )
    }

    private fun parseResult(obj: JSONObject?): GeminiResult {
        try {
            if (obj != null) {
                return if (obj.optBoolean("success", false)) {
                    GeminiResult(true, parseMessage(obj.getJSONObject("reply")).copy(role = "model"), null)
                } else {
                    GeminiResult(false, null, obj.optString("error", "").ifEmpty { null }, obj.optBoolean("cancelled", false))
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return GeminiResult(false, null, null)
    }

    fun loadHistory(email: String, onResult: (List<GeminiMessage>?) -> Unit) {
        ensureConnected()
        socket.emit("preview_get_history", email.trim().lowercase(), io.socket.client.Ack { args ->
            var result: List<GeminiMessage>? = null
            try {
                val obj = args.firstOrNull() as? JSONObject
                if (obj != null && obj.optBoolean("success", false)) {
                    val arr = obj.optJSONArray("messages") ?: JSONArray()
                    val list = mutableListOf<GeminiMessage>()
                    for (i in 0 until arr.length()) {
                        val o = arr.optJSONObject(i) ?: continue
                        list.add(parseMessage(o))
                    }
                    result = list
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
            mainHandler.post { onResult(result) }
        })
    }

    /** mode: "image" — завжди малювати; "auto" — малювати лише за проханням, інакше відповісти текстом. */
    fun send(email: String, displayName: String, text: String, mode: String, lang: String, onResult: (GeminiResult) -> Unit): GeminiCall {
        ensureConnected()
        val cleanEmail = email.trim().lowercase()
        val json = JSONObject().apply {
            put("email", cleanEmail)
            put("name", displayName)
            put("text", text)
            put("mode", mode)
            put("lang", lang)
        }
        val done = AtomicBoolean(false)
        socket.emit("preview_send", json, io.socket.client.Ack { args ->
            if (!done.compareAndSet(false, true)) return@Ack
            val result = parseResult(args.firstOrNull() as? JSONObject)
            mainHandler.post { onResult(result) }
        })
        return GeminiCall {
            if (done.compareAndSet(false, true)) {
                socket.emit("preview_cancel", cleanEmail, io.socket.client.Ack { })
                mainHandler.post { onResult(GeminiResult(false, null, null, true)) }
            }
        }
    }

    private var doneListener: io.socket.emitter.Emitter.Listener? = null

    fun listenDone(onDone: (GeminiResult) -> Unit) {
        stopListeningDone()
        val listener = io.socket.emitter.Emitter.Listener { args ->
            val result = parseResult(args.firstOrNull() as? JSONObject)
            mainHandler.post { onDone(result) }
        }
        doneListener = listener
        socket.on("preview_done", listener)
    }

    fun stopListeningDone() {
        doneListener?.let { socket.off("preview_done", it) }
        doneListener = null
    }

    fun getStatus(email: String, onResult: (busy: Boolean, startedAt: Long) -> Unit) {
        ensureConnected()
        socket.emit("preview_get_status", email.trim().lowercase(), io.socket.client.Ack { args ->
            val obj = args.firstOrNull() as? JSONObject
            val busy = obj?.optBoolean("busy", false) ?: false
            val startedAt = obj?.optLong("startedAt", 0L) ?: 0L
            mainHandler.post { onResult(busy, startedAt) }
        })
    }

    fun cancelRemote(email: String) {
        ensureConnected()
        socket.emit("preview_cancel", email.trim().lowercase(), io.socket.client.Ack { })
    }

    fun clear(email: String, onResult: (Boolean) -> Unit) {
        ensureConnected()
        socket.emit("preview_clear", email.trim().lowercase(), io.socket.client.Ack { args ->
            val ok = (args.firstOrNull() as? JSONObject)?.optBoolean("success", false) ?: false
            mainHandler.post { onResult(ok) }
        })
    }
}

/**
 * Стан вкладки AI Preview, що живе ПОЗА екраном: не зникає при повороті екрана та переході між вкладками.
 */
class PreviewSession(context: Context, val email: String) {

    private val appContext = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())
    val manager = PreviewManager(appContext)

    var lang: String = "uk"

    var messages by mutableStateOf(listOf<GeminiMessage>())
    var draft by mutableStateOf("")
    var drawMode by mutableStateOf(false)
    var isSending by mutableStateOf(false)
    var sendStartedAt by mutableStateOf(0L)
    var isLoadingHistory by mutableStateOf(true)
    var stopArmed by mutableStateOf(false)

    private var call: GeminiCall? = null
    private var started = false
    private var disarmRunnable: Runnable? = null

    fun onTabShown() {
        if (!started) {
            started = true
            manager.listenDone { result -> handleDone(result) }
        }
        manager.getStatus(email) { busy, startedAt ->
            if (busy && !isSending && call == null) {
                isSending = true
                sendStartedAt = if (startedAt > 0L) startedAt else System.currentTimeMillis()
            }
        }
        loadHistory()
    }

    fun loadHistory() {
        manager.loadHistory(email) { loaded ->
            isLoadingHistory = false
            if (loaded != null && call == null) messages = loaded
        }
    }

    fun send(displayName: String) {
        if (isSending) return
        val text = draft.trim()
        if (text.isEmpty()) return

        isSending = true
        stopArmed = false
        sendStartedAt = System.currentTimeMillis()

        val localId = "local_${System.currentTimeMillis()}"
        messages = messages + GeminiMessage(id = localId, role = "user", text = text, timestamp = System.currentTimeMillis())
        draft = ""

        call = manager.send(email, displayName, text, if (drawMode) "image" else "auto", lang) { result ->
            handleResult(result, localId, text)
        }
    }

    private fun handleResult(result: GeminiResult, localId: String, text: String) {
        if (!isSending) return
        isSending = false
        stopArmed = false
        call = null

        if (result.success && result.reply != null) {
            messages = messages + result.reply
        } else {
            messages = messages.filterNot { it.id == localId }
            if (draft.isEmpty()) draft = text
            Notice.show(
                if (result.cancelled) GeminiStrings.get("gemini_stopped", lang)
                else (result.error ?: Strings.get("gemini_error", lang))
            )
        }
    }

    private fun handleDone(result: GeminiResult) {
        if (!isSending) return
        isSending = false
        stopArmed = false
        call = null
        if (!result.success && !result.cancelled) {
            val lastLocal = messages.lastOrNull { it.id.startsWith("local_") && it.role == "user" }
            if (lastLocal != null && draft.isEmpty()) draft = lastLocal.text
            Notice.show(result.error ?: Strings.get("gemini_error", lang))
        }
        loadHistory()
    }

    /** Зупинка: натиснути квадратик двічі (як у вкладці Gemini). */
    fun onStopTap() {
        if (stopArmed) {
            stopArmed = false
            disarmRunnable?.let { mainHandler.removeCallbacks(it) }
            val current = call
            if (current != null) {
                current.cancel()
            } else {
                manager.cancelRemote(email)
                isSending = false
                Notice.show(GeminiStrings.get("gemini_stopped", lang))
                loadHistory()
            }
        } else {
            stopArmed = true
            val runnable = Runnable { stopArmed = false }
            disarmRunnable = runnable
            mainHandler.postDelayed(runnable, 3000L)
        }
    }

    fun clearMemory() {
        manager.clear(email) { ok ->
            if (ok) {
                messages = emptyList()
                Notice.show(PreviewStrings.get("preview_cleared", lang))
            } else {
                Notice.show(Strings.get("gemini_error", lang))
            }
        }
    }
}

object PreviewSessions {
    private val sessions = HashMap<String, PreviewSession>()

    @Synchronized
    fun get(context: Context, email: String): PreviewSession {
        val key = email.trim().lowercase()
        return sessions.getOrPut(key) { PreviewSession(context.applicationContext, key) }
    }
}
