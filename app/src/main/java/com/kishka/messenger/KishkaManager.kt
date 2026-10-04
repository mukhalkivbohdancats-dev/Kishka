package com.kishka.messenger

import android.content.Context
import android.content.Intent
import android.net.Uri
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.storage.FirebaseStorage
import java.util.UUID

data class User(
    val uid: String = "",
    val phone: String = "",
    val name: String = "",
    val avatarUrl: String = "",
    val status: String = "Online"
)

data class Message(
    val id: String = "",
    val senderPhone: String = "",
    val receiverPhone: String = "",
    val text: String = "",
    val fileUrl: String? = null,
    val fileType: String? = null,
    val timestamp: Long = System.currentTimeMillis()
)

data class CallLogItem(
    val id: String = "",
    val callerName: String = "",
    val callerPhone: String = "",
    val receiverPhone: String = "",
    val timestamp: Long = System.currentTimeMillis(),
    val duration: String = "00:00",
    val isMissed: Boolean = false
)

data class CallSignal(
    val callId: String = "",
    val callerPhone: String = "",
    val receiverPhone: String = "",
    val status: String = "IDLE", // RINGING, ACCEPTED, ENDED
    val sdpOffer: String? = null,
    val sdpAnswer: String? = null
)

class KishkaManager(private val context: Context) {

    private val db = FirebaseFirestore.getInstance()
    private val storage = FirebaseStorage.getInstance()

    // 1. Збереження/Оновлення користувача в БД
    fun registerOrUpdateUser(phone: String, name: String, avatarUrl: String = "", onComplete: (() -> Unit)? = null) {
        val userMap = mutableMapOf<String, Any>(
            "uid" to phone,
            "phone" to phone,
            "name" to name,
            "status" to "Online"
        )
        if (avatarUrl.isNotEmpty()) {
            userMap["avatarUrl"] = avatarUrl
        }

        db.collection("users").document(phone)
            .set(userMap, com.google.firebase.firestore.SetOptions.merge())
            .addOnSuccessListener { onComplete?.invoke() }
    }

    // Завантаження аватарки з галереї у Firebase Storage
    fun uploadAvatarImage(phone: String, imageUri: Uri, onSuccess: (String) -> Unit, onFailure: (String) -> Unit) {
        val avatarRef = storage.reference.child("avatars/$phone.jpg")
        avatarRef.putFile(imageUri)
            .addOnSuccessListener {
                avatarRef.downloadUrl.addOnSuccessListener { uri ->
                    val url = uri.toString()
                    registerOrUpdateUser(phone, name = "", avatarUrl = url)
                    onSuccess(url)
                }
            }
            .addOnFailureListener { e ->
                onFailure(e.localizedMessage ?: "Помилка завантаження фото")
            }
    }

    // Слухати дані користувача
    fun listenToUserData(phone: String, onUserLoaded: (User) -> Unit) {
        db.collection("users").document(phone).addSnapshotListener { snapshot, _ ->
            snapshot?.toObject(User::class.java)?.let { onUserLoaded(it) }
        }
    }

    // 2. Список контактів
    fun listenToAllContacts(onContactsUpdated: (List<User>) -> Unit) {
        db.collection("users").addSnapshotListener { snapshot, _ ->
            if (snapshot != null) {
                val users = snapshot.toObjects(User::class.java)
                onContactsUpdated(users)
            }
        }
    }

    // 3. Листування у БД
    fun sendMessage(senderPhone: String, receiverPhone: String, text: String) {
        if (text.isBlank()) return
        val chatId = getChatId(senderPhone, receiverPhone)
        val msgId = UUID.randomUUID().toString()
        val message = Message(
            id = msgId,
            senderPhone = senderPhone,
            receiverPhone = receiverPhone,
            text = text,
            timestamp = System.currentTimeMillis()
        )
        db.collection("chats").document(chatId).collection("messages").document(msgId).set(message)
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

    // 4. Дзвінки в межах Кішка Месенджера
    fun startCall(callerPhone: String, receiverPhone: String) {
        val callSignal = CallSignal(
            callId = UUID.randomUUID().toString(),
            callerPhone = callerPhone,
            receiverPhone = receiverPhone,
            status = "RINGING"
        )
        db.collection("calls").document(receiverPhone).set(callSignal)

        // Фіксація в історії викликів Кішка Месенджера
        addCallLog(
            callerName = callerPhone,
            callerPhone = callerPhone,
            receiverPhone = receiverPhone,
            isMissed = false
        )
    }

    fun endCall(receiverPhone: String) {
        db.collection("calls").document(receiverPhone).delete()
    }

    fun listenForIncomingCalls(myPhone: String) {
        db.collection("calls").document(myPhone).addSnapshotListener { snapshot, _ ->
            val signal = snapshot?.toObject(CallSignal::class.java)
            if (signal != null && signal.status == "RINGING") {
                val intent = Intent(context, CallService::class.java).apply {
                    action = CallService.ACTION_START_CALL
                    putExtra(CallService.EXTRA_TARGET_NAME, signal.callerPhone)
                    putExtra(CallService.EXTRA_TARGET_PHONE, signal.callerPhone)
                }
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            }
        }
    }

    // 5. Історія дзвінків у БД Кішка Месенджера
    private fun addCallLog(callerName: String, callerPhone: String, receiverPhone: String, isMissed: Boolean) {
        val logId = UUID.randomUUID().toString()
        val log = CallLogItem(
            id = logId,
            callerName = callerName,
            callerPhone = callerPhone,
            receiverPhone = receiverPhone,
            timestamp = System.currentTimeMillis(),
            duration = "01:23",
            isMissed = isMissed
        )
        db.collection("users").document(callerPhone).collection("call_logs").document(logId).set(log)
        db.collection("users").document(receiverPhone).collection("call_logs").document(logId).set(log)
    }

    fun listenForCallLogs(myPhone: String, onLogsUpdated: (List<CallLogItem>) -> Unit) {
        db.collection("users").document(myPhone).collection("call_logs")
            .orderBy("timestamp", Query.Direction.DESCENDING)
            .addSnapshotListener { snapshot, _ ->
                if (snapshot != null) {
                    onLogsUpdated(snapshot.toObjects(CallLogItem::class.java))
                }
            }
    }

    private fun getChatId(phone1: String, phone2: String): String {
        return if (phone1 < phone2) "${phone1}_${phone2}" else "${phone2}_${phone1}"
    }
}
