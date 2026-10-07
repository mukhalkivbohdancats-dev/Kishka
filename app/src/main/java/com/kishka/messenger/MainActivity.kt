package com.kishka.messenger

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.VolumeUp
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

val ViberPurple = Color(0xFF6F32E2)
val ViberLightPurple = Color(0xFFEFEBFB)
val ViberBg = Color(0xFFF5F6FA)

const val DEFAULT_AVATAR_URL = "https://raw.githubusercontent.com/mukhalkivbohdancats-dev/Kishka/main/app/src/main/res/drawable/ic_launcher.png"

object Strings {
    private val dictionary = mapOf(
        "uk" to mapOf(
            "select_lang" to "Мова інтерфейсу",
            "chats" to "Чати",
            "calls" to "Дзвінки",
            "account" to "Акаунт",
            "all" to "Усі",
            "unread" to "Непрочитані",
            "add_contact" to "Додати контакт",
            "enter_email" to "Введіть пошту (Email)",
            "add" to "Додати",
            "cancel" to "Скасувати",
            "call_history" to "Історія дзвінків Kishka",
            "account_settings" to "Налаштування акаунту",
            "your_name" to "Ваше ім'я в месенджері",
            "choose_photo" to "Обрати фото з галереї",
            "email_label" to "Пошта",
            "server_url" to "URL сервера Node.js (Socket.io)",
            "save_changes" to "Зберегти зміни",
            "logout" to "Вийти з акаунта",
            "login_title" to "Вхід у Kishka",
            "register_title" to "Створити акаунт",
            "ask_name" to "Як вас звати?",
            "password" to "Пароль",
            "register_btn" to "Зареєструватися",
            "login_btn" to "Увійти",
            "has_account" to "Вже є акаунт? Увійти",
            "no_account" to "Немає акаунта? Зареєструватися",
            "active_call" to "Активний дзвінок Kishka",
            "end_call" to "Завершити дзвінок",
            "calling_in_progress" to "Триває розмова...",
            "type_message" to "Повідомлення...",
            "user_not_found" to "Користувача з такою поштою не знайдено!",
            "contact_added" to "Контакт успішно додано!",
            "loading_data" to "Завантажуємо ваші дані..."
        ),
        "ru" to mapOf(
            "select_lang" to "Язык интерфейса",
            "chats" to "Чаты",
            "calls" to "Звонки",
            "account" to "Аккаунт",
            "all" to "Все",
            "unread" to "Непрочитанные",
            "add_contact" to "Добавить контакт",
            "enter_email" to "Введите почту (Email)",
            "add" to "Добавить",
            "cancel" to "Отмена",
            "call_history" to "История звонков Kishka",
            "account_settings" to "Настройки аккаунта",
            "your_name" to "Ваше имя в мессенджере",
            "choose_photo" to "Выбрать фото из галереи",
            "email_label" to "Почта",
            "server_url" to "URL сервера Node.js (Socket.io)",
            "save_changes" to "Сохранить изменения",
            "logout" to "Выйти из аккаунта",
            "login_title" to "Вход в Kishka",
            "register_title" to "Создать аккаунт",
            "ask_name" to "Как вас зовут?",
            "password" to "Пароль",
            "register_btn" to "Зарегистрироваться",
            "login_btn" to "Войти",
            "has_account" to "Уже есть аккаунт? Войти",
            "no_account" to "Нет аккаунта? Зарегистрироваться",
            "active_call" to "Активный звонок Kishka",
            "end_call" to "Завершить звонок",
            "calling_in_progress" to "Идет разговор...",
            "type_message" to "Сообщение...",
            "user_not_found" to "Пользователь с такой почтой не найден!",
            "contact_added" to "Контакт успешно добавлен!",
            "loading_data" to "Загружаем ваши данные..."
        ),
        "en" to mapOf(
            "select_lang" to "Interface Language",
            "chats" to "Chats",
            "calls" to "Calls",
            "account" to "Account",
            "all" to "All",
            "unread" to "Unread",
            "add_contact" to "Add Contact",
            "enter_email" to "Enter Email",
            "add" to "Add",
            "cancel" to "Cancel",
            "call_history" to "Kishka Call History",
            "account_settings" to "Account Settings",
            "your_name" to "Your Display Name",
            "choose_photo" to "Choose photo from gallery",
            "email_label" to "Email",
            "server_url" to "Node.js Server URL (Socket.io)",
            "save_changes" to "Save Changes",
            "logout" to "Log Out",
            "login_title" to "Sign in to Kishka",
            "register_title" to "Create Account",
            "ask_name" to "What is your name?",
            "password" to "Password",
            "register_btn" to "Register",
            "login_btn" to "Log In",
            "has_account" to "Already have an account? Sign In",
            "no_account" to "No account? Register",
            "active_call" to "Active Kishka Call",
            "end_call" to "End Call",
            "calling_in_progress" to "Call in progress...",
            "type_message" to "Message...",
            "user_not_found" to "User with this email not found!",
            "contact_added" to "Contact successfully added!",
            "loading_data" to "Loading your data..."
        )
    )

    fun get(key: String, lang: String): String {
        return dictionary[lang]?.get(key) ?: dictionary["uk"]?.get(key) ?: key
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(
                colorScheme = lightColorScheme(
                    primary = ViberPurple,
                    secondary = ViberLightPurple,
                    background = ViberBg
                )
            ) {
                KishkaApp()
            }
        }
    }
}

@Composable
fun LoadingDataScreen(lang: String) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(ViberBg),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            CircularProgressIndicator(
                color = ViberPurple,
                modifier = Modifier.size(54.dp),
                strokeWidth = 4.dp
            )
            Spacer(modifier = Modifier.height(20.dp))
            Text(
                text = Strings.get("loading_data", lang),
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
                color = Color.DarkGray
            )
        }
    }
}

@Composable
fun KishkaApp() {
    val context = LocalContext.current
    val manager = remember { KishkaManager(context) }
    val auth = FirebaseAuth.getInstance()

    var currentLanguage by remember { mutableStateOf("uk") }

    var currentUserEmail by remember {
        mutableStateOf(if (auth.currentUser?.isEmailVerified == true) auth.currentUser?.email?.lowercase() ?: "" else "")
    }
    var currentDisplayName by remember { mutableStateOf("") }
    var avatarUrl by remember { mutableStateOf(DEFAULT_AVATAR_URL) }

    var isDataLoading by remember { mutableStateOf(false) }

    var selectedUserForChat by remember { mutableStateOf<User?>(null) }
    var selectedBottomTab by remember { mutableStateOf(0) }

    var activeCallTargetPhone by remember { mutableStateOf<String?>(null) }
    var isCallMinimized by remember { mutableStateOf(false) }

    LaunchedEffect(currentUserEmail) {
        if (currentUserEmail.isNotEmpty()) {
            isDataLoading = true
            manager.listenForIncomingCalls(currentUserEmail)
            
            manager.getUserProfile(currentUserEmail) { user ->
                if (user != null) {
                    if (user.name.isNotEmpty()) {
                        currentDisplayName = user.name
                    } else if (currentDisplayName.isEmpty()) {
                        currentDisplayName = currentUserEmail.substringBefore("@")
                    }
                    if (!user.avatarUrl.isNullOrEmpty()) {
                        avatarUrl = user.avatarUrl
                    }
                } else {
                    val nameToSave = if (currentDisplayName.isNotEmpty()) currentDisplayName else currentUserEmail.substringBefore("@")
                    manager.registerOrUpdateUserInDb(currentUserEmail, nameToSave)
                    currentDisplayName = nameToSave
                }
                isDataLoading = false
            }
        } else {
            isDataLoading = false
        }
    }

    val startCallAction: (String) -> Unit = { targetEmail ->
        activeCallTargetPhone = targetEmail
        isCallMinimized = false

        val serviceIntent = Intent(context, CallService::class.java).apply {
            action = CallService.ACTION_START_CALL
            putExtra(CallService.EXTRA_TARGET_NAME, targetEmail)
            putExtra(CallService.EXTRA_TARGET_PHONE, targetEmail)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent)
        } else {
            context.startService(serviceIntent)
        }
        manager.startCall(currentUserEmail, targetEmail)
    }

    val stopCallAction: () -> Unit = {
        val serviceIntent = Intent(context, CallService::class.java).apply {
            action = CallService.ACTION_END_CALL
        }
        context.startService(serviceIntent)
        activeCallTargetPhone = null
        isCallMinimized = false
    }

    if (activeCallTargetPhone != null && !isCallMinimized) {
        ActiveCallScreen(
            targetPhone = activeCallTargetPhone!!,
            avatarUrl = avatarUrl,
            lang = currentLanguage,
            onMinimize = { isCallMinimized = true },
            onEndCall = stopCallAction
        )
    } else if (isDataLoading && currentUserEmail.isNotEmpty()) {
        LoadingDataScreen(lang = currentLanguage)
    } else {
        Column(modifier = Modifier.fillMaxSize().background(ViberBg)) {
            if (activeCallTargetPhone != null && isCallMinimized) {
                ActiveCallBanner(
                    targetPhone = activeCallTargetPhone!!,
                    onExpandCall = { isCallMinimized = false },
                    onEndCall = stopCallAction
                )
            }

            Box(modifier = Modifier.weight(1f)) {
                if (currentUserEmail.isEmpty()) {
                    AuthScreen(
                        currentLang = currentLanguage,
                        onLangChanged = { currentLanguage = it },
                        onLoginSuccess = { email, name ->
                            if (name.isNotEmpty()) {
                                currentDisplayName = name
                            }
                            currentUserEmail = email.lowercase()
                        }
                    )
                } else if (selectedUserForChat != null) {
                    ChatScreen(
                        manager = manager,
                        currentEmail = currentUserEmail,
                        targetUser = selectedUserForChat!!,
                        lang = currentLanguage,
                        onBack = { selectedUserForChat = null },
                        onStartCall = { email -> startCallAction(email) }
                    )
                } else {
                    when (selectedBottomTab) {
                        0 -> ChatsTab(
                            manager = manager,
                            currentEmail = currentUserEmail,
                            lang = currentLanguage,
                            onUserSelected = { selectedUserForChat = it }
                        )
                        1 -> CallsTab(
                            manager = manager,
                            currentEmail = currentUserEmail,
                            lang = currentLanguage,
                            onStartCall = { email -> startCallAction(email) }
                        )
                        2 -> AccountTab(
                            manager = manager,
                            displayName = currentDisplayName,
                            email = currentUserEmail,
                            avatarUrl = avatarUrl,
                            currentLang = currentLanguage,
                            onLangChanged = { currentLanguage = it },
                            onProfileUpdated = { newName, newAvatarUrl ->
                                currentDisplayName = newName
                                if (!newAvatarUrl.isNullOrEmpty()) {
                                    avatarUrl = newAvatarUrl
                                }
                            },
                            onLogout = {
                                auth.signOut()
                                currentUserEmail = ""
                                currentDisplayName = ""
                                avatarUrl = DEFAULT_AVATAR_URL
                            }
                        )
                    }
                }
            }

            if (currentUserEmail.isNotEmpty() && selectedUserForChat == null) {
                NavigationBar(containerColor = Color.White, tonalElevation = 8.dp) {
                    NavigationBarItem(
                        selected = selectedBottomTab == 0,
                        onClick = { selectedBottomTab = 0 },
                        icon = { Icon(Icons.Default.Call, contentDescription = null) },
                        label = { Text(Strings.get("chats", currentLanguage)) }
                    )
                    NavigationBarItem(
                        selected = selectedBottomTab == 1,
                        onClick = { selectedBottomTab = 1 },
                        icon = { Icon(Icons.Default.VolumeUp, contentDescription = null) },
                        label = { Text(Strings.get("calls", currentLanguage)) }
                    )
                    NavigationBarItem(
                        selected = selectedBottomTab == 2,
                        onClick = { selectedBottomTab = 2 },
                        icon = { Icon(Icons.Default.Person, contentDescription = null) },
                        label = { Text(Strings.get("account", currentLanguage)) }
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LanguageSelector(currentLang: String, onLangSelected: (String) -> Unit) {
    val languages = listOf("uk" to "Укр", "ru" to "Рус", "en" to "Eng")
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(
            text = Strings.get("select_lang", currentLang),
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
            color = Color.Gray,
            modifier = Modifier.padding(bottom = 4.dp)
        )
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            languages.forEach { (code, label) ->
                FilterChip(
                    selected = currentLang == code,
                    onClick = { onLangSelected(code) },
                    label = { Text(label, fontSize = 12.sp) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = ViberLightPurple,
                        selectedLabelColor = ViberPurple
                    )
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatsTab(
    manager: KishkaManager,
    currentEmail: String,
    lang: String,
    onUserSelected: (User) -> Unit
) {
    var contacts by remember { mutableStateOf(listOf<User>()) }
    var selectedFilter by remember { mutableStateOf(Strings.get("all", lang)) }
    var showAddContactDialog by remember { mutableStateOf(false) }
    var newContactEmail by remember { mutableStateOf("") }
    var isAddingContact by remember { mutableStateOf(false) }
    val context = LocalContext.current

    LaunchedEffect(currentEmail) {
        manager.listenToUserContacts(currentEmail) { fetched ->
            contacts = fetched
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Kishka Messenger", fontWeight = FontWeight.Bold, color = ViberPurple) },
                actions = {
                    IconButton(onClick = { showAddContactDialog = true }) {
                        Icon(Icons.Default.Call, contentDescription = null, tint = ViberPurple)
                    }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            Row(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                listOf(Strings.get("all", lang), Strings.get("unread", lang)).forEach { filter ->
                    FilterChip(
                        selected = selectedFilter == filter,
                        onClick = { selectedFilter = filter },
                        label = { Text(filter) },
                        modifier = Modifier.padding(end = 8.dp),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = ViberLightPurple,
                            selectedLabelColor = ViberPurple
                        )
                    )
                }
            }

            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(contacts) { user ->
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 4.dp)
                            .clickable { onUserSelected(user) },
                        shape = RoundedCornerShape(16.dp),
                        color = Color.White
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            AsyncImage(
                                model = if (user.avatarUrl.isNullOrEmpty()) DEFAULT_AVATAR_URL else user.avatarUrl,
                                contentDescription = "Avatar",
                                modifier = Modifier.size(52.dp).clip(CircleShape)
                            )
                            Spacer(modifier = Modifier.width(12.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(user.name.ifEmpty { user.email }, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                                Text(user.email, color = Color.Gray, fontSize = 13.sp)
                            }
                        }
                    }
                }
            }
        }
    }

    if (showAddContactDialog) {
        AlertDialog(
            onDismissRequest = { if (!isAddingContact) showAddContactDialog = false },
            title = { Text(Strings.get("add_contact", lang)) },
            text = {
                OutlinedTextField(
                    value = newContactEmail,
                    onValueChange = { newContactEmail = it },
                    label = { Text(Strings.get("enter_email", lang)) },
                    singleLine = true,
                    enabled = !isAddingContact
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        isAddingContact = true
                        manager.addContactByEmail(currentEmail, newContactEmail) { success, _, message ->
                            isAddingContact = false
                            Toast.makeText(context, message ?: "", Toast.LENGTH_LONG).show()
                            if (success) {
                                showAddContactDialog = false
                                newContactEmail = ""
                                manager.listenToUserContacts(currentEmail) { fetched ->
                                    contacts = fetched
                                }
                            }
                        }
                    },
                    enabled = !isAddingContact && newContactEmail.isNotBlank()
                ) {
                    if (isAddingContact) {
                        CircularProgressIndicator(color = Color.White, modifier = Modifier.size(18.dp))
                    } else {
                        Text(Strings.get("add", lang))
                    }
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showAddContactDialog = false },
                    enabled = !isAddingContact
                ) {
                    Text(Strings.get("cancel", lang))
                }
            }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountTab(
    manager: KishkaManager,
    displayName: String,
    email: String,
    avatarUrl: String,
    currentLang: String,
    onLangChanged: (String) -> Unit,
    onProfileUpdated: (String, String?) -> Unit,
    onLogout: () -> Unit
) {
    var nameInput by remember(displayName) { mutableStateOf(displayName) }
    var serverUrlInput by remember { mutableStateOf(KishkaManager.SERVER_URL) }
    var selectedPhotoUri by remember { mutableStateOf<Uri?>(null) }
    var isLoading by remember { mutableStateOf(false) }
    val context = LocalContext.current

    val photoPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        selectedPhotoUri = uri
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text(Strings.get("account_settings", currentLang), fontWeight = FontWeight.Bold) }) }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            AsyncImage(
                model = selectedPhotoUri ?: if (avatarUrl.isNotEmpty()) avatarUrl else DEFAULT_AVATAR_URL,
                contentDescription = "Avatar",
                modifier = Modifier
                    .size(100.dp)
                    .clip(CircleShape)
                    .clickable { photoPickerLauncher.launch("image/*") }
            )

            Spacer(modifier = Modifier.height(8.dp))

            OutlinedButton(onClick = { photoPickerLauncher.launch("image/*") }) {
                Text(Strings.get("choose_photo", currentLang))
            }

            Spacer(modifier = Modifier.height(12.dp))

            LanguageSelector(currentLang = currentLang, onLangSelected = onLangChanged)

            Spacer(modifier = Modifier.height(12.dp))

            OutlinedTextField(
                value = nameInput,
                onValueChange = { nameInput = it },
                label = { Text(Strings.get("your_name", currentLang)) },
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(10.dp))

            OutlinedTextField(
                value = serverUrlInput,
                onValueChange = {
                    serverUrlInput = it
                    KishkaManager.SERVER_URL = it
                },
                label = { Text(Strings.get("server_url", currentLang)) },
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(8.dp))
            Text("${Strings.get("email_label", currentLang)}: $email", color = Color.Gray, fontSize = 14.sp)

            Spacer(modifier = Modifier.height(20.dp))

            Button(
                onClick = {
                    isLoading = true
                    manager.updateUserProfile(email, nameInput, selectedPhotoUri) { success, newUrl ->
                        isLoading = false
                        if (success) {
                            onProfileUpdated(nameInput, newUrl)
                            Toast.makeText(context, "Оновлено успішно!", Toast.LENGTH_SHORT).show()
                        } else {
                            Toast.makeText(context, "Помилка збереження", Toast.LENGTH_SHORT).show()
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth().height(48.dp),
                colors = ButtonDefaults.buttonColors(containerColor = ViberPurple),
                enabled = !isLoading
            ) {
                if (isLoading) {
                    CircularProgressIndicator(color = Color.White, modifier = Modifier.size(24.dp))
                } else {
                    Text(Strings.get("save_changes", currentLang), fontSize = 16.sp)
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            OutlinedButton(
                onClick = onLogout,
                modifier = Modifier.fillMaxWidth().height(48.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.Red)
            ) {
                Text(Strings.get("logout", currentLang), fontSize = 16.sp)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CallsTab(
    manager: KishkaManager,
    currentEmail: String,
    lang: String,
    onStartCall: (String) -> Unit
) {
    var callLogs by remember { mutableStateOf(listOf<CallLogItem>()) }

    LaunchedEffect(currentEmail) {
        manager.listenForCallHistory(currentEmail) { logs ->
            callLogs = logs
        }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text(Strings.get("call_history", lang), fontWeight = FontWeight.Bold) }) }
    ) { padding ->
        if (callLogs.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center
            ) {
                Text("Історія порожня", color = Color.Gray)
            }
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize().padding(padding)) {
                items(callLogs) { log ->
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 4.dp),
                        shape = RoundedCornerShape(16.dp),
                        color = Color.White
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Call, contentDescription = null, tint = ViberPurple)
                                Spacer(modifier = Modifier.width(12.dp))
                                Column {
                                    Text(
                                        log.callerName,
                                        fontWeight = FontWeight.Bold,
                                        color = if (log.isMissed) Color.Red else Color.Unspecified
                                    )
                                    Text("${log.time} • ${log.duration}", color = Color.Gray, fontSize = 12.sp)
                                }
                            }
                            IconButton(onClick = { onStartCall(log.callerEmail) }) {
                                Icon(Icons.Default.Call, contentDescription = null, tint = ViberPurple)
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuthScreen(
    currentLang: String,
    onLangChanged: (String) -> Unit,
    onLoginSuccess: (String, String) -> Unit
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var isRegisterMode by remember { mutableStateOf(false) }
    var isLoading by remember { mutableStateOf(false) }
    var infoMessage by remember { mutableStateOf("") }
    val context = LocalContext.current

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            AsyncImage(
                model = DEFAULT_AVATAR_URL,
                contentDescription = "Logo",
                modifier = Modifier.size(80.dp).clip(CircleShape)
            )

            Spacer(modifier = Modifier.height(10.dp))
            LanguageSelector(currentLang = currentLang, onLangSelected = onLangChanged)
            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = if (isRegisterMode) Strings.get("register_title", currentLang) else Strings.get("login_title", currentLang),
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = ViberPurple
            )

            Spacer(modifier = Modifier.height(14.dp))

            if (isRegisterMode) {
                OutlinedTextField(
                    value = displayName,
                    onValueChange = { displayName = it },
                    label = { Text(Strings.get("ask_name", currentLang)) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
                Spacer(modifier = Modifier.height(10.dp))
            }

            OutlinedTextField(
                value = email,
                onValueChange = { email = it.trim() },
                label = { Text(Strings.get("enter_email", currentLang)) },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )

            Spacer(modifier = Modifier.height(10.dp))

            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text(Strings.get("password", currentLang)) },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )

            if (infoMessage.isNotEmpty()) {
                Spacer(modifier = Modifier.height(10.dp))
                Text(infoMessage, color = ViberPurple, fontSize = 13.sp)
            }

            Spacer(modifier = Modifier.height(18.dp))

            Button(
                onClick = {
                    if (email.contains("@") && password.length >= 6) {
                        isLoading = true
                        infoMessage = ""
                        if (isRegisterMode) {
                            AuthManager.registerUser(email, password) { success, msg ->
                                isLoading = false
                                if (success) {
                                    infoMessage = msg ?: "Лист підтвердження надіслано!"
                                    isRegisterMode = false
                                } else {
                                    Toast.makeText(context, msg ?: "Помилка", Toast.LENGTH_LONG).show()
                                }
                            }
                        } else {
                            AuthManager.loginUser(email, password) { success, msg ->
                                isLoading = false
                                if (success) {
                                    onLoginSuccess(email, displayName)
                                } else {
                                    Toast.makeText(context, msg ?: "Помилка входу", Toast.LENGTH_LONG).show()
                                }
                            }
                        }
                    } else {
                        Toast.makeText(context, "Перевірте пошту та пароль (мін. 6 символів)", Toast.LENGTH_SHORT).show()
                    }
                },
                modifier = Modifier.fillMaxWidth().height(50.dp),
                colors = ButtonDefaults.buttonColors(containerColor = ViberPurple),
                enabled = !isLoading
            ) {
                if (isLoading) {
                    CircularProgressIndicator(color = Color.White, modifier = Modifier.size(24.dp))
                } else {
                    Text(
                        if (isRegisterMode) Strings.get("register_btn", currentLang) else Strings.get("login_btn", currentLang),
                        fontSize = 16.sp
                    )
                }
            }

            Spacer(modifier = Modifier.height(10.dp))

            TextButton(onClick = { isRegisterMode = !isRegisterMode }) {
                Text(
                    if (isRegisterMode) Strings.get("has_account", currentLang) else Strings.get("no_account", currentLang),
                    color = ViberPurple
                )
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
    lang: String,
    onBack: () -> Unit,
    onStartCall: (String) -> Unit
) {
    var messages by remember { mutableStateOf(listOf<Message>()) }
    var textInput by remember { mutableStateOf("") }

    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { manager.sendFileMessage(currentEmail, targetUser.email, it, "file") }
    }

    DisposableEffect(targetUser.email) {
        manager.connectAndListenForMessages(currentEmail, targetUser.email) { updatedList ->
            messages = updatedList
        }
        onDispose {
            manager.leaveChatRoom()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = {
                        manager.leaveChatRoom()
                        onBack()
                    }) {
                        Icon(Icons.Default.Close, contentDescription = null)
                    }
                },
                title = { Text(targetUser.name.ifEmpty { targetUser.email }) },
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
                modifier = Modifier.weight(1f).padding(8.dp),
                reverseLayout = false
            ) {
                items(messages) { msg ->
                    val isMe = msg.senderEmail == currentEmail
                    Box(
                        modifier = Modifier.fillMaxWidth(),
                        contentAlignment = if (isMe) Alignment.CenterEnd else Alignment.CenterStart
                    ) {
                        Surface(
                            color = if (isMe) ViberPurple else Color.White,
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.padding(4.dp)
                        ) {
                            Text(
                                text = msg.text,
                                color = if (isMe) Color.White else Color.Black,
                                modifier = Modifier.padding(10.dp)
                            )
                        }
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth().padding(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = { filePicker.launch("*/*") }) {
                    Icon(Icons.Default.Mic, contentDescription = null, tint = ViberPurple)
                }
                OutlinedTextField(
                    value = textInput,
                    onValueChange = { textInput = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text(Strings.get("type_message", lang)) },
                    singleLine = true
                )
                IconButton(
                    onClick = {
                        if (textInput.isNotEmpty()) {
                            manager.sendMessage(currentEmail, targetUser.email, textInput)
                            textInput = ""
                        }
                    }
                ) {
                    Icon(Icons.Default.Call, contentDescription = null, tint = ViberPurple)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActiveCallScreen(
    targetPhone: String,
    avatarUrl: String,
    lang: String,
    onMinimize: () -> Unit,
    onEndCall: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(Strings.get("active_call", lang)) },
                navigationIcon = {
                    IconButton(onClick = onMinimize) {
                        Icon(Icons.Default.Close, contentDescription = null)
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Spacer(modifier = Modifier.height(32.dp))

            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                AsyncImage(
                    model = if (avatarUrl.isNotEmpty()) avatarUrl else DEFAULT_AVATAR_URL,
                    contentDescription = "Avatar",
                    modifier = Modifier.size(120.dp).clip(CircleShape)
                )
                Spacer(modifier = Modifier.height(16.dp))
                Text(targetPhone, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(8.dp))
                Text(Strings.get("calling_in_progress", lang), fontSize = 16.sp, color = Color.Gray)
            }

            Button(
                onClick = onEndCall,
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                modifier = Modifier.fillMaxWidth().padding(24.dp).height(56.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.CallEnd, contentDescription = null, tint = Color.White)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(Strings.get("end_call", lang), fontSize = 18.sp, color = Color.White)
                }
            }
        }
    }
}

@Composable
fun ActiveCallBanner(
    targetPhone: String,
    onExpandCall: () -> Unit,
    onEndCall: () -> Unit
) {
    Surface(
        color = Color(0xFF2E7D32),
        modifier = Modifier.fillMaxWidth().clickable { onExpandCall() }
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Call, contentDescription = null, tint = Color.White)
                Spacer(modifier = Modifier.width(8.dp))
                Column {
                    Text("Дзвінок: $targetPhone", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    Text("Натисніть для повернення", color = Color.White.copy(alpha = 0.8f), fontSize = 11.sp)
                }
            }
            IconButton(onClick = onEndCall, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Default.CallEnd, contentDescription = null, tint = Color.White)
            }
        }
    }
}
