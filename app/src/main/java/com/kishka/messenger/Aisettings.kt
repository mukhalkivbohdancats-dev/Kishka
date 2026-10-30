package com.kishka.messenger

import android.content.Context
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

/**
 * Налаштування ШІ. Зберігаються на пристрої і надсилаються на сервер разом із кожним повідомленням:
 *  - Gemini: пошук Google (гуглити вміє лише Gemini), стиль відповіді, модель за замовчуванням (обирається в самій вкладці);
 *  - Kishka AI: стиль, творчість, памʼять фактів, стиль і розмір зображень.
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

    // ---------- Kishka AI ----------
    fun kaiStyle(context: Context): String = prefs(context).getString("kai_style", "balanced") ?: "balanced"
    fun setKaiStyle(context: Context, value: String) = prefs(context).edit().putString("kai_style", value).apply()

    fun kaiCreativity(context: Context): String = prefs(context).getString("kai_creativity", "mid") ?: "mid"
    fun setKaiCreativity(context: Context, value: String) = prefs(context).edit().putString("kai_creativity", value).apply()

    fun kaiMemory(context: Context): Boolean = prefs(context).getBoolean("kai_memory", true)
    fun setKaiMemory(context: Context, value: Boolean) = prefs(context).edit().putBoolean("kai_memory", value).apply()

    fun kaiImageStyle(context: Context): String = prefs(context).getString("kai_image_style", "auto") ?: "auto"
    fun setKaiImageStyle(context: Context, value: String) = prefs(context).edit().putString("kai_image_style", value).apply()

    fun kaiImageSize(context: Context): String = prefs(context).getString("kai_image_size", "auto") ?: "auto"
    fun setKaiImageSize(context: Context, value: String) = prefs(context).edit().putString("kai_image_size", value).apply()

    fun kaiJson(context: Context): JSONObject = JSONObject().apply {
        put("style", kaiStyle(context))
        put("creativity", kaiCreativity(context))
        put("memory", kaiMemory(context))
        put("imageStyle", kaiImageStyle(context))
        put("imageSize", kaiImageSize(context))
    }
}

object AiStrings {
    private val dictionary = mapOf(
        "uk" to mapOf(
            "ai_settings" to "Налаштування ШІ",
            "ai_tab_gemini" to "Gemini",
            "ai_tab_kishka" to "Кішка ШІ (Kishka)",
            "ai_model" to "Модель за замовчуванням",
            "ai_search" to "Пошук Google",
            "ai_search_desc" to "Gemini шукає свіжу інформацію в інтернеті",
            "ai_style" to "Стиль відповіді",
            "style_balanced" to "Звичайний",
            "style_short" to "Короткий",
            "style_detailed" to "Докладний",
            "style_friendly" to "Дружній",
            "ai_creativity" to "Творчість",
            "cr_low" to "Точна",
            "cr_mid" to "Середня",
            "cr_high" to "Висока",
            "ai_memory" to "Памʼять фактів",
            "ai_memory_desc" to "Запамʼятовувати факти, які ви просите («Запамʼятай, що ...»)",
            "ai_facts_count" to "Збережено фактів: %d",
            "ai_clear_facts" to "Забути факти про мене",
            "ai_facts_cleared" to "Факти про вас видалено",
            "ai_clear_chat" to "Очистити розмову",
            "ai_chat_cleared" to "Розмову очищено",
            "ai_image_style" to "Стиль зображень",
            "is_auto" to "Авто",
            "is_realistic" to "Реалістичний",
            "is_anime" to "Аніме",
            "is_art" to "Малюнок",
            "is_3d" to "3D",
            "is_pixel" to "Піксель-арт",
            "ai_image_size" to "Розмір зображень",
            "sz_auto" to "Авто",
            "sz_square" to "Квадрат",
            "sz_landscape" to "Горизонтально",
            "sz_portrait" to "Вертикально",
            "ai_gemini_note" to "Усі моделі Gemini доступні у вкладці Gemini зліва від поля вводу."
        ),
        "ru" to mapOf(
            "ai_settings" to "Настройки ИИ",
            "ai_tab_gemini" to "Gemini",
            "ai_tab_kishka" to "Кішка ИИ (Kishka)",
            "ai_model" to "Модель по умолчанию",
            "ai_search" to "Поиск Google",
            "ai_search_desc" to "Gemini ищет свежую информацию в интернете",
            "ai_style" to "Стиль ответа",
            "style_balanced" to "Обычный",
            "style_short" to "Короткий",
            "style_detailed" to "Подробный",
            "style_friendly" to "Дружеский",
            "ai_creativity" to "Творчество",
            "cr_low" to "Точная",
            "cr_mid" to "Средняя",
            "cr_high" to "Высокая",
            "ai_memory" to "Память фактов",
            "ai_memory_desc" to "Запоминать факты, о которых вы просите («Запомни, что ...»)",
            "ai_facts_count" to "Сохранено фактов: %d",
            "ai_clear_facts" to "Забыть факты обо мне",
            "ai_facts_cleared" to "Факты о вас удалены",
            "ai_clear_chat" to "Очистить разговор",
            "ai_chat_cleared" to "Разговор очищен",
            "ai_image_style" to "Стиль изображений",
            "is_auto" to "Авто",
            "is_realistic" to "Реалистичный",
            "is_anime" to "Аниме",
            "is_art" to "Рисунок",
            "is_3d" to "3D",
            "is_pixel" to "Пиксель-арт",
            "ai_image_size" to "Размер изображений",
            "sz_auto" to "Авто",
            "sz_square" to "Квадрат",
            "sz_landscape" to "Горизонтально",
            "sz_portrait" to "Вертикально",
            "ai_gemini_note" to "Все модели Gemini доступны во вкладке Gemini слева от поля ввода."
        ),
        "en" to mapOf(
            "ai_settings" to "AI settings",
            "ai_tab_gemini" to "Gemini",
            "ai_tab_kishka" to "Kishka AI",
            "ai_model" to "Default model",
            "ai_search" to "Google search",
            "ai_search_desc" to "Gemini looks up fresh information on the internet",
            "ai_style" to "Answer style",
            "style_balanced" to "Normal",
            "style_short" to "Short",
            "style_detailed" to "Detailed",
            "style_friendly" to "Friendly",
            "ai_creativity" to "Creativity",
            "cr_low" to "Precise",
            "cr_mid" to "Medium",
            "cr_high" to "High",
            "ai_memory" to "Fact memory",
            "ai_memory_desc" to "Remember facts you ask for (“Remember that ...”)",
            "ai_facts_count" to "Facts saved: %d",
            "ai_clear_facts" to "Forget facts about me",
            "ai_facts_cleared" to "Facts about you were deleted",
            "ai_clear_chat" to "Clear conversation",
            "ai_chat_cleared" to "Conversation cleared",
            "ai_image_style" to "Image style",
            "is_auto" to "Auto",
            "is_realistic" to "Realistic",
            "is_anime" to "Anime",
            "is_art" to "Painting",
            "is_3d" to "3D",
            "is_pixel" to "Pixel art",
            "ai_image_size" to "Image size",
            "sz_auto" to "Auto",
            "sz_square" to "Square",
            "sz_landscape" to "Landscape",
            "sz_portrait" to "Portrait",
            "ai_gemini_note" to "All Gemini models are in the Gemini tab, left of the input field."
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
 * Блок «Налаштування ШІ» у вкладці Акаунт. Два розділи, як вибір мови: Gemini і Кішка ШІ (Kishka).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiSettingsSection(email: String, lang: String) {
    val context = LocalContext.current
    val s: (String) -> String = { key -> AiStrings.get(key, lang) }

    var section by remember { mutableStateOf("gemini") }

    // Gemini
    var search by remember { mutableStateOf(AiSettings.geminiSearch(context)) }
    var gStyle by remember { mutableStateOf(AiSettings.geminiStyle(context)) }
    var modelMenu by remember { mutableStateOf(false) }
    val geminiSession = remember(email) { GeminiSessions.get(context, email) }
    geminiSession.lang = lang

    // Kishka AI
    var kStyle by remember { mutableStateOf(AiSettings.kaiStyle(context)) }
    var creativity by remember { mutableStateOf(AiSettings.kaiCreativity(context)) }
    var memory by remember { mutableStateOf(AiSettings.kaiMemory(context)) }
    var imageStyle by remember { mutableStateOf(AiSettings.kaiImageStyle(context)) }
    var imageSize by remember { mutableStateOf(AiSettings.kaiImageSize(context)) }
    var factsCount by remember { mutableStateOf<Int?>(null) }
    val kaiSession = remember(email) { PreviewSessions.get(context, email) }
    kaiSession.lang = lang

    androidx.compose.runtime.LaunchedEffect(section, email) {
        if (section == "kishka") {
            kaiSession.manager.getFacts(email) { facts -> factsCount = facts?.size }
        }
    }

    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(
            text = s("ai_settings"),
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
            color = Color.Gray,
            modifier = Modifier.padding(bottom = 4.dp)
        )
        ChipRow(
            options = listOf("gemini" to s("ai_tab_gemini"), "kishka" to s("ai_tab_kishka")),
            selected = section,
            onSelect = { section = it }
        )

        if (section == "gemini") {
            SettingLabel(s("ai_model"))
            Box {
                OutlinedButton(onClick = { modelMenu = true }, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        geminiSession.selectedModel.label,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false)
                    )
                }
                DropdownMenu(expanded = modelMenu, onDismissRequest = { modelMenu = false }) {
                    geminiSession.models.forEach { model ->
                        DropdownMenuItem(
                            text = { Text(model.label, fontSize = 14.sp) },
                            onClick = {
                                geminiSession.selectModel(model.id)
                                modelMenu = false
                            }
                        )
                    }
                }
            }

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

            Spacer(modifier = Modifier.height(8.dp))
            Text(s("ai_gemini_note"), fontSize = 12.sp, color = Color.Gray)
        } else {
            SettingLabel(s("ai_style"))
            ChipRow(
                options = listOf(
                    "balanced" to s("style_balanced"),
                    "short" to s("style_short"),
                    "detailed" to s("style_detailed"),
                    "friendly" to s("style_friendly")
                ),
                selected = kStyle,
                onSelect = { kStyle = it; AiSettings.setKaiStyle(context, it) }
            )

            SettingLabel(s("ai_creativity"))
            ChipRow(
                options = listOf("low" to s("cr_low"), "mid" to s("cr_mid"), "high" to s("cr_high")),
                selected = creativity,
                onSelect = { creativity = it; AiSettings.setKaiCreativity(context, it) }
            )

            SwitchRow(s("ai_memory"), s("ai_memory_desc"), memory) {
                memory = it
                AiSettings.setKaiMemory(context, it)
            }
            factsCount?.let { count ->
                Text(String.format(s("ai_facts_count"), count), fontSize = 12.sp, color = Color.Gray)
            }

            SettingLabel(s("ai_image_style"))
            ChipRow(
                options = listOf(
                    "auto" to s("is_auto"),
                    "realistic" to s("is_realistic"),
                    "anime" to s("is_anime"),
                    "art" to s("is_art"),
                    "render3d" to s("is_3d"),
                    "pixel" to s("is_pixel")
                ),
                selected = imageStyle,
                onSelect = { imageStyle = it; AiSettings.setKaiImageStyle(context, it) }
            )

            SettingLabel(s("ai_image_size"))
            ChipRow(
                options = listOf(
                    "auto" to s("sz_auto"),
                    "square" to s("sz_square"),
                    "landscape" to s("sz_landscape"),
                    "portrait" to s("sz_portrait")
                ),
                selected = imageSize,
                onSelect = { imageSize = it; AiSettings.setKaiImageSize(context, it) }
            )

            Spacer(modifier = Modifier.height(10.dp))
            OutlinedButton(
                onClick = {
                    kaiSession.manager.clearFacts(email) { ok ->
                        if (ok) {
                            factsCount = 0
                            Notice.show(s("ai_facts_cleared"))
                        } else {
                            Notice.show(Strings.get("gemini_error", lang))
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(s("ai_clear_facts"), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Spacer(modifier = Modifier.height(6.dp))
            OutlinedButton(
                onClick = { kaiSession.clearMemory() },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(s("ai_clear_chat"), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}
