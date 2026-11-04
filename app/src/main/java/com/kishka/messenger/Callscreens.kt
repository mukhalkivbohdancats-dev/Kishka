package com.kishka.messenger

import android.app.Activity
import android.content.Context
import android.media.projection.MediaProjectionManager
import android.Manifest
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.FlipCameraAndroid
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.ScreenShare
import androidx.compose.material.icons.filled.StopScreenShare
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material.icons.filled.Speaker
import androidx.compose.material.icons.filled.VolumeDown
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.delay

object CallStrings {
    private val dictionary = mapOf(
        "uk" to mapOf(
            "incoming" to "Вхідний дзвінок",
            "outgoing" to "Дзвінок...",
            "mic" to "Мікрофон",
            "speaker" to "Динамік",
            "volume" to "Гучність",
            "end" to "Завершити",
            "accept" to "Прийняти",
            "decline" to "Відхилити",
            "minimize" to "Згорнути",
            "tap_return" to "Натисніть, щоб повернутися до дзвінка",
            "missed" to "Пропущений",
            "outgoing_log" to "Вихідний",
            "incoming_log" to "Вхідний",
            "clear" to "Очистити історію",
            "clear_confirm" to "Видалити всю історію дзвінків на цьому пристрої?",
            "camera" to "Камера",
            "screen" to "Екран",
            "flip" to "Повернути камеру",
            "sharing" to "Ви показуєте свій екран",
            "camera_denied" to "Немає дозволу на камеру. Дозвольте її в налаштуваннях телефона",
            "video_failed" to "Не вдалося увімкнути відео"
        ),
        "ru" to mapOf(
            "incoming" to "Входящий звонок",
            "outgoing" to "Звонок...",
            "mic" to "Микрофон",
            "speaker" to "Динамик",
            "volume" to "Громкость",
            "end" to "Завершить",
            "accept" to "Принять",
            "decline" to "Отклонить",
            "minimize" to "Свернуть",
            "tap_return" to "Нажмите, чтобы вернуться к звонку",
            "missed" to "Пропущенный",
            "outgoing_log" to "Исходящий",
            "incoming_log" to "Входящий",
            "clear" to "Очистить историю",
            "clear_confirm" to "Удалить всю историю звонков на этом устройстве?",
            "camera" to "Камера",
            "screen" to "Экран",
            "flip" to "Повернуть камеру",
            "sharing" to "Вы показываете свой экран",
            "camera_denied" to "Нет разрешения на камеру. Разрешите её в настройках телефона",
            "video_failed" to "Не удалось включить видео"
        ),
        "en" to mapOf(
            "incoming" to "Incoming call",
            "outgoing" to "Calling...",
            "mic" to "Mic",
            "speaker" to "Speaker",
            "volume" to "Volume",
            "end" to "End",
            "accept" to "Accept",
            "decline" to "Decline",
            "minimize" to "Minimize",
            "tap_return" to "Tap to return to the call",
            "missed" to "Missed",
            "outgoing_log" to "Outgoing",
            "incoming_log" to "Incoming",
            "clear" to "Clear history",
            "clear_confirm" to "Delete the whole call history on this device?",
            "camera" to "Camera",
            "screen" to "Screen",
            "flip" to "Flip camera",
            "sharing" to "You are sharing your screen",
            "camera_denied" to "No camera permission. Allow it in the phone settings",
            "video_failed" to "Could not turn on the video"
        )
    )

    fun get(key: String, lang: String): String =
        dictionary[lang]?.get(key) ?: dictionary["uk"]?.get(key) ?: key
}

fun formatCallTimer(totalSeconds: Long): String {
    val s = totalSeconds.coerceAtLeast(0L)
    val h = s / 3600
    val m = (s % 3600) / 60
    val sec = s % 60
    return if (h > 0) String.format("%d:%02d:%02d", h, m, sec) else String.format("%02d:%02d", m, sec)
}

/** Рядок статусу дзвінка: "Дзвінок...", "Вхідний дзвінок" або таймер розмови. */
@Composable
private fun rememberCallStatus(lang: String): String {
    val phase = CallSession.phase
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(phase, CallSession.startedAt) {
        while (phase == CallPhase.ACTIVE) {
            now = System.currentTimeMillis()
            delay(1000)
        }
    }
    return when (phase) {
        CallPhase.INCOMING -> CallStrings.get("incoming", lang)
        CallPhase.OUTGOING -> CallStrings.get("outgoing", lang)
        CallPhase.ACTIVE -> formatCallTimer((now - CallSession.startedAt) / 1000L)
        CallPhase.IDLE -> ""
    }
}

private class CallButton(
    val icon: ImageVector,
    val label: String,
    val active: Boolean,
    val solid: Color?,
    val onClick: () -> Unit
)

/**
 * Єдиний повноекранний екран дзвінка (вхідний / вихідний / розмова).
 * Без відео: аватар співрозмовника посередині. Коли співрозмовник вмикає камеру чи екран — його відео на весь екран,
 * а коли вимикає — знову аватар посередині. Кнопка повороту камери зверху справа зʼявляється лише коли моя камера увімкнена.
 */
@Composable
fun CallScreen(lang: String) {
    val phase = CallSession.phase
    val status = rememberCallStatus(lang)
    var showVolume by remember { mutableStateOf(false) }
    val context = LocalContext.current

    val videoMode = phase == CallPhase.ACTIVE && CallVideo.remoteOn
    val camOn = CallVideo.localOn && CallVideo.localSource == "camera"
    val screenOn = CallVideo.localOn && CallVideo.localSource == "screen"

    // Системна кнопка "Назад" згортає дзвінок, а не вимикає
    BackHandler(enabled = true) { CallCoordinator.minimize() }

    // Повзунок слідкує за системною гучністю (кнопки гучності телефона)
    LaunchedEffect(Unit) {
        while (true) {
            CallCoordinator.syncVolume()
            delay(500)
        }
    }

    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) CallCoordinator.startCamera(false)
        else Notice.show(CallStrings.get("camera_denied", lang))
    }
    val projection = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        if (result.resultCode == Activity.RESULT_OK && data != null) {
            CallCoordinator.startScreen(result.resultCode, data)
        }
    }

    val onCamera: () -> Unit = {
        if (camOn) {
            CallCoordinator.stopVideo()
        } else if (CallVideo.hasCameraPermission(context)) {
            CallCoordinator.startCamera(false) // задня камера за замовчуванням
        } else {
            cameraPermission.launch(Manifest.permission.CAMERA)
        }
    }
    val onScreen: () -> Unit = {
        if (screenOn) {
            CallCoordinator.stopVideo()
        } else {
            try {
                val mpm = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                projection.launch(mpm.createScreenCaptureIntent())
            } catch (e: Exception) {
                e.printStackTrace()
                Notice.show(CallStrings.get("video_failed", lang))
            }
        }
    }

    Surface(modifier = Modifier.fillMaxSize(), color = if (videoMode) Color.Black else ViberPurple) {
        BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
            val viewportHeight = maxHeight
            val viewportWidth = maxWidth
            val compact = maxHeight < 520.dp || maxWidth < 340.dp
            val tablet = maxWidth >= 600.dp && maxHeight >= 520.dp
            val avatarSize: Dp = if (compact) 84.dp else if (tablet) 170.dp else 120.dp
            val buttonSize: Dp = if (compact) 56.dp else if (tablet) 80.dp else 64.dp
            val iconSize: Dp = buttonSize * 0.45f

            // Відео співрозмовника — на весь екран, під кнопками
            if (videoMode) {
                RemoteVideoView(modifier = Modifier.fillMaxSize())
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .heightIn(min = viewportHeight)
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                // Верхній рядок: згорнути | (ім'я і таймер при відео) | повернути камеру (лише при увімкненій камері)
                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(
                        onClick = { CallCoordinator.minimize() },
                        modifier = Modifier.clip(CircleShape).background(Color.White.copy(alpha = 0.18f))
                    ) {
                        Icon(Icons.Default.KeyboardArrowDown, contentDescription = CallStrings.get("minimize", lang), tint = Color.White)
                    }
                    Spacer(modifier = Modifier.width(10.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        if (videoMode) {
                            Text(
                                CallSession.peerName.ifEmpty { CallSession.peerEmail },
                                color = Color.White,
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(status, color = Color.White.copy(alpha = 0.85f), fontSize = 12.sp)
                        } else {
                            Text(CallStrings.get("minimize", lang), color = Color.White.copy(alpha = 0.85f), fontSize = 13.sp)
                        }
                    }
                    if (camOn) {
                        IconButton(
                            onClick = { CallCoordinator.flipCamera() },
                            modifier = Modifier.clip(CircleShape).background(Color.White.copy(alpha = 0.28f))
                        ) {
                            Icon(Icons.Default.FlipCameraAndroid, contentDescription = CallStrings.get("flip", lang), tint = Color.White)
                        }
                    }
                }

                // Посередині: аватар (коли нема відео) або порожньо (відео на весь екран)
                if (videoMode) {
                    Spacer(modifier = Modifier.height(1.dp))
                } else {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        AsyncImage(
                            model = CallSession.peerAvatar?.takeIf { it.isNotEmpty() } ?: DEFAULT_AVATAR_URL,
                            contentDescription = null,
                            modifier = Modifier.size(avatarSize).clip(CircleShape)
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            CallSession.peerName.ifEmpty { CallSession.peerEmail },
                            fontSize = if (tablet) 28.sp else 22.sp,
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(status, fontSize = if (tablet) 20.sp else 16.sp, color = Color.White.copy(alpha = 0.85f))
                        if (screenOn) {
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(CallStrings.get("sharing", lang), fontSize = 13.sp, color = Color.White.copy(alpha = 0.85f))
                        }
                    }
                }

                // Кнопки
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = if (videoMode) {
                        Modifier.clip(RoundedCornerShape(24.dp)).background(Color.Black.copy(alpha = 0.38f)).padding(vertical = 10.dp, horizontal = 6.dp)
                    } else Modifier
                ) {
                    if (phase == CallPhase.INCOMING) {
                        Row(
                            modifier = Modifier.fillMaxWidth().widthIn(max = 520.dp),
                            horizontalArrangement = Arrangement.SpaceEvenly
                        ) {
                            CallControl(Icons.Default.CallEnd, CallStrings.get("decline", lang), false, buttonSize, iconSize, Color.Red) {
                                CallCoordinator.decline()
                            }
                            CallControl(Icons.Default.Call, CallStrings.get("accept", lang), false, buttonSize, iconSize, Color(0xFF2E7D32)) {
                                CallCoordinator.accept()
                            }
                        }
                    } else {
                        if (showVolume) {
                            val max = CallCoordinator.volumeMax()
                            Row(
                                modifier = Modifier.fillMaxWidth().widthIn(max = 520.dp).padding(bottom = 14.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(Icons.Default.VolumeDown, contentDescription = null, tint = Color.White)
                                Slider(
                                    value = CallSession.volume,
                                    onValueChange = {
                                        CallSession.volumeDragging = true
                                        CallCoordinator.setVolume(it)
                                    },
                                    onValueChangeFinished = { CallSession.volumeDragging = false },
                                    steps = (max - 1).coerceAtLeast(0),
                                    modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
                                    colors = SliderDefaults.colors(
                                        thumbColor = Color.White,
                                        activeTrackColor = Color.White,
                                        inactiveTrackColor = Color.White.copy(alpha = 0.3f)
                                    )
                                )
                                Icon(Icons.Default.VolumeUp, contentDescription = null, tint = Color.White)
                            }
                        }

                        val buttons = ArrayList<CallButton>()
                        buttons.add(CallButton(
                            if (CallSession.muted) Icons.Default.MicOff else Icons.Default.Mic,
                            CallStrings.get("mic", lang), CallSession.muted, null
                        ) { CallCoordinator.toggleMute() })
                        buttons.add(CallButton(Icons.Default.Speaker, CallStrings.get("speaker", lang), CallSession.speakerOn, null) {
                            CallCoordinator.toggleSpeaker()
                        })
                        buttons.add(CallButton(Icons.Default.VolumeUp, CallStrings.get("volume", lang), showVolume, null) {
                            showVolume = !showVolume
                        })
                        if (phase == CallPhase.ACTIVE) {
                            buttons.add(CallButton(
                                if (camOn) Icons.Default.Videocam else Icons.Default.VideocamOff,
                                CallStrings.get("camera", lang), camOn, null, onCamera
                            ))
                            buttons.add(CallButton(
                                if (screenOn) Icons.Default.StopScreenShare else Icons.Default.ScreenShare,
                                CallStrings.get("screen", lang), screenOn, null, onScreen
                            ))
                        }
                        buttons.add(CallButton(Icons.Default.CallEnd, CallStrings.get("end", lang), false, Color.Red) { CallCoordinator.end() })

                        // Кнопки вміщуються і на вузькому телефоні, і на планшеті: широкий екран — один рядок, вузький — по 3
                        val perRow = when {
                            viewportWidth >= 640.dp -> buttons.size
                            buttons.size <= 4 -> buttons.size
                            else -> 3
                        }
                        buttons.chunked(perRow).forEachIndexed { rowIndex, rowButtons ->
                            if (rowIndex > 0) Spacer(modifier = Modifier.height(10.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth().widthIn(max = 640.dp),
                                horizontalArrangement = Arrangement.SpaceEvenly,
                                verticalAlignment = Alignment.Top
                            ) {
                                rowButtons.forEach { b ->
                                    CallControl(b.icon, b.label, b.active, buttonSize, iconSize, b.solid, b.onClick)
                                }
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(6.dp))
                }
            }

            // Маленьке вікно «я» (лише камера) — зверху справа під кнопкою повороту
            if (camOn) {
                val rotated = CallVideo.localRot % 180 != 0
                val aspect = if (rotated) CallVideo.localH.toFloat() / CallVideo.localW.toFloat()
                else CallVideo.localW.toFloat() / CallVideo.localH.toFloat()
                val longSide: Dp = if (tablet) 220.dp else 150.dp
                val pipW: Dp = if (aspect < 1f) longSide * aspect else longSide
                val pipH: Dp = if (aspect < 1f) longSide else longSide / aspect
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(top = 76.dp, end = 14.dp)
                        .size(pipW, pipH)
                        .clip(RoundedCornerShape(14.dp))
                        .background(Color.Black)
                ) {
                    LocalPreviewView(modifier = Modifier.fillMaxSize())
                }
            }
        }
    }
}

/** Кругла кнопка з підписом. active = кнопка "увімкнена" (біла); solid — окремий колір (червона / зелена). */
@Composable
private fun CallControl(
    icon: ImageVector,
    label: String,
    active: Boolean,
    size: Dp,
    iconSize: Dp,
    solid: Color? = null,
    onClick: () -> Unit
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.widthIn(min = size, max = size + 28.dp)) {
        val background = solid ?: if (active) Color.White else Color.White.copy(alpha = 0.2f)
        val tint = if (solid != null) Color.White else if (active) ViberPurple else Color.White
        Box(
            modifier = Modifier.size(size).clip(CircleShape).background(background).clickable { onClick() },
            contentAlignment = Alignment.Center
        ) {
            Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(iconSize))
        }
        Spacer(modifier = Modifier.height(6.dp))
        Text(label, color = Color.White, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
    }
}

/** Смужка зверху, коли екран дзвінка згорнуто: дзвінок продовжує працювати. */
@Composable
fun CallBanner(lang: String) {
    val phase = CallSession.phase
    val status = rememberCallStatus(lang)
    val color = if (phase == CallPhase.ACTIVE) Color(0xFF2E7D32) else ViberPurple

    Surface(color = color, modifier = Modifier.fillMaxWidth().clickable { CallCoordinator.expand() }) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Default.Call, contentDescription = null, tint = Color.White)
            Spacer(modifier = Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    CallSession.peerName.ifEmpty { CallSession.peerEmail },
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    if (phase == CallPhase.ACTIVE) status else "$status  -  ${CallStrings.get("tap_return", lang)}",
                    color = Color.White.copy(alpha = 0.85f),
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            if (phase == CallPhase.INCOMING) {
                IconButton(
                    onClick = { CallCoordinator.decline() },
                    modifier = Modifier.size(38.dp).clip(CircleShape).background(Color.Red)
                ) {
                    Icon(Icons.Default.CallEnd, contentDescription = CallStrings.get("decline", lang), tint = Color.White, modifier = Modifier.size(20.dp))
                }
                Spacer(modifier = Modifier.width(8.dp))
                IconButton(
                    onClick = { CallCoordinator.accept() },
                    modifier = Modifier.size(38.dp).clip(CircleShape).background(Color(0xFF1B5E20))
                ) {
                    Icon(Icons.Default.Call, contentDescription = CallStrings.get("accept", lang), tint = Color.White, modifier = Modifier.size(20.dp))
                }
            } else {
                IconButton(
                    onClick = { CallCoordinator.end() },
                    modifier = Modifier.size(38.dp).clip(CircleShape).background(Color.Red)
                ) {
                    Icon(Icons.Default.CallEnd, contentDescription = CallStrings.get("end", lang), tint = Color.White, modifier = Modifier.size(20.dp))
                }
            }
        }
    }
}
