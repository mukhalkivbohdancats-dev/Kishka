package com.kishka.messenger

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage

/** Аватарка вкладки KishkaBlox: Assets/Kishkablox.png у репозиторії. */
const val KISHKABLOX_LOGO_URL =
    "https://raw.githubusercontent.com/mukhalkivbohdancats-dev/Kishka/main/Assets/Kishkablox.png"

object BloxStrings {
    private val dictionary = mapOf(
        "uk" to mapOf("tab" to "KishkaBlox", "wip" to "В розробці"),
        "ru" to mapOf("tab" to "KishkaBlox", "wip" to "В разработке"),
        "en" to mapOf("tab" to "KishkaBlox", "wip" to "In development")
    )

    fun get(key: String, lang: String): String =
        dictionary[lang]?.get(key) ?: dictionary["uk"]?.get(key) ?: key
}

/** Вкладка KishkaBlox: поки що показує «В розробці» (на всіх мовах). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KishkabloxTab(lang: String) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        AsyncImage(
                            model = KISHKABLOX_LOGO_URL,
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.size(34.dp).clip(RoundedCornerShape(10.dp))
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(BloxStrings.get("tab", lang), fontWeight = FontWeight.Bold, color = ViberPurple, maxLines = 1)
                    }
                }
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier.fillMaxSize().padding(padding).padding(32.dp),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                AsyncImage(
                    model = KISHKABLOX_LOGO_URL,
                    contentDescription = "KishkaBlox",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(150.dp).clip(RoundedCornerShape(32.dp))
                )
                Spacer(modifier = Modifier.height(20.dp))
                Text(
                    BloxStrings.get("wip", lang),
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.DarkGray,
                    textAlign = TextAlign.Center
                )
            }
        }
    }
}
