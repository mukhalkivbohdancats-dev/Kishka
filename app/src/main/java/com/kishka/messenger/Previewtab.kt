package com.kishka.messenger

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Brush
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.SaveAlt
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.delay

object PreviewStrings {
    private val dictionary = mapOf(
        "uk" to mapOf(
            "preview_title" to "AI Preview",
            "preview_subtitle" to "Чат, пошук і безкоштовні зображення",
            "preview_empty" to "Опишіть, що намалювати, або поставте запитання. Я памʼятаю розмову, вмію шукати в інтернеті та створювати зображення безкоштовно.",
            "preview_hint" to "Опишіть зображення або поставте запитання",
            "preview_hint_draw" to "Опишіть, що намалювати",
            "preview_draw" to "Малювати",
            "preview_thinking" to "Думаю",
            "preview_generating" to "Створюю зображення",
            "preview_cleared" to "Памʼять AI Preview очищено",
            "preview_clear_confirm" to "Видалити всю розмову та памʼять AI Preview?",
            "preview_stop_hint" to "Натисніть ■ ще раз, щоб зупинити"
        ),
        "ru" to mapOf(
            "preview_title" to "AI Preview",
            "preview_subtitle" to "Чат, поиск и бесплатные изображения",
            "preview_empty" to "Опишите, что нарисовать, или задайте вопрос. Я помню разговор, умею искать в интернете и создавать изображения бесплатно.",
            "preview_hint" to "Опишите изображение или задайте вопрос",
            "preview_hint_draw" to "Опишите, что нарисовать",
            "preview_draw" to "Рисовать",
            "preview_thinking" to "Думаю",
            "preview_generating" to "Создаю изображение",
            "preview_cleared" to "Память AI Preview очищена",
            "preview_clear_confirm" to "Удалить весь разговор и память AI Preview?",
            "preview_stop_hint" to "Нажмите ■ ещё раз, чтобы остановить"
        ),
        "en" to mapOf(
            "preview_title" to "AI Preview",
            "preview_subtitle" to "Chat, search and free images",
            "preview_empty" to "Describe what to draw or ask a question. I remember the conversation, can search the web and create images for free.",
            "preview_hint" to "Describe an image or ask a question",
            "preview_hint_draw" to "Describe what to draw",
            "preview_draw" to "Draw",
            "preview_thinking" to "Thinking",
            "preview_generating" to "Creating the image",
            "preview_cleared" to "AI Preview memory cleared",
            "preview_clear_confirm" to "Delete the whole conversation and AI Preview memory?",
            "preview_stop_hint" to "Tap ■ again to stop"
        )
    )

    fun get(key: String, lang: String): String =
        dictionary[lang]?.get(key) ?: dictionary["uk"]?.get(key) ?: key
}

/**
 * Зображення з напівпрозорим логотипом у правому нижньому куті.
 * Логотип лежить у res/drawable-nodpi/logo_watermark.png. Під час збереження в галерею він вшивається в файл.
 */
@Composable
fun WatermarkedImage(url: String, modifier: Modifier = Modifier) {
    var ratio by remember(url) { mutableStateOf(1f) }
    Box(modifier = modifier.aspectRatio(ratio)) {
        AsyncImage(
            model = url,
            contentDescription = null,
            contentScale = ContentScale.FillBounds,
            modifier = Modifier.fillMaxSize(),
            onSuccess = { state ->
                val d = state.result.drawable
                if (d.intrinsicWidth > 0 && d.intrinsicHeight > 0) {
                    ratio = d.intrinsicWidth.toFloat() / d.intrinsicHeight.toFloat()
                }
            }
        )
        androidx.compose.foundation.Image(
            painter = painterResource(R.drawable.logo_watermark),
            contentDescription = null,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(6.dp)
                .fillMaxWidth(0.14f)
                .aspectRatio(1f)
                .alpha(0.5f)
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PreviewTab(
    currentEmail: String,
    displayName: String,
    lang: String
) {
    val context = LocalContext.current
    val session = remember(currentEmail) { PreviewSessions.get(context, currentEmail) }
    session.lang = lang

    val saver = rememberGallerySaver(lang)
    val listState = rememberLazyListState()
    val ps: (String) -> String = { key -> PreviewStrings.get(key, lang) }
    val gs: (String) -> String = { key -> GeminiStrings.get(key, lang) }

    var showClearDialog by remember { mutableStateOf(false) }
    var viewerUrl by remember { mutableStateOf<String?>(null) }
    var menuMessage by remember { mutableStateOf<GeminiMessage?>(null) }
    var now by remember { mutableStateOf(System.currentTimeMillis()) }

    val messages = session.messages

    LaunchedEffect(session) { session.onTabShown() }

    LaunchedEffect(session.isSending) {
        while (session.isSending) {
            now = System.currentTimeMillis()
            delay(500)
        }
    }
    val elapsedSeconds = ((now - session.sendStartedAt) / 1000L).toInt().coerceAtLeast(0)

    val totalItems = messages.size + if (session.isSending) 1 else 0
    LaunchedEffect(totalItems) {
        if (totalItems > 0) listState.animateScrollToItem(totalItems - 1)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.White),
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        PreviewAvatar(size = 38)
                        Spacer(modifier = Modifier.width(10.dp))
                        Column {
                            Text(ps("preview_title"), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = ViberPurple)
                            Text(
                                if (session.isSending) {
                                    ps(if (session.drawMode) "preview_generating" else "preview_thinking") + "…"
                                } else {
                                    ps("preview_subtitle")
                                },
                                fontSize = 11.sp,
                                color = if (session.isSending) ViberPurple else Color.Gray,
                                maxLines = 1
                            )
                        }
                    }
                },
                actions = {
                    val canClear = messages.isNotEmpty() && !session.isSending
                    IconButton(onClick = { showClearDialog = true }, enabled = canClear) {
                        Icon(
                            Icons.Default.Delete,
                            contentDescription = null,
                            tint = if (canClear) ViberPurple else Color.LightGray
                        )
                    }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {

            if (session.isLoadingHistory) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = ViberPurple, trackColor = ViberLightPurple)
            }

            if (messages.isEmpty() && !session.isSending) {
                Box(
                    modifier = Modifier.weight(1f).fillMaxWidth().padding(32.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        PreviewAvatar(size = 84)
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(ps("preview_title"), fontSize = 22.sp, fontWeight = FontWeight.Bold, color = ViberPurple)
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(ps("preview_empty"), fontSize = 14.sp, color = Color.Gray, textAlign = TextAlign.Center)
                    }
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.weight(1f).padding(horizontal = 8.dp)
                ) {
                    itemsIndexed(messages, key = { index, msg -> "${msg.id}_$index" }) { index, msg ->
                        val isMe = msg.role == "user"
                        Column {
                            if (index == 0 || !isSameDay(messages[index - 1].timestamp, msg.timestamp)) {
                                DateChip(dayLabel(msg.timestamp, lang))
                            }
                            Box {
                                KishkaBubble(
                                    isMe = isMe,
                                    time = formatMessageTime(msg.timestamp),
                                    onLongClick = { menuMessage = msg }
                                ) {
                                    val imageUrl = msg.imageUrl
                                    if (imageUrl != null) {
                                        WatermarkedImage(
                                            url = imageUrl,
                                            modifier = Modifier
                                                .padding(4.dp)
                                                .width(260.dp)
                                                .clip(RoundedCornerShape(14.dp))
                                                .clickable { viewerUrl = imageUrl }
                                        )
                                        TextButton(
                                            onClick = { saver.save(imageUrl, watermark = true) },
                                            enabled = !saver.saving,
                                            colors = ButtonDefaults.textButtonColors(contentColor = ViberPurple),
                                            modifier = Modifier.padding(horizontal = 2.dp)
                                        ) {
                                            Icon(Icons.Default.SaveAlt, contentDescription = null, modifier = Modifier.size(18.dp))
                                            Spacer(modifier = Modifier.width(6.dp))
                                            Text(ChatStrings.get("save", lang), fontSize = 13.sp)
                                        }
                                    }
                                    if (msg.text.isNotBlank()) {
                                        Text(
                                            text = if (isMe) AnnotatedString(msg.text) else formatGeminiText(msg.text),
                                            color = if (isMe) Color.White else Color.Black,
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                        )
                                    }
                                }

                                DropdownMenu(
                                    expanded = menuMessage?.id == msg.id && menuMessage?.timestamp == msg.timestamp,
                                    onDismissRequest = { menuMessage = null }
                                ) {
                                    if (msg.text.isNotBlank()) {
                                        DropdownMenuItem(
                                            text = { Text(ChatStrings.get("copy_text", lang)) },
                                            onClick = {
                                                menuMessage = null
                                                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                                clipboard.setPrimaryClip(ClipData.newPlainText("text", msg.text))
                                                Notice.show(Strings.get("message_copied", lang))
                                            }
                                        )
                                    }
                                    val menuImage = msg.imageUrl
                                    if (menuImage != null) {
                                        DropdownMenuItem(
                                            text = { Text(ChatStrings.get("save", lang)) },
                                            onClick = {
                                                menuMessage = null
                                                saver.save(menuImage, watermark = true)
                                            }
                                        )
                                    }
                                }
                            }
                        }
                    }

                    if (session.isSending) {
                        item {
                            Box(modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp)) {
                                Surface(
                                    color = Color.White,
                                    shape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomStart = 5.dp, bottomEnd = 18.dp),
                                    shadowElevation = 1.dp
                                ) {
                                    Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            CircularProgressIndicator(color = ViberPurple, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
                                            Spacer(modifier = Modifier.width(10.dp))
                                            Text(
                                                "${ps(if (session.drawMode) "preview_generating" else "preview_thinking")}… " +
                                                    formatElapsed(elapsedSeconds, gs("sec_short"), gs("min_short")),
                                                color = Color.Gray,
                                                fontSize = 14.sp
                                            )
                                        }
                                        if (session.stopArmed) {
                                            Spacer(modifier = Modifier.height(6.dp))
                                            Text(ps("preview_stop_hint"), color = Color(0xFFD93025), fontSize = 12.sp)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Рядок вводу: [Малювати] [поле] [відправити / стоп]
            KishkaInputBar(
                value = session.draft,
                onValueChange = { session.draft = it },
                placeholder = ps(if (session.drawMode) "preview_hint_draw" else "preview_hint"),
                canSend = session.draft.isNotBlank(),
                busy = session.isSending,
                stopArmed = session.stopArmed,
                onSend = { session.send(displayName) },
                onStop = { session.onStopTap() },
                onAttach = null,
                leading = {
                    DrawToggle(
                        active = session.drawMode,
                        label = ps("preview_draw"),
                        enabled = !session.isSending,
                        onClick = { session.drawMode = !session.drawMode }
                    )
                }
            )
        }
    }

    if (showClearDialog) {
        AlertDialog(
            onDismissRequest = { showClearDialog = false },
            shape = RoundedCornerShape(22.dp),
            containerColor = Color.White,
            title = { Text(ps("preview_title")) },
            text = { Text(ps("preview_clear_confirm")) },
            confirmButton = {
                Button(
                    onClick = {
                        showClearDialog = false
                        session.clearMemory()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color.Red)
                ) {
                    Text(Strings.get("delete", lang))
                }
            },
            dismissButton = {
                TextButton(onClick = { showClearDialog = false }) {
                    Text(Strings.get("cancel", lang))
                }
            }
        )
    }

    val viewing = viewerUrl
    if (viewing != null) {
        MediaViewerDialog(
            url = viewing,
            type = "image",
            saver = saver,
            watermark = true,
            onDismiss = { viewerUrl = null }
        )
    }

    GallerySavedDialog(saver)
}

@Composable
private fun DrawToggle(active: Boolean, label: String, enabled: Boolean, onClick: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(50),
        color = if (active) ViberPurple else ViberLightPurple,
        modifier = Modifier.height(40.dp).clip(RoundedCornerShape(50)).clickable(enabled = enabled) { onClick() }
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            Icon(Icons.Default.Brush, contentDescription = null, tint = if (active) Color.White else ViberPurple, modifier = Modifier.size(18.dp))
            Spacer(modifier = Modifier.width(6.dp))
            Text(label, color = if (active) Color.White else ViberPurple, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}

@Composable
fun PreviewAvatar(size: Int) {
    Box(
        modifier = Modifier.size(size.dp).clip(CircleShape).background(ViberPurple),
        contentAlignment = Alignment.Center
    ) {
        Icon(Icons.Default.AutoAwesome, contentDescription = null, tint = Color.White, modifier = Modifier.size((size * 0.55f).dp))
    }
}
