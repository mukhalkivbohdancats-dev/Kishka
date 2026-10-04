package com.kishka.messenger

import android.content.Context
import android.content.Intent
import android.net.Uri
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.storage.FirebaseStorage
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

class KishkaManager(private val context: Context) {

    private val db = FirebaseFirestore.getInstance()
    private val storage = FirebaseStorage.getInstance()

    // Нормалізація ключа пошти для безпечного використання у Firestore
    private fun sanitizeEmail(email: String): String {
        return email.trim().lowercase().replace(".", "_dot_")
    }

    // Збереження / створення профілю у хмарі
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

    // Перевірка існування користувача за поштою (для додавання у контакти)
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

    // Оновлення імені та аватарки з завантаженням у Firebase Storage
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

    // Надсилання текстового повідомлення
    fun sendMessage(senderEmail: String, receiverEmail: String, text: String) {
        if (text.isBlank()) return
        val chatId = getChatId(senderEmail, receiverEmail)
        val msgId = UUID.randomUUID().toString()
        val message = Message(
            id = msgId,
            senderEmail = senderEmail,
            receiverEmail = receiverEmail,
            text = text,
            timestamp = System.currentTimeMillis()
        )
        db.collection("chats").document(chatId).collection("messages").document(msgId).set(message)
    }

    // Надсилання файлів у чат
    fun sendFileMessage(senderEmail: String, receiverEmail: String, fileUri: Uri, fileType: String) {
        val fileId = UUID.randomUUID().toString()
        val ref = storage.reference.child("chat_files/$fileId")

        ref.putFile(fileUri).addOnSuccessListener {
            ref.downloadUrl.addOnSuccessListener { downloadUri ->
                val chatId = getChatId(senderEmail, receiverEmail)
                val message = Message(
                    id = fileId,
                    senderEmail = senderEmail,
                    receiverEmail = receiverEmail,
                    text = "Файл: $fileType",
                    fileUrl = downloadUri.toString(),
                    fileType = fileType,
                    timestamp = System.currentTimeMillis()
                )
                db.collection("chats").document(chatId).collection("messages").document(fileId).set(message)
            }
        }
    }

    // Отримання повідомлень у реальному часі
    fun listenForMessages(senderEmail: String, receiverEmail: String, onMessages: (List<Message>) -> Unit) {
        val chatId = getChatId(senderEmail, receiverEmail)
        db.collection("chats").document(chatId).collection("messages")
            .orderBy("timestamp", Query.Direction.ASCENDING)
            .addSnapshotListener { snapshot, _ ->
                if (snapshot != null) {
                    onMessages(snapshot.toObjects(Message::class.java))
                }
            }
    }

    // Історія дзвінків
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
