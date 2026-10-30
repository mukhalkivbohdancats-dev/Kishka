package com.kishka.messenger

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.SaveAlt
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import coil.compose.AsyncImage
import kotlinx.coroutines.delay

const val GEMINI_LOGO_URL =
    "https://raw.githubusercontent.com/mukhalkivbohdancats-dev/Kishka/main/Assets/Logo.png"

/** Рядки вкладки Gemini (нові ключі; старі gemini_* беруться з Strings у MainActivity.kt). */
/** Ключ підпису "Gemini думає / створює ..." залежно від типу моделі. */
fun geminiBusyKey(model: GeminiModel): String = when {
    model.isImage -> "gemini_generating_label"
    model.isAudio -> "gemini_audio_label"
    model.isVideo -> "gemini_video_label"
    model.isAgent -> "gemini_agent_label"
    else -> "gemini_thinking_label"
}

/** Ключ підказки в полі вводу залежно від типу моделі. */
fun geminiHintKey(model: GeminiModel): String? = when {
    model.isImage -> "gemini_image_hint"
    model.isAudio -> "gemini_audio_hint"
    model.isVideo -> "gemini_video_hint"
    model.isAgent -> "gemini_agent_hint"
    else -> null
}

/** Текст підказки про хід відповіді (ліміт Google, зміна моделі). */
fun geminiNoteText(note: GeminiNote, lang: String): String = when (note.kind) {
    "wait" -> String.format(GeminiStrings.get("gemini_note_wait", lang), note.seconds)
    "busy" -> String.format(GeminiStrings.get("gemini_note_busy", lang), note.seconds)
    "switch" -> String.format(GeminiStrings.get("gemini_note_switch", lang), note.model)
    "agent" -> GeminiStrings.get("gemini_note_agent", lang)
    else -> ""
}

object GeminiStrings {
    private val dictionary = mapOf(
        "uk" to mapOf(
            "gemini_model_choose" to "Обрати модель",
            "gemini_text_models" to "Текстові моделі",
            "gemini_image_models" to "Генерація зображень",
            "gemini_paid" to "Платна",
            "gemini_image_tag" to "Зображення",
            "gemini_audio_models" to "Озвучка та музика",
            "gemini_video_models" to "Відео",
            "gemini_agent_models" to "Агенти",
            "gemini_audio_tag" to "Аудіо",
            "gemini_video_tag" to "Відео",
            "gemini_agent_tag" to "Агент",
            "gemini_audio_label" to "Gemini створює аудіо",
            "gemini_video_label" to "Gemini створює відео",
            "gemini_agent_label" to "Gemini досліджує",
            "gemini_audio_hint" to "Введіть текст для озвучки або опис музики...",
            "gemini_video_hint" to "Опишіть відео...",
            "gemini_agent_hint" to "Опишіть завдання для агента...",
            "gemini_note_wait" to "Ліміт Google: чекаю %d с і пробую знову",
            "gemini_note_busy" to "Сервер Google перевантажений: повтор через %d с",
            "gemini_note_switch" to "Перемикаюсь на модель %s",
            "gemini_note_agent" to "Агент працює, це може тривати кілька хвилин",
            "gemini_thinking_label" to "Gemini думає",
            "gemini_generating_label" to "Gemini створює зображення",
            "gemini_upload_label" to "Завантаження файлу",
            "gemini_stop_hint" to "Натисніть ■ ще раз, щоб зупинити",
            "gemini_stopped" to "Запит зупинено",
            "gemini_image_hint" to "Опишіть зображення...",
            "gemini_save" to "Зберегти",
            "gemini_save_to_gallery" to "Зберегти в галерею",
            "gemini_saved" to "Збережено",
            "gemini_save_failed" to "Не вдалося зберегти зображення",
            "gemini_permission_denied" to "Немає дозволу на збереження в галерею",
            "gemini_ok" to "OK",
            "gemini_close" to "Закрити",
            "sec_short" to "с",
            "min_short" to "хв"
        ),
        "ru" to mapOf(
            "gemini_model_choose" to "Выбрать модель",
            "gemini_text_models" to "Текстовые модели",
            "gemini_image_models" to "Генерация изображений",
            "gemini_paid" to "Платная",
            "gemini_image_tag" to "Изображения",
            "gemini_audio_models" to "Озвучка и музыка",
            "gemini_video_models" to "Видео",
            "gemini_agent_models" to "Агенты",
            "gemini_audio_tag" to "Аудио",
            "gemini_video_tag" to "Видео",
            "gemini_agent_tag" to "Агент",
            "gemini_audio_label" to "Gemini создаёт аудио",
            "gemini_video_label" to "Gemini создаёт видео",
            "gemini_agent_label" to "Gemini исследует",
            "gemini_audio_hint" to "Введите текст для озвучки или описание музыки...",
            "gemini_video_hint" to "Опишите видео...",
            "gemini_agent_hint" to "Опишите задание для агента...",
            "gemini_note_wait" to "Лимит Google: жду %d с и пробую снова",
            "gemini_note_busy" to "Сервер Google перегружен: повтор через %d с",
            "gemini_note_switch" to "Переключаюсь на модель %s",
            "gemini_note_agent" to "Агент работает, это может занять несколько минут",
            "gemini_thinking_label" to "Gemini думает",
            "gemini_generating_label" to "Gemini создаёт изображение",
            "gemini_upload_label" to "Загрузка файла",
            "gemini_stop_hint" to "Нажмите ■ ещё раз, чтобы остановить",
            "gemini_stopped" to "Запрос остановлен",
            "gemini_image_hint" to "Опишите изображение...",
            "gemini_save" to "Сохранить",
            "gemini_save_to_gallery" to "Сохранить в галерею",
            "gemini_saved" to "Сохранено",
            "gemini_save_failed" to "Не удалось сохранить изображение",
            "gemini_permission_denied" to "Нет разрешения на сохранение в галерею",
            "gemini_ok" to "OK",
            "gemini_close" to "Закрыть",
            "sec_short" to "с",
            "min_short" to "мин"
        ),
        "en" to mapOf(
            "gemini_model_choose" to "Choose model",
            "gemini_text_models" to "Text models",
            "gemini_image_models" to "Image generation",
            "gemini_paid" to "Paid",
            "gemini_image_tag" to "Image",
            "gemini_audio_models" to "Speech and music",
            "gemini_video_models" to "Video",
            "gemini_agent_models" to "Agents",
            "gemini_audio_tag" to "Audio",
            "gemini_video_tag" to "Video",
            "gemini_agent_tag" to "Agent",
            "gemini_audio_label" to "Gemini is creating audio",
            "gemini_video_label" to "Gemini is creating a video",
            "gemini_agent_label" to "Gemini is researching",
            "gemini_audio_hint" to "Enter text to read aloud or describe the music...",
            "gemini_video_hint" to "Describe the video...",
            "gemini_agent_hint" to "Describe the task for the agent...",
            "gemini_note_wait" to "Google limit: waiting %d s, then retrying",
            "gemini_note_busy" to "Google server is busy: retrying in %d s",
            "gemini_note_switch" to "Switching to model %s",
            "gemini_note_agent" to "The agent is working, this may take a few minutes",
            "gemini_thinking_label" to "Gemini is thinking",
            "gemini_generating_label" to "Gemini is creating an image",
            "gemini_upload_label" to "Uploading file",
            "gemini_stop_hint" to "Tap ■ again to stop",
            "gemini_stopped" to "Request stopped",
            "gemini_image_hint" to "Describe the image...",
            "gemini_save" to "Save",
            "gemini_save_to_gallery" to "Save to gallery",
            "gemini_saved" to "Saved",
            "gemini_save_failed" to "Could not save the image",
            "gemini_permission_denied" to "No permission to save to the gallery",
            "gemini_ok" to "OK",
            "gemini_close" to "Close",
            "sec_short" to "s",
            "min_short" to "min"
        )
    )

    fun get(key: String, lang: String): String {
        return dictionary[lang]?.get(key)
            ?: dictionary["uk"]?.get(key)
            ?: Strings.get(key, lang)
    }
}


@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun GeminiTab(
    currentEmail: String,
    displayName: String,
    lang: String
) {
    val context = LocalContext.current
    // Увесь стан живе в GeminiSession: він переживає поворот екрана та перехід між вкладками
    val session = remember(currentEmail) { GeminiSessions.get(context, currentEmail) }
    session.lang = lang

    val saver = rememberGallerySaver(lang)
    val listState = rememberLazyListState()
    val gs: (String) -> String = { key -> GeminiStrings.get(key, lang) }

    var showClearDialog by remember { mutableStateOf(false) }
    var showModelPopup by remember { mutableStateOf(false) }
    var viewerMessage by remember { mutableStateOf<GeminiMessage?>(null) }
    var menuMessage by remember { mutableStateOf<GeminiMessage?>(null) }
    var now by remember { mutableStateOf(System.currentTimeMillis()) }

    val messages = session.messages
    val models = session.models
    val selectedModel = session.selectedModel

    fun labelOf(id: String?): String? =
        if (id == null) null else (models.firstOrNull { it.id == id }?.label ?: id)

    LaunchedEffect(session) { session.onTabShown() }

    // Секунди «Gemini думає…» рахуються від часу початку запиту, тому не скидаються при повороті екрана
    LaunchedEffect(session.isSending) {
        while (session.isSending) {
            now = System.currentTimeMillis()
            delay(500)
        }
    }
    val elapsedSeconds = ((now - session.sendStartedAt) / 1000L).toInt().coerceAtLeast(0)

    val totalItems = messages.size + if (session.isSending) 1 else 0
    LaunchedEffect(totalItems) {
        if (totalItems > 0) {
            listState.animateScrollToItem(totalItems - 1)
        }
    }

    val mediaPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            val media = MediaUtils.describe(context, uri)
            when {
                media == null -> Notice.show(ChatStrings.get("media_bad", lang))
                media.size > MediaUtils.MAX_FILE_BYTES ->
                    Notice.show(ChatStrings.get("media_too_big", lang))
                else -> session.pendingMedia = media
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.White),
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        GeminiAvatar(size = 38.dp)
                        Spacer(modifier = Modifier.width(10.dp))
                        Column {
                            Text(
                                Strings.get("gemini", lang),
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                                color = ViberPurple
                            )
                            Text(
                                if (session.isSending) {
                                    gs(geminiBusyKey(selectedModel)) + "…"
                                } else {
                                    Strings.get("gemini_subtitle", lang)
                                },
                                fontSize = 11.sp,
                                color = if (session.isSending) ViberPurple else Color.Gray
                            )
                        }
                    }
                },
                actions = {
                    val canClear = messages.isNotEmpty() && !session.isSending
                    IconButton(onClick = { showClearDialog = true }, enabled = canClear) {
                        Icon(
                            Icons.Default.Delete,
                            contentDescription = Strings.get("gemini_clear", lang),
                            tint = if (canClear) ViberPurple else Color.LightGray
                        )
                    }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {

            if (session.isLoadingHistory) {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth(),
                    color = ViberPurple,
                    trackColor = ViberLightPurple
                )
            }

            if (messages.isEmpty() && !session.isSending) {
                Box(
                    modifier = Modifier.weight(1f).fillMaxWidth().padding(32.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        GeminiAvatar(size = 84.dp)
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            Strings.get("gemini", lang),
                            fontSize = 22.sp,
                            fontWeight = FontWeight.Bold,
                            color = ViberPurple
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            Strings.get("gemini_empty", lang),
                            fontSize = 14.sp,
                            color = Color.Gray,
                            textAlign = TextAlign.Center
                        )
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
                                Column {
                                    KishkaBubble(
                                        isMe = isMe,
                                        time = formatMessageTime(msg.timestamp),
                                        onLongClick = { menuMessage = msg }
                                    ) {
                                        val mediaUrl = msg.imageUrl
                                        if (mediaUrl != null) {
                                            MessageMedia(
                                                url = mediaUrl,
                                                type = msg.fileType ?: "image",
                                                thumbUrl = msg.thumbUrl
                                            ) { viewerMessage = msg }
                                            if (!isMe) {
                                                TextButton(
                                                    onClick = { saver.save(mediaUrl) },
                                                    enabled = !saver.saving,
                                                    colors = ButtonDefaults.textButtonColors(contentColor = ViberPurple),
                                                    modifier = Modifier.padding(horizontal = 2.dp)
                                                ) {
                                                    Icon(Icons.Default.SaveAlt, contentDescription = null, modifier = Modifier.size(18.dp))
                                                    Spacer(modifier = Modifier.width(6.dp))
                                                    Text(ChatStrings.get("save", lang), fontSize = 13.sp)
                                                }
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
                                    if (!isMe && msg.model != null) {
                                        Text(
                                            labelOf(msg.model) ?: "",
                                            fontSize = 10.sp,
                                            color = Color.Gray,
                                            modifier = Modifier.padding(start = 10.dp, bottom = 2.dp)
                                        )
                                    }
                                }

                                DropdownMenu(
                                    expanded = menuMessage?.id == msg.id && menuMessage?.timestamp == msg.timestamp,
                                    onDismissRequest = { menuMessage = null }
                                ) {
                                    if (msg.text.isNotBlank()) {
                                        DropdownMenuItem(
                                            text = { Text(Strings.get("copy", lang)) },
                                            onClick = {
                                                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                                clipboard.setPrimaryClip(ClipData.newPlainText("Copied Text", msg.text))
                                                Notice.show(Strings.get("message_copied", lang))
                                                menuMessage = null
                                            }
                                        )
                                    }
                                    val mediaUrl = msg.imageUrl
                                    if (mediaUrl != null) {
                                        DropdownMenuItem(
                                            text = { Text(ChatStrings.get("save_to_gallery", lang)) },
                                            onClick = {
                                                menuMessage = null
                                                saver.save(mediaUrl)
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
                                            CircularProgressIndicator(
                                                color = ViberPurple,
                                                strokeWidth = 2.dp,
                                                modifier = Modifier.size(16.dp)
                                            )
                                            Spacer(modifier = Modifier.width(10.dp))
                                            val progress = session.uploadProgress
                                            Text(
                                                if (progress != null) {
                                                    "${gs("gemini_upload_label")}… ${(progress * 100).toInt()}%"
                                                } else {
                                                    "${gs(geminiBusyKey(selectedModel))}… " +
                                                        formatElapsed(elapsedSeconds, gs("sec_short"), gs("min_short"))
                                                },
                                                color = Color.Gray,
                                                fontSize = 14.sp
                                            )
                                        }
                                        val progressNote = session.note
                                        if (progressNote != null && session.uploadProgress == null) {
                                            val noteText = geminiNoteText(progressNote, lang)
                                            if (noteText.isNotEmpty()) {
                                                Spacer(modifier = Modifier.height(6.dp))
                                                Text(noteText, color = ViberPurple, fontSize = 12.sp)
                                            }
                                        }
                                        if (session.stopArmed) {
                                            Spacer(modifier = Modifier.height(6.dp))
                                            Text(gs("gemini_stop_hint"), color = Color(0xFFD93025), fontSize = 12.sp)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // ---------- Обраний файл ----------
            val pending = session.pendingMedia
            if (pending != null) {
                PendingMediaChip(
                    media = pending,
                    progress = session.uploadProgress,
                    lang = lang,
                    onRemove = {
                        if (!session.isSending) session.pendingMedia = null
                    }
                )
            }

            // ---------- Рядок вводу: [модель] [скріпка + поле] [відправити / стоп] ----------
            KishkaInputBar(
                value = session.draft,
                onValueChange = { session.draft = it },
                placeholder = geminiHintKey(selectedModel)?.let { gs(it) } ?: Strings.get("type_message", lang),
                canSend = session.draft.isNotBlank() || session.pendingMedia != null,
                busy = session.isSending,
                stopArmed = session.stopArmed,
                onSend = { session.send(displayName) },
                onStop = { session.onStopTap() },
                onAttach = {
                    mediaPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
                },
                leading = {
                    GeminiModelPill(
                        selected = selectedModel,
                        models = models,
                        enabled = !session.isSending,
                        expanded = showModelPopup,
                        lang = lang,
                        onExpandedChange = { showModelPopup = it },
                        onSelect = { m ->
                            session.selectModel(m.id)
                            showModelPopup = false
                        }
                    )
                }
            )
        }
    }

    // ---------- Очищення памʼяті ----------
    if (showClearDialog) {
        AlertDialog(
            onDismissRequest = { showClearDialog = false },
            shape = RoundedCornerShape(22.dp),
            containerColor = Color.White,
            title = { Text(Strings.get("gemini_clear", lang)) },
            text = { Text(Strings.get("gemini_clear_confirm", lang)) },
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

    // ---------- Перегляд фото / відео з кнопкою збереження ----------
    val viewing = viewerMessage
    if (viewing != null && viewing.imageUrl != null) {
        MediaViewerDialog(
            url = viewing.imageUrl,
            type = viewing.fileType ?: "image",
            saver = saver,
            onDismiss = { viewerMessage = null }
        )
    }

    GallerySavedDialog(saver)
}

internal fun formatElapsed(seconds: Int, secLabel: String, minLabel: String): String {
    return if (seconds < 60) {
        "$seconds $secLabel"
    } else {
        "${seconds / 60} $minLabel ${seconds % 60} $secLabel"
    }
}

/** Розташовує список моделей НАД кнопкою моделі (над рядком вводу). */
private class AbovePopupPositionProvider(private val gapPx: Int) : PopupPositionProvider {
    override fun calculatePosition(
        anchorBounds: IntRect,
        windowSize: IntSize,
        layoutDirection: LayoutDirection,
        popupContentSize: IntSize
    ): IntOffset {
        val x = anchorBounds.left.coerceIn(0, maxOf(0, windowSize.width - popupContentSize.width))
        val y = maxOf(0, anchorBounds.top - popupContentSize.height - gapPx)
        return IntOffset(x, y)
    }
}

/** Овальна кнопка з назвою моделі зліва від поля вводу + список моделей, що відкривається вгору. */
@Composable
private fun GeminiModelPill(
    selected: GeminiModel,
    models: List<GeminiModel>,
    enabled: Boolean,
    expanded: Boolean,
    lang: String,
    onExpandedChange: (Boolean) -> Unit,
    onSelect: (GeminiModel) -> Unit
) {
    val gapPx = with(LocalDensity.current) { 8.dp.roundToPx() }

    Box {
        Surface(
            shape = RoundedCornerShape(50),
            color = if (enabled) ViberLightPurple else Color(0xFFF1F1F4),
            border = BorderStroke(1.dp, ViberPurple.copy(alpha = if (enabled) 0.35f else 0.12f)),
            modifier = Modifier.height(40.dp)
        ) {
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .clickable(enabled = enabled) { onExpandedChange(!expanded) }
                    .padding(start = 14.dp, end = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    selected.label,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (enabled) ViberPurple else Color.Gray,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = 110.dp)
                )
                Icon(
                    Icons.Default.ArrowDropDown,
                    contentDescription = GeminiStrings.get("gemini_model_choose", lang),
                    tint = if (enabled) ViberPurple else Color.Gray,
                    modifier = Modifier.size(22.dp)
                )
            }
        }

        if (expanded) {
            Popup(
                popupPositionProvider = AbovePopupPositionProvider(gapPx),
                onDismissRequest = { onExpandedChange(false) },
                properties = PopupProperties(focusable = true)
            ) {
                Surface(
                    shape = RoundedCornerShape(22.dp),
                    color = Color.White,
                    shadowElevation = 10.dp,
                    border = BorderStroke(1.dp, ViberLightPurple),
                    modifier = Modifier.width(300.dp)
                ) {
                    Column(
                        modifier = Modifier
                            .heightIn(max = 420.dp)
                            .verticalScroll(rememberScrollState())
                            .padding(vertical = 8.dp)
                    ) {
                        val groups = listOf(
                            "gemini_text_models" to models.filter { !it.isImage && !it.isAudio && !it.isVideo && !it.isAgent },
                            "gemini_image_models" to models.filter { it.isImage },
                            "gemini_audio_models" to models.filter { it.isAudio },
                            "gemini_video_models" to models.filter { it.isVideo },
                            "gemini_agent_models" to models.filter { it.isAgent }
                        ).filter { it.second.isNotEmpty() }

                        groups.forEachIndexed { index, group ->
                            if (index > 0) {
                                Spacer(modifier = Modifier.height(4.dp))
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 16.dp)
                                        .height(1.dp)
                                        .background(ViberLightPurple)
                                )
                            }
                            GeminiPopupHeader(GeminiStrings.get(group.first, lang))
                            group.second.forEach { m ->
                                GeminiModelRow(m, m.id == selected.id, lang) { onSelect(m) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun GeminiPopupHeader(text: String) {
    Text(
        text,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        color = ViberPurple,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
    )
}

@Composable
private fun GeminiModelRow(model: GeminiModel, selected: Boolean, lang: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (selected) ViberLightPurple else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                model.label,
                fontSize = 14.sp,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                color = if (selected) ViberPurple else Color.Black
            )
            if (model.note.isNotBlank()) {
                Text(AppText.modelNote(model.id, lang, model.note), fontSize = 11.sp, color = Color.Gray)
            }
            val tagKey = when {
                model.isImage -> "gemini_image_tag"
                model.isAudio -> "gemini_audio_tag"
                model.isVideo -> "gemini_video_tag"
                model.isAgent -> "gemini_agent_tag"
                else -> null
            }
            if (model.paid || tagKey != null) {
                Spacer(modifier = Modifier.height(3.dp))
                Row {
                    if (tagKey != null) {
                        GeminiChip(GeminiStrings.get(tagKey, lang), ViberLightPurple, ViberPurple)
                        Spacer(modifier = Modifier.width(4.dp))
                    }
                    if (model.paid) {
                        GeminiChip(GeminiStrings.get("gemini_paid", lang), Color(0xFFFDECEA), Color(0xFFD93025))
                    }
                }
            }
        }
        if (selected) {
            Icon(
                Icons.Default.Check,
                contentDescription = null,
                tint = ViberPurple,
                modifier = Modifier.size(18.dp)
            )
        }
    }
}

@Composable
private fun GeminiChip(text: String, background: Color, foreground: Color) {
    Surface(shape = RoundedCornerShape(50), color = background) {
        Text(
            text,
            fontSize = 10.sp,
            fontWeight = FontWeight.SemiBold,
            color = foreground,
            modifier = Modifier.padding(horizontal = 7.dp, vertical = 1.dp)
        )
    }
}

/** Аватарка Gemini (Assets/Logo.png) у білому колі, як аватарки контактів у Kishka. */
@Composable
fun GeminiAvatar(size: Dp) {
    Box(
        modifier = Modifier
            .size(size)
            .clip(CircleShape)
            .background(Color.White),
        contentAlignment = Alignment.Center
    ) {
        AsyncImage(
            model = GEMINI_LOGO_URL,
            contentDescription = "Gemini",
            modifier = Modifier.size(size * 0.62f)
        )
    }
}

/** Легке форматування відповіді Gemini: **жирний**, `код`, ```блоки```, списки та заголовки. */
internal fun formatGeminiText(raw: String): AnnotatedString {
    val lines = raw.replace("\r\n", "\n").split("\n")
    val headerRegex = Regex("^#{1,6}\\s+(.*)$")
    val bulletRegex = Regex("^(\\s*)[*\\-]\\s+(.*)$")
    var inCodeBlock = false

    return buildAnnotatedString {
        lines.forEachIndexed { index, rawLine ->
            val isFence = rawLine.trimStart().startsWith("```")
            if (isFence) {
                inCodeBlock = !inCodeBlock
            } else {
                if (inCodeBlock) {
                    withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = ViberLightPurple)) {
                        append(rawLine)
                    }
                } else {
                    var line = rawLine
                    var isHeader = false

                    val headerMatch = headerRegex.matchEntire(line)
                    if (headerMatch != null) {
                        line = headerMatch.groupValues[1]
                        isHeader = true
                    }

                    val bulletMatch = bulletRegex.matchEntire(line)
                    if (bulletMatch != null) {
                        line = bulletMatch.groupValues[1] + "• " + bulletMatch.groupValues[2]
                    }

                    if (isHeader) {
                        withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { appendInlineFormatted(line) }
                    } else {
                        appendInlineFormatted(line)
                    }
                }
                if (index < lines.lastIndex) append("\n")
            }
        }
    }
}

private val inlineRegex = Regex("\\*\\*(.+?)\\*\\*|`([^`]+)`")

private fun AnnotatedString.Builder.appendInlineFormatted(text: String) {
    var last = 0
    for (match in inlineRegex.findAll(text)) {
        if (match.range.first > last) append(text.substring(last, match.range.first))
        val bold = match.groups[1]?.value
        val code = match.groups[2]?.value
        if (bold != null) {
            withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(bold) }
        } else if (code != null) {
            withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = ViberLightPurple)) { append(code) }
        }
        last = match.range.last + 1
    }
    if (last < text.length) append(text.substring(last))
}
