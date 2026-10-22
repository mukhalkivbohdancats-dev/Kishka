package com.kishka.messenger

import android.content.ContentValues
import android.content.Context
import android.content.SharedPreferences
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

data class GeminiMessage(
    val id: String = "",
    val role: String = "user", // "user" або "model"
    val text: String = "",
    val timestamp: Long = System.currentTimeMillis(),
    val imageUrl: String? = null, // повне посилання на зображення/відео (згенероване Gemini або надіслане користувачем)
    val model: String? = null,    // яка модель відповіла
    val fileType: String? = null, // "image" або "video" для вкладень користувача
    val thumbUrl: String? = null  // мініатюра відео
)

data class GeminiResult(
    val success: Boolean,
    val reply: GeminiMessage? = null,
    val error: String? = null,
    val cancelled: Boolean = false
)

data class GeminiModel(
    val id: String,
    val label: String,
    val type: String = "text", // "text" або "image"
    val paid: Boolean = false, // позначка Paid в Google AI Studio
    val note: String = ""
) {
    val isImage: Boolean get() = type == "image"
}

/** Дескриптор запиту до Gemini: дозволяє його зупинити. */
class GeminiCall(private val onCancel: () -> Unit) {
    fun cancel() = onCancel()
}

/**
 * Окремий менеджер для вкладки Gemini.
 * Використовує той самий сокет, що й месенджер (KishkaManager.getSocket()),
 * але НЕ змінює жодного існуючого методу логіну, обміну повідомленнями чи дзвінків.
 * Памʼять ШІ зберігається на сервері окремо для кожного акаунта (за email).
 */
class GeminiManager(context: Context) {

    private val appContext = context.applicationContext
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

    // ---------- Моделі ----------

    /** Повний список моделей (як у Google AI Studio). Використовується, доки сервер не відповів. */
    fun defaultModels(): List<GeminiModel> = listOf(
        GeminiModel("gemini-4-argon", "Gemini 4 Argon", "text", true, "Найпотужніша модель"),
        GeminiModel("gemini-3.8-flash", "Gemini 3.8 Flash", "text", false, "Найрозумніша Flash-модель"),
        GeminiModel("gemini-3.6-flash", "Gemini 3.6 Flash", "text", true, "Попереднє покоління Flash"),
        GeminiModel("gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite", "text", false, "Найшвидша"),
        GeminiModel("gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview", "text", false, "Складні завдання та код"),
        GeminiModel("gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite", "text", false, "Легка та швидка"),
        GeminiModel("gemini-3-flash-preview", "Gemini 3 Flash Preview", "text", true, "Застаріла Flash"),
        GeminiModel("gemini-pro-latest", "Gemini Pro Latest", "text", false, "Завжди остання Pro"),
        GeminiModel("gemini-flash-latest", "Gemini Flash Latest", "text", false, "Завжди остання Flash"),
        GeminiModel("gemini-flash-lite-latest", "Gemini Flash-Lite Latest", "text", false, "Завжди остання Flash-Lite"),
        GeminiModel("gemini-robotics-er-2-preview", "Gemini Robotics-ER 2 Preview", "text", false, "Розуміння простору та відео"),
        GeminiModel("gemini-robotics-er-2-streaming-preview", "Gemini Robotics-ER 2 Streaming", "text", false, "Швидкий потоковий режим"),
        GeminiModel("gemini-nano-banana-2.1", "Nano Banana 2.1", "image", true, "Найкраща якість, до 4K"),
        GeminiModel("gemini-3.1-flash-lite-image", "Nano Banana 2 Lite", "image", false, "Найшвидша"),
        GeminiModel("gemini-3.1-flash-image", "Nano Banana 2", "image", true, "Збалансована"),
        GeminiModel("gemini-3-pro-image", "Nano Banana Pro", "image", true, "Професійна"),
        GeminiModel("gemini-2.5-flash-image", "Nano Banana", "image", true, "Перша версія")
    )

    private fun modelsCacheKey() = "gemini_models_cache_v2"

    fun getCachedModels(): List<GeminiModel> {
        return try {
            val raw = prefs.getString(modelsCacheKey(), null) ?: return defaultModels()
            val list = parseModels(JSONArray(raw))
            if (list.isEmpty()) defaultModels() else list
        } catch (e: Exception) {
            defaultModels()
        }
    }

    private fun parseModels(array: JSONArray): List<GeminiModel> {
        val list = mutableListOf<GeminiModel>()
        for (i in 0 until array.length()) {
            val obj = array.optJSONObject(i) ?: continue
            val id = obj.optString("id", "")
            if (id.isEmpty()) continue
            list.add(
                GeminiModel(
                    id = id,
                    label = obj.optString("label", id),
                    type = obj.optString("type", "text"),
                    paid = obj.optBoolean("paid", false),
                    note = if (obj.isNull("note")) "" else obj.optString("note", "")
                )
            )
        }
        return list
    }

    /** Завантажує з сервера актуальний список моделей. */
    fun loadModels(onResult: (models: List<GeminiModel>?, defaultModelId: String?) -> Unit) {
        ensureConnected()
        socket.emit("gemini_get_models", io.socket.client.Ack { args ->
            var models: List<GeminiModel>? = null
            var defaultId: String? = null
            try {
                val obj = args.firstOrNull() as? JSONObject
                if (obj != null && obj.optBoolean("success", false)) {
                    val arr = obj.optJSONArray("models") ?: JSONArray()
                    val parsed = parseModels(arr)
                    if (parsed.isNotEmpty()) {
                        models = parsed
                        defaultId = obj.optString("defaultModel", "").ifEmpty { null }
                        prefs.edit().putString(modelsCacheKey(), arr.toString()).apply()
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
            mainHandler.post { onResult(models, defaultId) }
        })
    }

    fun getSelectedModel(email: String): String? =
        prefs.getString("gemini_selected_model_${email.trim().lowercase()}", null)

    fun setSelectedModel(email: String, modelId: String) {
        prefs.edit().putString("gemini_selected_model_${email.trim().lowercase()}", modelId).apply()
    }

    // ---------- Локальний кеш історії (щоб вона зʼявлялась миттєво) ----------

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
                    put("imageUrl", m.imageUrl ?: JSONObject.NULL)
                    put("model", m.model ?: JSONObject.NULL)
                    put("fileType", m.fileType ?: JSONObject.NULL)
                    put("thumbUrl", m.thumbUrl ?: JSONObject.NULL)
                })
            }
            prefs.edit().putString(cacheKey(email), arr.toString()).apply()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun absoluteUrl(path: String?): String? {
        if (path.isNullOrEmpty()) return null
        return if (path.startsWith("http")) path else KishkaManager.SERVER_URL + path
    }

    private fun parseMessage(obj: JSONObject): GeminiMessage {
        return GeminiMessage(
            id = obj.optString("id", ""),
            role = obj.optString("role", "user"),
            text = if (obj.isNull("text")) "" else obj.optString("text", ""),
            timestamp = obj.optLong("timestamp", System.currentTimeMillis()),
            imageUrl = absoluteUrl(if (obj.isNull("imageUrl")) null else obj.optString("imageUrl", "")),
            model = if (obj.isNull("model")) null else obj.optString("model", "").ifEmpty { null },
            fileType = if (obj.isNull("fileType")) null else obj.optString("fileType", "").ifEmpty { null },
            thumbUrl = absoluteUrl(if (obj.isNull("thumbUrl")) null else obj.optString("thumbUrl", ""))
        )
    }

    private fun parseMessages(array: JSONArray): List<GeminiMessage> {
        val list = mutableListOf<GeminiMessage>()
        for (i in 0 until array.length()) {
            val obj = array.optJSONObject(i) ?: continue
            list.add(parseMessage(obj))
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
                    val parsed = parseMessages(arr)
                    result = parsed
                    cacheHistory(cleanEmail, parsed)
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
            mainHandler.post { onResult(result) }
        })
    }

    // ---------- Відправка повідомлення до Gemini (текст або зображення залежно від моделі) ----------
    // Часу очікування немає: запит триває, доки Gemini не відповість або доки його не зупинять через GeminiCall.cancel().

    fun sendMessage(
        email: String,
        displayName: String,
        text: String,
        modelId: String,
        attachment: UploadedMedia?,
        onResult: (GeminiResult) -> Unit
    ): GeminiCall {
        ensureConnected()
        val cleanEmail = email.trim().lowercase()

        val json = JSONObject().apply {
            put("email", cleanEmail)
            put("name", displayName)
            put("text", text)
            put("model", modelId)
            if (attachment != null) {
                put("attachment", JSONObject().apply {
                    put("url", KishkaManager.relativeUrl(attachment.url) ?: attachment.url)
                    put("type", attachment.type)
                    val thumb = KishkaManager.relativeUrl(attachment.thumbUrl)
                    if (!thumb.isNullOrEmpty()) put("thumbUrl", thumb)
                })
            }
        }

        val done = AtomicBoolean(false)

        socket.emit("gemini_send", json, io.socket.client.Ack { args ->
            if (!done.compareAndSet(false, true)) return@Ack // вже зупинено користувачем

            val result = parseResult(args.firstOrNull() as? JSONObject)
            mainHandler.post { onResult(result) }
        })

        return GeminiCall {
            if (done.compareAndSet(false, true)) {
                // Повідомляємо сервер, щоб він перервав запит до Google
                socket.emit("gemini_cancel", cleanEmail, io.socket.client.Ack { })
                mainHandler.post { onResult(GeminiResult(false, null, null, true)) }
            }
        }
    }

    private fun parseResult(obj: JSONObject?): GeminiResult {
        var result = GeminiResult(false, null, "Gemini недоступний")
        try {
            if (obj != null) {
                result = if (obj.optBoolean("success", false)) {
                    val reply = parseMessage(obj.getJSONObject("reply")).copy(role = "model")
                    GeminiResult(true, reply, null)
                } else {
                    GeminiResult(
                        false, null,
                        obj.optString("error", "Gemini недоступний"),
                        obj.optBoolean("cancelled", false)
                    )
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return result
    }

    private var doneListener: io.socket.emitter.Emitter.Listener? = null

    /**
     * Сервер надсилає подію gemini_done, коли Gemini закінчив відповідати. Вона доходить навіть тоді,
     * коли звʼязок перепідключився і звичайна відповідь (ack) загубилась.
     */
    fun listenDone(onDone: (GeminiResult) -> Unit) {
        stopListeningDone()
        val listener = io.socket.emitter.Emitter.Listener { args ->
            val result = parseResult(args.firstOrNull() as? JSONObject)
            mainHandler.post { onDone(result) }
        }
        doneListener = listener
        socket.on("gemini_done", listener)
    }

    fun stopListeningDone() {
        doneListener?.let { socket.off("gemini_done", it) }
        doneListener = null
    }

    /** Чи Gemini зараз відповідає на запит цього користувача (відновлення стану після перезапуску). */
    fun getStatus(email: String, onResult: (busy: Boolean, startedAt: Long) -> Unit) {
        ensureConnected()
        socket.emit("gemini_get_status", email.trim().lowercase(), io.socket.client.Ack { args ->
            val obj = args.firstOrNull() as? JSONObject
            val busy = obj?.optBoolean("busy", false) ?: false
            val startedAt = obj?.optLong("startedAt", 0L) ?: 0L
            mainHandler.post { onResult(busy, startedAt) }
        })
    }

    /** Зупиняє на сервері запит, що виконується (якщо локального GeminiCall вже немає). */
    fun cancelRemote(email: String) {
        ensureConnected()
        socket.emit("gemini_cancel", email.trim().lowercase(), io.socket.client.Ack { })
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
}
