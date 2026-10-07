package com.kishka.messenger

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreSettings
import com.google.firebase.firestore.Query
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
        var SERVER_URL = "https://kishka.onrender.com"
        const val DEFAULT_AVATAR_URL = "https://raw.githubusercontent.com/mukhalkivbohdancats-dev/Kishka/main/app/src/main/res/drawable/ic_launcher.png"
    }

    init {
        try {
            val settings = FirebaseFirestoreSettings.Builder()
                .setPersistenceEnabled(true)
                .build()
            db.firestoreSettings = settings
        } catch (e: Exception) {
            e.printStackTrace()
        }
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

    fun sanitizeEmail(email: String): String {
        return email.trim().lowercase().replace(".", "_dot_")
    }

    fun registerOrUpdateUserInDb(email: String, name: String, avatarUrl: String? = null) {
        val cleanEmail = email.trim().lowercase()
        if (cleanEmail.isEmpty()) return
        val docId = sanitizeEmail(cleanEmail)
        val userRef = db.collection("users").document(docId)

        userRef.get().addOnSuccessListener { doc ->
            val defaultName = if (name.isNotEmpty()) name else cleanEmail.substringBefore("@")
            if (!doc.exists()) {
                val newUser = User(
                    uid = docId,
                    email = cleanEmail,
                    name = defaultName,
                    status = "Online",
                    avatarUrl = avatarUrl ?: DEFAULT_AVATAR_URL
                )
                userRef.set(newUser)
            } else {
                val updates = mutableMapOf<String, Any>("email" to cleanEmail)
                if (name.isNotEmpty()) updates["name"] = name
                if (!avatarUrl.isNullOrEmpty()) updates["avatarUrl"] = avatarUrl
                userRef.update(updates)
            }
        }.addOnFailureListener {
            val defaultName = if (name.isNotEmpty()) name else cleanEmail.substringBefore("@")
            val newUser = User(
                uid = docId,
                email = cleanEmail,
                name = defaultName,
                status = "Online",
                avatarUrl = avatarUrl ?: DEFAULT_AVATAR_URL
            )
            userRef.set(newUser)
        }
    }

    /**
     * Взаємне (двостороннє) додавання контактів у Firebase.
     * Після видалення/перевстановлення додатка всі контакти відновлюються з хмари!
     */
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

        val targetDocId = sanitizeEmail(cleanTargetEmail)

        db.collection("users").document(targetDocId).get()
            .addOnSuccessListener { doc ->
                if (doc.exists()) {
                    val targetUser = doc.toObject(User::class.java)
                    if (targetUser != null) {
                        saveMutualContacts(cleanMyEmail, cleanTargetEmail, targetUser, onResult)
                    } else {
                        onResult(false, null, "Помилка даних користувача.")
                    }
                } else {
                    db.collection("users")
                        .whereEqualTo("email", cleanTargetEmail)
                        .get()
                        .addOnSuccessListener { querySnapshot ->
                            if (!querySnapshot.isEmpty) {
                                val foundDoc = querySnapshot.documents[0]
                                val targetUser = foundDoc.toObject(User::class.java)
                                if (targetUser != null) {
                                    saveMutualContacts(cleanMyEmail, cleanTargetEmail, targetUser, onResult)
                                } else {
                                    onResult(false, null, "Помилка обробки контакту.")
                                }
                            } else {
                                onResult(false, null, "Користувача з поштою $cleanTargetEmail не знайдено!")
                            }
                        }
                        .addOnFailureListener { e ->
                            onResult(false, null, "Помилка мережі: ${e.localizedMessage}")
                        }
                }
            }
            .addOnFailureListener { e ->
                onResult(false, null, "Помилка з'єднання: ${e.localizedMessage}")
            }
    }

    private fun saveMutualContacts(
        myEmail: String,
        targetEmail: String,
        targetUser: User,
        onResult: (Boolean, User?, String?) -> Unit
    ) {
        val myDocId = sanitizeEmail(myEmail)
        val targetDocId = sanitizeEmail(targetEmail)

        // 1. Зберігаємо співрозмовника у мої контакти
        db.collection("users").document(myDocId)
            .collection("my_contacts").document(targetDocId).set(targetUser)
            .addOnSuccessListener {
                // 2. Взаємно зберігаємо мене у контакти співрозмовника
                getUserProfile(myEmail) { myUser ->
                    val selfUser = myUser ?: User(
                        uid = myDocId,
                        email = myEmail,
                        name = myEmail.substringBefore("@"),
                        avatarUrl = DEFAULT_AVATAR_URL
                    )
                    db.collection("users").document(targetDocId)
                        .collection("my_contacts").document(myDocId).set(selfUser)
                }
                onResult(true, targetUser, "Контакт успішно додано!")
            }
            .addOnFailureListener { e ->
                onResult(false, null, "Не вдалося зберегти контакт: ${e.localizedMessage}")
            }
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

    // --- Збереження повідомлень (Socket.io + Firebase Firestore) ---

    fun connectAndListenForMessages(
        senderEmail: String,
        receiverEmail: String,
        onMessagesUpdated: (List<Message>) -> Unit
    ) {
        val chatId = getChatId(senderEmail, receiverEmail)
        currentActiveChatId = chatId

        // Читання та збереження з Firestore
        db.collection("chats").document(chatId).collection("messages")
            .orderBy("timestamp", Query.Direction.ASCENDING)
            .addSnapshotListener { snapshot, _ ->
                if (snapshot != null && !snapshot.isEmpty) {
                    val fsMessages = snapshot.toObjects(Message::class.java)
                    mainHandler.post {
                        onMessagesUpdated(fsMessages)
                    }
                }
            }

        // Live-з'єднання через Socket.io
        if (socket == null || socket?.connected() != true) {
            initSocket()
        }

        val joinData = JSONObject().apply { put("chatId", chatId) }
        socket?.emit("join_chat", joinData)
    }

    fun sendMessage(senderEmail: String, receiverEmail: String, text: String) {
        if (text.isBlank()) return
        val chatId = getChatId(senderEmail, receiverEmail)
        val msgId = UUID.randomUUID().toString()
        val timestamp = System.currentTimeMillis()

        val msg = Message(
            id = msgId,
            chatId = chatId,
            senderEmail = senderEmail,
            receiverEmail = receiverEmail,
            text = text,
            timestamp = timestamp
        )

        // 1. Відправка у сокет
        val jsonMsg = JSONObject().apply {
            put("id", msgId)
            put("chatId", chatId)
            put("senderEmail", senderEmail)
            put("receiverEmail", receiverEmail)
            put("text", text)
            put("timestamp", timestamp)
        }
        socket?.emit("send_message", jsonMsg)

        // 2. Постійне збереження в Firestore
        db.collection("chats").document(chatId)
            .collection("messages").document(msgId).set(msg)
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

    fun leaveChatRoom() {
        currentActiveChatId?.let { chatId ->
            socket?.emit("leave_chat", chatId)
        }
        currentActiveChatId = null
    }

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
