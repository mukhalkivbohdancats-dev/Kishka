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
    val fileName: String? = null, // назва файлу (для fileType = "file")
    val seenAt: Long = 0L,        // коли співрозмовник побачив повідомлення (0 = ще ні)
    val pending: Boolean = false  // ще не підтверджено сервером
)

/** Запис про дзвінок у чаті: сервер надсилає звичайне повідомлення з текстом [[call:статус:секунди]]. */
data class CallRecordInfo(val status: String, val seconds: Long)

private val callRecordRegex = Regex("^\\[\\[call:([a-z]+):(\\d+)\\]\\]$")

fun parseCallRecord(text: String): CallRecordInfo? {
    val m = callRecordRegex.matchEntire(text.trim()) ?: return null
    return CallRecordInfo(m.groupValues[1], m.groupValues[2].toLongOrNull() ?: 0L)
}

/** Повідомлення від ШІ-бота в чаті (відповідь на @gemini / @chatgpt). */
fun isAiBotEmail(email: String): Boolean {
    val e = email.trim().lowercase()
    return e == "gemini@kishka.ai" || e == "chatgpt@kishka.ai"
}

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
    val durationSec: Long = 0L,
    /** ended | missed | declined | cancelled | unavailable (порожньо у старих записів). */
    val status: String = ""
)

data class CallSignal(
    val callId: String = "",
    val callerEmail: String = "",
    val receiverEmail: String = "",
    val status: String = ""
)
