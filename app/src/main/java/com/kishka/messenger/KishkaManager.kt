package com.kishka.messenger

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.storage.FirebaseStorage
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import kotlin.concurrent.thread

class KishkaManager(private val context: Context) {

    private val db = FirebaseFirestore.getInstance()
    private val storage = FirebaseStorage.getInstance()

    /**
     * Реєстрація або створення профілю користувача в БД Firestore
     */
    fun registerUserInGlobalContacts(phone: String, name: String = "Користувач Kishka") {
        val userRef = db.collection("users").document(phone)
        userRef.get().addOnSuccessListener { doc ->
            if (!doc.exists()) {
                val user = User(
                    uid = phone,
                    phone = phone,
                    name = name,
                    status = "Online",
                    avatarUrl = DEFAULT_AVATAR_URL
                )
                userRef.set(user)
            }
        }
    }

    /**
     * Перевірка: чи існує користувач у базі даних Kishka Messenger
     */
    fun checkUserExists(phone: String, onResult: (Boolean) -> Unit) {
        db.collection("users").document(phone).get()
            .addOnSuccessListener { doc -> onResult(doc.exists()) }
            .addOnFailureListener { onResult(false) }
    }

    /**
     * Завантаження аватарки з галереї пристрою у Firebase Storage та збереження даних профілю у Firestore
     */
    fun updateUserProfile(
        email: String,
        newName: String,
        avatarUri: Uri?,
        onComplete: (Boolean, String?) -> Unit
    ) {
        if (avatarUri != null) {
            val photoRef = storage.reference.child("avatars/$email.jpg")
            photoRef.putFile(avatarUri).addOnSuccessListener {
                photoRef.downloadUrl.addOnSuccessListener { downloadUrl ->
                    val avatarUrlStr = downloadUrl.toString()
                    val updates = mapOf(
                        "name" to newName,
                        "avatarUrl" to avatarUrlStr
                    )
                    db.collection("users").document(email).update(updates)
                        .addOnSuccessListener { onComplete(true, avatarUrlStr) }
                        .addOnFailureListener { onComplete(false, null) }
                }.addOnFailureListener { onComplete(false, null) }
            }.addOnFailureListener { onComplete(false, null) }
        } else {
            val updates = mapOf("name" to newName)
            db.collection("users").document(email).update(updates)
                .addOnSuccessListener { onComplete(true, null) }
                .addOnFailureListener { onComplete(false, null) }
        }
    }

    /**
     * Отримання профілю користувача з БД
     */
    fun getUserProfile(email: String, onResult: (User?) -> Unit) {
        db.collection("users").document(email).get().addOnSuccessListener { snapshot ->
            onResult(snapshot.toObject(User::class.java))
        }.addOnFailureListener { onResult(null) }
    }

    fun listenToAllContacts(onContactsUpdated: (List<User>) -> Unit) {
        db.collection("users").addSnapshotListener { snapshot, _ ->
            if (snapshot != null) {
                val users = snapshot.toObjects(User::class.java)
                onContactsUpdated(users)
            }
        }
    }

    /**
     * Збереження повідомлень у Firestore
     */
    fun sendMessage(senderPhone: String, receiverPhone: String, text: String) {
        if (text.isBlank()) return
        val chatId = getChatId(senderPhone, receiverPhone)
        val msgId = UUID.randomUUID().toString()
        val message = Message(
            id = msgId,
            senderPhone = senderPhone,
            receiverPhone = receiverPhone,
            text = text
        )
        db.collection("chats").document(chatId).collection("messages").document(msgId).set(message)
    }

    fun sendFileMessage(senderPhone: String, receiverPhone: String, fileUri: Uri, fileType: String) {
        val fileId = UUID.randomUUID().toString()
        val ref = storage.reference.child("chat_files/$fileId")

        ref.putFile(fileUri).addOnSuccessListener {
            ref.downloadUrl.addOnSuccessListener { downloadUri ->
                val chatId = getChatId(senderPhone, receiverPhone)
                val message = Message(
                    id = fileId,
                    senderPhone = senderPhone,
                    receiverPhone = receiverPhone,
                    text = "📎 Надіслано файл ($fileType)",
                    fileUrl = downloadUri.toString(),
                    fileType = fileType
                )
                db.collection("chats").document(chatId).collection("messages").document(fileId).set(message)
            }
        }
    }

    fun listenForMessages(senderPhone: String, receiverPhone: String, onMessages: (List<Message>) -> Unit) {
        val chatId = getChatId(senderPhone, receiverPhone)
        db.collection("chats").document(chatId).collection("messages")
            .orderBy("timestamp", Query.Direction.ASCENDING)
            .addSnapshotListener { snapshot, _ ->
                if (snapshot != null) {
                    onMessages(snapshot.toObjects(Message::class.java))
                }
            }
    }

    /**
     * Запис історії дзвінків у базу даних Firestore
     */
    fun recordCallLog(myPhone: String, targetPhone: String, isMissed: Boolean = false) {
        val logId = UUID.randomUUID().toString()
        val time = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
        val log = CallLogItem(
            id = logId,
            callerName = targetPhone,
            callerPhone = targetPhone,
            time = time,
            duration = if (isMissed) "00:00" else "Дзвінок Kishka",
            isMissed = isMissed
        )
        db.collection("users").document(myPhone).collection("call_history").document(logId).set(log)
    }

    /**
     * Зчитування історії дзвінків із Firestore
     */
    fun listenForCallHistory(myPhone: String, onLogsUpdated: (List<CallLogItem>) -> Unit) {
        db.collection("users").document(myPhone).collection("call_history")
            .addSnapshotListener { snapshot, _ ->
                if (snapshot != null) {
                    onLogsUpdated(snapshot.toObjects(CallLogItem::class.java))
                }
            }
    }

    /**
     * Початок дзвінка
     */
    fun startCall(callerPhone: String, receiverPhone: String) {
        val callSignal = CallSignal(
            callId = UUID.randomUUID().toString(),
            callerPhone = callerPhone,
            receiverPhone = receiverPhone,
            status = "RINGING"
        )
        db.collection("calls").document(receiverPhone).set(callSignal)
        recordCallLog(callerPhone, receiverPhone)
    }

    fun listenForIncomingCalls(myPhone: String) {
        db.collection("calls").document(myPhone).addSnapshotListener { snapshot, _ ->
            val signal = snapshot?.toObject(CallSignal::class.java)
            if (signal != null && signal.status == "RINGING") {
                val intent = Intent(context, CallService::class.java).apply {
                    action = "ACTION_INCOMING"
                    putExtra("CALLER_NAME", signal.callerPhone)
                }
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            }
        }
    }

    private fun getChatId(phone1: String, phone2: String): String {
        return if (phone1 < phone2) "${phone1}_${phone2}" else "${phone2}_${phone1}"
    }
}
