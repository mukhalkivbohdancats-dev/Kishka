package com.kishka.messenger

import android.content.Intent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Help
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Photo
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.ViewList
import androidx.compose.material.icons.filled.ZoomIn
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.delay

/**
 * Меню гри KishkaBlox у стилі Roblox (за скріншотом-орієнтиром):
 *  - зверху зліва велика кругла кнопка-логотип, поруч темна «таблетка» з кнопками;
 *  - по центру напівпрозора темна панель із вкладками People / Settings / Gallery / Report / Help;
 *  - у вкладці People: «Invite Friends», заголовок «In this server» з перемикачем список/плитки, рядки гравців
 *    (аватар, нік, @нік, лупа, прапорець-скарга, блок, «Add Friend»);
 *  - унизу три великі кнопки: Leave, Respawn, Resume.
 * Розміри підлаштовуються під телефон і планшет (compact за малої висоти екрана).
 */

private val PanelBg = Color(0xE61C1D22)
private val RowBg = Color(0xFF26272D)
private val ButtonBg = Color(0xFF34353B)
private val IconBg = Color(0xFF3A3B42)
private val ResumeBlue = Color(0xFF213F9F)
private val TextDim = Color(0xFFB4B6C0)
private val BarBg = Color(0xA6101114)

private val AVATAR_COLORS = longArrayOf(0xFFC0392B, 0xFF2E86C1, 0xFF28B463, 0xFFD68910, 0xFF8E44AD, 0xFF17A589, 0xFFCB4335, 0xFF5D6D7E)

private fun avatarColor(nick: String): Color {
    var h = 0
    for (ch in nick.lowercase()) h = (h * 31 + ch.code) and 0x7FFFFFFF
    return Color(AVATAR_COLORS[h % AVATAR_COLORS.size])
}

/** Верхній ряд: велика кругла кнопка з логотипом + таблетка з кнопками меню / люди. */
@Composable
fun BoxScope.BloxTopBar(lang: String, menuOpen: Boolean, onToggle: () -> Unit, onPeople: () -> Unit) {
    val b: (String) -> String = { key -> BloxStrings.get(key, lang) }
    val compact = LocalConfiguration.current.screenHeightDp < 460
    val big: Dp = if (compact) 52.dp else 62.dp
    Row(
        modifier = Modifier.align(Alignment.TopStart).padding(start = 12.dp, top = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(big)
                .clip(CircleShape)
                .background(BarBg)
                .border(if (menuOpen) BorderStroke(2.dp, Color(0xFF4C8DFF)) else BorderStroke(0.dp, Color.Transparent), CircleShape)
                .clickable(onClick = onToggle)
        ) {
            AsyncImage(
                model = bloxImageModel("kishkablox.png", KISHKABLOX_LOGO_URL),
                contentDescription = b("menu"),
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().padding(4.dp).clip(CircleShape)
            )
        }
        Spacer(modifier = Modifier.width(10.dp))
        Surface(shape = RoundedCornerShape(50), color = BarBg) {
            Row(
                modifier = Modifier.height(big).padding(horizontal = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onToggle, modifier = Modifier.size(big - 6.dp)) {
                    Icon(Icons.Default.Menu, contentDescription = b("menu"), tint = Color.White, modifier = Modifier.size(30.dp))
                }
                IconButton(onClick = onPeople, modifier = Modifier.size(big - 6.dp)) {
                    Icon(Icons.Default.People, contentDescription = b("players"), tint = Color.White, modifier = Modifier.size(28.dp))
                }
            }
        }
    }
}

@Composable
private fun SmallIconButton(icon: ImageVector, description: String, tint: Color = Color.White, size: Dp = 46.dp, onClick: () -> Unit) {
    Box(
        modifier = Modifier.size(size).clip(RoundedCornerShape(10.dp)).background(IconBg).clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Icon(icon, contentDescription = description, tint = tint, modifier = Modifier.size(size * 0.54f))
    }
}

@Composable
private fun PlayerRow(
    lang: String,
    player: BloxPlayerInfo,
    compact: Boolean,
    blocked: Boolean,
    onInspect: () -> Unit,
    onReport: () -> Unit,
    onBlock: () -> Unit,
    onAddFriend: () -> Unit
) {
    val b: (String) -> String = { key -> BloxStrings.get(key, lang) }
    val isMe = player.id == BloxGame.myId
    val isFriend = BloxAuth.friends.any { it.equals(player.nick, ignoreCase = true) }
    val isSent = BloxAuth.outgoing.any { it.equals(player.nick, ignoreCase = true) }
    val rowH = if (compact) 58.dp else 78.dp
    val avatar = if (compact) 42.dp else 60.dp
    Row(
        modifier = Modifier.fillMaxWidth().height(rowH).clip(RoundedCornerShape(14.dp)).background(RowBg).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(avatar).clip(CircleShape).background(avatarColor(player.nick)),
            contentAlignment = Alignment.Center
        ) {
            Text(player.nick.take(1).uppercase(), color = Color.White, fontSize = if (compact) 18.sp else 24.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                player.nick + if (isMe) "  (" + b("you") + ")" else "",
                color = Color.White,
                fontSize = if (compact) 16.sp else 20.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text("@" + player.nick.lowercase(), color = TextDim, fontSize = if (compact) 12.sp else 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        val btn = if (compact) 40.dp else 50.dp
        SmallIconButton(Icons.Default.ZoomIn, b("inspect"), size = btn, onClick = onInspect)
        if (!isMe) {
            Spacer(modifier = Modifier.width(8.dp))
            SmallIconButton(Icons.Default.Flag, b("report_player"), size = btn, onClick = onReport)
            Spacer(modifier = Modifier.width(8.dp))
            SmallIconButton(
                Icons.Default.Block,
                if (blocked) b("unblock_player") else b("block_player"),
                tint = if (blocked) Color(0xFFFF6B6B) else Color.White,
                size = btn,
                onClick = onBlock
            )
            Spacer(modifier = Modifier.width(8.dp))
            when {
                isFriend -> Text(b("friend_label"), color = Color(0xFF7BE08D), fontSize = if (compact) 13.sp else 16.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.widthIn(min = if (compact) 56.dp else 88.dp), textAlign = TextAlign.Center)
                isSent -> Row(modifier = Modifier.widthIn(min = if (compact) 56.dp else 88.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Schedule, contentDescription = b("request_sent"), tint = TextDim, modifier = Modifier.size(if (compact) 22.dp else 28.dp))
                }
                compact -> SmallIconButton(Icons.Default.PersonAdd, b("add_friend"), size = btn, onClick = onAddFriend)
                else -> OutlinedButton(
                    onClick = onAddFriend,
                    modifier = Modifier.height(50.dp).widthIn(min = 140.dp),
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.5.dp, Color(0xFFD7D8DE)),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp)
                ) {
                    Text(b("add_friend"), color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Medium, maxLines = 1)
                }
            }
        }
    }
}

@Composable
private fun TabButton(icon: ImageVector, label: String, selected: Boolean, compact: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier = modifier.fillMaxHeight().clickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
            Icon(icon, contentDescription = null, tint = if (selected) Color.White else TextDim, modifier = Modifier.size(if (compact) 20.dp else 26.dp))
            Spacer(modifier = Modifier.width(6.dp))
            Text(label, color = if (selected) Color.White else TextDim, fontSize = if (compact) 13.sp else 18.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Box(modifier = Modifier.fillMaxWidth().height(2.dp).background(if (selected) Color.White else Color(0x22FFFFFF)))
    }
}

/**
 * Сама панель меню. Виклик: усередині Box гри, коли menuOpen = true. onClose — «Resume» і тап поза панеллю.
 * initialTab: 0 = People. Скарги/respawn/блок виконує контролер гри (сервер + JS), друзі — BloxAuth.
 */
@Composable
internal fun BoxScope.BloxRobloxMenu(lang: String, controller: BloxGameController, initialTab: Int, onClose: () -> Unit) {
    val context = LocalContext.current
    val b: (String) -> String = { key -> BloxStrings.get(key, lang) }
    val cfg = LocalConfiguration.current
    val compact = cfg.screenHeightDp < 460

    var tab by remember(initialTab) { mutableStateOf(initialTab) }
    var gridMode by remember { mutableStateOf(false) }
    var confirmLeave by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf("") }
    val blocked = remember { mutableStateListOf<Int>() }

    LaunchedEffect(Unit) { BloxAuth.refresh(context) }
    LaunchedEffect(notice) {
        if (notice.isNotEmpty()) {
            delay(2500)
            notice = ""
        }
    }

    // Затемнення за панеллю: тап поза панеллю закриває меню
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0x59000000))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                confirmLeave = false
                onClose()
            }
    )

    val topGap = if (compact) 66.dp else 84.dp
    Surface(
        shape = RoundedCornerShape(22.dp),
        color = PanelBg,
        modifier = Modifier
            .align(Alignment.TopCenter)
            .padding(top = topGap, bottom = if (compact) 6.dp else 12.dp)
            .fillMaxWidth(if (compact) 0.88f else 0.74f)
            .widthIn(max = 860.dp)
            .fillMaxHeight()
            .pointerInput(Unit) { detectTapGestures { } }
    ) {
        Column(modifier = Modifier.fillMaxSize().padding(horizontal = if (compact) 10.dp else 16.dp, vertical = if (compact) 6.dp else 10.dp)) {
            // Вкладки
            Row(modifier = Modifier.fillMaxWidth().height(if (compact) 38.dp else 54.dp)) {
                TabButton(Icons.Default.People, b("tab_people"), tab == 0, compact, Modifier.weight(1f)) { tab = 0 }
                TabButton(Icons.Default.Settings, b("tab_settings"), tab == 1, compact, Modifier.weight(1f)) { tab = 1 }
                TabButton(Icons.Default.Photo, b("tab_gallery"), tab == 2, compact, Modifier.weight(1f)) { tab = 2 }
                TabButton(Icons.Default.Flag, b("tab_report"), tab == 3, compact, Modifier.weight(1f)) { tab = 3 }
                TabButton(Icons.Default.Help, b("tab_help"), tab == 4, compact, Modifier.weight(1f)) { tab = 4 }
            }
            Spacer(modifier = Modifier.height(if (compact) 6.dp else 12.dp))

            Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                when (tab) {
                    0 -> Column(modifier = Modifier.fillMaxSize()) {
                        // Invite Friends: системне «поділитися» з нікнеймом
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(if (compact) 40.dp else 56.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(RowBg)
                                .clickable {
                                    val text = String.format(b("invite_text"), BloxAuth.nick)
                                    val send = Intent(Intent.ACTION_SEND).apply {
                                        type = "text/plain"
                                        putExtra(Intent.EXTRA_TEXT, text)
                                    }
                                    try {
                                        context.startActivity(Intent.createChooser(send, b("invite_friends")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                                    } catch (e: Exception) {
                                        notice = b("report_fail")
                                    }
                                }
                                .padding(horizontal = 14.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Default.PersonAdd, contentDescription = null, tint = Color.White, modifier = Modifier.size(if (compact) 20.dp else 26.dp))
                            Spacer(modifier = Modifier.width(12.dp))
                            Text(b("invite_friends"), color = Color.White, fontSize = if (compact) 14.sp else 18.sp, maxLines = 1)
                        }
                        Spacer(modifier = Modifier.height(if (compact) 6.dp else 12.dp))
                        // Заголовок і перемикач список / плитки
                        Row(modifier = Modifier.fillMaxWidth().height(if (compact) 34.dp else 48.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(b("in_server"), color = Color.White, fontSize = if (compact) 16.sp else 24.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                            }
                            Text(String.format(b("server_players"), BloxGame.players.size), color = TextDim, fontSize = if (compact) 11.sp else 14.sp, maxLines = 1)
                            Spacer(modifier = Modifier.width(10.dp))
                            Row(modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(Color(0xFF2B2C32)).padding(3.dp)) {
                                Box(
                                    modifier = Modifier.size(if (compact) 30.dp else 40.dp).clip(RoundedCornerShape(8.dp)).background(if (!gridMode) IconBg else Color.Transparent).clickable { gridMode = false },
                                    contentAlignment = Alignment.Center
                                ) { Icon(Icons.Default.ViewList, contentDescription = b("view_list"), tint = Color.White, modifier = Modifier.size(if (compact) 18.dp else 24.dp)) }
                                Box(
                                    modifier = Modifier.size(if (compact) 30.dp else 40.dp).clip(RoundedCornerShape(8.dp)).background(if (gridMode) IconBg else Color.Transparent).clickable { gridMode = true },
                                    contentAlignment = Alignment.Center
                                ) { Icon(Icons.Default.GridView, contentDescription = b("view_grid"), tint = Color.White, modifier = Modifier.size(if (compact) 18.dp else 24.dp)) }
                            }
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                        val actions = { p: BloxPlayerInfo ->
                            PlayerActions(
                                inspect = { controller.lookAtPlayer(p.id); onClose() },
                                report = {
                                    controller.reportPlayer(p.id) { ok -> notice = if (ok) b("report_sent") else b("report_fail") }
                                },
                                block = {
                                    if (blocked.contains(p.id)) blocked.remove(p.id) else blocked.add(p.id)
                                    controller.blockPlayer(p.id, blocked.contains(p.id))
                                },
                                add = {
                                    BloxAuth.addFriend(context, p.nick) { rel -> if (rel == null) notice = b("report_fail") }
                                }
                            )
                        }
                        if (!gridMode) {
                            LazyColumn(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(if (compact) 5.dp else 10.dp)) {
                                items(BloxGame.players, key = { it.id }) { p ->
                                    val a = actions(p)
                                    PlayerRow(lang, p, compact, blocked.contains(p.id), a.inspect, a.report, a.block, a.add)
                                }
                            }
                        } else {
                            LazyVerticalGrid(
                                columns = GridCells.Fixed(2),
                                modifier = Modifier.fillMaxSize(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalArrangement = Arrangement.spacedBy(if (compact) 5.dp else 10.dp)
                            ) {
                                gridItems(BloxGame.players, key = { it.id }) { p ->
                                    val a = actions(p)
                                    PlayerRow(lang, p, true, blocked.contains(p.id), a.inspect, a.report, a.block, a.add)
                                }
                            }
                        }
                    }
                    1 -> Column(modifier = Modifier.fillMaxSize()) {
                        Row(
                            modifier = Modifier.fillMaxWidth().heightIn(min = if (compact) 48.dp else 66.dp).clip(RoundedCornerShape(12.dp)).background(RowBg).padding(horizontal = 16.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(b("invert_camera"), color = Color.White, fontSize = if (compact) 15.sp else 19.sp, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Switch(
                                checked = BloxGame.invertCamera,
                                onCheckedChange = { controller.setInvertCamera(it) },
                                colors = SwitchDefaults.colors(checkedTrackColor = Color(0xFF34A853))
                            )
                        }
                    }
                    2 -> Column(modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                        Icon(Icons.Default.Photo, contentDescription = null, tint = TextDim, modifier = Modifier.size(if (compact) 34.dp else 52.dp))
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(b("gallery_empty"), color = TextDim, fontSize = if (compact) 14.sp else 18.sp, textAlign = TextAlign.Center)
                    }
                    3 -> Column(modifier = Modifier.fillMaxSize().padding(8.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Default.Flag, contentDescription = null, tint = TextDim, modifier = Modifier.size(if (compact) 30.dp else 44.dp))
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(b("report_hint"), color = Color.White, fontSize = if (compact) 14.sp else 18.sp, textAlign = TextAlign.Center)
                    }
                    else -> Column(modifier = Modifier.fillMaxSize().padding(8.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Default.Help, contentDescription = null, tint = TextDim, modifier = Modifier.size(if (compact) 30.dp else 44.dp))
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(b("help_text"), color = Color.White, fontSize = if (compact) 14.sp else 18.sp, textAlign = TextAlign.Center)
                    }
                }
                if (notice.isNotEmpty()) {
                    Surface(shape = RoundedCornerShape(12.dp), color = Color(0xF0000000), modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 6.dp)) {
                        Text(notice, color = Color.White, fontSize = 14.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                    }
                }
            }

            Spacer(modifier = Modifier.height(if (compact) 6.dp else 12.dp))
            // Нижній ряд: Leave / Respawn / Resume (Leave питає підтвердження тут же)
            val bh = if (compact) 44.dp else 62.dp
            if (!confirmLeave) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Button(
                        onClick = { confirmLeave = true },
                        modifier = Modifier.weight(1f).height(bh),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = ButtonBg, contentColor = Color.White)
                    ) { Text(b("leave"), fontSize = if (compact) 15.sp else 20.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    Button(
                        onClick = {
                            controller.respawn { ok ->
                                if (ok) onClose() else notice = b("respawn_fail")
                            }
                        },
                        modifier = Modifier.weight(1f).height(bh),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = ButtonBg, contentColor = Color.White)
                    ) { Text(b("respawn"), fontSize = if (compact) 15.sp else 20.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    Button(
                        onClick = onClose,
                        modifier = Modifier.weight(1f).height(bh).border(BorderStroke(3.dp, Color.White), RoundedCornerShape(14.dp)),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = ResumeBlue, contentColor = Color.White)
                    ) { Text(b("resume"), fontSize = if (compact) 15.sp else 20.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
            } else {
                Text(b("leave_text"), color = Color.White, fontSize = if (compact) 14.sp else 18.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                Spacer(modifier = Modifier.height(6.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(
                        onClick = { confirmLeave = false },
                        modifier = Modifier.weight(1f).height(bh),
                        shape = RoundedCornerShape(12.dp)
                    ) { Text(b("no"), color = Color.White, fontSize = if (compact) 15.sp else 18.sp, fontWeight = FontWeight.SemiBold, maxLines = 1) }
                    Button(
                        onClick = {
                            confirmLeave = false
                            onClose()
                            controller.exitGame(true)
                        },
                        modifier = Modifier.weight(1f).height(bh),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD93025))
                    ) { Text(b("yes"), fontSize = if (compact) 15.sp else 18.sp, fontWeight = FontWeight.SemiBold, maxLines = 1) }
                }
            }
        }
    }
}

private class PlayerActions(val inspect: () -> Unit, val report: () -> Unit, val block: () -> Unit, val add: () -> Unit)
