package com.kishka.messenger

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage

const val GEMINI_LOGO_URL =
    "https://raw.githubusercontent.com/mukhalkivbohdancats-dev/Kishka/main/Assets/Logo.png"

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun GeminiTab(
    currentEmail: String,
    displayName: String,
    lang: String
) {
    val context = LocalContext.current
    val gemini = remember { GeminiManager(context) }

    var messages by remember(currentEmail) { mutableStateOf(gemini.getCachedHistory(currentEmail)) }
    var textInput by remember { mutableStateOf("") }
    var isSending by remember { mutableStateOf(false) }
    var isLoadingHistory by remember { mutableStateOf(true) }
    var selectedMessageForMenu by remember { mutableStateOf<GeminiMessage?>(null) }
    var showClearDialog by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

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

    val totalItems = messages.size + if (isSending) 1 else 0

    LaunchedEffect(totalItems) {
        if (totalItems > 0) {
            listState.animateScrollToItem(totalItems - 1)
        }
    }

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

        gemini.sendMessage(currentEmail, displayName, text) { result ->
            isSending = false
            if (result.success && result.reply != null) {
                messages = messages + result.reply
                gemini.saveCache(currentEmail, messages)
            } else {
                // Не вдалося — прибираємо повідомлення і повертаємо текст у поле вводу
                messages = messages.filterNot { it.id == localMessage.id }
                if (textInput.isEmpty()) textInput = text
                Toast.makeText(
                    context,
                    result.error ?: Strings.get("gemini_error", lang),
                    Toast.LENGTH_LONG
                ).show()
            }
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
                                Text(
                                    text = if (isMe) AnnotatedString(msg.text) else formatGeminiText(msg.text),
                                    color = if (isMe) Color.White else Color.Black,
                                    modifier = Modifier.padding(10.dp)
                                )
                            }

                            DropdownMenu(
                                expanded = selectedMessageForMenu?.id == msg.id && selectedMessageForMenu?.timestamp == msg.timestamp,
                                onDismissRequest = { selectedMessageForMenu = null }
                            ) {
                                DropdownMenuItem(
                                    text = { Text(Strings.get("copy", lang)) },
                                    onClick = {
                                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                        clipboard.setPrimaryClip(ClipData.newPlainText("Copied Text", msg.text))
                                        Toast.makeText(context, Strings.get("message_copied", lang), Toast.LENGTH_SHORT).show()
                                        selectedMessageForMenu = null
                                    }
                                )
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
                                    Row(
                                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        CircularProgressIndicator(
                                            color = ViberPurple,
                                            strokeWidth = 2.dp,
                                            modifier = Modifier.size(16.dp)
                                        )
                                        Spacer(modifier = Modifier.width(10.dp))
                                        Text(
                                            Strings.get("gemini_thinking", lang),
                                            color = Color.Gray,
                                            fontSize = 14.sp
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth().padding(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedTextField(
                    value = textInput,
                    onValueChange = { textInput = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text(Strings.get("type_message", lang)) },
                    maxLines = 4
                )
                IconButton(
                    onClick = sendAction,
                    enabled = textInput.isNotBlank() && !isSending
                ) {
                    Icon(
                        Icons.Default.Send,
                        contentDescription = null,
                        tint = if (textInput.isNotBlank() && !isSending) ViberPurple else Color.LightGray
                    )
                }
            }
        }
    }

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
}

/** Аватарка Gemini (Assets/Logo.png) у білому колі, як аватарки контактів у Kishka. */
@Composable
fun GeminiAvatar(size: androidx.compose.ui.unit.Dp) {
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
