package com.kishka.messenger

import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import io.socket.client.Ack
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.engineio.client.transports.WebSocket
import org.json.JSONObject

/**
 * Окремий голосовий канал для дзвінків.
 *
 * Раніше голос ішов тим самим сокетом, що й усе інше (повідомлення, Gemini, ChatGPT, ВІДЕО-кадри камери й екрана).
 * Один великий кадр відео — і голосові пакети стояли за ним у черзі: звук «рвався», а коли «пінг» запізнювався — рвався
 * весь зв'язок і дзвінок. Тепер голос має власне WebSocket-з'єднання, на якому більше нічого нема:
 *  - відео, чати й синхронізація голосу не заважають;
 *  - з'єднання саме перепідключається за долі секунди, а не разом з основним;
 *  - раз на 2 секунди перевіряється, чи канал живий (немає відповіді 6 с — канал перезапускається),
 *    а поки він не готовий, голос іде основним сокетом (старий шлях) — розмова не мовчить ні секунди.
 */
object VoiceChannel {
    private const val PING_EVERY_MS = 2000L
    private const val DEAD_AFTER_MS = 6000L
    private const val FRESH_MS = 4500L

    private var socket: Socket? = null
    private var email = ""
    private var thread: HandlerThread? = null
    private var handler: Handler? = null
    private var pinger: Runnable? = null

    @Volatile private var listener: ((ByteArray) -> Unit)? = null
    @Volatile private var joined = false
    @Volatile private var lastAckAt = 0L

    /** Відкрити канал (викликається, щойно почався дзвінок — ще до відповіді, щоб до розмови канал уже був готовий). */
    @Synchronized
    fun open(myEmail: String) {
        val clean = myEmail.trim().lowercase()
        if (clean.isEmpty()) return
        if (socket != null && email == clean) return
        close()
        email = clean
        try {
            val options = IO.Options().apply {
                forceNew = true
                reconnection = true
                reconnectionAttempts = Int.MAX_VALUE
                reconnectionDelay = 300
                reconnectionDelayMax = 2000
                timeout = 8000
                transports = arrayOf(WebSocket.NAME)
            }
            val s = IO.socket(KishkaManager.SERVER_URL, options)
            s.on(Socket.EVENT_CONNECT) { join(s) }
            s.on(Socket.EVENT_DISCONNECT) { joined = false }
            s.on(Socket.EVENT_CONNECT_ERROR) { joined = false }
            s.on("voice_rx") { args ->
                val bytes = args.firstOrNull() as? ByteArray
                if (bytes != null && bytes.isNotEmpty()) listener?.invoke(bytes)
            }
            socket = s
            lastAckAt = SystemClock.elapsedRealtime()
            joined = false

            val t = HandlerThread("KishkaVoiceWatch").also { it.start() }
            thread = t
            val h = Handler(t.looper)
            handler = h
            val r = object : Runnable {
                override fun run() {
                    watchdog()
                    handler?.postDelayed(this, PING_EVERY_MS)
                }
            }
            pinger = r
            h.postDelayed(r, PING_EVERY_MS)
            s.connect()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /** Закрити канал (дзвінок завершено). */
    @Synchronized
    fun close() {
        try {
            pinger?.let { handler?.removeCallbacks(it) }
            pinger = null
            handler = null
            thread?.quitSafely()
            thread = null
            val s = socket
            socket = null
            joined = false
            listener = null
            if (s != null) {
                s.off()
                s.disconnect()
                s.close()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        email = ""
    }

    /** Хто отримує пакети голосу, що прийшли цим каналом. */
    fun setListener(l: ((ByteArray) -> Unit)?) {
        listener = l
    }

    /** true — пакет пішов голосовим каналом; false — канал не готовий, надсилайте основним сокетом. */
    fun send(target: String, packet: ByteArray): Boolean {
        val s = socket ?: return false
        if (!joined || !s.connected()) return false
        if (SystemClock.elapsedRealtime() - lastAckAt > FRESH_MS) return false
        return try {
            val json = JSONObject().apply {
                put("targetEmail", target.trim().lowercase())
                put("chunk", packet)
            }
            s.emit("voice_tx", json)
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    private fun join(s: Socket) {
        try {
            val json = JSONObject().put("email", email)
            s.emit("voice_join", json, Ack { args ->
                val ok = (args.firstOrNull() as? JSONObject)?.optBoolean("ok", false) ?: false
                if (ok) {
                    joined = true
                    lastAckAt = SystemClock.elapsedRealtime()
                }
            })
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /** Раз на 2 секунди: канал живий? Немає відповіді — перепідключаємо; не в кімнаті — заходимо знову. */
    private fun watchdog() {
        val s = socket ?: return
        try {
            if (!s.connected()) {
                joined = false
                s.connect()
                return
            }
            val json = JSONObject().put("email", email)
            s.emit("voice_ping", json, Ack { args ->
                val res = args.firstOrNull() as? JSONObject
                if (res != null && res.optBoolean("ok", false)) {
                    lastAckAt = SystemClock.elapsedRealtime()
                    if (!res.optBoolean("inRoom", true)) join(s)
                }
            })
            if (SystemClock.elapsedRealtime() - lastAckAt > DEAD_AFTER_MS) {
                // З'єднання «зависло» (мережа змінилась, а сокет цього не помітив): перезапускаємо
                joined = false
                lastAckAt = SystemClock.elapsedRealtime()
                s.disconnect()
                s.connect()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}
