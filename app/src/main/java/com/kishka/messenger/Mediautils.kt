package com.kishka.messenger

import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.OpenableColumns
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Результат завантаження файлу на сервер. url — відносне посилання виду /media/<id>. */
data class UploadedMedia(
    val url: String,
    val type: String,        // "image", "video" або "file"
    val mime: String,
    val size: Long,
    val thumbUrl: String? = null,
    val name: String? = null
)

/** Файл, який користувач обрав у галереї, але ще не надіслав. */
data class PendingMedia(
    val uri: Uri,
    val mime: String,
    val type: String,        // "image", "video" або "file"
    val name: String,
    val size: Long
)

/** Дескриптор завантаження: дозволяє його зупинити. */
class UploadHandle {
    @Volatile
    var cancelled = false
    @Volatile
    var connection: HttpURLConnection? = null

    fun cancel() {
        cancelled = true
        try {
            connection?.disconnect()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}

object MediaUtils {

    private val mainHandler = Handler(Looper.getMainLooper())

    /** Максимальний розмір файлу (сервер теж обмежує — 250 МБ). */
    const val MAX_FILE_BYTES = 250L * 1024L * 1024L

    fun typeFromMime(mime: String?): String? = when {
        mime == null -> null
        mime.startsWith("image/") -> "image"
        mime.startsWith("video/") -> "video"
        else -> null
    }

    /** Готує обране фото/відео до відправки: тип, назва, розмір. Повертає null, якщо це не фото/відео. */
    fun describe(context: Context, uri: Uri): PendingMedia? {
        val media = describeFile(context, uri) ?: return null
        return if (media.type == "file") null else media
    }

    /** Готує будь-який файл до відправки (фото, відео або документ). */
    fun describeFile(context: Context, uri: Uri): PendingMedia? {
        val resolver = context.contentResolver
        val mime = (resolver.getType(uri) ?: "application/octet-stream").lowercase()
        val type = typeFromMime(mime) ?: "file"
        var name = "file"
        var size = 0L
        try {
            resolver.query(uri, null, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (nameIdx >= 0) name = cursor.getString(nameIdx) ?: name
                    if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) size = cursor.getLong(sizeIdx)
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return PendingMedia(uri, mime, type, name, size)
    }

    fun formatSize(bytes: Long, lang: String): String {
        if (bytes <= 0) return ""
        val mb = bytes / (1024.0 * 1024.0)
        return if (mb >= 1.0) {
            String.format("%.1f %s", mb, AppText.get("size_mb", lang))
        } else {
            String.format("%d %s", maxOf(1L, bytes / 1024), AppText.get("size_kb", lang))
        }
    }

    /** Кадр із відео для мініатюри (виконувати НЕ в головному потоці). */
    fun videoThumbnail(context: Context, uri: Uri): Bitmap? {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(context, uri)
            val frame = retriever.getFrameAtTime(1_000_000L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                ?: retriever.getFrameAtTime(0L)
            if (frame == null) null else scaleDown(frame, 480)
        } catch (e: Exception) {
            e.printStackTrace()
            null
        } finally {
            try {
                retriever.release()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun scaleDown(bitmap: Bitmap, maxSide: Int): Bitmap {
        val longest = maxOf(bitmap.width, bitmap.height)
        if (longest <= maxSide) return bitmap
        val ratio = maxSide.toFloat() / longest.toFloat()
        return Bitmap.createScaledBitmap(
            bitmap,
            maxOf(1, (bitmap.width * ratio).toInt()),
            maxOf(1, (bitmap.height * ratio).toInt()),
            true
        )
    }

    private fun jpegBytes(bitmap: Bitmap): ByteArray {
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 82, out)
        return out.toByteArray()
    }

    private fun postJson(response: String): JSONObject? = try {
        JSONObject(response)
    } catch (e: Exception) {
        null
    }

    /** Завантажує потік/байти на сервер (POST /upload). Викликати з фонового потоку. Повертає відносний url або null. */
    private fun uploadStream(
        mime: String,
        name: String,
        email: String,
        length: Long,
        handle: UploadHandle,
        onProgress: (Float) -> Unit,
        writer: (java.io.OutputStream, (Long) -> Unit) -> Unit
    ): JSONObject? {
        val url = URL(
            KishkaManager.SERVER_URL + "/upload?mime=" + URLEncoder.encode(mime, "UTF-8") +
                "&name=" + URLEncoder.encode(name, "UTF-8")
        )
        val conn = url.openConnection() as HttpURLConnection
        handle.connection = conn
        try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.connectTimeout = 30000
            conn.readTimeout = 300000
            conn.setRequestProperty("Content-Type", mime)
            conn.setRequestProperty("X-Kishka-Email", email)
            if (length > 0) conn.setFixedLengthStreamingMode(length) else conn.setChunkedStreamingMode(64 * 1024)

            var sent = 0L
            conn.outputStream.use { out ->
                writer(out) { delta ->
                    sent += delta
                    if (length > 0) onProgress((sent.toFloat() / length.toFloat()).coerceIn(0f, 1f))
                }
            }
            if (handle.cancelled) return null
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            val json = postJson(text)
            return if (code in 200..299 && json?.optBoolean("success", false) == true) json else null
        } finally {
            try {
                conn.disconnect()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    /**
     * Завантажує фото/відео на сервер (для відео додатково створює і завантажує мініатюру).
     * Колбеки onProgress / onDone викликаються в головному потоці. onDone(null) — помилка або скасування.
     */
    fun upload(
        context: Context,
        media: PendingMedia,
        email: String,
        onProgress: (Float) -> Unit,
        onDone: (UploadedMedia?) -> Unit
    ): UploadHandle {
        val handle = UploadHandle()
        val appContext = context.applicationContext

        Thread {
            var result: UploadedMedia? = null
            try {
                val resolver = appContext.contentResolver
                val progressToUi: (Float) -> Unit = { p -> mainHandler.post { onProgress(p) } }

                val json = uploadStream(
                    media.mime, media.name, email, media.size, handle, progressToUi
                ) { out, report ->
                    resolver.openInputStream(media.uri)?.use { input ->
                        val buffer = ByteArray(64 * 1024)
                        while (!handle.cancelled) {
                            val n = input.read(buffer)
                            if (n < 0) break
                            out.write(buffer, 0, n)
                            report(n.toLong())
                        }
                    }
                }

                if (json != null && !handle.cancelled) {
                    var thumbUrl: String? = null
                    if (media.type == "video") {
                        val thumb = videoThumbnail(appContext, media.uri)
                        if (thumb != null) {
                            val bytes = jpegBytes(thumb)
                            val thumbJson = uploadStream(
                                "image/jpeg", "thumb.jpg", email, bytes.size.toLong(), handle, {}
                            ) { out, report ->
                                out.write(bytes)
                                report(bytes.size.toLong())
                            }
                            thumbUrl = thumbJson?.optString("url", "")?.ifEmpty { null }
                        }
                    }
                    result = UploadedMedia(
                        url = json.optString("url", ""),
                        type = media.type,
                        mime = media.mime,
                        size = json.optLong("size", media.size),
                        thumbUrl = thumbUrl,
                        name = media.name
                    )
                    if (result.url.isEmpty()) result = null
                }
            } catch (e: Exception) {
                e.printStackTrace()
                result = null
            }
            val finalResult = if (handle.cancelled) null else result
            mainHandler.post { onDone(finalResult) }
        }.start()

        return handle
    }

    /**
     * Завантажує звичайний файл (документ тощо) у папку "Завантаження".
     * Якщо системний завантажувач недоступний — відкриває посилання у браузері.
     */
    fun downloadFile(context: Context, url: String, name: String?): Boolean {
        val fileName = (name ?: "file").replace(Regex("[\\\\/:*?\"<>|]"), "_")
        return try {
            val request = DownloadManager.Request(Uri.parse(url))
                .setTitle(fileName)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "Kishka/$fileName")
            val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            manager.enqueue(request)
            true
        } catch (e: Exception) {
            e.printStackTrace()
            try {
                val view = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
                context.startActivity(view)
                true
            } catch (e2: Exception) {
                e2.printStackTrace()
                false
            }
        }
    }

    /** Копіює вміст відповіді в out; для зображень може накласти напівпрозорий логотип у правому нижньому куті. */
    private fun writeBody(context: Context, conn: HttpURLConnection, out: java.io.OutputStream, watermark: Boolean) {
        if (!watermark) {
            conn.inputStream.use { input -> input.copyTo(out) }
            return
        }
        val bytes = conn.inputStream.use { it.readBytes() }
        val source = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        if (source == null) {
            out.write(bytes)
            return
        }
        val result = addWatermark(context, source)
        result.compress(Bitmap.CompressFormat.PNG, 100, out)
        if (result !== source) result.recycle()
        source.recycle()
    }

    /** Накладає логотип (res/drawable-nodpi/logo_watermark.png) із 50% прозорістю знизу праворуч. */
    fun addWatermark(context: Context, source: Bitmap): Bitmap {
        return try {
            val logo = android.graphics.BitmapFactory.decodeResource(context.resources, R.drawable.logo_watermark) ?: return source
            val result = source.copy(Bitmap.Config.ARGB_8888, true) ?: return source
            val canvas = android.graphics.Canvas(result)
            val size = (result.width * 0.14f).toInt().coerceAtLeast(32)
            val margin = (result.width * 0.02f).toInt()
            val left = result.width - size - margin
            val top = result.height - size - margin
            val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG or android.graphics.Paint.FILTER_BITMAP_FLAG).apply { alpha = 128 }
            canvas.drawBitmap(logo, null, android.graphics.Rect(left, top, left + size, top + size), paint)
            logo.recycle()
            result
        } catch (e: Exception) {
            e.printStackTrace()
            source
        }
    }

    /**
     * Зберігає фото/відео за посиланням у галерею (Pictures/Kishka або Movies/Kishka).
     * Android 10+: без додаткових дозволів. Android 7–9: потрібен WRITE_EXTERNAL_STORAGE (запитується в інтерфейсі).
     */
    fun saveToGallery(context: Context, url: String, watermark: Boolean = false, onResult: (Boolean) -> Unit) {
        val appContext = context.applicationContext
        Thread {
            var ok = false
            try {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 30000
                conn.readTimeout = 120000
                val rawMime = (conn.contentType ?: "image/png").substringBefore(';').trim()
                val isVideo = rawMime.startsWith("video/")
                val applyWatermark = watermark && !isVideo
                // З ватермарком зображення зберігається як PNG
                val mime = if (applyWatermark) "image/png" else rawMime
                val ext = when {
                    mime.contains("jpeg") || mime.contains("jpg") -> "jpg"
                    mime.contains("webp") -> "webp"
                    mime.contains("gif") -> "gif"
                    mime.contains("png") -> "png"
                    mime.contains("quicktime") -> "mov"
                    mime.contains("webm") -> "webm"
                    isVideo -> "mp4"
                    else -> "png"
                }
                val name = "Kishka_${System.currentTimeMillis()}.$ext"
                val folder = if (isVideo) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_PICTURES

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val collection = if (isVideo) MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                    else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                    val values = ContentValues().apply {
                        put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                        put(MediaStore.MediaColumns.MIME_TYPE, mime)
                        put(MediaStore.MediaColumns.RELATIVE_PATH, "$folder/Kishka")
                        put(MediaStore.MediaColumns.IS_PENDING, 1)
                    }
                    val resolver = appContext.contentResolver
                    val uri = resolver.insert(collection, values)
                    if (uri != null) {
                        val stream = resolver.openOutputStream(uri)
                        if (stream != null) {
                            stream.use { out -> writeBody(appContext, conn, out, applyWatermark) }
                            values.clear()
                            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                            resolver.update(uri, values, null, null)
                            ok = true
                        }
                    }
                } else {
                    @Suppress("DEPRECATION")
                    val dir = File(Environment.getExternalStoragePublicDirectory(folder), "Kishka")
                    dir.mkdirs()
                    val file = File(dir, name)
                    file.outputStream().use { out -> writeBody(appContext, conn, out, applyWatermark) }
                    MediaScannerConnection.scanFile(appContext, arrayOf(file.absolutePath), arrayOf(mime), null)
                    ok = true
                }
                conn.disconnect()
            } catch (e: Exception) {
                e.printStackTrace()
            }
            mainHandler.post { onResult(ok) }
        }.start()
    }
}
