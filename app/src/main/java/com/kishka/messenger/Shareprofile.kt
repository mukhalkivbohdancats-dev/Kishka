package com.kishka.messenger

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage

// =====================================================================
// Числовий ID акаунта, посилання на профіль і панель «Поділитися».
//
//   Посилання:  https://kishkablox.github.io/messenger/ID/153663   (SITE нижче; змінюється в одному місці)
//   Сайт за посиланням сам відкриває застосунок:  kishka://user/153663  ->  MainActivity -> DeepLinks.openUserRequest -> UserLinkDialog
//   ID видає сервер по черзі (server.js: ensureUid); пошту за ID ніхто не бачить.
// =====================================================================
object ShareLinks {
    /** Адреса сайту з посиланнями. Для іншої адреси (наприклад https://kishka-messenger.github.io) змініть лише цей рядок. */
    const val SITE = "https://kishkablox.github.io/messenger"

    fun profileUrl(uid: Long): String = "$SITE/ID/$uid"

    /** Розбирає kishka://user/153663 і https://…/ID/153663; інакше null. */
    fun parseUid(uri: Uri?): Long? {
        if (uri == null) return null
        val scheme = uri.scheme?.lowercase()
        if (scheme == "kishka") {
            return if (uri.host.equals("user", ignoreCase = true)) uri.lastPathSegment?.toLongOrNull() else null
        }
        if (scheme == "https" || scheme == "http") {
            val segs = uri.pathSegments
            val i = segs.indexOfFirst { it.equals("ID", ignoreCase = true) }
            if (i >= 0 && i + 1 < segs.size) return segs[i + 1].toLongOrNull()
        }
        return null
    }
}

/** Запит «відкрити користувача за ID» з посилання; його обробляє KishkaApp, коли акаунт увійшов. */
object DeepLinks {
    val openUserRequest = mutableStateOf<Long?>(null)
}

/** Що ділимося: свій профіль, запрошення в Kishka або чужий контакт. */
enum class ShareMode { PROFILE, INVITE, CONTACT }

/** Профіль, відкритий за посиланням (без пошти, якщо цей користувач ще не в контактах). */
data class LinkProfile(
    val uid: Long,
    val name: String,
    val avatarUrl: String?,
    val isContact: Boolean,
    val isMe: Boolean,
    val email: String?
)

object ShareText {
    private val uk = mapOf(
        "title_profile" to "Поділитися профілем",
        "title_invite" to "Запросити друзів",
        "title_contact" to "Поділитися контактом",
        "copy" to "Копіювати посилання",
        "copied" to "Посилання скопійовано",
        "share_via" to "Поділитися…",
        "pick_lang" to "Мова повідомлення",
        "close" to "Закрити",
        "invite_btn" to "Запросити друзів",
        "share_cd" to "Поділитися",
        "id_label" to "ID",
        "link_label" to "Ваше посилання",
        "loading_id" to "ID ще завантажується. Спробуйте за мить",
        "no_id" to "Не вдалося отримати ID. Перевірте інтернет",
        "u_title" to "Користувач Kishka",
        "u_not_found" to "Такого користувача не знайдено",
        "u_error" to "Не вдалося відкрити користувача. Перевірте інтернет",
        "u_you" to "Це ваш профіль",
        "u_add" to "Додати в контакти",
        "u_write" to "Написати",
        "u_ok" to "Гаразд",
        "u_cancel" to "Закрити",
        "u_add_fail" to "Не вдалося додати. Спробуйте ще раз"
    )
    private val ru = mapOf(
        "title_profile" to "Поделиться профилем",
        "title_invite" to "Пригласить друзей",
        "title_contact" to "Поделиться контактом",
        "copy" to "Копировать ссылку",
        "copied" to "Ссылка скопирована",
        "share_via" to "Поделиться…",
        "pick_lang" to "Язык сообщения",
        "close" to "Закрыть",
        "invite_btn" to "Пригласить друзей",
        "share_cd" to "Поделиться",
        "id_label" to "ID",
        "link_label" to "Ваша ссылка",
        "loading_id" to "ID ещё загружается. Попробуйте через мгновение",
        "no_id" to "Не удалось получить ID. Проверьте интернет",
        "u_title" to "Пользователь Kishka",
        "u_not_found" to "Такого пользователя не найдено",
        "u_error" to "Не удалось открыть пользователя. Проверьте интернет",
        "u_you" to "Это ваш профиль",
        "u_add" to "Добавить в контакты",
        "u_write" to "Написать",
        "u_ok" to "Хорошо",
        "u_cancel" to "Закрыть",
        "u_add_fail" to "Не удалось добавить. Попробуйте ещё раз"
    )
    private val en = mapOf(
        "title_profile" to "Share profile",
        "title_invite" to "Invite friends",
        "title_contact" to "Share contact",
        "copy" to "Copy link",
        "copied" to "Link copied",
        "share_via" to "Share…",
        "pick_lang" to "Message language",
        "close" to "Close",
        "invite_btn" to "Invite friends",
        "share_cd" to "Share",
        "id_label" to "ID",
        "link_label" to "Your link",
        "loading_id" to "The ID is still loading. Try again in a moment",
        "no_id" to "Could not get the ID. Check your internet",
        "u_title" to "Kishka user",
        "u_not_found" to "This user was not found",
        "u_error" to "Could not open the user. Check your internet",
        "u_you" to "This is your profile",
        "u_add" to "Add to contacts",
        "u_write" to "Message",
        "u_ok" to "OK",
        "u_cancel" to "Close",
        "u_add_fail" to "Could not add. Please try again"
    )

    fun get(key: String, lang: String): String {
        val table = when (lang) { "uk" -> uk; "ru" -> ru; else -> en }
        return table[key] ?: en[key] ?: key
    }

    /** Текст, який піде у вікно «Поділитися» Android, обраною мовою. */
    fun message(mode: ShareMode, lang: String, name: String, url: String): String = when (lang) {
        "uk" -> when (mode) {
            ShareMode.PROFILE -> "Мій профіль у Kishka Messenger:\n$url"
            ShareMode.INVITE -> "Привіт! Приєднуйся до мене в Kishka Messenger. Просто натисни на посилання:\n$url"
            ShareMode.CONTACT -> "Контакт у Kishka Messenger: $name\n$url"
        }
        "ru" -> when (mode) {
            ShareMode.PROFILE -> "Мой профиль в Kishka Messenger:\n$url"
            ShareMode.INVITE -> "Привет! Присоединяйся ко мне в Kishka Messenger. Просто нажми на ссылку:\n$url"
            ShareMode.CONTACT -> "Контакт в Kishka Messenger: $name\n$url"
        }
        else -> when (mode) {
            ShareMode.PROFILE -> "My profile in Kishka Messenger:\n$url"
            ShareMode.INVITE -> "Hi! Join me in Kishka Messenger. Just tap the link:\n$url"
            ShareMode.CONTACT -> "Contact in Kishka Messenger: $name\n$url"
        }
    }
}

private fun copyToClipboard(context: Context, text: String, lang: String) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
    cm?.setPrimaryClip(ClipData.newPlainText("Kishka", text))
    Toast.makeText(context, ShareText.get("copied", lang), Toast.LENGTH_SHORT).show()
}

private fun shareExternally(context: Context, mode: ShareMode, lang: String, name: String, url: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, ShareText.message(mode, lang, name, url))
    }
    try {
        context.startActivity(Intent.createChooser(send, null))
    } catch (e: Exception) {
        // немає застосунків для поділу — посилання вже можна скопіювати кнопкою
    }
}

/**
 * Панель знизу (НЕ на весь екран): хрестик зверху зліва, посилання з іконкою копіювання, три крапки -> вибір мови -> вікно «Поділитися» Android.
 * Для запрошення друзів відкривається та сама панель, але з текстом-запрошенням (mode = INVITE).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareProfileSheet(
    mode: ShareMode,
    uid: Long,
    name: String,
    avatarUrl: String?,
    lang: String,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val url = ShareLinks.profileUrl(uid)
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var langMenu by remember { mutableStateOf(false) }
    val title = ShareText.get(
        when (mode) { ShareMode.PROFILE -> "title_profile"; ShareMode.INVITE -> "title_invite"; ShareMode.CONTACT -> "title_contact" },
        lang
    )

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Color.White
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 16.dp, end = 16.dp, bottom = 24.dp)
        ) {
            // зверху зліва — хрестик, посередині — назва
            Box(modifier = Modifier.fillMaxWidth().height(48.dp)) {
                IconButton(onClick = onDismiss, modifier = Modifier.align(Alignment.CenterStart)) {
                    Icon(Icons.Default.Close, contentDescription = ShareText.get("close", lang))
                }
                Text(
                    title,
                    modifier = Modifier.align(Alignment.Center),
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            // хто це: аватарка, ім'я, ID
            Row(verticalAlignment = Alignment.CenterVertically) {
                AsyncImage(
                    model = if (avatarUrl.isNullOrEmpty()) DEFAULT_AVATAR_URL else avatarUrl,
                    contentDescription = null,
                    modifier = Modifier.size(56.dp).clip(CircleShape)
                )
                Spacer(modifier = Modifier.width(12.dp))
                Column {
                    Text(name, fontWeight = FontWeight.Bold, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${ShareText.get("id_label", lang)}: $uid", color = Color.Gray, fontSize = 14.sp)
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            // посилання + знак копіювання
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(Color(0xFFF1EEF8))
                    .clickable { copyToClipboard(context, url, lang) }
                    .padding(start = 14.dp, top = 4.dp, bottom = 4.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(url, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 15.sp)
                IconButton(onClick = { copyToClipboard(context, url, lang) }) {
                    Icon(Icons.Default.ContentCopy, contentDescription = ShareText.get("copy", lang), tint = ViberPurple)
                }
            }

            Spacer(modifier = Modifier.height(6.dp))

            // три крапки -> вибір мови, якою буде написано повідомлення -> вікно «Поділитися» Android
            Box {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .clickable { langMenu = true }
                        .padding(horizontal = 4.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = { langMenu = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = ShareText.get("share_via", lang))
                    }
                    Text(ShareText.get("share_via", lang), fontSize = 16.sp)
                }
                DropdownMenu(expanded = langMenu, onDismissRequest = { langMenu = false }) {
                    Text(
                        ShareText.get("pick_lang", lang),
                        color = Color.Gray,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)
                    )
                    listOf("uk" to "Українська", "ru" to "Русский", "en" to "English").forEach { (code, label) ->
                        DropdownMenuItem(
                            text = { Text(label) },
                            onClick = {
                                langMenu = false
                                shareExternally(context, mode, code, name, url)
                            }
                        )
                    }
                }
            }
        }
    }
}

/** Вікно «користувач за посиланням»: ім'я, аватарка, ID й кнопка «Додати в контакти» / «Написати». */
@Composable
fun UserLinkDialog(
    uid: Long,
    manager: KishkaManager,
    myEmail: String,
    lang: String,
    onOpenChat: (User) -> Unit,
    onDismiss: () -> Unit
) {
    var profile by remember(uid) { mutableStateOf<LinkProfile?>(null) }
    var failCode by remember(uid) { mutableStateOf<String?>(null) }
    var busy by remember(uid) { mutableStateOf(false) }

    LaunchedEffect(uid, myEmail) {
        manager.getUserByUid(uid, myEmail) { p, code ->
            if (p != null) profile = p else failCode = code ?: "error"
        }
    }

    val p = profile
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(ShareText.get("u_title", lang), fontWeight = FontWeight.Bold) },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                when {
                    p != null -> {
                        AsyncImage(
                            model = if (p.avatarUrl.isNullOrEmpty()) DEFAULT_AVATAR_URL else p.avatarUrl,
                            contentDescription = null,
                            modifier = Modifier.size(88.dp).clip(CircleShape)
                        )
                        Spacer(modifier = Modifier.height(10.dp))
                        Text(p.name, fontWeight = FontWeight.Bold, fontSize = 20.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text("${ShareText.get("id_label", lang)}: ${p.uid}", color = Color.Gray, fontSize = 14.sp)
                        if (p.isMe) {
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(ShareText.get("u_you", lang), color = Color.Gray)
                        }
                    }
                    failCode != null -> Text(ShareText.get(if (failCode == "not_found") "u_not_found" else "u_error", lang))
                    else -> CircularProgressIndicator()
                }
            }
        },
        confirmButton = {
            if (p != null && !p.isMe) {
                Button(
                    enabled = !busy,
                    onClick = {
                        val known = p.email
                        if (p.isContact && !known.isNullOrEmpty()) {
                            onOpenChat(User(uid = known, email = known, name = p.name, avatarUrl = p.avatarUrl))
                            onDismiss()
                        } else {
                            busy = true
                            manager.addContactByUid(myEmail, p.uid) { user ->
                                busy = false
                                if (user != null) {
                                    onOpenChat(user)
                                    onDismiss()
                                } else {
                                    Toast.makeText(manager.appContext(), ShareText.get("u_add_fail", lang), Toast.LENGTH_LONG).show()
                                }
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = ViberPurple)
                ) {
                    Text(ShareText.get(if (p.isContact) "u_write" else "u_add", lang))
                }
            } else {
                TextButton(onClick = onDismiss) { Text(ShareText.get("u_ok", lang)) }
            }
        },
        dismissButton = {
            if (p != null && !p.isMe) TextButton(onClick = onDismiss) { Text(ShareText.get("u_cancel", lang)) }
        }
    )
}
