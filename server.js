const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const db = new sqlite3.Database('./chat.db', (err) => {
    if (err) console.error('Помилка БД:', err.message);
    else console.log('Успішно підключено до бази SQLite (chat.db).');
});

db.serialize(() => {
    // Таблиця профілів користувачів
    db.run(`CREATE TABLE IF NOT EXISTS users (
        email TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        avatar_url TEXT
    )`);

    // Таблиця взаємних контактів
    db.run(`CREATE TABLE IF NOT EXISTS contacts (
        owner_email TEXT NOT NULL,
        contact_email TEXT NOT NULL,
        PRIMARY KEY (owner_email, contact_email)
    )`);

    // Таблиця повідомлень
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        sender_email TEXT NOT NULL,
        receiver_email TEXT NOT NULL,
        text TEXT NOT NULL,
        timestamp INTEGER NOT NULL
    )`);
});

io.on('connection', (socket) => {

    // 1. Збереження або оновлення ім'я та аватарки
    socket.on('register_or_update_user', (data) => {
        const { email, name, avatarUrl } = data;
        if (!email) return;
        const cleanEmail = email.trim().toLowerCase();
        const cleanName = name || cleanEmail.split('@')[0];

        db.run(
            `INSERT INTO users (email, name, avatar_url) VALUES (?, ?, ?)
             ON CONFLICT(email) DO UPDATE SET name = excluded.name, avatar_url = COALESCE(excluded.avatar_url, users.avatar_url)`,
            [cleanEmail, cleanName, avatarUrl || null]
        );
    });

    // 2. Отримання профілю за email
    socket.on('get_user_profile', (email, callback) => {
        if (!email) return callback?.(null);
        const cleanEmail = email.trim().toLowerCase();
        db.get("SELECT email, name, avatar_url as avatarUrl FROM users WHERE email = ?", [cleanEmail], (err, row) => {
            if (err || !row) callback?.(null);
            else callback?.(row);
        });
    });

    // 3. Додавання контакту (з перевіркою існування на Render)
    socket.on('add_contact', (data, callback) => {
        const { myEmail, targetEmail } = data;
        const cleanMy = (myEmail || '').trim().toLowerCase();
        const cleanTarget = (targetEmail || '').trim().toLowerCase();

        if (!cleanTarget || cleanMy === cleanTarget) {
            return callback?.({ success: false, message: "Некоректна адреса або спроба додати себе!" });
        }

        // Перевіряємо, чи зареєстрований такий email на Render
        db.get("SELECT email, name, avatar_url as avatarUrl FROM users WHERE email = ?", [cleanTarget], (err, targetUser) => {
            if (err || !targetUser) {
                return callback?.({ success: false, message: `Користувача з адресою ${cleanTarget} не знайдено!` });
            }

            // Взаємне додавання в контакти
            const stmt = db.prepare("INSERT OR IGNORE INTO contacts (owner_email, contact_email) VALUES (?, ?)");
            stmt.run(cleanMy, cleanTarget);
            stmt.run(cleanTarget, cleanMy);
            stmt.finalize(() => {
                callback?.({ success: true, user: targetUser, message: "Контакт успішно додано!" });
            });
        });
    });

    // 4. Отримання списку контактів
    socket.on('get_contacts', (myEmail, callback) => {
        if (!myEmail) return callback?.([]);
        const cleanEmail = myEmail.trim().toLowerCase();
        const query = `
            SELECT u.email, u.name, u.avatar_url as avatarUrl 
            FROM contacts c
            JOIN users u ON c.contact_email = u.email
            WHERE c.owner_email = ?
        `;
        db.all(query, [cleanEmail], (err, rows) => {
            if (err) callback?.([]);
            else callback?.(rows || []);
        });
    });

    // 5. Робота з чатами
    socket.on('join_chat', (data) => {
        const chatId = typeof data === 'string' ? data : data.chatId;
        socket.join(chatId);

        db.all(
            "SELECT id, chat_id as chatId, sender_email as senderEmail, receiver_email as receiverEmail, text, timestamp FROM messages WHERE chat_id = ? ORDER BY timestamp ASC",
            [chatId],
            (err, rows) => {
                if (!err) socket.emit('load_history', rows || []);
            }
        );
    });

    socket.on('leave_chat', (chatId) => {
        socket.leave(chatId);
    });

    socket.on('send_message', (data) => {
        const { id, chatId, senderEmail, receiverEmail, text, timestamp } = data;
        const msgId = id || Date.now().toString();
        const msgTimestamp = timestamp || Date.now();

        db.run(
            "INSERT INTO messages (id, chat_id, sender_email, receiver_email, text, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
            [msgId, chatId, senderEmail, receiverEmail, text, msgTimestamp],
            (err) => {
                if (err) return;
                const newMessage = { id: msgId, chatId, senderEmail, receiverEmail, text, timestamp: msgTimestamp };
                io.to(chatId).emit('receive_message', newMessage);
            }
        );
    });

    socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер працює на порту ${PORT}`));
