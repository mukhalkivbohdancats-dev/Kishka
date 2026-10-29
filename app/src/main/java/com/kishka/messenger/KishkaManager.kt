package com.kishka.messenger

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.NotificationCompat
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.UserProfileChangeRequest
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/** Хто зараз пише повідомлення (email -> час, до якого показуємо "пише..."). Спостерігається з Compose. */
object TypingState {
    val until = mutableStateMapOf<String, Long>()
}

/** Контакти поточного акаунта (спільні для всіх екранів; зберігаються на пристрої та на сервері). */
object ContactsRepo {
    var contacts by mutableStateOf(listOf<User>())
        private set

    fun set(list: List<User>) {
        Handler(Looper.getMainLooper()).post { contacts = list }
    }
}

class KishkaManager(ctx: Context) {

    private val context: Context = ctx.applicationContext
    private val auth = FirebaseAuth.getInstance()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val prefs: SharedPreferences = context.getSharedPreferences("kishka_cache_prefs", Context.MODE_PRIVATE)
    private val store: LocalStore = LocalStore.get(context)

    companion object {
        // Стан відкритого чату спільний для всіх екземплярів менеджера: фонова служба і екран бачать одне й те саме
        @Volatile private var currentActiveChatId: String? = null
        @Volatile private var currentChatCallback: ((List<Message>) -> Unit)? = null
        @Volatile private var activeOwner: String = ""

        const val SERVER_URL = "https://kishka.onrender.com"
        const val DEFAULT_AVATAR_URL = "https://raw.githubusercontent.com/mukhalkivbohdancats-dev/Kishka/main/app/src/main/res/drawable/ic_launcher.png"
        const val MSG_CHANNEL_ID = "KishkaMessageChannel"

        private const val DAY_MS = 24L * 60L * 60L * 1000L

        private var socketInstance: Socket? = null
        private var isGlobalListenerInitialized = false

        // Дані для повторної ідентифікації після перепідключення сокета
        @Volatile var identifiedEmail: String? = null
        @Volatile var pushToken: String? = null
        @Volatile var activeChatForRejoin: String? = null

        /** Що робити після кожного (пере)підключення: синхронізація контактів, повідомлень і видалень. */
        @Volatile private var connectHook: (() -> Unit)? = null

        /** Перетворює відносне посилання сервера (/media/..) на повну адресу. */
        fun absoluteUrl(path: String?): String? {
            if (path.isNullOrEmpty()) return null
            return if (path.startsWith("http")) path else SERVER_URL + path
        }

        /** Ідентифікатор чату двох користувачів (той самий алгоритм, що й на сервері та у старих версіях). */
        fun chatIdFor(email1: String, email2: String): String {
            val e1 = email1.trim().lowercase().replace(".", "_dot_")
            val e2 = email2.trim().lowercase().replace(".", "_dot_")
            return if (e1 < e2) "${e1}_${e2}" else "${e2}_${e1}"
        }

        /** Повертає відносну частину посилання (для відправлення на сервер). */
        fun relativeUrl(url: String?): String? {
            if (url.isNullOrEmpty()) return null
            return if (url.startsWith(SERVER_URL)) url.removePrefix(SERVER_URL) else url
        }

        /** Каже серверу, хто ми (і наш push-токен), та повертає в активний чат. Викликається при кожному (пере)підключенні. */
        fun sendIdentify() {
            val email = identifiedEmail
            val s = socketInstance
            if (email.isNullOrEmpty() || s == null) return
            try {
                val json = JSONObject().apply {
                    put("email", email)
                    val token = pushToken
                    if (!token.isNullOrEmpty()) put("pushToken", token)
                }
                s.emit("identify", json)
                val chatId = activeChatForRejoin
                if (!chatId.isNullOrEmpty()) {
                    s.emit("join_chat", JSONObject().apply { put("chatId", chatId) })
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        @Synchronized
        fun getSocket(): Socket {
            if (socketInstance == null) {
                try {
                    val options = IO.Options().apply {
                        forceNew = false
                        reconnection = true
                        reconnectionAttempts = Int.MAX_VALUE
                        reconnectionDelay = 500 // Прискорено повторне підключення (0.5с)
                        reconnectionDelayMax = 3000
                        timeout = 10000 // Зменшено таймаут до 10с для швидкого реагування
                    }
                    socketInstance = IO.socket(SERVER_URL, options)
                    socketInstance?.on(Socket.EVENT_CONNECT) {
                        sendIdentify()
                        try {
                            connectHook?.invoke()
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }
                    }
                    socketInstance?.connect()
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
            return socketInstance!!
        }
    }

    private val socket: Socket
        get() = getSocket()

    init {
        ensureConnected()
        createMessageNotificationChannel()
    }

    private fun createMessageNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                MSG_CHANNEL_ID,
                AppText.tr(context, "msg_channel"),
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = AppText.tr(context, "msg_channel_desc")
            }
            val manager = context.getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun ensureConnected() {
        try {
            if (!socket.connected()) {
                socket.connect()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun observeNetworkState(onStateChanged: (Boolean) -> Unit) {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val builder = NetworkRequest.Builder()

        val initialConnected = isNetworkAvailable()
        onStateChanged(initialConnected)

        cm.registerNetworkCallback(builder.build(), object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                mainHandler.post {
                    onStateChanged(true)
                    ensureConnected()
                }
            }

            override fun onLost(network: Network) {
                mainHandler.post { onStateChanged(isNetworkAvailable()) }
            }
        })
    }

    fun isNetworkAvailable(): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val activeNetwork = cm.activeNetwork ?: return false
        val capabilities = cm.getNetworkCapabilities(activeNetwork) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /** Розбирає повідомлення з JSON (сервер) разом із фото/відео. */
    private fun parseMessageJson(obj: JSONObject, defaultChatId: String): Message {
        fun optNullable(name: String): String? =
            if (obj.isNull(name)) null else obj.optString(name, "").ifEmpty { null }

        return Message(
            id = obj.optString("id", ""),
            chatId = obj.optString("chatId", defaultChatId),
            senderEmail = obj.optString("senderEmail", "").trim().lowercase(),
            receiverEmail = obj.optString("receiverEmail", "").trim().lowercase(),
            text = obj.optString("text", ""),
            timestamp = obj.optLong("timestamp", System.currentTimeMillis()),
            fileUrl = absoluteUrl(optNullable("fileUrl")),
            fileType = optNullable("fileType"),
            thumbUrl = absoluteUrl(optNullable("thumbUrl")),
            fileName = optNullable("fileName")
        )
    }

    private fun parseMessages(array: JSONArray, defaultChatId: String): List<Message> {
        val list = mutableListOf<Message>()
        for (i in 0 until array.length()) {
            val obj = array.optJSONObject(i) ?: continue
            list.add(parseMessageJson(obj, defaultChatId))
        }
        return list
    }

    private fun parseUsers(array: JSONArray?): List<User> {
        val list = mutableListOf<User>()
        if (array == null) return list
        for (i in 0 until array.length()) {
            val obj = array.optJSONObject(i) ?: continue
            val email = obj.optString("email", "").trim().lowercase()
            if (email.isEmpty()) continue
            val avatar = if (obj.isNull("avatarUrl")) DEFAULT_AVATAR_URL else obj.optString("avatarUrl", "").ifEmpty { DEFAULT_AVATAR_URL }
            list.add(User(uid = email, email = email, name = obj.optString("name", ""), avatarUrl = avatar))
        }
        return list
    }

    fun registerOrUpdateUserInDb(email: String, name: String, avatarUrl: String? = null) {
        val cleanEmail = email.trim().lowercase()
        if (cleanEmail.isEmpty()) return
        ensureConnected()

        val json = JSONObject().apply {
            put("email", cleanEmail)
            put("name", name)
            put("avatarUrl", avatarUrl ?: DEFAULT_AVATAR_URL)
        }
        socket.emit("register_or_update_user", json)
    }

    fun getUserProfile(email: String, onResult: (User?) -> Unit) {
        val cleanEmail = email.trim().lowercase()
        if (cleanEmail.isEmpty()) {
            onResult(null)
            return
        }

        val cachedName = prefs.getString("profile_name_$cleanEmail", cleanEmail.substringBefore("@")) ?: cleanEmail.substringBefore("@")
        val cachedAvatar = prefs.getString("profile_avatar_$cleanEmail", DEFAULT_AVATAR_URL) ?: DEFAULT_AVATAR_URL
        onResult(User(uid = cleanEmail, email = cleanEmail, name = cachedName, avatarUrl = cachedAvatar))

        ensureConnected()

        socket.emit("get_user_profile", cleanEmail, io.socket.client.Ack { args ->
            mainHandler.post {
                if (args.isNotEmpty() && args[0] is JSONObject) {
                    val obj = args[0] as JSONObject
                    val name = obj.optString("name", cachedName)
                    val avatar = if (obj.isNull("avatarUrl")) cachedAvatar else obj.optString("avatarUrl", cachedAvatar)
                    prefs.edit().putString("profile_name_$cleanEmail", name).putString("profile_avatar_$cleanEmail", avatar).apply()
                    onResult(User(uid = cleanEmail, email = cleanEmail, name = name, avatarUrl = avatar))
                }
            }
        })
    }

    // ===================== КОНТАКТИ =====================

    /**
     * Додає контакт. Додати можна лише користувача, який уже зареєстрований у Kishka.
     * onResult(успіх, користувач, текст повідомлення мовою інтерфейсу).
     */
    fun addContactByEmail(myEmail: String, targetEmail: String, onResult: (Boolean, User?, String?) -> Unit) {
        val cleanTargetEmail = targetEmail.trim().lowercase()
        val cleanMyEmail = myEmail.trim().lowercase()

        if (cleanTargetEmail.isEmpty() || !cleanTargetEmail.contains("@")) {
            onResult(false, null, AppText.tr(context, "bad_email"))
            return
        }

        if (cleanTargetEmail == cleanMyEmail) {
            onResult(false, null, AppText.tr(context, "cant_add_self"))
            return
        }

        ensureConnected()

        val req = JSONObject().apply {
            put("myEmail", cleanMyEmail)
            put("targetEmail", cleanTargetEmail)
        }

        val finished = AtomicBoolean(false)
        val timeout = Runnable {
            if (finished.compareAndSet(false, true)) {
                onResult(false, null, AppText.tr(context, "server_waking"))
            }
        }
        mainHandler.postDelayed(timeout, 25000L)

        socket.emit("add_contact", req, io.socket.client.Ack { args ->
            mainHandler.post {
                if (!finished.compareAndSet(false, true)) return@post
                mainHandler.removeCallbacks(timeout)

                if (args.isNotEmpty() && args[0] is JSONObject) {
                    val res = args[0] as JSONObject
                    if (res.optBoolean("success", false)) {
                        val userObj = res.optJSONObject("user")
                        val serverName = userObj?.optString("name", "") ?: ""
                        val serverAvatar = if (userObj == null || userObj.isNull("avatarUrl")) "" else userObj.optString("avatarUrl", "")
                        val user = User(
                            uid = cleanTargetEmail,
                            email = cleanTargetEmail,
                            name = serverName.ifEmpty { cleanTargetEmail.substringBefore("@") },
                            avatarUrl = serverAvatar.ifEmpty { DEFAULT_AVATAR_URL }
                        )
                        store.upsertContacts(cleanMyEmail, listOf(user))
                        ContactsRepo.set(store.getContacts(cleanMyEmail))
                        onResult(true, user, AppText.tr(context, "contact_added"))
                    } else {
                        val message = when (res.optString("code", "")) {
                            "invalid" -> AppText.tr(context, "bad_email")
                            "not_found" -> AppText.tr(context, "user_not_found")
                            else -> AppText.tr(context, "error_generic")
                        }
                        onResult(false, null, message)
                    }
                } else {
                    onResult(false, null, AppText.tr(context, "server_waking"))
                }
            }
        })
    }

    /** Показує контакти з пристрою одразу, потім звіряє із сервером (контакти ніколи не пропадають). */
    fun listenToUserContacts(myEmail: String, onContactsUpdated: (List<User>) -> Unit) {
        val cleanEmail = myEmail.trim().lowercase()
        if (cleanEmail.isEmpty()) return

        val local = store.getContacts(cleanEmail)
        ContactsRepo.set(local)
        if (local.isNotEmpty()) onContactsUpdated(local)

        ensureConnected()
        refreshContacts(cleanEmail) { list -> onContactsUpdated(list) }
    }

    private fun refreshContacts(me: String, onDone: ((List<User>) -> Unit)? = null) {
        ensureConnected()
        socket.emit("get_contacts", me, io.socket.client.Ack { args ->
            var server: List<User>? = null
            val first = args.firstOrNull()
            if (first is JSONObject) {
                if (first.optBoolean("success", false)) server = parseUsers(first.optJSONArray("contacts"))
            } else if (first is JSONArray) {
                server = parseUsers(first) // сумісність зі старою версією сервера
            }

            if (server != null) {
                store.upsertContacts(me, server)
                val local = store.getContacts(me)

                // Сервер міг "забути" контакти (перезапуск без постійної бази) — повертаємо їх із пристрою
                val serverEmails = server.map { it.email }.toSet()
                val missing = local.map { it.email }.filter { it !in serverEmails }
                if (missing.isNotEmpty()) {
                    val arr = JSONArray()
                    missing.forEach { arr.put(it) }
                    socket.emit("sync_contacts", JSONObject().apply {
                        put("myEmail", me)
                        put("contacts", arr)
                    }, io.socket.client.Ack { })
                }

                ContactsRepo.set(local)
                if (onDone != null) mainHandler.post { onDone(local) }
            } else if (onDone != null) {
                val local = store.getContacts(me)
                mainHandler.post { onDone(local) }
            }
        })
    }

    // ===================== ПОВІДОМЛЕННЯ =====================

    fun startGlobalMessageListener(myEmail: String) {
        val cleanEmail = myEmail.trim().lowercase()
        if (cleanEmail.isEmpty()) return
        ensureConnected()

        val previousEmail = identifiedEmail
        identifiedEmail = cleanEmail
        sendIdentify()

        if (store.migrateOldCache(context)) {
            store.markAllChatsRead(cleanEmail)
        }

        connectHook = { syncAfterConnect() }

        if (!isGlobalListenerInitialized) {
            isGlobalListenerInitialized = true
            registerGlobalHandlers()
        }

        if (socket.connected() || previousEmail != cleanEmail) {
            syncAfterConnect()
        }
    }

    private fun registerGlobalHandlers() {
        socket.on("user_typing") { args ->
            if (args.isNotEmpty() && args[0] is JSONObject) {
                val obj = args[0] as JSONObject
                val from = obj.optString("from", "").trim().lowercase()
                val typing = obj.optBoolean("isTyping", false)
                if (from.isNotEmpty()) {
                    mainHandler.post {
                        if (typing) {
                            TypingState.until[from] = System.currentTimeMillis() + 6000L
                        } else {
                            TypingState.until.remove(from)
                        }
                    }
                }
            }
        }

        socket.on("receive_message") { args ->
            if (args.isNotEmpty() && args[0] is JSONObject) {
                handleIncoming(args[0] as JSONObject)
            }
        }

        // Повідомлення видаляється на пристрої ЛИШЕ за сигналом сервера (його надсилає видалення автором)
        socket.on("message_deleted") { args ->
            val first = args.firstOrNull()
            val id = when (first) {
                is String -> first
                is JSONObject -> first.optString("messageId", "")
                else -> ""
            }
            if (id.isNotEmpty()) {
                store.deleteMessage(id)
                pushActiveChat()
            }
        }

        socket.on("load_deleted") { args ->
            val obj = args.firstOrNull() as? JSONObject
            val ids = obj?.optJSONArray("ids")
            if (ids != null) {
                for (i in 0 until ids.length()) store.deleteMessage(ids.optString(i, ""))
                pushActiveChat()
            }
        }

        socket.on("message_ack") { args ->
            val obj = args.firstOrNull() as? JSONObject
            if (obj != null && obj.optBoolean("ok", false)) {
                store.markDelivered(obj.optString("id", ""))
            }
        }

        socket.on("contact_updated") {
            identifiedEmail?.let { refreshContacts(it) }
        }
    }

    private fun handleIncoming(obj: JSONObject) {
        val me = identifiedEmail ?: return
        val parsed = parseMessageJson(obj, obj.optString("chatId", ""))
        if (parsed.id.isEmpty() || parsed.chatId.isEmpty()) return

        val sender = parsed.senderEmail
        val isMine = sender == me
        if (!isMine && parsed.receiverEmail != me) return // чужа розмова

        if (sender.isNotEmpty()) mainHandler.post { TypingState.until.remove(sender) }

        val added = store.insertMessages(listOf(parsed))
        if (isMine) store.markDelivered(parsed.id)

        if (added.isNotEmpty() || isMine) {
            val active = parsed.chatId == currentActiveChatId
            if (!isMine && added.isNotEmpty() && !active) {
                showBackgroundMessageNotification(sender, previewText(parsed))
            }
            if (active) {
                if (!isMine) store.markRead(me, parsed.chatId)
                pushActiveChat()
            }
        }
    }

    private fun previewText(m: Message): String = when {
        m.text.isNotEmpty() -> m.text
        m.fileType == "video" -> AppText.tr(context, "label_video")
        m.fileType == "image" -> AppText.tr(context, "label_photo")
        m.fileType == "file" -> AppText.tr(context, "label_file")
        else -> ""
    }

    private fun pushActiveChat() {
        val id = currentActiveChatId ?: return
        val callback = currentChatCallback ?: return
        val list = store.getMessages(activeOwner, id)
        mainHandler.post { callback.invoke(list) }
    }

    /** Після (пере)підключення: контакти, пропущені повідомлення, видалення, неотримані відправлення. */
    private fun syncAfterConnect() {
        val me = identifiedEmail ?: return

        refreshContacts(me)
        resendPending(me)

        // 1) Повідомлення всіх чатів, що надійшли, поки застосунок був вимкнений
        val lastMsgSync = prefs.getLong("last_msg_sync_$me", 0L)
        val since = if (lastMsgSync == 0L) 0L else (lastMsgSync - DAY_MS).coerceAtLeast(0L)
        val startedAt = System.currentTimeMillis()
        socket.emit("sync_messages", JSONObject().apply {
            put("email", me)
            put("since", since)
        }, io.socket.client.Ack { args ->
            val obj = args.firstOrNull() as? JSONObject
            if (obj != null && obj.optBoolean("success", false)) {
                val list = parseMessages(obj.optJSONArray("messages") ?: JSONArray(), "")
                    .filter { it.chatId.isNotEmpty() }
                val added = store.insertMessages(list)
                list.filter { it.senderEmail == me }.forEach { store.markDelivered(it.id) }
                prefs.edit().putLong("last_msg_sync_$me", startedAt).apply()

                if (lastMsgSync == 0L) {
                    // Перший вхід на цьому пристрої: стара історія не є "непрочитаною"
                    list.map { it.chatId }.distinct().forEach { store.markRead(me, it) }
                } else {
                    added.filter { it.receiverEmail == me && it.senderEmail != me && it.chatId != currentActiveChatId }
                        .groupBy { it.senderEmail }
                        .forEach { (sender, msgs) -> showBackgroundMessageNotification(sender, previewText(msgs.last())) }
                }
                pushActiveChat()
            }
        })

        // 2) Що було видалено автором, поки пристрій був офлайн
        val lastDelSync = prefs.getLong("last_del_sync_$me", 0L)
        socket.emit("sync_deleted", JSONObject().apply {
            put("email", me)
            put("since", lastDelSync)
        }, io.socket.client.Ack { args ->
            val obj = args.firstOrNull() as? JSONObject
            if (obj != null && obj.optBoolean("success", false)) {
                val arr = obj.optJSONArray("deleted") ?: JSONArray()
                var maxAt = lastDelSync
                for (i in 0 until arr.length()) {
                    val d = arr.optJSONObject(i) ?: continue
                    store.deleteMessage(d.optString("id", ""))
                    maxAt = maxOf(maxAt, d.optLong("deletedAt", 0L))
                }
                if (maxAt > lastDelSync) prefs.edit().putLong("last_del_sync_$me", maxAt).apply()
                pushActiveChat()
            }
        })
    }

    private fun resendPending(me: String) {
        try {
            store.pendingMessages(me).forEach { m -> emitMessage(m) }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun emitMessage(m: Message) {
        val json = JSONObject().apply {
            put("id", m.id)
            put("chatId", m.chatId)
            put("senderEmail", m.senderEmail)
            put("receiverEmail", m.receiverEmail)
            put("text", m.text)
            put("timestamp", m.timestamp)
            val relFile = relativeUrl(m.fileUrl)
            if (!relFile.isNullOrEmpty()) {
                put("fileUrl", relFile)
                put("fileType", m.fileType ?: "image")
                val relThumb = relativeUrl(m.thumbUrl)
                if (!relThumb.isNullOrEmpty()) put("thumbUrl", relThumb)
                if (!m.fileName.isNullOrEmpty()) put("fileName", m.fileName)
            }
        }
        socket.emit("send_message", json)
    }

    fun connectAndListenForMessages(
        senderEmail: String,
        receiverEmail: String,
        onMessagesUpdated: (List<Message>) -> Unit
    ) {
        val me = senderEmail.trim().lowercase()
        val chatId = getChatId(senderEmail, receiverEmail)
        activeOwner = me
        currentActiveChatId = chatId
        activeChatForRejoin = chatId
        currentChatCallback = onMessagesUpdated

        // Повідомлення з пристрою показуються одразу, навіть без інтернету
        onMessagesUpdated(store.getMessages(me, chatId))
        store.markRead(me, chatId)

        ensureConnected()

        socket.off("load_history")
        socket.on("load_history") { args ->
            if (args.isNotEmpty() && args[0] is JSONArray) {
                val list = parseMessages(args[0] as JSONArray, chatId)
                // Лише ДОДАЄМО нові: локальна історія не затирається, навіть якщо сервер відповів порожнім списком
                store.insertMessages(list)
                list.filter { it.senderEmail == me }.forEach { store.markDelivered(it.id) }
                if (currentActiveChatId == chatId) {
                    store.markRead(me, chatId)
                    pushActiveChat()
                }
            }
        }

        val joinData = JSONObject().apply { put("chatId", chatId) }
        socket.emit("join_chat", joinData)
    }

    private fun showBackgroundMessageNotification(senderEmail: String, text: String) {
        val me = identifiedEmail ?: ""
        val title = store.contactName(me, senderEmail) ?: senderEmail
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_OPEN_CHAT, senderEmail)
        }
        val pendingIntent = PendingIntent.getActivity(
            context, senderEmail.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, MSG_CHANNEL_ID)
            .setContentTitle(AppText.tr(context, "msg_new_from", title))
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        try {
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.notify(senderEmail.hashCode(), notification)
        } catch (e: SecurityException) {
            e.printStackTrace()
        }
    }

    fun sendMessage(
        senderEmail: String,
        receiverEmail: String,
        text: String,
        fileUrl: String? = null,
        fileType: String? = null,
        thumbUrl: String? = null,
        fileName: String? = null
    ) {
        val relFile = relativeUrl(fileUrl)
        if (text.isBlank() && relFile.isNullOrEmpty()) return
        val me = senderEmail.trim().lowercase()
        val chatId = getChatId(senderEmail, receiverEmail)
        ensureConnected()

        val hasFile = !relFile.isNullOrEmpty()
        val message = Message(
            id = UUID.randomUUID().toString(),
            chatId = chatId,
            senderEmail = me,
            receiverEmail = receiverEmail.trim().lowercase(),
            text = text,
            timestamp = System.currentTimeMillis(),
            fileUrl = if (hasFile) absoluteUrl(relFile) else null,
            fileType = if (hasFile) (fileType ?: "image") else null,
            thumbUrl = if (hasFile) absoluteUrl(relativeUrl(thumbUrl)) else null,
            fileName = if (hasFile) fileName else null
        )

        // Спочатку зберігаємо на пристрої (з позначкою "ще не доставлено"), потім відправляємо на сервер
        store.insertMessages(listOf(message), pending = true)
        if (currentActiveChatId == chatId) pushActiveChat()

        emitMessage(message)
        sendTyping(senderEmail, receiverEmail, false)
    }

    /**
     * Видалення повідомлення.
     * forEveryone = true  — запит серверу: видалити в обох (сервер дозволяє лише автору). На пристрої повідомлення
     *                       зникне тоді, коли сервер надішле сигнал про видалення.
     * forEveryone = false — приховати лише на цьому пристрої.
     */
    fun deleteMessage(senderEmail: String, receiverEmail: String, messageId: String, forEveryone: Boolean = true) {
        val chatId = getChatId(senderEmail, receiverEmail)
        if (forEveryone) {
            ensureConnected()
            val json = JSONObject().apply {
                put("messageId", messageId)
                put("chatId", chatId)
                put("requesterEmail", senderEmail.trim().lowercase())
            }
            socket.emit("delete_message", json)
        } else {
            store.hideMessage(senderEmail.trim().lowercase(), chatId, messageId)
            if (currentActiveChatId == chatId) pushActiveChat()
        }
    }

    private var lastTypingSentAt = 0L

    /** Індикатор "пише...": true надсилається не частіше ніж раз на 2 с, false — одразу. */
    fun sendTyping(senderEmail: String, receiverEmail: String, isTyping: Boolean) {
        val now = System.currentTimeMillis()
        if (isTyping) {
            if (now - lastTypingSentAt < 2000L) return
            lastTypingSentAt = now
        } else {
            lastTypingSentAt = 0L
        }
        if (!socket.connected()) return
        try {
            val json = JSONObject().apply {
                put("from", senderEmail.trim().lowercase())
                put("to", receiverEmail.trim().lowercase())
                put("isTyping", isTyping)
            }
            socket.emit("typing", json)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun sendFileMessage(senderEmail: String, receiverEmail: String, fileUri: Uri, fileType: String) {
        val media = MediaUtils.describe(context, fileUri) ?: return
        MediaUtils.upload(context, media, senderEmail, {}) { uploaded ->
            if (uploaded != null) {
                sendMessage(senderEmail, receiverEmail, "", uploaded.url, uploaded.type, uploaded.thumbUrl, uploaded.name)
            }
        }
    }

    /** Контакти з пристрою (для вибору, кому переслати повідомлення). */
    fun cachedContacts(myEmail: String): List<User> = store.getContacts(myEmail.trim().lowercase())

    fun updateUserProfile(
        email: String,
        newName: String,
        avatarUri: Uri?,
        onComplete: (Boolean, String?) -> Unit
    ) {
        val cleanEmail = email.trim().lowercase()
        val currentUser = auth.currentUser

        if (avatarUri != null) {
            // Аватар завантажується на ваш сервер (Firebase Storage більше не використовується)
            val media = MediaUtils.describe(context, avatarUri)
            if (media == null || media.type != "image") {
                onComplete(false, null)
                return
            }
            MediaUtils.upload(context, media, cleanEmail, {}) { uploaded ->
                if (uploaded == null) {
                    onComplete(false, null)
                } else {
                    val avatarUrlStr = absoluteUrl(uploaded.url) ?: uploaded.url
                    val profileUpdates = UserProfileChangeRequest.Builder()
                        .setDisplayName(newName)
                        .setPhotoUri(Uri.parse(avatarUrlStr))
                        .build()

                    currentUser?.updateProfile(profileUpdates)?.addOnCompleteListener {
                        registerOrUpdateUserInDb(cleanEmail, newName, avatarUrlStr)
                        prefs.edit().putString("profile_name_$cleanEmail", newName).putString("profile_avatar_$cleanEmail", avatarUrlStr).apply()
                        onComplete(true, avatarUrlStr)
                    } ?: run {
                        registerOrUpdateUserInDb(cleanEmail, newName, avatarUrlStr)
                        prefs.edit().putString("profile_name_$cleanEmail", newName).putString("profile_avatar_$cleanEmail", avatarUrlStr).apply()
                        onComplete(true, avatarUrlStr)
                    }
                }
            }
        } else {
            val profileUpdates = UserProfileChangeRequest.Builder()
                .setDisplayName(newName)
                .build()

            currentUser?.updateProfile(profileUpdates)?.addOnCompleteListener {
                registerOrUpdateUserInDb(cleanEmail, newName, null)
                prefs.edit().putString("profile_name_$cleanEmail", newName).apply()
                onComplete(true, null)
            } ?: run {
                registerOrUpdateUserInDb(cleanEmail, newName, null)
                prefs.edit().putString("profile_name_$cleanEmail", newName).apply()
                onComplete(true, null)
            }
        }
    }

    fun leaveChatRoom() {
        currentActiveChatId?.let { chatId ->
            socket.emit("leave_chat", chatId)
        }
        currentActiveChatId = null
        activeChatForRejoin = null
        currentChatCallback = null
        socket.off("load_history")
    }

    /** Виходить з акаунта: сокет перепідключається, щоб не отримувати події попереднього користувача. */
    fun resetSession() {
        identifiedEmail = null
        activeChatForRejoin = null
        currentActiveChatId = null
        currentChatCallback = null
        activeOwner = ""
        ContactsRepo.set(emptyList())
        try {
            socket.disconnect()
            socket.connect()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // ===================== ДЗВІНКИ =====================

    /** Історія дзвінків зберігається на пристрої (не зникає після виходу та оновлення). */
    fun listenForCallHistory(myEmail: String, onLogsUpdated: (List<CallLogItem>) -> Unit) {
        onLogsUpdated(store.getCalls(myEmail.trim().lowercase()))
    }

    fun startCall(callerEmail: String, receiverEmail: String) {
        ensureConnected()
        val json = JSONObject().apply {
            put("callerEmail", callerEmail.trim().lowercase())
            put("receiverEmail", receiverEmail.trim().lowercase())
        }
        socket.emit("start_call", json)
    }

    fun answerCall(callerEmail: String, receiverEmail: String) {
        ensureConnected()
        val json = JSONObject().apply {
            put("callerEmail", callerEmail.trim().lowercase())
            put("receiverEmail", receiverEmail.trim().lowercase())
        }
        socket.emit("answer_call", json)
    }

    fun rejectCall(callerEmail: String, receiverEmail: String) {
        ensureConnected()
        val json = JSONObject().apply {
            put("callerEmail", callerEmail.trim().lowercase())
            put("receiverEmail", receiverEmail.trim().lowercase())
        }
        socket.emit("reject_call", json)
    }

    fun endCall(callerEmail: String, receiverEmail: String) {
        ensureConnected()
        val json = JSONObject().apply {
            put("callerEmail", callerEmail.trim().lowercase())
            put("receiverEmail", receiverEmail.trim().lowercase())
        }
        socket.emit("end_call", json)
    }

    /** Надсилає аудіопакет (див. VoiceCodec) бінарно, без base64. Якщо звʼязку немає — пакет відкидається. */
    fun sendVoiceChunk(targetEmail: String, chunk: ByteArray) {
        if (targetEmail.isEmpty()) return
        try {
            if (!socket.connected()) {
                ensureConnected()
                return
            }
            val json = JSONObject().apply {
                put("targetEmail", targetEmail.trim().lowercase())
                put("chunk", chunk)
            }
            socket.emit("voice_chunk", json)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun listenForVoiceChunks(myEmail: String, onChunkReceived: (ByteArray) -> Unit) {
        val cleanEmail = myEmail.trim().lowercase()
        if (cleanEmail.isEmpty()) return
        ensureConnected()

        socket.off("voice_chunk_$cleanEmail")
        socket.on("voice_chunk_$cleanEmail") { args ->
            if (args.isNotEmpty()) {
                try {
                    val item = args[0]
                    val chunkBytes = when (item) {
                        is ByteArray -> item
                        is String -> Base64.decode(item, Base64.NO_WRAP)
                        is JSONObject -> {
                            val chunkStr = item.optString("chunk", "")
                            if (chunkStr.isNotEmpty()) Base64.decode(chunkStr, Base64.NO_WRAP) else null
                        }
                        else -> null
                    }
                    if (chunkBytes != null && chunkBytes.isNotEmpty()) {
                        onChunkReceived(chunkBytes)
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }
    }

    fun stopListeningForVoiceChunks(myEmail: String) {
        val cleanEmail = myEmail.trim().lowercase()
        if (cleanEmail.isEmpty()) return
        socket.off("voice_chunk_$cleanEmail")
    }

    private fun getChatId(email1: String, email2: String): String = chatIdFor(email1, email2)
}
