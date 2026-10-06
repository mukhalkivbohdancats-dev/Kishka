package com.kishka.messenger

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import com.google.firebase.firestore.FirebaseFirestore
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

    private val db = FirebaseFirestore.getInstance()
    private val storage = FirebaseStorage.getInstance()
    private val mainHandler = Handler(Looper.getMainLooper())

    private var socket: Socket? = null
    private var currentActiveChatId: String? = null

    companion object {
        // Заміни це посилання на своє, яке дасть Render (збережи https:// на початку)
        var SERVER_URL = "https://kishka-main.onrender.com"
        const val DEFAULT_AVATAR_URL = "https://via.placeholder.com/150"
    }

    init {
        initSocket()
    }

    private fun initSocket() {
        try {
            val options = IO.Options().apply {
                forceNew = true
                reconnection = true
            }
            socket = IO.socket(SERVER_URL, options)
            socket?.connect()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun sanitizeEmail(email: String): String {
        return email.trim().lowercase().replace(".", "_dot_")
    }

    fun registerOrUpdateUserInDb(email: String, name: String, avatarUrl: String? = null) {
        val docId = sanitizeEmail(email)
        val userRef = db.collection("users").document(docId)
        userRef.get().addOnSuccessListener { doc ->
            if (!doc.exists()) {
                val newUser = User(
                    uid = docId,
                    email = email.trim().lowercase(),
                    name = name.ifEmpty { "Користувач Kishka" },
                    status = "Online",
                    avatarUrl = avatarUrl ?: DEFAULT_AVATAR_URL
                )
                userRef.set(newUser)
            }
        }
    }

    fun addContactByEmail(myEmail: String, targetEmail: String, onResult: (Boolean, User?) -> Unit) {
        val targetDocId = sanitizeEmail(targetEmail)
        db.collection("users").document(targetDocId).get()
            .addOnSuccessListener { doc ->
                if (doc.exists()) {
                    val user = doc.toObject(User::class.java)
                    if (user != null) {
                        val myDocId = sanitizeEmail(myEmail)
                        db.collection("users").document(myDocId)
                            .collection("my_contacts").document(targetDocId).set(user)
                        onResult(true, user)
                    } else {
                        onResult(false, null)
                    }
                } else {
                    onResult(false, null)
                }
            }
            .addOnFailureListener { onResult(false, null) }
    }

    fun updateUserProfile(
        email: String,
        newName: String,
        avatarUri: Uri?,
        onComplete: (Boolean, String?) -> Unit
    ) {
        val docId = sanitizeEmail(email)
        if (avatarUri != null) {
            val photoRef = storage.reference.child("avatars/$docId.jpg")
            photoRef.putFile(avatarUri).addOnSuccessListener {
                photoRef.downloadUrl.addOnSuccessListener { downloadUrl ->
                    val avatarUrlStr = downloadUrl.toString()
                    val updates = mapOf(
                        "name" to newName,
                        "avatarUrl" to avatarUrlStr
                    )
                    db.collection("users").document(docId).update(updates)
                        .addOnSuccessListener { onComplete(true, avatarUrlStr) }
                        .addOnFailureListener { onComplete(false, null) }
                }.addOnFailureListener { onComplete(false, null) }
            }.addOnFailureListener { onComplete(false, null) }
        } else {
            val updates = mapOf("name" to newName)
            db.collection("users").document(docId).update(updates)
                .addOnSuccessListener { onComplete(true, null) }
                .addOnFailureListener { onComplete(false, null) }
        }
    }

    fun getUserProfile(email: String, onResult: (User?) -> Unit) {
        val docId = sanitizeEmail(email)
        db.collection("users").document(docId).get().addOnSuccessListener { snapshot ->
            onResult(snapshot.toObject(User::class.java))
        }.addOnFailureListener { onResult(null) }
    }

    fun listenToUserContacts(myEmail: String, onContactsUpdated: (List<User>) -> Unit) {
        val myDocId = sanitizeEmail(myEmail)
        db.collection("users").document(myDocId).collection("my_contacts")
            .addSnapshotListener { snapshot, _ ->
                if (snapshot != null) {
                    onContactsUpdated(snapshot.toObjects(User::class.java))
                }
            }
    }

    // --- Логіка чату через Socket.io ---

    fun connectAndListenForMessages(
        senderEmail: String,
        receiverEmail: String,
        onMessagesUpdated: (List<Message>) -> Unit
    ) {
        val chatId = getChatId(senderEmail, receiverEmail)
        currentActiveChatId = chatId

        if (socket == null || socket?.connected() != true) {
            initSocket()
        }

        val messagesList = mutableListOf<Message>()

        socket?.off("load_history")
        socket?.off("receive_message")

        socket?.on("load_history") { args ->
            if (args.isNotEmpty()) {
                val array = args[0] as? JSONArray ?: return@on
                messagesList.clear()
                for (i in 0 until array.length()) {
                    val obj = array.getJSONObject(i)
                    val msg = Message(
                        id = obj.optString("id", ""),
                        chatId = obj.optString("chatId", chatId),
                        senderEmail = obj.optString("senderEmail", ""),
                        receiverEmail = obj.optString("receiverEmail", ""),
                        text = obj.optString("text", ""),
                        timestamp = obj.optLong("timestamp", System.currentTimeMillis())
                    )
                    messagesList.add(msg)
                }
                mainHandler.post {
                    onMessagesUpdated(messagesList.toList())
                }
            }
        }

        socket?.on("receive_message") { args ->
            if (args.isNotEmpty()) {
                val obj = args[0] as? JSONObject ?: return@on
                val msgChatId = obj.optString("chatId", "")
                if (msgChatId == currentActiveChatId) {
                    val msg = Message(
                        id = obj.optString("id", ""),
                        chatId = msgChatId,
                        senderEmail = obj.optString("senderEmail", ""),
                        receiverEmail = obj.optString("receiverEmail", ""),
                        text = obj.optString("text", ""),
                        timestamp = obj.optLong("timestamp", System.currentTimeMillis())
                    )
                    messagesList.add(msg)
                    mainHandler.post {
                        onMessagesUpdated(messagesList.toList())
                    }
                }
            }
        }

        val joinData = JSONObject().apply {
            put("chatId", chatId)
        }
        socket?.emit("join_chat", joinData)
    }

    fun leaveChatRoom() {
        currentActiveChatId?.let { chatId ->
            socket?.emit("leave_chat", chatId)
        }
        currentActiveChatId = null
        socket?.off("load_history")
        socket?.off("receive_message")
    }

    fun sendMessage(senderEmail: String, receiverEmail: String, text: String) {
        if (text.isBlank()) return
        val chatId = getChatId(senderEmail, receiverEmail)

        val jsonMsg = JSONObject().apply {
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
                val chatId = getChatId(senderEmail, receiverEmail)
                val jsonMsg = JSONObject().apply {
                    put("chatId", chatId)
                    put("senderEmail", senderEmail)
                    put("receiverEmail", receiverEmail)
                    put("text", "Файл: $fileType ($downloadUri)")
                    put("timestamp", System.currentTimeMillis())
                }
                socket?.emit("send_message", jsonMsg)
            }
        }
    }

    // --- Дзвінки через Firebase ---

    fun recordCallLog(myEmail: String, targetEmail: String, isMissed: Boolean = false) {
        val myDocId = sanitizeEmail(myEmail)
        val logId = UUID.randomUUID().toString()
        val time = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
        val log = CallLogItem(
            id = logId,
            callerName = targetEmail,
            callerEmail = targetEmail,
            time = time,
            duration = if (isMissed) "00:00" else "Дзвінок Kishka",
            isMissed = isMissed
        )
        db.collection("users").document(myDocId).collection("call_history").document(logId).set(log)
    }

    fun listenForCallHistory(myEmail: String, onLogsUpdated: (List<CallLogItem>) -> Unit) {
        val myDocId = sanitizeEmail(myEmail)
        db.collection("users").document(myDocId).collection("call_history")
            .addSnapshotListener { snapshot, _ ->
                if (snapshot != null) {
                    onLogsUpdated(snapshot.toObjects(CallLogItem::class.java))
                }
            }
    }

    fun startCall(callerEmail: String, receiverEmail: String) {
        val receiverDocId = sanitizeEmail(receiverEmail)
        val callSignal = CallSignal(
            callId = UUID.randomUUID().toString(),
            callerEmail = callerEmail,
            receiverEmail = receiverEmail,
            status = "RINGING"
        )
        db.collection("calls").document(receiverDocId).set(callSignal)
        recordCallLog(callerEmail, receiverEmail)
    }

    fun listenForIncomingCalls(myEmail: String) {
        val myDocId = sanitizeEmail(myEmail)
        db.collection("calls").document(myDocId).addSnapshotListener { snapshot, _ ->
            val signal = snapshot?.toObject(CallSignal::class.java)
            if (signal != null && signal.status == "RINGING") {
                val intent = Intent(context, CallService::class.java).apply {
                    action = "ACTION_INCOMING"
                    putExtra("CALLER_NAME", signal.callerEmail)
                }
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            }
        }
    }

    private fun getChatId(email1: String, email2: String): String {
        val e1 = sanitizeEmail(email1)
        val e2 = sanitizeEmail(email2)
        return if (e1 < e2) "${e1}_${e2}" else "${e2}_${e1}"
    }
}
