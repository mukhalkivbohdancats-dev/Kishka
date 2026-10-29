package com.kishka.messenger

data class User(
    val uid: String = "",
    val email: String = "",
    val name: String = "",
    val status: String = "Offline",
    val avatarUrl: String? = null
)

data class Message(
    val id: String = "",
    val chatId: String = "",
    val senderEmail: String = "",
    val receiverEmail: String = "",
    val text: String = "",
    val timestamp: Long = System.currentTimeMillis(),
    val fileUrl: String? = null,
    val fileType: String? = null, // "image", "video" або "file"
    val thumbUrl: String? = null, // мініатюра відео
    val fileName: String? = null  // назва файлу (для fileType = "file")
)

/** Запис в історії дзвінків (зберігається на пристрої). direction: "out" або "in". */
data class CallLogItem(
    val id: String = "",
    val callerName: String = "",
    val callerEmail: String = "",
    val time: String = "",
    val duration: String = "",
    val isMissed: Boolean = false,
    val direction: String = "out",
    val startedAt: Long = 0L,
    val durationSec: Long = 0L
)

data class CallSignal(
    val callId: String = "",
    val callerEmail: String = "",
    val receiverEmail: String = "",
    val status: String = ""
)
