package com.kishka.messenger

import android.content.Context
import android.os.Handler
import android.os.Looper
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
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
import org.json.JSONObject

/** Аватарка вкладки KishkaBlox: Assets/Kishkablox.png у репозиторії. */
const val KISHKABLOX_LOGO_URL =
    "https://raw.githubusercontent.com/mukhalkivbohdancats-dev/Kishka/main/Assets/Kishkablox.png"

object BloxStrings {
    private val dictionary = mapOf(
        "uk" to mapOf(
            "tab" to "KishkaBlox",
            "wip" to "В розробці",
            "hello" to "Привіт, %s!",
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
            "logout" to "Вийти",
            "logout_title" to "Ви впевнені?",
            "logout_text" to "Ви вийдете з акаунта KishkaBlox.",
            "yes" to "Так",
            "no" to "Ні",
            "err_bad_nick" to "Нікнейм має бути від 3 до 20 символів: лише літери, цифри та підкреслення",
            "err_bad_password" to "Пароль має містити щонайменше 6 символів",
            "err_taken" to "Цей нікнейм уже зайнятий. Оберіть інший",
            "err_not_found" to "Акаунта з таким нікнеймом немає",
            "err_wrong_password" to "Неправильний нікнейм або пароль",
            "err_too_many" to "Забагато невдалих спроб. Спробуйте за кілька хвилин",
            "err_error" to "Не вдалося виконати. Перевірте інтернет і спробуйте ще раз",
            "err_empty" to "Введіть нікнейм і пароль"
        ),
        "ru" to mapOf(
            "tab" to "KishkaBlox",
            "wip" to "В разработке",
            "hello" to "Привет, %s!",
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
            "logout" to "Выйти",
            "logout_title" to "Вы уверены?",
            "logout_text" to "Вы выйдете из аккаунта KishkaBlox.",
            "yes" to "Да",
            "no" to "Нет",
            "err_bad_nick" to "Никнейм должен быть от 3 до 20 символов: только буквы, цифры и подчёркивание",
            "err_bad_password" to "Пароль должен содержать минимум 6 символов",
            "err_taken" to "Этот никнейм уже занят. Выберите другой",
            "err_not_found" to "Аккаунта с таким никнеймом нет",
            "err_wrong_password" to "Неправильный никнейм или пароль",
            "err_too_many" to "Слишком много неудачных попыток. Попробуйте через несколько минут",
            "err_error" to "Не удалось выполнить. Проверьте интернет и попробуйте ещё раз",
            "err_empty" to "Введите никнейм и пароль"
        ),
        "en" to mapOf(
            "tab" to "KishkaBlox",
            "wip" to "In development",
            "hello" to "Hello, %s!",
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
            "logout" to "Log out",
            "logout_title" to "Are you sure?",
            "logout_text" to "You will be logged out of your KishkaBlox account.",
            "yes" to "Yes",
            "no" to "No",
            "err_bad_nick" to "The nickname must be 3-20 characters: only letters, digits and underscore",
            "err_bad_password" to "The password must have at least 6 characters",
            "err_taken" to "This nickname is already taken. Choose another one",
            "err_not_found" to "There is no account with this nickname",
            "err_wrong_password" to "Wrong nickname or password",
            "err_too_many" to "Too many failed attempts. Try again in a few minutes",
            "err_error" to "Could not do it. Check the internet and try again",
            "err_empty" to "Enter a nickname and a password"
        )
    )

    fun get(key: String, lang: String): String =
        dictionary[lang]?.get(key) ?: dictionary["uk"]?.get(key) ?: key
}

/**
 * Акаунт KishkaBlox (нік + пароль). Нік і ключ входу зберігаються на пристрої в ОКРЕМОМУ файлі налаштувань, який не
 * чіпає вихід з акаунта месенджера, тож акаунт KishkaBlox лишається після виходу з Kishka. Сам акаунт зберігається в
 * базі даних сервера (таблиці blox_accounts і blox_sessions, файл kishkablox.js).
 */
object BloxAuth {
    private const val PREFS = "kishkablox_account"
    private const val REQUEST_TIMEOUT_MS = 20_000L

    private val main = Handler(Looper.getMainLooper())

    /** Нік увійденого акаунта; порожній рядок — у KishkaBlox ще не входили. */
    var nick by mutableStateOf("")
        private set

    private var token = ""
    private var loaded = false

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Читає збережений вхід (один раз). */
    fun ensureLoaded(context: Context) {
        if (loaded) return
        loaded = true
        val p = prefs(context)
        token = p.getString("token", "") ?: ""
        nick = if (token.isNotEmpty()) (p.getString("nick", "") ?: "") else ""
    }

    private fun save(context: Context, newNick: String, newToken: String) {
        token = newToken
        nick = newNick
        prefs(context).edit().putString("nick", newNick).putString("token", newToken).apply()
    }

    private fun clearLocal(context: Context) {
        token = ""
        nick = ""
        prefs(context).edit().remove("nick").remove("token").apply()
    }

    /** Запит до сервера з обмеженням часу; відповідь завжди приходить в головному потоці (null — немає зв'язку). */
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

    private fun finishAuth(context: Context, res: JSONObject?, onResult: (String?) -> Unit) {
        if (res == null) {
            onResult("error")
            return
        }
        if (res.optBoolean("success", false)) {
            val newNick = res.optString("nick", "")
            val newToken = res.optString("token", "")
            if (newNick.isEmpty() || newToken.isEmpty()) {
                onResult("error")
            } else {
                save(context, newNick, newToken)
                onResult(null)
            }
        } else {
            onResult(res.optString("code", "error").ifEmpty { "error" })
        }
    }

    /** onResult(null) — успіх, інакше код помилки (bad_nick, bad_password, taken, not_found, wrong_password, too_many, error). */
    fun register(context: Context, nickInput: String, password: String, onResult: (String?) -> Unit) {
        val payload = JSONObject().apply {
            put("nick", nickInput.trim())
            put("password", password)
        }
        request("blox_register", payload) { res -> finishAuth(context, res, onResult) }
    }

    fun login(context: Context, nickInput: String, password: String, onResult: (String?) -> Unit) {
        val payload = JSONObject().apply {
            put("nick", nickInput.trim())
            put("password", password)
        }
        request("blox_login", payload) { res -> finishAuth(context, res, onResult) }
    }

    /** Якщо акаунт або вхід видалено на сервері — виходимо. Якщо сервер не відповів — нічого не змінюємо. */
    fun verify(context: Context) {
        if (nick.isEmpty() || token.isEmpty()) return
        val payload = JSONObject().apply {
            put("nick", nick)
            put("token", token)
        }
        request("blox_check", payload) { res ->
            if (res != null && res.optBoolean("success", false) && !res.optBoolean("valid", true)) {
                clearLocal(context)
            }
        }
    }

    fun logout(context: Context) {
        val oldToken = token
        clearLocal(context)
        if (oldToken.isNotEmpty()) {
            request("blox_logout", JSONObject().apply { put("token", oldToken) }) { }
        }
    }
}

/** Вкладка KishkaBlox: без входу — вхід / створення акаунта; після входу — «В розробці» і кнопка виходу. */
@Composable
fun KishkabloxTab(lang: String) {
    val context = LocalContext.current
    BloxAuth.ensureLoaded(context)

    LaunchedEffect(Unit) { BloxAuth.verify(context) }

    if (BloxAuth.nick.isEmpty()) {
        BloxLoginScreen(lang = lang)
    } else {
        BloxHomeScreen(lang = lang)
    }
}

private fun bloxErrorText(code: String, lang: String): String = when (code) {
    "bad_nick" -> BloxStrings.get("err_bad_nick", lang)
    "bad_password" -> BloxStrings.get("err_bad_password", lang)
    "taken" -> BloxStrings.get("err_taken", lang)
    "not_found" -> BloxStrings.get("err_not_found", lang)
    "wrong_password" -> BloxStrings.get("err_wrong_password", lang)
    "too_many" -> BloxStrings.get("err_too_many", lang)
    else -> BloxStrings.get("err_error", lang)
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

/** Вхід / створення акаунта: нік і пароль (без пошти й без підтвердження). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BloxLoginScreen(lang: String) {
    val context = LocalContext.current
    val b: (String) -> String = { key -> BloxStrings.get(key, lang) }

    var registerMode by remember { mutableStateOf(false) }
    var nickInput by remember { mutableStateOf("") }
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
                Spacer(modifier = Modifier.height(16.dp))
            }
        }
    }
}

/** Після входу: «В розробці», нік і «Вийти» зверху справа (із запитанням «Ви впевнені?» і кнопками Так / Ні). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BloxHomeScreen(lang: String) {
    val context = LocalContext.current
    val b: (String) -> String = { key -> BloxStrings.get(key, lang) }
    var confirmLogout by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { BloxTitle(lang) },
                actions = {
                    TextButton(onClick = { confirmLogout = true }) {
                        Text(b("logout"), color = Color(0xFFD93025), fontWeight = FontWeight.SemiBold, maxLines = 1)
                    }
                }
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier.fillMaxSize().padding(padding).padding(32.dp),
            contentAlignment = Alignment.Center
        ) {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                AsyncImage(
                    model = KISHKABLOX_LOGO_URL,
                    contentDescription = "KishkaBlox",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(150.dp).clip(RoundedCornerShape(32.dp))
                )
                Spacer(modifier = Modifier.height(20.dp))
                Text(
                    String.format(b("hello"), BloxAuth.nick),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = ViberPurple,
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    b("wip"),
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.DarkGray,
                    textAlign = TextAlign.Center
                )
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
                                BloxAuth.logout(context)
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
