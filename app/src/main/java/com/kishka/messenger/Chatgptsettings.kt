package com.kishka.messenger

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.json.JSONObject

const val CHATGPT_LOGO_URL =
    "https://raw.githubusercontent.com/mukhalkivbohdancats-dev/Kishka/main/Assets/ChatGPT_logo.png"

/**
 * Моделі ChatGPT, які показуються, поки сервер не віддав живий список (GET /v1/models вашого ключа OpenAI).
 * Коли сервер відповів, список замінюється актуальним — там завжди ті самі моделі, що й на platform.openai.com.
 */
fun chatgptDefaultModels(): List<GeminiModel> = listOf(
    GeminiModel("gpt-6.1-sol", "GPT-6.1 Sol", "text", false, "Майже як Astra, дешевше"),
    GeminiModel("gpt-6-astra", "GPT-6 Astra", "text", false, "Найпотужніша модель"),
    GeminiModel("gpt-6-sol", "GPT-6 Sol", "text", false, "Складний код і агентні процеси"),
    GeminiModel("gpt-6-luna", "GPT-6 Luna", "text", false, "Найефективніша модель"),
    GeminiModel("gpt-5.6-sol", "GPT-5.6 Sol", "text", false, ""),
    GeminiModel("gpt-5.5", "GPT-5.5", "text", false, "Професійна робота"),
    GeminiModel("gpt-5.5-pro", "GPT-5.5 Pro", "text", false, ""),
    GeminiModel("gpt-5.4", "GPT-5.4", "text", false, "Агенти та професійна робота"),
    GeminiModel("gpt-5.4-pro", "GPT-5.4 Pro", "text", false, ""),
    GeminiModel("gpt-5.3-codex", "GPT-5.3 Codex", "text", false, "Код"),
    GeminiModel("gpt-5.2-pro", "GPT-5.2 Pro", "text", false, ""),
    GeminiModel("gpt-5", "GPT-5", "text", false, ""),
    GeminiModel("gpt-5-mini", "GPT-5 mini", "text", false, "Менша й швидша"),
    GeminiModel("gpt-5-nano", "GPT-5 nano", "text", false, "Найшвидша й найекономніша"),
    GeminiModel("o3-2025-04-16", "o3 (2025-04-16)", "text", false, ""),
    GeminiModel("gpt-4o", "GPT-4o", "text", false, ""),
    GeminiModel("gpt-4o-mini", "GPT-4o mini", "text", false, ""),
    GeminiModel("gpt-4o-search-preview", "GPT-4o Search Preview", "text", false, "Відповіді з інтернету"),
    GeminiModel("gpt-4o-mini-search-preview", "GPT-4o mini Search Preview", "text", false, ""),
    GeminiModel("gpt-3.5-turbo-16k", "GPT-3.5 Turbo 16k", "text", false, ""),
    GeminiModel("gpt-image-1", "GPT Image 1", "image", false, "Створення зображень"),
    GeminiModel("tts-1", "TTS 1", "audio", false, "Озвучка тексту"),
    GeminiModel("tts-1-hd", "TTS 1 HD", "audio", false, "Озвучка вищої якості")
)

/** Тексти вкладки ChatGPT: перекривають gemini_* ключі та додають підписи налаштувань. */
object ChatgptStrings {
    private val dictionary = mapOf(
        "uk" to mapOf(
            "gemini_thinking_label" to "ChatGPT думає",
            "gemini_generating_label" to "ChatGPT створює зображення",
            "gemini_audio_label" to "ChatGPT створює озвучку",
            "gemini_note_wait" to "Ліміт OpenAI: чекаю %d с і повторюю запит",
            "gemini_note_busy" to "Сервер OpenAI зайнятий: повтор через %d с",
            "gemini_note_switch" to "Модель: %s",
            "gemini_note_thinking" to "ChatGPT міркує над відповіддю. Часу не обмежено, можна чекати скільки потрібно",
            "gemini_error" to "ChatGPT зараз недоступний. Спробуйте пізніше.",
            "gemini_empty" to "Привіт! Я ChatGPT. Запитайте що завгодно — я памʼятаю нашу розмову. Натисніть на назву моделі, щоб обрати модель і змінити всі налаштування.",
            "gemini_clear_confirm" to "Видалити всю історію та памʼять розмови з ChatGPT?",
            "cg_model" to "Модель",
            "cg_settings" to "Налаштування",
            "cg_text_models" to "Текстові моделі",
            "cg_image_models" to "Зображення",
            "cg_audio_models" to "Озвучка",
            "cg_service_tier" to "Рівень сервісу",
            "cg_websocket" to "Режим WebSocket",
            "cg_text_format" to "Формат тексту",
            "cg_reasoning_mode" to "Режим міркування",
            "cg_effort" to "Зусилля міркування",
            "cg_verbosity" to "Докладність",
            "cg_summary" to "Підсумок міркування",
            "cg_store" to "Зберігати логи",
            "cg_hosted_tools" to "Вбудовані інструменти",
            "cg_local_tools" to "Локальні інструменти",
            "cg_tool_mcp" to "MCP-сервер",
            "cg_tool_file_search" to "Пошук файлів",
            "cg_tool_web_search" to "Пошук в інтернеті",
            "cg_tool_image" to "Створення зображень",
            "cg_tool_tool_search" to "Пошук інструментів",
            "cg_tool_code" to "Інтерпретатор коду",
            "cg_tool_hosted_shell" to "Хостована оболонка",
            "cg_tool_function" to "Функція",
            "cg_tool_custom" to "Власний інструмент",
            "cg_tool_apply_patch" to "Застосування патча",
            "cg_tool_local_shell" to "Локальна оболонка",
            "cg_unavailable" to "Потребує окремого середовища, у месенджері недоступно",
            "cg_ws_note" to "Зберігається в налаштуваннях; запити йдуть потоком",
            "cg_done" to "Готово",
            "cg_tier_default" to "Стандарт",
            "cg_tier_auto" to "Авто",
            "cg_tier_flex" to "Flex",
            "cg_tier_priority" to "Пріоритет",
            "cg_standard" to "стандартний",
            "cg_pro" to "pro"
        ),
        "ru" to mapOf(
            "gemini_thinking_label" to "ChatGPT думает",
            "gemini_generating_label" to "ChatGPT создаёт изображение",
            "gemini_audio_label" to "ChatGPT создаёт озвучку",
            "gemini_note_wait" to "Лимит OpenAI: жду %d с и повторяю запрос",
            "gemini_note_busy" to "Сервер OpenAI занят: повтор через %d с",
            "gemini_note_switch" to "Модель: %s",
            "gemini_note_thinking" to "ChatGPT размышляет над ответом. Времени не ограничено, можно ждать сколько нужно",
            "gemini_error" to "ChatGPT сейчас недоступен. Попробуйте позже.",
            "gemini_empty" to "Привет! Я ChatGPT. Спросите что угодно — я помню наш разговор. Нажмите на название модели, чтобы выбрать модель и изменить все настройки.",
            "gemini_clear_confirm" to "Удалить всю историю и память разговора с ChatGPT?",
            "cg_model" to "Модель",
            "cg_settings" to "Настройки",
            "cg_text_models" to "Текстовые модели",
            "cg_image_models" to "Изображения",
            "cg_audio_models" to "Озвучка",
            "cg_service_tier" to "Уровень сервиса",
            "cg_websocket" to "Режим WebSocket",
            "cg_text_format" to "Формат текста",
            "cg_reasoning_mode" to "Режим рассуждения",
            "cg_effort" to "Усилие рассуждения",
            "cg_verbosity" to "Подробность",
            "cg_summary" to "Сводка рассуждения",
            "cg_store" to "Сохранять логи",
            "cg_hosted_tools" to "Встроенные инструменты",
            "cg_local_tools" to "Локальные инструменты",
            "cg_tool_mcp" to "MCP-сервер",
            "cg_tool_file_search" to "Поиск файлов",
            "cg_tool_web_search" to "Поиск в интернете",
            "cg_tool_image" to "Создание изображений",
            "cg_tool_tool_search" to "Поиск инструментов",
            "cg_tool_code" to "Интерпретатор кода",
            "cg_tool_hosted_shell" to "Хостируемая оболочка",
            "cg_tool_function" to "Функция",
            "cg_tool_custom" to "Свой инструмент",
            "cg_tool_apply_patch" to "Применение патча",
            "cg_tool_local_shell" to "Локальная оболочка",
            "cg_unavailable" to "Требует отдельной среды, в мессенджере недоступно",
            "cg_ws_note" to "Сохраняется в настройках; запросы идут потоком",
            "cg_done" to "Готово",
            "cg_tier_default" to "Стандарт",
            "cg_tier_auto" to "Авто",
            "cg_tier_flex" to "Flex",
            "cg_tier_priority" to "Приоритет",
            "cg_standard" to "стандартный",
            "cg_pro" to "pro"
        ),
        "en" to mapOf(
            "gemini_thinking_label" to "ChatGPT is thinking",
            "gemini_generating_label" to "ChatGPT is creating an image",
            "gemini_audio_label" to "ChatGPT is creating speech",
            "gemini_note_wait" to "OpenAI limit: waiting %d s, then retrying",
            "gemini_note_busy" to "OpenAI server is busy: retrying in %d s",
            "gemini_note_switch" to "Model: %s",
            "gemini_note_thinking" to "ChatGPT is reasoning about the answer. There is no time limit, so you can wait as long as needed",
            "gemini_error" to "ChatGPT is unavailable right now. Please try again later.",
            "gemini_empty" to "Hi! I'm ChatGPT. Ask me anything — I remember our conversation. Tap the model name to choose a model and change all settings.",
            "gemini_clear_confirm" to "Delete the whole history and memory of your conversation with ChatGPT?",
            "cg_model" to "Model",
            "cg_settings" to "Settings",
            "cg_text_models" to "Text models",
            "cg_image_models" to "Images",
            "cg_audio_models" to "Speech",
            "cg_service_tier" to "Service tier",
            "cg_websocket" to "WebSocket mode",
            "cg_text_format" to "Text format",
            "cg_reasoning_mode" to "Reasoning mode",
            "cg_effort" to "Reasoning effort",
            "cg_verbosity" to "Verbosity",
            "cg_summary" to "Summary",
            "cg_store" to "Store logs",
            "cg_hosted_tools" to "Hosted tools",
            "cg_local_tools" to "Local tools",
            "cg_tool_mcp" to "MCP server",
            "cg_tool_file_search" to "File search",
            "cg_tool_web_search" to "Web search",
            "cg_tool_image" to "Image generation",
            "cg_tool_tool_search" to "Tool search",
            "cg_tool_code" to "Code interpreter",
            "cg_tool_hosted_shell" to "Hosted shell",
            "cg_tool_function" to "Function",
            "cg_tool_custom" to "Custom tool",
            "cg_tool_apply_patch" to "Apply patch",
            "cg_tool_local_shell" to "Local shell",
            "cg_unavailable" to "Needs a separate environment, not available in the messenger",
            "cg_ws_note" to "Saved in settings; requests are streamed",
            "cg_done" to "Done",
            "cg_tier_default" to "Standard",
            "cg_tier_auto" to "Auto",
            "cg_tier_flex" to "Flex",
            "cg_tier_priority" to "Priority",
            "cg_standard" to "standard",
            "cg_pro" to "pro"
        )
    )

    /** Текст саме для ChatGPT або null, якщо для цього ключа окремого тексту немає. */
    fun find(key: String, lang: String): String? =
        dictionary[lang]?.get(key) ?: dictionary["uk"]?.get(key)

    fun get(key: String, lang: String): String = find(key, lang) ?: key
}

// ======================== Налаштування ChatGPT (зберігаються на пристрої) ========================

class PrefString(private val prefs: SharedPreferences, private val key: String, default: String) {
    var value by mutableStateOf(prefs.getString(key, default) ?: default)
        private set

    fun set(newValue: String) {
        value = newValue
        prefs.edit().putString(key, newValue).apply()
    }
}

class PrefBool(private val prefs: SharedPreferences, private val key: String, default: Boolean) {
    var value by mutableStateOf(prefs.getBoolean(key, default))
        private set

    fun set(newValue: Boolean) {
        value = newValue
        prefs.edit().putBoolean(key, newValue).apply()
    }
}

class ChatgptSettingsState(context: Context) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("kishka_chatgpt_settings", Context.MODE_PRIVATE)

    val serviceTier = PrefString(prefs, "service_tier", "default")
    val websocket = PrefBool(prefs, "websocket", true)
    val textFormat = PrefString(prefs, "text_format", "text")
    val reasoningMode = PrefString(prefs, "reasoning_mode", "standard")
    val effort = PrefString(prefs, "effort", "medium")
    val verbosity = PrefString(prefs, "verbosity", "medium")
    val summary = PrefString(prefs, "summary", "auto")
    val store = PrefBool(prefs, "store", true)
    val toolWebSearch = PrefBool(prefs, "tool_web_search", false)
    val toolImage = PrefBool(prefs, "tool_image_generation", false)
    val toolCode = PrefBool(prefs, "tool_code_interpreter", false)

    fun toJson(): JSONObject = JSONObject().apply {
        put("serviceTier", serviceTier.value)
        put("websocket", websocket.value)
        put("textFormat", textFormat.value)
        put("reasoningMode", reasoningMode.value)
        put("effort", effort.value)
        put("verbosity", verbosity.value)
        put("summary", summary.value)
        put("store", store.value)
        put("tools", JSONObject().apply {
            put("web_search", toolWebSearch.value)
            put("image_generation", toolImage.value)
            put("code_interpreter", toolCode.value)
        })
    }
}

object ChatgptSettings {
    @Volatile private var state: ChatgptSettingsState? = null

    fun get(context: Context): ChatgptSettingsState =
        state ?: synchronized(this) {
            state ?: ChatgptSettingsState(context.applicationContext).also { state = it }
        }

    fun json(context: Context): JSONObject = get(context).toJson()
}

// ======================== Овальна кнопка моделі + вікно «модель і всі налаштування» ========================

@Composable
fun ChatgptModelPill(
    selected: GeminiModel,
    models: List<GeminiModel>,
    enabled: Boolean,
    lang: String,
    onSelect: (GeminiModel) -> Unit
) {
    var open by remember { mutableStateOf(false) }

    Surface(
        shape = RoundedCornerShape(50),
        color = if (enabled) ViberLightPurple else Color(0xFFF1F1F4),
        border = BorderStroke(1.dp, ViberPurple.copy(alpha = if (enabled) 0.35f else 0.12f)),
        modifier = Modifier.height(40.dp)
    ) {
        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(50))
                .clickable(enabled = enabled) { open = true }
                .padding(start = 14.dp, end = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                selected.label,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (enabled) ViberPurple else Color.Gray,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 110.dp)
            )
            Icon(
                Icons.Default.ArrowDropDown,
                contentDescription = ChatgptStrings.get("cg_model", lang),
                tint = if (enabled) ViberPurple else Color.Gray,
                modifier = Modifier.size(22.dp)
            )
        }
    }

    if (open) {
        ChatgptModelDialog(
            selected = selected,
            models = models,
            lang = lang,
            onSelect = { onSelect(it) },
            onDismiss = { open = false }
        )
    }
}

@Composable
private fun ChatgptModelDialog(
    selected: GeminiModel,
    models: List<GeminiModel>,
    lang: String,
    onSelect: (GeminiModel) -> Unit,
    onDismiss: () -> Unit
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val st = remember { ChatgptSettings.get(context) }
    val t: (String) -> String = { key -> ChatgptStrings.get(key, lang) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            shape = RoundedCornerShape(24.dp),
            color = Color.White,
            modifier = Modifier
                .fillMaxWidth(0.94f)
                .widthIn(max = 560.dp)
                .heightIn(max = 680.dp)
        ) {
            Column(
                modifier = Modifier
                    .verticalScroll(rememberScrollState())
                    .padding(18.dp)
            ) {
                // ---------- Модель ----------
                CgHeader(t("cg_model"))
                val groups = listOf(
                    "cg_text_models" to models.filter { !it.isImage && !it.isAudio },
                    "cg_image_models" to models.filter { it.isImage },
                    "cg_audio_models" to models.filter { it.isAudio }
                ).filter { it.second.isNotEmpty() }
                groups.forEach { (titleKey, list) ->
                    Text(
                        t(titleKey),
                        fontSize = 12.sp,
                        color = Color.Gray,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(top = 8.dp, bottom = 2.dp)
                    )
                    list.forEach { m ->
                        CgModelRow(m, m.id == selected.id) { onSelect(m) }
                    }
                }

                Spacer(modifier = Modifier.height(14.dp))
                Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(ViberLightPurple))
                Spacer(modifier = Modifier.height(10.dp))

                // ---------- Налаштування (як у platform.openai.com -> Chat) ----------
                CgHeader(t("cg_settings"))

                CgSelect(
                    t("cg_service_tier"), st.serviceTier.value,
                    listOf("default" to t("cg_tier_default"), "auto" to t("cg_tier_auto"), "flex" to t("cg_tier_flex"), "priority" to t("cg_tier_priority"))
                ) { st.serviceTier.set(it) }

                CgSwitch(t("cg_websocket"), st.websocket.value, note = t("cg_ws_note")) { st.websocket.set(it) }

                CgSelect(
                    t("cg_text_format"), st.textFormat.value,
                    listOf("text" to "text", "json_object" to "json_object")
                ) { st.textFormat.set(it) }

                CgSelect(
                    t("cg_reasoning_mode"), st.reasoningMode.value,
                    listOf("standard" to t("cg_standard"), "pro" to t("cg_pro"))
                ) { st.reasoningMode.set(it) }

                CgSelect(
                    t("cg_effort"), st.effort.value,
                    listOf("none" to "none", "minimal" to "minimal", "low" to "low", "medium" to "medium", "high" to "high", "xhigh" to "xhigh")
                ) { st.effort.set(it) }

                CgSelect(
                    t("cg_verbosity"), st.verbosity.value,
                    listOf("low" to "low", "medium" to "medium", "high" to "high")
                ) { st.verbosity.set(it) }

                CgSelect(
                    t("cg_summary"), st.summary.value,
                    listOf("auto" to "auto", "concise" to "concise", "detailed" to "detailed", "none" to "none")
                ) { st.summary.set(it) }

                CgSwitch(t("cg_store"), st.store.value) { st.store.set(it) }

                Spacer(modifier = Modifier.height(10.dp))
                CgHeader(t("cg_hosted_tools"))
                CgSwitch(t("cg_tool_mcp"), false, enabled = false, note = t("cg_unavailable")) { }
                CgSwitch(t("cg_tool_file_search"), false, enabled = false, note = t("cg_unavailable")) { }
                CgSwitch(t("cg_tool_web_search"), st.toolWebSearch.value) { st.toolWebSearch.set(it) }
                CgSwitch(t("cg_tool_image"), st.toolImage.value) { st.toolImage.set(it) }
                CgSwitch(t("cg_tool_tool_search"), false, enabled = false, note = t("cg_unavailable")) { }
                CgSwitch(t("cg_tool_code"), st.toolCode.value) { st.toolCode.set(it) }
                CgSwitch(t("cg_tool_hosted_shell"), false, enabled = false, note = t("cg_unavailable")) { }

                Spacer(modifier = Modifier.height(10.dp))
                CgHeader(t("cg_local_tools"))
                CgSwitch(t("cg_tool_function"), false, enabled = false, note = t("cg_unavailable")) { }
                CgSwitch(t("cg_tool_custom"), false, enabled = false, note = t("cg_unavailable")) { }
                CgSwitch(t("cg_tool_apply_patch"), false, enabled = false, note = t("cg_unavailable")) { }
                CgSwitch(t("cg_tool_local_shell"), false, enabled = false, note = t("cg_unavailable")) { }

                Spacer(modifier = Modifier.height(16.dp))
                Button(
                    onClick = onDismiss,
                    modifier = Modifier.fillMaxWidth().height(46.dp),
                    shape = RoundedCornerShape(14.dp)
                ) {
                    Text(t("cg_done"), fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
private fun CgHeader(text: String) {
    Text(
        text,
        fontSize = 16.sp,
        fontWeight = FontWeight.Bold,
        color = ViberPurple,
        modifier = Modifier.padding(vertical = 6.dp)
    )
}

@Composable
private fun CgModelRow(model: GeminiModel, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) ViberLightPurple else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                model.label,
                fontSize = 14.sp,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                color = if (selected) ViberPurple else Color.Black
            )
            if (model.note.isNotBlank()) {
                Text(model.note, fontSize = 11.sp, color = Color.Gray)
            }
        }
        if (selected) {
            Icon(Icons.Default.Check, contentDescription = null, tint = ViberPurple, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun CgSelect(label: String, value: String, options: List<Pair<String, String>>, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, fontSize = 14.sp, modifier = Modifier.weight(1f))
        Box {
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = ViberLightPurple,
                modifier = Modifier.clip(RoundedCornerShape(12.dp)).clickable { open = true }
            ) {
                Row(
                    modifier = Modifier.padding(start = 12.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        options.firstOrNull { it.first == value }?.second ?: value,
                        fontSize = 13.sp,
                        color = ViberPurple,
                        fontWeight = FontWeight.SemiBold
                    )
                    Icon(Icons.Default.ArrowDropDown, contentDescription = null, tint = ViberPurple, modifier = Modifier.size(20.dp))
                }
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                options.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(option.second) },
                        onClick = {
                            onChange(option.first)
                            open = false
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun CgSwitch(label: String, checked: Boolean, enabled: Boolean = true, note: String? = null, onChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(label, fontSize = 14.sp, color = if (enabled) Color.Black else Color.Gray)
            if (note != null) {
                Text(note, fontSize = 11.sp, color = Color.Gray)
            }
        }
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            enabled = enabled,
            colors = SwitchDefaults.colors(checkedTrackColor = ViberPurple)
        )
    }
}
