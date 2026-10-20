package com.kishka.messenger

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.SaveAlt
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
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
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import kotlinx.coroutines.delay

const val GEMINI_LOGO_URL =
    "https://raw.githubusercontent.com/mukhalkivbohdancats-dev/Kishka/main/Assets/Logo.png"

/** Рядки вкладки Gemini (нові ключі; старі gemini_* беруться з Strings у MainActivity.kt). */
private object GeminiStrings {
    private val dictionary = mapOf(
        "uk" to mapOf(
            "gemini_model_choose" to "Обрати модель",
            "gemini_text_models" to "Текстові моделі",
            "gemini_image_models" to "Генерація зображень",
            "gemini_paid" to "Платна",
            "gemini_image_tag" to "Зображення",
            "gemini_thinking_label" to "Gemini думає",
            "gemini_generating_label" to "Gemini створює зображення",
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
            "gemini_thinking_label" to "Gemini думает",
            "gemini_generating_label" to "Gemini создаёт изображение",
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
            "gemini_thinking_label" to "Gemini is thinking",
            "gemini_generating_label" to "Gemini is creating an image",
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
    val gemini = remember { GeminiManager(context) }
    val gs: (String) -> String = { key -> GeminiStrings.get(key, lang) }

    var messages by remember(currentEmail) { mutableStateOf(gemini.getCachedHistory(currentEmail)) }
    var models by remember { mutableStateOf(gemini.getCachedModels()) }
    var selectedModelId by remember(currentEmail) {
        mutableStateOf(gemini.getSelectedModel(currentEmail) ?: "")
    }
    var textInput by remember { mutableStateOf("") }
    var isSending by remember { mutableStateOf(false) }
    var elapsedSeconds by remember { mutableStateOf(0) }
    var stopArmed by remember { mutableStateOf(false) }
    var currentCall by remember { mutableStateOf<GeminiCall?>(null) }
    var isLoadingHistory by remember { mutableStateOf(true) }
    var selectedMessageForMenu by remember { mutableStateOf<GeminiMessage?>(null) }
    var showClearDialog by remember { mutableStateOf(false) }
    var showModelPopup by remember { mutableStateOf(false) }
    var fullImageUrl by remember { mutableStateOf<String?>(null) }
    var isSavingImage by remember { mutableStateOf(false) }
    var showSavedDialog by remember { mutableStateOf(false) }
    var pendingSaveUrl by remember { mutableStateOf<String?>(null) }
    val listState = rememberLazyListState()

    // Обрана модель: збережена -> gemini-3.8-flash -> перша безкоштовна текстова -> перша зі списку
    val selectedModel: GeminiModel = models.firstOrNull { it.id == selectedModelId }
        ?: models.firstOrNull { it.id == "gemini-3.8-flash" }
        ?: models.firstOrNull { !it.isImage && !it.paid }
        ?: models.first()

    fun labelOf(id: String?): String? =
        if (id == null) null else (models.firstOrNull { it.id == id }?.label ?: id)

    // Список моделей із сервера
    LaunchedEffect(currentEmail) {
        gemini.loadModels { loaded, defaultId ->
            if (loaded != null) {
                models = loaded
                if (loaded.none { it.id == selectedModelId }) {
                    selectedModelId = defaultId ?: loaded.firstOrNull { !it.isImage && !it.paid }?.id ?: loaded.first().id
                }
            }
        }
    }

    // Памʼять Gemini окрема для кожного акаунта: завантажуємо історію саме цього користувача
    LaunchedEffect(currentEmail) {
        isLoadingHistory = true
        gemini.loadHistory(currentEmail) { loaded ->
            isLoadingHistory = false
            if (loaded != null && !isSending) {
                messages = loaded
            }
        }
    }

    // Лічильник секунд, поки Gemini думає
    LaunchedEffect(isSending) {
        if (isSending) {
            elapsedSeconds = 0
            while (true) {
                delay(1000)
                elapsedSeconds += 1
            }
        }
    }

    // Кнопка "стоп" натиснута один раз: чекаємо друге натискання 3 секунди
    LaunchedEffect(stopArmed) {
        if (stopArmed) {
            delay(3000)
            stopArmed = false
        }
    }

    val totalItems = messages.size + if (isSending) 1 else 0

    LaunchedEffect(totalItems) {
        if (totalItems > 0) {
            listState.animateScrollToItem(totalItems - 1)
        }
    }

    // ---------- Збереження зображення в галерею ----------
    fun doSave(url: String) {
        if (isSavingImage) return
        isSavingImage = true
        gemini.saveImageToGallery(url) { ok ->
            isSavingImage = false
            if (ok) {
                showSavedDialog = true
            } else {
                Toast.makeText(context, gs("gemini_save_failed"), Toast.LENGTH_LONG).show()
            }
        }
    }

    val storagePermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val url = pendingSaveUrl
        pendingSaveUrl = null
        if (granted && url != null) {
            doSave(url)
        } else {
            Toast.makeText(context, gs("gemini_permission_denied"), Toast.LENGTH_LONG).show()
        }
    }

    fun requestSave(url: String) {
        val needsPermission = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
        if (needsPermission) {
            pendingSaveUrl = url
            storagePermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        } else {
            doSave(url)
        }
    }

    // ---------- Відправка / зупинка ----------
    val sendAction: () -> Unit = send@{
        val text = textInput.trim()
        if (text.isEmpty() || isSending) return@send

        val localMessage = GeminiMessage(
            id = "local_${System.currentTimeMillis()}",
            role = "user",
            text = text,
            timestamp = System.currentTimeMillis()
        )
        messages = messages + localMessage
        textInput = ""
        isSending = true
        stopArmed = false

        currentCall = gemini.sendMessage(currentEmail, displayName, text, selectedModel.id) { result ->
            isSending = false
            stopArmed = false
            currentCall = null
            if (result.success && result.reply != null) {
                messages = messages + result.reply
                gemini.saveCache(currentEmail, messages)
            } else {
                // Не вдалося або зупинено — прибираємо повідомлення і повертаємо текст у поле вводу
                messages = messages.filterNot { it.id == localMessage.id }
                if (textInput.isEmpty()) textInput = text
                val message = if (result.cancelled) gs("gemini_stopped") else (result.error ?: Strings.get("gemini_error", lang))
                Toast.makeText(context, message, Toast.LENGTH_LONG).show()
            }
        }
    }

    // Зупинка: перше натискання "озброює" кнопку, друге — зупиняє запит
    val stopAction: () -> Unit = {
        if (stopArmed) {
            stopArmed = false
            currentCall?.cancel()
        } else {
            stopArmed = true
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        GeminiAvatar(size = 36.dp)
                        Spacer(modifier = Modifier.width(10.dp))
                        Column {
                            Text(
                                Strings.get("gemini", lang),
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                                color = ViberPurple
                            )
                            Text(
                                Strings.get("gemini_subtitle", lang),
                                fontSize = 11.sp,
                                color = Color.Gray
                            )
                        }
                    }
                },
                actions = {
                    val canClear = messages.isNotEmpty() && !isSending
                    IconButton(
                        onClick = { showClearDialog = true },
                        enabled = canClear
                    ) {
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

            if (isLoadingHistory) {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth(),
                    color = ViberPurple,
                    trackColor = ViberLightPurple
                )
            }

            if (messages.isEmpty() && !isSending) {
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
                    modifier = Modifier.weight(1f).padding(8.dp)
                ) {
                    itemsIndexed(messages, key = { index, msg -> "${msg.id}_$index" }) { _, msg ->
                        val isMe = msg.role == "user"
                        Box(
                            modifier = Modifier.fillMaxWidth(),
                            contentAlignment = if (isMe) Alignment.CenterEnd else Alignment.CenterStart
                        ) {
                            Column(horizontalAlignment = if (isMe) Alignment.End else Alignment.Start) {
                                Surface(
                                    color = if (isMe) ViberPurple else Color.White,
                                    shape = RoundedCornerShape(12.dp),
                                    modifier = Modifier
                                        .padding(4.dp)
                                        .widthIn(max = 320.dp)
                                        .combinedClickable(
                                            onClick = {},
                                            onLongClick = { selectedMessageForMenu = msg }
                                        )
                                ) {
                                    Column {
                                        if (msg.imageUrl != null) {
                                            AsyncImage(
                                                model = msg.imageUrl,
                                                contentDescription = "Gemini image",
                                                contentScale = ContentScale.Fit,
                                                modifier = Modifier
                                                    .padding(6.dp)
                                                    .fillMaxWidth()
                                                    .heightIn(min = 160.dp, max = 360.dp)
                                                    .clip(RoundedCornerShape(8.dp))
                                                    .background(ViberLightPurple)
                                                    .clickable { fullImageUrl = msg.imageUrl }
                                            )
                                            TextButton(
                                                onClick = { requestSave(msg.imageUrl) },
                                                enabled = !isSavingImage,
                                                colors = ButtonDefaults.textButtonColors(contentColor = ViberPurple),
                                                modifier = Modifier.padding(horizontal = 2.dp)
                                            ) {
                                                Icon(Icons.Default.SaveAlt, contentDescription = null, modifier = Modifier.size(18.dp))
                                                Spacer(modifier = Modifier.width(6.dp))
                                                Text(gs("gemini_save"), fontSize = 13.sp)
                                            }
                                        }
                                        if (msg.text.isNotBlank()) {
                                            Text(
                                                text = if (isMe) AnnotatedString(msg.text) else formatGeminiText(msg.text),
                                                color = if (isMe) Color.White else Color.Black,
                                                modifier = Modifier.padding(10.dp)
                                            )
                                        }
                                    }
                                }
                                if (!isMe && msg.model != null) {
                                    Text(
                                        labelOf(msg.model) ?: "",
                                        fontSize = 10.sp,
                                        color = Color.Gray,
                                        modifier = Modifier.padding(start = 8.dp, bottom = 2.dp)
                                    )
                                }
                            }

                            DropdownMenu(
                                expanded = selectedMessageForMenu?.id == msg.id && selectedMessageForMenu?.timestamp == msg.timestamp,
                                onDismissRequest = { selectedMessageForMenu = null }
                            ) {
                                DropdownMenuItem(
                                    text = { Text(Strings.get("copy", lang)) },
                                    onClick = {
                                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                        val toCopy = msg.text.ifBlank { msg.imageUrl ?: "" }
                                        clipboard.setPrimaryClip(ClipData.newPlainText("Copied Text", toCopy))
                                        Toast.makeText(context, Strings.get("message_copied", lang), Toast.LENGTH_SHORT).show()
                                        selectedMessageForMenu = null
                                    }
                                )
                                if (msg.imageUrl != null) {
                                    DropdownMenuItem(
                                        text = { Text(gs("gemini_save_to_gallery")) },
                                        onClick = {
                                            selectedMessageForMenu = null
                                            requestSave(msg.imageUrl)
                                        }
                                    )
                                }
                            }
                        }
                    }

                    if (isSending) {
                        item {
                            Box(
                                modifier = Modifier.fillMaxWidth(),
                                contentAlignment = Alignment.CenterStart
                            ) {
                                Surface(
                                    color = Color.White,
                                    shape = RoundedCornerShape(12.dp),
                                    modifier = Modifier.padding(4.dp)
                                ) {
                                    Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            CircularProgressIndicator(
                                                color = ViberPurple,
                                                strokeWidth = 2.dp,
                                                modifier = Modifier.size(16.dp)
                                            )
                                            Spacer(modifier = Modifier.width(10.dp))
                                            Text(
                                                "${gs(if (selectedModel.isImage) "gemini_generating_label" else "gemini_thinking_label")}… " +
                                                    formatElapsed(elapsedSeconds, gs("sec_short"), gs("min_short")),
                                                color = Color.Gray,
                                                fontSize = 14.sp
                                            )
                                        }
                                        if (stopArmed) {
                                            Spacer(modifier = Modifier.height(6.dp))
                                            Text(
                                                gs("gemini_stop_hint"),
                                                color = Color(0xFFD93025),
                                                fontSize = 12.sp
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // ---------- Рядок вводу: [модель] [поле] [відправити / стоп] ----------
            Row(
                modifier = Modifier.fillMaxWidth().padding(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                GeminiModelPill(
                    selected = selectedModel,
                    models = models,
                    enabled = !isSending,
                    expanded = showModelPopup,
                    lang = lang,
                    onExpandedChange = { showModelPopup = it },
                    onSelect = { m ->
                        selectedModelId = m.id
                        gemini.setSelectedModel(currentEmail, m.id)
                        showModelPopup = false
                    }
                )
                Spacer(modifier = Modifier.width(6.dp))
                OutlinedTextField(
                    value = textInput,
                    onValueChange = { textInput = it },
                    modifier = Modifier.weight(1f),
                    placeholder = {
                        Text(if (selectedModel.isImage) gs("gemini_image_hint") else Strings.get("type_message", lang))
                    },
                    maxLines = 4
                )
                if (isSending) {
                    // Квадратик "стоп": натиснути 2 рази
                    IconButton(onClick = stopAction) {
                        Box(
                            modifier = Modifier
                                .size(38.dp)
                                .clip(CircleShape)
                                .background(if (stopArmed) Color(0xFFD93025) else ViberLightPurple),
                            contentAlignment = Alignment.Center
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(14.dp)
                                    .clip(RoundedCornerShape(3.dp))
                                    .background(if (stopArmed) Color.White else ViberPurple)
                            )
                        }
                    }
                } else {
                    IconButton(
                        onClick = sendAction,
                        enabled = textInput.isNotBlank()
                    ) {
                        Icon(
                            Icons.Default.Send,
                            contentDescription = null,
                            tint = if (textInput.isNotBlank()) ViberPurple else Color.LightGray
                        )
                    }
                }
            }
        }
    }

    // ---------- Очищення памʼяті ----------
    if (showClearDialog) {
        AlertDialog(
            onDismissRequest = { showClearDialog = false },
            title = { Text(Strings.get("gemini_clear", lang)) },
            text = { Text(Strings.get("gemini_clear_confirm", lang)) },
            confirmButton = {
                Button(
                    onClick = {
                        showClearDialog = false
                        gemini.clearMemory(currentEmail) { success ->
                            if (success) {
                                messages = emptyList()
                                Toast.makeText(context, Strings.get("gemini_cleared", lang), Toast.LENGTH_SHORT).show()
                            } else {
                                Toast.makeText(context, Strings.get("gemini_error", lang), Toast.LENGTH_LONG).show()
                            }
                        }
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

    // ---------- Зображення на весь екран зі збереженням ----------
    val fullUrl = fullImageUrl
    if (fullUrl != null) {
        Dialog(onDismissRequest = { fullImageUrl = null }) {
            Surface(
                shape = RoundedCornerShape(22.dp),
                color = Color.White,
                shadowElevation = 8.dp
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    AsyncImage(
                        model = fullUrl,
                        contentDescription = "Gemini image",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 200.dp, max = 480.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .background(ViberLightPurple)
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        TextButton(
                            onClick = { fullImageUrl = null },
                            colors = ButtonDefaults.textButtonColors(contentColor = Color.Gray)
                        ) {
                            Text(gs("gemini_close"))
                        }
                        Button(
                            onClick = { requestSave(fullUrl) },
                            enabled = !isSavingImage,
                            shape = RoundedCornerShape(14.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = ViberPurple)
                        ) {
                            Icon(Icons.Default.SaveAlt, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(gs("gemini_save"))
                        }
                    }
                }
            }
        }
    }

    // ---------- Вікно "Збережено" (квадрат із згладженими кутами + кнопка OK) ----------
    if (showSavedDialog) {
        Dialog(onDismissRequest = { showSavedDialog = false }) {
            Surface(
                shape = RoundedCornerShape(24.dp),
                color = Color.White,
                shadowElevation = 8.dp
            ) {
                Column(
                    modifier = Modifier.padding(24.dp).widthIn(min = 240.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Box(
                        modifier = Modifier.size(56.dp).clip(CircleShape).background(ViberLightPurple),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            Icons.Default.CheckCircle,
                            contentDescription = null,
                            tint = ViberPurple,
                            modifier = Modifier.size(36.dp)
                        )
                    }
                    Spacer(modifier = Modifier.height(14.dp))
                    Text(gs("gemini_saved"), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.Black)
                    Spacer(modifier = Modifier.height(20.dp))
                    Button(
                        onClick = { showSavedDialog = false },
                        modifier = Modifier.fillMaxWidth().height(46.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = ViberPurple)
                    ) {
                        Text(gs("gemini_ok"), fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

private fun formatElapsed(seconds: Int, secLabel: String, minLabel: String): String {
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
                        val textModels = models.filter { !it.isImage }
                        val imageModels = models.filter { it.isImage }

                        if (textModels.isNotEmpty()) {
                            GeminiPopupHeader(GeminiStrings.get("gemini_text_models", lang))
                            textModels.forEach { m ->
                                GeminiModelRow(m, m.id == selected.id, lang) { onSelect(m) }
                            }
                        }
                        if (imageModels.isNotEmpty()) {
                            Spacer(modifier = Modifier.height(4.dp))
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp)
                                    .height(1.dp)
                                    .background(ViberLightPurple)
                            )
                            GeminiPopupHeader(GeminiStrings.get("gemini_image_models", lang))
                            imageModels.forEach { m ->
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
                Text(model.note, fontSize = 11.sp, color = Color.Gray)
            }
            if (model.paid || model.isImage) {
                Spacer(modifier = Modifier.height(3.dp))
                Row {
                    if (model.isImage) {
                        GeminiChip(GeminiStrings.get("gemini_image_tag", lang), ViberLightPurple, ViberPurple)
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
private fun formatGeminiText(raw: String): AnnotatedString {
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
