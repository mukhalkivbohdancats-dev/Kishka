package com.kishka.messenger

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

/**
 * Налаштування ШІ. Зберігаються на пристрої і надсилаються на сервер разом із кожним повідомленням:
 *  - Gemini: пошук Google (гуглити вміє лише Gemini) і стиль відповіді. Модель тут НЕ обирається: її обирають у самій вкладці
 *    Gemini, і сервер використовує саме обрану модель;
 *  - ChatGPT: усі налаштування OpenAI (рівень сервісу, міркування, докладність, інструменти тощо) — див. Chatgptsettings.kt.
 *    Модель обирається у вкладці ChatGPT.
 */
object AiSettings {
    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences("kishka_ai_settings", Context.MODE_PRIVATE)

    // ---------- Gemini ----------
    fun geminiSearch(context: Context): Boolean = prefs(context).getBoolean("gemini_search", true)
    fun setGeminiSearch(context: Context, value: Boolean) = prefs(context).edit().putBoolean("gemini_search", value).apply()

    fun geminiStyle(context: Context): String = prefs(context).getString("gemini_style", "balanced") ?: "balanced"
    fun setGeminiStyle(context: Context, value: String) = prefs(context).edit().putString("gemini_style", value).apply()

    fun geminiJson(context: Context): JSONObject = JSONObject().apply {
        put("search", geminiSearch(context))
        put("style", geminiStyle(context))
    }
}

object AiStrings {
    private val dictionary = mapOf(
        "uk" to mapOf(
            "ai_settings" to "Налаштування ШІ",
            "ai_tab_gemini" to "Gemini",
            "ai_tab_chatgpt" to "ChatGPT",
            "ai_search" to "Пошук Google",
            "ai_search_desc" to "Gemini шукає свіжу інформацію в інтернеті",
            "ai_style" to "Стиль відповіді",
            "style_balanced" to "Звичайний",
            "style_short" to "Короткий",
            "style_detailed" to "Докладний",
            "ai_gemini_note" to "Модель обирається у вкладці Gemini (кнопка зліва від поля вводу). Gemini працює саме на обраній моделі й думає стільки, скільки потрібно, без обмеження часу.",
            "ai_chatgpt_note" to "Ці налаштування діють на всі відповіді ChatGPT. Модель обирається у вкладці ChatGPT (кнопка зліва від поля вводу).",
            "ai_entry_desc" to "Gemini та ChatGPT",
            "ai_back" to "Назад"
        ),
        "ru" to mapOf(
            "ai_settings" to "Настройки ИИ",
            "ai_tab_gemini" to "Gemini",
            "ai_tab_chatgpt" to "ChatGPT",
            "ai_search" to "Поиск Google",
            "ai_search_desc" to "Gemini ищет свежую информацию в интернете",
            "ai_style" to "Стиль ответа",
            "style_balanced" to "Обычный",
            "style_short" to "Короткий",
            "style_detailed" to "Подробный",
            "ai_gemini_note" to "Модель выбирается во вкладке Gemini (кнопка слева от поля ввода). Gemini работает именно на выбранной модели и думает столько, сколько нужно, без ограничения времени.",
            "ai_chatgpt_note" to "Эти настройки действуют на все ответы ChatGPT. Модель выбирается во вкладке ChatGPT (кнопка слева от поля ввода).",
            "ai_entry_desc" to "Gemini и ChatGPT",
            "ai_back" to "Назад"
        ),
        "en" to mapOf(
            "ai_settings" to "AI settings",
            "ai_tab_gemini" to "Gemini",
            "ai_tab_chatgpt" to "ChatGPT",
            "ai_search" to "Google search",
            "ai_search_desc" to "Gemini looks up fresh information on the internet",
            "ai_style" to "Answer style",
            "style_balanced" to "Normal",
            "style_short" to "Short",
            "style_detailed" to "Detailed",
            "ai_gemini_note" to "The model is chosen in the Gemini tab (the button left of the input field). Gemini runs on exactly that model and thinks as long as it needs, with no time limit.",
            "ai_chatgpt_note" to "These settings apply to all ChatGPT answers. The model is chosen in the ChatGPT tab (the button left of the input field).",
            "ai_entry_desc" to "Gemini and ChatGPT",
            "ai_back" to "Back"
        )
    )

    fun get(key: String, lang: String): String =
        dictionary[lang]?.get(key) ?: dictionary["uk"]?.get(key) ?: key
}

@Composable
private fun SettingLabel(text: String) {
    Text(
        text = text,
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
        color = Color.Gray,
        modifier = Modifier.padding(top = 10.dp, bottom = 4.dp)
    )
}

/** Ряд кнопок-чипів, що прокручується по горизонталі (щоб вміщатися на будь-якому екрані). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChipRow(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        options.forEach { (code, label) ->
            FilterChip(
                selected = selected == code,
                onClick = { onSelect(code) },
                label = { Text(label, fontSize = 12.sp, maxLines = 1) },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = ViberLightPurple,
                    selectedLabelColor = ViberPurple
                )
            )
        }
    }
}

@Composable
private fun SwitchRow(title: String, description: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.Medium, fontSize = 14.sp)
            Text(description, fontSize = 12.sp, color = Color.Gray)
        }
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(checkedTrackColor = ViberPurple)
        )
    }
}

/**
 * Рядок «Налаштування ШІ» у вкладці Акаунт. Натискання відкриває окремий екран AiSettingsScreen.
 */
@Composable
fun AiSettingsEntry(lang: String, onOpen: () -> Unit) {
    val s: (String) -> String = { key -> AiStrings.get(key, lang) }
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = ViberLightPurple,
        modifier = Modifier.fillMaxWidth().clickable { onOpen() }
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Default.Settings, contentDescription = null, tint = ViberPurple)
            Column(modifier = Modifier.weight(1f).padding(start = 12.dp)) {
                Text(s("ai_settings"), fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(s("ai_entry_desc"), fontSize = 12.sp, color = Color.Gray, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Icon(Icons.Default.KeyboardArrowRight, contentDescription = null, tint = ViberPurple)
        }
    }
}

/**
 * Окремий екран «Налаштування ШІ» (відкривається з вкладки Акаунт). Два розділи, як вибір мови: Gemini і ChatGPT.
 * Моделі тут не обираються: Gemini і ChatGPT мають власний вибір моделі у своїх вкладках.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiSettingsScreen(email: String, lang: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val s: (String) -> String = { key -> AiStrings.get(key, lang) }
    BackHandler(onBack = onBack)

    var section by remember { mutableStateOf("gemini") }

    // Gemini
    var search by remember { mutableStateOf(AiSettings.geminiSearch(context)) }
    var gStyle by remember { mutableStateOf(AiSettings.geminiStyle(context)) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(s("ai_settings"), fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = s("ai_back"))
                    }
                }
            )
        }
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
            Column(
                modifier = Modifier
                    .widthIn(max = 560.dp)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 12.dp)
            ) {
                ChipRow(
                    options = listOf("gemini" to s("ai_tab_gemini"), "chatgpt" to s("ai_tab_chatgpt")),
                    selected = section,
                    onSelect = { section = it }
                )

                if (section == "gemini") {
                    SwitchRow(s("ai_search"), s("ai_search_desc"), search) {
                        search = it
                        AiSettings.setGeminiSearch(context, it)
                    }

                    SettingLabel(s("ai_style"))
                    ChipRow(
                        options = listOf(
                            "balanced" to s("style_balanced"),
                            "short" to s("style_short"),
                            "detailed" to s("style_detailed")
                        ),
                        selected = gStyle,
                        onSelect = { gStyle = it; AiSettings.setGeminiStyle(context, it) }
                    )

                    Spacer(modifier = Modifier.height(14.dp))
                    Text(s("ai_gemini_note"), fontSize = 12.sp, color = Color.Gray)
                } else {
                    Spacer(modifier = Modifier.height(8.dp))
                    // Ті самі налаштування, що відкриваються в ChatGPT при натисканні на назву моделі
                    ChatgptSettingsSection(lang = lang)

                    Spacer(modifier = Modifier.height(14.dp))
                    Text(s("ai_chatgpt_note"), fontSize = 12.sp, color = Color.Gray)
                }
                Spacer(modifier = Modifier.height(24.dp))
            }
        }
    }
}
