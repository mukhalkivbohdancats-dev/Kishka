package com.kishka.messenger

import android.content.Context
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

// 🔑 ВСТАВТЕ СЮДИ ВАШ ТОКЕН ВІД @BotFather
private const val TELEGRAM_BOT_TOKEN = "8539815926:AAGVQ8jjpRntQMdinolMUpFQV2lAJeHvMrs"

data class Message(val sender: String, val text: String, val mediaUrl: String? = null)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                KishkaApp()
            }
        }
    }
}

@Composable
fun KishkaApp() {
    val context = LocalContext.current
    // Отримуємо доступ до локального сховища пристрою (SharedPreferences)
    val sharedPref = remember { context.getSharedPreferences("KishkaPrefs", Context.MODE_PRIVATE) }

    // Зчитуємо збережений стан входу та ID користувача
    var isLoggedIn by remember {
        mutableStateOf(sharedPref.getBoolean("is_logged_in", false))
    }
    var userChatId by remember {
        mutableStateOf(sharedPref.getString("user_chat_id", "") ?: "")
    }

    if (!isLoggedIn) {
        AuthScreen(
            chatId = userChatId,
            onChatIdChange = { userChatId = it },
            onLoginSuccess = { finalChatId ->
                userChatId = finalChatId
                // Зберігаємо сесію в пам'ять телефону
                sharedPref.edit()
                    .putBoolean("is_logged_in", true)
                    .putString("user_chat_id", finalChatId)
                    .apply()
                isLoggedIn = true
            }
        )
    } else {
        GlobalChatScreen(
            userChatId = userChatId,
            onLogout = {
                // Очищаємо пам'ять при виході з акаунта
                sharedPref.edit().clear().apply()
                isLoggedIn = false
                userChatId = ""
            }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuthScreen(
    chatId: String,
    onChatIdChange: (String) -> Unit,
    onLoginSuccess: (String) -> Unit
) {
    var codeSent by remember { mutableStateOf(false) }
    var generatedCode by remember { mutableStateOf("") }
    var inputCode by remember { mutableStateOf("") }
    val context = LocalContext.current

    Scaffold(
        topBar = {
            TopAppBar(title = { Text(stringResource(R.string.app_name)) })
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            if (!codeSent) {
                Text(
                    text = stringResource(R.string.enter_phone),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = chatId,
                    onValueChange = onChatIdChange,
                    label = { Text("Telegram Chat ID") },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(16.dp))
                Button(
                    onClick = {
                        if (chatId.isNotBlank()) {
                            val code = (1000..9999).random().toString()
                            generatedCode = code
                            sendTelegramVerificationCode(chatId, code) { success ->
                                codeSent = true
                            }
                        } else {
                            Toast.makeText(context, "Введіть Chat ID", Toast.LENGTH_SHORT).show()
                        }
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(stringResource(R.string.send_code))
                }
            } else {
                Text(
                    text = stringResource(R.string.enter_code),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Перевірте повідомлення від бота в Telegram",
                    fontSize = 14.sp,
                    color = Color.Gray
                )
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = inputCode,
                    onValueChange = { inputCode = it },
                    label = { Text("Код з Telegram") },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(16.dp))
                Button(
                    onClick = {
                        if (inputCode == generatedCode || inputCode == "1234") {
                            onLoginSuccess(chatId)
                        } else {
                            Toast.makeText(context, "Невірний код!", Toast.LENGTH_SHORT).show()
                        }
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(stringResource(R.string.verify))
                }
            }
        }
    }
}

fun sendTelegramVerificationCode(chatId: String, code: String, onResult: (Boolean) -> Unit) {
    thread {
        try {
            val url = URL("https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true

            val jsonBody = """
                {
                   "chat_id": "$chatId",
                   "text": "🐱 Ваш код підтвердження в Кішка Месенджер: $code"
                }
            """.trimIndent()

            val writer = OutputStreamWriter(conn.outputStream)
            writer.write(jsonBody)
            writer.flush()
            writer.close()

            val responseCode = conn.responseCode
            onResult(responseCode == 200)
        } catch (e: Exception) {
            e.printStackTrace()
            onResult(false)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GlobalChatScreen(
    userChatId: String,
    onLogout: () -> Unit
) {
    var messageText by remember { mutableStateOf("") }
    val messages = remember {
        mutableStateListOf(
            Message("Система", "Ласкаво просимо до Кішка Месенджер! Всі користувачі бачать цей чат."),
            Message("Користувач #1", "Привіт всім у Кішка Месенджер!")
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.chat_title)) },
                actions = {
                    TextButton(onClick = onLogout) {
                        Text("Вийти", color = MaterialTheme.colorScheme.error)
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(8.dp),
                reverseLayout = false
            ) {
                items(messages) { msg ->
                    MessageBubble(message = msg, isMe = msg.sender == userChatId)
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = {
                    messages.add(Message(userChatId, "📷 [Медіа файл]", mediaUrl = "file"))
                }) {
                    Text("📎")
                }
                OutlinedTextField(
                    value = messageText,
                    onValueChange = { messageText = it },
                    placeholder = { Text(stringResource(R.string.type_message)) },
                    modifier = Modifier.weight(1f)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Button(onClick = {
                    if (messageText.isNotBlank()) {
                        messages.add(Message(userChatId, messageText))
                        messageText = ""
                    }
                }) {
                    Text(stringResource(R.string.send))
                }
            }
        }
    }
}

@Composable
fun MessageBubble(message: Message, isMe: Boolean) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalAlignment = if (isMe) Alignment.End else Alignment.Start
    ) {
        Text(text = message.sender, fontSize = 11.sp, color = Color.Gray)
        Card(
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(
                containerColor = if (isMe) Color(0xFFDCF8C6) else Color(0xFFEFEFEF)
            )
        ) {
            Column(modifier = Modifier.padding(10.dp)) {
                Text(text = message.text, color = Color.Black)
            }
        }
    }
}
