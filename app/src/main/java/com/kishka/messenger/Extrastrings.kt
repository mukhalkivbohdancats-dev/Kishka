package com.kishka.messenger

/**
 * Нові тексти (uk / ru / en): записи про дзвінки в чаті, галочки, видалення контакту, відкриття файлів, @-згадки ШІ.
 */
object XStrings {
    private val dictionary = mapOf(
        "uk" to mapOf(
            "call_out" to "Вихідний виклик",
            "call_in" to "Вхідний виклик",
            "call_cancelled_out" to "Скасований виклик",
            "call_missed" to "Пропущений виклик",
            "call_no_answer" to "Без відповіді",
            "call_declined" to "Відхилений виклик",
            "call_unavailable" to "Абонент не в мережі",
            "call_chat_title" to "Виклик",
            "file_open" to "Відкрити",
            "file_downloading" to "Завантаження",
            "file_failed" to "Не вдалося завантажити файл",
            "file_no_app" to "Немає застосунку, який відкриє цей файл",
            "contact_delete" to "Видалити контакт",
            "contact_delete_title" to "Видалити контакт?",
            "contact_delete_text" to "Ви впевнені, що хочете видалити цей контакт у вас?",
            "yes" to "Так",
            "no" to "Ні",
            "ai_thinking_gemini" to "Gemini відповідає...",
            "ai_thinking_chatgpt" to "ChatGPT відповідає...",
            "mention_providers" to "Запитати ШІ",
            "mention_models" to "Обрати модель",
            "last_seen_unknown" to "давно не був(-ла) в мережі",
            "message_menu_copy" to "Копіювати",
            "message_menu_forward" to "Переслати",
            "message_menu_save" to "Зберегти",
            "message_menu_delete" to "Видалити",
            "message_menu_download" to "Завантажити"
        ),
        "ru" to mapOf(
            "call_out" to "Исходящий вызов",
            "call_in" to "Входящий вызов",
            "call_cancelled_out" to "Отменённый вызов",
            "call_missed" to "Пропущенный вызов",
            "call_no_answer" to "Без ответа",
            "call_declined" to "Отклонённый вызов",
            "call_unavailable" to "Абонент не в сети",
            "call_chat_title" to "Вызов",
            "file_open" to "Открыть",
            "file_downloading" to "Загрузка",
            "file_failed" to "Не удалось загрузить файл",
            "file_no_app" to "Нет приложения, которое откроет этот файл",
            "contact_delete" to "Удалить контакт",
            "contact_delete_title" to "Удалить контакт?",
            "contact_delete_text" to "Вы уверены, что хотите удалить этот контакт у себя?",
            "yes" to "Да",
            "no" to "Нет",
            "ai_thinking_gemini" to "Gemini отвечает...",
            "ai_thinking_chatgpt" to "ChatGPT отвечает...",
            "mention_providers" to "Спросить ИИ",
            "mention_models" to "Выбрать модель",
            "last_seen_unknown" to "давно не был(а) в сети",
            "message_menu_copy" to "Копировать",
            "message_menu_forward" to "Переслать",
            "message_menu_save" to "Сохранить",
            "message_menu_delete" to "Удалить",
            "message_menu_download" to "Скачать"
        ),
        "en" to mapOf(
            "call_out" to "Outgoing call",
            "call_in" to "Incoming call",
            "call_cancelled_out" to "Cancelled call",
            "call_missed" to "Missed call",
            "call_no_answer" to "No answer",
            "call_declined" to "Declined call",
            "call_unavailable" to "Contact is offline",
            "call_chat_title" to "Call",
            "file_open" to "Open",
            "file_downloading" to "Downloading",
            "file_failed" to "Could not download the file",
            "file_no_app" to "No app can open this file",
            "contact_delete" to "Delete contact",
            "contact_delete_title" to "Delete contact?",
            "contact_delete_text" to "Are you sure you want to delete this contact?",
            "yes" to "Yes",
            "no" to "No",
            "ai_thinking_gemini" to "Gemini is answering...",
            "ai_thinking_chatgpt" to "ChatGPT is answering...",
            "mention_providers" to "Ask AI",
            "mention_models" to "Choose a model",
            "last_seen_unknown" to "last seen a long time ago",
            "message_menu_copy" to "Copy",
            "message_menu_forward" to "Forward",
            "message_menu_save" to "Save",
            "message_menu_delete" to "Delete",
            "message_menu_download" to "Download"
        )
    )

    fun get(key: String, lang: String): String =
        dictionary[lang]?.get(key) ?: dictionary["uk"]?.get(key) ?: key
}

/** Підписи для записів про дзвінки ([[call:статус:секунди]]). */
object CallRecordText {
    fun duration(seconds: Long): String {
        val s = seconds.coerceAtLeast(0L)
        val h = s / 3600
        val m = (s % 3600) / 60
        val sec = s % 60
        return if (h > 0) String.format("%d:%02d:%02d", h, m, sec) else String.format("%d:%02d", m, sec)
    }

    /** true, якщо запис треба показати червоним (пропущений, скасований, відхилений). */
    fun isBad(status: String, outgoing: Boolean): Boolean = when (status) {
        "ended" -> false
        "cancelled" -> !outgoing
        "missed", "unavailable" -> !outgoing
        else -> true
    }

    /** outgoing = true, якщо дзвонив я (відправник запису — я). */
    fun label(lang: String, status: String, outgoing: Boolean, seconds: Long): String {
        val key = when (status) {
            "ended" -> if (outgoing) "call_out" else "call_in"
            "cancelled" -> if (outgoing) "call_cancelled_out" else "call_missed"
            "missed" -> if (outgoing) "call_no_answer" else "call_missed"
            "declined" -> "call_declined"
            "unavailable" -> if (outgoing) "call_unavailable" else "call_missed"
            else -> "call_chat_title"
        }
        val base = XStrings.get(key, lang)
        return if (status == "ended" && seconds > 0L) "$base · ${duration(seconds)}" else base
    }
}

data class MentionParse(val provider: String, val model: String, val question: String)

/** Розбір «@gemini питання @модель» та «@chatgpt питання @модель» (регістр букв не важливий). */
object AiMention {
    private val providerRegex = Regex("(^|\\s)@(gemini|chatgpt)(?![A-Za-z0-9._-])", RegexOption.IGNORE_CASE)
    private val tokenRegex = Regex("(^|\\s)@([A-Za-z0-9._-]+)")
    private val trailingRegex = Regex("(^|\\s)@([A-Za-z0-9._-]*)$")

    fun provider(text: String): String? =
        providerRegex.find(text)?.groupValues?.get(2)?.lowercase()

    /** modelIds — id усіх текстових моделей цього провайдера. Повертає null, якщо згадки ШІ в тексті немає. */
    fun parse(text: String, modelIdsByProvider: (String) -> List<String>): MentionParse? {
        val m = providerRegex.find(text) ?: return null
        val provider = m.groupValues[2].lowercase()
        var rest = text.substring(0, m.range.first) + " " + text.substring(m.range.last + 1)

        var model = ""
        val ids = modelIdsByProvider(provider)
        val tokens = tokenRegex.findAll(rest).toList()
        for (t in tokens.reversed()) {
            val token = t.groupValues[2]
            val found = ids.firstOrNull { it.equals(token, ignoreCase = true) }
            if (found != null) {
                model = found
                rest = rest.removeRange(t.range)
                break
            }
        }
        val question = rest.replace(Regex("\\s+"), " ").trim()
        if (question.isEmpty()) return null
        return MentionParse(provider, model, question)
    }

    /** Що зараз вводиться після останнього «@» (для підказок), або null. */
    fun trailingToken(text: String): String? =
        trailingRegex.find(text)?.groupValues?.get(2)

    /** Замінює останній «@частина» на «@вибір ». */
    fun replaceTrailing(text: String, choice: String): String {
        val m = trailingRegex.find(text) ?: return text
        val atIndex = text.indexOf('@', m.range.first)
        return text.substring(0, atIndex) + "@" + choice + " "
    }

    /** Чи є в тексті (крім останнього «@...») згадка провайдера. */
    fun providerBeforeTrailing(text: String): String? {
        val m = trailingRegex.find(text)
        val head = if (m != null) text.substring(0, text.indexOf('@', m.range.first)) else text
        return provider(head)
    }
}
