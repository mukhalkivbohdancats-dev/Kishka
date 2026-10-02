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
import java.util.UUID
import kotlin.concurrent.thread

class KishkaManager(private val context: Context) {

    private val db = FirebaseFirestore.getInstance()
    private val storage = FirebaseStorage.getInstance()

    fun registerUserInGlobalContacts(phone: String, name: String = "Користувач Kishka") {
        val user = User(uid = phone, phone = phone, name = name, status = "Online")
        db.collection("users").document(phone).set(user)
    }

    fun listenToAllContacts(onContactsUpdated: (List<User>) -> Unit) {
        db.collection("users").addSnapshotListener { snapshot, _ ->
            if (snapshot != null) {
                val users = snapshot.toObjects(User::class.java)
                onContactsUpdated(users)
            }
        }
    }

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

    fun startCall(callerPhone: String, receiverPhone: String) {
        val callSignal = CallSignal(
            callId = UUID.randomUUID().toString(),
            callerPhone = callerPhone,
            receiverPhone = receiverPhone,
            status = "RINGING"
        )
        db.collection("calls").document(receiverPhone).set(callSignal)
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

fun sendTelegramVerificationCode(
    botToken: String,
    chatId: String,
    phone: String,
    code: String,
    onResult: (Boolean) -> Unit
) {
    thread {
        var success = false
        try {
            val message = "🔐 Ваш код верифікації для Kishka Messenger ($phone):\n\n👉 $code\n\nНе передавайте цей код нікому!"
            val apiUrl = "https://api.telegram.org/bot$botToken/sendMessage"

            val url = URL(apiUrl)
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
            conn.connectTimeout = 5000
            conn.readTimeout = 5000
            conn.doOutput = true

            val jsonBody = """
                {
                   "chat_id": "$chatId",
                   "text": "$message"
                }
            """.trimIndent()

            val writer = OutputStreamWriter(conn.outputStream, "UTF-8")
            writer.write(jsonBody)
            writer.flush()
            writer.close()

            if (conn.responseCode == 200) {
                success = true
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        Handler(Looper.getMainLooper()).post {
            onResult(success)
        }
    }
}
