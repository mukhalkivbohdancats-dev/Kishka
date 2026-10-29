package com.kishka.messenger

import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog

data class NoticeData(val title: String?, val text: String)

/**
 * Повідомлення замість "білих смужок" (Toast): заокруглене вікно з кнопкою OK.
 * Можна викликати з будь-якого потоку. Якщо повідомлень кілька — вони показуються по черзі.
 */
object Notice {
    private val handler = Handler(Looper.getMainLooper())
    private val pending = ArrayDeque<NoticeData>()

    var current by mutableStateOf<NoticeData?>(null)
        private set

    fun show(text: String, title: String? = null) {
        if (text.isBlank()) return
        handler.post {
            val data = NoticeData(title, text)
            if (current == null) current = data else if (pending.none { it == data } && current != data) pending.addLast(data)
        }
    }

    fun dismiss() {
        handler.post { current = pending.removeFirstOrNull() }
    }
}

/** Розмістити один раз на кореневому екрані. */
@Composable
fun NoticeHost(lang: String) {
    val data = Notice.current ?: return
    Dialog(onDismissRequest = { Notice.dismiss() }) {
        Surface(shape = RoundedCornerShape(24.dp), color = Color.White, shadowElevation = 8.dp) {
            Column(
                modifier = Modifier.padding(24.dp).widthIn(min = 240.dp, max = 400.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Box(
                    modifier = Modifier.size(52.dp).clip(CircleShape).background(ViberLightPurple),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Default.Info, contentDescription = null, tint = ViberPurple, modifier = Modifier.size(30.dp))
                }
                Spacer(modifier = Modifier.height(14.dp))
                if (!data.title.isNullOrBlank()) {
                    Text(data.title, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.Black, textAlign = TextAlign.Center)
                    Spacer(modifier = Modifier.height(8.dp))
                }
                Text(data.text, fontSize = 15.sp, color = Color.DarkGray, textAlign = TextAlign.Center)
                Spacer(modifier = Modifier.height(20.dp))
                Button(
                    onClick = { Notice.dismiss() },
                    modifier = Modifier.fillMaxWidth().height(46.dp),
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = ViberPurple)
                ) {
                    Text(ChatStrings.get("ok", lang), fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}
