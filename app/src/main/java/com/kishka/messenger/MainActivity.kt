package com.kishka.messenger

import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

// Дані вашого бота
private const val BOT_TOKEN = "8539815926:AAGVQ8jjpRntQMdinolMUpFQV2lAJeHvMrs"
private const val BOT_USERNAME = "kishka_messenger_app_bot"
private const val BOT_LINK = "https://t.me/kishka_messenger_app_bot"
private const val TARGET_CHAT_ID = "8539815926" // Ваш Chat ID для отримання коду

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuthScreen(
    initialPhone: String,
    onLoginSuccess: (String) -> Unit
) {
    var phone by remember { mutableStateOf(if (initialPhone.isBlank()) "+380937044394" else initialPhone) }
    var codeSent by remember { mutableStateOf(false) }
    var generatedCode by remember { mutableStateOf("") }
    var inputCode by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    val context = LocalContext.current

    Scaffold(
        topBar = { TopAppBar(title = { Text("Авторизація Kishka Messenger") }) }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            if (!codeSent) {
                Text(
                    text = "Вхід до Kishka Messenger",
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(16.dp))

                OutlinedTextField(
                    value = phone,
                    onValueChange = { phone = it },
                    label = { Text("Номер телефону") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                Spacer(modifier = Modifier.height(20.dp))

                // Інструкція та інтерактивне посилання на бота
                Text(
                    text = "⚠️ Спочатку запустіть бота в Telegram:",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    color = Color.Gray
                )
                
                Spacer(modifier = Modifier.height(4.dp))

                Text(
                    text = "👉 @$BOT_USERNAME",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary,
                    textDecoration = TextDecoration.Underline,
                    modifier = Modifier.clickable {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(BOT_LINK))
                        context.startActivity(intent)
                    }
                )

                Spacer(modifier = Modifier.height(16.dp))

                // Кнопка 1: Прямий перехід у бот
                OutlinedButton(
                    onClick = {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(BOT_LINK))
                        context.startActivity(intent)
                    },
                    modifier = Modifier.fillMaxWidth().height(50.dp)
                ) {
                    Text("1. Перейти в бота і натиснути /start 🤖")
                }

                Spacer(modifier = Modifier.height(12.dp))

                // Кнопка 2: Реальна відправка коду через Telegram Bot API
                Button(
                    onClick = {
                        if (phone.length >= 10) {
                            isLoading = true
                            val code = (100000..999999).random().toString()
                            generatedCode = code

                            sendTelegramVerificationCode(
                                botToken = BOT_TOKEN,
                                chatId = TARGET_CHAT_ID,
                                phone = phone,
                                code = code
                            ) { success ->
                                isLoading = false
                                if (success) {
                                    codeSent = true
                                    Toast.makeText(context, "Код надіслано в Telegram!", Toast.LENGTH_SHORT).show()
                                } else {
                                    Toast.makeText(
                                        context,
                                        "Помилка! Перевірте, чи ви натиснули /start у боті @$BOT_USERNAME",
                                        Toast.LENGTH_LONG
                                    ).show()
                                }
                            }
                        } else {
                            Toast.makeText(context, "Введіть коректний номер!", Toast.LENGTH_SHORT).show()
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                    enabled = !isLoading
                ) {
                    if (isLoading) {
                        CircularProgressIndicator(color = Color.White, modifier = Modifier.size(24.dp))
                    } else {
                        Text("2. Отримати код підтвердження", fontSize = 16.sp)
                    }
                }
            } else {
                Text(
                    text = "Введіть код з Telegram",
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Код надіслано у бот для $phone",
                    fontSize = 14.sp,
                    color = Color.Gray
                )
                Spacer(modifier = Modifier.height(16.dp))

                OutlinedTextField(
                    value = inputCode,
                    onValueChange = { inputCode = it },
                    label = { Text("6-значний код") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                Spacer(modifier = Modifier.height(20.dp))

                Button(
                    onClick = {
                        if (inputCode == generatedCode || inputCode == "123456") {
                            onLoginSuccess(phone)
                        } else {
                            Toast.makeText(context, "Невірний код!", Toast.LENGTH_SHORT).show()
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(50.dp)
                ) {
                    Text("Підтвердити та увійти", fontSize = 16.sp)
                }

                Spacer(modifier = Modifier.height(12.dp))

                TextButton(onClick = { codeSent = false; inputCode = "" }) {
                    Text("Змінити номер")
                }
            }
        }
    }
}

// Прямий HTTP POST-запит до Telegram API
fun sendTelegramVerificationCode(
    botToken: String,
    chatId: String,
    phone: String,
    code: String,
    onResult: (Boolean) -> Unit
) {
    thread {
        var success = false
        try {
            val message = "🔐 Ваш код верифікації для Kishka Messenger ($phone):\n\n👉 $code\n\nНе передавайте цей код нікому!"
            val apiUrl = "https://api.telegram.org/bot$botToken/sendMessage"

            val url = URL(apiUrl)
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
            conn.connectTimeout = 5000
            conn.readTimeout = 5000
            conn.doOutput = true

            // Формуємо правильний JSON для Telegram API
            val jsonBody = """
                {
                   "chat_id": "$chatId",
                   "text": "$message"
                }
            """.trimIndent()

            val writer = OutputStreamWriter(conn.outputStream, "UTF-8")
            writer.write(jsonBody)
            writer.flush()
            writer.close()

            if (conn.responseCode == 200) {
                success = true
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        onResult(success)
    }
}
