package com.kishka.messenger

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
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
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/** Аватарка гри Realistic cars: Assets/Realistic_cars.jpg у репозиторії. */
const val REALISTIC_CARS_URL =
    "https://raw.githubusercontent.com/mukhalkivbohdancats-dev/Kishka/main/Assets/Realistic_cars.jpg"

/**
 * Установка KishkaBlox на телефон. Сервер (kishkablox.js) віддає список файлів гри (/blox/manifest.json) і самі файли
 * (/blox/files/<ім'я>); застосунок качає їх у власну папку й показує, скільки відсотків установлено.
 * Хто не користується KishkaBlox — нічого не качає й нічого не займає. Установка робиться один раз:
 * після «Розпочати» вкладка відкривається одразу. Оновлену гру з сервера телефон тихо підтягує сам при вході в гру.
 */
object BloxInstall {
    enum class Phase { CHECKING, NOT_INSTALLED, DOWNLOADING, INSTALLED, READY, ERROR }

    private const val PREFS = "kishkablox_install"
    private val main = Handler(Looper.getMainLooper())

    var phase by mutableStateOf(Phase.CHECKING)
        private set
    var percent by mutableStateOf(0)
        private set

    @Volatile private var running = false

    private class Manifest(val version: String, val names: List<String>, val sizes: List<Long>)

    fun dir(context: Context): File = File(context.applicationContext.filesDir, "kishkablox")

    fun file(context: Context, name: String): File = File(dir(context), name)

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Усі файли, які записано під час установки, на місці й цілі? */
    private fun filesPresent(context: Context): Boolean {
        val raw = prefs(context).getString("files", null) ?: return false
        return try {
            val arr = JSONArray(raw)
            if (arr.length() == 0) return false
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val f = file(context, o.getString("name"))
                if (!f.exists() || f.length() != o.getLong("size")) return false
            }
            true
        } catch (e: Exception) {
            false
        }
    }

    /** Викликається, коли відкрито вкладку: що показувати — установку, «Розпочати» чи саму вкладку. */
    fun check(context: Context) {
        if (running) return
        val present = filesPresent(context)
        phase = when {
            present && prefs(context).getBoolean("started", false) -> Phase.READY
            present -> Phase.INSTALLED
            else -> Phase.NOT_INSTALLED
        }
        if (phase != Phase.NOT_INSTALLED) percent = 100 else percent = 0
    }

    /** Кнопка «Установити». */
    fun install(context: Context) {
        if (running) return
        running = true
        percent = 0
        phase = Phase.DOWNLOADING
        val app = context.applicationContext
        Thread({
            var ok = false
            try {
                val manifest = fetchManifest(60_000, 3)
                if (manifest != null) {
                    downloadAll(app, manifest, 60_000) { p -> postPercent(p) }
                    ok = true
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
            main.post {
                running = false
                if (ok) {
                    percent = 100
                    phase = Phase.INSTALLED
                } else {
                    phase = Phase.ERROR
                }
            }
        }, "KishkaBloxInstall").start()
    }

    /** Кнопка «Розпочати»: більше установлювати не треба. */
    fun getStarted(context: Context) {
        prefs(context).edit().putBoolean("started", true).apply()
        phase = Phase.READY
    }

    /**
     * Перед входом у гру: якщо на сервері гру оновлено — тихо докачуємо нові файли (до ~20 с).
     * Немає інтернету / сервер не відповів — граємо тим, що вже установлено. onDone(true) — файли на місці.
     */
    fun syncLatest(context: Context, onDone: (Boolean) -> Unit) {
        val app = context.applicationContext
        Thread({
            var present = filesPresent(app)
            try {
                val manifest = fetchManifest(6_000, 1)
                if (manifest != null && (manifest.version != prefs(app).getString("version", "") || !present)) {
                    downloadAll(app, manifest, 20_000) { }
                    present = true
                }
            } catch (e: Exception) {
                e.printStackTrace()
                present = filesPresent(app)
            }
            val result = present
            main.post { onDone(result) }
        }, "KishkaBloxSync").start()
    }

    private fun postPercent(p: Int) {
        main.post { if (running && p > percent) percent = p.coerceAtMost(99) }
    }

    private fun fetchManifest(timeoutMs: Int, attempts: Int): Manifest? {
        var attempt = 0
        while (attempt < attempts) {
            attempt++
            try {
                val conn = URL(KishkaManager.SERVER_URL + "/blox/manifest.json").openConnection() as HttpURLConnection
                conn.connectTimeout = timeoutMs
                conn.readTimeout = timeoutMs
                try {
                    if (conn.responseCode == 200) {
                        val body = conn.inputStream.bufferedReader().use { it.readText() }
                        val json = JSONObject(body)
                        val arr = json.getJSONArray("files")
                        val names = ArrayList<String>()
                        val sizes = ArrayList<Long>()
                        for (i in 0 until arr.length()) {
                            val o = arr.getJSONObject(i)
                            names.add(o.getString("name"))
                            sizes.add(o.getLong("size"))
                        }
                        if (names.isNotEmpty()) return Manifest(json.optString("version", ""), names, sizes)
                    }
                } finally {
                    conn.disconnect()
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
            if (attempt < attempts) {
                try { Thread.sleep(2000) } catch (e: InterruptedException) { return null }
            }
        }
        return null
    }

    /** Качає всі файли за списком; onProgress — відсотки всієї установки (0..100). Помилка — виняток. */
    private fun downloadAll(context: Context, manifest: Manifest, timeoutMs: Int, onProgress: (Int) -> Unit) {
        val target = dir(context)
        if (!target.exists() && !target.mkdirs()) throw java.io.IOException("mkdir")
        val total = manifest.sizes.sum().coerceAtLeast(1L)
        var done = 0L
        for (i in manifest.names.indices) {
            val name = manifest.names[i]
            val size = manifest.sizes[i]
            val part = File(target, "$name.part")
            var attempt = 0
            var ok = false
            var lastError: Exception? = null
            while (attempt < 3 && !ok) {
                attempt++
                var got = 0L
                try {
                    val conn = URL(KishkaManager.SERVER_URL + "/blox/files/" + name).openConnection() as HttpURLConnection
                    conn.connectTimeout = timeoutMs
                    conn.readTimeout = timeoutMs
                    try {
                        if (conn.responseCode != 200) throw java.io.IOException("http " + conn.responseCode)
                        conn.inputStream.use { input ->
                            FileOutputStream(part).use { out ->
                                val buf = ByteArray(16 * 1024)
                                while (true) {
                                    val n = input.read(buf)
                                    if (n < 0) break
                                    out.write(buf, 0, n)
                                    got += n
                                    onProgress((((done + got) * 100L) / total).toInt())
                                }
                            }
                        }
                    } finally {
                        conn.disconnect()
                    }
                    if (part.length() != size) throw java.io.IOException("size mismatch")
                    val finalFile = File(target, name)
                    if (finalFile.exists()) finalFile.delete()
                    if (!part.renameTo(finalFile)) throw java.io.IOException("rename")
                    ok = true
                } catch (e: Exception) {
                    lastError = e
                    part.delete()
                    if (attempt < 3) {
                        try { Thread.sleep(1500) } catch (ie: InterruptedException) { throw e }
                    }
                }
            }
            if (!ok) throw lastError ?: java.io.IOException("download")
            done += size
            onProgress(((done * 100L) / total).toInt())
        }
        // Старі файли, яких у списку більше нема, видаляємо
        target.listFiles()?.forEach { f -> if (!f.name.endsWith(".part") && f.name !in manifest.names) f.delete() }

        val filesJson = JSONArray()
        for (i in manifest.names.indices) {
            filesJson.put(JSONObject().put("name", manifest.names[i]).put("size", manifest.sizes[i]))
        }
        prefs(context).edit().putString("files", filesJson.toString()).putString("version", manifest.version).apply()
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
