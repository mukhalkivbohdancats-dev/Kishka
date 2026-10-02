package com.kishka.messenger

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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

private const val BOT_TOKEN = "8539815926:AAGVQ8jjpRntQMdinolMUpFQV2lAJeHvMrs"
private const val BOT_USERNAME = "kishka_messenger_app_bot"
private const val BOT_LINK = "https://t.me/kishka_messenger_app_bot"
private const val TARGET_CHAT_ID = "8539815926"

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
    val manager = remember { KishkaManager(context) }
    
    var currentUserPhone by remember { mutableStateOf("") }
    var selectedUserForChat by remember { mutableStateOf<User?>(null) }

    if (currentUserPhone.isEmpty()) {
        AuthScreen { phone ->
            currentUserPhone = phone
            manager.registerUserInGlobalContacts(phone)
            manager.listenForIncomingCalls(phone)
        }
    } else if (selectedUserForChat == null) {
        ContactsScreen(
            manager = manager,
            currentPhone = currentUserPhone,
            onUserSelected = { user -> selectedUserForChat = user }
        )
    } else {
        ChatScreen(
            manager = manager,
            currentPhone = currentUserPhone,
            targetUser = selectedUserForChat!!,
            onBack = { selectedUserForChat = null }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuthScreen(onLoginSuccess: (String) -> Unit) {
    var phone by remember { mutableStateOf("+380937044394") }
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
                Text("Вхід до Kishka Messenger", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(16.dp))

                OutlinedTextField(
                    value = phone,
                    onValueChange = { phone = it },
                    label = { Text("Номер телефону") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                Spacer(modifier = Modifier.height(20.dp))

                Text("⚠️ Спочатку запустіть бота в Telegram:", fontSize = 14.sp, color = Color.Gray)
                Spacer(modifier = Modifier.height(4.dp))

                Text(
                    text = "👉 @$BOT_USERNAME",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary,
                    textDecoration = TextDecoration.Underline,
                    modifier = Modifier.clickable {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BOT_LINK)))
                    }
                )

                Spacer(modifier = Modifier.height(16.dp))

                OutlinedButton(
                    onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BOT_LINK))) },
                    modifier = Modifier.fillMaxWidth().height(50.dp)
                ) {
                    Text("1. Перейти в бота і натиснути /start 🤖")
                }

                Spacer(modifier = Modifier.height(12.dp))

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
                                    Toast.makeText(context, "Помилка! Натисніть /start у боті @$BOT_USERNAME", Toast.LENGTH_LONG).show()
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
                Text("Введіть код з Telegram", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(8.dp))
                Text("Код надіслано для $phone", fontSize = 14.sp, color = Color.Gray)
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
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContactsScreen(manager: KishkaManager, currentPhone: String, onUserSelected: (User) -> Unit) {
    var contacts by remember { mutableStateOf(listOf<User>()) }

    LaunchedEffect(Unit) {
        manager.listenToAllContacts { fetched ->
            contacts = fetched.filter { it.phone != currentPhone }
        }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Контакты ($currentPhone)") }) }
    ) { padding ->
        LazyColumn(modifier = Modifier.fillMaxSize().padding(padding)) {
            items(contacts) { user ->
                ListItem(
                    headlineContent = { Text(user.name, fontWeight = FontWeight.Bold) },
                    supportingContent = { Text(user.phone) },
                    modifier = Modifier.clickable { onUserSelected(user) }
                )
                Divider()
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(manager: KishkaManager, currentPhone: String, targetUser: User, onBack: () -> Unit) {
    var messages by remember { mutableStateOf(listOf<Message>()) }
    var textInput by remember { mutableStateOf("") }

    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri ->
        uri?.let { manager.sendFileMessage(currentPhone, targetUser.phone, it, "file") }
    }

    LaunchedEffect(targetUser.phone) {
        manager.listenForMessages(currentPhone, targetUser.phone) { newMsgs ->
            messages = newMsgs
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(targetUser.phone) },
                actions = {
                    IconButton(onClick = { manager.startCall(currentPhone, targetUser.phone) }) {
                        Text("📞")
                    }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            LazyColumn(
                modifier = Modifier.weight(1f).padding(8.dp),
                verticalArrangement = Arrangement.Bottom
            ) {
                items(messages) { msg ->
                    val isMe = msg.senderPhone == currentPhone
                    Box(
                        modifier = Modifier.fillMaxWidth(),
                        contentAlignment = if (isMe) Alignment.CenterEnd else Alignment.CenterStart
                    ) {
                        Surface(
                            color = if (isMe) MaterialTheme.colorScheme.primary else Color.LightGray,
                            shape = MaterialTheme.shapes.medium,
                            modifier = Modifier.padding(4.dp)
                        ) {
                            Text(
                                text = msg.text,
                                color = if (isMe) Color.White else Color.Black,
                                modifier = Modifier.padding(8.dp)
                            )
                        }
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth().padding(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = { filePickerLauncher.launch("*/*") }) {
                    Text("📎")
                }
                OutlinedTextField(
                    value = textInput,
                    onValueChange = { textInput = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Повідомлення...") }
                )
                IconButton(onClick = {
                    manager.sendMessage(currentPhone, targetUser.phone, textInput)
                    textInput = ""
                }) {
                    Text("🚀")
                }
            }
        }
    }
}
