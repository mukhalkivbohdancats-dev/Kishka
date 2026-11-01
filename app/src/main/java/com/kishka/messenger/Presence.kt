package com.kishka.messenger

import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import io.socket.client.Ack
import io.socket.client.Socket
import io.socket.emitter.Emitter
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Стан одного контакту: чи він зараз у застосунку та коли востаннє був у мережі (мс). */
data class PresenceInfo(val online: Boolean, val lastSeen: Long)

/** Поточний стан контактів. Оновлюється з сервера, зберігається на сервері в базі (Neon). */
object PresenceRepo {
    val state = mutableStateMapOf<String, PresenceInfo>()
}

/**
 * «В мережі» / «був(-ла) в мережі 3 хв тому». Працює через той самий сокет, що й месенджер, нічого в ньому не змінюючи:
 *  - застосунок надсилає presence_state {email, active}, коли він на екрані / згорнутий;
 *  - сервер зберігає час останньої активності в Neon і розсилає presence_changed контактам;
 *  - get_presence повертає стан усіх контактів (після запуску, перепідключення, зміни списку контактів).
 */
object Presence {
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile private var me: String? = null
    @Volatile private var foreground = false
    private var listenersAdded = false

    private val socket: Socket get() = KishkaManager.getSocket()

    /** Викликається після входу в акаунт. */
    fun start(email: String) {
        val clean = email.trim().lowercase()
        if (clean.isEmpty()) return
        me = clean
        if (!listenersAdded) {
            listenersAdded = true
            socket.on("presence_changed", Emitter.Listener { args ->
                val obj = args.firstOrNull() as? JSONObject ?: return@Listener
                val who = obj.optString("email", "").trim().lowercase()
                if (who.isEmpty()) return@Listener
                val info = PresenceInfo(obj.optBoolean("online", false), obj.optLong("lastSeen", 0L))
                mainHandler.post { PresenceRepo.state[who] = info }
            })
            // Після кожного (пере)підключення сокета: повідомляємо свій стан і оновлюємо стан контактів
            socket.on(Socket.EVENT_CONNECT, Emitter.Listener {
                sendState()
                request()
            })
        }
        sendState()
        request()
    }

    /** Викликається при виході з акаунта. */
    fun stop() {
        sendState(forceActive = false)
        me = null
        mainHandler.post { PresenceRepo.state.clear() }
    }

    /** MainActivity.onStart / onStop: застосунок на екрані або згорнутий. */
    fun setForeground(value: Boolean) {
        foreground = value
        sendState()
    }

    private fun sendState(forceActive: Boolean? = null) {
        val email = me ?: return
        try {
            val s = socket
            if (!s.connected()) return
            s.emit("presence_state", JSONObject().apply {
                put("email", email)
                put("active", forceActive ?: foreground)
            })
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /** Запитує в сервера стан усіх моїх контактів. */
    fun request() {
        val email = me ?: return
        try {
            val s = socket
            if (!s.connected()) return
            s.emit("get_presence", JSONObject().put("email", email), Ack { args ->
                val obj = args.firstOrNull() as? JSONObject ?: return@Ack
                if (!obj.optBoolean("success", false)) return@Ack
                val map = obj.optJSONObject("presence") ?: return@Ack
                val parsed = HashMap<String, PresenceInfo>()
                val keys = map.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    val item = map.optJSONObject(key) ?: continue
                    parsed[key.trim().lowercase()] = PresenceInfo(item.optBoolean("online", false), item.optLong("lastSeen", 0L))
                }
                mainHandler.post { PresenceRepo.state.putAll(parsed) }
            })
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}

/** Тексти статусу: «в мережі», «був(-ла) в мережі 3 хв тому», далі — час, наприклад «о 16:56». */
object PresenceText {
    private fun time(ts: Long): String = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ts))
    private fun date(ts: Long): String = SimpleDateFormat("dd.MM", Locale.getDefault()).format(Date(ts))

    fun status(lang: String, info: PresenceInfo?, now: Long): String? {
        if (info == null) return null
        if (info.online) {
            return when (lang) {
                "ru" -> "в сети"
                "en" -> "online"
                else -> "в мережі"
            }
        }
        if (info.lastSeen <= 0L) return null

        val minutes = ((now - info.lastSeen) / 60000L).coerceAtLeast(0L)
        val today = isSameDay(info.lastSeen, now)
        val yesterday = isSameDay(info.lastSeen, now - 24L * 60L * 60L * 1000L)

        return when (lang) {
            "ru" -> when {
                minutes < 1 -> "был(а) в сети только что"
                minutes < 60 -> "был(а) в сети $minutes мин назад"
                today -> "был(а) в сети в ${time(info.lastSeen)}"
                yesterday -> "был(а) в сети вчера в ${time(info.lastSeen)}"
                else -> "был(а) в сети ${date(info.lastSeen)} в ${time(info.lastSeen)}"
            }
            "en" -> when {
                minutes < 1 -> "last seen just now"
                minutes < 60 -> "last seen $minutes min ago"
                today -> "last seen at ${time(info.lastSeen)}"
                yesterday -> "last seen yesterday at ${time(info.lastSeen)}"
                else -> "last seen ${date(info.lastSeen)} at ${time(info.lastSeen)}"
            }
            else -> when {
                minutes < 1 -> "був(-ла) в мережі щойно"
                minutes < 60 -> "був(-ла) в мережі $minutes хв тому"
                today -> "був(-ла) в мережі о ${time(info.lastSeen)}"
                yesterday -> "був(-ла) в мережі вчора о ${time(info.lastSeen)}"
                else -> "був(-ла) в мережі ${date(info.lastSeen)} о ${time(info.lastSeen)}"
            }
        }
    }
}

/** Поточний час, що оновлюється кожні 20 с — щоб «3 хв тому» сама ставала «4 хв тому». */
@Composable
fun rememberPresenceNow(): Long {
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(20_000L)
            now = System.currentTimeMillis()
        }
    }
    return now
}

/** Зелена позначка «в мережі» (ставиться на аватарку в правому нижньому куті). */
@Composable
fun OnlineDot(modifier: Modifier = Modifier, size: Int = 14) {
    Box(
        modifier = modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(Color.White)
            .padding(2.dp)
            .clip(CircleShape)
            .background(Color(0xFF2ECC71))
    )
}
