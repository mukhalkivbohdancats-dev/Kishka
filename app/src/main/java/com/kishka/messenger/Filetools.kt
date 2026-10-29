package com.kishka.messenger

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Android
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

object FileKinds {
    fun isHtml(name: String?): Boolean {
        val n = name?.trim()?.lowercase() ?: return false
        return n.endsWith(".html") || n.endsWith(".htm")
    }

    fun isApk(name: String?): Boolean = name?.trim()?.lowercase()?.endsWith(".apk") == true
}

object FileTools {
    const val MAX_HTML_BYTES = 5 * 1024 * 1024

    /** Завантажує текст (HTML). Повертає (текст, ключ помилки). */
    fun fetchText(url: String): Pair<String?, String?> {
        return try {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.connectTimeout = 30000
            conn.readTimeout = 60000
            val length = conn.contentLengthLong
            if (length > MAX_HTML_BYTES) {
                conn.disconnect()
                return Pair(null, "html_too_big")
            }
            val bytes = conn.inputStream.use { input ->
                val buffer = java.io.ByteArrayOutputStream()
                val chunk = ByteArray(16 * 1024)
                var total = 0
                while (true) {
                    val n = input.read(chunk)
                    if (n < 0) break
                    total += n
                    if (total > MAX_HTML_BYTES) {
                        conn.disconnect()
                        return Pair(null, "html_too_big")
                    }
                    buffer.write(chunk, 0, n)
                }
                buffer.toByteArray()
            }
            conn.disconnect()
            Pair(String(bytes, Charsets.UTF_8), null)
        } catch (e: Exception) {
            e.printStackTrace()
            Pair(null, "html_failed")
        }
    }

    fun canInstallPackages(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    fun openInstallSettings(context: Context) {
        try {
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /** Завантажує APK у кеш застосунку. onProgress: 0..1 (або -1, якщо розмір невідомий). */
    fun downloadApk(context: Context, url: String, name: String?, onProgress: (Float) -> Unit): File? {
        return try {
            val dir = File(context.cacheDir, "apk")
            dir.mkdirs()
            dir.listFiles()?.forEach { it.delete() }
            val safeName = (name ?: "app.apk").replace(Regex("[^A-Za-z0-9._-]"), "_").let { if (it.lowercase().endsWith(".apk")) it else "$it.apk" }
            val file = File(dir, safeName)

            val conn = URL(url).openConnection() as HttpURLConnection
            conn.connectTimeout = 30000
            conn.readTimeout = 120000
            val total = conn.contentLengthLong
            conn.inputStream.use { input ->
                file.outputStream().use { out ->
                    val chunk = ByteArray(32 * 1024)
                    var done = 0L
                    while (true) {
                        val n = input.read(chunk)
                        if (n < 0) break
                        out.write(chunk, 0, n)
                        done += n
                        onProgress(if (total > 0) (done.toFloat() / total).coerceIn(0f, 1f) else -1f)
                    }
                }
            }
            conn.disconnect()
            if (file.length() > 0) file else null
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    fun launchInstaller(context: Context, file: File): Boolean {
        return try {
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
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

// ======================== ВБУДОВАНИЙ ПЕРЕГЛЯДАЧ HTML ========================

@Composable
fun HtmlViewerDialog(url: String, name: String?, lang: String, onDismiss: () -> Unit) {
    var html by remember(url) { mutableStateOf<String?>(null) }
    var errorKey by remember(url) { mutableStateOf<String?>(null) }
    var scriptsOn by remember(url) { mutableStateOf(false) }
    val webHolder = remember { arrayOfNulls<WebView>(1) }

    LaunchedEffect(url) {
        val result = withContext(Dispatchers.IO) { FileTools.fetchText(url) }
        html = result.first
        errorKey = result.second
    }

    DisposableEffect(Unit) {
        onDispose {
            try {
                webHolder[0]?.destroy()
            } catch (e: Exception) {
                e.printStackTrace()
            }
            webHolder[0] = null
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(color = Color.White, modifier = Modifier.fillMaxSize()) {
            Column(modifier = Modifier.fillMaxSize()) {
                Row(
                    modifier = Modifier.fillMaxWidth().background(ViberPurple).padding(horizontal = 4.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, contentDescription = ChatStrings.get("close", lang), tint = Color.White)
                    }
                    Text(
                        name?.takeIf { it.isNotBlank() } ?: ChatStrings.get("html_title", lang),
                        color = Color.White,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    TextButton(onClick = { scriptsOn = !scriptsOn }) {
                        Text(
                            ChatStrings.get(if (scriptsOn) "html_scripts_on" else "html_scripts_off", lang),
                            color = Color.White,
                            fontSize = 13.sp
                        )
                    }
                }
                if (!scriptsOn) {
                    Text(
                        ChatStrings.get("html_warning", lang),
                        fontSize = 12.sp,
                        color = Color.DarkGray,
                        modifier = Modifier.fillMaxWidth().background(ViberLightPurple).padding(horizontal = 12.dp, vertical = 6.dp)
                    )
                }
                Box(modifier = Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    val key = errorKey
                    val content = html
                    when {
                        key != null -> Text(
                            ChatStrings.get(key, lang),
                            color = Color.Gray,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(24.dp)
                        )
                        content == null -> CircularProgressIndicator(color = ViberPurple)
                        else -> AndroidView(
                            modifier = Modifier.fillMaxSize(),
                            factory = { ctx ->
                                WebView(ctx).apply {
                                    webHolder[0] = this
                                    settings.allowFileAccess = false
                                    settings.allowContentAccess = false
                                    settings.domStorageEnabled = false
                                    settings.setSupportZoom(true)
                                    settings.builtInZoomControls = true
                                    settings.displayZoomControls = false
                                    settings.useWideViewPort = true
                                    settings.loadWithOverviewMode = true
                                    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                                    // Переходи за посиланнями заблоковані: це лише переглядач файлу
                                    webViewClient = object : WebViewClient() {
                                        override fun shouldOverrideUrlLoading(
                                            view: WebView?,
                                            request: android.webkit.WebResourceRequest?
                                        ): Boolean = true
                                    }
                                }
                            },
                            update = { webView ->
                                val stamp = "$scriptsOn|${content.hashCode()}"
                                if (webView.tag != stamp) {
                                    webView.tag = stamp
                                    webView.settings.javaScriptEnabled = scriptsOn
                                    webView.loadDataWithBaseURL(null, content, "text/html", "UTF-8", null)
                                }
                            }
                        )
                    }
                }
            }
        }
    }
}

// ======================== ВБУДОВАНИЙ ВСТАНОВЛЮВАЧ APK ========================

@Composable
fun ApkInstallDialog(url: String, name: String?, lang: String, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf(0f) }

    Dialog(onDismissRequest = { if (!busy) onDismiss() }) {
        Surface(shape = RoundedCornerShape(24.dp), color = Color.White, shadowElevation = 8.dp) {
            Column(
                modifier = Modifier.padding(24.dp).widthIn(min = 260.dp, max = 420.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Box(
                    modifier = Modifier.size(56.dp).clip(CircleShape).background(ViberLightPurple),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Default.Android, contentDescription = null, tint = ViberPurple, modifier = Modifier.size(34.dp))
                }
                Spacer(modifier = Modifier.height(12.dp))
                Text(ChatStrings.get("apk_title", lang), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.Black)
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    name ?: "app.apk",
                    fontSize = 14.sp,
                    color = ViberPurple,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(10.dp))
                Text(ChatStrings.get("apk_warning", lang), fontSize = 13.sp, color = Color.DarkGray, textAlign = TextAlign.Center)
                Spacer(modifier = Modifier.height(14.dp))

                if (busy) {
                    if (progress >= 0f) {
                        LinearProgressIndicator(
                            progress = progress,
                            modifier = Modifier.fillMaxWidth().height(4.dp),
                            color = ViberPurple,
                            trackColor = ViberLightPurple
                        )
                    } else {
                        LinearProgressIndicator(modifier = Modifier.fillMaxWidth().height(4.dp), color = ViberPurple, trackColor = ViberLightPurple)
                    }
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(ChatStrings.get("apk_downloading", lang), fontSize = 12.sp, color = Color.Gray)
                    Spacer(modifier = Modifier.height(10.dp))
                }

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(
                        onClick = onDismiss,
                        enabled = !busy,
                        modifier = Modifier.weight(1f).height(46.dp),
                        shape = RoundedCornerShape(14.dp)
                    ) {
                        Text(ChatStrings.get("apk_cancel", lang), maxLines = 1)
                    }
                    Button(
                        onClick = {
                            if (!FileTools.canInstallPackages(context)) {
                                FileTools.openInstallSettings(context)
                                Notice.show(ChatStrings.get("apk_allow", lang))
                            } else {
                                busy = true
                                progress = 0f
                                scope.launch {
                                    val file = withContext(Dispatchers.IO) {
                                        FileTools.downloadApk(context, url, name) { p -> progress = p }
                                    }
                                    busy = false
                                    if (file != null && FileTools.launchInstaller(context, file)) {
                                        onDismiss()
                                    } else {
                                        Notice.show(ChatStrings.get("apk_failed", lang))
                                    }
                                }
                            }
                        },
                        enabled = !busy,
                        modifier = Modifier.weight(1f).height(46.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = ViberPurple)
                    ) {
                        Text(ChatStrings.get("apk_install", lang), maxLines = 1)
                    }
                }
            }
        }
    }
}
