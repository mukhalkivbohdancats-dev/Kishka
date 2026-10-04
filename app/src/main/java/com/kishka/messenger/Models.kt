package com.kishka.messenger

data class User(
    val uid: String = "",
    val phone: String = "",
    val name: String = "Користувач Kishka",
    val status: String = "Online",
    val avatarUrl: String? = null
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

data class CallSignal(
    val callId: String = "",
    val callerPhone: String = "",
    val receiverPhone: String = "",
    val status: String = "RINGING"
)
