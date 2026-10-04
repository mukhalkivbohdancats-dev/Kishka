package com.kishka.messenger

data class User(
    val uid: String = "",
    val email: String = "",
    val name: String = "Користувач Kishka",
    val status: String = "Online",
    val avatarUrl: String? = null
)

data class Message(
    val id: String = "",
    val senderEmail: String = "",
    val receiverEmail: String = "",
    val text: String = "",
    val fileUrl: String? = null,
    val fileType: String? = null,
    val timestamp: Long = System.currentTimeMillis()
)

data class CallSignal(
    val callId: String = "",
    val callerEmail: String = "",
    val receiverEmail: String = "",
    val status: String = "RINGING"
)

data class CallLogItem(
    val id: String = "",
    val callerName: String = "",
    val callerEmail: String = "",
    val time: String = "",
    val duration: String = "",
    val isMissed: Boolean = false
)
