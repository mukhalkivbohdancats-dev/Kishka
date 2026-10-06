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
    val fileType: String? = null
)

data class CallLogItem(
    val id: String = "",
    val callerName: String = "",
    val callerEmail: String = "",
    val time: String = "",
    val duration: String = "",
    val isMissed: Boolean = false
)

data class CallSignal(
    val callId: String = "",
    val callerEmail: String = "",
    val receiverEmail: String = "",
    val status: String = ""
)
