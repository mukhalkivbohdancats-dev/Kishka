package com.kishka.messenger

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import coil.compose.AsyncImage
import io.socket.client.Ack
import io.socket.client.Socket
import io.socket.emitter.Emitter
import kotlinx.coroutines.delay
import org.json.JSONObject

/** Аватарка вкладки KishkaBlox: Assets/Kishkablox.png у репозиторії. */
const val KISHKABLOX_LOGO_URL =
    "https://raw.githubusercontent.com/mukhalkivbohdancats-dev/Kishka/main/Assets/Kishkablox.png"

object BloxStrings {
    private val dictionary = mapOf(
        "uk" to mapOf(
            "tab" to "KishkaBlox",
            "home" to "Головна",
            "more" to "Ще",
            "logout" to "Вийти",
            "logout_title" to "Ви впевнені?",
            "logout_text" to "Ви вийдете з акаунта KishkaBlox.",
            "yes" to "Так",
            "no" to "Ні",
            "add_friends" to "Додати друзів",
            "add_friend" to "Додати в друзі",
            "accept_request" to "Прийняти запит у друзі?",
            "accept" to "Прийняти",
            "reject" to "Відхилити",
            "delete_friend" to "Видалити друга",
            "retry" to "Повторити",
            "login_title" to "Вхід у KishkaBlox",
            "register_title" to "Створити акаунт KishkaBlox",
            "nick" to "Нікнейм",
            "nick_hint" to "3-20 символів: літери, цифри, підкреслення",
            "password" to "Пароль",
            "password_hint" to "Мінімум 6 символів, будь-який",
            "login_btn" to "Увійти",
            "register_btn" to "Створити акаунт",
            "to_register" to "Немає акаунта? Створити",
            "to_login" to "Вже є акаунт? Увійти",
            "err_bad_nick" to "Нікнейм має бути від 3 до 20 символів: лише літери, цифри та підкреслення",
            "err_bad_password" to "Пароль має містити щонайменше 6 символів",
            "err_taken" to "Цей нікнейм уже зайнятий. Оберіть інший",
            "err_has_account" to "У цього акаунта Kishka вже є акаунт KishkaBlox",
            "err_not_found" to "Акаунта з таким нікнеймом немає",
            "err_wrong_password" to "Неправильний нікнейм або пароль",
            "err_too_many" to "Забагато невдалих спроб. Спробуйте за кілька хвилин",
            "err_error" to "Не вдалося виконати. Перевірте інтернет і спробуйте ще раз",
            "err_empty" to "Введіть нікнейм і пароль",
            "install_title" to "Установити KishkaBlox?",
            "install" to "Установити",
            "install_error" to "Не вдалося установити. Перевірте інтернет і спробуйте ще раз",
            "get_started" to "Розпочати",
            "joining" to "Приєднання до гри",
            "leave" to "Вийти з гри",
            "leave_text" to "Ви точно хочете вийти з гри?"
        ),
        "ru" to mapOf(
            "tab" to "KishkaBlox",
            "home" to "Главная",
            "more" to "Ещё",
            "logout" to "Выйти",
            "logout_title" to "Вы уверены?",
            "logout_text" to "Вы выйдете из аккаунта KishkaBlox.",
            "yes" to "Да",
            "no" to "Нет",
            "add_friends" to "Добавить друзей",
            "add_friend" to "Добавить в друзья",
            "accept_request" to "Принять запрос в друзья?",
            "accept" to "Принять",
            "reject" to "Отклонить",
            "delete_friend" to "Удалить друга",
            "retry" to "Повторить",
            "login_title" to "Вход в KishkaBlox",
            "register_title" to "Создать аккаунт KishkaBlox",
            "nick" to "Никнейм",
            "nick_hint" to "3-20 символов: буквы, цифры, подчёркивание",
            "password" to "Пароль",
            "password_hint" to "Минимум 6 символов, любой",
            "login_btn" to "Войти",
            "register_btn" to "Создать аккаунт",
            "to_register" to "Нет аккаунта? Создать",
            "to_login" to "Уже есть аккаунт? Войти",
            "err_bad_nick" to "Никнейм должен быть от 3 до 20 символов: только буквы, цифры и подчёркивание",
            "err_bad_password" to "Пароль должен содержать минимум 6 символов",
            "err_taken" to "Этот никнейм уже занят. Выберите другой",
            "err_has_account" to "У этого аккаунта Kishka уже есть аккаунт KishkaBlox",
            "err_not_found" to "Аккаунта с таким никнеймом нет",
            "err_wrong_password" to "Неправильный никнейм или пароль",
            "err_too_many" to "Слишком много неудачных попыток. Попробуйте через несколько минут",
            "err_error" to "Не удалось выполнить. Проверьте интернет и попробуйте ещё раз",
            "err_empty" to "Введите никнейм и пароль",
            "install_title" to "Установить KishkaBlox?",
            "install" to "Установить",
            "install_error" to "Не удалось установить. Проверьте интернет и попробуйте ещё раз",
            "get_started" to "Начать",
            "joining" to "Присоединение к игре",
            "leave" to "Выйти из игры",
            "leave_text" to "Вы точно хотите выйти из игры?"
        ),
        "en" to mapOf(
            "tab" to "KishkaBlox",
            "home" to "Home",
            "more" to "More",
            "logout" to "Log out",
            "logout_title" to "Are you sure?",
            "logout_text" to "You will be logged out of your KishkaBlox account.",
            "yes" to "Yes",
            "no" to "No",
            "add_friends" to "Add Friends",
            "add_friend" to "Add friend",
            "accept_request" to "Accept friend request?",
            "accept" to "Accept",
            "reject" to "Reject",
            "delete_friend" to "Delete friend",
            "retry" to "Retry",
            "login_title" to "Log in to KishkaBlox",
            "register_title" to "Create a KishkaBlox account",
            "nick" to "Nickname",
            "nick_hint" to "3-20 characters: letters, digits, underscore",
            "password" to "Password",
            "password_hint" to "At least 6 characters, anything goes",
            "login_btn" to "Log in",
            "register_btn" to "Create account",
            "to_register" to "No account? Create one",
            "to_login" to "Already have an account? Log in",
            "err_bad_nick" to "The nickname must be 3-20 characters: only letters, digits and underscore",
            "err_bad_password" to "The password must have at least 6 characters",
            "err_taken" to "This nickname is already taken. Choose another one",
            "err_has_account" to "This Kishka account already has a KishkaBlox account",
            "err_not_found" to "There is no account with this nickname",
            "err_wrong_password" to "Wrong nickname or password",
            "err_too_many" to "Too many failed attempts. Try again in a few minutes",
            "err_error" to "Could not do it. Check the internet and try again",
            "err_empty" to "Enter a nickname and a password",
            "install_title" to "Install KishkaBlox?",
            "install" to "Install",
            "install_error" to "Could not install. Check the internet and try again",
            "get_started" to "Get started",
            "joining" to "Joining the game",
            "leave" to "Leave",
            "leave_text" to "Are you sure you want to leave the game?"
        )
    )

    fun get(key: String, lang: String): String =
        dictionary[lang]?.get(key) ?: dictionary["uk"]?.get(key) ?: key
}

/** Результат пошуку друга за ніком. relation: none | sent | incoming | friend. */
data class BloxFound(val nick: String, val relation: String)

/**
 * Акаунт KishkaBlox ПРИВ'ЯЗАНИЙ ДО АКАУНТА KISHKA (його пошти), а не до пристрою: усе (чи є акаунт, чи увійшли, нік,
 * друзі, запити) зберігає сервер (kishkablox.js). Тому на іншому телефоні з тим самим акаунтом Kishka KishkaBlox
 * відкривається одразу, а інший акаунт Kishka на цьому ж телефоні бачить свій власний KishkaBlox.
 * На пристрої лишається лише кеш останнього стану (по пошті), щоб екран не був порожнім, поки відповідає сервер.
 */
object BloxAuth {
    private const val PREFS = "kishkablox_cache"
    private const val REQUEST_TIMEOUT_MS = 20_000L

    private val main = Handler(Looper.getMainLooper())

    /** loading | none (акаунта ще немає) | out (вийшли) | in (увійшли) | error (немає зв'язку, кешу немає). */
    var state by mutableStateOf("loading")
        private set
    var nick by mutableStateOf("")
        private set
    var friends by mutableStateOf<List<String>>(emptyList())
        private set
    var incoming by mutableStateOf<List<String>>(emptyList())
        private set
    var outgoing by mutableStateOf<List<String>>(emptyList())
        private set

    /** Пошта акаунта Kishka, чий стан зараз у цьому об'єкті. */
    var boundEmail by mutableStateOf("")
        private set
    private val email: String get() = boundEmail
    private var refreshSeq = 0

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun namesOf(json: JSONObject, key: String): List<String> {
        val arr = json.optJSONArray(key) ?: return emptyList()
        val list = ArrayList<String>(arr.length())
        for (i in 0 until arr.length()) {
            val name = arr.optString(i, "")
            if (name.isNotEmpty()) list.add(name)
        }
        return list
    }

    private fun applyJson(json: JSONObject) {
        val st = json.optString("state", "")
        if (st != "none" && st != "out" && st != "in") return
        nick = json.optString("nick", "")
        friends = namesOf(json, "friends")
        incoming = namesOf(json, "incoming")
        outgoing = namesOf(json, "outgoing")
        state = st
    }

    /** Вкладку відкрито або змінився акаунт Kishka: показуємо кеш цього акаунта й питаємо сервер. */
    fun open(context: Context, newEmail: String) {
        if (newEmail != boundEmail) {
            boundEmail = newEmail
            refreshSeq++
            friends = emptyList()
            incoming = emptyList()
            outgoing = emptyList()
            nick = ""
            state = "loading"
            if (newEmail.isNotEmpty()) {
                val cached = prefs(context).getString("status_$newEmail", null)
                if (cached != null) {
                    try { applyJson(JSONObject(cached)) } catch (e: Exception) { /* кеш пошкоджено — чекаємо сервер */ }
                }
            }
        }
        refresh(context)
    }

    /** Запит до сервера з обмеженням часу; відповідь завжди приходить у головному потоці (null — немає зв'язку). */
    private fun request(event: String, payload: JSONObject, onResult: (JSONObject?) -> Unit) {
        var finished = false
        val timeout = Runnable {
            if (!finished) {
                finished = true
                onResult(null)
            }
        }
        main.postDelayed(timeout, REQUEST_TIMEOUT_MS)
        try {
            payload.put("email", email)
            val socket = KishkaManager.getSocket()
            if (!socket.connected()) socket.connect()
            socket.emit(event, payload, Ack { args ->
                val res = args.firstOrNull() as? JSONObject
                main.post {
                    if (!finished) {
                        finished = true
                        main.removeCallbacks(timeout)
                        onResult(res)
                    }
                }
            })
        } catch (e: Exception) {
            e.printStackTrace()
            main.post {
                if (!finished) {
                    finished = true
                    main.removeCallbacks(timeout)
                    onResult(null)
                }
            }
        }
    }

    /** Оновлює стан із сервера (вхід, нік, друзі, запити). Якщо сервер не відповів — лишається те, що було. */
    fun refresh(context: Context) {
        val asked = email
        if (asked.isEmpty()) return
        val seq = ++refreshSeq
        request("blox_status", JSONObject()) { res ->
            if (seq != refreshSeq || asked != email) return@request
            val st = res?.optString("state", "") ?: ""
            if (res != null && res.optBoolean("success", false) && (st == "none" || st == "out" || st == "in")) {
                prefs(context).edit().putString("status_$asked", res.toString()).apply()
                applyJson(res)
            } else if (state == "loading") {
                state = "error"
            }
        }
    }

    private fun finishAuth(context: Context, res: JSONObject?, onResult: (String?) -> Unit) {
        if (res == null) {
            onResult("error")
            return
        }
        if (res.optBoolean("success", false)) {
            refresh(context)
            onResult(null)
        } else {
            val code = res.optString("code", "error").ifEmpty { "error" }
            if (code == "has_account") refresh(context)
            onResult(code)
        }
    }

    /** onResult(null) — успіх, інакше код помилки (bad_nick, bad_password, taken, has_account, error). */
    fun register(context: Context, nickInput: String, password: String, onResult: (String?) -> Unit) {
        val payload = JSONObject().apply {
            put("nick", nickInput.trim())
            put("password", password)
        }
        request("blox_register", payload) { res -> finishAuth(context, res, onResult) }
    }

    /** onResult(null) — успіх, інакше код помилки (not_found, wrong_password, too_many, error). */
    fun login(context: Context, nickInput: String, password: String, onResult: (String?) -> Unit) {
        val payload = JSONObject().apply {
            put("nick", nickInput.trim())
            put("password", password)
        }
        request("blox_login", payload) { res -> finishAuth(context, res, onResult) }
    }

    /** Вихід з KishkaBlox (акаунт Kishka лишається): екран одразу показує вхід, сервер запам'ятовує вихід. */
    fun logout(context: Context, onDone: (Boolean) -> Unit) {
        friends = emptyList()
        incoming = emptyList()
        outgoing = emptyList()
        state = "out"
        request("blox_logout", JSONObject()) { res ->
            val ok = res != null && res.optBoolean("success", false)
            refresh(context)
            onDone(ok)
        }
    }

    /** Пошук за ніком (точний збіг). onResult(null) — немає зв'язку; BloxFound? = null — такого ніку немає. */
    fun search(query: String, onResult: (ok: Boolean, found: BloxFound?) -> Unit) {
        request("blox_search", JSONObject().put("query", query)) { res ->
            if (res == null || !res.optBoolean("success", false)) {
                onResult(false, null)
            } else if (!res.optBoolean("found", false)) {
                onResult(true, null)
            } else {
                onResult(true, BloxFound(res.optString("nick", ""), res.optString("relation", "none")))
            }
        }
    }

    /** Надіслати запит у друзі. onResult(relation) — sent | friend; null — не вдалося. */
    fun addFriend(context: Context, targetNick: String, onResult: (String?) -> Unit) {
        request("blox_add_friend", JSONObject().put("nick", targetNick)) { res ->
            if (res != null && res.optBoolean("success", false)) {
                refresh(context)
                onResult(res.optString("relation", "sent"))
            } else {
                onResult(null)
            }
        }
    }

    /** Прийняти (accept = true) або відхилити вхідний запит. Картка зникає одразу. */
    fun respond(context: Context, fromNick: String, accept: Boolean, onDone: (Boolean) -> Unit) {
        incoming = incoming.filter { !it.equals(fromNick, ignoreCase = true) }
        if (accept && friends.none { it.equals(fromNick, ignoreCase = true) }) friends = friends + fromNick
        val payload = JSONObject().put("nick", fromNick).put("accept", accept)
        request("blox_respond", payload) { res ->
            val ok = res != null && res.optBoolean("success", false)
            refresh(context)
            onDone(ok)
        }
    }

    /** Видалити друга. Нічого не блокується: запит можна надіслати знову. */
    fun deleteFriend(context: Context, friendNick: String, onDone: (Boolean) -> Unit) {
        friends = friends.filter { !it.equals(friendNick, ignoreCase = true) }
        request("blox_delete_friend", JSONObject().put("nick", friendNick)) { res ->
            val ok = res != null && res.optBoolean("success", false)
            refresh(context)
            onDone(ok)
        }
    }
}

/**
 * Вкладка KishkaBlox. Усе залежить від акаунта Kishka, у якому ви зараз:
 * немає акаунта / вийшли — вхід чи створення; увійшли — домашній екран із меню зліва (Home, More).
 */
@Composable
fun KishkabloxTab(lang: String, email: String, displayName: String, avatarUrl: String) {
    val context = LocalContext.current

    // Спершу — «Установити KishkaBlox?». Установка робиться один раз; після «Розпочати» вкладка відкривається одразу.
    LaunchedEffect(Unit) { BloxInstall.check(context) }

    if (BloxInstall.phase == BloxInstall.Phase.READY) {
        KishkabloxMain(lang = lang, email = email, displayName = displayName, avatarUrl = avatarUrl)
    } else {
        BloxInstallScreen(lang = lang)
    }
}

@Composable
private fun KishkabloxMain(lang: String, email: String, displayName: String, avatarUrl: String) {
    val context = LocalContext.current

    LaunchedEffect(email) { BloxAuth.open(context, email) }

    // Сервер повідомляє, коли змінились друзі/запити/вхід (в тому числі на іншому пристрої цього акаунта)
    DisposableEffect(email) {
        val socket = KishkaManager.getSocket()
        val handler = Handler(Looper.getMainLooper())
        val listener = Emitter.Listener { handler.post { BloxAuth.refresh(context) } }
        socket.on("blox_update", listener)
        socket.on(Socket.EVENT_CONNECT, listener)
        onDispose {
            socket.off("blox_update", listener)
            socket.off(Socket.EVENT_CONNECT, listener)
        }
    }

    // Запасний варіант: поки екран відкритий і ви увійшли — раз на 15 секунд звіряємось із сервером
    LaunchedEffect(email, BloxAuth.state) {
        if (BloxAuth.state == "in") {
            while (true) {
                delay(15_000)
                BloxAuth.refresh(context)
            }
        }
    }

    // key(email): при зміні акаунта Kishka весь внутрішній стан екрана починається заново
    key(email) {
        when (if (BloxAuth.boundEmail == email) BloxAuth.state else "loading") {
            "none" -> BloxLoginScreen(lang = lang, displayName = displayName, accountExists = false)
            "out" -> BloxLoginScreen(lang = lang, displayName = displayName, accountExists = true)
            "in" -> BloxHome(lang = lang, avatarUrl = avatarUrl)
            "error" -> BloxErrorScreen(lang = lang)
            else -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = ViberPurple, modifier = Modifier.size(44.dp))
            }
        }
    }
}

private fun bloxErrorText(code: String, lang: String): String = when (code) {
    "bad_nick" -> BloxStrings.get("err_bad_nick", lang)
    "bad_password" -> BloxStrings.get("err_bad_password", lang)
    "taken" -> BloxStrings.get("err_taken", lang)
    "has_account" -> BloxStrings.get("err_has_account", lang)
    "not_found" -> BloxStrings.get("err_not_found", lang)
    "wrong_password" -> BloxStrings.get("err_wrong_password", lang)
    "too_many" -> BloxStrings.get("err_too_many", lang)
    else -> BloxStrings.get("err_error", lang)
}

/** Нік за замовчуванням для нового акаунта: ім'я акаунта Kishka (лише літери, цифри, підкреслення; до 20 символів). */
private fun bloxDefaultNick(displayName: String): String {
    val cleaned = displayName.trim().replace(" ", "_").filter { it.isLetterOrDigit() || it == '_' }.take(20)
    return if (cleaned.length >= 3) cleaned else ""
}

@Composable
private fun BloxErrorScreen(lang: String) {
    val context = LocalContext.current
    Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                BloxStrings.get("err_error", lang),
                fontSize = 15.sp,
                color = Color.DarkGray,
                textAlign = TextAlign.Center
            )
            Spacer(modifier = Modifier.height(16.dp))
            Button(
                onClick = { BloxAuth.refresh(context) },
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = ViberPurple)
            ) {
                Text(BloxStrings.get("retry", lang), maxLines = 1)
            }
        }
    }
}

@Composable
private fun BloxTitle(lang: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        AsyncImage(
            model = KISHKABLOX_LOGO_URL,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(34.dp).clip(RoundedCornerShape(10.dp))
        )
        Spacer(modifier = Modifier.width(10.dp))
        Text(BloxStrings.get("tab", lang), fontWeight = FontWeight.Bold, color = ViberPurple, maxLines = 1)
    }
}

/**
 * Вхід / створення акаунта KishkaBlox (нік і пароль, без пошти й підтвердження).
 * accountExists = true: у цього акаунта Kishka вже є KishkaBlox (але ви вийшли) — лише вхід.
 * accountExists = false: нік підставляється з імені акаунта Kishka; тут же можна увійти у старий акаунт KishkaBlox.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BloxLoginScreen(lang: String, displayName: String, accountExists: Boolean) {
    val context = LocalContext.current
    val b: (String) -> String = { key -> BloxStrings.get(key, lang) }

    var registerMode by remember { mutableStateOf(!accountExists) }
    var nickInput by remember {
        mutableStateOf(if (accountExists) BloxAuth.nick else bloxDefaultNick(displayName))
    }
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }

    fun submit() {
        if (loading) return
        val cleanNick = nickInput.trim()
        if (cleanNick.isEmpty() || password.isEmpty()) {
            error = b("err_empty")
            return
        }
        if (registerMode) {
            if (cleanNick.length < 3 || cleanNick.length > 20 || !cleanNick.all { it.isLetterOrDigit() || it == '_' }) {
                error = b("err_bad_nick")
                return
            }
            if (password.length < 6) {
                error = b("err_bad_password")
                return
            }
        }
        error = ""
        loading = true
        val done: (String?) -> Unit = { code ->
            loading = false
            if (code != null) error = bloxErrorText(code, lang)
        }
        if (registerMode) BloxAuth.register(context, cleanNick, password, done)
        else BloxAuth.login(context, cleanNick, password, done)
    }

    Scaffold(topBar = { TopAppBar(title = { BloxTitle(lang) }) }) { padding ->
        Box(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentAlignment = Alignment.TopCenter
        ) {
            // Прокручується: на низьких екранах і в горизонтальному положенні всі поля й кнопки доступні
            Column(
                modifier = Modifier
                    .widthIn(max = 480.dp)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp, vertical = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                AsyncImage(
                    model = KISHKABLOX_LOGO_URL,
                    contentDescription = "KishkaBlox",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(96.dp).clip(RoundedCornerShape(24.dp))
                )
                Spacer(modifier = Modifier.height(14.dp))
                Text(
                    if (registerMode) b("register_title") else b("login_title"),
                    fontSize = 21.sp,
                    fontWeight = FontWeight.Bold,
                    color = ViberPurple,
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(16.dp))

                // Відступ зверху: підпис поля не обрізається, коли поле прокручується до самого верху з клавіатурою
                OutlinedTextField(
                    value = nickInput,
                    onValueChange = { nickInput = it.replace(" ", ""); error = "" },
                    label = { Text(b("nick"), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    supportingText = if (registerMode) {
                        { Text(b("nick_hint")) }
                    } else null,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                )

                Spacer(modifier = Modifier.height(8.dp))

                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it; error = "" },
                    label = { Text(b("password"), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    supportingText = if (registerMode) {
                        { Text(b("password_hint")) }
                    } else null,
                    singleLine = true,
                    visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    trailingIcon = {
                        IconButton(onClick = { showPassword = !showPassword }) {
                            Icon(
                                if (showPassword) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                contentDescription = null,
                                tint = Color.Gray
                            )
                        }
                    },
                    modifier = Modifier.fillMaxWidth()
                )

                if (error.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(error, color = Color(0xFFD93025), fontSize = 13.sp, textAlign = TextAlign.Center)
                }

                Spacer(modifier = Modifier.height(18.dp))

                Button(
                    onClick = { submit() },
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = ViberPurple),
                    enabled = !loading
                ) {
                    if (loading) {
                        CircularProgressIndicator(color = Color.White, modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                    } else {
                        Text(
                            if (registerMode) b("register_btn") else b("login_btn"),
                            fontSize = 16.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }

                // Якщо в акаунта Kishka уже є KishkaBlox, створювати другий не можна — перемикача немає
                if (!accountExists) {
                    Spacer(modifier = Modifier.height(10.dp))
                    TextButton(onClick = {
                        registerMode = !registerMode
                        error = ""
                    }) {
                        Text(
                            if (registerMode) b("to_login") else b("to_register"),
                            color = ViberPurple,
                            textAlign = TextAlign.Center
                        )
                    }
                }
                Spacer(modifier = Modifier.height(16.dp))
            }
        }
    }
}

private val BloxFriendGrey = Color(0xFFBDBDC7)
private val BloxCircleSize = 64.dp
private val BloxItemWidth = 76.dp

/** Домашній екран після входу: меню зліва (Home, More), праворуч — вибрана сторінка або «Додати друзів». */
@Composable
private fun BloxHome(lang: String, avatarUrl: String) {
    var page by rememberSaveable { mutableStateOf(0) }
    var addFriendsOpen by rememberSaveable { mutableStateOf(false) }

    Box(modifier = Modifier.fillMaxSize().background(ViberBg)) {
        if (addFriendsOpen) {
            BloxAddFriendsScreen(lang = lang, onBack = { addFriendsOpen = false })
        } else if (BloxGame.detailOpen) {
            // Сторінка гри: стрілочка назад, аватарка, назва і синя кнопка
            BloxGameDetail(onBack = { BloxGame.detailOpen = false }, onPlay = { BloxGame.enter() })
        } else {
            Row(modifier = Modifier.fillMaxSize()) {
                BloxRail(lang = lang, page = page, onSelect = { page = it })
                Box(modifier = Modifier.weight(1f).fillMaxHeight()) {
                    if (page == 0) {
                        BloxHomePage(lang = lang, avatarUrl = avatarUrl, onAddFriends = { addFriendsOpen = true }, onOpenGame = { BloxGame.detailOpen = true })
                    } else {
                        BloxMorePage(lang = lang)
                    }
                }
            }
        }
    }
}

/** Меню зліва: Home і More. */
@Composable
private fun BloxRail(lang: String, page: Int, onSelect: (Int) -> Unit) {
    Row(modifier = Modifier.fillMaxHeight()) {
        Column(
            modifier = Modifier
                .width(BloxItemWidth)
                .fillMaxHeight()
                .background(Color.White)
                .padding(top = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            BloxRailItem(Icons.Default.Home, BloxStrings.get("home", lang), page == 0) { onSelect(0) }
            Spacer(modifier = Modifier.height(6.dp))
            BloxRailItem(Icons.Default.MoreHoriz, BloxStrings.get("more", lang), page == 1) { onSelect(1) }
        }
        Box(modifier = Modifier.width(1.dp).fillMaxHeight().background(Color(0xFFE6E6EE)))
    }
}

@Composable
private fun BloxRailItem(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    Column(
        modifier = Modifier
            .padding(horizontal = 6.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) ViberLightPurple else Color.Transparent)
            .clickable { onClick() }
            .padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(icon, contentDescription = null, tint = if (selected) ViberPurple else Color.Gray, modifier = Modifier.size(26.dp))
        Spacer(modifier = Modifier.height(2.dp))
        Text(
            label,
            fontSize = 11.sp,
            color = if (selected) ViberPurple else Color.Gray,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

/** Home: аватарка-кружок і нік поруч, вхідні запити, ряд «Додати друзів» + сірі кружки друзів. */
@Composable
private fun BloxHomePage(lang: String, avatarUrl: String, onAddFriends: () -> Unit, onOpenGame: () -> Unit) {
    val context = LocalContext.current
    val b: (String) -> String = { key -> BloxStrings.get(key, lang) }
    var friendToDelete by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            AsyncImage(
                model = if (avatarUrl.isEmpty()) DEFAULT_AVATAR_URL else avatarUrl,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(BloxCircleSize).clip(CircleShape).background(BloxFriendGrey)
            )
            Spacer(modifier = Modifier.width(14.dp))
            Text(
                BloxAuth.nick,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = Color.Black,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
        }

        Spacer(modifier = Modifier.height(20.dp))

        // Вхідні запити: нік людини, «Прийняти запит у друзі?» і кнопки
        for (requestNick in BloxAuth.incoming) {
            key(requestNick) {
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = Color.White,
                    shadowElevation = 2.dp,
                    modifier = Modifier.widthIn(max = 520.dp).fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(requestNick, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.Black, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(b("accept_request"), fontSize = 14.sp, color = Color.DarkGray)
                        Spacer(modifier = Modifier.height(12.dp))
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(
                                onClick = {
                                    BloxAuth.respond(context, requestNick, true) { ok ->
                                        if (!ok) Notice.show(b("err_error"))
                                    }
                                },
                                modifier = Modifier.weight(1f).height(44.dp),
                                shape = RoundedCornerShape(14.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = ViberPurple)
                            ) {
                                Text(b("accept"), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            OutlinedButton(
                                onClick = {
                                    BloxAuth.respond(context, requestNick, false) { ok ->
                                        if (!ok) Notice.show(b("err_error"))
                                    }
                                },
                                modifier = Modifier.weight(1f).height(44.dp),
                                shape = RoundedCornerShape(14.dp)
                            ) {
                                Text(b("reject"), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
                Spacer(modifier = Modifier.height(10.dp))
            }
        }

        // Кнопка «Додати друзів» і праворуч від неї сірі кружки друзів (того ж розміру) з ніком під ними
        Row(
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.Top
        ) {
            Column(
                modifier = Modifier.width(BloxItemWidth).clickable { onAddFriends() },
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Box(
                    modifier = Modifier.size(BloxCircleSize).clip(CircleShape).background(ViberPurple),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Default.PersonAdd, contentDescription = null, tint = Color.White, modifier = Modifier.size(30.dp))
                }
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    b("add_friends"),
                    fontSize = 12.sp,
                    color = Color.Black,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    lineHeight = 14.sp
                )
            }

            for (friendNick in BloxAuth.friends) {
                key(friendNick) {
                    Column(
                        modifier = Modifier.width(BloxItemWidth).clickable { friendToDelete = friendNick },
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Box(modifier = Modifier.size(BloxCircleSize).clip(CircleShape).background(BloxFriendGrey))
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            friendNick,
                            fontSize = 12.sp,
                            color = Color.Black,
                            textAlign = TextAlign.Center,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
            }
        }

        // Тонка сіра лінія під друзями (лише на цій сторінці вкладки), під нею — гра Realistic cars
        Spacer(modifier = Modifier.height(20.dp))
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(Color(0xFFD3D3DB)))
        Spacer(modifier = Modifier.height(16.dp))
        BloxGameTile(onClick = onOpenGame)
    }

    // Тап на сірий кружок — лише кнопка «Видалити друга»
    val target = friendToDelete
    if (target != null) {
        Dialog(onDismissRequest = { friendToDelete = null }) {
            Surface(shape = RoundedCornerShape(24.dp), color = Color.White, shadowElevation = 8.dp) {
                Column(modifier = Modifier.padding(16.dp).widthIn(min = 240.dp, max = 360.dp)) {
                    Button(
                        onClick = {
                            friendToDelete = null
                            BloxAuth.deleteFriend(context, target) { ok ->
                                if (!ok) Notice.show(b("err_error"))
                            }
                        },
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD93025))
                    ) {
                        Text(b("delete_friend"), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

/** More: кнопка «Вийти» (із запитанням «Ви впевнені?» і кнопками Так / Ні). */
@Composable
private fun BloxMorePage(lang: String) {
    val context = LocalContext.current
    val b: (String) -> String = { key -> BloxStrings.get(key, lang) }
    var confirmLogout by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = Color.White,
            shadowElevation = 2.dp,
            modifier = Modifier.widthIn(max = 520.dp).fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable { confirmLogout = true }
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Default.ExitToApp, contentDescription = null, tint = Color(0xFFD93025), modifier = Modifier.size(24.dp))
                Spacer(modifier = Modifier.width(14.dp))
                Text(b("logout"), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFFD93025), maxLines = 1)
            }
        }
    }

    if (confirmLogout) {
        Dialog(onDismissRequest = { confirmLogout = false }) {
            Surface(shape = RoundedCornerShape(24.dp), color = Color.White, shadowElevation = 8.dp) {
                Column(
                    modifier = Modifier.padding(24.dp).widthIn(min = 260.dp, max = 400.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(b("logout_title"), fontSize = 19.sp, fontWeight = FontWeight.Bold, color = Color.Black, textAlign = TextAlign.Center)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(b("logout_text"), fontSize = 14.sp, color = Color.DarkGray, textAlign = TextAlign.Center)
                    Spacer(modifier = Modifier.height(20.dp))
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(
                            onClick = { confirmLogout = false },
                            modifier = Modifier.weight(1f).height(46.dp),
                            shape = RoundedCornerShape(14.dp)
                        ) {
                            Text(b("no"), fontWeight = FontWeight.SemiBold, maxLines = 1)
                        }
                        Button(
                            onClick = {
                                confirmLogout = false
                                BloxAuth.logout(context) { ok ->
                                    if (!ok) Notice.show(b("err_error"))
                                }
                            },
                            modifier = Modifier.weight(1f).height(46.dp),
                            shape = RoundedCornerShape(14.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD93025))
                        ) {
                            Text(b("yes"), fontWeight = FontWeight.SemiBold, maxLines = 1)
                        }
                    }
                }
            }
        }
    }
}

/**
 * «Додати друзів»: стрілочка зверху зліва (вихід із цього меню), поле пошуку за ніком; якщо такий нік є —
 * картка з кнопкою «Додати в друзі». Після надсилання кнопка стає значком «чоловічок із годинником».
 */
@Composable
private fun BloxAddFriendsScreen(lang: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val b: (String) -> String = { key -> BloxStrings.get(key, lang) }

    BackHandler(onBack = onBack)

    var query by rememberSaveable { mutableStateOf("") }
    var result by remember { mutableStateOf<BloxFound?>(null) }
    var sending by remember { mutableStateOf(false) }

    fun runSearch(text: String) {
        BloxAuth.search(text) { ok, found ->
            // Відповідь для застарілого запиту (поле вже змінили) ігноруємо
            if (query.trim() != text) return@search
            if (ok) result = found
        }
    }

    // Пошук запускається сам, коли ви на мить зупинились друкувати
    LaunchedEffect(query) {
        val text = query.trim()
        if (text.isEmpty()) {
            result = null
            return@LaunchedEffect
        }
        delay(350)
        runSearch(text)
    }

    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(modifier = Modifier.widthIn(max = 560.dp).fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) {
                    Icon(Icons.Default.ArrowBack, contentDescription = null, tint = Color.Black)
                }
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it.replace(" ", ""); result = null },
                    placeholder = { Text(b("nick"), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    // Лупа зліва всередині поля (як і на клавіатурі, де кнопка дії теж «пошук»)
                    leadingIcon = {
                        Icon(Icons.Default.Search, contentDescription = null, tint = Color.Gray)
                    },
                    singleLine = true,
                    shape = RoundedCornerShape(14.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text, imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = {
                        val text = query.trim()
                        if (text.isNotEmpty()) runSearch(text)
                    }),
                    modifier = Modifier.weight(1f)
                )
                Spacer(modifier = Modifier.width(8.dp))
            }

            Spacer(modifier = Modifier.height(16.dp))

            val found = result
            if (found != null) {
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = Color.White,
                    shadowElevation = 2.dp,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(modifier = Modifier.size(46.dp).clip(CircleShape).background(BloxFriendGrey))
                        Spacer(modifier = Modifier.width(12.dp))
                        Text(
                            found.nick,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.Black,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        when (found.relation) {
                            "sent" -> BloxPersonClockIcon(modifier = Modifier.size(30.dp))
                            "friend" -> Unit
                            else -> Button(
                                onClick = {
                                    if (!sending) {
                                        sending = true
                                        BloxAuth.addFriend(context, found.nick) { relation ->
                                            sending = false
                                            if (relation == null) {
                                                Notice.show(b("err_error"))
                                            } else {
                                                result = BloxFound(found.nick, relation)
                                            }
                                        }
                                    }
                                },
                                enabled = !sending,
                                shape = RoundedCornerShape(14.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = ViberPurple)
                            ) {
                                Text(b("add_friend"), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Значок «чоловічок із годинником» (запит у друзі надіслано й ще не прийнято). */
@Composable
private fun BloxPersonClockIcon(modifier: Modifier = Modifier) {
    val color = Color(0xFF7A7A8C)
    Canvas(modifier = modifier) {
        val s = size.width / 24f
        // Чоловічок: голова й плечі
        drawCircle(color = color, radius = 4.2f * s, center = Offset(9.5f * s, 7.5f * s))
        drawArc(
            color = color,
            startAngle = 180f,
            sweepAngle = 180f,
            useCenter = true,
            topLeft = Offset(1.0f * s, 13.5f * s),
            size = Size(17f * s, 17f * s)
        )
        // Годинник знизу справа: біле «вікно», обідок і стрілки
        val clockCenter = Offset(17.4f * s, 17.0f * s)
        drawCircle(color = Color.White, radius = 6.3f * s, center = clockCenter)
        drawCircle(color = color, radius = 4.9f * s, center = clockCenter, style = Stroke(width = 1.7f * s))
        drawLine(
            color = color,
            start = clockCenter,
            end = Offset(clockCenter.x, clockCenter.y - 3.0f * s),
            strokeWidth = 1.6f * s,
            cap = StrokeCap.Round
        )
        drawLine(
            color = color,
            start = clockCenter,
            end = Offset(clockCenter.x + 2.3f * s, clockCenter.y + 1.2f * s),
            strokeWidth = 1.6f * s,
            cap = StrokeCap.Round
        )
    }
}
