package com.kishka.messenger

import android.content.Context

/**
 * Переклади (uk / ru / en) для текстів, які показуються НЕ з Compose-екранів:
 * сповіщення, службові повідомлення, помилки, налаштування фонового режиму.
 * Мова береться з налаштувань застосунку (AuthManager.getSavedLanguage).
 */
object AppText {
    private val dictionary = mapOf(
        "uk" to mapOf(
            "call_partner" to "Співрозмовник",
            "call_ongoing" to "Триває розмова: %s",
            "call_unknown" to "Невідомий",
            "call_incoming_title" to "Вхідний виклик Kishka",
            "call_incoming_from" to "Дзвонить: %s",
            "call_accept" to "Прийняти",
            "call_decline" to "Відхилити",
            "call_progress" to "Дзвінок Kishka Messenger (%s)...",
            "call_end" to "Завершити",
            "call_channel" to "Дзвінки Kishka Messenger",
            "call_channel_desc" to "Фонова служба голосових дзвінків",
            "msg_channel" to "Повідомлення Kishka",
            "msg_channel_desc" to "Сповіщення про нові повідомлення",
            "msg_new_from" to "Нове повідомлення від %s",
            "label_video" to "🎬 Відео",
            "label_photo" to "📷 Фото",
            "label_file" to "📎 Файл",
            "bad_email" to "Некоректний формат пошти!",
            "cant_add_self" to "Ви не можете додати самі себе!",
            "error_generic" to "Помилка",
            "server_waking" to "Сервер прокидається. Спробуйте ще раз.",
            "line_busy" to "Лінія зайнята або абонент розмовляє",
            "choose_chat" to "Оберіть чат для початку спілкування",
            "mic_granted" to "Мікрофон дозволено ✓",
            "notif_granted" to "Сповіщення дозволено ✓",
            "profile_updated" to "Оновлено успішно!",
            "save_error" to "Помилка збереження",
            "history_empty" to "Історія порожня",
            "confirm_sent" to "Лист підтвердження надіслано!",
            "login_error" to "Помилка входу",
            "check_credentials" to "Перевірте пошту та пароль (мін. 6 символів)",
            "call_in_progress" to "Дзвінок: %s",
            "tap_to_return" to "Натисніть для повернення",
            "bg_title" to "Працювати у фоні",
            "bg_desc" to "Повідомлення приходитимуть, навіть коли застосунок закрито",
            "bg_notif_title" to "Kishka працює у фоні",
            "bg_notif_text" to "Очікування нових повідомлень",
            "bg_channel" to "Фоновий режим",
            "size_mb" to "МБ",
            "size_kb" to "КБ"
        ),
        "ru" to mapOf(
            "call_partner" to "Собеседник",
            "call_ongoing" to "Идёт разговор: %s",
            "call_unknown" to "Неизвестный",
            "call_incoming_title" to "Входящий вызов Kishka",
            "call_incoming_from" to "Звонит: %s",
            "call_accept" to "Принять",
            "call_decline" to "Отклонить",
            "call_progress" to "Звонок Kishka Messenger (%s)...",
            "call_end" to "Завершить",
            "call_channel" to "Звонки Kishka Messenger",
            "call_channel_desc" to "Фоновая служба голосовых звонков",
            "msg_channel" to "Сообщения Kishka",
            "msg_channel_desc" to "Уведомления о новых сообщениях",
            "msg_new_from" to "Новое сообщение от %s",
            "label_video" to "🎬 Видео",
            "label_photo" to "📷 Фото",
            "label_file" to "📎 Файл",
            "bad_email" to "Некорректный формат почты!",
            "cant_add_self" to "Вы не можете добавить самого себя!",
            "error_generic" to "Ошибка",
            "server_waking" to "Сервер просыпается. Попробуйте ещё раз.",
            "line_busy" to "Линия занята или абонент разговаривает",
            "choose_chat" to "Выберите чат, чтобы начать общение",
            "mic_granted" to "Микрофон разрешён ✓",
            "notif_granted" to "Уведомления разрешены ✓",
            "profile_updated" to "Успешно обновлено!",
            "save_error" to "Ошибка сохранения",
            "history_empty" to "История пуста",
            "confirm_sent" to "Письмо с подтверждением отправлено!",
            "login_error" to "Ошибка входа",
            "check_credentials" to "Проверьте почту и пароль (мин. 6 символов)",
            "call_in_progress" to "Звонок: %s",
            "tap_to_return" to "Нажмите, чтобы вернуться",
            "bg_title" to "Работать в фоне",
            "bg_desc" to "Сообщения будут приходить, даже когда приложение закрыто",
            "bg_notif_title" to "Kishka работает в фоне",
            "bg_notif_text" to "Ожидание новых сообщений",
            "bg_channel" to "Фоновый режим",
            "size_mb" to "МБ",
            "size_kb" to "КБ"
        ),
        "en" to mapOf(
            "call_partner" to "Contact",
            "call_ongoing" to "Ongoing call: %s",
            "call_unknown" to "Unknown",
            "call_incoming_title" to "Incoming Kishka call",
            "call_incoming_from" to "Calling: %s",
            "call_accept" to "Accept",
            "call_decline" to "Decline",
            "call_progress" to "Kishka Messenger call (%s)...",
            "call_end" to "End call",
            "call_channel" to "Kishka Messenger calls",
            "call_channel_desc" to "Background voice call service",
            "msg_channel" to "Kishka messages",
            "msg_channel_desc" to "New message notifications",
            "msg_new_from" to "New message from %s",
            "label_video" to "🎬 Video",
            "label_photo" to "📷 Photo",
            "label_file" to "📎 File",
            "bad_email" to "Invalid email format!",
            "cant_add_self" to "You can't add yourself!",
            "error_generic" to "Error",
            "server_waking" to "The server is waking up. Please try again.",
            "line_busy" to "The line is busy or the person is on another call",
            "choose_chat" to "Select a chat to start messaging",
            "mic_granted" to "Microphone allowed ✓",
            "notif_granted" to "Notifications allowed ✓",
            "profile_updated" to "Updated successfully!",
            "save_error" to "Save error",
            "history_empty" to "History is empty",
            "confirm_sent" to "Verification email sent!",
            "login_error" to "Sign-in error",
            "check_credentials" to "Check your email and password (min. 6 characters)",
            "call_in_progress" to "Call: %s",
            "tap_to_return" to "Tap to return",
            "bg_title" to "Run in background",
            "bg_desc" to "Messages arrive even when the app is closed",
            "bg_notif_title" to "Kishka is running in the background",
            "bg_notif_text" to "Waiting for new messages",
            "bg_channel" to "Background mode",
            "size_mb" to "MB",
            "size_kb" to "KB"
        )
    )

    /** Описи моделей Gemini (id -> uk, ru, en). Якщо моделі тут немає, береться текст із сервера. */
    private val modelNotes = mapOf(
        "gemini-4-argon" to listOf("Найпотужніша модель", "Самая мощная модель", "Most capable model"),
        "gemini-3.8-flash" to listOf("Найрозумніша Flash-модель", "Самая умная Flash-модель", "Smartest Flash model"),
        "gemini-3.6-flash" to listOf("Попереднє покоління Flash", "Предыдущее поколение Flash", "Previous-generation Flash"),
        "gemini-3.5-flash-lite" to listOf("Найшвидша", "Самая быстрая", "Fastest"),
        "gemini-3.1-pro-preview" to listOf("Складні завдання та код", "Сложные задачи и код", "Complex tasks and code"),
        "gemini-3.1-flash-lite" to listOf("Легка та швидка", "Лёгкая и быстрая", "Light and fast"),
        "gemini-3-flash-preview" to listOf("Застаріла Flash", "Устаревшая Flash", "Legacy Flash"),
        "gemini-pro-latest" to listOf("Завжди остання Pro", "Всегда последняя Pro", "Always the latest Pro"),
        "gemini-flash-latest" to listOf("Завжди остання Flash", "Всегда последняя Flash", "Always the latest Flash"),
        "gemini-flash-lite-latest" to listOf("Завжди остання Flash-Lite", "Всегда последняя Flash-Lite", "Always the latest Flash-Lite"),
        "gemini-robotics-er-2-preview" to listOf("Розуміння простору та відео", "Понимание пространства и видео", "Spatial and video understanding"),
        "gemini-robotics-er-2-streaming-preview" to listOf("Швидкий потоковий режим", "Быстрый потоковый режим", "Fast streaming mode"),
        "gemini-nano-banana-2.1" to listOf("Найкраща якість, до 4K", "Лучшее качество, до 4K", "Best quality, up to 4K"),
        "gemini-3.1-flash-lite-image" to listOf("Найшвидша", "Самая быстрая", "Fastest"),
        "gemini-3.1-flash-image" to listOf("Збалансована", "Сбалансированная", "Balanced"),
        "gemini-3-pro-image" to listOf("Професійна", "Профессиональная", "Professional"),
        "gemini-2.5-flash-image" to listOf("Перша версія", "Первая версия", "First version")
    )

    fun get(key: String, lang: String): String {
        return dictionary[lang]?.get(key) ?: dictionary["uk"]?.get(key) ?: key
    }

    /** Текст для сервісів і менеджерів: мова береться з налаштувань застосунку. */
    fun tr(context: Context, key: String): String = get(key, AuthManager.getSavedLanguage(context))

    fun tr(context: Context, key: String, arg: String): String = String.format(tr(context, key), arg)

    fun modelNote(modelId: String, lang: String, fallback: String): String {
        val list = modelNotes[modelId] ?: return fallback
        val index = when (lang) {
            "ru" -> 1
            "en" -> 2
            else -> 0
        }
        return list.getOrElse(index) { fallback }
    }
}
