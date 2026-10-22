package com.kishka.messenger

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * Стан вкладки Gemini, що живе ПОЗА екраном (на рівні застосунку).
 * Завдяки цьому «Gemini думає…», таймер, чернетка, обране фото/відео і переписка не зникають, коли:
 *  - екран перевертають,
 *  - переходять в іншу вкладку і повертаються,
 *  - зʼєднання з сервером перепідключається (відповідь доходить подією gemini_done).
 */
class GeminiSession(context: Context, val email: String) {

    private val appContext = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())
    val manager = GeminiManager(appContext)

    var lang: String = "uk"

    var messages by mutableStateOf(manager.getCachedHistory(email))
    var models by mutableStateOf(manager.getCachedModels())
    var selectedModelId by mutableStateOf(manager.getSelectedModel(email) ?: "")
    var draft by mutableStateOf("")
    var pendingMedia by mutableStateOf<PendingMedia?>(null)
    var isSending by mutableStateOf(false)
    var uploadProgress by mutableStateOf<Float?>(null)
    var sendStartedAt by mutableStateOf(0L)
    var isLoadingHistory by mutableStateOf(true)
    var stopArmed by mutableStateOf(false)

    private var call: GeminiCall? = null
    private var uploadHandle: UploadHandle? = null
    private var started = false
    private var disarmRunnable: Runnable? = null

    val selectedModel: GeminiModel
        get() = models.firstOrNull { it.id == selectedModelId }
            ?: models.firstOrNull { it.id == "gemini-3.8-flash" }
            ?: models.firstOrNull { !it.isImage && !it.paid }
            ?: models.first()

    private fun toast(message: String) {
        Toast.makeText(appContext, message, Toast.LENGTH_LONG).show()
    }

    /** Викликається щоразу, коли вкладка Gemini зʼявляється на екрані. */
    fun onTabShown() {
        if (!started) {
            started = true
            manager.listenDone { result -> handleDone(result) }
            manager.loadModels { loaded, defaultId ->
                if (loaded != null) {
                    models = loaded
                    if (loaded.none { it.id == selectedModelId }) {
                        selectedModelId = defaultId ?: loaded.firstOrNull { !it.isImage && !it.paid }?.id ?: loaded.first().id
                    }
                }
            }
        }

        // Якщо запит виконувався, поки застосунок був закритий — відновлюємо «Gemini думає…»
        manager.getStatus(email) { busy, startedAt ->
            if (busy && !isSending && call == null && uploadHandle == null) {
                isSending = true
                sendStartedAt = if (startedAt > 0L) startedAt else System.currentTimeMillis()
            }
        }
        loadHistory()
    }

    fun loadHistory() {
        manager.loadHistory(email) { loaded ->
            isLoadingHistory = false
            // Поки йде відправка з цього екрана, локальне повідомлення не затираємо
            if (loaded != null && call == null && uploadHandle == null) {
                messages = loaded
            }
        }
    }

    fun selectModel(id: String) {
        selectedModelId = id
        manager.setSelectedModel(email, id)
    }

    // ---------- Відправка ----------

    fun send(displayName: String) {
        if (isSending) return
        val text = draft.trim()
        val media = pendingMedia
        if (text.isEmpty() && media == null) return

        isSending = true
        stopArmed = false
        sendStartedAt = System.currentTimeMillis()

        if (media != null) {
            uploadProgress = 0f
            uploadHandle = MediaUtils.upload(
                appContext, media, email,
                { progress -> uploadProgress = progress }
            ) { uploaded ->
                uploadHandle = null
                uploadProgress = null
                if (isSending) {
                    if (uploaded == null) {
                        isSending = false
                        toast(ChatStrings.get("upload_failed", lang))
                    } else {
                        dispatch(text, media, uploaded, displayName)
                    }
                }
            }
        } else {
            dispatch(text, null, null, displayName)
        }
    }

    private fun dispatch(text: String, media: PendingMedia?, uploaded: UploadedMedia?, displayName: String) {
        sendStartedAt = System.currentTimeMillis()
        val localId = "local_${System.currentTimeMillis()}"
        val localMessage = GeminiMessage(
            id = localId,
            role = "user",
            text = text,
            timestamp = System.currentTimeMillis(),
            imageUrl = KishkaManager.absoluteUrl(uploaded?.url),
            fileType = uploaded?.type,
            thumbUrl = KishkaManager.absoluteUrl(uploaded?.thumbUrl)
        )
        messages = messages + localMessage
        draft = ""
        pendingMedia = null

        call = manager.sendMessage(email, displayName, text, selectedModel.id, uploaded) { result ->
            handleResult(result, localId, text, media)
        }
    }

    private fun handleResult(result: GeminiResult, localId: String, text: String, media: PendingMedia?) {
        if (!isSending) return // уже оброблено подією gemini_done
        isSending = false
        stopArmed = false
        call = null

        if (result.success && result.reply != null) {
            messages = messages + result.reply
            manager.saveCache(email, messages)
        } else {
            // Не вдалося або зупинено — прибираємо повідомлення та повертаємо текст і файл у поле вводу
            messages = messages.filterNot { it.id == localId }
            if (draft.isEmpty()) draft = text
            if (pendingMedia == null) pendingMedia = media
            val message = if (result.cancelled) GeminiStrings.get("gemini_stopped", lang)
            else (result.error ?: Strings.get("gemini_error", lang))
            toast(message)
        }
    }

    /** Відповідь прийшла подією (ack міг загубитися при перепідключенні). */
    private fun handleDone(result: GeminiResult) {
        if (!isSending) return
        isSending = false
        stopArmed = false
        call = null

        if (!result.success && !result.cancelled) {
            val lastLocal = messages.lastOrNull { it.id.startsWith("local_") && it.role == "user" }
            if (lastLocal != null && draft.isEmpty()) draft = lastLocal.text
            toast(result.error ?: Strings.get("gemini_error", lang))
        }
        loadHistory()
    }

    // ---------- Зупинка: натиснути квадратик 2 рази ----------

    fun onStopTap() {
        if (stopArmed) {
            stopArmed = false
            disarmRunnable?.let { mainHandler.removeCallbacks(it) }
            performStop()
        } else {
            stopArmed = true
            val runnable = Runnable { stopArmed = false }
            disarmRunnable = runnable
            mainHandler.postDelayed(runnable, 3000L)
        }
    }

    private fun performStop() {
        val upload = uploadHandle
        if (upload != null) {
            // Зупиняємо ще завантаження файлу: чернетка і файл залишаються на місці
            upload.cancel()
            uploadHandle = null
            uploadProgress = null
            isSending = false
            toast(GeminiStrings.get("gemini_stopped", lang))
            return
        }

        val currentCall = call
        if (currentCall != null) {
            currentCall.cancel() // результат прийде з cancelled = true і повʼязаним відновленням чернетки
        } else {
            // Запит виконується на сервері, а цей екран його не запускав (після перезапуску застосунку)
            manager.cancelRemote(email)
            isSending = false
            toast(GeminiStrings.get("gemini_stopped", lang))
            loadHistory()
        }
    }

    fun clearMemory() {
        manager.clearMemory(email) { ok ->
            if (ok) {
                messages = emptyList()
                toast(Strings.get("gemini_cleared", lang))
            } else {
                toast(Strings.get("gemini_error", lang))
            }
        }
    }
}

/** Реєстр сесій: по одній на акаунт, живуть, доки живий процес застосунку. */
object GeminiSessions {
    private val sessions = HashMap<String, GeminiSession>()

    @Synchronized
    fun get(context: Context, email: String): GeminiSession {
        val key = email.trim().lowercase()
        return sessions.getOrPut(key) { GeminiSession(context.applicationContext, key) }
    }
}
