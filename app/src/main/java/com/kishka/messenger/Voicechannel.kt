package com.kishka.messenger

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Голосовий канал дзвінків — тепер через ОКРЕМИЙ СЕРВІС «Kishka-call» (папка calls/ у репозиторії).
 *
 * Чому було «при-… (дивні звуки) … -віт»: голос ішов Socket.IO-сокетом основного сервера, який одночасно обслуговує повідомлення,
 * Gemini, ChatGPT, відео й базу даних. Кожен пакет їхав як JSON + окремий бінарний кадр, а слабкий безкоштовний інстанс
 * «підвисав» на пів секунди — і звук рвався, а потім приходив залпом.
 *
 * Тепер:
 *  - голос іде СИРИМИ бінарними кадрами WebSocket на власний сервер, який лише пересилає байти співрозмовнику
 *    (без JSON, без Socket.IO, TCP_NODELAY, старі кадри відкидаються, а не накопичують затримку);
 *  - з'єднання саме відновлюється за долі секунди (серцебиття OkHttp кожні 3 с);
 *  - поки канал не готовий (сервіс «прокидається», мережа змінилась), голос іде основним сокетом, як раніше, —
 *    розмова не мовчить ні секунди.
 *
 * Адреса сервісу — CALL_SERVER_URL нижче. Якщо рядок порожній, канал вимкнений і все працює як раніше (через основний сервер).
 */
object VoiceChannel {
    /** Адреса сервісу Kishka-call на Render (wss://<назва-сервісу>.onrender.com). Змініть, якщо Render видав іншу. */
    const val CALL_SERVER_URL = "wss://kishka-call.onrender.com"

    private const val RECONNECT_MIN_MS = 300L
    private const val RECONNECT_MAX_MS = 2500L
    private const val MAX_QUEUE_BYTES = 48 * 1024L      // якщо в черзі відправки накопичилось більше — канал «душить», шлемо основним

    private val main = Handler(Looper.getMainLooper())
    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .pingInterval(3, TimeUnit.SECONDS)            // серцебиття: немає відповіді — з'єднання вважається мертвим і відновлюється
            .connectTimeout(6, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    private var ws: WebSocket? = null
    private var email = ""
    private var peer = ""
    private var generation = 0
    private var backoff = RECONNECT_MIN_MS

    @Volatile private var listener: ((ByteArray) -> Unit)? = null
    @Volatile private var ready = false                  // сервер підтвердив «hi»
    @Volatile private var peerOn = false                 // співрозмовник теж підключений до сервісу (інакше голос іде запасним шляхом)
    @Volatile private var wantOpen = false

    /**
     * Відкрити канал для розмови [myEmail] <-> [peerEmail] (викликається, щойно почався дзвінок — ще до відповіді,
     * щоб до розмови канал уже був готовий).
     */
    @Synchronized
    fun open(myEmail: String, peerEmail: String) {
        val me = myEmail.trim().lowercase()
        val other = peerEmail.trim().lowercase()
        if (CALL_SERVER_URL.isBlank() || me.isEmpty() || other.isEmpty() || me == other) return
        if (wantOpen && ws != null && email == me && peer == other) return
        closeInternal()
        email = me
        peer = other
        wantOpen = true
        backoff = RECONNECT_MIN_MS
        connect(++generation)
    }

    /** Закрити канал (дзвінок завершено). */
    @Synchronized
    fun close() {
        closeInternal()
        email = ""
        peer = ""
        listener = null
    }

    private fun closeInternal() {
        wantOpen = false
        ready = false
        peerOn = false
        generation++
        val w = ws
        ws = null
        try {
            w?.close(1000, "bye")
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /** Хто отримує кадри голосу, що прийшли цим каналом. */
    fun setListener(l: ((ByteArray) -> Unit)?) {
        listener = l
    }

    /** true — кадр пішов голосовим каналом; false — канал не готовий або «душиться», надсилайте основним сокетом. */
    fun send(@Suppress("UNUSED_PARAMETER") target: String, packet: ByteArray): Boolean {
        val w = ws ?: return false
        if (!ready || !peerOn) return false
        if (w.queueSize() > MAX_QUEUE_BYTES) return false
        return try {
            w.send(ByteString.of(*packet))
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    @Synchronized
    private fun connect(myGen: Int) {
        if (!wantOpen || myGen != generation) return
        try {
            val request = Request.Builder().url(CALL_SERVER_URL).build()
            ws = client.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    if (myGen != generation) {
                        webSocket.close(1000, "stale")
                        return
                    }
                    val hello = JSONObject().put("t", "hi").put("me", email).put("peer", peer)
                    webSocket.send(hello.toString())
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (myGen != generation) return
                    if (text.startsWith("{")) {
                        val obj = try { JSONObject(text) } catch (e: Exception) { null }
                        when (obj?.optString("t")) {
                            "hi" -> if (obj.optBoolean("ok", false)) {
                                ready = true
                                backoff = RECONNECT_MIN_MS
                            }
                            "peer" -> peerOn = obj.optBoolean("on", false)
                        }
                    }
                }

                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    if (myGen != generation) return
                    val data = bytes.toByteArray()
                    if (data.isNotEmpty()) listener?.invoke(data)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    lost(webSocket, myGen)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    lost(webSocket, myGen)
                }
            })
        } catch (e: Exception) {
            e.printStackTrace()
            scheduleReconnect(myGen)
        }
    }

    private fun lost(webSocket: WebSocket, myGen: Int) {
        if (myGen != generation) return
        synchronized(this) {
            if (ws === webSocket) ws = null
        }
        ready = false
        peerOn = false
        scheduleReconnect(myGen)
    }

    private fun scheduleReconnect(myGen: Int) {
        if (!wantOpen || myGen != generation) return
        val wait = backoff
        backoff = (backoff * 2).coerceAtMost(RECONNECT_MAX_MS)
        main.postDelayed({ connect(myGen) }, wait)
    }

    /** Для діагностики: коли канал готовий, голос іде ним, інакше — основним сервером. */
    fun isReady(): Boolean = ready && peerOn && ws != null

    @Suppress("unused")
    private fun now(): Long = SystemClock.elapsedRealtime()
}
