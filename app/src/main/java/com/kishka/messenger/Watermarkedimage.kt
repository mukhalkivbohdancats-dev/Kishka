package com.kishka.messenger

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage

/**
 * Зображення з логотипом знизу праворуч (50% прозорості). Використовується в ChatUi.kt для показу картинок із водяним знаком.
 * Логотип лежить у res/drawable-nodpi/logo_watermark.png. Під час збереження в галерею він вшивається в файл (Mediautils.kt).
 * Раніше цей компонент жив у Previewtab.kt (вкладка Кішка ШІ), який видалено.
 */
@Composable
fun WatermarkedImage(url: String, modifier: Modifier = Modifier) {
    var ratio by remember(url) { mutableStateOf(1f) }
    Box(modifier = modifier.aspectRatio(ratio)) {
        AsyncImage(
            model = url,
            contentDescription = null,
            contentScale = ContentScale.FillBounds,
            modifier = Modifier.fillMaxSize(),
            onSuccess = { state ->
                val d = state.result.drawable
                if (d.intrinsicWidth > 0 && d.intrinsicHeight > 0) {
                    ratio = d.intrinsicWidth.toFloat() / d.intrinsicHeight.toFloat()
                }
            }
        )
        androidx.compose.foundation.Image(
            painter = painterResource(R.drawable.logo_watermark),
            contentDescription = null,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(6.dp)
                .fillMaxWidth(0.14f)
                .aspectRatio(1f)
                .alpha(0.5f)
        )
    }
}
