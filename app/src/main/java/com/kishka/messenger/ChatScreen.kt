package com.kishka.messenger

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Close
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
    var pendingMedia by remember { mutableStateOf<PendingMedia?>(null) }
    var uploadProgress by remember { mutableStateOf<Float?>(null) }
    var uploadHandle by remember { mutableStateOf<UploadHandle?>(null) }

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
                manager.sendMessage(currentEmail, targetUser.email, text, uploaded.url, uploaded.type, uploaded.thumbUrl)
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
                                    MessageMedia(url = fileUrl, type = msg.fileType, thumbUrl = msg.thumbUrl) {
                                        viewerMessage = msg
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
                                            Toast.makeText(context, Strings.get("message_copied", lang), Toast.LENGTH_SHORT).show()
                                            menuMessage = null
                                        }
                                    )
                                }
                                val fileUrl = msg.fileUrl
                                if (fileUrl != null) {
                                    DropdownMenuItem(
                                        text = { Text(cs("save_to_gallery")) },
                                        onClick = {
                                            menuMessage = null
                                            saver.save(fileUrl)
                                        }
                                    )
                                }
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
                onAttach = {
                    mediaPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
                }
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

    GallerySavedDialog(saver)
}
