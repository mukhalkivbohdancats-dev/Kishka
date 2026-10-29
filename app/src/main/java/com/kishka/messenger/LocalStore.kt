package com.kishka.messenger

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray

/** Лічильник змін: Compose-екрани (список чатів) перебудовуються, коли змінилися повідомлення. */
object StoreVersion {
    var value by mutableStateOf(0)
        private set

    fun bump() {
        android.os.Handler(android.os.Looper.getMainLooper()).post { value += 1 }
    }
}

/** Останнє повідомлення чату + кількість непрочитаних (для списку чатів). */
data class ChatPreview(val lastText: String, val lastTime: Long, val unread: Int, val lastFileType: String?)

/**
 * Постійне сховище на пристрої (SQLite): повідомлення, контакти, історія дзвінків.
 * Дані НЕ видаляються при виході з акаунта, перезаході та оновленні застосунку.
 * Повідомлення видаляються лише за сигналом сервера (видалення автором) або кнопкою "Видалити в мене".
 */
class LocalStore private constructor(context: Context) :
    SQLiteOpenHelper(context.applicationContext, "kishka_local.db", null, 1) {

    companion object {
        @Volatile private var instance: LocalStore? = null

        fun get(context: Context): LocalStore =
            instance ?: synchronized(this) {
                instance ?: LocalStore(context.applicationContext).also { instance = it }
            }
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE messages (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, sender TEXT, receiver TEXT, " +
                "text TEXT, ts INTEGER NOT NULL, file_url TEXT, file_type TEXT, thumb_url TEXT, file_name TEXT, " +
                "pending INTEGER NOT NULL DEFAULT 0)"
        )
        db.execSQL("CREATE INDEX idx_messages_chat ON messages (chat_id, ts)")
        db.execSQL("CREATE TABLE hidden (owner TEXT NOT NULL, chat_id TEXT NOT NULL, msg_id TEXT NOT NULL, PRIMARY KEY (owner, msg_id))")
        db.execSQL("CREATE TABLE contacts (owner TEXT NOT NULL, email TEXT NOT NULL, name TEXT, avatar TEXT, PRIMARY KEY (owner, email))")
        db.execSQL(
            "CREATE TABLE calls (id TEXT PRIMARY KEY, owner TEXT NOT NULL, peer_email TEXT NOT NULL, peer_name TEXT, " +
                "direction TEXT NOT NULL, started INTEGER NOT NULL, duration INTEGER NOT NULL, missed INTEGER NOT NULL)"
        )
        db.execSQL("CREATE INDEX idx_calls_owner ON calls (owner, started)")
        db.execSQL("CREATE TABLE read_state (owner TEXT NOT NULL, chat_id TEXT NOT NULL, last_read INTEGER NOT NULL, PRIMARY KEY (owner, chat_id))")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Майбутні версії: додавати міграції тут, а не видаляти таблиці
    }

    // ===================== ПОВІДОМЛЕННЯ =====================

    private fun toValues(m: Message, pending: Boolean): ContentValues = ContentValues().apply {
        put("id", m.id)
        put("chat_id", m.chatId)
        put("sender", m.senderEmail)
        put("receiver", m.receiverEmail)
        put("text", m.text)
        put("ts", m.timestamp)
        put("file_url", m.fileUrl)
        put("file_type", m.fileType)
        put("thumb_url", m.thumbUrl)
        put("file_name", m.fileName)
        put("pending", if (pending) 1 else 0)
    }

    /** Додає повідомлення, яких ще немає. Повертає лише НОВІ (за ними показуємо сповіщення). */
    @Synchronized
    fun insertMessages(list: List<Message>, pending: Boolean = false): List<Message> {
        if (list.isEmpty()) return emptyList()
        val added = mutableListOf<Message>()
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (m in list) {
                if (m.id.isEmpty()) continue
                val rowId = db.insertWithOnConflict("messages", null, toValues(m, pending), SQLiteDatabase.CONFLICT_IGNORE)
                if (rowId != -1L) added.add(m)
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        if (added.isNotEmpty()) StoreVersion.bump()
        return added
    }

    /** Сервер підтвердив отримання власного повідомлення. */
    @Synchronized
    fun markDelivered(id: String) {
        val values = ContentValues().apply { put("pending", 0) }
        writableDatabase.update("messages", values, "id = ?", arrayOf(id))
    }

    @Synchronized
    fun pendingMessages(owner: String): List<Message> {
        val list = mutableListOf<Message>()
        readableDatabase.query(
            "messages", null, "pending = 1 AND sender = ?", arrayOf(owner), null, null, "ts ASC"
        ).use { c -> while (c.moveToNext()) list.add(readMessage(c)) }
        return list
    }

    private fun readMessage(c: android.database.Cursor): Message {
        fun str(name: String): String? {
            val i = c.getColumnIndexOrThrow(name)
            return if (c.isNull(i)) null else c.getString(i)
        }
        return Message(
            id = str("id") ?: "",
            chatId = str("chat_id") ?: "",
            senderEmail = str("sender") ?: "",
            receiverEmail = str("receiver") ?: "",
            text = str("text") ?: "",
            timestamp = c.getLong(c.getColumnIndexOrThrow("ts")),
            fileUrl = str("file_url"),
            fileType = str("file_type"),
            thumbUrl = str("thumb_url"),
            fileName = str("file_name")
        )
    }

    /** Повідомлення чату, крім прихованих кнопкою "Видалити в мене" цим користувачем. */
    @Synchronized
    fun getMessages(owner: String, chatId: String): List<Message> {
        val list = mutableListOf<Message>()
        readableDatabase.rawQuery(
            "SELECT * FROM messages WHERE chat_id = ? AND id NOT IN (SELECT msg_id FROM hidden WHERE owner = ?) ORDER BY ts ASC",
            arrayOf(chatId, owner)
        ).use { c -> while (c.moveToNext()) list.add(readMessage(c)) }
        return list
    }

    @Synchronized
    fun deleteMessage(id: String) {
        val n = writableDatabase.delete("messages", "id = ?", arrayOf(id))
        if (n > 0) StoreVersion.bump()
    }

    @Synchronized
    fun hideMessage(owner: String, chatId: String, id: String) {
        val values = ContentValues().apply {
            put("owner", owner)
            put("chat_id", chatId)
            put("msg_id", id)
        }
        writableDatabase.insertWithOnConflict("hidden", null, values, SQLiteDatabase.CONFLICT_IGNORE)
        StoreVersion.bump()
    }

    @Synchronized
    fun markRead(owner: String, chatId: String) {
        val values = ContentValues().apply {
            put("owner", owner)
            put("chat_id", chatId)
            put("last_read", System.currentTimeMillis())
        }
        writableDatabase.insertWithOnConflict("read_state", null, values, SQLiteDatabase.CONFLICT_REPLACE)
        StoreVersion.bump()
    }

    /** Останнє повідомлення та кількість непрочитаних для чату. */
    @Synchronized
    fun chatPreview(owner: String, chatId: String): ChatPreview? {
        val db = readableDatabase
        var lastText = ""
        var lastTime = 0L
        var lastType: String? = null
        var found = false
        db.rawQuery(
            "SELECT text, ts, file_type FROM messages WHERE chat_id = ? AND id NOT IN (SELECT msg_id FROM hidden WHERE owner = ?) ORDER BY ts DESC LIMIT 1",
            arrayOf(chatId, owner)
        ).use { c ->
            if (c.moveToFirst()) {
                found = true
                lastText = c.getString(0) ?: ""
                lastTime = c.getLong(1)
                lastType = if (c.isNull(2)) null else c.getString(2)
            }
        }
        if (!found) return null
        var lastRead = 0L
        db.rawQuery("SELECT last_read FROM read_state WHERE owner = ? AND chat_id = ?", arrayOf(owner, chatId)).use { c ->
            if (c.moveToFirst()) lastRead = c.getLong(0)
        }
        var unread = 0
        db.rawQuery(
            "SELECT COUNT(*) FROM messages WHERE chat_id = ? AND sender != ? AND ts > ? AND id NOT IN (SELECT msg_id FROM hidden WHERE owner = ?)",
            arrayOf(chatId, owner, lastRead.toString(), owner)
        ).use { c -> if (c.moveToFirst()) unread = c.getInt(0) }
        return ChatPreview(lastText, lastTime, unread, lastType)
    }

    // ===================== КОНТАКТИ =====================

    @Synchronized
    fun getContacts(owner: String): List<User> {
        val list = mutableListOf<User>()
        readableDatabase.query("contacts", null, "owner = ?", arrayOf(owner), null, null, "name COLLATE NOCASE ASC").use { c ->
            while (c.moveToNext()) {
                val email = c.getString(c.getColumnIndexOrThrow("email")) ?: continue
                val nameIdx = c.getColumnIndexOrThrow("name")
                val avatarIdx = c.getColumnIndexOrThrow("avatar")
                list.add(
                    User(
                        uid = email,
                        email = email,
                        name = if (c.isNull(nameIdx)) "" else c.getString(nameIdx),
                        avatarUrl = if (c.isNull(avatarIdx)) null else c.getString(avatarIdx)
                    )
                )
            }
        }
        return list
    }

    /** Додає/оновлює контакти. Контакти НІКОЛИ не видаляються (навіть якщо сервер відповів порожнім списком). */
    @Synchronized
    fun upsertContacts(owner: String, list: List<User>) {
        if (list.isEmpty()) return
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (u in list) {
                if (u.email.isEmpty()) continue
                val values = ContentValues().apply {
                    put("owner", owner)
                    put("email", u.email.trim().lowercase())
                    put("name", u.name)
                    put("avatar", u.avatarUrl)
                }
                db.insertWithOnConflict("contacts", null, values, SQLiteDatabase.CONFLICT_REPLACE)
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        StoreVersion.bump()
    }

    @Synchronized
    fun contactName(owner: String, email: String): String? {
        readableDatabase.query(
            "contacts", arrayOf("name"), "owner = ? AND email = ?", arrayOf(owner, email.trim().lowercase()), null, null, null
        ).use { c ->
            if (c.moveToFirst() && !c.isNull(0)) {
                val n = c.getString(0)
                if (!n.isNullOrBlank()) return n
            }
        }
        return null
    }

    // ===================== ІСТОРІЯ ДЗВІНКІВ =====================

    @Synchronized
    fun insertCall(owner: String, peerEmail: String, peerName: String, direction: String, started: Long, durationSec: Long, missed: Boolean) {
        val values = ContentValues().apply {
            put("id", "call_${started}_${(Math.random() * 1_000_000).toInt()}")
            put("owner", owner)
            put("peer_email", peerEmail.trim().lowercase())
            put("peer_name", peerName)
            put("direction", direction)
            put("started", started)
            put("duration", durationSec)
            put("missed", if (missed) 1 else 0)
        }
        writableDatabase.insertWithOnConflict("calls", null, values, SQLiteDatabase.CONFLICT_IGNORE)
        StoreVersion.bump()
    }

    @Synchronized
    fun getCalls(owner: String, limit: Int = 300): List<CallLogItem> {
        val list = mutableListOf<CallLogItem>()
        readableDatabase.query("calls", null, "owner = ?", arrayOf(owner), null, null, "started DESC", limit.toString()).use { c ->
            while (c.moveToNext()) {
                val email = c.getString(c.getColumnIndexOrThrow("peer_email")) ?: continue
                val storedName = c.getString(c.getColumnIndexOrThrow("peer_name")) ?: ""
                val started = c.getLong(c.getColumnIndexOrThrow("started"))
                val dur = c.getLong(c.getColumnIndexOrThrow("duration"))
                list.add(
                    CallLogItem(
                        id = c.getString(c.getColumnIndexOrThrow("id")) ?: "",
                        callerName = contactName(owner, email) ?: storedName.ifEmpty { email },
                        callerEmail = email,
                        time = "",
                        duration = "",
                        isMissed = c.getInt(c.getColumnIndexOrThrow("missed")) == 1,
                        direction = c.getString(c.getColumnIndexOrThrow("direction")) ?: "out",
                        startedAt = started,
                        durationSec = dur
                    )
                )
            }
        }
        return list
    }

    @Synchronized
    fun clearCalls(owner: String) {
        writableDatabase.delete("calls", "owner = ?", arrayOf(owner))
        StoreVersion.bump()
    }

    // ===================== ПЕРЕНЕСЕННЯ СТАРОГО КЕШУ (SharedPreferences -> SQLite) =====================

    /** Один раз переносить повідомлення і контакти зі старої версії застосунку, щоб вони не зникли після оновлення. */
    @Synchronized
    fun migrateOldCache(context: Context): Boolean {
        val prefs = context.getSharedPreferences("kishka_cache_prefs", Context.MODE_PRIVATE)
        if (prefs.getBoolean("migrated_to_sqlite_v3", false)) return false
        try {
            for ((key, value) in prefs.all) {
                val raw = value as? String ?: continue
                when {
                    key.startsWith("cached_messages_") -> {
                        val chatId = key.removePrefix("cached_messages_")
                        val arr = JSONArray(raw)
                        val msgs = mutableListOf<Message>()
                        for (i in 0 until arr.length()) {
                            val o = arr.getJSONObject(i)
                            fun opt(n: String): String? = if (o.isNull(n)) null else o.optString(n, "").ifEmpty { null }
                            msgs.add(
                                Message(
                                    id = o.optString("id", ""),
                                    chatId = o.optString("chatId", chatId),
                                    senderEmail = o.optString("senderEmail", ""),
                                    receiverEmail = o.optString("receiverEmail", ""),
                                    text = o.optString("text", ""),
                                    timestamp = o.optLong("timestamp", System.currentTimeMillis()),
                                    fileUrl = opt("fileUrl"),
                                    fileType = opt("fileType"),
                                    thumbUrl = opt("thumbUrl"),
                                    fileName = opt("fileName")
                                )
                            )
                        }
                        insertMessages(msgs)
                    }
                    key.startsWith("cached_contacts_") -> {
                        val owner = key.removePrefix("cached_contacts_")
                        val arr = JSONArray(raw)
                        val users = mutableListOf<User>()
                        for (i in 0 until arr.length()) {
                            val o = arr.getJSONObject(i)
                            users.add(User(uid = o.optString("email"), email = o.optString("email"), name = o.optString("name"), avatarUrl = o.optString("avatarUrl", "").ifEmpty { null }))
                        }
                        upsertContacts(owner, users)
                    }
                }
            }
            prefs.edit().putBoolean("migrated_to_sqlite_v3", true).apply()
            return true
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return false
    }

    /** Усі чати, які вже є на пристрої, вважаються прочитаними (викликається один раз після перенесення старого кешу). */
    @Synchronized
    fun markAllChatsRead(owner: String) {
        writableDatabase.execSQL(
            "INSERT OR IGNORE INTO read_state (owner, chat_id, last_read) SELECT DISTINCT ?, chat_id, ? FROM messages",
            arrayOf<Any>(owner, System.currentTimeMillis())
        )
        StoreVersion.bump()
    }
}
