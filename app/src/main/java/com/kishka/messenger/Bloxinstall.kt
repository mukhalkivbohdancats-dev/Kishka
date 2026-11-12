package com.kishka.messenger

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import org.json.JSONArray
import org.json.JSONObject
import android.util.Log
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest
import java.net.HttpURLConnection
import java.net.URL

/** Аватарка гри Realistic cars: Assets/Realistic_cars.jpg у репозиторії. */
const val REALISTIC_CARS_URL =
    "https://raw.githubusercontent.com/mukhalkivbohdancats-dev/Kishka/main/Assets/Realistic_cars.jpg"

/**
 * Установка й оновлення KishkaBlox на телефоні. Сервер (kishkablox.js) віддає список файлів гри з розмірами та sha256
 * (/blox/manifest.json) і самі файли (/blox/files/<ім'я>); застосунок качає їх у власну папку.
 *
 * Правила безпеки оновлення:
 *  • нові файли завантажуються в окрему папку «kishkablox_new», а робоча «kishkablox» не чіпається;
 *  • кожен файл перевіряється за розміром і sha256 з маніфесту (під час завантаження й ще раз із диска);
 *  • лише коли ВСІ файли завантажено й перевірено, папки міняються місцями; будь-яка невдача залишає стару гру робочою;
 *  • чи є оновлення, визначається за маніфестом сервера й ФАКТИЧНИМИ файлами на телефоні (sha256), а не за збереженим номером;
 *  • якщо сервер недоступний, застосунок не стверджує, що є нова версія, і нічого не ламає.
 */
object BloxInstall {
    enum class Phase { CHECKING, NOT_INSTALLED, DOWNLOADING, INSTALLED, READY, ERROR }

    /** Стан оновлення для вкладки KishkaBlox. NONE — нічого показувати (оновлення немає або його неможливо перевірити). */
    enum class UpdateState { NONE, AVAILABLE, DOWNLOADING, VERIFYING, INSTALLING, DONE, ERROR }

    private const val PREFS = "kishkablox_install"
    private const val TAG = "KishkaBlox"
    private const val DIR_LIVE = "kishkablox"
    private const val DIR_NEW = "kishkablox_new"
    private const val DIR_OLD = "kishkablox_old"
    private val NAME_RE = Regex("^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$")
    private val SHA_RE = Regex("^[0-9a-f]{64}$")
    private val main = Handler(Looper.getMainLooper())

    var phase by mutableStateOf(Phase.CHECKING)
        private set
    var percent by mutableStateOf(0)
        private set

    /** Справжня причина останньої невдачі установки: код причини + подробиця (код відповіді сервера, файл тощо). */
    var errorKind by mutableStateOf("")
        private set
    var errorDetail by mutableStateOf("")
        private set

    var updateState by mutableStateOf(UpdateState.NONE)
        private set
    var updatePercent by mutableStateOf(0)
        private set
    var updateErrorKind by mutableStateOf("")
        private set
    var updateErrorDetail by mutableStateOf("")
        private set

    @Volatile private var running = false
    @Volatile private var checking = false

    private class FileInfo(val name: String, val size: Long, val sha256: String)
    private class Manifest(val version: String, val files: List<FileInfo>)

    /** Помилка установки/оновлення: kind — ключ причини (net, server, manifest, file, hash, disk, busy, unknown). */
    class InstallException(val kind: String, val detail: String, cause: Throwable? = null) : Exception(kind + ": " + detail, cause)

    fun dir(context: Context): File = File(context.applicationContext.filesDir, DIR_LIVE)

    fun file(context: Context, name: String): File = File(dir(context), name)

    private fun sibling(context: Context, name: String): File = File(context.applicationContext.filesDir, name)

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Переклад причини помилки установки/оновлення для екрана. */
    fun reasonText(kind: String, detail: String, lang: String): String {
        val key = when (kind) {
            "net" -> "update_err_net"
            "server" -> "update_err_server"
            "manifest" -> "update_err_manifest"
            "file" -> "update_err_file"
            "hash" -> "update_err_hash"
            "disk" -> "update_err_disk"
            "busy" -> "update_err_busy"
            else -> "update_err_unknown"
        }
        val text = BloxStrings.get(key, lang)
        return if (detail.isNotEmpty()) text + "\n(" + detail + ")" else text
    }

    // ------------------------------------------------------------------ що встановлено на телефоні

    /** Якщо застосунок закрили посеред заміни папок, повертаємо робочу стару версію. */
    private fun recoverInterrupted(context: Context) {
        try {
            val live = dir(context)
            val old = sibling(context, DIR_OLD)
            if (!live.exists() && old.exists()) {
                Log.w(TAG, "відновлення гри після перерваного оновлення")
                old.renameTo(live)
            }
            sibling(context, DIR_NEW).let { if (it.exists()) it.deleteRecursively() }
            if (live.exists() && old.exists()) old.deleteRecursively()
        } catch (e: Exception) {
            Log.w(TAG, "recoverInterrupted: " + e.message)
        }
    }

    private fun installedRecord(context: Context): List<FileInfo>? {
        val raw = prefs(context).getString("files", null) ?: return null
        return try {
            val arr = JSONArray(raw)
            if (arr.length() == 0) return null
            val list = ArrayList<FileInfo>()
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                list.add(FileInfo(o.getString("name"), o.getLong("size"), o.optString("sha256", "")))
            }
            list
        } catch (e: Exception) {
            null
        }
    }

    /** Швидка перевірка: усі записані файли на місці й мають правильний розмір. */
    private fun filesPresent(context: Context): Boolean {
        val rec = installedRecord(context) ?: return false
        for (f in rec) {
            val file = file(context, f.name)
            if (!file.exists() || file.length() != f.size) return false
        }
        return true
    }

    /** Глибока перевірка: розмір і sha256 кожного файла (де хеш відомий). Повертає перший поганий файл або null. */
    private fun firstBadFile(context: Context, record: List<FileInfo>): String? {
        for (f in record) {
            val file = file(context, f.name)
            if (!file.exists() || file.length() != f.size) return f.name
            if (f.sha256.isNotEmpty() && sha256Of(file) != f.sha256) return f.name
        }
        return null
    }

    private fun sha256Of(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buf = ByteArray(32 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /** Викликається, коли відкрито вкладку: що показувати — установку, «Розпочати» чи саму вкладку. */
    fun check(context: Context) {
        if (running) return
        recoverInterrupted(context)
        val present = filesPresent(context)
        phase = when {
            present && prefs(context).getBoolean("started", false) -> Phase.READY
            present -> Phase.INSTALLED
            else -> Phase.NOT_INSTALLED
        }
        if (phase != Phase.NOT_INSTALLED) percent = 100 else percent = 0
    }

    /** Кнопка «Розпочати»: більше установлювати не треба. */
    fun getStarted(context: Context) {
        prefs(context).edit().putBoolean("started", true).apply()
        phase = Phase.READY
    }

    // ------------------------------------------------------------------ установка (перший раз)

    /** Кнопка «Установити» / «Повторити». */
    fun install(context: Context) {
        if (running) return
        running = true
        percent = 0
        errorKind = ""
        errorDetail = ""
        phase = Phase.DOWNLOADING
        val app = context.applicationContext
        Thread({
            var failure: InstallException? = null
            try {
                recoverInterrupted(app)
                val manifest = fetchManifest(30_000, 3)
                downloadAndInstall(app, manifest, 30_000, { p -> main.post { if (running && p > percent) percent = p.coerceAtMost(99) } }, { })
            } catch (e: InstallException) {
                failure = e
            } catch (e: Exception) {
                failure = InstallException("unknown", e.message ?: e.javaClass.simpleName, e)
            }
            val fail = failure
            main.post {
                running = false
                if (fail == null) {
                    percent = 100
                    phase = Phase.INSTALLED
                    updateState = UpdateState.NONE
                } else {
                    Log.w(TAG, "установка не вдалася: " + fail.kind + " — " + fail.detail)
                    errorKind = fail.kind
                    errorDetail = fail.detail
                    phase = Phase.ERROR
                }
            }
        }, "KishkaBloxInstall").start()
    }

    // ------------------------------------------------------------------ перевірка й установка оновлення

    /**
     * Запитує в сервера маніфест і порівнює його з файлами на телефоні. Якщо сервер недоступний — нічого не показуємо
     * (не стверджуємо, що є нова версія, коли це неможливо перевірити).
     */
    fun checkForUpdate(context: Context) {
        if (running || checking) return
        if (phase != Phase.READY && phase != Phase.INSTALLED) return
        if (updateState == UpdateState.DOWNLOADING || updateState == UpdateState.VERIFYING || updateState == UpdateState.INSTALLING) return
        checking = true
        val app = context.applicationContext
        Thread({
            var available = false
            var checked = false
            try {
                val manifest = fetchManifest(8_000, 1)
                checked = true
                available = needsUpdate(app, manifest)
            } catch (e: InstallException) {
                Log.w(TAG, "перевірка оновлення неможлива: " + e.kind + " — " + e.detail)
            } catch (e: Exception) {
                Log.w(TAG, "перевірка оновлення: " + e.message)
            }
            val result = available
            val ok = checked
            main.post {
                checking = false
                if (!running && updateState != UpdateState.DOWNLOADING && updateState != UpdateState.VERIFYING && updateState != UpdateState.INSTALLING) {
                    if (ok && result) {
                        if (updateState != UpdateState.ERROR) updateState = UpdateState.AVAILABLE
                    } else if (ok) {
                        if (updateState == UpdateState.AVAILABLE) updateState = UpdateState.NONE
                    }
                    // ok == false: сервер недоступний, лишаємо як було (кнопку «Оновити» не вигадуємо)
                }
            }
        }, "KishkaBloxCheck").start()
    }

    /** Оновлення потрібне, якщо фактичні файли на телефоні відрізняються від маніфесту сервера (а не лише номер версії). */
    private fun needsUpdate(context: Context, remote: Manifest): Boolean {
        val live = dir(context)
        for (f in remote.files) {
            val local = File(live, f.name)
            if (!local.exists() || local.length() != f.size) return true
            if (sha256Of(local) != f.sha256) return true
        }
        val names = remote.files.map { it.name }.toSet()
        val extra = live.listFiles()?.any { !it.name.endsWith(".part") && !it.name.startsWith(".") && it.name !in names } ?: false
        if (extra) return true
        return false
    }

    /** Кнопка «Оновити» (і «Повторити» після помилки). */
    fun startUpdate(context: Context) {
        if (running) return
        if (BloxGame.active) {
            updateErrorKind = "busy"
            updateErrorDetail = ""
            updateState = UpdateState.ERROR
            return
        }
        running = true
        updatePercent = 0
        updateErrorKind = ""
        updateErrorDetail = ""
        updateState = UpdateState.DOWNLOADING
        val app = context.applicationContext
        Thread({
            var failure: InstallException? = null
            try {
                recoverInterrupted(app)
                val manifest = fetchManifest(15_000, 2)
                downloadAndInstall(
                    app, manifest, 30_000,
                    { p -> main.post { if (running && p > updatePercent) updatePercent = p.coerceAtMost(100) } },
                    { stage -> main.post { if (running) updateState = stage } }
                )
            } catch (e: InstallException) {
                failure = e
            } catch (e: Exception) {
                failure = InstallException("unknown", e.message ?: e.javaClass.simpleName, e)
            }
            val fail = failure
            main.post {
                running = false
                if (fail == null) {
                    updatePercent = 100
                    updateState = UpdateState.DONE
                    percent = 100
                    if (phase != Phase.READY) phase = Phase.INSTALLED
                    // Підтвердження показуємо кілька секунд, потім ховаємо
                    main.postDelayed({ if (updateState == UpdateState.DONE) updateState = UpdateState.NONE }, 3500)
                } else {
                    Log.w(TAG, "оновлення не вдалося, стара версія лишилась: " + fail.kind + " — " + fail.detail)
                    updateErrorKind = fail.kind
                    updateErrorDetail = fail.detail
                    updateState = UpdateState.ERROR
                }
            }
        }, "KishkaBloxUpdate").start()
    }

    // ------------------------------------------------------------------ запуск гри

    /**
     * Перед входом в гру: файли на місці й цілі (розмір + sha256)? Мережа не потрібна. Нову версію гра сама не качає:
     * оновлення робиться кнопкою «Оновити». onDone(true) — можна вантажити game.html.
     */
    fun verifyForPlay(context: Context, onDone: (Boolean) -> Unit) {
        val app = context.applicationContext
        Thread({
            var ok = false
            try {
                recoverInterrupted(app)
                val rec = installedRecord(app)
                if (rec != null) {
                    val bad = firstBadFile(app, rec)
                    if (bad == null && file(app, "game.html").exists()) ok = true
                    else Log.w(TAG, "файли гри не пройшли перевірку: " + (bad ?: "game.html відсутній"))
                } else {
                    Log.w(TAG, "гра не встановлена")
                }
            } catch (e: Exception) {
                Log.w(TAG, "verifyForPlay: " + e.message)
            }
            val result = ok
            main.post { onDone(result) }
        }, "KishkaBloxVerify").start()
    }

    // ------------------------------------------------------------------ мережа

    private fun fetchManifest(timeoutMs: Int, attempts: Int): Manifest {
        var attempt = 0
        var last: InstallException = InstallException("net", "manifest.json")
        while (attempt < attempts) {
            attempt++
            try {
                val conn = URL(KishkaManager.SERVER_URL + "/blox/manifest.json").openConnection() as HttpURLConnection
                conn.connectTimeout = timeoutMs
                conn.readTimeout = timeoutMs
                try {
                    val code = conn.responseCode
                    if (code != 200) {
                        // Сервер відповів помилкою (404 — на Render старий код без /blox, 503 — немає файлів гри): показуємо справжню причину
                        val msg = try {
                            conn.errorStream?.bufferedReader()?.use { it.readText() }?.let { JSONObject(it).optString("error", "") } ?: ""
                        } catch (e: Exception) {
                            ""
                        }
                        last = InstallException("server", "manifest.json: HTTP " + code + (if (msg.isNotEmpty()) " (" + msg + ")" else ""))
                    } else {
                        return parseManifest(conn.inputStream.bufferedReader().use { it.readText() })
                    }
                } finally {
                    conn.disconnect()
                }
            } catch (e: InstallException) {
                last = e
                if (e.kind == "manifest") throw e
            } catch (e: java.io.IOException) {
                last = InstallException("net", "manifest.json: " + (e.message ?: e.javaClass.simpleName), e)
            }
            if (attempt < attempts) {
                try { Thread.sleep(2000) } catch (e: InterruptedException) { throw last }
            }
        }
        throw last
    }

    private fun parseManifest(body: String): Manifest {
        try {
            val json = JSONObject(body)
            val arr = json.getJSONArray("files")
            val files = ArrayList<FileInfo>()
            val seen = HashSet<String>()
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val name = o.getString("name")
                val size = o.getLong("size")
                val sha = o.getString("sha256").lowercase()
                // Ім'я й хеш перевіряємо тут: ім'я потім підставляється в шлях до файла на телефоні
                if (!NAME_RE.matches(name) || name == "." || name == "..") throw InstallException("manifest", "недозволене ім'я файла")
                if (size < 0 || !SHA_RE.matches(sha)) throw InstallException("manifest", "некоректні розмір або sha256 для " + name)
                if (!seen.add(name)) throw InstallException("manifest", "файл двічі у списку: " + name)
                files.add(FileInfo(name, size, sha))
            }
            if (files.isEmpty()) throw InstallException("manifest", "порожній список файлів")
            if (files.none { it.name == "game.html" } || files.none { it.name == "game.js" }) {
                throw InstallException("manifest", "у списку немає game.html або game.js")
            }
            return Manifest(json.optString("version", ""), files)
        } catch (e: InstallException) {
            throw e
        } catch (e: Exception) {
            throw InstallException("manifest", e.message ?: "некоректний JSON", e)
        }
    }

    /**
     * Качає ВСІ файли в окрему папку, перевіряє їх і лише потім замінює робочу папку. onProgress — відсотки (0..100),
     * onStage — етап (завантаження / перевірка / установлення). Будь-яка помилка залишає стару версію недоторканою.
     */
    private fun downloadAndInstall(
        context: Context,
        manifest: Manifest,
        timeoutMs: Int,
        onProgress: (Int) -> Unit,
        onStage: (UpdateState) -> Unit
    ) {
        val staging = sibling(context, DIR_NEW)
        val backup = sibling(context, DIR_OLD)
        val live = dir(context)
        try {
            staging.deleteRecursively()
            if (!staging.mkdirs()) throw InstallException("disk", "не вдалося створити папку " + DIR_NEW)
            onStage(UpdateState.DOWNLOADING)
            val total = manifest.files.sumOf { it.size }.coerceAtLeast(1L)
            var done = 0L
            for (f in manifest.files) {
                downloadOne(f, File(staging, f.name), timeoutMs) { got -> onProgress((((done + got) * 90L) / total).toInt()) }
                done += f.size
                onProgress(((done * 90L) / total).toInt())
            }

            // Друга перевірка вже з диска: усі файли на місці, розмір і sha256 збігаються з маніфестом
            onStage(UpdateState.VERIFYING)
            onProgress(92)
            for (f in manifest.files) {
                val file = File(staging, f.name)
                if (!file.exists() || file.length() != f.size) throw InstallException("hash", f.name + ": розмір не збігається")
                if (sha256Of(file) != f.sha256) throw InstallException("hash", f.name + ": sha256 не збігається")
            }
            onProgress(96)

            // Заміна папок: стара залишається як резерв, поки нова не стала на місце
            onStage(UpdateState.INSTALLING)
            backup.deleteRecursively()
            if (live.exists() && !live.renameTo(backup)) throw InstallException("disk", "не вдалося відкласти стару версію")
            if (!staging.renameTo(live)) {
                if (backup.exists()) backup.renameTo(live)   // повертаємо стару робочу версію
                throw InstallException("disk", "не вдалося встановити нову версію")
            }
            val filesJson = JSONArray()
            for (f in manifest.files) filesJson.put(JSONObject().put("name", f.name).put("size", f.size).put("sha256", f.sha256))
            prefs(context).edit().putString("files", filesJson.toString()).putString("version", manifest.version).apply()
            backup.deleteRecursively()
            onProgress(100)
        } catch (e: InstallException) {
            staging.deleteRecursively()
            throw e
        } catch (e: Exception) {
            staging.deleteRecursively()
            throw InstallException("unknown", e.message ?: e.javaClass.simpleName, e)
        }
    }

    /** Завантажує один файл у target (через .part), перевіряючи розмір і sha256. До 3 спроб. */
    private fun downloadOne(f: FileInfo, target: File, timeoutMs: Int, onBytes: (Long) -> Unit) {
        val part = File(target.parentFile, f.name + ".part")
        var attempt = 0
        var last: InstallException? = null
        while (attempt < 3) {
            attempt++
            try {
                var got = 0L
                val md = MessageDigest.getInstance("SHA-256")
                val conn = URL(KishkaManager.SERVER_URL + "/blox/files/" + f.name).openConnection() as HttpURLConnection
                conn.connectTimeout = timeoutMs
                conn.readTimeout = timeoutMs
                try {
                    val code = conn.responseCode
                    if (code == 404) throw InstallException("file", f.name + ": HTTP 404")
                    if (code != 200) throw InstallException("server", f.name + ": HTTP " + code)
                    conn.inputStream.use { input ->
                        FileOutputStream(part).use { out ->
                            val buf = ByteArray(16 * 1024)
                            while (true) {
                                val n = input.read(buf)
                                if (n < 0) break
                                out.write(buf, 0, n)
                                md.update(buf, 0, n)
                                got += n
                                onBytes(got)
                            }
                        }
                    }
                } finally {
                    conn.disconnect()
                }
                if (got != f.size) throw InstallException("hash", f.name + ": отримано " + got + " байт замість " + f.size)
                val sha = md.digest().joinToString("") { "%02x".format(it) }
                if (sha != f.sha256) throw InstallException("hash", f.name + ": sha256 не збігається")
                if (target.exists()) target.delete()
                if (!part.renameTo(target)) throw InstallException("disk", f.name + ": не вдалося зберегти")
                return
            } catch (e: InstallException) {
                last = e
                part.delete()
                // 404 і помилки диска повторами не виправляються
                if (e.kind == "file" || e.kind == "disk") throw e
            } catch (e: java.io.IOException) {
                last = InstallException(if (e.message?.contains("ENOSPC") == true) "disk" else "net", f.name + ": " + (e.message ?: e.javaClass.simpleName), e)
                part.delete()
                if (last.kind == "disk") throw last
            }
            if (attempt < 3) {
                try { Thread.sleep(1500) } catch (ie: InterruptedException) { throw last ?: InstallException("unknown", "перервано") }
            }
        }
        throw last ?: InstallException("unknown", f.name)
    }
}

/** Картинка з телефона, якщо гру вже установлено, інакше з інтернету. */
@Composable
fun bloxImageModel(localName: String, remoteUrl: String): Any {
    val context = LocalContext.current
    // Читаємо стан установки, щоб екран оновився, коли файли з'являться
    val installed = BloxInstall.phase == BloxInstall.Phase.READY || BloxInstall.phase == BloxInstall.Phase.INSTALLED
    val f = BloxInstall.file(context, localName)
    return if (installed && f.exists()) f else remoteUrl
}

/**
 * Екран «Установити KishkaBlox?»: назва, знизу кнопка «Установити». Під час установки — смужка й відсотки,
 * після неї — кнопка «Розпочати».
 */
@Composable
fun BloxInstallScreen(lang: String) {
    val context = LocalContext.current
    val b: (String) -> String = { key -> BloxStrings.get(key, lang) }
    val phase = BloxInstall.phase

    Box(modifier = Modifier.fillMaxSize().background(ViberBg)) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 24.dp, end = 24.dp, top = 24.dp, bottom = 150.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            AsyncImage(
                model = bloxImageModel("kishkablox.png", KISHKABLOX_LOGO_URL),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(96.dp).clip(RoundedCornerShape(24.dp))
            )
            Spacer(modifier = Modifier.height(18.dp))
            Text(
                if (phase == BloxInstall.Phase.INSTALLED) b("tab") else b("install_title"),
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = ViberPurple,
                textAlign = TextAlign.Center
            )
            if (phase == BloxInstall.Phase.ERROR) {
                Spacer(modifier = Modifier.height(12.dp))
                Text(b("install_error"), fontSize = 14.sp, color = Color(0xFFD93025), textAlign = TextAlign.Center)
                // Справжня причина: сервер недоступний, немає файла, не збігся хеш, немає місця
                Spacer(modifier = Modifier.height(6.dp))
                Text(BloxInstall.reasonText(BloxInstall.errorKind, BloxInstall.errorDetail, lang), fontSize = 12.sp, color = Color.Gray, textAlign = TextAlign.Center)
            }
        }

        // Знизу: кнопка або смужка з відсотками
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .widthIn(max = 480.dp)
                .fillMaxWidth()
                .padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            when (phase) {
                BloxInstall.Phase.DOWNLOADING -> {
                    LinearProgressIndicator(
                        progress = BloxInstall.percent / 100f,
                        color = ViberPurple,
                        trackColor = ViberLightPurple,
                        modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp))
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    Text("${BloxInstall.percent}%", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Color.DarkGray)
                }
                BloxInstall.Phase.INSTALLED -> {
                    Button(
                        onClick = { BloxInstall.getStarted(context) },
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = ViberPurple)
                    ) {
                        Text(b("get_started"), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                    }
                }
                BloxInstall.Phase.CHECKING -> {
                    CircularProgressIndicator(color = ViberPurple, modifier = Modifier.size(32.dp))
                }
                else -> {
                    Button(
                        onClick = { BloxInstall.install(context) },
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = ViberPurple)
                    ) {
                        Text(
                            if (phase == BloxInstall.Phase.ERROR) b("retry") else b("install"),
                            fontSize = 17.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1
                        )
                    }
                }
            }
        }
    }
}

/**
 * Смуга оновлення вгорі вкладки KishkaBlox. Нічого не показує, якщо оновлення немає або сервер недоступний.
 * Є нова версія — кнопка «Оновити»; під час оновлення — етап і смужка прогресу; помилка — причина й «Повторити»
 * (стара версія гри при цьому лишається робочою); успіх — коротке підтвердження.
 */
@Composable
fun BloxUpdateBanner(lang: String) {
    val context = LocalContext.current
    val b: (String) -> String = { key -> BloxStrings.get(key, lang) }
    val state = BloxInstall.updateState
    if (state == BloxInstall.UpdateState.NONE) return
    val isError = state == BloxInstall.UpdateState.ERROR
    val isDone = state == BloxInstall.UpdateState.DONE
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = if (isError) Color(0xFFFDECEA) else if (isDone) Color(0xFFE6F4EA) else Color.White,
        shadowElevation = 2.dp,
        modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 4.dp)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            when (state) {
                BloxInstall.UpdateState.AVAILABLE -> {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(b("update_available"), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Color.Black)
                            Spacer(modifier = Modifier.height(2.dp))
                            Text(b("update_hint"), fontSize = 12.sp, color = Color.Gray)
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Button(
                            onClick = { BloxInstall.startUpdate(context) },
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = ViberPurple)
                        ) {
                            Text(b("update_btn"), fontWeight = FontWeight.SemiBold, maxLines = 1)
                        }
                    }
                }
                BloxInstall.UpdateState.DOWNLOADING,
                BloxInstall.UpdateState.VERIFYING,
                BloxInstall.UpdateState.INSTALLING -> {
                    val label = when (state) {
                        BloxInstall.UpdateState.VERIFYING -> b("update_verifying")
                        BloxInstall.UpdateState.INSTALLING -> b("update_installing")
                        else -> b("update_downloading")
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Color.Black, modifier = Modifier.weight(1f))
                        Text("${BloxInstall.updatePercent}%", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Color.DarkGray)
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    LinearProgressIndicator(
                        progress = BloxInstall.updatePercent / 100f,
                        color = ViberPurple,
                        trackColor = ViberLightPurple,
                        modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp))
                    )
                }
                BloxInstall.UpdateState.DONE -> {
                    Text(b("update_done"), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF1E7B34))
                }
                else -> {
                    Text(b("update_failed"), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFFD93025))
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(BloxInstall.reasonText(BloxInstall.updateErrorKind, BloxInstall.updateErrorDetail, lang), fontSize = 12.sp, color = Color.DarkGray)
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(
                        onClick = { BloxInstall.startUpdate(context) },
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = ViberPurple)
                    ) {
                        Text(b("retry"), fontWeight = FontWeight.SemiBold, maxLines = 1)
                    }
                }
            }
        }
    }
}
