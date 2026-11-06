package com.kishka.messenger

import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.auth.FirebaseAuth
import io.socket.client.Ack
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.concurrent.thread

/** Адміністратор месенджера: вкладка Admin доступна ЛИШЕ з цієї пошти. */
object AdminConfig {
    const val ADMIN_EMAIL = "mukhalkivbohdancats@gmail.com"

    fun isAdmin(email: String?): Boolean = email?.trim()?.lowercase() == ADMIN_EMAIL
}

/**
 * Права поточного користувача, які виставляє адміністратор (приходять із сервера):
 *  - banned  — акаунт заблоковано: вихід з акаунта й повідомлення «акаунт забанено»;
 *  - gemini / chatgpt — доступ до вкладок Gemini і ChatGPT;
 *  - mention — доступ до «@» (згадка @gemini / @chatgpt у чатах).
 */
object Access {
    private val main = Handler(Looper.getMainLooper())

    var banned by mutableStateOf(false)
    var gemini by mutableStateOf(true)
    var chatgpt by mutableStateOf(true)
    var mention by mutableStateOf(true)

    /** Сервер надсилає {banned, noGemini, noChatgpt, noMention}. */
    fun applyFlags(obj: JSONObject) {
        val b = obj.optBoolean("banned", false)
        val g = !obj.optBoolean("noGemini", false)
        val c = !obj.optBoolean("noChatgpt", false)
        val m = !obj.optBoolean("noMention", false)
        main.post {
            gemini = g
            chatgpt = c
            mention = m
            if (b) banned = true
        }
    }

    fun markBanned() {
        main.post { banned = true }
    }

    /** Після виходу з акаунта. */
    fun reset() {
        main.post {
            banned = false
            gemini = true
            chatgpt = true
            mention = true
        }
    }
}

object AdminStrings {
    private val dictionary = mapOf(
        "uk" to mapOf(
            "tab" to "Адмін",
            "title" to "Адміністратор",
            "email" to "Пошта користувача",
            "check" to "Перевірити",
            "ban" to "Забанити",
            "unban" to "Розбанити",
            "state_banned" to "Акаунт заблоковано",
            "state_ok" to "Акаунт не заблоковано",
            "not_found" to "Такого користувача в Kishka немає",
            "access" to "Доступ до ШІ",
            "gemini" to "Gemini",
            "chatgpt" to "ChatGPT",
            "mention" to "Згадка «@» у чатах",
            "list_title" to "Користувачі з обмеженнями",
            "list_empty" to "Обмежень поки немає",
            "done_ban" to "Користувача забанено",
            "done_unban" to "Користувача розбанено",
            "done" to "Збережено",
            "error" to "Не вдалося виконати. Перевірте зʼєднання і спробуйте ще раз",
            "bad_email" to "Введіть коректну пошту",
            "self_ban" to "Себе забанити не можна",
            "banned_login" to "Ваш акаунт був забанений",
            "off_title" to "Доступ вимкнено",
            "off_text" to "Адміністратор вимкнув вам доступ до %s",
            "tag_ban" to "бан",
            "tag_gemini" to "без Gemini",
            "tag_chatgpt" to "без ChatGPT",
            "tag_mention" to "без «@»"
        ),
        "ru" to mapOf(
            "tab" to "Админ",
            "title" to "Администратор",
            "email" to "Почта пользователя",
            "check" to "Проверить",
            "ban" to "Забанить",
            "unban" to "Разбанить",
            "state_banned" to "Аккаунт заблокирован",
            "state_ok" to "Аккаунт не заблокирован",
            "not_found" to "Такого пользователя в Kishka нет",
            "access" to "Доступ к ИИ",
            "gemini" to "Gemini",
            "chatgpt" to "ChatGPT",
            "mention" to "Упоминание «@» в чатах",
            "list_title" to "Пользователи с ограничениями",
            "list_empty" to "Ограничений пока нет",
            "done_ban" to "Пользователь забанен",
            "done_unban" to "Пользователь разбанен",
            "done" to "Сохранено",
            "error" to "Не удалось выполнить. Проверьте соединение и попробуйте ещё раз",
            "bad_email" to "Введите корректную почту",
            "self_ban" to "Себя забанить нельзя",
            "banned_login" to "Ваш аккаунт был забанен",
            "off_title" to "Доступ отключён",
            "off_text" to "Администратор отключил вам доступ к %s",
            "tag_ban" to "бан",
            "tag_gemini" to "без Gemini",
            "tag_chatgpt" to "без ChatGPT",
            "tag_mention" to "без «@»"
        ),
        "en" to mapOf(
            "tab" to "Admin",
            "title" to "Administrator",
            "email" to "User email",
            "check" to "Check",
            "ban" to "Ban",
            "unban" to "Unban",
            "state_banned" to "The account is banned",
            "state_ok" to "The account is not banned",
            "not_found" to "There is no such user in Kishka",
            "access" to "AI access",
            "gemini" to "Gemini",
            "chatgpt" to "ChatGPT",
            "mention" to "\"@\" mention in chats",
            "list_title" to "Users with restrictions",
            "list_empty" to "No restrictions yet",
            "done_ban" to "The user was banned",
            "done_unban" to "The user was unbanned",
            "done" to "Saved",
            "error" to "Could not do it. Check the connection and try again",
            "bad_email" to "Enter a valid email",
            "self_ban" to "You cannot ban yourself",
            "banned_login" to "Your account has been banned",
            "off_title" to "Access turned off",
            "off_text" to "The administrator turned off your access to %s",
            "tag_ban" to "banned",
            "tag_gemini" to "no Gemini",
            "tag_chatgpt" to "no ChatGPT",
            "tag_mention" to "no \"@\""
        )
    )

    fun get(key: String, lang: String): String =
        dictionary[lang]?.get(key) ?: dictionary["uk"]?.get(key) ?: key
}

/** Перевірка бану перед входом: публічний запит GET /ban-status. null = сервер не відповів (тоді вхід не блокуємо — сервер все одно не пропустить). */
object BanCheck {
    fun check(email: String, onResult: (Boolean?) -> Unit) {
        val main = Handler(Looper.getMainLooper())
        thread(start = true, name = "KishkaBanCheck") {
            var result: Boolean? = null
            try {
                val url = URL(KishkaManager.SERVER_URL + "/ban-status?email=" + URLEncoder.encode(email.trim().lowercase(), "UTF-8"))
                val conn = url.openConnection() as HttpURLConnection
                conn.connectTimeout = 15000
                conn.readTimeout = 20000
                conn.requestMethod = "GET"
                if (conn.responseCode == 200) {
                    val body = conn.inputStream.bufferedReader().use { it.readText() }
                    result = JSONObject(body).optBoolean("banned", false)
                }
                conn.disconnect()
            } catch (e: Exception) {
                e.printStackTrace()
            }
            main.post { onResult(result) }
        }
    }
}

/** Екран «доступ вимкнено» замість вкладки Gemini / ChatGPT, якщо адміністратор забрав доступ. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccessBlockedScreen(aiName: String, lang: String) {
    Scaffold(
        topBar = { TopAppBar(title = { Text(aiName, fontWeight = FontWeight.Bold) }) }
    ) { padding ->
        Box(
            modifier = Modifier.fillMaxSize().padding(padding).padding(32.dp),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    modifier = Modifier.size(84.dp).clip(CircleShape).background(ViberLightPurple),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Default.Lock, contentDescription = null, tint = ViberPurple, modifier = Modifier.size(44.dp))
                }
                Spacer(modifier = Modifier.height(18.dp))
                Text(AdminStrings.get("off_title", lang), fontSize = 20.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    String.format(AdminStrings.get("off_text", lang), aiName),
                    fontSize = 14.sp,
                    color = Color.Gray,
                    textAlign = TextAlign.Center
                )
            }
        }
    }
}

private data class AdminUserState(
    val email: String,
    val name: String,
    val banned: Boolean,
    val noGemini: Boolean,
    val noChatgpt: Boolean,
    val noMention: Boolean
)

private fun parseAdminUser(o: JSONObject): AdminUserState = AdminUserState(
    email = o.optString("email", "").trim().lowercase(),
    name = o.optString("name", ""),
    banned = o.optBoolean("banned", false),
    noGemini = o.optBoolean("noGemini", false),
    noChatgpt = o.optBoolean("noChatgpt", false),
    noMention = o.optBoolean("noMention", false)
)

/** Запит адміністратора до сервера. Сервер сам перевіряє, що запит справді від цієї пошти (токен Firebase). */
private fun adminRequest(event: String, payload: JSONObject, onResult: (JSONObject?) -> Unit) {
    val main = Handler(Looper.getMainLooper())
    val user = FirebaseAuth.getInstance().currentUser
    if (user == null) {
        onResult(null)
        return
    }
    user.getIdToken(false).addOnCompleteListener { task ->
        val token = if (task.isSuccessful) task.result?.token else null
        if (token.isNullOrEmpty()) {
            main.post { onResult(null) }
            return@addOnCompleteListener
        }
        try {
            payload.put("idToken", token)
            payload.put("adminEmail", user.email?.lowercase() ?: "")
            val socket = KishkaManager.getSocket()
            if (!socket.connected()) socket.connect()
            socket.emit(event, payload, Ack { args ->
                val res = args.firstOrNull() as? JSONObject
                main.post { onResult(res) }
            })
        } catch (e: Exception) {
            e.printStackTrace()
            main.post { onResult(null) }
        }
    }
}

/** Вкладка Admin: бан за поштою + керування доступом до Gemini, ChatGPT і «@». Показується лише адміністратору. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminTab(adminEmail: String, lang: String) {
    val a: (String) -> String = { key -> AdminStrings.get(key, lang) }

    var emailInput by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var state by remember { mutableStateOf<AdminUserState?>(null) }
    val restricted = remember { mutableStateListOf<AdminUserState>() }
    var listLoading by remember { mutableStateOf(false) }

    fun refreshList() {
        listLoading = true
        adminRequest("admin_list", JSONObject()) { res ->
            listLoading = false
            if (res != null && res.optBoolean("success", false)) {
                val arr: JSONArray = res.optJSONArray("users") ?: JSONArray()
                restricted.clear()
                for (i in 0 until arr.length()) {
                    arr.optJSONObject(i)?.let { restricted.add(parseAdminUser(it)) }
                }
            }
        }
    }

    fun load(email: String) {
        val clean = email.trim().lowercase()
        if (!clean.contains("@") || clean.length < 5) {
            Notice.show(a("bad_email"))
            return
        }
        loading = true
        adminRequest("admin_get_user", JSONObject().apply { put("email", clean) }) { res ->
            loading = false
            if (res != null && res.optBoolean("success", false)) {
                if (res.optBoolean("exists", true)) {
                    state = parseAdminUser(res.optJSONObject("user") ?: JSONObject().put("email", clean))
                } else {
                    state = null
                    Notice.show(a("not_found"))
                }
            } else {
                Notice.show(a("error"))
            }
        }
    }

    fun setFlag(email: String, flag: String, value: Boolean) {
        val clean = email.trim().lowercase()
        if (!clean.contains("@") || clean.length < 5) {
            Notice.show(a("bad_email"))
            return
        }
        if (flag == "banned" && value && clean == adminEmail.trim().lowercase()) {
            Notice.show(a("self_ban"))
            return
        }
        loading = true
        adminRequest("admin_set_flag", JSONObject().apply {
            put("email", clean)
            put("flag", flag)
            put("value", value)
        }) { res ->
            loading = false
            if (res != null && res.optBoolean("success", false)) {
                state = parseAdminUser(res.optJSONObject("user") ?: JSONObject().put("email", clean))
                Notice.show(
                    when {
                        flag == "banned" && value -> a("done_ban")
                        flag == "banned" -> a("done_unban")
                        else -> a("done")
                    }
                )
                refreshList()
            } else if (res != null && res.optString("code", "") == "not_found") {
                Notice.show(a("not_found"))
            } else {
                Notice.show(a("error"))
            }
        }
    }

    LaunchedEffect(Unit) { refreshList() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.AdminPanelSettings, contentDescription = null, tint = ViberPurple)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(a("title"), fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            )
        }
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
            Column(
                modifier = Modifier
                    .widthIn(max = 560.dp)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 12.dp)
            ) {
                // Верхній відступ у полі, щоб підпис поля не обрізався зверху при прокрутці з клавіатурою
                OutlinedTextField(
                    value = emailInput,
                    onValueChange = {
                        emailInput = it.trim()
                        if (state?.email != emailInput.lowercase()) state = null
                    },
                    label = { Text(a("email")) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    modifier = Modifier.fillMaxWidth().padding(top = 10.dp)
                )

                Spacer(modifier = Modifier.height(12.dp))

                val current = state
                val isBanned = current != null && current.email == emailInput.trim().lowercase() && current.banned

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(
                        onClick = { load(emailInput) },
                        enabled = !loading && emailInput.isNotBlank(),
                        modifier = Modifier.weight(1f).height(48.dp),
                        shape = RoundedCornerShape(14.dp)
                    ) {
                        Text(a("check"), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Button(
                        onClick = { setFlag(emailInput, "banned", !isBanned) },
                        enabled = !loading && emailInput.isNotBlank(),
                        modifier = Modifier.weight(1f).height(48.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = if (isBanned) Color(0xFF2E7D32) else Color(0xFFD93025))
                    ) {
                        if (loading) {
                            CircularProgressIndicator(color = Color.White, modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                        } else {
                            Text(if (isBanned) a("unban") else a("ban"), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }

                if (current != null) {
                    Spacer(modifier = Modifier.height(16.dp))
                    Surface(shape = RoundedCornerShape(18.dp), color = Color.White, shadowElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(
                                current.name.ifEmpty { current.email },
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(current.email, color = Color.Gray, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(
                                if (current.banned) a("state_banned") else a("state_ok"),
                                color = if (current.banned) Color(0xFFD93025) else Color(0xFF2E7D32),
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                            Spacer(modifier = Modifier.height(14.dp))
                            Text(a("access"), fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = Color.Gray)
                            AccessSwitch(a("gemini"), !current.noGemini, !loading) { setFlag(current.email, "noGemini", !it) }
                            AccessSwitch(a("chatgpt"), !current.noChatgpt, !loading) { setFlag(current.email, "noChatgpt", !it) }
                            AccessSwitch(a("mention"), !current.noMention, !loading) { setFlag(current.email, "noMention", !it) }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(20.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(a("list_title"), fontWeight = FontWeight.Bold, fontSize = 15.sp, modifier = Modifier.weight(1f))
                    if (listLoading) CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = ViberPurple)
                }
                Spacer(modifier = Modifier.height(8.dp))
                if (restricted.isEmpty()) {
                    Text(a("list_empty"), color = Color.Gray, fontSize = 13.sp)
                } else {
                    restricted.forEach { u ->
                        val tags = ArrayList<String>()
                        if (u.banned) tags.add(a("tag_ban"))
                        if (u.noGemini) tags.add(a("tag_gemini"))
                        if (u.noChatgpt) tags.add(a("tag_chatgpt"))
                        if (u.noMention) tags.add(a("tag_mention"))
                        Surface(
                            shape = RoundedCornerShape(14.dp),
                            color = Color.White,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 3.dp)
                                .clickable {
                                    emailInput = u.email
                                    state = u
                                }
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Text(u.name.ifEmpty { u.email }, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(u.email, color = Color.Gray, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(tags.joinToString(", "), color = Color(0xFFD93025), fontSize = 12.sp)
                            }
                        }
                    }
                }
                Spacer(modifier = Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun AccessSwitch(label: String, allowed: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, modifier = Modifier.weight(1f), fontSize = 15.sp)
        Switch(
            checked = allowed,
            onCheckedChange = onChange,
            enabled = enabled,
            colors = SwitchDefaults.colors(checkedTrackColor = ViberPurple)
        )
    }
}
