package com.kishka.messenger

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.SaveAlt
import androidx.compose.material.icons.filled.Share
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.delay

/**
 * Екран чату з контактом: текст, фото та відео, "пише...", видалення для всіх / в мене, збереження в галерею.
 * (Раніше цей екран жив у MainActivity.kt — тепер він тут; підпис функції не змінився.)
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ChatScreen(
    manager: KishkaManager,
    currentEmail: String,
    targetUser: User,
    lang: String,
    onBack: () -> Unit,
    onStartCall: (String) -> Unit
) {
    var messages by remember { mutableStateOf(listOf<Message>()) }
    var textInput by remember { mutableStateOf("") }
    var menuMessage by remember { mutableStateOf<Message?>(null) }
    var deleteTarget by remember { mutableStateOf<Message?>(null) }
    var viewerMessage by remember { mutableStateOf<Message?>(null) }
    var pendingMedia by remember { mutableStateOf<PendingMedia?>(null) }
    var uploadProgress by remember { mutableStateOf<Float?>(null) }
    var uploadHandle by remember { mutableStateOf<UploadHandle?>(null) }
    var showAttachDialog by remember { mutableStateOf(false) }
    var forwardTarget by remember { mutableStateOf<Message?>(null) }
    var showAvatar by remember { mutableStateOf(false) }

    var htmlViewer by remember { mutableStateOf<Message?>(null) }
    var apkInstall by remember { mutableStateOf<Message?>(null) }

    val listState = rememberLazyListState()
    val context = LocalContext.current
    val saver = rememberGallerySaver(lang)

    // Моделі для підказок після «@» (@gemini ... @модель, @chatgpt ... @модель)
    val geminiManagerForMentions = remember { GeminiManager(context, "gemini") }
    val chatgptManagerForMentions = remember { GeminiManager(context, "chatgpt") }
    var geminiModels by remember { mutableStateOf(geminiManagerForMentions.getCachedModels()) }
    var chatgptModels by remember { mutableStateOf(chatgptManagerForMentions.getCachedModels()) }
    LaunchedEffect(Unit) {
        geminiManagerForMentions.loadModels { loaded, _ -> if (loaded != null) geminiModels = loaded }
        chatgptManagerForMentions.loadModels { loaded, _ -> if (loaded != null) chatgptModels = loaded }
    }
    val chatIdNow = KishkaManager.chatIdFor(currentEmail.trim().lowercase(), targetUser.email)
    val partnerTyping = isUserTyping(targetUser.email)
    LaunchedEffect(targetUser.email) { Presence.request() }
    val myEmail = currentEmail.trim().lowercase()
    val cs: (String) -> String = { key -> ChatStrings.get(key, lang) }

    val mediaPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            val media = MediaUtils.describe(context, uri)
            when {
                media == null -> Toast.makeText(context, cs("media_bad"), Toast.LENGTH_LONG).show()
                media.size > MediaUtils.MAX_FILE_BYTES -> Toast.makeText(context, cs("media_too_big"), Toast.LENGTH_LONG).show()
                else -> pendingMedia = media
            }
        }
    }

    // Будь-який файл (документ, архів тощо)
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            val media = MediaUtils.describeFile(context, uri)
            when {
                media == null -> Toast.makeText(context, cs("media_bad"), Toast.LENGTH_LONG).show()
                media.size > MediaUtils.MAX_FILE_BYTES -> Toast.makeText(context, cs("media_too_big"), Toast.LENGTH_LONG).show()
                else -> pendingMedia = media
            }
        }
    }

    DisposableEffect(targetUser.email) {
        manager.connectAndListenForMessages(currentEmail, targetUser.email) { updatedList ->
            messages = updatedList
        }
        onDispose {
            manager.leaveChatRoom()
        }
    }

    // "пише...": надсилаємо співрозмовнику, поки ми набираємо текст
    LaunchedEffect(textInput) {
        if (textInput.isNotEmpty()) {
            manager.sendTyping(currentEmail, targetUser.email, true)
            delay(3500)
            manager.sendTyping(currentEmail, targetUser.email, false)
        } else {
            manager.sendTyping(currentEmail, targetUser.email, false)
        }
    }
    DisposableEffect(targetUser.email) {
        onDispose { manager.sendTyping(currentEmail, targetUser.email, false) }
    }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1)
        }
    }

    // Файл: HTML і APK відкриваються вбудованими вікнами; решта завантажується з відсотками й відкривається кнопкою «Відкрити»
    fun openOrDownloadFile(msg: Message) {
        val url = msg.fileUrl ?: return
        if (FileKinds.isHtml(msg.fileName)) { htmlViewer = msg; return }
        if (FileKinds.isApk(msg.fileName)) { apkInstall = msg; return }
        if (FileDownloads.isDownloaded(context, url, msg.fileName)) {
            val opened = FileDownloads.open(context, FileDownloads.localFile(context, url, msg.fileName), msg.fileName)
            if (!opened) Toast.makeText(context, XStrings.get("file_no_app", lang), Toast.LENGTH_SHORT).show()
            return
        }
        FileDownloads.start(context, url, msg.fileName) { file ->
            if (file == null) Toast.makeText(context, XStrings.get("file_failed", lang), Toast.LENGTH_SHORT).show()
        }
    }

    fun cancelUpload() {
        uploadHandle?.cancel()
        uploadHandle = null
        uploadProgress = null
    }

    fun sendNow() {
        if (uploadProgress != null) return
        val text = textInput.trim()
        val media = pendingMedia

        if (media == null) {
            if (text.isNotEmpty()) {
                manager.sendMessage(currentEmail, targetUser.email, text)
                // «@gemini питання @модель» / «@chatgpt питання @модель» (будь-який регістр): відповідь прийде в чат
                val mention = AiMention.parse(text) { provider ->
                    (if (provider == "chatgpt") chatgptModels else geminiModels).filter { it.type == "text" }.map { it.id }
                }
                // «@» можна вимкнути адміністратором; також окремо Gemini / ChatGPT
                val mentionAllowed = Access.mention &&
                    (mention == null || (if (mention.provider == "chatgpt") Access.chatgpt else Access.gemini))
                if (mention != null && !mentionAllowed) {
                    Notice.show(String.format(AdminStrings.get("off_text", lang), if (mention.provider == "chatgpt") "ChatGPT" else "Gemini"))
                } else if (mention != null) {
                    manager.sendAiMention(currentEmail, targetUser.email, mention.provider, mention.model, mention.question, lang, "")
                }
                textInput = ""
            }
            return
        }

        uploadProgress = 0f
        uploadHandle = MediaUtils.upload(
            context, media, currentEmail,
            { progress -> uploadProgress = progress }
        ) { uploaded ->
            uploadHandle = null
            uploadProgress = null
            if (uploaded != null) {
                manager.sendMessage(currentEmail, targetUser.email, text, uploaded.url, uploaded.type, uploaded.thumbUrl, uploaded.name)
                pendingMedia = null
                textInput = ""
            } else {
                Toast.makeText(context, cs("upload_failed"), Toast.LENGTH_LONG).show()
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.White),
                navigationIcon = {
                    IconButton(onClick = {
                        manager.leaveChatRoom()
                        onBack()
                    }) {
                        Icon(Icons.Default.Close, contentDescription = null)
                    }
                },
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        // Натиснути на аватарку — відкрити її на весь екран
                        AsyncImage(
                            model = if (targetUser.avatarUrl.isNullOrEmpty()) DEFAULT_AVATAR_URL else targetUser.avatarUrl,
                            contentDescription = "Avatar",
                            modifier = Modifier.size(40.dp).clip(CircleShape).clickable { showAvatar = true }
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                targetUser.name.ifEmpty { targetUser.email },
                                fontSize = 16.sp,
                                lineHeight = 20.sp,
                                fontWeight = FontWeight.Bold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            if (partnerTyping) {
                                // Біля аватарки: "пише" з анімованими крапками та слайдером
                                TypingIndicator(text = cs("typing"), fontSize = 12.sp)
                            } else {
                                // «в мережі» або «був(-ла) в мережі 3 хв тому» / «о 16:56»; поки статусу немає — показуємо email
                                val presenceInfo = PresenceRepo.state[targetUser.email.trim().lowercase()]
                                val presenceNow = rememberPresenceNow()
                                val statusText = PresenceText.status(lang, presenceInfo, presenceNow)
                                if (statusText != null) {
                                    Text(
                                        statusText,
                                        fontSize = 11.sp,
                                        color = if (presenceInfo?.online == true) Color(0xFF2E9E5B) else Color.Gray,
                                        maxLines = 1
                                    )
                                }
                            }
                        }
                    }
                },
                actions = {
                    IconButton(onClick = { onStartCall(targetUser.email) }) {
                        Icon(Icons.Default.Call, contentDescription = null, tint = ViberPurple)
                    }
                }
            )
        }
    ) { padding ->
        if (showAvatar) {
            AvatarViewer(url = targetUser.avatarUrl, name = targetUser.name.ifEmpty { targetUser.email }, onClose = { showAvatar = false })
        }
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp)
            ) {
                itemsIndexed(messages) { index, msg ->
                    val isMe = msg.senderEmail.trim().lowercase() == myEmail
                    val callRecord = parseCallRecord(msg.text)
                    Column {
                        if (index == 0 || !isSameDay(messages[index - 1].timestamp, msg.timestamp)) {
                            DateChip(dayLabel(msg.timestamp, lang))
                        }
                        if (callRecord != null) {
                            CallRecordRow(callRecord, isMe, formatMessageTime(msg.timestamp), lang)
                        } else Box {
                            KishkaBubble(
                                isMe = isMe,
                                time = formatMessageTime(msg.timestamp),
                                onLongClick = { menuMessage = msg },
                                ticks = if (isMe && !msg.pending) (if (msg.seenAt > 0L) 2 else 1) else 0
                            ) {
                                val fileUrl = msg.fileUrl
                                if (fileUrl != null) {
                                    if (msg.fileType == "file") {
                                        val progressNow = FileDownloads.progress[fileUrl]
                                        val isDownloaded = remember(fileUrl, progressNow) { FileDownloads.isDownloaded(context, fileUrl, msg.fileName) }
                                        MessageFile(
                                            name = msg.fileName, isMe = isMe, lang = lang,
                                            downloadProgress = progressNow, downloaded = isDownloaded
                                        ) {
                                            openOrDownloadFile(msg)
                                        }
                                    } else {
                                        MessageMedia(url = fileUrl, type = msg.fileType, thumbUrl = msg.thumbUrl) {
                                            viewerMessage = msg
                                        }
                                    }
                                }
                                if (msg.text.isNotEmpty()) {
                                    if (isAiBotEmail(msg.senderEmail)) {
                                        // Відповідь Gemini / ChatGPT: **жирний**, `код`, списки
                                        Text(
                                            text = formatGeminiText(msg.text),
                                            color = Color.Black,
                                            fontSize = 15.sp,
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                        )
                                    } else {
                                        Text(
                                            text = msg.text,
                                            color = if (isMe) Color.White else Color.Black,
                                            fontSize = 15.sp,
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                        )
                                    }
                                }
                            }

                        }
                    }
                }
            }

            val aiProvider = AiMentionState.active[chatIdNow]
            if (aiProvider != null) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp, color = ViberPurple)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        XStrings.get(if (aiProvider == "chatgpt") "ai_thinking_chatgpt" else "ai_thinking_gemini", lang),
                        color = ViberPurple,
                        fontSize = 12.sp
                    )
                }
            }

            // Підказки після «@»: спершу gemini / chatgpt, потім (після питання) — моделі
            val trailing = AiMention.trailingToken(textInput)
            if (trailing != null && pendingMedia == null) {
                val provider = AiMention.providerBeforeTrailing(textInput)
                val suggestions: List<Pair<String, String>> = if (provider == null) {
                    listOf("gemini" to "Gemini", "chatgpt" to "ChatGPT")
                        .filter { it.first.startsWith(trailing, ignoreCase = true) && !it.first.equals(trailing, ignoreCase = true) }
                } else {
                    (if (provider == "chatgpt") chatgptModels else geminiModels)
                        .filter { it.type == "text" && (trailing.isEmpty() || it.id.contains(trailing, true) || it.label.contains(trailing, true)) }
                        .map { it.id to it.label }
                }
                if (suggestions.isNotEmpty()) {
                    MentionSuggestions(
                        title = XStrings.get(if (provider == null) "mention_providers" else "mention_models", lang),
                        items = suggestions,
                        onPick = { choice -> textInput = AiMention.replaceTrailing(textInput, choice) }
                    )
                }
            }

            val pending = pendingMedia
            if (pending != null) {
                PendingMediaChip(
                    media = pending,
                    progress = uploadProgress,
                    lang = lang,
                    onRemove = {
                        cancelUpload()
                        pendingMedia = null
                    }
                )
            }

            KishkaInputBar(
                value = textInput,
                onValueChange = { textInput = it },
                placeholder = Strings.get("type_message", lang),
                canSend = textInput.isNotBlank() || pendingMedia != null,
                busy = uploadProgress != null,
                stopArmed = false,
                onSend = { sendNow() },
                onStop = { cancelUpload() },
                onAttach = { showAttachDialog = true }
            )
        }
    }

    // ---------- Видалення: для всіх (лише власні повідомлення) або лише в мене ----------
    val toDelete = deleteTarget
    if (toDelete != null) {
        val mine = toDelete.senderEmail.trim().lowercase() == myEmail
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            shape = RoundedCornerShape(22.dp),
            containerColor = Color.White,
            title = { Text(cs("delete_title"), fontWeight = FontWeight.Bold) },
            text = {
                Column {
                    Text(cs(if (mine) "delete_hint_mine" else "delete_hint_other"), color = Color.Gray, fontSize = 14.sp)
                    Spacer(modifier = Modifier.height(16.dp))
                    if (mine) {
                        Button(
                            onClick = {
                                manager.deleteMessage(currentEmail, targetUser.email, toDelete.id, true)
                                deleteTarget = null
                            },
                            modifier = Modifier.fillMaxWidth().height(46.dp),
                            shape = RoundedCornerShape(14.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD93025))
                        ) {
                            Text(cs("delete_for_all"), fontWeight = FontWeight.SemiBold)
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                    }
                    OutlinedButton(
                        onClick = {
                            manager.deleteMessage(currentEmail, targetUser.email, toDelete.id, false)
                            deleteTarget = null
                        },
                        modifier = Modifier.fillMaxWidth().height(46.dp),
                        shape = RoundedCornerShape(14.dp)
                    ) {
                        Text(cs("delete_for_me"), color = ViberPurple, fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    TextButton(onClick = { deleteTarget = null }, modifier = Modifier.fillMaxWidth()) {
                        Text(cs("cancel"), color = Color.Gray)
                    }
                }
            },
            confirmButton = {}
        )
    }

    // ---------- Що надіслати: фото/відео або файл ----------
    if (showAttachDialog) {
        AlertDialog(
            onDismissRequest = { showAttachDialog = false },
            shape = RoundedCornerShape(22.dp),
            containerColor = Color.White,
            title = { Text(cs("attach_choose"), fontWeight = FontWeight.Bold) },
            text = {
                Column {
                    OutlinedButton(
                        onClick = {
                            showAttachDialog = false
                            mediaPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
                        },
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = RoundedCornerShape(14.dp)
                    ) {
                        Text(cs("attach_media"), color = ViberPurple, fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = {
                            showAttachDialog = false
                            filePicker.launch(arrayOf("*/*"))
                        },
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = RoundedCornerShape(14.dp)
                    ) {
                        Text(cs("attach_file"), color = ViberPurple, fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    TextButton(onClick = { showAttachDialog = false }, modifier = Modifier.fillMaxWidth()) {
                        Text(cs("cancel"), color = Color.Gray)
                    }
                }
            },
            confirmButton = {}
        )
    }

    // ---------- Переслати повідомлення іншому контакту ----------
    val forwarding = forwardTarget
    if (forwarding != null) {
        val contacts = remember(currentEmail) {
            manager.cachedContacts(currentEmail).filter { it.email.trim().lowercase() != myEmail }
        }
        AlertDialog(
            onDismissRequest = { forwardTarget = null },
            shape = RoundedCornerShape(22.dp),
            containerColor = Color.White,
            title = { Text(cs("forward_title"), fontWeight = FontWeight.Bold) },
            text = {
                if (contacts.isEmpty()) {
                    Text(cs("forward_none"), color = Color.Gray)
                } else {
                    LazyColumn(modifier = Modifier.heightIn(max = 320.dp)) {
                        itemsIndexed(contacts) { _, contact ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(14.dp))
                                    .clickable {
                                        manager.sendMessage(
                                            currentEmail, contact.email, forwarding.text,
                                            forwarding.fileUrl, forwarding.fileType, forwarding.thumbUrl, forwarding.fileName
                                        )
                                        forwardTarget = null
                                        Toast.makeText(context, cs("forward_sent"), Toast.LENGTH_SHORT).show()
                                    }
                                    .padding(vertical = 8.dp, horizontal = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                AsyncImage(
                                    model = if (contact.avatarUrl.isNullOrEmpty()) DEFAULT_AVATAR_URL else contact.avatarUrl,
                                    contentDescription = null,
                                    modifier = Modifier.size(40.dp).clip(CircleShape)
                                )
                                Spacer(modifier = Modifier.width(12.dp))
                                Text(contact.name.ifEmpty { contact.email }, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { forwardTarget = null }) { Text(cs("cancel")) }
            }
        )
    }

    // ---------- Перегляд фото / відео ----------
    val viewing = viewerMessage
    if (viewing != null && viewing.fileUrl != null) {
        MediaViewerDialog(
            url = viewing.fileUrl,
            type = viewing.fileType,
            saver = saver,
            onDismiss = { viewerMessage = null }
        )
    }

    // ---------- Красиве меню повідомлення (довге натискання) ----------
    val menuMsg = menuMessage
    if (menuMsg != null) {
        val menuFileUrl = menuMsg.fileUrl
        MessageActionsDialog(
            preview = if (menuMsg.text.isNotEmpty()) menuMsg.text else (menuMsg.fileName ?: ""),
            lang = lang,
            onDismiss = { menuMessage = null },
            actions = buildList {
                if (menuMsg.text.isNotEmpty()) {
                    add(MessageAction(Icons.Default.ContentCopy, Strings.get("copy", lang), false) {
                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        clipboard.setPrimaryClip(ClipData.newPlainText("Copied Text", menuMsg.text))
                        Toast.makeText(context, Strings.get("message_copied", lang), Toast.LENGTH_SHORT).show()
                    })
                }
                if (menuFileUrl != null && menuMsg.fileType != "file") {
                    add(MessageAction(Icons.Default.SaveAlt, cs("save_to_gallery"), false) { saver.save(menuFileUrl) })
                }
                if (menuFileUrl != null && menuMsg.fileType == "file") {
                    add(MessageAction(Icons.Default.Download, cs("download"), false) { openOrDownloadFile(menuMsg) })
                }
                add(MessageAction(Icons.Default.Share, cs("forward"), false) { forwardTarget = menuMsg })
                add(MessageAction(Icons.Default.Delete, Strings.get("delete", lang), true) { deleteTarget = menuMsg })
            }
        )
    }

    // ---------- Вбудований переглядач HTML і встановлювач APK ----------
    val html = htmlViewer
    if (html != null && html.fileUrl != null) {
        HtmlViewerDialog(url = html.fileUrl, name = html.fileName, lang = lang, onDismiss = { htmlViewer = null })
    }
    val apk = apkInstall
    if (apk != null && apk.fileUrl != null) {
        ApkInstallDialog(url = apk.fileUrl, name = apk.fileName, lang = lang, onDismiss = { apkInstall = null })
    }

    GallerySavedDialog(saver)
}

class MessageAction(
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val label: String,
    val danger: Boolean,
    val onClick: () -> Unit
)

/** Меню повідомлення: заокруглена картка з коротким переглядом тексту і рядками дій зі значками. */
@Composable
fun MessageActionsDialog(
    preview: String,
    lang: String,
    onDismiss: () -> Unit,
    actions: List<MessageAction>,
    dismissOnAction: Boolean = true
) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            shape = RoundedCornerShape(26.dp),
            color = Color.White,
            shadowElevation = 12.dp,
            modifier = Modifier.fillMaxWidth(0.86f).widthIn(max = 380.dp)
        ) {
            Column(modifier = Modifier.padding(vertical = 10.dp)) {
                if (preview.isNotBlank()) {
                    Text(
                        preview,
                        color = Color.Gray,
                        fontSize = 13.sp,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp)
                    )
                    Box(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(1.dp).background(ViberLightPurple))
                }
                actions.forEach { action ->
                    val color = if (action.danger) Color(0xFFD93025) else Color.Black
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                if (dismissOnAction) onDismiss()
                                action.onClick()
                            }
                            .padding(horizontal = 20.dp, vertical = 13.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(34.dp)
                                .clip(CircleShape)
                                .background(if (action.danger) Color(0xFFFDECEA) else ViberLightPurple),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(action.icon, contentDescription = null, tint = if (action.danger) color else ViberPurple, modifier = Modifier.size(19.dp))
                        }
                        Spacer(modifier = Modifier.width(14.dp))
                        Text(action.label, color = color, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                    }
                }
            }
        }
    }
}

/** Підказки над полем вводу після «@»: ШІ (gemini / chatgpt) або моделі. */
@Composable
fun MentionSuggestions(title: String, items: List<Pair<String, String>>, onPick: (String) -> Unit) {
    Surface(
        shape = RoundedCornerShape(18.dp),
        color = Color.White,
        shadowElevation = 6.dp,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 4.dp)
    ) {
        Column(
            modifier = Modifier
                .heightIn(max = 230.dp)
                .verticalScroll(rememberScrollState())
                .padding(vertical = 6.dp)
        ) {
            Text(
                title,
                color = ViberPurple,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp)
            )
            items.forEach { (id, label) ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onPick(id) }
                        .padding(horizontal = 14.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(label, fontSize = 14.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                    Text("@$id", fontSize = 11.sp, color = Color.Gray, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 170.dp))
                }
            }
        }
    }
}
