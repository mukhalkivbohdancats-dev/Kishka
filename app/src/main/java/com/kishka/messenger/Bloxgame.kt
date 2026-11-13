package com.kishka.messenger

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import android.os.Handler
import android.util.Log
import android.os.Looper
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import coil.compose.AsyncImage
import io.socket.client.Ack
import io.socket.emitter.Emitter
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

data class BloxPlayerInfo(val id: Int, val nick: String)

/**
 * Стан гри, спільний для всього застосунку: коли active = true, замість вкладок на весь екран показується гра
 * (MainActivity), а пристрій лежить в ігровому (горизонтальному) положенні.
 */
object BloxGame {
    const val GAME_ID = "realistic_cars"
    const val GAME_TITLE = "Realistic cars"

    /** Гру відкрито на весь екран (екран завантаження або сам світ). */
    var active by mutableStateOf(false)
        private set

    /** Відкрито сторінку гри (стрілка, аватарка, назва, синя кнопка). Лишається такою й після виходу з гри. */
    var detailOpen by mutableStateOf(false)

    var myId by mutableStateOf(-1)
    var players by mutableStateOf<List<BloxPlayerInfo>>(emptyList())

    /** Налаштування «Інверсія камери»: за замовчуванням вимкнено (палець угору = камера вгору). Зберігається на пристрої. */
    var invertCamera by mutableStateOf(false)
        private set

    private const val SETTINGS_PREFS = "kishkablox_settings"

    fun loadSettings(context: Context) {
        invertCamera = context.applicationContext.getSharedPreferences(SETTINGS_PREFS, Context.MODE_PRIVATE)
            .getBoolean("invert_camera", false)
    }

    fun saveInvertCamera(context: Context, value: Boolean) {
        invertCamera = value
        context.applicationContext.getSharedPreferences(SETTINGS_PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean("invert_camera", value).apply()
    }

    fun enter() {
        players = emptyList()
        myId = -1
        active = true
    }

    fun exit() {
        active = false
        players = emptyList()
        myId = -1
    }

    /** Вихід з акаунта Kishka: гра закривається, стан скидається. */
    fun reset() {
        exit()
        detailOpen = false
    }
}

private val BloxBlue = Color(0xFF1A73E8)

private const val BLOX_TAG = "KishkaBlox"

/** Скільки синя кнопка показує круговий індикатор перед відкриттям вікна гри. */
private const val PLAY_LOADING_MS = 3000L

/** Скільки чекаємо відповідь сервера на вхід у гру, перш ніж спробувати ще раз. */
private const val JOIN_TIMEOUT_MS = 8000L

/** Скільки разів намагаємось зайти в гру вперше, перш ніж показати помилку (замість нескінченного завантаження). */
private const val MAX_FIRST_ATTEMPTS = 3

/** Повтор після відповіді сервера з тимчасовою причиною (сокет ще не назвався, збій бази). */
private const val JOIN_RETRY_MS = 1500L
private const val MAX_JOIN_RETRIES = 3

/** Коди відмови сервера на вхід у гру, для яких є окремий переклад (join_<код> у BloxStrings). */
private val JOIN_CODES = setOf("not_logged_in", "not_identified", "game_full", "unknown_game", "bad_payload", "error")

private fun Context.findActivity(): Activity? {
    var c: Context? = this
    while (c is ContextWrapper) {
        if (c is Activity) return c
        c = c.baseContext
    }
    return null
}

/** Квадрат із заокругленими кутами: зверху зображення, під ним (з маленькою відстанню) текст «Realistic cars». */
@Composable
fun BloxGameTile(onClick: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(18.dp),
        color = Color.White,
        shadowElevation = 2.dp,
        modifier = Modifier.width(132.dp).clip(RoundedCornerShape(18.dp)).clickable { onClick() }
    ) {
        Column(modifier = Modifier.padding(8.dp)) {
            AsyncImage(
                model = bloxImageModel("realistic_cars.jpg", REALISTIC_CARS_URL),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(12.dp))
            )
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                BloxGame.GAME_TITLE,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color.Black,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 2.dp)
            )
        }
    }
}

/**
 * Сторінка гри: зверху зліва стрілочка «назад»; під нею квадратна аватарка (з маленьким заокругленням кутів),
 * праворуч від неї назва «Realistic cars», а під початком назви — синя кнопка запуску.
 */
@Composable
fun BloxGameDetail(onBack: () -> Unit, onPlay: () -> Unit) {
    BackHandler(onBack = onBack)
    // Після натискання синя кнопка 3 секунди показує круговий індикатор, потім відкривається вікно гри
    var starting by remember { mutableStateOf(false) }
    LaunchedEffect(starting) {
        if (starting) {
            delay(PLAY_LOADING_MS)
            onPlay()
        }
    }
    // Повернулись із гри: кнопка знову активна
    LaunchedEffect(BloxGame.active) {
        if (!BloxGame.active) starting = false
    }
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(modifier = Modifier.widthIn(max = 640.dp).fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp)) {
            IconButton(onClick = onBack) {
                Icon(Icons.Default.ArrowBack, contentDescription = null, tint = Color.Black)
            }
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.Top
            ) {
                AsyncImage(
                    model = bloxImageModel("realistic_cars.jpg", REALISTIC_CARS_URL),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(120.dp).clip(RoundedCornerShape(10.dp))
                )
                Spacer(modifier = Modifier.width(14.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        BloxGame.GAME_TITLE,
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.Black,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Box(
                        modifier = Modifier
                            .width(132.dp)
                            .height(46.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(BloxBlue)
                            .clickable(enabled = !starting) { starting = true },
                        contentAlignment = Alignment.Center
                    ) {
                        if (starting) {
                            CircularProgressIndicator(color = Color.White, strokeWidth = 3.dp, modifier = Modifier.size(28.dp))
                        } else {
                            Icon(Icons.Default.PlayArrow, contentDescription = null, tint = Color.White, modifier = Modifier.size(32.dp))
                        }
                    }
                }
            }
        }
    }
}

/**
 * Зв'язок між WebView (3D-світ) і сервером. Гра в WebView сама з мережею не працює: усе йде через сокет застосунку.
 *  WebView -> застосунок: ready (сторінка готова), started (перший кадр), state (мій стан), fail (немає WebGL).
 *  Сервер -> WebView: start / resync / roster / tick (див. blox_game/game.js).
 */
private class BloxGameController(private val appContext: Context, private val email: String, private val lang: String) {
    private val main = Handler(Looper.getMainLooper())
    private var webView: WebView? = null

    /** Перший кадр світу намальовано. */
    var worldStarted by mutableStateOf(false)

    @Volatile private var disposed = false
    @Volatile private var joinedOnce = false
    /** Сторінка гри (game.html) викликала ready(): файли гри завантажились і WebGL запустився. */
    @Volatile private var pageReady = false
    private var spawnToken = 0
    /** Сторінка гри готова, але сервер ще не підтвердив перший вхід. */
    @Volatile private var pendingFirstJoin = false
    private var joinToken = 0
    private var firstAttempts = 0
    private var joinRetries = 0
    @Volatile private var lx = 0.0
    @Volatile private var ly = 4.0
    @Volatile private var lz = 0.0
    @Volatile private var lry = 0.0

    private val tickListener = Emitter.Listener { args ->
        val arr = args.firstOrNull() as? JSONArray
        if (arr != null) js("KishkaGame.tick($arr)")
    }
    private val rosterListener = Emitter.Listener { args ->
        val obj = args.firstOrNull() as? JSONObject
        if (obj != null) {
            main.post { updatePlayers(obj.optJSONArray("players")) }
            js("KishkaGame.roster($obj)")
        }
    }
    private val carsListener = Emitter.Listener { args ->
        val obj = args.firstOrNull() as? JSONObject
        if (obj != null) js("KishkaGame.cars($obj)")
    }
    private val carTickListener = Emitter.Listener { args ->
        val arr = args.firstOrNull() as? JSONArray
        if (arr != null) js("KishkaGame.carTick($arr)")
    }
    private val kickedListener = Emitter.Listener { args ->
        // Цей акаунт зайшов у гру з іншого пристрою (або сервер не отримував від гри даних 60 с)
        val reason = (args.firstOrNull() as? JSONObject)?.optString("reason", "") ?: ""
        Log.w(BLOX_TAG, "сервер відключив від гри: reason=" + reason)
        main.post {
            if (!disposed) {
                Notice.show(BloxStrings.get(if (reason == "timeout") "kicked_timeout" else "kicked_other", lang))
                exitGame(false)
            }
        }
    }
    private val disconnectListener = Emitter.Listener { args ->
        Log.w(BLOX_TAG, "зв'язок із сервером втрачено: " + (args.firstOrNull() ?: "?"))
    }
    private val connectListener = Emitter.Listener {
        // Зв'язок із сервером відновився: сервер забув нас, коли той обірвався, — заходимо знову на тому ж місці
        main.post { if (!disposed && (joinedOnce || pendingFirstJoin)) join(!joinedOnce) }
    }

    init {
        try {
            val s = KishkaManager.getSocket()
            s.on("blox_game_tick", tickListener)
            s.on("blox_game_roster", rosterListener)
            s.on("blox_game_cars", carsListener)
            s.on("blox_car_tick", carTickListener)
            s.on("blox_game_kicked", kickedListener)
            s.on(io.socket.client.Socket.EVENT_CONNECT, connectListener)
            s.on(io.socket.client.Socket.EVENT_DISCONNECT, disconnectListener)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun safeLang(): String = lang.filter { it.isLetter() }.take(5).ifEmpty { "uk" }

    /** Мова написів і налаштування камери для гри (game.js -> KishkaGame.config). */
    private fun applyConfig() {
        js("KishkaGame.config({lang:'" + safeLang() + "',invertCamera:" + BloxGame.invertCamera + "})")
    }

    fun setInvertCamera(value: Boolean) {
        BloxGame.saveInvertCamera(appContext, value)
        applyConfig()
    }

    inner class Bridge {
        @JavascriptInterface
        fun ready() {
            main.post {
                if (!disposed) {
                    pageReady = true
                    pendingFirstJoin = true
                    applyConfig()
                    join(true)
                }
            }
        }

        /** Діагностика гри: потрапляє в Logcat (і в звіти про помилки), а не лише в консоль WebView. */
        @JavascriptInterface
        fun log(text: String) {
            Log.i(BLOX_TAG, "game: " + text.take(300))
        }

        /** Причина, чому гру не запущено: «webgl: ...» або «script: ...». */
        @JavascriptInterface
        fun failReason(text: String) {
            val kind = text.substringBefore(':').trim()
            val detail = text.substringAfter(':', "").trim().take(120)
            main.post { failGame(if (kind == "script") "err_script" else "err_webgl", detail) }
        }

        /** Мій стан і стан моєї машини одним JSON: {x,y,z,ry,a,d,c?}. Сервер усе перевіряє ще раз. */
        @JavascriptInterface
        fun sendState(json: String) {
            if (disposed) return
            val o = try {
                JSONObject(json)
            } catch (e: Exception) {
                Log.w(BLOX_TAG, "sendState: гра надіслала некоректний JSON")
                return
            }
            lx = o.optDouble("x", lx); ly = o.optDouble("y", ly); lz = o.optDouble("z", lz); lry = o.optDouble("ry", lry)
            if (!joinedOnce) return
            try {
                val s = KishkaManager.getSocket()
                if (!s.connected()) return
                s.emit("blox_game_state", o)
            } catch (e: Exception) {
                Log.w(BLOX_TAG, "sendState: " + e.message)
            }
        }

        /** Створити мою машину (sedan | van | truck). Результат повертається в KishkaGame.carResult. */
        @JavascriptInterface
        fun carSpawn(type: String, x: Double, y: Double, z: Double, ry: Double) {
            main.post { spawnCar(type, x, y, z, ry) }
        }

        @JavascriptInterface
        fun carRemove() {
            main.post {
                try {
                    if (!disposed && joinedOnce) KishkaManager.getSocket().emit("blox_car_remove", JSONObject())
                } catch (e: Exception) {
                    Log.w(BLOX_TAG, "carRemove: " + e.message)
                }
            }
        }

        @JavascriptInterface
        fun started() {
            main.post { if (!disposed) worldStarted = true }
        }

        @JavascriptInterface
        fun fail() {
            main.post { failGame("err_webgl") }
        }

        @JavascriptInterface
        fun state(x: Double, y: Double, z: Double, ry: Double, a: Int) {
            lx = x; ly = y; lz = z; lry = ry
            if (!joinedOnce || disposed) return
            try {
                val s = KishkaManager.getSocket()
                if (!s.connected()) return
                s.emit("blox_game_state", JSONObject().put("x", x).put("y", y).put("z", z).put("ry", ry).put("a", a))
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    fun createWebView(ctx: Context): WebView {
        val wv = WebView(ctx)
        wv.setBackgroundColor(android.graphics.Color.BLACK)
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_NO_CACHE
            mediaPlaybackRequiresUserGesture = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
        }
        wv.isVerticalScrollBarEnabled = false
        wv.isHorizontalScrollBarEnabled = false
        wv.overScrollMode = android.view.View.OVER_SCROLL_NEVER
        wv.webViewClient = object : WebViewClient() {
            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) {
                    main.post { failGame("err_game_files", (error?.description ?: "").toString().take(80)) }
                }
            }
        }
        // Помилки JavaScript гри — в Logcat
        wv.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage?): Boolean {
                if (message != null && message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    Log.w(BLOX_TAG, "js: " + message.message() + " (" + message.sourceId().substringAfterLast('/') + ":" + message.lineNumber() + ")")
                }
                return true
            }
        }
        wv.addJavascriptInterface(Bridge(), "Android")
        webView = wv
        // Гра запускається з установлених файлів. Перед цим перевіряємо, що вони на місці й цілі (нова версія — лише кнопкою «Оновити»)
        BloxInstall.verifyForPlay(appContext) { ok ->
            if (disposed) return@verifyForPlay
            if (!ok) {
                failGame("err_game_files")
            } else {
                wv.loadUrl("file://" + BloxInstall.file(appContext, "game.html").absolutePath)
            }
        }
        return wv
    }

    /**
     * Вхід у гру на сервері. Відповідь чекаємо не нескінченно: якщо за JOIN_TIMEOUT_MS ack не прийшов, пробуємо ще
     * (перший вхід — до MAX_FIRST_ATTEMPTS разів, потім помилка й вихід на сторінку гри).
     */
    private fun join(first: Boolean) {
        if (disposed) return
        val token = ++joinToken
        try {
            val socket = KishkaManager.getSocket()
            if (socket.connected()) {
                val payload = JSONObject().put("email", email).put("game", BloxGame.GAME_ID)
                if (!first) payload.put("x", lx).put("y", ly).put("z", lz).put("ry", lry)
                socket.emit("blox_game_join", payload, Ack { args ->
                    val res = args.firstOrNull() as? JSONObject
                    main.post { if (token == joinToken) onJoinResult(res, first) }
                })
            } else {
                Log.w(BLOX_TAG, "вхід у гру: сокет не підключений, чекаємо з'єднання (спроба " + (firstAttempts + 1) + ")")
            }
        } catch (e: Exception) {
            e.printStackTrace()
            if (first) failGame("err_server_down", e.message ?: "")
            return
        }
        main.postDelayed({
            if (disposed || token != joinToken) return@postDelayed
            if (first && !joinedOnce) {
                firstAttempts++
                if (firstAttempts >= MAX_FIRST_ATTEMPTS) {
                    Log.w(BLOX_TAG, "вхід у гру: сервер не відповів за " + (JOIN_TIMEOUT_MS * MAX_FIRST_ATTEMPTS / 1000) + " с")
                    failGame(if (connected()) "join_timeout" else "err_server_down")
                } else {
                    join(true)
                }
            } else {
                join(false)
            }
        }, JOIN_TIMEOUT_MS)
    }

    private fun onJoinResult(res: JSONObject?, first: Boolean) {
        if (disposed) return
        joinToken++ // відповідь отримано: таймер очікування більше не спрацює
        if (res == null || !res.optBoolean("success", false)) {
            val code = res?.optString("code", "") ?: ""
            Log.w(BLOX_TAG, "вхід у гру відхилено сервером, code=" + code)
            // Тимчасові причини (сокет ще не назвався, збій бази) — пробуємо ще кілька разів
            val temporary = code == "not_identified" || code == "error"
            if (temporary && joinRetries < MAX_JOIN_RETRIES) {
                joinRetries++
                main.postDelayed({ if (!disposed) join(first) }, JOIN_RETRY_MS)
                return
            }
            failGame(if (code in JOIN_CODES) "join_" + code else "err_game_join", code)
            return
        }
        joinRetries = 0
        joinedOnce = true
        pendingFirstJoin = false
        val myId = res.optInt("id", -1)
        BloxGame.myId = myId
        val list = ArrayList<BloxPlayerInfo>()
        list.add(BloxPlayerInfo(myId, res.optString("nick", "")))
        val others = res.optJSONArray("players")
        if (others != null) {
            for (i in 0 until others.length()) {
                val o = others.optJSONObject(i) ?: continue
                list.add(BloxPlayerInfo(o.optInt("id", -1), o.optString("nick", "")))
            }
        }
        BloxGame.players = list
        js(if (first) "KishkaGame.start($res)" else "KishkaGame.resync($res)")
    }

    private fun updatePlayers(arr: JSONArray?) {
        if (arr == null || disposed) return
        val list = ArrayList<BloxPlayerInfo>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            list.add(BloxPlayerInfo(o.optInt("id", -1), o.optString("nick", "")))
        }
        // Себе — першим у списку
        val me = BloxGame.myId
        BloxGame.players = list.sortedBy { if (it.id == me) 0 else 1 }
    }

    private fun js(code: String) {
        main.post { if (!disposed) webView?.evaluateJavascript(code, null) }
    }

    fun pause() {
        webView?.onPause()
    }

    fun resume() {
        webView?.onResume()
    }

    private fun connected(): Boolean = try {
        KishkaManager.getSocket().connected()
    } catch (e: Exception) {
        false
    }

    /** Створення машини: сервер відповідає ACK; не відповів за 5 с — гра отримує причину «timeout». */
    private fun spawnCar(type: String, x: Double, y: Double, z: Double, ry: Double) {
        if (disposed) return
        if (!joinedOnce || !connected()) {
            Log.w(BLOX_TAG, "spawn машини: немає входу в гру або зв'язку з сервером")
            js("KishkaGame.carResult({ok:false,code:'offline'})")
            return
        }
        val token = ++spawnToken
        val answered = java.util.concurrent.atomic.AtomicBoolean(false)
        try {
            val payload = JSONObject().put("type", type).put("x", x).put("y", y).put("z", z).put("ry", ry)
            KishkaManager.getSocket().emit("blox_car_spawn", payload, Ack { args ->
                if (!answered.compareAndSet(false, true)) return@Ack
                val res = args.firstOrNull() as? JSONObject
                val ok = res?.optBoolean("success", false) == true
                val out = JSONObject().put("ok", ok).put("cid", res?.optInt("cid", 0) ?: 0).put("code", res?.optString("code", "") ?: "")
                if (!ok) Log.w(BLOX_TAG, "spawn машини відхилено сервером: code=" + out.optString("code"))
                js("KishkaGame.carResult($out)")
            })
            main.postDelayed({
                if (token == spawnToken && answered.compareAndSet(false, true)) {
                    Log.w(BLOX_TAG, "spawn машини: сервер не відповів (немає ACK)")
                    js("KishkaGame.carResult({ok:false,code:'timeout'})")
                }
            }, 5000)
        } catch (e: Exception) {
            Log.w(BLOX_TAG, "spawn машини: " + e.message)
            js("KishkaGame.carResult({ok:false,code:'error'})")
        }
    }

    /**
     * Меню «Respawn»: сервер повертає персонажа на майданчик (виходить з машини), гра ставить його туди ж.
     * onResult(true) — готово; false — сервер не відповів за 5 с або відхилив (з причиною в Logcat).
     */
    fun respawn(onResult: (Boolean) -> Unit) {
        val answered = java.util.concurrent.atomic.AtomicBoolean(false)
        try {
            KishkaManager.getSocket().emit("blox_game_respawn", JSONObject(), Ack { args ->
                if (!answered.compareAndSet(false, true)) return@Ack
                val res = args.firstOrNull() as? JSONObject
                val ok = res?.optBoolean("success", false) == true
                if (ok) {
                    js("KishkaGame.respawn({x:" + res!!.optDouble("x", 0.0) + ",y:" + res.optDouble("y", 0.0) + ",z:" + res.optDouble("z", 0.0) + ",ry:" + res.optDouble("ry", 0.0) + "})")
                } else {
                    Log.w(BLOX_TAG, "respawn відхилено сервером: code=" + (res?.optString("code", "") ?: "немає відповіді"))
                }
                main.post { onResult(ok) }
            })
            main.postDelayed({
                if (answered.compareAndSet(false, true)) {
                    Log.w(BLOX_TAG, "respawn: сервер не відповів (немає ACK)")
                    onResult(false)
                }
            }, 5000)
        } catch (e: Exception) {
            Log.w(BLOX_TAG, "respawn: " + e.message)
            onResult(false)
        }
    }

    /** Меню «лупа»: камера повертається до гравця. */
    fun lookAtPlayer(id: Int) = js("KishkaGame.lookAt($id)")

    /** Меню «заблокувати»: персонаж гравця не малюється (лише в мене). */
    fun blockPlayer(id: Int, blocked: Boolean) = js("KishkaGame.hidePlayer($id,$blocked)")

    /** Меню «скарга»: сервер пише скаргу в журнал Render. */
    fun reportPlayer(id: Int, onResult: (Boolean) -> Unit) {
        val answered = java.util.concurrent.atomic.AtomicBoolean(false)
        try {
            KishkaManager.getSocket().emit("blox_game_report", JSONObject().put("target", id), Ack { args ->
                if (!answered.compareAndSet(false, true)) return@Ack
                val res = args.firstOrNull() as? JSONObject
                val ok = res?.optBoolean("success", false) == true
                if (!ok) Log.w(BLOX_TAG, "скаргу відхилено сервером: code=" + (res?.optString("code", "") ?: "немає відповіді"))
                main.post { onResult(ok) }
            })
            main.postDelayed({
                if (answered.compareAndSet(false, true)) {
                    Log.w(BLOX_TAG, "скарга: сервер не відповів (немає ACK)")
                    onResult(false)
                }
            }, 5000)
        } catch (e: Exception) {
            Log.w(BLOX_TAG, "скарга: " + e.message)
            onResult(false)
        }
    }

    /** Чому гра не запустилась за відведений час: файли гри, сервер чи графіка. */
    fun timeoutReason(): String = when {
        !pageReady -> "err_game_files"
        !joinedOnce -> if (connected()) "join_timeout" else "err_server_down"
        else -> "err_webgl"
    }

    /** Закриває гру з конкретною причиною (а не загальним «перевірте інтернет»). */
    fun failGame(key: String = "err_error", detail: String = "") {
        if (disposed) return
        Log.w(BLOX_TAG, "гру закрито: " + key + (if (detail.isNotEmpty()) " (" + detail + ")" else ""))
        val text = BloxStrings.get(key, lang)
        Notice.show(if (detail.isNotEmpty() && key != "err_game_join") text + "\n(" + detail + ")" else text)
        exitGame(true)
    }

    /** Вихід з гри: сервер прибирає гравця зі списку, застосунок повертає вкладки й вертикальне положення. */
    fun exitGame(tellServer: Boolean) {
        if (disposed) return
        if (tellServer) {
            try {
                KishkaManager.getSocket().emit("blox_game_leave", JSONObject())
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
        BloxGame.exit()
    }

    fun dispose() {
        if (disposed) return
        disposed = true
        try {
            val s = KishkaManager.getSocket()
            s.off("blox_game_tick", tickListener)
            s.off("blox_game_roster", rosterListener)
            s.off("blox_game_cars", carsListener)
            s.off("blox_car_tick", carTickListener)
            s.off("blox_game_kicked", kickedListener)
            s.off(io.socket.client.Socket.EVENT_CONNECT, connectListener)
            s.off(io.socket.client.Socket.EVENT_DISCONNECT, disconnectListener)
        } catch (e: Exception) {
            e.printStackTrace()
        }
        val wv = webView
        webView = null
        if (wv != null) {
            try {
                wv.stopLoading()
                wv.removeJavascriptInterface("Android")
                (wv.parent as? ViewGroup)?.removeView(wv)
                wv.removeAllViews()
                wv.destroy()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }
}

/**
 * Гра на весь екран: сірий екран завантаження («Joining the game»), потім 3D-світ. Зверху зліва — кругла кнопка
 * з аватаркою KishkaBlox, яка відкриває напівпрозоре меню зі списком гравців і кнопкою Leave.
 */
@Composable
fun BloxGameScreen(lang: String, email: String) {
    val context = LocalContext.current
    val b: (String) -> String = { key -> BloxStrings.get(key, lang) }
    val configuration = LocalConfiguration.current

    var menuOpen by remember { mutableStateOf(false) }
    var menuTab by remember { mutableStateOf(0) }
    var confirmLeave by remember { mutableStateOf(false) }
    var minTimePassed by remember { mutableStateOf(false) }
    val controller = remember {
        BloxGame.loadSettings(context)
        BloxGameController(context.applicationContext, email, lang)
    }

    // Ігрове положення пристрою (горизонтальне, як у Brawl Stars і Roblox), системні панелі сховано
    DisposableEffect(Unit) {
        val activity = context.findActivity()
        val window = activity?.window
        var insets: WindowInsetsControllerCompat? = null
        if (activity != null && window != null) {
            activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            val ctrl = WindowCompat.getInsetsController(window, window.decorView)
            ctrl.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            ctrl.hide(WindowInsetsCompat.Type.systemBars())
            insets = ctrl
        }
        onDispose {
            insets?.show(WindowInsetsCompat.Type.systemBars())
            window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }

    // Згорнули застосунок — світ не малюється (економимо батарею); гравець лишається в грі
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_PAUSE -> controller.pause()
                Lifecycle.Event.ON_RESUME -> controller.resume()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    DisposableEffect(Unit) { onDispose { controller.dispose() } }

    // Екран завантаження показується щонайменше 1 секунду; далі — скільки потрібно інтернету
    LaunchedEffect(Unit) {
        delay(1000)
        minTimePassed = true
    }
    // Гра не завантажилась за 45 секунд — виходимо з повідомленням
    LaunchedEffect(Unit) {
        delay(45_000)
        if (!controller.worldStarted) controller.failGame(controller.timeoutReason(), "45 с")
    }

    val showLoading = !(controller.worldStarted && minTimePassed)

    // Вікно гри з'являється плавно, а сірий екран завантаження так само плавно зникає
    val appear = remember { Animatable(0f) }
    LaunchedEffect(Unit) { appear.animateTo(1f, tween(700)) }
    val loadingAlpha by animateFloatAsState(if (showLoading) 1f else 0f, tween(600), label = "bloxLoading")

    BackHandler {
        when {
            confirmLeave -> confirmLeave = false
            showLoading -> controller.exitGame(true)
            menuOpen -> menuOpen = false
            else -> menuOpen = true
        }
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black).graphicsLayer { alpha = appear.value }) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx -> controller.createWebView(ctx) }
        )

        if (!showLoading) {
            if (menuOpen) {
                // Меню в стилі Roblox (див. Bloxmenu.kt): вкладки People/Settings/Gallery/Report/Help, гравці, Leave/Respawn/Resume
                BloxRobloxMenu(lang = lang, controller = controller, initialTab = menuTab) {
                    menuOpen = false
                    confirmLeave = false
                }
            }

            // Верхній ряд зліва: велика кругла кнопка-логотип і «таблетка» з кнопками (малюється ПІСЛЯ панелі, тож лишається клікабельною)
            BloxTopBar(
                lang = lang,
                menuOpen = menuOpen,
                onToggle = {
                    menuTab = 0
                    menuOpen = !menuOpen
                    if (!menuOpen) confirmLeave = false
                },
                onPeople = {
                    menuTab = 0
                    menuOpen = true
                }
            )
        }

        // Сірий екран завантаження: аватарка зверху, назва посередині, знизу посередині «Joining the game»
        if (loadingAlpha > 0.01f) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer { alpha = loadingAlpha }
                    .background(Color(0xFF3A3B3E))
                    .pointerInput(Unit) { detectTapGestures { } }
            ) {
                Column(modifier = Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    AsyncImage(
                        model = bloxImageModel("realistic_cars.jpg", REALISTIC_CARS_URL),
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.size(104.dp).clip(RoundedCornerShape(12.dp))
                    )
                    Spacer(modifier = Modifier.height(14.dp))
                    Text(BloxGame.GAME_TITLE, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Bold)
                }
                Column(
                    modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    CircularProgressIndicator(color = Color.White, strokeWidth = 2.5.dp, modifier = Modifier.size(26.dp))
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        b("joining"),
                        color = Color(0xFFD2D2D8),
                        fontSize = 16.sp
                    )
                }
            }
        }
    }
}
