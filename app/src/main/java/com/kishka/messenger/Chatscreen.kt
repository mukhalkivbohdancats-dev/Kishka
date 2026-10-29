package com.kishka.messenger

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
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
    var htmlMessage by remember { mutableStateOf<Message?>(null) }
    var apkMessage by remember { mutableStateOf<Message?>(null) }
    var pendingMedia by remember { mutableStateOf<PendingMedia?>(null) }
    var uploadProgress by remember { mutableStateOf<Float?>(null) }
    var uploadHandle by remember { mutableStateOf<UploadHandle?>(null) }
    var showAttachDialog by remember { mutableStateOf(false) }
    var forwardTarget by remember { mutableStateOf<Message?>(null) }

    val listState = rememberLazyListState()
    val context = LocalContext.current
    val saver = rememberGallerySaver(lang)
    val partnerTyping = isUserTyping(targetUser.email)
    val myEmail = currentEmail.trim().lowercase()
    val cs: (String) -> String = { key -> ChatStrings.get(key, lang) }

    val mediaPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            val media = MediaUtils.describe(context, uri)
            when {
                media == null -> Notice.show(cs("media_bad"))
                media.size > MediaUtils.MAX_FILE_BYTES -> Notice.show(cs("media_too_big"))
                else -> pendingMedia = media
            }
        }
    }

    // Будь-який файл (документ, архів тощо)
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            val media = MediaUtils.describeFile(context, uri)
            when {
                media == null -> Notice.show(cs("media_bad"))
                media.size > MediaUtils.MAX_FILE_BYTES -> Notice.show(cs("media_too_big"))
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
                Notice.show(cs("upload_failed"))
            }
        }
    }

    BackHandler {
        manager.leaveChatRoom()
        onBack()
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
                        AsyncImage(
                            model = if (targetUser.avatarUrl.isNullOrEmpty()) DEFAULT_AVATAR_URL else targetUser.avatarUrl,
                            contentDescription = "Avatar",
                            modifier = Modifier.size(40.dp).clip(CircleShape)
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Column {
                            Text(
                                targetUser.name.ifEmpty { targetUser.email },
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold
                            )
                            if (partnerTyping) {
                                // Біля аватарки: "пише" з анімованими крапками та слайдером
                                TypingIndicator(text = cs("typing"), fontSize = 12.sp)
                            } else {
                                Text(targetUser.email, fontSize = 11.sp, color = Color.Gray)
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
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp)
            ) {
                itemsIndexed(messages) { index, msg ->
                    val isMe = msg.senderEmail.trim().lowercase() == myEmail
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
                                val fileUrl = msg.fileUrl
                                if (fileUrl != null) {
                                    if (msg.fileType == "file") {
                                        MessageFile(name = msg.fileName, isMe = isMe, lang = lang) {
                                            when {
                                                FileKinds.isHtml(msg.fileName) -> htmlMessage = msg
                                                FileKinds.isApk(msg.fileName) -> apkMessage = msg
                                                else -> {
                                                    val started = MediaUtils.downloadFile(context, fileUrl, msg.fileName)
                                                    Notice.show(cs(if (started) "download_started" else "download_failed"))
                                                }
                                            }
                                        }
                                    } else {
                                        MessageMedia(url = fileUrl, type = msg.fileType, thumbUrl = msg.thumbUrl) {
                                            viewerMessage = msg
                                        }
                                    }
                                }
                                if (msg.text.isNotEmpty()) {
                                    Text(
                                        text = msg.text,
                                        color = if (isMe) Color.White else Color.Black,
                                        fontSize = 15.sp,
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                    )
                                }
                            }

                            DropdownMenu(
                                expanded = menuMessage?.id == msg.id,
                                onDismissRequest = { menuMessage = null }
                            ) {
                                if (msg.text.isNotEmpty()) {
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
                                val fileUrl = msg.fileUrl
                                if (fileUrl != null && msg.fileType != "file") {
                                    DropdownMenuItem(
                                        text = { Text(cs("save_to_gallery")) },
                                        onClick = {
                                            menuMessage = null
                                            saver.save(fileUrl)
                                        }
                                    )
                                }
                                if (fileUrl != null && msg.fileType == "file" && FileKinds.isHtml(msg.fileName)) {
                                    DropdownMenuItem(
                                        text = { Text(cs("open_html")) },
                                        onClick = {
                                            menuMessage = null
                                            htmlMessage = msg
                                        }
                                    )
                                }
                                if (fileUrl != null && msg.fileType == "file" && FileKinds.isApk(msg.fileName)) {
                                    DropdownMenuItem(
                                        text = { Text(cs("install_apk")) },
                                        onClick = {
                                            menuMessage = null
                                            apkMessage = msg
                                        }
                                    )
                                }
                                if (fileUrl != null && msg.fileType == "file") {
                                    DropdownMenuItem(
                                        text = { Text(cs("download")) },
                                        onClick = {
                                            menuMessage = null
                                            val started = MediaUtils.downloadFile(context, fileUrl, msg.fileName)
                                            Notice.show(cs(if (started) "download_started" else "download_failed"))
                                        }
                                    )
                                }
                                DropdownMenuItem(
                                    text = { Text(cs("forward")) },
                                    onClick = {
                                        forwardTarget = msg
                                        menuMessage = null
                                    }
                                )
                                DropdownMenuItem(
                                    text = { Text(Strings.get("delete", lang), color = Color.Red) },
                                    onClick = {
                                        deleteTarget = msg
                                        menuMessage = null
                                    }
                                )
                            }
                        }
                    }
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
                        Icon(Icons.Default.PhotoLibrary, contentDescription = null, tint = ViberPurple, modifier = Modifier.size(22.dp))
                        Spacer(modifier = Modifier.width(10.dp))
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
                        Icon(Icons.Default.AttachFile, contentDescription = null, tint = ViberPurple, modifier = Modifier.size(22.dp))
                        Spacer(modifier = Modifier.width(10.dp))
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
                                        Notice.show(cs("forward_sent"))
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

    val htmlOpen = htmlMessage
    if (htmlOpen != null && htmlOpen.fileUrl != null) {
        HtmlViewerDialog(url = htmlOpen.fileUrl, name = htmlOpen.fileName, lang = lang, onDismiss = { htmlMessage = null })
    }
    val apkOpen = apkMessage
    if (apkOpen != null && apkOpen.fileUrl != null) {
        ApkInstallDialog(url = apkOpen.fileUrl, name = apkOpen.fileName, lang = lang, onDismiss = { apkMessage = null })
    }

    GallerySavedDialog(saver)
}
