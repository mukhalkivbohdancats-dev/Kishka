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
import androidx.compose.runtime.mutableStateMapOf
import androidx.core.app.NotificationCompat
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.UserProfileChangeRequest
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Хто зараз пише повідомлення (email -> час, до якого показуємо "пише..."). Спостерігається з Compose. */
object TypingState {
    val until = mutableStateMapOf<String, Long>()
}

class KishkaManager(private val context: Context) {

    private val auth = FirebaseAuth.getInstance()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val prefs: SharedPreferences = context.getSharedPreferences("kishka_cache_prefs", Context.MODE_PRIVATE)

    companion object {
        // Стан відкритого чату спільний для всіх екземплярів менеджера: фонова служба і екран бачать одне й те саме
        @Volatile private var currentActiveChatId: String? = null
        @Volatile private var currentChatCallback: ((List<Message>) -> Unit)? = null
        @Volatile private var currentChatMessagesList: MutableList<Message>? = null

        const val SERVER_URL = "https://kishka.onrender.com"
        const val DEFAULT_AVATAR_URL = "https://raw.githubusercontent.com/mukhalkivbohdancats-dev/Kishka/main/app/src/main/res/drawable/ic_launcher.png"
        const val MSG_CHANNEL_ID = "KishkaMessageChannel"
        
        private var socketInstance: Socket? = null
        private var isGlobalListenerInitialized = false

        // Дані для повторної ідентифікації після перепідключення сокета
        @Volatile var identifiedEmail: String? = null
        @Volatile var pushToken: String? = null
        @Volatile var activeChatForRejoin: String? = null

        /** Перетворює відносне посилання сервера (/media/..) на повну адресу. */
        fun absoluteUrl(path: String?): String? {
            if (path.isNullOrEmpty()) return null
            return if (path.startsWith("http")) path else SERVER_URL + path
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
                    socketInstance?.on(Socket.EVENT_CONNECT) { sendIdentify() }
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
                mainHandler.post { onStateChanged(false) }
            }
        })
    }

    fun isNetworkAvailable(): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val activeNetwork = cm.activeNetwork ?: return false
        val capabilities = cm.getNetworkCapabilities(activeNetwork) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun cacheContactsLocally(myEmail: String, contacts: List<User>) {
        try {
            val jsonArray = JSONArray()
            for (c in contacts) {
                val obj = JSONObject().apply {
                    put("email", c.email)
                    put("name", c.name)
                    put("avatarUrl", c.avatarUrl ?: DEFAULT_AVATAR_URL)
                }
                jsonArray.put(obj)
            }
            prefs.edit().putString("cached_contacts_$myEmail", jsonArray.toString()).apply()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun getCachedContacts(myEmail: String): List<User> {
        val list = mutableListOf<User>()
        try {
            val str = prefs.getString("cached_contacts_$myEmail", null) ?: return list
            val jsonArray = JSONArray(str)
            for (i in 0 until jsonArray.length()) {
                val obj = jsonArray.getJSONObject(i)
                list.add(
                    User(
                        uid = obj.optString("email", ""),
                        email = obj.optString("email", ""),
                        name = obj.optString("name", ""),
                        avatarUrl = obj.optString("avatarUrl", DEFAULT_AVATAR_URL)
                    )
                )
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return list
    }

    private fun cacheMessagesLocally(chatId: String, messages: List<Message>) {
        try {
            val jsonArray = JSONArray()
            for (m in messages) {
                val obj = JSONObject().apply {
                    put("id", m.id)
                    put("chatId", m.chatId)
                    put("senderEmail", m.senderEmail)
                    put("receiverEmail", m.receiverEmail)
                    put("text", m.text)
                    put("timestamp", m.timestamp)
                    if (m.fileUrl != null) put("fileUrl", m.fileUrl)
                    if (m.fileType != null) put("fileType", m.fileType)
                    if (m.thumbUrl != null) put("thumbUrl", m.thumbUrl)
                    if (m.fileName != null) put("fileName", m.fileName)
                }
                jsonArray.put(obj)
            }
            prefs.edit().putString("cached_messages_$chatId", jsonArray.toString()).apply()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun getCachedMessages(chatId: String): List<Message> {
        val list = mutableListOf<Message>()
        try {
            val str = prefs.getString("cached_messages_$chatId", null) ?: return list
            val jsonArray = JSONArray(str)
            for (i in 0 until jsonArray.length()) {
                val obj = jsonArray.getJSONObject(i)
                list.add(parseMessageJson(obj, chatId))
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return list
    }

    /** Розбирає повідомлення з JSON (сервер, кеш) разом із фото/відео. */
    private fun parseMessageJson(obj: JSONObject, defaultChatId: String): Message {
        fun optNullable(name: String): String? =
            if (obj.isNull(name)) null else obj.optString(name, "").ifEmpty { null }

        return Message(
            id = obj.optString("id", ""),
            chatId = obj.optString("chatId", defaultChatId),
            senderEmail = obj.optString("senderEmail", ""),
            receiverEmail = obj.optString("receiverEmail", ""),
            text = obj.optString("text", ""),
            timestamp = obj.optLong("timestamp", System.currentTimeMillis()),
            fileUrl = absoluteUrl(optNullable("fileUrl")),
            fileType = optNullable("fileType"),
            thumbUrl = absoluteUrl(optNullable("thumbUrl")),
            fileName = optNullable("fileName")
        )
    }

    // ---------- "Видалити в мене": приховані повідомлення зберігаються лише на цьому пристрої ----------
    private fun getHiddenIds(chatId: String): Set<String> =
        prefs.getStringSet("hidden_msgs_$chatId", emptySet()) ?: emptySet()

    private fun addHiddenId(chatId: String, messageId: String) {
        val updated = HashSet(getHiddenIds(chatId))
        updated.add(messageId)
        prefs.edit().putStringSet("hidden_msgs_$chatId", updated).apply()
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
                    val avatar = obj.optString("avatarUrl", cachedAvatar)
                    prefs.edit().putString("profile_name_$cleanEmail", name).putString("profile_avatar_$cleanEmail", avatar).apply()
                    onResult(User(uid = cleanEmail, email = cleanEmail, name = name, avatarUrl = avatar))
                }
            }
        })
    }

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

        socket.emit("add_contact", req, io.socket.client.Ack { args ->
            mainHandler.post {
                if (args.isNotEmpty() && args[0] is JSONObject) {
                    val res = args[0] as JSONObject
                    val success = res.optBoolean("success", false)
                    val message = if (res.optString("code", "") == "invalid") AppText.tr(context, "bad_email") else AppText.tr(context, "error_generic")

                    if (success) {
                        val userObj = res.optJSONObject("user")
                        val user = if (userObj != null) {
                            User(
                                uid = userObj.optString("email", cleanTargetEmail),
                                email = userObj.optString("email", cleanTargetEmail),
                                name = userObj.optString("name", cleanTargetEmail.substringBefore("@")),
                                avatarUrl = userObj.optString("avatarUrl", DEFAULT_AVATAR_URL)
                            )
                        } else null
                        onResult(true, user, message)
                    } else {
                        onResult(false, null, message)
                    }
                } else {
                    onResult(false, null, AppText.tr(context, "server_waking"))
                }
            }
        })
    }

    fun listenToUserContacts(myEmail: String, onContactsUpdated: (List<User>) -> Unit) {
        val cleanEmail = myEmail.trim().lowercase()
        if (cleanEmail.isEmpty()) return

        val cached = getCachedContacts(cleanEmail)
        if (cached.isNotEmpty()) {
            onContactsUpdated(cached)
        }

        ensureConnected()

        fun fetchAndNotify() {
            socket.emit("get_contacts", cleanEmail, io.socket.client.Ack { args ->
                mainHandler.post {
                    if (args.isNotEmpty() && args[0] is JSONArray) {
                        val array = args[0] as JSONArray
                        val list = mutableListOf<User>()
                        for (i in 0 until array.length()) {
                            val obj = array.getJSONObject(i)
                            list.add(
                                User(
                                    uid = obj.optString("email", ""),
                                    email = obj.optString("email", ""),
                                    name = obj.optString("name", ""),
                                    avatarUrl = obj.optString("avatarUrl", DEFAULT_AVATAR_URL)
                                )
                            )
                        }
                        cacheContactsLocally(cleanEmail, list)
                        onContactsUpdated(list)
                    }
                }
            })
        }

        fetchAndNotify()

        socket.off("contact_updated")
        socket.on("contact_updated") {
            fetchAndNotify()
        }
    }

    fun startGlobalMessageListener(myEmail: String) {
        val cleanEmail = myEmail.trim().lowercase()
        if (cleanEmail.isEmpty()) return
        ensureConnected()

        identifiedEmail = cleanEmail
        sendIdentify()

        if (!isGlobalListenerInitialized) {
            isGlobalListenerInitialized = true

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
                    val obj = args[0] as JSONObject
                    val msgChatId = obj.optString("chatId", "")
                    val msgSender = obj.optString("senderEmail", "")
                    val msgText = obj.optString("text", "")
                    val receiver = obj.optString("receiverEmail", "")
                    val parsed = parseMessageJson(obj, msgChatId)

                    if (msgSender.isNotEmpty()) {
                        mainHandler.post { TypingState.until.remove(msgSender.trim().lowercase()) }
                    }

                    if (receiver.trim().lowercase() == cleanEmail && msgSender.trim().lowercase() != cleanEmail) {
                        if (msgChatId != currentActiveChatId) {
                            val preview = when {
                                msgText.isNotEmpty() -> msgText
                                parsed.fileType == "video" -> AppText.tr(context, "label_video")
                                parsed.fileType == "image" -> AppText.tr(context, "label_photo")
                                parsed.fileType == "file" -> AppText.tr(context, "label_file")
                                else -> ""
                            }
                            showBackgroundMessageNotification(msgSender, preview)
                        }
                    }

                    if (msgChatId == currentActiveChatId) {
                        currentChatMessagesList?.let { list ->
                            val msgId = obj.optString("id", "")
                            if (list.none { it.id == msgId } && !getHiddenIds(msgChatId).contains(msgId)) {
                                list.add(parsed)
                                cacheMessagesLocally(msgChatId, list)
                                mainHandler.post {
                                    currentChatCallback?.invoke(list.toList())
                                }
                            }
                        }
                    }
                }
            }

            socket.on("message_deleted") { args ->
                if (args.isNotEmpty() && args[0] is String) {
                    val deletedId = args[0] as String
                    currentChatMessagesList?.let { list ->
                        list.removeAll { it.id == deletedId }
                        currentActiveChatId?.let { chatId ->
                            cacheMessagesLocally(chatId, list)
                        }
                        mainHandler.post {
                            currentChatCallback?.invoke(list.toList())
                        }
                    }
                }
            }
        }
    }

    fun connectAndListenForMessages(
        senderEmail: String,
        receiverEmail: String,
        onMessagesUpdated: (List<Message>) -> Unit
    ) {
        val chatId = getChatId(senderEmail, receiverEmail)
        currentActiveChatId = chatId
        activeChatForRejoin = chatId
        currentChatCallback = onMessagesUpdated

        val cachedMsgs = getCachedMessages(chatId).filter { !getHiddenIds(chatId).contains(it.id) }
        val messagesList = mutableListOf<Message>().apply { addAll(cachedMsgs) }
        currentChatMessagesList = messagesList

        if (messagesList.isNotEmpty()) {
            onMessagesUpdated(messagesList)
        }

        ensureConnected()

        socket.off("load_history")
        socket.on("load_history") { args ->
            if (args.isNotEmpty() && args[0] is JSONArray) {
                val array = args[0] as JSONArray
                val hidden = getHiddenIds(chatId)
                messagesList.clear()
                for (i in 0 until array.length()) {
                    val obj = array.getJSONObject(i)
                    val parsed = parseMessageJson(obj, chatId)
                    if (!hidden.contains(parsed.id)) {
                        messagesList.add(parsed)
                    }
                }
                cacheMessagesLocally(chatId, messagesList)
                mainHandler.post { onMessagesUpdated(messagesList.toList()) }
            }
        }

        val joinData = JSONObject().apply { put("chatId", chatId) }
        socket.emit("join_chat", joinData)
    }

    private fun showBackgroundMessageNotification(sender: String, text: String) {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, MSG_CHANNEL_ID)
            .setContentTitle(AppText.tr(context, "msg_new_from", sender))
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(sender.hashCode(), notification)
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
        val chatId = getChatId(senderEmail, receiverEmail)
        ensureConnected()

        val jsonMsg = JSONObject().apply {
            put("id", UUID.randomUUID().toString())
            put("chatId", chatId)
            put("senderEmail", senderEmail)
            put("receiverEmail", receiverEmail)
            put("text", text)
            put("timestamp", System.currentTimeMillis())
            if (!relFile.isNullOrEmpty()) {
                put("fileUrl", relFile)
                put("fileType", fileType ?: "image")
                val relThumb = relativeUrl(thumbUrl)
                if (!relThumb.isNullOrEmpty()) put("thumbUrl", relThumb)
                if (!fileName.isNullOrEmpty()) put("fileName", fileName)
            }
        }

        socket.emit("send_message", jsonMsg)
        sendTyping(senderEmail, receiverEmail, false)
    }

    /**
     * Видалення повідомлення.
     * forEveryone = true  — видалити в обох співрозмовників (сервер дозволяє лише автору);
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
            addHiddenId(chatId, messageId)
            currentChatMessagesList?.let { list ->
                list.removeAll { it.id == messageId }
                if (currentActiveChatId == chatId) {
                    cacheMessagesLocally(chatId, list)
                    mainHandler.post { currentChatCallback?.invoke(list.toList()) }
                }
            }
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

    /** Контакти з локального кешу (для вибору, кому переслати повідомлення). */
    fun cachedContacts(myEmail: String): List<User> = getCachedContacts(myEmail.trim().lowercase())

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
        currentChatMessagesList = null
        socket.off("load_history")
    }

    fun listenForCallHistory(myEmail: String, onLogsUpdated: (List<CallLogItem>) -> Unit) {
        onLogsUpdated(emptyList())
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

    fun listenForCallEvents(
        myEmail: String,
        onIncomingCall: (String) -> Unit,
        onCallAnswered: () -> Unit,
        onCallRejected: () -> Unit,
        onCallEnded: () -> Unit,
        onCallBusy: () -> Unit
    ) {
        val cleanEmail = myEmail.trim().lowercase()
        if (cleanEmail.isEmpty()) return
        ensureConnected()

        socket.off("incoming_call_$cleanEmail")
        socket.off("call_answered_$cleanEmail")
        socket.off("call_rejected_$cleanEmail")
        socket.off("call_ended_$cleanEmail")
        socket.off("call_busy_$cleanEmail")

        socket.on("incoming_call_$cleanEmail") { args ->
            if (args.isNotEmpty() && args[0] is JSONObject) {
                val obj = args[0] as JSONObject
                val caller = obj.optString("callerEmail", "")
                mainHandler.post { onIncomingCall(caller) }
            }
        }

        socket.on("call_answered_$cleanEmail") {
            mainHandler.post { onCallAnswered() }
        }

        socket.on("call_rejected_$cleanEmail") {
            mainHandler.post { onCallRejected() }
        }

        socket.on("call_ended_$cleanEmail") {
            mainHandler.post { onCallEnded() }
        }

        socket.on("call_busy_$cleanEmail") {
            mainHandler.post { onCallBusy() }
        }
    }

    private fun getChatId(email1: String, email2: String): String {
        val e1 = email1.trim().lowercase().replace(".", "_dot_")
        val e2 = email2.trim().lowercase().replace(".", "_dot_")
        return if (e1 < e2) "${e1}_${e2}" else "${e2}_${e1}"
    }
}
