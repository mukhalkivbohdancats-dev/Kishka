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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.google.firebase.auth.FirebaseAuth

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
    val auth = FirebaseAuth.getInstance()
    
    var currentUserEmail by remember { 
        mutableStateOf(if (auth.currentUser?.isEmailVerified == true) auth.currentUser?.email ?: "" else "") 
    }
    var selectedUserForChat by remember { mutableStateOf<User?>(null) }

    // Стан активного дзвінка
    var activeCallTargetPhone by remember { mutableStateOf<String?>(null) }
    var isCallMinimized by remember { mutableStateOf(false) }

    val startCallAction: (String) -> Unit = { targetPhone ->
        activeCallTargetPhone = targetPhone
        isCallMinimized = false
        manager.startCall(currentUserEmail, targetPhone)
    }

    // Якщо йде дзвінок і він НЕ згорнутий — показуємо повноцінний екран дзвінка
    if (activeCallTargetPhone != null && !isCallMinimized) {
        ActiveCallScreen(
            targetPhone = activeCallTargetPhone!!,
            onMinimize = {
                // Хрестик натиснуто: ховаємо вікно, розмова триває!
                isCallMinimized = true
            },
            onEndCall = {
                // Завершуємо дзвінок
                activeCallTargetPhone = null
                isCallMinimized = false
            }
        )
    } else {
        // Основний інтерфейс додатку
        Column(modifier = Modifier.fillMaxSize()) {
            // Зелений банер активного дзвінка, коли екран згорнуто
            if (activeCallTargetPhone != null && isCallMinimized) {
                ActiveCallBanner(
                    targetPhone = activeCallTargetPhone!!,
                    onExpandCall = { isCallMinimized = false },
                    onEndCall = {
                        activeCallTargetPhone = null
                        isCallMinimized = false
                    }
                )
            }

            Box(modifier = Modifier.weight(1f)) {
                if (currentUserEmail.isEmpty()) {
                    AuthScreen { email ->
                        currentUserEmail = email
                        manager.registerUserInGlobalContacts(email)
                        manager.listenForIncomingCalls(email)
                    }
                } else if (selectedUserForChat == null) {
                    ContactsScreen(
                        manager = manager,
                        currentEmail = currentUserEmail,
                        onUserSelected = { user -> selectedUserForChat = user },
                        onLogout = {
                            auth.signOut()
                            currentUserEmail = ""
                        }
                    )
                } else {
                    ChatScreen(
                        manager = manager,
                        currentEmail = currentUserEmail,
                        targetUser = selectedUserForChat!!,
                        onBack = { selectedUserForChat = null },
                        onStartCall = { phone -> startCallAction(phone) }
                    )
                }
            }
        }
    }
}

/**
 * Екран активного дзвінка з кнопкою хрестика ❌ для згортання
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActiveCallScreen(
    targetPhone: String,
    onMinimize: () -> Unit,
    onEndCall: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Активний дзвінок") },
                navigationIcon = {
                    // Хрестик ❌ - згортає вікно дзвінка, щоб можна було писати в чатах
                    IconButton(onClick = onMinimize) {
                        Text("❌", fontSize = 20.sp)
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Spacer(modifier = Modifier.height(32.dp))

            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                AsyncImage(
                    model = "https://raw.githubusercontent.com/mukhalkivbohdancats-dev/Kishka/main/app-image.png",
                    contentDescription = "Аватар",
                    modifier = Modifier
                        .size(120.dp)
                        .clip(CircleShape)
                )
                Spacer(modifier = Modifier.height(16.dp))
                Text(targetPhone, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(8.dp))
                Text("Іде розмова... 📞", fontSize = 16.sp, color = Color.Gray)
            }

            Button(
                onClick = onEndCall,
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp)
                    .height(56.dp)
            ) {
                Text("Завершити дзвінок 🔴", fontSize = 18.sp, color = Color.White)
            }
        }
    }
}

/**
 * Верхній зелений банер про те, що дзвінок згорнуто й розмова триває
 */
@Composable
fun ActiveCallBanner(
    targetPhone: String,
    onExpandCall: () -> Unit,
    onEndCall: () -> Unit
) {
    Surface(
        color = Color(0xFF2E7D32),
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onExpandCall() }
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("📞", fontSize = 18.sp)
                Spacer(modifier = Modifier.width(8.dp))
                Column {
                    Text("Дзвінок із $targetPhone", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    Text("Торкніться, щоб відкрити дзвінок", color = Color.White.copy(alpha = 0.8f), fontSize = 11.sp)
                }
            }
            IconButton(onClick = onEndCall, modifier = Modifier.size(36.dp)) {
                Text("🔴", fontSize = 18.sp)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuthScreen(onLoginSuccess: (String) -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var isRegisterMode by remember { mutableStateOf(false) }
    var isLoading by remember { mutableStateOf(false) }
    var infoMessage by remember { mutableStateOf("") }
    val context = LocalContext.current

    Scaffold(
        topBar = { TopAppBar(title = { Text("Kishka Messenger — Вхід") }) }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            AsyncImage(
                model = "https://raw.githubusercontent.com/mukhalkivbohdancats-dev/Kishka/main/app-image.png",
                contentDescription = "Логотип Kishka Messenger",
                modifier = Modifier
                    .size(96.dp)
                    .clip(CircleShape)
            )

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = if (isRegisterMode) "Створити акаунт" else "Авторизація поштою",
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold
            )

            Spacer(modifier = Modifier.height(16.dp))

            OutlinedTextField(
                value = email,
                onValueChange = { email = it.trim() },
                label = { Text("Електронна пошта (Email)") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )

            Spacer(modifier = Modifier.height(12.dp))

            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Пароль") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )

            if (infoMessage.isNotEmpty()) {
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = infoMessage,
                    color = MaterialTheme.colorScheme.primary,
                    fontSize = 14.sp
                )
            }

            Spacer(modifier = Modifier.height(20.dp))

            Button(
                onClick = {
                    if (email.contains("@") && password.length >= 6) {
                        isLoading = true
                        infoMessage = ""
                        if (isRegisterMode) {
                            AuthManager.registerUser(email, password) { success, msg ->
                                isLoading = false
                                if (success) {
                                    infoMessage = msg ?: "Лист надіслано! Підтвердіть пошту."
                                    isRegisterMode = false
                                } else {
                                    Toast.makeText(context, msg ?: "Помилка реєстрації", Toast.LENGTH_LONG).show()
                                }
                            }
                        } else {
                            AuthManager.loginUser(email, password) { success, msg ->
                                isLoading = false
                                if (success) {
                                    onLoginSuccess(email)
                                } else {
                                    Toast.makeText(context, msg ?: "Помилка входу", Toast.LENGTH_LONG).show()
                                }
                            }
                        }
                    } else {
                        Toast.makeText(context, "Введіть правильну пошту та пароль (від 6 символів)", Toast.LENGTH_SHORT).show()
                    }
                },
                modifier = Modifier.fillMaxWidth().height(50.dp),
                enabled = !isLoading
            ) {
                if (isLoading) {
                    CircularProgressIndicator(color = Color.White, modifier = Modifier.size(24.dp))
                } else {
                    Text(if (isRegisterMode) "Зареєструватися та надіслати лист" else "Увійти", fontSize = 16.sp)
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            TextButton(
                onClick = { 
                    isRegisterMode = !isRegisterMode 
                    infoMessage = ""
                }
            ) {
                Text(
                    if (isRegisterMode) "Вже є акаунт? Увійти" else "Немає акаунта? Зареєструватися",
                    fontSize = 14.sp
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContactsScreen(
    manager: KishkaManager,
    currentEmail: String,
    onUserSelected: (User) -> Unit,
    onLogout: () -> Unit
) {
    var contacts by remember { mutableStateOf(listOf<User>()) }

    LaunchedEffect(Unit) {
        manager.listenToAllContacts { fetched ->
            contacts = fetched.filter { it.phone != currentEmail }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Контакты ($currentEmail)") },
                actions = {
                    TextButton(onClick = onLogout) {
                        Text("Вийти", color = MaterialTheme.colorScheme.error)
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(modifier = Modifier.fillMaxSize().padding(padding)) {
            items(contacts) { user ->
                ListItem(
                    leadingContent = {
                        AsyncImage(
                            model = "https://raw.githubusercontent.com/mukhalkivbohdancats-dev/Kishka/main/app-image.png",
                            contentDescription = "Аватар",
                            modifier = Modifier.size(40.dp).clip(CircleShape)
                        )
                    },
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
fun ChatScreen(
    manager: KishkaManager,
    currentEmail: String,
    targetUser: User,
    onBack: () -> Unit,
    onStartCall: (String) -> Unit
) {
    var messages by remember { mutableStateOf(listOf<Message>()) }
    var textInput by remember { mutableStateOf("") }
    val context = LocalContext.current

    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri ->
        uri?.let { manager.sendFileMessage(currentEmail, targetUser.phone, it, "file") }
    }

    LaunchedEffect(targetUser.phone) {
        manager.listenForMessages(currentEmail, targetUser.phone) { newMsgs ->
            messages = newMsgs
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Text("⬅️")
                    }
                },
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        AsyncImage(
                            model = "https://raw.githubusercontent.com/mukhalkivbohdancats-dev/Kishka/main/app-image.png",
                            contentDescription = "Аватар чату",
                            modifier = Modifier.size(36.dp).clip(CircleShape)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(targetUser.phone, fontSize = 16.sp)
                    }
                },
                actions = {
                    IconButton(onClick = { onStartCall(targetUser.phone) }) {
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
                    val isMe = msg.senderPhone == currentEmail
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
                    Text("📎", fontSize = 20.sp)
                }

                OutlinedTextField(
                    value = textInput,
                    onValueChange = { textInput = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Повідомлення...") },
                    singleLine = true
                )

                Spacer(modifier = Modifier.width(4.dp))

                if (textInput.trim().isEmpty()) {
                    IconButton(onClick = {
                        Toast.makeText(context, "Затисніть для запису голосового", Toast.LENGTH_SHORT).show()
                    }) {
                        Text("🎙", fontSize = 22.sp)
                    }
                } else {
                    IconButton(onClick = {
                        manager.sendMessage(currentEmail, targetUser.phone, textInput)
                        textInput = ""
                    }) {
                        Text("🚀", fontSize = 22.sp)
                    }
                }
            }
        }
    }
}
