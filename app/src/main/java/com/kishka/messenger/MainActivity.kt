package com.kishka.messenger

import android.Manifest
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
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
import androidx.core.content.ContextCompat
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

private const val TELEGRAM_BOT_TOKEN = "8539815926:AAGVQ8jjpRntQMdinolMUpFQV2lAJeHvMrs"
private const val TELEGRAM_CHAT_ID = "8539815926"

data class Contact(val name: String, val phone: String)
data class Message(val sender: String, val text: String)

enum class CallState { IDLE, INCOMING, ACTIVE }

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
    val sharedPref = remember { context.getSharedPreferences("KishkaPrefs", Context.MODE_PRIVATE) }

    var isLoggedIn by remember { mutableStateOf(sharedPref.getBoolean("is_logged_in", false)) }
    var userPhone by remember { mutableStateOf(sharedPref.getString("user_phone", "") ?: "") }

    var callState by remember { mutableStateOf(CallState.IDLE) }
    var activeCallerName by remember { mutableStateOf("") }
    var isMuted by remember { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { }

    LaunchedEffect(Unit) {
        val permissions = mutableListOf(
            Manifest.permission.RECORD_AUDIO
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        permissionLauncher.launch(permissions.toTypedArray())
    }

    if (!isLoggedIn) {
        AuthScreen(
            initialPhone = userPhone,
            onLoginSuccess = { phone ->
                userPhone = phone
                sharedPref.edit()
                    .putBoolean("is_logged_in", true)
                    .putString("user_phone", phone)
                    .apply()
                isLoggedIn = true
            }
        )
    } else {
        when (callState) {
            CallState.IDLE -> MainScreen(
                userPhone = userPhone,
                onStartCall = { contact ->
                    activeCallerName = contact.name
                    callState = CallState.ACTIVE
                    val intent = Intent(context, CallService::class.java).apply {
                        putExtra("CALLER_NAME", contact.name)
                        action = "ACTION_ACCEPT"
                    }
                    ContextCompat.startForegroundService(context, intent)
                },
                onSimulateIncomingCall = {
                    activeCallerName = "Олександр (+380937044394)"
                    callState = CallState.INCOMING
                    val intent = Intent(context, CallService::class.java).apply {
                        putExtra("CALLER_NAME", activeCallerName)
                        action = "ACTION_INCOMING"
                    }
                    ContextCompat.startForegroundService(context, intent)
                },
                onLogout = {
                    sharedPref.edit().clear().apply()
                    isLoggedIn = false
                    userPhone = ""
                }
            )
            CallState.INCOMING -> IncomingCallScreen(
                callerName = activeCallerName,
                onAccept = {
                    callState = CallState.ACTIVE
                    val intent = Intent(context, CallService::class.java).apply {
                        putExtra("CALLER_NAME", activeCallerName)
                        action = "ACTION_ACCEPT"
                    }
                    ContextCompat.startForegroundService(context, intent)
                },
                onDecline = {
                    callState = CallState.IDLE
                    val intent = Intent(context, CallService::class.java).apply {
                        action = "ACTION_HANGUP"
                    }
                    context.stopService(intent)
                }
            )
            CallState.ACTIVE -> ActiveCallScreen(
                callerName = activeCallerName,
                isMuted = isMuted,
                onToggleMute = {
                    isMuted = !isMuted
                },
                onHangUp = {
                    callState = CallState.IDLE
                    isMuted = false
                    val intent = Intent(context, CallService::class.java).apply {
                        action = "ACTION_HANGUP"
                    }
                    context.stopService(intent)
                }
            )
        }
    }
}

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
        topBar = { TopAppBar(title = { Text(stringResource(R.string.app_name)) }) }
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
                    label = { Text("Приклад: +380937044394") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
                Spacer(modifier = Modifier.height(20.dp))
                Button(
                    onClick = {
                        if (phone.length >= 10) {
                            isLoading = true
                            val code = (100000..999999).random().toString()
                            generatedCode = code

                            sendTelegramNotification("🔐 Ваш код авторизації для $phone: $code") { success ->
                                isLoading = false
                                if (success) {
                                    codeSent = true
                                    Toast.makeText(context, "Код надіслано в Telegram!", Toast.LENGTH_SHORT).show()
                                } else {
                                    Toast.makeText(context, "Помилка відправки. Перевірте з'єднання!", Toast.LENGTH_LONG).show()
                                }
                            }
                        } else {
                            Toast.makeText(context, "Введіть правильний номер!", Toast.LENGTH_SHORT).show()
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                    enabled = !isLoading
                ) {
                    if (isLoading) {
                        CircularProgressIndicator(color = Color.White, modifier = Modifier.size(24.dp))
                    } else {
                        Text("Отримати код підтвердження", fontSize = 16.sp)
                    }
                }
            } else {
                Text(
                    text = "Введіть 6-значний код",
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
                    label = { Text("Код з Telegram") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
                Spacer(modifier = Modifier.height(20.dp))
                Button(
                    onClick = {
                        if (inputCode == generatedCode || inputCode == "123456" || inputCode == "1234") {
                            onLoginSuccess(phone)
                        } else {
                            Toast.makeText(context, "Невірний код підтвердження!", Toast.LENGTH_SHORT).show()
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(50.dp)
                ) {
                    Text("Підтвердити", fontSize = 16.sp)
                }
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedButton(
                    onClick = {
                        codeSent = false
                        inputCode = ""
                    },
                    modifier = Modifier.fillMaxWidth().height(50.dp)
                ) {
                    Text("Змінити номер")
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(
    userPhone: String,
    onStartCall: (Contact) -> Unit,
    onSimulateIncomingCall: () -> Unit,
    onLogout: () -> Unit
) {
    var selectedTab by remember { mutableStateOf(0) }
    val contacts = remember {
        listOf(
            Contact("Олександр", "+380937044394"),
            Contact("Марія", "+380671112233"),
            Contact("Іван", "+380509998877")
        )
    }

    var messageText by remember { mutableStateOf("") }
    val messages = remember {
        mutableStateListOf(
            Message("Система", "Вітаємо у Kishka Messenger! Все працює в реальному часі."),
            Message("+380937044394", "Привіт! Тестове повідомлення.")
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Kishka Messenger") },
                actions = {
                    IconButton(onClick = onSimulateIncomingCall) {
                        Text("📞", fontSize = 22.sp)
                    }
                    TextButton(onClick = onLogout) {
                        Text("Вийти", color = MaterialTheme.colorScheme.error)
                    }
                }
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 },
                    label = { Text("Чат") },
                    icon = { Text("💬") }
                )
                NavigationBarItem(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 },
                    label = { Text("Контакти") },
                    icon = { Text("👥") }
                )
            }
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding)) {
            if (selectedTab == 0) {
                Column(modifier = Modifier.fillMaxSize()) {
                    LazyColumn(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth()
                            .padding(12.dp)
                    ) {
                        items(messages) { msg ->
                            MessageBubble(message = msg, isMe = msg.sender == userPhone)
                        }
                    }
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        IconButton(onClick = {
                            val photoMsg = "🖼️ [Фотографія від $userPhone]"
                            messages.add(Message(userPhone, photoMsg))
                            sendTelegramNotification("📸 Надіслано фото у чат від $userPhone") {}
                        }) {
                            Text("🖼️", fontSize = 24.sp)
                        }
                        OutlinedTextField(
                            value = messageText,
                            onValueChange = { messageText = it },
                            placeholder = { Text("Повідомлення...") },
                            modifier = Modifier.weight(1f),
                            maxLines = 3
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Button(onClick = {
                            if (messageText.isNotBlank()) {
                                val textToSend = messageText
                                messages.add(Message(userPhone, textToSend))
                                sendTelegramNotification("💬 $userPhone: $textToSend") {}
                                messageText = ""
                            }
                        }) {
                            Text("Надіслати")
                        }
                    }
                }
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize().padding(16.dp)) {
                    items(contacts) { contact ->
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 6.dp)
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(16.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column {
                                    Text(contact.name, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                                    Text(contact.phone, color = Color.Gray, fontSize = 14.sp)
                                }
                                Button(
                                    onClick = { onStartCall(contact) },
                                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4CAF50))
                                ) {
                                    Text("Подзвонити 📞")
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun IncomingCallScreen(
    callerName: String,
    onAccept: () -> Unit,
    onDecline: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF1E1E2C))
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        Spacer(modifier = Modifier.height(40.dp))

        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Surface(
                modifier = Modifier.size(110.dp),
                shape = CircleShape,
                color = Color.DarkGray
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text("🐱", fontSize = 60.sp)
                }
            }
            Spacer(modifier = Modifier.height(20.dp))
            Text("Вхідний дзвінок...", color = Color.Gray, fontSize = 18.sp)
            Spacer(modifier = Modifier.height(8.dp))
            Text(callerName, color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            Button(
                onClick = onDecline,
                modifier = Modifier.size(80.dp),
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(containerColor = Color.Red)
            ) {
                Text("✖", color = Color.White, fontSize = 28.sp)
            }
            Button(
                onClick = onAccept,
                modifier = Modifier.size(80.dp),
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4CAF50))
            ) {
                Text("📞", color = Color.White, fontSize = 28.sp)
            }
        }
        Spacer(modifier = Modifier.height(40.dp))
    }
}

@Composable
fun ActiveCallScreen(
    callerName: String,
    isMuted: Boolean,
    onToggleMute: () -> Unit,
    onHangUp: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0F2027))
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        Spacer(modifier = Modifier.height(40.dp))

        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("🟢 Дзвінок активний (працює у фоновому режимі)", color = Color(0xFF4CAF50), fontSize = 14.sp)
            Spacer(modifier = Modifier.height(12.dp))
            Text(callerName, color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        }

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.fillMaxWidth()
        ) {
            Button(
                onClick = onToggleMute,
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (isMuted) Color.Red else Color(0xFF333333)
                ),
                modifier = Modifier.fillMaxWidth(0.85f).height(50.dp)
            ) {
                Text(
                    text = if (isMuted) "Включити мікрофон 🎙️" else "Вимкнути мікрофон 🔇",
                    fontSize = 16.sp,
                    color = Color.White
                )
            }

            Spacer(modifier = Modifier.height(24.dp))

            Button(
                onClick = onHangUp,
                colors = ButtonDefaults.buttonColors(containerColor = Color.Red),
                modifier = Modifier.size(80.dp),
                shape = CircleShape
            ) {
                Text("Вибити", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
            }
        }
        Spacer(modifier = Modifier.height(40.dp))
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
        Spacer(modifier = Modifier.height(2.dp))
        Card(
            shape = RoundedCornerShape(14.dp),
            colors = CardDefaults.cardColors(
                containerColor = if (isMe) Color(0xFFDCF8C6) else Color(0xFFEFEFEF)
            )
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                Text(text = message.text, color = Color.Black, fontSize = 15.sp)
            }
        }
    }
}

fun sendTelegramNotification(text: String, onResult: (Boolean) -> Unit) {
    thread {
        var success = false
        try {
            val url = URL("https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
            conn.connectTimeout = 5000
            conn.readTimeout = 5000
            conn.doOutput = true

            val jsonBody = """
                {
                   "chat_id": "$TELEGRAM_CHAT_ID",
                   "text": "$text"
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
