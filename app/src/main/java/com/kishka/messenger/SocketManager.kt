package com.kishka.messenger

import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONArray
import org.json.JSONObject
import java.net.URISyntaxException

object SocketManager {
    // Вкажіть публічну IP-адресу або домен вашого Node.js сервера
    private const val SERVER_URL = "http://YOUR_NODEJS_SERVER_IP:3000"

    private var socket: Socket? = null

    fun connect() {
        if (socket == null) {
            try {
                val opts = IO.Options().apply {
                    forceNew = true
                    reconnection = true
                }
                socket = IO.socket(SERVER_URL, opts)
                socket?.connect()
            } catch (e: URISyntaxException) {
                e.printStackTrace()
            }
        } else if (socket?.connected() == false) {
            socket?.connect()
        }
    }

    fun disconnect() {
        socket?.disconnect()
        socket = null
    }

    fun joinChat(chatId: String, onHistoryLoaded: (List<Message>) -> Unit) {
        connect()
        socket?.emit("join_chat", chatId)

        socket?.off("load_history")
        socket?.on("load_history") { args ->
            if (args.isNotEmpty()) {
                val jsonArray = args[0] as? JSONArray
                val messagesList = mutableListOf<Message>()
                if (jsonArray != null) {
                    for (i in 0 until jsonArray.length()) {
                        val obj = jsonArray.getJSONObject(i)
                        val msg = Message(
                            id = obj.optString("id", i.toString()),
                            senderEmail = obj.optString("sender_name"),
                            receiverEmail = "",
                            text = obj.optString("text"),
                            timestamp = System.currentTimeMillis()
                        )
                        messagesList.add(msg)
                    }
                }
                onHistoryLoaded(messagesList)
            }
        }
    }

    fun sendMessage(chatId: String, senderName: String, text: String) {
        val json = JSONObject().apply {
            put("chatId", chatId)
            put("senderName", senderName)
            put("text", text)
        }
        socket?.emit("send_message", json)
    }

    fun listenForNewMessages(onNewMessage: (Message) -> Unit) {
        socket?.off("receive_message")
        socket?.on("receive_message") { args ->
            if (args.isNotEmpty()) {
                val data = args[0] as? JSONObject
                if (data != null) {
                    val msg = Message(
                        id = System.currentTimeMillis().toString(),
                        senderEmail = data.optString("sender_name"),
                        receiverEmail = "",
                        text = data.optString("text"),
                        timestamp = System.currentTimeMillis()
                    )
                    onNewMessage(msg)
                }
            }
        }
    }
}
