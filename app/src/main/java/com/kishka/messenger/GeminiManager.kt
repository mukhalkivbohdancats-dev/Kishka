package com.kishka.messenger

import android.content.Context
import android.content.SharedPreferences
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

data class GeminiMessage(
    val id: String = "",
    val role: String = "user", // "user" або "model"
    val text: String = "",
    val timestamp: Long = System.currentTimeMillis()
)

data class GeminiResult(
    val success: Boolean,
    val reply: GeminiMessage? = null,
    val error: String? = null
)

/**
 * Окремий менеджер для вкладки Gemini.
 * Використовує той самий сокет, що й месенджер (KishkaManager.getSocket()),
 * але НЕ змінює жодного існуючого методу логіну чи обміну повідомленнями.
 * Памʼять ШІ зберігається на сервері окремо для кожного акаунта (за email).
 */
class GeminiManager(context: Context) {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val prefs: SharedPreferences =
        context.getSharedPreferences("kishka_gemini_prefs", Context.MODE_PRIVATE)

    private val socket get() = KishkaManager.getSocket()

    private fun ensureConnected() {
        try {
            if (!socket.connected()) socket.connect()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // ---------- Локальний кеш (щоб історія зʼявлялась миттєво) ----------

    private fun cacheKey(email: String) = "gemini_cache_${email.trim().lowercase()}"

    fun getCachedHistory(email: String): List<GeminiMessage> {
        return try {
            val raw = prefs.getString(cacheKey(email), null) ?: return emptyList()
            parseMessages(JSONArray(raw))
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun cacheHistory(email: String, list: List<GeminiMessage>) {
        try {
            val arr = JSONArray()
            for (m in list) {
                arr.put(JSONObject().apply {
                    put("id", m.id)
                    put("role", m.role)
                    put("text", m.text)
                    put("timestamp", m.timestamp)
                })
            }
            prefs.edit().putString(cacheKey(email), arr.toString()).apply()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun parseMessages(array: JSONArray): List<GeminiMessage> {
        val list = mutableListOf<GeminiMessage>()
        for (i in 0 until array.length()) {
            val obj = array.optJSONObject(i) ?: continue
            list.add(
                GeminiMessage(
                    id = obj.optString("id", ""),
                    role = obj.optString("role", "user"),
                    text = obj.optString("text", ""),
                    timestamp = obj.optLong("timestamp", System.currentTimeMillis())
                )
            )
        }
        return list
    }

    // ---------- Завантаження історії (памʼяті) ----------

    fun loadHistory(email: String, onResult: (List<GeminiMessage>?) -> Unit) {
        ensureConnected()
        val cleanEmail = email.trim().lowercase()
        socket.emit("gemini_get_history", cleanEmail, io.socket.client.Ack { args ->
            var result: List<GeminiMessage>? = null
            try {
                val obj = args.firstOrNull() as? JSONObject
                if (obj != null && obj.optBoolean("success", false)) {
                    val arr = obj.optJSONArray("messages") ?: JSONArray()
                    result = parseMessages(arr)
                    cacheHistory(cleanEmail, result)
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
            mainHandler.post { onResult(result) }
        })
    }

    // ---------- Відправка повідомлення до Gemini ----------

    fun sendMessage(
        email: String,
        displayName: String,
        text: String,
        onResult: (GeminiResult) -> Unit
    ) {
        ensureConnected()
        val cleanEmail = email.trim().lowercase()

        val json = JSONObject().apply {
            put("email", cleanEmail)
            put("name", displayName)
            put("text", text)
        }

        val done = AtomicBoolean(false)
        val timeoutRunnable = Runnable {
            if (done.compareAndSet(false, true)) {
                onResult(GeminiResult(false, null, "Час очікування відповіді вичерпано. Спробуйте ще раз"))
            }
        }
        mainHandler.postDelayed(timeoutRunnable, RESPONSE_TIMEOUT_MS)

        socket.emit("gemini_send", json, io.socket.client.Ack { args ->
            if (!done.compareAndSet(false, true)) return@Ack
            mainHandler.removeCallbacks(timeoutRunnable)

            var result = GeminiResult(false, null, "Gemini недоступний")
            try {
                val obj = args.firstOrNull() as? JSONObject
                if (obj != null) {
                    if (obj.optBoolean("success", false)) {
                        val r = obj.getJSONObject("reply")
                        val reply = GeminiMessage(
                            id = r.optString("id", ""),
                            role = "model",
                            text = r.optString("text", ""),
                            timestamp = r.optLong("timestamp", System.currentTimeMillis())
                        )
                        result = GeminiResult(true, reply, null)
                    } else {
                        result = GeminiResult(false, null, obj.optString("error", "Gemini недоступний"))
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
            mainHandler.post { onResult(result) }
        })
    }

    // ---------- Очищення памʼяті ----------

    fun clearMemory(email: String, onResult: (Boolean) -> Unit) {
        ensureConnected()
        val cleanEmail = email.trim().lowercase()
        socket.emit("gemini_clear", cleanEmail, io.socket.client.Ack { args ->
            val ok = (args.firstOrNull() as? JSONObject)?.optBoolean("success", false) ?: false
            if (ok) {
                prefs.edit().remove(cacheKey(cleanEmail)).apply()
            }
            mainHandler.post { onResult(ok) }
        })
    }

    fun saveCache(email: String, list: List<GeminiMessage>) {
        cacheHistory(email.trim().lowercase(), list)
    }

    companion object {
        private const val RESPONSE_TIMEOUT_MS = 70_000L
    }
}
