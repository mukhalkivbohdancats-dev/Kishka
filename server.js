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
    },
    maxHttpBufferSize: 1e7
});

// Додано кореневий маршрут для підтримання активності (keep-alive) на Render
app.get('/', (req, res) => {
    res.send('Kishka Messenger Server is active and running!');
});

const busyUsers = new Set();
const userSockets = new Map();

const db = new sqlite3.Database('./chat.db', (err) => {
    if (err) {
        console.error('Помилка бази даних:', err.message);
    } else {
        console.log('Успішно підключено до бази SQLite (chat.db).');
    }
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        email TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        avatar_url TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS contacts (
        owner_email TEXT NOT NULL,
        contact_email TEXT NOT NULL,
        PRIMARY KEY (owner_email, contact_email)
    )`);

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
    console.log('Клієнт підключився:', socket.id);

    socket.on('register_or_update_user', (data) => {
        const { email, name, avatarUrl } = data || {};
        if (!email || typeof email !== 'string') return;
        const cleanEmail = email.trim().toLowerCase();
        socket.userEmail = cleanEmail;
        userSockets.set(cleanEmail, socket.id);
        socket.join(cleanEmail);

        const cleanName = name || cleanEmail.split('@')[0];

        db.run(
            `INSERT INTO users (email, name, avatar_url) VALUES (?, ?, ?)
             ON CONFLICT(email) DO UPDATE SET name = excluded.name, avatar_url = COALESCE(excluded.avatar_url, users.avatar_url)`,
            [cleanEmail, cleanName, avatarUrl || null],
            (err) => {
                if (err) console.error('Помилка збереження профілю:', err.message);
            }
        );
    });

    socket.on('get_user_profile', (email, callback) => {
        const safeCallback = typeof callback === 'function' ? callback : () => {};
        if (!email || typeof email !== 'string') return safeCallback(null);
        
        const cleanEmail = email.trim().toLowerCase();
        socket.userEmail = cleanEmail;
        userSockets.set(cleanEmail, socket.id);
        socket.join(cleanEmail);
        
        db.get("SELECT email, name, avatar_url as avatarUrl FROM users WHERE email = ?", [cleanEmail], (err, row) => {
            if (err) return safeCallback(null);
            if (row) {
                safeCallback(row);
            } else {
                const defaultName = cleanEmail.split('@')[0];
                db.run("INSERT OR IGNORE INTO users (email, name, avatar_url) VALUES (?, ?, NULL)", [cleanEmail, defaultName], () => {
                    safeCallback({ email: cleanEmail, name: defaultName, avatarUrl: null });
                });
            }
        });
    });

    socket.on('add_contact', (data, callback) => {
        const safeCallback = typeof callback === 'function' ? callback : () => {};
        const { myEmail, targetEmail } = data || {};
        const cleanMy = (typeof myEmail === 'string' ? myEmail : '').trim().toLowerCase();
        const cleanTarget = (typeof targetEmail === 'string' ? targetEmail : '').trim().toLowerCase();

        if (cleanMy) {
            socket.userEmail = cleanMy;
            userSockets.set(cleanMy, socket.id);
            socket.join(cleanMy);
        }

        if (!cleanTarget || !cleanTarget.includes('@') || cleanMy === cleanTarget) {
            return safeCallback({ success: false, message: "Некоректна адреса або спроба додати самі себе!" });
        }

        db.get("SELECT email, name, avatar_url as avatarUrl FROM users WHERE email = ?", [cleanTarget], (err, targetUser) => {
            let finalUser = targetUser;

            const processAddContact = (userObj) => {
                const stmt = db.prepare("INSERT OR IGNORE INTO contacts (owner_email, contact_email) VALUES (?, ?)");
                stmt.run(cleanMy, cleanTarget);
                stmt.run(cleanTarget, cleanMy);
                stmt.finalize(() => {
                    io.to(cleanMy).emit('contact_updated');
                    io.to(cleanTarget).emit('contact_updated');

                    safeCallback({ success: true, user: userObj, message: "Контакт успішно додано!" });
                });
            };

            if (!finalUser) {
                const defaultName = cleanTarget.split('@')[0];
                db.run("INSERT OR IGNORE INTO users (email, name, avatar_url) VALUES (?, ?, NULL)", [cleanTarget, defaultName], () => {
                    finalUser = { email: cleanTarget, name: defaultName, avatarUrl: null };
                    processAddContact(finalUser);
                });
            } else {
                processAddContact(finalUser);
            }
        });
    });

    socket.on('get_contacts', (myEmail, callback) => {
        const safeCallback = typeof callback === 'function' ? callback : () => {};
        if (!myEmail || typeof myEmail !== 'string') return safeCallback([]);
        const cleanEmail = myEmail.trim().toLowerCase();
        socket.userEmail = cleanEmail;
        userSockets.set(cleanEmail, socket.id);
        socket.join(cleanEmail);

        const query = `
            SELECT u.email, u.name, u.avatar_url as avatarUrl 
            FROM contacts c
            JOIN users u ON c.contact_email = u.email
            WHERE c.owner_email = ?
        `;
        db.all(query, [cleanEmail], (err, rows) => {
            if (err) safeCallback([]);
            else safeCallback(rows || []);
        });
    });

    socket.on('join_chat', (data) => {
        const chatId = typeof data === 'string' ? data : (data ? data.chatId : null);
        if (!chatId) return;
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
        if (chatId) socket.leave(chatId);
    });

    socket.on('send_message', (data) => {
        const { id, chatId, senderEmail, receiverEmail, text, timestamp } = data || {};
        if (!chatId || !text) return;
        const msgId = id || Date.now().toString();
        const msgTimestamp = timestamp || Date.now();

        db.run(
            "INSERT INTO messages (id, chat_id, sender_email, receiver_email, text, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
            [msgId, chatId, senderEmail, receiverEmail, text, msgTimestamp],
            (err) => {
                if (err) return;
                const newMessage = { id: msgId, chatId, senderEmail, receiverEmail, text, timestamp: msgTimestamp };
                
                io.to(chatId).emit('receive_message', newMessage);
                if (receiverEmail) {
                    io.to(receiverEmail.trim().toLowerCase()).emit('receive_message', newMessage);
                }
            }
        );
    });

    socket.on('delete_message', (data) => {
        const { messageId, chatId } = data || {};
        if (!messageId || !chatId) return;

        db.run("DELETE FROM messages WHERE id = ?", [messageId], (err) => {
            if (!err) {
                io.to(chatId).emit('message_deleted', messageId);
            }
        });
    });

    socket.on('start_call', (data) => {
        const { callerEmail, receiverEmail } = data || {};
        if (!callerEmail || !receiverEmail) return;

        const cleanCaller = callerEmail.trim().toLowerCase();
        const cleanReceiver = receiverEmail.trim().toLowerCase();

        socket.userEmail = cleanCaller;
        userSockets.set(cleanCaller, socket.id);
        socket.join(cleanCaller);

        if (busyUsers.has(cleanReceiver) || busyUsers.has(cleanCaller)) {
            const callerSocketId = userSockets.get(cleanCaller);
            if (callerSocketId) {
                io.to(callerSocketId).emit(`call_busy_${cleanCaller}`, { callerEmail: cleanCaller, receiverEmail: cleanReceiver });
            }
            return;
        }

        busyUsers.add(cleanCaller);
        busyUsers.add(cleanReceiver);
        socket.myCallEmails = [cleanCaller, cleanReceiver];

        const receiverSocketId = userSockets.get(cleanReceiver);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit(`incoming_call_${cleanReceiver}`, { callerEmail: cleanCaller, receiverEmail: cleanReceiver });
        } else {
            io.to(cleanReceiver).emit(`incoming_call_${cleanReceiver}`, { callerEmail: cleanCaller, receiverEmail: cleanReceiver });
            
            const callerSocketId = userSockets.get(cleanCaller);
            if (callerSocketId) {
                io.to(callerSocketId).emit(`call_busy_${cleanCaller}`, { callerEmail: cleanCaller, receiverEmail: cleanReceiver });
            }
            busyUsers.delete(cleanCaller);
            busyUsers.delete(cleanReceiver);
        }
    });

    socket.on('answer_call', (data) => {
        const { callerEmail, receiverEmail } = data || {};
        if (!callerEmail) return;
        const cleanCaller = callerEmail.trim().toLowerCase();
        const cleanReceiver = (receiverEmail || '').trim().toLowerCase();

        if (cleanCaller) busyUsers.add(cleanCaller);
        if (cleanReceiver) busyUsers.add(cleanReceiver);

        const callerSocketId = userSockets.get(cleanCaller);
        if (callerSocketId) {
            io.to(callerSocketId).emit(`call_answered_${cleanCaller}`, { callerEmail, receiverEmail });
        }
        io.to(cleanCaller).emit(`call_answered_${cleanCaller}`, { callerEmail, receiverEmail });
    });

    socket.on('reject_call', (data) => {
        const { callerEmail, receiverEmail } = data || {};
        const cleanCaller = (callerEmail || '').trim().toLowerCase();
        const cleanReceiver = (receiverEmail || '').trim().toLowerCase();

        if (cleanCaller) busyUsers.delete(cleanCaller);
        if (cleanReceiver) busyUsers.delete(cleanReceiver);

        const callerSocketId = userSockets.get(cleanCaller);
        if (callerSocketId) {
            io.to(callerSocketId).emit(`call_rejected_${cleanCaller}`, { callerEmail, receiverEmail });
        }
        io.to(cleanCaller).emit(`call_rejected_${cleanCaller}`, { callerEmail, receiverEmail });
    });

    socket.on('end_call', (data) => {
        const { callerEmail, receiverEmail } = data || {};
        const cleanCaller = (callerEmail || '').trim().toLowerCase();
        const cleanReceiver = (receiverEmail || '').trim().toLowerCase();

        if (cleanCaller) {
            busyUsers.delete(cleanCaller);
            const sId = userSockets.get(cleanCaller);
            if (sId) io.to(sId).emit(`call_ended_${cleanCaller}`, {});
            io.to(cleanCaller).emit(`call_ended_${cleanCaller}`, {});
        }
        if (cleanReceiver) {
            busyUsers.delete(cleanReceiver);
            const sId = userSockets.get(cleanReceiver);
            if (sId) io.to(sId).emit(`call_ended_${cleanReceiver}`, {});
            io.to(cleanReceiver).emit(`call_ended_${cleanReceiver}`, {});
        }
    });

    socket.on('voice_chunk', (data) => {
        const { targetEmail, chunk } = data || {};
        if (!targetEmail || !chunk) return;
        const cleanTarget = targetEmail.trim().toLowerCase();
        io.to(cleanTarget).emit(`voice_chunk_${cleanTarget}`, chunk);
    });

    socket.on('disconnect', () => {
        if (socket.userEmail) {
            userSockets.delete(socket.userEmail);
        }
        if (socket.myCallEmails) {
            socket.myCallEmails.forEach(email => busyUsers.delete(email));
        }
        console.log('Клієнт відключився');
    });
});

// =====================================================================
// ===== GEMINI (ДОДАНО): окрема пам'ять ШІ для кожного користувача =====
// Існуючі події (повідомлення, контакти, дзвінки) НЕ змінені.
// Потрібна змінна середовища GEMINI_API_KEY (Render -> Environment).
// Необов'язково: GEMINI_MODEL (за замовчуванням gemini-2.5-flash).
// =====================================================================
const https = require('https');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_CONTEXT_LIMIT = 40;      // скільки останніх повідомлень памʼяті йде в запит до Gemini
const GEMINI_HISTORY_LIMIT = 500;     // скільки повідомлень віддаємо в застосунок при відкритті вкладки
const GEMINI_MAX_TEXT = 8000;
const geminiBusy = new Set();

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS gemini_messages (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        timestamp INTEGER NOT NULL
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_gemini_email_time ON gemini_messages (email, timestamp)`);
});

function geminiDbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err); else resolve(this);
        });
    });
}

function geminiDbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err); else resolve(rows || []);
        });
    });
}

function callGemini(contents, systemText) {
    return new Promise((resolve, reject) => {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return reject(new Error('NO_KEY'));

        const body = JSON.stringify({
            systemInstruction: { parts: [{ text: systemText }] },
            contents: contents
        });

        const req = https.request({
            hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'x-goog-api-key': apiKey
            },
            timeout: 60000
        }, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                let json;
                try { json = JSON.parse(data); } catch (e) { return reject(new Error('BAD_RESPONSE')); }

                if (res.statusCode !== 200) {
                    const msg = (json && json.error && json.error.message) ? json.error.message : ('HTTP ' + res.statusCode);
                    return reject(new Error(msg));
                }

                const candidate = json.candidates && json.candidates[0];
                const parts = candidate && candidate.content && candidate.content.parts;
                const text = parts ? parts.filter(p => !p.thought).map(p => p.text || '').join('') : '';
                if (!text.trim()) return reject(new Error('EMPTY'));
                resolve(text);
            });
        });

        req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function geminiErrorText(err) {
    const m = err && err.message ? err.message : '';
    if (m === 'NO_KEY') return 'На сервері не налаштований GEMINI_API_KEY';
    if (m === 'TIMEOUT') return 'Gemini не відповів вчасно. Спробуйте ще раз';
    if (m === 'EMPTY') return 'Gemini не зміг відповісти на це повідомлення';
    if (m === 'BAD_RESPONSE') return 'Некоректна відповідь від Gemini';
    return 'Помилка Gemini: ' + (m || 'невідома');
}

function geminiCleanEmail(email) {
    return (typeof email === 'string' ? email : '').trim().toLowerCase();
}

io.on('connection', (socket) => {

    // Історія (памʼять) Gemini конкретного користувача
    socket.on('gemini_get_history', async (email, callback) => {
        const cb = typeof callback === 'function' ? callback : () => {};
        const cleanEmail = geminiCleanEmail(email);
        if (!cleanEmail) return cb({ success: false, messages: [] });
        try {
            const rows = await geminiDbAll(
                `SELECT id, role, text, timestamp FROM (
                    SELECT id, role, text, timestamp FROM gemini_messages
                    WHERE email = ? ORDER BY timestamp DESC LIMIT ?
                 ) ORDER BY timestamp ASC`,
                [cleanEmail, GEMINI_HISTORY_LIMIT]
            );
            cb({ success: true, messages: rows });
        } catch (err) {
            console.error('Gemini history error:', err.message);
            cb({ success: false, messages: [] });
        }
    });

    // Нове повідомлення до Gemini (з урахуванням памʼяті цього користувача)
    socket.on('gemini_send', async (data, callback) => {
        const cb = typeof callback === 'function' ? callback : () => {};
        const { email, name, text } = data || {};
        const cleanEmail = geminiCleanEmail(email);
        const cleanText = (typeof text === 'string' ? text : '').trim();

        if (!cleanEmail || !cleanText) return cb({ success: false, error: 'Порожнє повідомлення' });
        if (cleanText.length > GEMINI_MAX_TEXT) return cb({ success: false, error: 'Повідомлення занадто довге' });
        if (geminiBusy.has(cleanEmail)) return cb({ success: false, error: 'Gemini ще відповідає на попереднє повідомлення' });

        geminiBusy.add(cleanEmail);

        const now = Date.now();
        const userMsgId = `g_${now}_${Math.random().toString(36).slice(2, 8)}`;

        try {
            await geminiDbRun(
                "INSERT INTO gemini_messages (id, email, role, text, timestamp) VALUES (?, ?, 'user', ?, ?)",
                [userMsgId, cleanEmail, cleanText, now]
            );

            const rows = await geminiDbAll(
                "SELECT role, text FROM gemini_messages WHERE email = ? ORDER BY timestamp DESC, rowid DESC LIMIT ?",
                [cleanEmail, GEMINI_CONTEXT_LIMIT]
            );
            rows.reverse();
            while (rows.length > 0 && rows[0].role !== 'user') rows.shift();

            const contents = rows.map(r => ({ role: r.role, parts: [{ text: r.text }] }));

            const safeName = (typeof name === 'string' ? name : '').trim().slice(0, 60);
            const systemText =
                'Ти — Gemini, штучний інтелект усередині месенджера Kishka. ' +
                'Відповідай тією мовою, якою пише користувач. Пиши чітко, доброзичливо і по суті. ' +
                'Ти памʼятаєш попередні повідомлення цієї розмови з цим користувачем.' +
                (safeName ? ` Користувача звати ${safeName}.` : '');

            const replyText = await callGemini(contents, systemText);

            const reply = {
                id: `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                role: 'model',
                text: replyText,
                timestamp: Date.now()
            };
            await geminiDbRun(
                "INSERT INTO gemini_messages (id, email, role, text, timestamp) VALUES (?, ?, 'model', ?, ?)",
                [reply.id, cleanEmail, reply.text, reply.timestamp]
            );

            cb({ success: true, reply });
        } catch (err) {
            console.error('Gemini send error:', err.message);
            // Відкочуємо повідомлення користувача, щоб памʼять не мала "висячих" питань без відповіді
            try { await geminiDbRun("DELETE FROM gemini_messages WHERE id = ?", [userMsgId]); } catch (e) {}
            cb({ success: false, error: geminiErrorText(err) });
        } finally {
            geminiBusy.delete(cleanEmail);
        }
    });

    // Очищення памʼяті Gemini (тільки для цього користувача)
    socket.on('gemini_clear', async (email, callback) => {
        const cb = typeof callback === 'function' ? callback : () => {};
        const cleanEmail = geminiCleanEmail(email);
        if (!cleanEmail) return cb({ success: false });
        try {
            await geminiDbRun("DELETE FROM gemini_messages WHERE email = ?", [cleanEmail]);
            cb({ success: true });
        } catch (err) {
            console.error('Gemini clear error:', err.message);
            cb({ success: false });
        }
    });
});
// ===================== КІНЕЦЬ БЛОКУ GEMINI =====================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер працює на порту ${PORT}`);
});
