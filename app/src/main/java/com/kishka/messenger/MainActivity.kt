package com.kishka.messenger

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

data class Message(val sender: String, val text: String, val mediaUrl: String? = null)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                KishkaApp()
            }
        }
    }
}

@Composable
fun KishkaApp() {
    var isLoggedIn by remember { mutableStateOf(false) }
    var phoneNumber by remember { mutableStateOf("") }

    if (!isLoggedIn) {
        AuthScreen(
            phoneNumber = phoneNumber,
            onPhoneChange = { phoneNumber = it },
            onLoginSuccess = { isLoggedIn = true }
        )
    } else {
        GlobalChatScreen(userPhone = phoneNumber)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuthScreen(
    phoneNumber: String,
    onPhoneChange: (String) -> Unit,
    onLoginSuccess: () -> Unit
) {
    var codeSent by remember { mutableStateOf(false) }
    var inputCode by remember { mutableStateOf("") }
    var generatedCode by remember { mutableStateOf("1234") }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text(stringResource(R.string.app_name)) })
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            if (!codeSent) {
                Text(text = stringResource(R.string.enter_phone), fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = phoneNumber,
                    onValueChange = onPhoneChange,
                    label = { Text("+380...") },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(16.dp))
                Button(
                    onClick = {
                        if (phoneNumber.isNotBlank()) {
                            codeSent = true
                        }
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(stringResource(R.string.send_code))
                }
            } else {
                Text(text = stringResource(R.string.enter_code), fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(8.dp))
                Text(text = "Код надіслано на ваш Viber", fontSize = 14.sp, color = Color.Gray)
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = inputCode,
                    onValueChange = { inputCode = it },
                    label = { Text("Код з Viber") },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(16.dp))
                Button(
                    onClick = {
                        if (inputCode.isNotBlank()) {
                            onLoginSuccess()
                        }
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(stringResource(R.string.verify))
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GlobalChatScreen(userPhone: String) {
    var messageText by remember { mutableStateOf("") }
    val messages = remember {
        mutableStateListOf(
            Message("Система", "Ласкаво просимо до Кішка Месенджер! Всі користувачі бачать цей чат."),
            Message("+380000000000", "Привіт всім!")
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text(stringResource(R.string.chat_title)) })
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(8.dp),
                reverseLayout = false
            ) {
                items(messages) { msg ->
                    MessageBubble(message = msg, isMe = msg.sender == userPhone)
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = {
                    messages.add(Message(userPhone, "📷 [Медіа файл]", mediaUrl = "file"))
                }) {
                    Text("📎")
                }
                OutlinedTextField(
                    value = messageText,
                    onValueChange = { messageText = it },
                    placeholder = { Text(stringResource(R.string.type_message)) },
                    modifier = Modifier.weight(1f)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Button(onClick = {
                    if (messageText.isNotBlank()) {
                        messages.add(Message(userPhone, messageText))
                        messageText = ""
                    }
                }) {
                    Text(stringResource(R.string.send))
                }
            }
        }
    }
}

@Composable
fun MessageBubble(message: Message, isMe: Boolean) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalAlignment = if (isMe) Alignment.End else Alignment.Start
    ) {
        Text(text = message.sender, fontSize = 11.sp, color = Color.Gray)
        Card(
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(
                containerColor = if (isMe) Color(0xFFDCF8C6) else Color(0xFFEFEFEF)
            )
        ) {
            Column(modifier = Modifier.padding(10.dp)) {
                Text(text = message.text, color = Color.Black)
            }
        }
    }
}
