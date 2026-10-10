package com.kishka.messenger

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.UserProfileChangeRequest
import com.google.firebase.storage.FirebaseStorage
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class KishkaManager(private val context: Context) {

    private val storage = FirebaseStorage.getInstance()
    private val auth = FirebaseAuth.getInstance()
    private val mainHandler = Handler(Looper.getMainLooper())

    private var currentActiveChatId: String? = null

    companion object {
        const val SERVER_URL = "https://kishka.onrender.com"
        const val DEFAULT_AVATAR_URL = "https://raw.githubusercontent.com/mukhalkivbohdancats-dev/Kishka/main/app/src/main/res/drawable/ic_launcher.png"
        
        private var socketInstance: Socket? = null

        @Synchronized
        fun getSocket(): Socket {
            if (socketInstance == null) {
                try {
                    val options = IO.Options().apply {
                        forceNew = false // Виправлено: використовуємо стабільне з'єднання замість створення нових сокетів
                        reconnection = true
                        reconnectionAttempts = Int.MAX_VALUE
                        reconnectionDelay = 1000
                        timeout = 20000
                    }
                    socketInstance = IO.socket(SERVER_URL, options)
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
        ensureConnected()

        var handled = false
        val timeoutRunnable = Runnable {
            if (!handled) {
                handled = true
                onResult(User(uid = cleanEmail, email = cleanEmail, name = cleanEmail.substringBefore("@"), avatarUrl = DEFAULT_AVATAR_URL))
            }
        }
        mainHandler.postDelayed(timeoutRunnable, 4000)

        socket.emit("get_user_profile", cleanEmail, io.socket.client.Ack { args ->
            mainHandler.post {
                if (!handled) {
                    handled = true
                    mainHandler.removeCallbacks(timeoutRunnable)
                    if (args.isNotEmpty() && args[0] is JSONObject) {
                        val obj = args[0] as JSONObject
                        val user = User(
                            uid = obj.optString("email", cleanEmail),
                            email = obj.optString("email", cleanEmail),
                            name = obj.optString("name", cleanEmail.substringBefore("@")),
                            avatarUrl = obj.optString("avatarUrl", DEFAULT_AVATAR_URL)
                        )
                        onResult(user)
                    } else {
                        onResult(null)
                    }
                }
            }
        })
    }

    fun addContactByEmail(myEmail: String, targetEmail: String, onResult: (Boolean, User?, String?) -> Unit) {
        val cleanTargetEmail = targetEmail.trim().lowercase()
        val cleanMyEmail = myEmail.trim().lowercase()

        if (cleanTargetEmail.isEmpty() || !cleanTargetEmail.contains("@")) {
            onResult(false, null, "Некоректний формат пошти!")
            return
        }

        if (cleanTargetEmail == cleanMyEmail) {
            onResult(false, null, "Ви не можете додати самі себе!")
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
                    val message = res.optString("message", "Помилка")

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
                    onResult(false, null, "Сервер Render не відповідає. Зачекайте пару секунд.")
                }
            }
        })
    }

    fun listenToUserContacts(myEmail: String, onContactsUpdated: (List<User>) -> Unit) {
        val cleanEmail = myEmail.trim().lowercase()
        if (cleanEmail.isEmpty()) return
        ensureConnected()

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
                    onContactsUpdated(list)
                } else {
                    onContactsUpdated(emptyList())
                }
            }
        })
    }

    fun connectAndListenForMessages(
        senderEmail: String,
        receiverEmail: String,
        onMessagesUpdated: (List<Message>) -> Unit
    ) {
        val chatId = getChatId(senderEmail, receiverEmail)
        currentActiveChatId = chatId
        ensureConnected()

        val messagesList = mutableListOf<Message>()

        socket.off("load_history")
        socket.off("receive_message")
        socket.off("message_deleted")

        socket.on("load_history") { args ->
            if (args.isNotEmpty() && args[0] is JSONArray) {
                val array = args[0] as JSONArray
                messagesList.clear()
                for (i in 0 until array.length()) {
                    val obj = array.getJSONObject(i)
                    messagesList.add(
                        Message(
                            id = obj.optString("id", ""),
                            chatId = obj.optString("chatId", chatId),
                            senderEmail = obj.optString("senderEmail", ""),
                            receiverEmail = obj.optString("receiverEmail", ""),
                            text = obj.optString("text", ""),
                            timestamp = obj.optLong("timestamp", System.currentTimeMillis())
                        )
                    )
                }
                mainHandler.post { onMessagesUpdated(messagesList.toList()) }
            }
        }

        socket.on("receive_message") { args ->
            if (args.isNotEmpty() && args[0] is JSONObject) {
                val obj = args[0] as JSONObject
                val msgChatId = obj.optString("chatId", "")
                if (msgChatId == currentActiveChatId) {
                    messagesList.add(
                        Message(
                            id = obj.optString("id", ""),
                            chatId = msgChatId,
                            senderEmail = obj.optString("senderEmail", ""),
                            receiverEmail = obj.optString("receiverEmail", ""),
                            text = obj.optString("text", ""),
                            timestamp = obj.optLong("timestamp", System.currentTimeMillis())
                        )
                    )
                    mainHandler.post { onMessagesUpdated(messagesList.toList()) }
                }
            }
        }

        socket.on("message_deleted") { args ->
            if (args.isNotEmpty() && args[0] is String) {
                val deletedId = args[0] as String
                messagesList.removeAll { it.id == deletedId }
                mainHandler.post { onMessagesUpdated(messagesList.toList()) }
            }
        }

        val joinData = JSONObject().apply { put("chatId", chatId) }
        socket.emit("join_chat", joinData)
    }

    fun sendMessage(senderEmail: String, receiverEmail: String, text: String) {
        if (text.isBlank()) return
        val chatId = getChatId(senderEmail, receiverEmail)
        ensureConnected()

        val jsonMsg = JSONObject().apply {
            put("id", UUID.randomUUID().toString())
            put("chatId", chatId)
            put("senderEmail", senderEmail)
            put("receiverEmail", receiverEmail)
            put("text", text)
            put("timestamp", System.currentTimeMillis())
        }

        socket.emit("send_message", jsonMsg)
    }

    fun deleteMessage(senderEmail: String, receiverEmail: String, messageId: String) {
        val chatId = getChatId(senderEmail, receiverEmail)
        ensureConnected()
        val json = JSONObject().apply {
            put("messageId", messageId)
            put("chatId", chatId)
        }
        socket.emit("delete_message", json)
    }

    fun sendFileMessage(senderEmail: String, receiverEmail: String, fileUri: Uri, fileType: String) {
        val fileId = UUID.randomUUID().toString()
        val ref = storage.reference.child("chat_files/$fileId")

        ref.putFile(fileUri).addOnSuccessListener {
            ref.downloadUrl.addOnSuccessListener { downloadUri ->
                sendMessage(senderEmail, receiverEmail, "Файл: $fileType ($downloadUri)")
            }
        }
    }

    fun updateUserProfile(
        email: String,
        newName: String,
        avatarUri: Uri?,
        onComplete: (Boolean, String?) -> Unit
    ) {
        val cleanEmail = email.trim().lowercase()
        val currentUser = auth.currentUser

        if (avatarUri != null) {
            val photoRef = storage.reference.child("avatars/$cleanEmail.jpg")
            photoRef.putFile(avatarUri).addOnSuccessListener {
                photoRef.downloadUrl.addOnSuccessListener { downloadUrl ->
                    val avatarUrlStr = downloadUrl.toString()
                    val profileUpdates = UserProfileChangeRequest.Builder()
                        .setDisplayName(newName)
                        .setPhotoUri(Uri.parse(avatarUrlStr))
                        .build()

                    currentUser?.updateProfile(profileUpdates)?.addOnCompleteListener {
                        registerOrUpdateUserInDb(cleanEmail, newName, avatarUrlStr)
                        onComplete(true, avatarUrlStr)
                    } ?: run {
                        registerOrUpdateUserInDb(cleanEmail, newName, avatarUrlStr)
                        onComplete(true, avatarUrlStr)
                    }
                }.addOnFailureListener { onComplete(false, null) }
            }.addOnFailureListener { onComplete(false, null) }
        } else {
            val profileUpdates = UserProfileChangeRequest.Builder()
                .setDisplayName(newName)
                .build()

            currentUser?.updateProfile(profileUpdates)?.addOnCompleteListener {
                registerOrUpdateUserInDb(cleanEmail, newName, null)
                onComplete(true, null)
            } ?: run {
                registerOrUpdateUserInDb(cleanEmail, newName, null)
                onComplete(true, null)
            }
        }
    }

    fun leaveChatRoom() {
        currentActiveChatId?.let { chatId ->
            socket.emit("leave_chat", chatId)
        }
        currentActiveChatId = null
        socket.off("load_history")
        socket.off("receive_message")
        socket.off("message_deleted")
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

    fun sendVoiceChunk(targetEmail: String, chunk: ByteArray) {
        if (targetEmail.isEmpty()) return
        ensureConnected()
        try {
            val base64Str = Base64.encodeToString(chunk, Base64.NO_WRAP)
            val json = JSONObject().apply {
                put("targetEmail", targetEmail.trim().lowercase())
                put("chunk", base64Str)
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
