package com.kishka.messenger

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.widget.MediaController
import android.widget.Toast
import android.widget.VideoView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SaveAlt
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlin.math.PI
import kotlin.math.sin

// ======================== РЯДКИ ========================

/** Рядки чату, медіа та дозволів (uk / ru / en). */
object ChatStrings {
    private val dictionary = mapOf(
        "uk" to mapOf(
            "typing" to "пише",
            "today" to "Сьогодні",
            "yesterday" to "Вчора",
            "delete_title" to "Видалити повідомлення?",
            "delete_hint_mine" to "Ви можете видалити його лише в себе або в усіх учасників чату.",
            "delete_hint_other" to "Повідомлення зникне лише у вас. У співрозмовника воно залишиться.",
            "delete_for_all" to "Видалити для всіх",
            "delete_for_me" to "Видалити в мене",
            "cancel" to "Скасувати",
            "attach_media" to "Фото або відео",
            "sending_media" to "Надсилання...",
            "upload_failed" to "Не вдалося завантажити файл. Перевірте інтернет і спробуйте ще раз",
            "media_bad" to "Оберіть фото або відео",
            "media_too_big" to "Файл завеликий (максимум 250 МБ)",
            "save_to_gallery" to "Зберегти в галерею",
            "save" to "Зберегти",
            "saved" to "Збережено",
            "save_failed" to "Не вдалося зберегти файл",
            "permission_denied" to "Немає дозволу на збереження в галерею",
            "ok" to "OK",
            "copy_text" to "Копіювати",
            "photo" to "Фото",
            "video" to "Відео",
            "grant_media" to "Дозволити фото і відео",
            "media_granted" to "Фото і відео дозволено ✓",
            "grant_all_three" to "Будь ласка, надайте всі три дозволи!"
        ),
        "ru" to mapOf(
            "typing" to "печатает",
            "today" to "Сегодня",
            "yesterday" to "Вчера",
            "delete_title" to "Удалить сообщение?",
            "delete_hint_mine" to "Вы можете удалить его только у себя или у всех участников чата.",
            "delete_hint_other" to "Сообщение исчезнет только у вас. У собеседника оно останется.",
            "delete_for_all" to "Удалить для всех",
            "delete_for_me" to "Удалить у меня",
            "cancel" to "Отмена",
            "attach_media" to "Фото или видео",
            "sending_media" to "Отправка...",
            "upload_failed" to "Не удалось загрузить файл. Проверьте интернет и попробуйте ещё раз",
            "media_bad" to "Выберите фото или видео",
            "media_too_big" to "Файл слишком большой (максимум 250 МБ)",
            "save_to_gallery" to "Сохранить в галерею",
            "save" to "Сохранить",
            "saved" to "Сохранено",
            "save_failed" to "Не удалось сохранить файл",
            "permission_denied" to "Нет разрешения на сохранение в галерею",
            "ok" to "OK",
            "copy_text" to "Копировать",
            "photo" to "Фото",
            "video" to "Видео",
            "grant_media" to "Разрешить фото и видео",
            "media_granted" to "Фото и видео разрешено ✓",
            "grant_all_three" to "Пожалуйста, дайте все три разрешения!"
        ),
        "en" to mapOf(
            "typing" to "typing",
            "today" to "Today",
            "yesterday" to "Yesterday",
            "delete_title" to "Delete message?",
            "delete_hint_mine" to "You can delete it just for yourself or for everyone in the chat.",
            "delete_hint_other" to "The message will disappear only for you. The other person will still see it.",
            "delete_for_all" to "Delete for everyone",
            "delete_for_me" to "Delete for me",
            "cancel" to "Cancel",
            "attach_media" to "Photo or video",
            "sending_media" to "Sending...",
            "upload_failed" to "Could not upload the file. Check your connection and try again",
            "media_bad" to "Choose a photo or a video",
            "media_too_big" to "The file is too large (250 MB max)",
            "save_to_gallery" to "Save to gallery",
            "save" to "Save",
            "saved" to "Saved",
            "save_failed" to "Could not save the file",
            "permission_denied" to "No permission to save to the gallery",
            "ok" to "OK",
            "copy_text" to "Copy",
            "photo" to "Photo",
            "video" to "Video",
            "grant_media" to "Allow photos and videos",
            "media_granted" to "Photos and videos allowed ✓",
            "grant_all_three" to "Please grant all three permissions!"
        )
    )

    fun get(key: String, lang: String): String {
        return dictionary[lang]?.get(key) ?: dictionary["uk"]?.get(key) ?: key
    }
}

// ======================== ДАТА І ЧАС ========================

fun formatMessageTime(timestamp: Long): String =
    SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(timestamp))

private fun dayStart(timestamp: Long): Long {
    val cal = Calendar.getInstance()
    cal.timeInMillis = timestamp
    cal.set(Calendar.HOUR_OF_DAY, 0)
    cal.set(Calendar.MINUTE, 0)
    cal.set(Calendar.SECOND, 0)
    cal.set(Calendar.MILLISECOND, 0)
    return cal.timeInMillis
}

fun isSameDay(a: Long, b: Long): Boolean = dayStart(a) == dayStart(b)

fun dayLabel(timestamp: Long, lang: String): String {
    val today = dayStart(System.currentTimeMillis())
    val day = dayStart(timestamp)
    val oneDay = 24L * 60L * 60L * 1000L
    return when {
        day == today -> ChatStrings.get("today", lang)
        day == today - oneDay -> ChatStrings.get("yesterday", lang)
        else -> SimpleDateFormat("d MMMM yyyy", Locale(lang)).format(Date(timestamp))
    }
}

// ======================== ДОЗВІЛ "ФОТО І ВІДЕО" ========================

fun mediaPermissionsToRequest(): Array<String> = when {
    Build.VERSION.SDK_INT >= 34 -> arrayOf(
        Manifest.permission.READ_MEDIA_IMAGES,
        Manifest.permission.READ_MEDIA_VIDEO,
        Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED
    )
    Build.VERSION.SDK_INT >= 33 -> arrayOf(
        Manifest.permission.READ_MEDIA_IMAGES,
        Manifest.permission.READ_MEDIA_VIDEO
    )
    else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
}

fun hasMediaPermission(context: Context): Boolean {
    fun granted(permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    return when {
        // Android 14: часткового доступу ("лише обрані фото") достатньо
        Build.VERSION.SDK_INT >= 34 ->
            (granted(Manifest.permission.READ_MEDIA_IMAGES) && granted(Manifest.permission.READ_MEDIA_VIDEO)) ||
                granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
        Build.VERSION.SDK_INT >= 33 ->
            granted(Manifest.permission.READ_MEDIA_IMAGES) && granted(Manifest.permission.READ_MEDIA_VIDEO)
        else -> granted(Manifest.permission.READ_EXTERNAL_STORAGE)
    }
}

// ======================== ІНДИКАТОР "ПИШЕ..." ========================

/** true, поки співрозмовник пише (оновлюється автоматично). */
@Composable
fun isUserTyping(email: String): Boolean {
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1000)
            now = System.currentTimeMillis()
        }
    }
    val until = TypingState.until[email.trim().lowercase()] ?: 0L
    return until > now
}

/** Текст "пише" + стрибучі крапки + слайдер, що біжить під написом. */
@Composable
fun TypingIndicator(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = ViberPurple,
    fontSize: TextUnit = 12.sp,
    showSlider: Boolean = true
) {
    val transition = rememberInfiniteTransition()
    val phase by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(animation = tween(1200, easing = LinearEasing))
    )
    val slide by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(animation = tween(900, easing = LinearEasing), repeatMode = RepeatMode.Reverse)
    )

    Column(modifier = modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text,
                color = color,
                fontSize = fontSize,
                fontWeight = FontWeight.SemiBold,
                fontStyle = FontStyle.Italic
            )
            Spacer(modifier = Modifier.width(4.dp))
            for (i in 0..2) {
                val wave = (sin((phase - i * 0.18f) * 2f * PI.toFloat()) + 1f) / 2f
                Box(
                    modifier = Modifier
                        .padding(horizontal = 1.5.dp)
                        .size(4.dp)
                        .graphicsLayer {
                            val scale = 0.6f + 0.7f * wave
                            scaleX = scale
                            scaleY = scale
                            alpha = 0.35f + 0.65f * wave
                        }
                        .background(color, CircleShape)
                )
            }
        }
        if (showSlider) {
            Spacer(modifier = Modifier.height(2.dp))
            Box(
                modifier = Modifier
                    .width(40.dp)
                    .height(3.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(color.copy(alpha = 0.18f))
            ) {
                Box(
                    modifier = Modifier
                        .offset(x = (26.dp * slide))
                        .width(14.dp)
                        .height(3.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(color)
                )
            }
        }
    }
}

// ======================== БУЛЬБАШКИ ========================

@Composable
fun DateChip(label: String) {
    Box(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
        Surface(shape = RoundedCornerShape(12.dp), color = ViberPurple.copy(alpha = 0.10f)) {
            Text(
                label,
                color = ViberPurple,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
            )
        }
    }
}

/** Бульбашка повідомлення: градієнт для своїх, біла для чужих, час у правому нижньому куті. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun KishkaBubble(
    isMe: Boolean,
    time: String,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit
) {
    val shape = if (isMe) {
        RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomStart = 18.dp, bottomEnd = 5.dp)
    } else {
        RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomStart = 5.dp, bottomEnd = 18.dp)
    }
    val bubbleBackground = if (isMe) {
        Modifier.background(Brush.linearGradient(listOf(Color(0xFF7A3FF0), Color(0xFF5A27CC))), shape)
    } else {
        Modifier.shadow(1.dp, shape).background(Color.White, shape)
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 2.dp),
        contentAlignment = if (isMe) Alignment.CenterEnd else Alignment.CenterStart
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 300.dp)
                .then(bubbleBackground)
                .combinedClickable(onClick = {}, onLongClick = onLongClick)
                .padding(horizontal = 4.dp, vertical = 4.dp)
        ) {
            content()
            Text(
                time,
                fontSize = 10.sp,
                color = if (isMe) Color.White.copy(alpha = 0.7f) else Color.Gray,
                modifier = Modifier.align(Alignment.End).padding(end = 8.dp, bottom = 2.dp)
            )
        }
    }
}

/** Фото або відео всередині бульбашки. Тап відкриває перегляд. */
@Composable
fun MessageMedia(url: String, type: String?, thumbUrl: String?, onOpen: () -> Unit) {
    if (type == "video") {
        Box(
            modifier = Modifier
                .padding(4.dp)
                .width(240.dp)
                .height(170.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(Color(0xFF1B1530))
                .clickable { onOpen() },
            contentAlignment = Alignment.Center
        ) {
            if (!thumbUrl.isNullOrEmpty()) {
                AsyncImage(
                    model = thumbUrl,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
            }
            Box(
                modifier = Modifier.size(54.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.55f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Default.PlayArrow, contentDescription = null, tint = Color.White, modifier = Modifier.size(34.dp))
            }
        }
    } else {
        AsyncImage(
            model = url,
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .padding(4.dp)
                .width(240.dp)
                .heightIn(min = 140.dp, max = 320.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(ViberLightPurple)
                .clickable { onOpen() }
        )
    }
}

// ======================== ЗБЕРЕЖЕННЯ В ГАЛЕРЕЮ ========================

class GallerySaverState(private val context: Context) {
    var showSaved by mutableStateOf(false)
    var saving by mutableStateOf(false)
    var lang: String = "uk"
    internal var pendingUrl: String? = null
    internal var launchPermission: (() -> Unit)? = null

    fun save(url: String) {
        if (saving) return
        val needsPermission = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
        if (needsPermission && launchPermission != null) {
            pendingUrl = url
            launchPermission?.invoke()
        } else {
            doSave(url)
        }
    }

    internal fun doSave(url: String) {
        saving = true
        MediaUtils.saveToGallery(context, url) { ok ->
            saving = false
            if (ok) {
                showSaved = true
            } else {
                Toast.makeText(context, ChatStrings.get("save_failed", lang), Toast.LENGTH_LONG).show()
            }
        }
    }
}

@Composable
fun rememberGallerySaver(lang: String): GallerySaverState {
    val context = LocalContext.current
    val state = remember { GallerySaverState(context) }
    state.lang = lang
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val url = state.pendingUrl
        state.pendingUrl = null
        if (granted && url != null) {
            state.doSave(url)
        } else {
            Toast.makeText(context, ChatStrings.get("permission_denied", state.lang), Toast.LENGTH_LONG).show()
        }
    }
    state.launchPermission = { launcher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE) }
    return state
}

/** Вікно "Збережено" (заокруглений квадрат і кнопка OK). Викликати один раз на екрані. */
@Composable
fun GallerySavedDialog(state: GallerySaverState) {
    if (!state.showSaved) return
    Dialog(onDismissRequest = { state.showSaved = false }) {
        Surface(shape = RoundedCornerShape(24.dp), color = Color.White, shadowElevation = 8.dp) {
            Column(
                modifier = Modifier.padding(24.dp).widthIn(min = 240.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Box(
                    modifier = Modifier.size(56.dp).clip(CircleShape).background(ViberLightPurple),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Default.CheckCircle, contentDescription = null, tint = ViberPurple, modifier = Modifier.size(36.dp))
                }
                Spacer(modifier = Modifier.height(14.dp))
                Text(ChatStrings.get("saved", state.lang), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.Black)
                Spacer(modifier = Modifier.height(20.dp))
                Button(
                    onClick = { state.showSaved = false },
                    modifier = Modifier.fillMaxWidth().height(46.dp),
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = ViberPurple)
                ) {
                    Text(ChatStrings.get("ok", state.lang), fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

// ======================== ПЕРЕГЛЯД ФОТО / ВІДЕО ========================

@Composable
fun MediaViewerDialog(
    url: String,
    type: String?,
    saver: GallerySaverState,
    onDismiss: () -> Unit
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
            if (type == "video") {
                val holder = remember { arrayOfNulls<VideoView>(1) }
                DisposableEffect(Unit) {
                    onDispose {
                        try {
                            holder[0]?.stopPlayback()
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }
                    }
                }
                AndroidView(
                    factory = { ctx ->
                        val videoView = VideoView(ctx)
                        holder[0] = videoView
                        val controller = MediaController(ctx)
                        controller.setAnchorView(videoView)
                        videoView.setMediaController(controller)
                        videoView.setVideoURI(Uri.parse(url))
                        videoView.setOnPreparedListener { player -> player.start() }
                        videoView
                    },
                    modifier = Modifier.align(Alignment.Center).fillMaxWidth()
                )
            } else {
                AsyncImage(
                    model = url,
                    contentDescription = null,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize()
                )
            }

            Row(modifier = Modifier.align(Alignment.TopEnd).padding(12.dp)) {
                IconButton(
                    onClick = { saver.save(url) },
                    enabled = !saver.saving,
                    modifier = Modifier.clip(CircleShape).background(Color.Black.copy(alpha = 0.45f))
                ) {
                    Icon(Icons.Default.SaveAlt, contentDescription = ChatStrings.get("save", saver.lang), tint = Color.White)
                }
                Spacer(modifier = Modifier.width(10.dp))
                IconButton(
                    onClick = onDismiss,
                    modifier = Modifier.clip(CircleShape).background(Color.Black.copy(alpha = 0.45f))
                ) {
                    Icon(Icons.Default.Close, contentDescription = null, tint = Color.White)
                }
            }
        }
    }
}

// ======================== ОБРАНИЙ ФАЙЛ ПЕРЕД ВІДПРАВКОЮ ========================

@Composable
fun PendingMediaChip(
    media: PendingMedia,
    progress: Float?,
    lang: String,
    onRemove: () -> Unit
) {
    val context = LocalContext.current
    val videoThumb by produceState<Bitmap?>(initialValue = null, media.uri) {
        value = if (media.type == "video") {
            withContext(Dispatchers.IO) { MediaUtils.videoThumbnail(context, media.uri) }
        } else {
            null
        }
    }

    Surface(
        shape = RoundedCornerShape(16.dp),
        color = Color.White,
        shadowElevation = 2.dp,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)
    ) {
        Column {
            Row(modifier = Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier.size(56.dp).clip(RoundedCornerShape(12.dp)).background(ViberLightPurple),
                    contentAlignment = Alignment.Center
                ) {
                    if (media.type == "video") {
                        val bitmap = videoThumb
                        if (bitmap != null) {
                            Image(
                                bitmap = bitmap.asImageBitmap(),
                                contentDescription = null,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.fillMaxSize()
                            )
                        }
                        Icon(Icons.Default.PlayArrow, contentDescription = null, tint = Color.White, modifier = Modifier.size(26.dp))
                    } else {
                        AsyncImage(
                            model = media.uri,
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize()
                        )
                    }
                }
                Spacer(modifier = Modifier.width(10.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        media.name,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    val label = ChatStrings.get(if (media.type == "video") "video" else "photo", lang)
                    val size = MediaUtils.formatSize(media.size)
                    Text(
                        if (progress != null) "${ChatStrings.get("sending_media", lang)} ${(progress * 100).toInt()}%"
                        else if (size.isNotEmpty()) "$label • $size" else label,
                        fontSize = 12.sp,
                        color = Color.Gray
                    )
                }
                IconButton(onClick = onRemove) {
                    Icon(Icons.Default.Close, contentDescription = null, tint = Color.Gray)
                }
            }
            if (progress != null) {
                LinearProgressIndicator(
                    progress = progress,
                    modifier = Modifier.fillMaxWidth().height(3.dp),
                    color = ViberPurple,
                    trackColor = ViberLightPurple
                )
            }
        }
    }
}

// ======================== РЯДОК ВВОДУ ========================

/** Рядок вводу: [leading] [скріпка + поле] [відправити / стоп]. */
@Composable
fun KishkaInputBar(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    canSend: Boolean,
    busy: Boolean,
    stopArmed: Boolean,
    onSend: () -> Unit,
    onStop: () -> Unit,
    onAttach: (() -> Unit)?,
    modifier: Modifier = Modifier,
    leading: (@Composable () -> Unit)? = null,
    maxLines: Int = 5
) {
    Row(
        modifier = modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.Bottom
    ) {
        if (leading != null) {
            Box(modifier = Modifier.padding(bottom = 4.dp)) { leading() }
            Spacer(modifier = Modifier.width(6.dp))
        }

        Surface(
            shape = RoundedCornerShape(26.dp),
            color = Color.White,
            shadowElevation = 1.dp,
            modifier = Modifier.weight(1f)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (onAttach != null) {
                    IconButton(onClick = onAttach, enabled = !busy) {
                        Icon(
                            Icons.Default.AttachFile,
                            contentDescription = null,
                            tint = if (busy) Color.LightGray else ViberPurple
                        )
                    }
                }
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    textStyle = TextStyle(fontSize = 15.sp, color = Color.Black),
                    cursorBrush = SolidColor(ViberPurple),
                    maxLines = maxLines,
                    modifier = Modifier
                        .weight(1f)
                        .padding(start = if (onAttach == null) 16.dp else 0.dp, end = 14.dp),
                    decorationBox = { innerTextField ->
                        Box(modifier = Modifier.padding(vertical = 13.dp), contentAlignment = Alignment.CenterStart) {
                            if (value.isEmpty()) {
                                Text(placeholder, color = Color.Gray, fontSize = 15.sp, maxLines = 1)
                            }
                            innerTextField()
                        }
                    }
                )
            }
        }

        Spacer(modifier = Modifier.width(8.dp))

        val buttonColor = when {
            busy && stopArmed -> Color(0xFFD93025)
            busy -> ViberLightPurple
            canSend -> ViberPurple
            else -> Color(0xFFD7D2E8)
        }
        Box(
            modifier = Modifier
                .padding(bottom = 1.dp)
                .size(48.dp)
                .clip(CircleShape)
                .background(buttonColor)
                .clickable(enabled = busy || canSend) { if (busy) onStop() else onSend() },
            contentAlignment = Alignment.Center
        ) {
            if (busy) {
                // Квадратик "стоп": натиснути 2 рази
                Box(
                    modifier = Modifier
                        .size(16.dp)
                        .clip(RoundedCornerShape(3.dp))
                        .background(if (stopArmed) Color.White else ViberPurple)
                )
            } else {
                Icon(Icons.Default.Send, contentDescription = null, tint = Color.White, modifier = Modifier.size(22.dp))
            }
        }
    }
}
