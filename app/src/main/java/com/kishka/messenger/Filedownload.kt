package com.kishka.messenger

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.webkit.MimeTypeMap
import androidx.compose.runtime.mutableStateMapOf
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Завантаження файлів із чату в памʼять застосунку: у бульбашці видно «37%», після завершення файл відкривається
 * кнопкою «Відкрити» (HTML і APK — вбудованими переглядачем і встановлювачем) без переходу в програму «Файли».
 */
object FileDownloads {
    /** url -> 0..1 (або -1, якщо розмір невідомий). Спостерігається з Compose. */
    val progress = mutableStateMapOf<String, Float>()

    private val main = Handler(Looper.getMainLooper())

    fun localFile(context: Context, url: String, name: String?): File {
        val dir = File(context.applicationContext.filesDir, "downloads")
        dir.mkdirs()
        val safe = (name ?: "file").replace(Regex("[^A-Za-z0-9._-]"), "_").ifEmpty { "file" }
        return File(dir, "${Integer.toHexString(url.hashCode())}_$safe")
    }

    fun isDownloaded(context: Context, url: String, name: String?): Boolean {
        val f = localFile(context, url, name)
        return f.exists() && f.length() > 0L
    }

    fun start(context: Context, url: String, name: String?, onDone: (File?) -> Unit) {
        if (progress.containsKey(url)) return
        val appContext = context.applicationContext
        main.post { progress[url] = 0f }
        Thread {
            var result: File? = null
            val target = localFile(appContext, url, name)
            val tmp = File(target.parentFile, target.name + ".part")
            try {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 30000
                conn.readTimeout = 120000
                val total = conn.contentLengthLong
                var lastPercent = -2
                conn.inputStream.use { input ->
                    tmp.outputStream().use { out ->
                        val chunk = ByteArray(32 * 1024)
                        var done = 0L
                        while (true) {
                            val n = input.read(chunk)
                            if (n < 0) break
                            out.write(chunk, 0, n)
                            done += n
                            val fraction = if (total > 0) (done.toFloat() / total).coerceIn(0f, 1f) else -1f
                            val percent = if (fraction < 0f) -1 else (fraction * 100).toInt()
                            if (percent != lastPercent) {
                                lastPercent = percent
                                main.post { progress[url] = fraction }
                            }
                        }
                    }
                }
                conn.disconnect()
                if (tmp.length() > 0L) {
                    if (target.exists()) target.delete()
                    if (tmp.renameTo(target)) result = target
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
            if (result == null) tmp.delete()
            main.post {
                progress.remove(url)
                onDone(result)
            }
        }.start()
    }

    /** Відкриває файл системним переглядачем (для HTML та APK у чаті використовуються вбудовані вікна). */
    fun open(context: Context, file: File, name: String?): Boolean {
        return try {
            val ext = (name ?: file.name).substringAfterLast('.', "").lowercase()
            val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "*/*"
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mime)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }
}
