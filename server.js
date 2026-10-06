const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Підключення до локальної бази SQLite
const db = new sqlite3.Database('./chat.db', (err) => {
    if (err) {
        console.error('Помилка бази даних:', err.message);
    } else {
        console.log('Успішно підключено до бази SQLite (chat.db).');
    }
});

// Таблиця для збереження повідомлень
db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    sender_email TEXT NOT NULL,
    receiver_email TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp INTEGER NOT NULL
)`);

io.on('connection', (socket) => {
    console.log('Користувач підключився:', socket.id);

    // Вхід у кімнату чату
    socket.on('join_chat', (data) => {
        const chatId = typeof data === 'string' ? data : data.chatId;
        socket.join(chatId);

        // Завантаження історії цього чату з SQLite
        db.all(
            "SELECT id, chat_id as chatId, sender_email as senderEmail, receiver_email as receiverEmail, text, timestamp FROM messages WHERE chat_id = ? ORDER BY timestamp ASC",
            [chatId],
            (err, rows) => {
                if (!err) {
                    socket.emit('load_history', rows || []);
                }
            }
        );
    });

    // Вихід з кімнати
    socket.on('leave_chat', (chatId) => {
        socket.leave(chatId);
    });

    // Відправка та збереження повідомлення
    socket.on('send_message', (data) => {
        const { chatId, senderEmail, receiverEmail, text, timestamp } = data;
        const msgTimestamp = timestamp || Date.now();

        const stmt = db.prepare("INSERT INTO messages (chat_id, sender_email, receiver_email, text, timestamp) VALUES (?, ?, ?, ?, ?)");
        stmt.run(chatId, senderEmail, receiverEmail, text, msgTimestamp, function (err) {
            if (err) return;

            const newMessage = {
                id: this.lastID.toString(),
                chatId,
                senderEmail,
                receiverEmail,
                text,
                timestamp: msgTimestamp
            };

            // Розсилка тільки учасникам цієї кімнати
            io.to(chatId).emit('receive_message', newMessage);
        });
        stmt.finalize();
    });

    socket.on('disconnect', () => {
        console.log('Користувач відключився');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер чату працює на порту ${PORT}`);
});
