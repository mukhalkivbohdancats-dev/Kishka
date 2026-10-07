package com.kishka.messenger

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.google.firebase.storage.FirebaseStorage
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

class KishkaManager(private val context: Context) {

    private val storage = FirebaseStorage.getInstance()
    private val mainHandler = Handler(Looper.getMainLooper())

    private var socket: Socket? = null
    private var currentActiveChatId: String? = null

    companion object {
        var SERVER_URL = "https://kishka.onrender.com"
        const val DEFAULT_AVATAR_URL = "https://raw.githubusercontent.com/mukhalkivbohdancats-dev/Kishka/main/app/src/main/res/drawable/ic_launcher.png"
    }

    init {
        initSocket()
    }

    private fun initSocket() {
        try {
            val options = IO.Options().apply {
                forceNew = true
                reconnection = true
                timeout = 20000
            }
            socket = IO.socket(SERVER_URL, options)
            socket?.connect()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun ensureConnected() {
        if (socket == null || socket?.connected() != true) {
            initSocket()
        }
    }

    fun sanitizeEmail(email: String): String {
        return email.trim().lowercase().replace(".", "_dot_")
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
        socket?.emit("register_or_update_user", json)
    }

    fun getUserProfile(email: String, onResult: (User?) -> Unit) {
        val cleanEmail = email.trim().lowercase()
        if (cleanEmail.isEmpty()) {
            onResult(null)
            return
        }
        ensureConnected()

        socket?.emit("get_user_profile", cleanEmail, io.socket.client.Ack { args ->
            mainHandler.post {
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

        socket?.emit("add_contact", req, io.socket.client.Ack { args ->
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

        socket?.emit("get_contacts", cleanEmail, io.socket.client.Ack { args ->
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

        socket?.off("load_history")
        socket?.off("receive_message")

        socket?.on("load_history") { args ->
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

        socket?.on("receive_message") { args ->
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

        val joinData = JSONObject().apply { put("chatId", chatId) }
        socket?.emit("join_chat", joinData)
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

        socket?.emit("send_message", jsonMsg)
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
        if (avatarUri != null) {
            val photoRef = storage.reference.child("avatars/$cleanEmail.jpg")
            photoRef.putFile(avatarUri).addOnSuccessListener {
                photoRef.downloadUrl.addOnSuccessListener { downloadUrl ->
                    val avatarUrlStr = downloadUrl.toString()
                    registerOrUpdateUserInDb(cleanEmail, newName, avatarUrlStr)
                    onComplete(true, avatarUrlStr)
                }.addOnFailureListener { onComplete(false, null) }
            }.addOnFailureListener { onComplete(false, null) }
        } else {
            registerOrUpdateUserInDb(cleanEmail, newName, null)
            onComplete(true, null)
        }
    }

    fun leaveChatRoom() {
        currentActiveChatId?.let { chatId ->
            socket?.emit("leave_chat", chatId)
        }
        currentActiveChatId = null
        socket?.off("load_history")
        socket?.off("receive_message")
    }

    fun recordCallLog(myEmail: String, targetEmail: String, isMissed: Boolean = false) {
    }

    fun listenForCallHistory(myEmail: String, onLogsUpdated: (List<CallLogItem>) -> Unit) {
        onLogsUpdated(emptyList())
    }

    fun startCall(callerEmail: String, receiverEmail: String) {
        ensureConnected()
        val json = JSONObject().apply {
            put("callerEmail", callerEmail)
            put("receiverEmail", receiverEmail)
        }
        socket?.emit("start_call", json)
    }

    fun listenForIncomingCalls(myEmail: String) {
        ensureConnected()
        socket?.on("incoming_call") { args ->
            if (args.isNotEmpty() && args[0] is JSONObject) {
                val obj = args[0] as JSONObject
                val callerEmail = obj.optString("callerEmail", "")
                val intent = Intent(context, CallService::class.java).apply {
                    action = "ACTION_INCOMING"
                    putExtra("CALLER_NAME", callerEmail)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            }
        }
    }

    private fun getChatId(email1: String, email2: String): String {
        val e1 = email1.trim().lowercase().replace(".", "_dot_")
        val e2 = email2.trim().lowercase().replace(".", "_dot_")
        return if (e1 < e2) "${e1}_${e2}" else "${e2}_${e1}"
    }
}
