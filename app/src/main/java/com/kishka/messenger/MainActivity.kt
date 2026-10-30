package com.kishka.messenger

import android.Manifest
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pets
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallMade
import androidx.compose.material.icons.filled.CallMissed
import androidx.compose.material.icons.filled.CallReceived
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import com.google.firebase.auth.FirebaseAuth

val ViberPurple = Color(0xFF6F32E2)
val ViberLightPurple = Color(0xFFEFEBFB)
val ViberBg = Color(0xFFF5F6FA)

const val DEFAULT_AVATAR_URL = "https://raw.githubusercontent.com/mukhalkivbohdancats-dev/Kishka/main/app/src/main/res/drawable/ic_launcher.png"

object Strings {
    private val dictionary = mapOf(
        "uk" to mapOf(
            "no_internet" to "Немає підключення до інтернету",
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
            "loading_data" to "Завантажуємо ваші дані...",
            "permissions_title" to "Необхідні дозволи",
            "permissions_desc" to "Для повноцінної роботи месенджера надайте дозволи на мікрофон та сповіщення.",
            "grant_mic" to "Дозволити мікрофон",
            "grant_notif" to "Дозволити сповіщення",
            "continue_app" to "Продовжити в месенджер",
            "copy" to "Копіювати",
            "delete" to "Видалити",
            "message_copied" to "Скопійовано в буфер обміну",
            "incoming_call" to "Вхідний дзвінок",
            "answer" to "Відповісти",
            "decline" to "Відхилити",
            "gemini" to "Gemini",
            "gemini_subtitle" to "Штучний інтелект",
            "gemini_empty" to "Привіт! Я Gemini. Запитайте мене про що завгодно — я пам'ятаю нашу розмову.",
            "gemini_thinking" to "Gemini думає...",
            "gemini_clear" to "Очистити пам'ять",
            "gemini_clear_confirm" to "Видалити всю історію та пам'ять вашої розмови з Gemini?",
            "gemini_cleared" to "Пам'ять Gemini очищено",
            "gemini_error" to "Gemini зараз недоступний. Спробуйте пізніше.",
            "ai_preview" to "Кішка ШІ (Kishka)",
            "no_contacts" to "Контактів поки немає. Натисніть значок додавання вгорі, щоб додати людину за поштою.",
            "unread_empty" to "Непрочитаних повідомлень немає",
            "resend_verification" to "Надіслати лист підтвердження ще раз"
        ),
        "ru" to mapOf(
            "no_internet" to "Нет подключения к интернету",
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
            "loading_data" to "Загружаем ваши данные...",
            "permissions_title" to "Необходимые разрешения",
            "permissions_desc" to "Для полноценной работы мессенджера предоставьте разрешения на микрофон и уведомления.",
            "grant_mic" to "Разрешить микрофон",
            "grant_notif" to "Разрешить уведомления",
            "continue_app" to "Продолжить в мессенджер",
            "copy" to "Скопировать",
            "delete" to "Удалить",
            "message_copied" to "Скопировано в буфер обмена",
            "incoming_call" to "Входящий звонок",
            "answer" to "Ответить",
            "decline" to "Отклонить",
            "gemini" to "Gemini",
            "gemini_subtitle" to "Искусственный интеллект",
            "gemini_empty" to "Привет! Я Gemini. Спросите меня о чём угодно — я помню наш разговор.",
            "gemini_thinking" to "Gemini думает...",
            "gemini_clear" to "Очистить память",
            "gemini_clear_confirm" to "Удалить всю историю и память вашего разговора с Gemini?",
            "gemini_cleared" to "Память Gemini очищена",
            "gemini_error" to "Gemini сейчас недоступен. Попробуйте позже.",
            "ai_preview" to "Кішка ИИ (Kishka)",
            "no_contacts" to "Контактов пока нет. Нажмите значок добавления вверху, чтобы добавить человека по почте.",
            "unread_empty" to "Непрочитанных сообщений нет",
            "resend_verification" to "Отправить письмо подтверждения ещё раз"
        ),
        "en" to mapOf(
            "no_internet" to "No internet connection",
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
            "loading_data" to "Loading your data...",
            "permissions_title" to "Required Permissions",
            "permissions_desc" to "To use all features of the messenger, please grant Microphone and Notification permissions.",
            "grant_mic" to "Allow Microphone",
            "grant_notif" to "Allow Notifications",
            "continue_app" to "Continue to Messenger",
            "copy" to "Copy",
            "delete" to "Delete",
            "message_copied" to "Copied to clipboard",
            "incoming_call" to "Incoming Call",
            "answer" to "Answer",
            "decline" to "Decline",
            "gemini" to "Gemini",
            "gemini_subtitle" to "Artificial Intelligence",
            "gemini_empty" to "Hi! I'm Gemini. Ask me anything — I remember our conversation.",
            "gemini_thinking" to "Gemini is thinking...",
            "gemini_clear" to "Clear memory",
            "gemini_clear_confirm" to "Delete the whole history and memory of your conversation with Gemini?",
            "gemini_cleared" to "Gemini memory cleared",
            "gemini_error" to "Gemini is unavailable right now. Please try again later.",
            "ai_preview" to "Kishka AI",
            "no_contacts" to "No contacts yet. Tap the add icon at the top to add someone by email.",
            "unread_empty" to "No unread messages",
            "resend_verification" to "Send the confirmation email again"
        )
    )

    fun get(key: String, lang: String): String {
        return dictionary[lang]?.get(key) ?: dictionary["uk"]?.get(key) ?: key
    }
}

class MainActivity : ComponentActivity() {

    companion object {
        /** Додатковий параметр сповіщення про повідомлення: відкрити чат з цим email. */
        const val EXTRA_OPEN_CHAT = "EXTRA_OPEN_CHAT"

        /** Запит на відкриття чату (з сповіщення). Обробляється в KishkaApp. */
        val openChatRequest = mutableStateOf<String?>(null)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleLaunchIntent(intent)

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

    // Активність у режимі singleTask: натискання на сповіщення / кнопку "Прийняти" приходить сюди
    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleLaunchIntent(intent)
    }

    private fun handleLaunchIntent(launchIntent: Intent?) {
        if (launchIntent == null) return

        if (launchIntent.getBooleanExtra("EXTRA_SHOW_ON_LOCK", false)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setShowWhenLocked(true)
                setTurnScreenOn(true)
                val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
                keyguardManager.requestDismissKeyguard(this, null)
            } else {
                @Suppress("DEPRECATION")
                window.addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
                            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                )
            }
            launchIntent.removeExtra("EXTRA_SHOW_ON_LOCK")
        }

        launchIntent.getStringExtra(EXTRA_OPEN_CHAT)?.let {
            openChatRequest.value = it
            launchIntent.removeExtra(EXTRA_OPEN_CHAT)
        }

        when (launchIntent.getStringExtra(CallCoordinator.EXTRA_CALL_ACTION)) {
            CallCoordinator.CALL_ACTION_ACCEPT -> {
                CallCoordinator.accept()
                CallCoordinator.expand()
            }
            CallCoordinator.CALL_ACTION_OPEN -> CallCoordinator.expand()
        }
        launchIntent.removeExtra(CallCoordinator.EXTRA_CALL_ACTION)
    }
}


@Composable
fun OfflineBanner(lang: String) {
    Surface(
        color = Color(0xFFD32F2F),
        modifier = Modifier.fillMaxWidth()
    ) {
        Box(
            modifier = Modifier.padding(vertical = 6.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = Strings.get("no_internet", lang),
                color = Color.White,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold
            )
        }
    }
}

/** Вкладки: 0 Чати, 1 Дзвінки, 2 Gemini, 3 Кішка ШІ (Kishka AI), 4 Акаунт. */
private const val TAB_CHATS = 0
private const val TAB_CALLS = 1
private const val TAB_GEMINI = 2
private const val TAB_PREVIEW = 3
private const val TAB_ACCOUNT = 4

private fun tabLabelKey(index: Int): String = when (index) {
    TAB_CHATS -> "chats"
    TAB_CALLS -> "calls"
    TAB_GEMINI -> "gemini"
    TAB_PREVIEW -> "ai_preview"
    else -> "account"
}

@Composable
private fun TabIcon(index: Int) {
    when (index) {
        TAB_CHATS -> Icon(Icons.Default.Chat, contentDescription = null)
        TAB_CALLS -> Icon(Icons.Default.Call, contentDescription = null)
        TAB_GEMINI -> AsyncImage(model = GEMINI_LOGO_URL, contentDescription = null, modifier = Modifier.size(24.dp))
        TAB_PREVIEW -> Icon(Icons.Default.Pets, contentDescription = null)
        else -> Icon(Icons.Default.Person, contentDescription = null)
    }
}

@Composable
fun KishkaApp() {
    val context = LocalContext.current
    val manager = remember { KishkaManager(context) }
    val auth = FirebaseAuth.getInstance()

    var isConnected by remember { mutableStateOf(true) }
    var currentLanguage by remember { mutableStateOf(AuthManager.getSavedLanguage(context)) }

    var currentUserEmail by remember {
        mutableStateOf(if (auth.currentUser?.isEmailVerified == true) auth.currentUser?.email?.lowercase() ?: "" else "")
    }
    var currentDisplayName by remember { mutableStateOf("") }
    var avatarUrl by remember { mutableStateOf(DEFAULT_AVATAR_URL) }

    var isDataLoading by remember { mutableStateOf(false) }
    var permissionsGranted by remember { mutableStateOf(checkPermissionsGranted(context)) }

    var selectedUserForChat by remember { mutableStateOf<User?>(null) }
    var selectedBottomTab by rememberSaveable { mutableStateOf(TAB_CHATS) }

    val configuration = LocalConfiguration.current
    // Планшет або телефон у горизонтальному положенні: бічна панель і дві колонки
    val isWide = configuration.screenWidthDp >= 600

    LaunchedEffect(Unit) {
        manager.observeNetworkState { connected ->
            isConnected = connected
        }
    }

    LaunchedEffect(currentUserEmail) {
        if (currentUserEmail.isNotEmpty()) {
            isDataLoading = true

            // Фоновий слухач повідомлень, служба й слухач дзвінків (працюють і коли застосунок закрито)
            manager.startGlobalMessageListener(currentUserEmail)
            KishkaConnectionService.start(context)
            CallCoordinator.init(context, currentUserEmail)

            val savedNameInAuth = AuthManager.getCurrentUserDisplayName()
            val savedPhotoInAuth = AuthManager.getCurrentUserPhotoUrl()

            if (savedNameInAuth.isNotEmpty()) currentDisplayName = savedNameInAuth
            if (!savedPhotoInAuth.isNullOrEmpty()) avatarUrl = savedPhotoInAuth

            manager.getUserProfile(currentUserEmail) { user ->
                val nameToSave = if (user != null && user.name.isNotEmpty()) user.name else if (currentDisplayName.isNotEmpty()) currentDisplayName else currentUserEmail.substringBefore("@")
                val photoToSave = if (user != null && !user.avatarUrl.isNullOrEmpty()) user.avatarUrl else avatarUrl

                currentDisplayName = nameToSave
                if (!photoToSave.isNullOrEmpty()) avatarUrl = photoToSave

                manager.registerOrUpdateUserInDb(currentUserEmail, nameToSave, photoToSave)
                isDataLoading = false
            }
        } else {
            isDataLoading = false
        }
    }

    // Один раз просимо дозволити роботу у фоні без обмежень батареї
    LaunchedEffect(permissionsGranted, currentUserEmail) {
        if (permissionsGranted && currentUserEmail.isNotEmpty()) {
            KishkaConnectionService.requestBatteryExemption(context)
        }
    }

    // Натискання на сповіщення про повідомлення відкриває потрібний чат
    val openRequest = MainActivity.openChatRequest.value
    LaunchedEffect(openRequest, currentUserEmail) {
        val target = openRequest
        if (target != null && currentUserEmail.isNotEmpty()) {
            val known = ContactsRepo.contacts.firstOrNull { it.email == target.trim().lowercase() }
            selectedUserForChat = known ?: User(uid = target, email = target.trim().lowercase(), name = target.substringBefore("@"), avatarUrl = DEFAULT_AVATAR_URL)
            selectedBottomTab = TAB_CHATS
            MainActivity.openChatRequest.value = null
        }
    }

    val startCallAction: (String) -> Unit = { targetEmail ->
        val clean = targetEmail.trim().lowercase()
        val contact = ContactsRepo.contacts.firstOrNull { it.email == clean }
        CallCoordinator.startOutgoing(clean, contact?.name, contact?.avatarUrl)
    }

    val doLogout: () -> Unit = {
        CallCoordinator.reset()
        KishkaConnectionService.stop(context)
        manager.resetSession()
        auth.signOut()
        currentUserEmail = ""
        currentDisplayName = ""
        avatarUrl = DEFAULT_AVATAR_URL
        selectedUserForChat = null
        selectedBottomTab = TAB_CHATS
    }

    val onLangChanged: (String) -> Unit = { lang ->
        currentLanguage = lang
        AuthManager.saveLanguage(context, lang)
    }

    val onProfileUpdated: (String, String?) -> Unit = { newName, newAvatarUrl ->
        currentDisplayName = newName
        if (!newAvatarUrl.isNullOrEmpty()) avatarUrl = newAvatarUrl
    }

    val callPhase = CallSession.phase
    val signedIn = currentUserEmail.isNotEmpty()

    Column(modifier = Modifier.fillMaxSize().background(ViberBg)) {
        if (!isConnected) {
            OfflineBanner(lang = currentLanguage)
        }

        // Дзвінок згорнуто: смужка зверху, дзвінок триває
        if (signedIn && callPhase != CallPhase.IDLE && CallSession.minimized) {
            CallBanner(lang = currentLanguage)
        }

        if (signedIn && callPhase != CallPhase.IDLE && !CallSession.minimized) {
            CallScreen(lang = currentLanguage)
        } else if (!permissionsGranted && signedIn) {
            PermissionsScreen(
                lang = currentLanguage,
                onPermissionsGranted = { permissionsGranted = true }
            )
        } else if (isDataLoading && signedIn) {
            LoadingDataScreen(lang = currentLanguage)
        } else if (!signedIn) {
            AuthScreen(
                currentLang = currentLanguage,
                onLangChanged = onLangChanged,
                onLoginSuccess = { email, name ->
                    if (name.isNotEmpty()) currentDisplayName = name
                    currentUserEmail = email.lowercase()
                }
            )
        } else {
            val tabContent: @Composable () -> Unit = {
                MainTabContent(
                    selectedBottomTab = selectedBottomTab,
                    manager = manager,
                    currentUserEmail = currentUserEmail,
                    currentDisplayName = currentDisplayName,
                    avatarUrl = avatarUrl,
                    currentLanguage = currentLanguage,
                    onLangChanged = onLangChanged,
                    onUserSelected = { selectedUserForChat = it },
                    onStartCall = startCallAction,
                    onProfileUpdated = onProfileUpdated,
                    onLogout = doLogout
                )
            }
            val chatContent: @Composable () -> Unit = {
                val chatUser = selectedUserForChat
                if (chatUser != null) {
                    ChatScreen(
                        manager = manager,
                        currentEmail = currentUserEmail,
                        targetUser = chatUser,
                        lang = currentLanguage,
                        onBack = { selectedUserForChat = null },
                        onStartCall = { email -> startCallAction(email) }
                    )
                }
            }

            if (isWide) {
                Row(modifier = Modifier.fillMaxSize()) {
                    // Бічна панель прокручується, щоб усі 5 кнопок влазили навіть у низькому екрані
                    Column(
                        modifier = Modifier
                            .width(84.dp)
                            .fillMaxHeight()
                            .background(Color.White)
                            .verticalScroll(rememberScrollState()),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Spacer(modifier = Modifier.height(8.dp))
                        for (tab in 0..4) {
                            NavigationRailItem(
                                selected = selectedBottomTab == tab,
                                onClick = { selectedBottomTab = tab },
                                icon = { TabIcon(tab) },
                                label = {
                                    Text(Strings.get(tabLabelKey(tab), currentLanguage), fontSize = 10.sp, maxLines = 2, lineHeight = 11.sp, textAlign = TextAlign.Center, overflow = TextOverflow.Ellipsis)
                                },
                                alwaysShowLabel = true
                            )
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                    }

                    if (selectedBottomTab == TAB_CHATS) {
                        Box(modifier = Modifier.width(340.dp).fillMaxHeight()) { tabContent() }
                        Box(modifier = Modifier.weight(1f).fillMaxHeight()) {
                            if (selectedUserForChat != null) {
                                chatContent()
                            } else {
                                Box(
                                    modifier = Modifier.fillMaxSize().background(Color.White),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(AppText.get("choose_chat", currentLanguage), color = Color.Gray)
                                }
                            }
                        }
                    } else {
                        Box(modifier = Modifier.weight(1f).fillMaxHeight()) { tabContent() }
                    }
                }
            } else {
                Box(modifier = Modifier.weight(1f)) {
                    if (selectedUserForChat != null && selectedBottomTab == TAB_CHATS) {
                        chatContent()
                    } else {
                        tabContent()
                    }
                }

                if (!(selectedUserForChat != null && selectedBottomTab == TAB_CHATS)) {
                    NavigationBar(containerColor = Color.White, tonalElevation = 8.dp) {
                        for (tab in 0..4) {
                            NavigationBarItem(
                                selected = selectedBottomTab == tab,
                                onClick = { selectedBottomTab = tab },
                                icon = { TabIcon(tab) },
                                label = {
                                    Text(Strings.get(tabLabelKey(tab), currentLanguage), fontSize = 10.sp, maxLines = 2, lineHeight = 11.sp, textAlign = TextAlign.Center, overflow = TextOverflow.Ellipsis)
                                },
                                alwaysShowLabel = true
                            )
                        }
                    }
                }
            }
        }

        // Єдине місце, де показуються повідомлення (вікно з кнопкою OK замість "білих смужок")
        NoticeHost(lang = currentLanguage)
    }
}

@Composable
fun MainTabContent(
    selectedBottomTab: Int,
    manager: KishkaManager,
    currentUserEmail: String,
    currentDisplayName: String,
    avatarUrl: String,
    currentLanguage: String,
    onLangChanged: (String) -> Unit,
    onUserSelected: (User) -> Unit,
    onStartCall: (String) -> Unit,
    onProfileUpdated: (String, String?) -> Unit,
    onLogout: () -> Unit
) {
    when (selectedBottomTab) {
        TAB_CHATS -> ChatsTab(
            manager = manager,
            currentEmail = currentUserEmail,
            lang = currentLanguage,
            onUserSelected = onUserSelected
        )
        TAB_CALLS -> CallsTab(
            manager = manager,
            currentEmail = currentUserEmail,
            lang = currentLanguage,
            onStartCall = onStartCall
        )
        TAB_GEMINI -> GeminiTab(
            currentEmail = currentUserEmail,
            displayName = currentDisplayName,
            lang = currentLanguage
        )
        TAB_PREVIEW -> PreviewTab(
            currentEmail = currentUserEmail,
            displayName = currentDisplayName,
            lang = currentLanguage
        )
        else -> AccountTab(
            manager = manager,
            displayName = currentDisplayName,
            email = currentUserEmail,
            avatarUrl = avatarUrl,
            currentLang = currentLanguage,
            onLangChanged = onLangChanged,
            onProfileUpdated = onProfileUpdated,
            onLogout = onLogout
        )
    }
}

fun checkPermissionsGranted(context: Context): Boolean {
    val mic = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    val notif = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    } else true
    // Третій дозвіл — фото і відео. Якщо користувач уже бачив запит (навіть відмовив), більше не блокуємо вхід:
    // вибір фото працює через системний вибір і без дозволу.
    val media = hasMediaPermission(context) ||
        context.getSharedPreferences("kishka_permissions", Context.MODE_PRIVATE).getBoolean("media_asked", false)
    return mic && notif && media
}

@Composable
fun PermissionsScreen(lang: String, onPermissionsGranted: () -> Unit) {
    val context = LocalContext.current
    var micGranted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) }
    var notifGranted by remember {
        mutableStateOf(
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            } else true
        )
    }
    var mediaGranted by remember { mutableStateOf(hasMediaPermission(context)) }
    var mediaAsked by remember {
        mutableStateOf(context.getSharedPreferences("kishka_permissions", Context.MODE_PRIVATE).getBoolean("media_asked", false))
    }

    val micLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        micGranted = granted
    }

    val notifLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        notifGranted = granted
    }

    val mediaLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { _ ->
        mediaGranted = hasMediaPermission(context)
        mediaAsked = true
        context.getSharedPreferences("kishka_permissions", Context.MODE_PRIVATE).edit().putBoolean("media_asked", true).apply()
    }

    val canContinue = micGranted && notifGranted && (mediaGranted || mediaAsked)

    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
    Column(
        modifier = Modifier
            .widthIn(max = 520.dp)
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(Icons.Default.Notifications, contentDescription = null, modifier = Modifier.size(64.dp), tint = ViberPurple)
        Spacer(modifier = Modifier.height(16.dp))
        Text(Strings.get("permissions_title", lang), fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Spacer(modifier = Modifier.height(8.dp))
        Text(Strings.get("permissions_desc", lang), fontSize = 14.sp, color = Color.Gray)
        Spacer(modifier = Modifier.height(24.dp))

        Button(
            onClick = { micLauncher.launch(Manifest.permission.RECORD_AUDIO) },
            modifier = Modifier.fillMaxWidth().height(48.dp),
            colors = ButtonDefaults.buttonColors(containerColor = if (micGranted) Color(0xFF2E7D32) else ViberPurple)
        ) {
            Text(if (micGranted) AppText.get("mic_granted", lang) else Strings.get("grant_mic", lang))
        }

        Spacer(modifier = Modifier.height(12.dp))

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Button(
                onClick = { notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) },
                modifier = Modifier.fillMaxWidth().height(48.dp),
                colors = ButtonDefaults.buttonColors(containerColor = if (notifGranted) Color(0xFF2E7D32) else ViberPurple)
            ) {
                Text(if (notifGranted) AppText.get("notif_granted", lang) else Strings.get("grant_notif", lang))
            }
            Spacer(modifier = Modifier.height(12.dp))
        }

        // Третій дозвіл: фото і відео
        Button(
            onClick = { mediaLauncher.launch(mediaPermissionsToRequest()) },
            modifier = Modifier.fillMaxWidth().height(48.dp),
            colors = ButtonDefaults.buttonColors(containerColor = if (mediaGranted) Color(0xFF2E7D32) else ViberPurple)
        ) {
            Text(if (mediaGranted) ChatStrings.get("media_granted", lang) else ChatStrings.get("grant_media", lang))
        }
        Spacer(modifier = Modifier.height(24.dp))

        OutlinedButton(
            onClick = {
                if (canContinue) {
                    onPermissionsGranted()
                } else {
                    Notice.show(ChatStrings.get("grant_all_three", lang))
                }
            },
            modifier = Modifier.fillMaxWidth().height(48.dp),
            enabled = canContinue
        ) {
            Text(Strings.get("continue_app", lang))
        }
    }
    }
}

@Composable
fun LoadingDataScreen(lang: String) {
    Box(
        modifier = Modifier.fillMaxSize().background(ViberBg),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = ViberPurple, modifier = Modifier.size(54.dp))
            Spacer(modifier = Modifier.height(20.dp))
            Text(Strings.get("loading_data", lang), fontSize = 16.sp, color = Color.DarkGray)
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

private fun previewLine(lang: String, preview: ChatPreview): String = when {
    preview.lastText.isNotEmpty() -> preview.lastText
    preview.lastFileType == "video" -> ChatStrings.get("video", lang)
    preview.lastFileType == "file" -> ChatStrings.get("file_label", lang)
    else -> ChatStrings.get("photo", lang)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatsTab(
    manager: KishkaManager,
    currentEmail: String,
    lang: String,
    onUserSelected: (User) -> Unit
) {
    val context = LocalContext.current
    val store = remember { LocalStore.get(context) }
    val me = currentEmail.trim().lowercase()

    var onlyUnread by remember { mutableStateOf(false) }
    var showAddContactDialog by remember { mutableStateOf(false) }
    var newContactEmail by remember { mutableStateOf("") }
    var isAddingContact by remember { mutableStateOf(false) }

    // Контакти беруться з пристрою одразу і звіряються із сервером; вони не зникають
    val contacts = ContactsRepo.contacts
    val storeVersion = StoreVersion.value

    LaunchedEffect(currentEmail) {
        manager.listenToUserContacts(currentEmail) { }
    }

    val previews = remember(contacts, storeVersion) {
        contacts.associate { it.email to store.chatPreview(me, KishkaManager.chatIdFor(me, it.email)) }
    }
    val visible = remember(contacts, previews, onlyUnread) {
        contacts
            .filter { !onlyUnread || (previews[it.email]?.unread ?: 0) > 0 }
            .sortedWith(
                compareByDescending<User> { previews[it.email]?.lastTime ?: 0L }
                    .thenBy { it.name.lowercase().ifEmpty { it.email } }
            )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Kishka Messenger", fontWeight = FontWeight.Bold, color = ViberPurple, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                actions = {
                    IconButton(onClick = { showAddContactDialog = true }) {
                        Icon(Icons.Default.PersonAdd, contentDescription = Strings.get("add_contact", lang), tint = ViberPurple)
                    }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            Row(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                listOf(false to Strings.get("all", lang), true to Strings.get("unread", lang)).forEach { (unreadFlag, label) ->
                    FilterChip(
                        selected = onlyUnread == unreadFlag,
                        onClick = { onlyUnread = unreadFlag },
                        label = { Text(label) },
                        modifier = Modifier.padding(end = 8.dp),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = ViberLightPurple,
                            selectedLabelColor = ViberPurple
                        )
                    )
                }
            }

            if (visible.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                    Text(
                        Strings.get(if (contacts.isEmpty()) "no_contacts" else "unread_empty", lang),
                        color = Color.Gray,
                        textAlign = TextAlign.Center
                    )
                }
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(visible, key = { it.email }) { user ->
                        val preview = previews[user.email]
                        Surface(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 12.dp, vertical = 4.dp)
                                .clickable { onUserSelected(user) },
                            shape = RoundedCornerShape(18.dp),
                            color = Color.White,
                            shadowElevation = 1.dp
                        ) {
                            Row(
                                modifier = Modifier.padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                AsyncImage(
                                    model = if (user.avatarUrl.isNullOrEmpty()) DEFAULT_AVATAR_URL else user.avatarUrl,
                                    contentDescription = "Avatar",
                                    modifier = Modifier.size(56.dp).clip(CircleShape)
                                )
                                Spacer(modifier = Modifier.width(12.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        user.name.ifEmpty { user.email },
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 16.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    if (isUserTyping(user.email)) {
                                        // Біля аватарки: "пише" з анімацією
                                        TypingIndicator(text = ChatStrings.get("typing", lang), fontSize = 13.sp)
                                    } else {
                                        Text(
                                            if (preview != null) previewLine(lang, preview) else user.email,
                                            color = if ((preview?.unread ?: 0) > 0) Color.Black else Color.Gray,
                                            fontSize = 13.sp,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                }
                                if (preview != null) {
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Column(horizontalAlignment = Alignment.End) {
                                        Text(
                                            if (isSameDay(preview.lastTime, System.currentTimeMillis())) formatMessageTime(preview.lastTime)
                                            else dayLabel(preview.lastTime, lang),
                                            color = Color.Gray,
                                            fontSize = 11.sp,
                                            maxLines = 1
                                        )
                                        if (preview.unread > 0) {
                                            Spacer(modifier = Modifier.height(4.dp))
                                            Box(
                                                modifier = Modifier
                                                    .defaultMinSize(minWidth = 22.dp, minHeight = 22.dp)
                                                    .clip(CircleShape)
                                                    .background(ViberPurple)
                                                    .padding(horizontal = 6.dp),
                                                contentAlignment = Alignment.Center
                                            ) {
                                                Text(
                                                    if (preview.unread > 99) "99+" else preview.unread.toString(),
                                                    color = Color.White,
                                                    fontSize = 11.sp,
                                                    fontWeight = FontWeight.Bold
                                                )
                                            }
                                        }
                                    }
                                }
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
            shape = RoundedCornerShape(22.dp),
            containerColor = Color.White,
            title = { Text(Strings.get("add_contact", lang)) },
            text = {
                OutlinedTextField(
                    value = newContactEmail,
                    onValueChange = { newContactEmail = it },
                    label = { Text(Strings.get("enter_email", lang)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    enabled = !isAddingContact
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        isAddingContact = true
                        manager.addContactByEmail(currentEmail, newContactEmail) { success, _, message ->
                            isAddingContact = false
                            if (success) {
                                showAddContactDialog = false
                                newContactEmail = ""
                            }
                            // Вікно з кнопкою OK; помилка показується лише при справжній помилці
                            Notice.show(message ?: "")
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
    var selectedPhotoUri by remember { mutableStateOf<Uri?>(null) }
    var isLoading by remember { mutableStateOf(false) }

    val photoPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        selectedPhotoUri = uri
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text(Strings.get("account_settings", currentLang), fontWeight = FontWeight.Bold) }) }
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
            // Прокручується і не розтягується на всю ширину планшета: усі кнопки завжди влазять
            Column(
                modifier = Modifier
                    .widthIn(max = 560.dp)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
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
                    Text(Strings.get("choose_photo", currentLang), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }

                Spacer(modifier = Modifier.height(12.dp))

                LanguageSelector(currentLang = currentLang, onLangSelected = onLangChanged)

                Spacer(modifier = Modifier.height(12.dp))

                AiSettingsSection(email = email, lang = currentLang)

                Spacer(modifier = Modifier.height(12.dp))

                OutlinedTextField(
                    value = nameInput,
                    onValueChange = { nameInput = it },
                    label = { Text(Strings.get("your_name", currentLang)) },
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
                                Notice.show(AppText.get("profile_updated", currentLang))
                            } else {
                                Notice.show(AppText.get("save_error", currentLang))
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
                        Text(Strings.get("save_changes", currentLang), fontSize = 16.sp, maxLines = 1)
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                OutlinedButton(
                    onClick = onLogout,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.Red)
                ) {
                    Text(Strings.get("logout", currentLang), fontSize = 16.sp, maxLines = 1)
                }
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
    var showClearDialog by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val storeVersion = StoreVersion.value

    // Історія дзвінків зберігається на пристрої і оновлюється після кожного дзвінка
    LaunchedEffect(currentEmail, storeVersion) {
        manager.listenForCallHistory(currentEmail) { logs -> callLogs = logs }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(Strings.get("call_history", lang), fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                actions = {
                    IconButton(onClick = { showClearDialog = true }, enabled = callLogs.isNotEmpty()) {
                        Icon(
                            Icons.Default.Delete,
                            contentDescription = CallStrings.get("clear", lang),
                            tint = if (callLogs.isNotEmpty()) ViberPurple else Color.LightGray
                        )
                    }
                }
            )
        }
    ) { padding ->
        if (callLogs.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center
            ) {
                Text(AppText.get("history_empty", lang), color = Color.Gray)
            }
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize().padding(padding)) {
                items(callLogs, key = { it.id }) { log ->
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 4.dp)
                            .clickable { onStartCall(log.callerEmail) },
                        shape = RoundedCornerShape(16.dp),
                        color = Color.White
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                when {
                                    log.isMissed -> Icons.Default.CallMissed
                                    log.direction == "in" -> Icons.Default.CallReceived
                                    else -> Icons.Default.CallMade
                                },
                                contentDescription = null,
                                tint = if (log.isMissed) Color.Red else ViberPurple
                            )
                            Spacer(modifier = Modifier.width(12.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    log.callerName,
                                    fontWeight = FontWeight.Bold,
                                    color = if (log.isMissed) Color.Red else Color.Unspecified,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                val kind = when {
                                    log.isMissed -> CallStrings.get("missed", lang)
                                    log.direction == "in" -> CallStrings.get("incoming_log", lang)
                                    else -> CallStrings.get("outgoing_log", lang)
                                }
                                val whenText = dayLabel(log.startedAt, lang) + ", " + formatMessageTime(log.startedAt)
                                val durationText = if (!log.isMissed && log.durationSec > 0) "  -  " + formatCallTimer(log.durationSec) else ""
                                Text("$kind  -  $whenText$durationText", color = Color.Gray, fontSize = 12.sp, maxLines = 2)
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

    if (showClearDialog) {
        AlertDialog(
            onDismissRequest = { showClearDialog = false },
            shape = RoundedCornerShape(22.dp),
            containerColor = Color.White,
            title = { Text(CallStrings.get("clear", lang)) },
            text = { Text(CallStrings.get("clear_confirm", lang)) },
            confirmButton = {
                Button(
                    onClick = {
                        showClearDialog = false
                        LocalStore.get(context).clearCalls(currentEmail.trim().lowercase())
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color.Red)
                ) { Text(Strings.get("delete", lang)) }
            },
            dismissButton = {
                TextButton(onClick = { showClearDialog = false }) { Text(Strings.get("cancel", lang)) }
            }
        )
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
    var showPassword by remember { mutableStateOf(false) }
    var canResend by remember { mutableStateOf(false) }
    val context = LocalContext.current

    Scaffold { padding ->
        // Прокручується: на низьких екранах і в горизонтальному положенні всі поля й кнопки доступні
        Box(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentAlignment = Alignment.Center
        ) {
            Column(
                modifier = Modifier
                    .widthIn(max = 480.dp)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
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
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email)
                )

                Spacer(modifier = Modifier.height(10.dp))

                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text(Strings.get("password", currentLang)) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    trailingIcon = {
                        IconButton(onClick = { showPassword = !showPassword }) {
                            Icon(
                                if (showPassword) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                contentDescription = null,
                                tint = Color.Gray
                            )
                        }
                    }
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
                            canResend = false
                            if (isRegisterMode) {
                                AuthManager.registerUser(email, password, displayName, currentLang) { success, msg ->
                                    isLoading = false
                                    if (success) {
                                        infoMessage = msg ?: AppText.tr(context, "confirm_sent")
                                        isRegisterMode = false
                                    } else {
                                        Notice.show(msg ?: AppText.tr(context, "error_generic"))
                                    }
                                }
                            } else {
                                AuthManager.loginUser(email, password, currentLang) { success, msg ->
                                    isLoading = false
                                    if (success) {
                                        onLoginSuccess(email, displayName)
                                    } else {
                                        canResend = AuthManager.lastErrorCode == "unverified"
                                        Notice.show(msg ?: AppText.tr(context, "login_error"))
                                    }
                                }
                            }
                        } else {
                            Notice.show(AppText.tr(context, "check_credentials"))
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
                            fontSize = 16.sp,
                            maxLines = 1
                        )
                    }
                }

                if (canResend && !isRegisterMode) {
                    TextButton(
                        onClick = {
                            isLoading = true
                            AuthManager.resendVerificationEmail(email, password, currentLang) { _, msg ->
                                isLoading = false
                                Notice.show(msg ?: "")
                            }
                        },
                        enabled = !isLoading
                    ) {
                        Text(Strings.get("resend_verification", currentLang), color = ViberPurple, textAlign = TextAlign.Center)
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

                TextButton(onClick = {
                    isRegisterMode = !isRegisterMode
                    canResend = false
                }) {
                    Text(
                        if (isRegisterMode) Strings.get("has_account", currentLang) else Strings.get("no_account", currentLang),
                        color = ViberPurple,
                        textAlign = TextAlign.Center
                    )
                }
            }
        }
    }
}
