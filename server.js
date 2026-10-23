const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

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

    // Міграції для медіа-повідомлень (помилку "duplicate column" ігноруємо)
    db.run("ALTER TABLE messages ADD COLUMN file_url TEXT", () => {});
    db.run("ALTER TABLE messages ADD COLUMN file_type TEXT", () => {});
    db.run("ALTER TABLE messages ADD COLUMN thumb_url TEXT", () => {});
    db.run("ALTER TABLE messages ADD COLUMN file_name TEXT", () => {});

    // Токени push-сповіщень (FCM) для доставки повідомлень, коли застосунок закритий
    db.run(`CREATE TABLE IF NOT EXISTS push_tokens (
        email TEXT NOT NULL,
        token TEXT NOT NULL,
        updated INTEGER NOT NULL,
        PRIMARY KEY (email, token)
    )`);

    // Файли (фото/відео), завантажені користувачами
    db.run(`CREATE TABLE IF NOT EXISTS media_files (
        id TEXT PRIMARY KEY,
        email TEXT,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        created INTEGER NOT NULL,
        name TEXT
    )`);
    // Для баз, створених раніше без колонки name (помилку "duplicate column" ігноруємо)
    db.run("ALTER TABLE media_files ADD COLUMN name TEXT", () => {});
});

// ===================== ФАЙЛИ: фото та відео =====================
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { console.error('UPLOAD_DIR:', e.message); }
const MAX_UPLOAD_BYTES = (parseInt(process.env.MAX_UPLOAD_MB || '250', 10) || 250) * 1024 * 1024;

function cleanFileName(raw) {
    let name = String(raw || '').replace(/[\\/\u0000-\u001f\u007f<>:"|?*]/g, '_').trim();
    if (name.length > 150) name = name.slice(0, 150);
    return name || null;
}

// Завантаження: POST /upload?mime=image/jpeg&name=photo.jpg  (тіло запиту = байти файлу)
app.post('/upload', (req, res) => {
    const mime = String(req.query.mime || req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+*-]*$/.test(mime)) {
        req.resume();
        return res.status(415).json({ success: false, error: 'Unsupported file type' });
    }
    const fileName = cleanFileName(req.query.name);
    const declared = parseInt(req.headers['content-length'] || '0', 10);
    if (declared > MAX_UPLOAD_BYTES) {
        req.resume();
        return res.status(413).json({ success: false, error: 'File too large' });
    }

    const id = crypto.randomBytes(16).toString('hex');
    const filePath = path.join(UPLOAD_DIR, id);
    const out = fs.createWriteStream(filePath);
    let size = 0;
    let failed = false;

    const fail = (status, message) => {
        if (failed) return;
        failed = true;
        try { out.destroy(); } catch (e) {}
        fs.unlink(filePath, () => {});
        if (!res.headersSent) res.status(status).json({ success: false, error: message });
        try { req.unpipe(out); req.resume(); } catch (e) {}
    };

    req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_UPLOAD_BYTES) fail(413, 'File too large');
    });
    req.on('close', () => {
        if (!req.complete) fail(499, 'Upload interrupted');
    });
    out.on('error', () => fail(500, 'File write error'));
    out.on('finish', () => {
        if (failed) return;
        const email = String(req.headers['x-kishka-email'] || '').trim().toLowerCase() || null;
        db.run(
            "INSERT INTO media_files (id, email, mime, size, created, name) VALUES (?, ?, ?, ?, ?, ?)",
            [id, email, mime, size, Date.now(), fileName],
            (err) => {
                if (err) return fail(500, 'Database error');
                res.json({ success: true, id, url: '/media/' + id, mime, size, name: fileName });
            }
        );
    });
    req.pipe(out);
});

// Віддача файлів (підтримує Range, тому відео можна гортати)
app.get('/media/:id', (req, res) => {
    const id = String(req.params.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
    db.get("SELECT mime, name FROM media_files WHERE id = ?", [id], (err, row) => {
        if (err || !row) return res.status(404).send('Not found');
        res.set('Content-Type', row.mime);
        res.set('X-Content-Type-Options', 'nosniff');
        if (!/^(image|video)\//.test(row.mime)) {
            // Документи та інші файли завжди завантажуються, а не відкриваються в браузері
            res.set('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(row.name || 'file'));
        }
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        res.sendFile(path.join(UPLOAD_DIR, id), (sendErr) => {
            if (sendErr && !res.headersSent) res.status(404).end();
        });
    });
});

// ===================== PUSH-СПОВІЩЕННЯ (FCM) =====================
// Environment: FIREBASE_SERVICE_ACCOUNT = вміст JSON-ключа сервісного акаунта Firebase
//              (або FIREBASE_SERVICE_ACCOUNT_B64 = той самий JSON у base64).
const fcmState = { creds: undefined, accessToken: null, expires: 0 };

function fcmLoadCreds() {
    if (fcmState.creds !== undefined) return fcmState.creds;
    fcmState.creds = null;
    try {
        let raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
        if (!raw && process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
            raw = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8');
        }
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.client_email && parsed.private_key && parsed.project_id) fcmState.creds = parsed;
        }
    } catch (e) {
        console.error('FIREBASE_SERVICE_ACCOUNT: некоректний JSON:', e.message);
    }
    if (!fcmState.creds) console.log('Push-сповіщення вимкнені: не задано FIREBASE_SERVICE_ACCOUNT');
    return fcmState.creds;
}

function b64url(input) {
    return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function httpsJson(options, bodyString) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                let json = null;
                try { json = JSON.parse(raw); } catch (e) {}
                resolve({ status: res.statusCode, json, raw });
            });
        });
        req.on('error', reject);
        if (bodyString) req.write(bodyString);
        req.end();
    });
}

async function fcmAccessToken() {
    const creds = fcmLoadCreds();
    if (!creds) return null;
    if (fcmState.accessToken && Date.now() < fcmState.expires - 60000) return fcmState.accessToken;

    const iat = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64url(JSON.stringify({
        iss: creds.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat,
        exp: iat + 3600
    }));
    const unsigned = header + '.' + claim;
    const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(creds.private_key)
        .toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const body = 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') +
        '&assertion=' + encodeURIComponent(unsigned + '.' + signature);

    const res = await httpsJson({
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, body);

    if (res.status !== 200 || !res.json || !res.json.access_token) {
        throw new Error('FCM OAuth: HTTP ' + res.status);
    }
    fcmState.accessToken = res.json.access_token;
    fcmState.expires = Date.now() + (res.json.expires_in || 3600) * 1000;
    return fcmState.accessToken;
}

// Відправка data-повідомлення на один токен. Повертає false, якщо токен недійсний.
async function fcmSend(token, data) {
    const creds = fcmLoadCreds();
    if (!creds) return true;
    const accessToken = await fcmAccessToken();
    const stringData = {};
    Object.keys(data).forEach((k) => { stringData[k] = String(data[k] == null ? '' : data[k]); });
    const body = JSON.stringify({
        message: { token, data: stringData, android: { priority: 'HIGH', ttl: '86400s' } }
    });
    const res = await httpsJson({
        hostname: 'fcm.googleapis.com',
        path: `/v1/projects/${creds.project_id}/messages:send`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'Authorization': 'Bearer ' + accessToken
        }
    }, body);
    if (res.status === 404 || (res.status === 400 && /UNREGISTERED|INVALID_ARGUMENT/.test(res.raw || ''))) return false;
    if (res.status >= 400) console.error('FCM помилка:', res.status, (res.raw || '').slice(0, 200));
    return true;
}

function savePushToken(email, token) {
    if (!email || typeof token !== 'string' || token.length < 20 || token.length > 400) return;
    db.run(
        "INSERT OR REPLACE INTO push_tokens (email, token, updated) VALUES (?, ?, ?)",
        [email, token, Date.now()],
        () => {
            // Зберігаємо максимум 5 найновіших токенів на користувача
            db.run(
                "DELETE FROM push_tokens WHERE email = ? AND token NOT IN (SELECT token FROM push_tokens WHERE email = ? ORDER BY updated DESC LIMIT 5)",
                [email, email],
                () => {}
            );
        }
    );
}

function sendPushToUser(email, data) {
    if (!fcmLoadCreds()) return;
    db.all("SELECT token FROM push_tokens WHERE email = ?", [email], (err, rows) => {
        if (err || !rows || rows.length === 0) return;
        rows.forEach((row) => {
            fcmSend(row.token, data).then((valid) => {
                if (!valid) db.run("DELETE FROM push_tokens WHERE token = ?", [row.token], () => {});
            }).catch((e) => console.error('FCM:', e.message));
        });
    });
}

function mediaPreviewText(text, fileType) {
    if (text) return text;
    if (fileType === 'video') return '🎬';
    if (fileType === 'image') return '📷';
    if (fileType === 'file') return '📎';
    return '';
}

// Стан активних дзвінків (для відновлення після короткого розриву мережі)
const activeCalls = new Map();   // email -> email співрозмовника
const callGrace = new Map();     // email -> timer
const CALL_GRACE_MS = 12000;

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
            return safeCallback({ success: false, code: 'invalid', message: "Invalid address or adding yourself" });
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

                    safeCallback({ success: true, user: userObj, message: "Contact added" });
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
            "SELECT id, chat_id as chatId, sender_email as senderEmail, receiver_email as receiverEmail, text, timestamp, file_url as fileUrl, file_type as fileType, thumb_url as thumbUrl, file_name as fileName FROM messages WHERE chat_id = ? ORDER BY timestamp ASC",
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
        const { id, chatId, senderEmail, receiverEmail, text, timestamp, fileUrl, fileType, thumbUrl, fileName } = data || {};
        const safeText = typeof text === 'string' ? text : '';
        const safeFileUrl = (typeof fileUrl === 'string' && /^\/media\/[a-zA-Z0-9_-]+$/.test(fileUrl)) ? fileUrl : null;
        const safeThumbUrl = (typeof thumbUrl === 'string' && /^\/media\/[a-zA-Z0-9_-]+$/.test(thumbUrl)) ? thumbUrl : null;
        const safeFileType = safeFileUrl ? (fileType === 'video' ? 'video' : (fileType === 'file' ? 'file' : 'image')) : null;
        const safeFileName = safeFileUrl ? cleanFileName(fileName) : null;

        if (!chatId || (!safeText && !safeFileUrl)) return;
        const msgId = id || Date.now().toString();
        const msgTimestamp = timestamp || Date.now();

        db.run(
            "INSERT INTO messages (id, chat_id, sender_email, receiver_email, text, timestamp, file_url, file_type, thumb_url, file_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [msgId, chatId, senderEmail, receiverEmail, safeText, msgTimestamp, safeFileUrl, safeFileType, safeThumbUrl, safeFileName],
            (err) => {
                if (err) return;
                const newMessage = {
                    id: msgId, chatId, senderEmail, receiverEmail, text: safeText, timestamp: msgTimestamp,
                    fileUrl: safeFileUrl, fileType: safeFileType, thumbUrl: safeThumbUrl, fileName: safeFileName
                };

                io.to(chatId).emit('receive_message', newMessage);
                if (receiverEmail) {
                    io.to(receiverEmail.trim().toLowerCase()).emit('receive_message', newMessage);

                    // Push-сповіщення, якщо отримувач зараз не дивиться цей чат
                    const cleanReceiver = receiverEmail.trim().toLowerCase();
                    const cleanSender = (senderEmail || '').trim().toLowerCase();
                    const receiverSocketId = userSockets.get(cleanReceiver);
                    const room = io.sockets.adapter.rooms.get(chatId);
                    const viewingChat = !!(receiverSocketId && room && room.has(receiverSocketId));
                    if (!viewingChat && cleanReceiver !== cleanSender) {
                        db.get("SELECT name FROM users WHERE email = ?", [cleanSender], (nameErr, row) => {
                            sendPushToUser(cleanReceiver, {
                                type: 'message',
                                senderEmail: cleanSender,
                                senderName: (row && row.name) ? row.name : cleanSender,
                                text: mediaPreviewText(safeText, safeFileType),
                                chatId,
                                messageId: msgId
                            });
                        });
                    }
                }
            }
        );
    });

    // Видалення для всіх: дозволено лише автору повідомлення
    socket.on('delete_message', (data) => {
        const { messageId, chatId, requesterEmail } = data || {};
        if (!messageId || !chatId) return;
        const requester = (typeof requesterEmail === 'string' ? requesterEmail : (socket.userEmail || '')).trim().toLowerCase();

        db.get("SELECT sender_email, file_url, thumb_url FROM messages WHERE id = ? AND chat_id = ?", [messageId, chatId], (selErr, row) => {
            if (selErr || !row) return;
            if (requester && (row.sender_email || '').trim().toLowerCase() !== requester) return;

            db.run("DELETE FROM messages WHERE id = ?", [messageId], (err) => {
                if (err) return;
                io.to(chatId).emit('message_deleted', messageId);
                // Видаляємо і самі файли з диска
                // Файл видаляємо лише якщо на нього більше не посилається жодне повідомлення (його могли переслати)
                [row.file_url, row.thumb_url].forEach((u) => {
                    const m = typeof u === 'string' ? u.match(/^\/media\/([a-zA-Z0-9_-]+)$/) : null;
                    if (!m) return;
                    db.get("SELECT COUNT(*) AS n FROM messages WHERE file_url = ? OR thumb_url = ?", [u, u], (cErr, cRow) => {
                        if (cErr || (cRow && cRow.n > 0)) return;
                        db.run("DELETE FROM media_files WHERE id = ?", [m[1]], () => {});
                        fs.unlink(path.join(UPLOAD_DIR, m[1]), () => {});
                    });
                });
            });
        });
    });

    // Повторна ідентифікація після перепідключення сокета (повертає в кімнату користувача)
    socket.on('identify', (data) => {
        const email = ((data && data.email) || '').toString().trim().toLowerCase();
        if (!email) return;
        socket.userEmail = email;
        userSockets.set(email, socket.id);
        socket.join(email);
        if (data.pushToken) savePushToken(email, data.pushToken);
        if (callGrace.has(email)) {
            clearTimeout(callGrace.get(email));
            callGrace.delete(email);
        }
    });

    socket.on('register_push_token', (data) => {
        const email = ((data && data.email) || '').toString().trim().toLowerCase();
        if (!email) return;
        savePushToken(email, data.token);
    });

    // Індикатор "пише..."
    socket.on('typing', (data) => {
        const { from, to, isTyping } = data || {};
        const cleanFrom = (typeof from === 'string' ? from : '').trim().toLowerCase();
        const cleanTo = (typeof to === 'string' ? to : '').trim().toLowerCase();
        if (!cleanFrom || !cleanTo) return;
        io.to(cleanTo).emit('user_typing', { from: cleanFrom, isTyping: !!isTyping });
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
        activeCalls.set(cleanCaller, cleanReceiver);
        activeCalls.set(cleanReceiver, cleanCaller);

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
            activeCalls.delete(cleanCaller);
            activeCalls.delete(cleanReceiver);
        }
    });

    socket.on('answer_call', (data) => {
        const { callerEmail, receiverEmail } = data || {};
        if (!callerEmail) return;
        const cleanCaller = callerEmail.trim().toLowerCase();
        const cleanReceiver = (receiverEmail || '').trim().toLowerCase();

        if (cleanCaller) busyUsers.add(cleanCaller);
        if (cleanReceiver) busyUsers.add(cleanReceiver);
        if (cleanCaller && cleanReceiver) {
            activeCalls.set(cleanCaller, cleanReceiver);
            activeCalls.set(cleanReceiver, cleanCaller);
        }

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

        if (cleanCaller) { busyUsers.delete(cleanCaller); activeCalls.delete(cleanCaller); }
        if (cleanReceiver) { busyUsers.delete(cleanReceiver); activeCalls.delete(cleanReceiver); }

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
            activeCalls.delete(cleanCaller);
            const sId = userSockets.get(cleanCaller);
            if (sId) io.to(sId).emit(`call_ended_${cleanCaller}`, {});
            io.to(cleanCaller).emit(`call_ended_${cleanCaller}`, {});
        }
        if (cleanReceiver) {
            busyUsers.delete(cleanReceiver);
            activeCalls.delete(cleanReceiver);
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
        const email = socket.userEmail;
        // Видаляємо запис лише якщо він належить саме цьому сокету (після перепідключення там уже новий сокет)
        const stillMine = email && userSockets.get(email) === socket.id;
        if (stillMine) {
            userSockets.delete(email);
        }

        if (email && stillMine && activeCalls.has(email)) {
            // Під час дзвінка даємо 12 с на відновлення звʼязку, а вже потім завершуємо розмову
            const peer = activeCalls.get(email);
            if (callGrace.has(email)) clearTimeout(callGrace.get(email));
            callGrace.set(email, setTimeout(() => {
                callGrace.delete(email);
                if (userSockets.has(email)) return;
                activeCalls.delete(email);
                activeCalls.delete(peer);
                busyUsers.delete(email);
                busyUsers.delete(peer);
                io.to(peer).emit(`call_ended_${peer}`, {});
            }, CALL_GRACE_MS));
        } else if (socket.myCallEmails && !(email && activeCalls.has(email))) {
            socket.myCallEmails.forEach(e => busyUsers.delete(e));
        }
        console.log('Клієнт відключився');
    });
});

// =====================================================================
// ===== GEMINI (ДОДАНО): моделі, зображення, зупинка запиту, памʼять ШІ =====
// Існуючі події (повідомлення, контакти, дзвінки) НЕ змінені.
//
// Environment (Render -> Environment):
//   GEMINI_API_KEY        — ключ з Google AI Studio (обовʼязково)
//   GEMINI_MODEL          — модель за замовчуванням (необовʼязково, напр. gemini-3.8-flash)
//   GEMINI_FALLBACK_MODEL — запасна модель при перевантаженні Google (необовʼязково)
//   GEMINI_EXTRA_MODELS   — додаткові моделі, через кому:  id|Назва|text|paid
//                           приклад: gemini-5-flash|Gemini 5 Flash|text,my-image-model|Моя картинка|image|paid
//   GEMINI_HIDE_MODELS    — id моделей, які треба сховати зі списку, через кому
// Фото та відео для аналізу беруться з /upload (див. вище) і передаються в Gemini через Files API.
// =====================================================================
const GEMINI_DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite';
const GEMINI_CONTEXT_LIMIT = 40;      // скільки останніх повідомлень памʼяті йде в запит до Gemini
const GEMINI_HISTORY_LIMIT = 500;     // скільки повідомлень віддаємо в застосунок при відкритті вкладки
const GEMINI_MAX_TEXT = 8000;
// Таймаутів на відповідь моделі НЕМАЄ: запит триває, поки Google не відповість або користувач не натисне "Стоп".

// ---------------------------------------------------------------------
// КАТАЛОГ МОДЕЛЕЙ (усі моделі зі списку AI Studio, які працюють як чат / генерація зображень).
// paid: true  — у AI Studio позначені "Paid" (потрібен платний ключ Gemini API).
// type: 'text' | 'image'.   noSystem: модель не підтримує system instruction (Gemma).
// ---------------------------------------------------------------------
const GEMINI_CATALOG = [
    // ----- Текст -----
    { id: 'gemini-4-argon',                          label: 'Gemini 4 Argon',                    type: 'text',  paid: true,  note: 'Найпотужніша модель' },
    { id: 'gemini-3.8-flash',                        label: 'Gemini 3.8 Flash',                  type: 'text',  paid: false, note: 'Найрозумніша Flash-модель' },
    { id: 'gemini-3.6-flash',                        label: 'Gemini 3.6 Flash',                  type: 'text',  paid: true,  note: 'Попереднє покоління Flash' },
    { id: 'gemini-3.5-flash-lite',                   label: 'Gemini 3.5 Flash-Lite',             type: 'text',  paid: false, note: 'Найшвидша' },
    { id: 'gemini-3.1-pro-preview',                  label: 'Gemini 3.1 Pro Preview',            type: 'text',  paid: false, note: 'Складні завдання та код' },
    { id: 'gemini-3.1-flash-lite',                   label: 'Gemini 3.1 Flash-Lite',             type: 'text',  paid: false, note: 'Легка та швидка' },
    { id: 'gemini-3-flash-preview',                  label: 'Gemini 3 Flash Preview',            type: 'text',  paid: true,  note: 'Застаріла Flash' },
    { id: 'gemini-pro-latest',                       label: 'Gemini Pro Latest',                 type: 'text',  paid: false, note: 'Завжди остання Pro' },
    { id: 'gemini-flash-latest',                     label: 'Gemini Flash Latest',               type: 'text',  paid: false, note: 'Завжди остання Flash' },
    { id: 'gemini-flash-lite-latest',                label: 'Gemini Flash-Lite Latest',          type: 'text',  paid: false, note: 'Завжди остання Flash-Lite' },
    { id: 'gemini-robotics-er-2-preview',            label: 'Gemini Robotics-ER 2 Preview',      type: 'text',  paid: false, note: 'Розуміння простору та відео' },
    { id: 'gemini-robotics-er-2-streaming-preview',  label: 'Gemini Robotics-ER 2 Streaming',    type: 'text',  paid: false, note: 'Швидкий потоковий режим' },
    // ----- Зображення (Nano Banana) -----
    { id: 'gemini-nano-banana-2.1',                  label: 'Nano Banana 2.1',                   type: 'image', paid: true,  note: 'Найкраща якість, до 4K' },
    { id: 'gemini-3.1-flash-lite-image',             label: 'Nano Banana 2 Lite',                type: 'image', paid: false, note: 'Найшвидша' },
    { id: 'gemini-3.1-flash-image',                  label: 'Nano Banana 2',                     type: 'image', paid: true,  note: 'Збалансована' },
    { id: 'gemini-3-pro-image',                      label: 'Nano Banana Pro',                   type: 'image', paid: true,  note: 'Професійна' },
    { id: 'gemini-2.5-flash-image',                  label: 'Nano Banana',                       type: 'image', paid: true,  note: 'Перша версія' }
];
// Не включені (це не чат-моделі): gemini-3.8-flash-tts (озвучка), gemini-3.5-transcribe (розпізнавання мови),
// antigravity-preview-09-2026 та deep-research-preview-04-2026 (агенти з іншим API).

function geminiParseList(raw) {
    return String(raw || '').split(/[,\n;]+/).map(s => s.trim()).filter(Boolean);
}

// Додаткові моделі з Environment: GEMINI_EXTRA_MODELS = id|Назва|text|paid, id2|Назва2|image
function geminiExtraModels() {
    const result = [];
    geminiParseList(process.env.GEMINI_EXTRA_MODELS).forEach((entry) => {
        const [id, label, type, flag] = entry.split('|').map(x => (x || '').trim());
        if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) return;
        const typeLower = (type || '').toLowerCase();
        const guessedType = /image|nano-banana|imagen/i.test(id) ? 'image' : 'text';
        result.push({
            id,
            label: label || id,
            type: (typeLower === 'image' || typeLower === 'text') ? typeLower : guessedType,
            paid: typeLower === 'paid' || (flag || '').toLowerCase() === 'paid',
            note: 'Додано через Environment'
        });
    });
    return result;
}

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS gemini_messages (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        timestamp INTEGER NOT NULL
    )`);
    // Міграції для вже існуючої таблиці (помилку "duplicate column" ігноруємо)
    db.run("ALTER TABLE gemini_messages ADD COLUMN image_id TEXT", () => {});
    db.run("ALTER TABLE gemini_messages ADD COLUMN model TEXT", () => {});
    db.run("ALTER TABLE gemini_messages ADD COLUMN attach_url TEXT", () => {});
    db.run("ALTER TABLE gemini_messages ADD COLUMN attach_type TEXT", () => {});
    db.run("ALTER TABLE gemini_messages ADD COLUMN attach_thumb TEXT", () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_gemini_email_time ON gemini_messages (email, timestamp)`);
    db.run(`CREATE TABLE IF NOT EXISTS gemini_media (
        media_id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_uri TEXT NOT NULL,
        mime TEXT NOT NULL,
        uploaded INTEGER NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS gemini_images (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        mime TEXT NOT NULL,
        data BLOB NOT NULL,
        timestamp INTEGER NOT NULL
    )`);
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

// Віддаємо згенеровані зображення (id випадковий і непередбачуваний)
app.get('/gemini-image/:id', (req, res) => {
    const id = String(req.params.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
    db.get("SELECT mime, data FROM gemini_images WHERE id = ?", [id], (err, row) => {
        if (err || !row) return res.status(404).send('Not found');
        const mime = /^image\/(png|jpeg|webp|gif)$/.test(row.mime) ? row.mime : 'image/png';
        res.set('Content-Type', mime);
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        res.send(row.data);
    });
});

// ---------- Активні запити та їх зупинка ----------
const geminiJobs = new Map(); // email -> { cancelled, reqs }

function geminiMakeJob() {
    return { cancelled: false, reqs: new Set(), startedAt: Date.now() };
}

function geminiCancelJob(job) {
    job.cancelled = true;
    job.reqs.forEach((r) => { try { r.destroy(new Error('CANCELLED')); } catch (e) {} });
    job.reqs.clear();
}

function geminiCheckCancelled(job) {
    if (job && job.cancelled) throw new Error('CANCELLED');
}

// ---------- Низькорівневий HTTPS-запит до Gemini API (БЕЗ таймауту) ----------
function geminiRequest(method, path, bodyObj, job) {
    return new Promise((resolve, reject) => {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return reject(new Error('NO_KEY'));
        if (job && job.cancelled) return reject(new Error('CANCELLED'));

        const body = bodyObj ? JSON.stringify(bodyObj) : null;
        const headers = { 'x-goog-api-key': apiKey };
        if (body) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(body);
        }

        const req = https.request({
            hostname: 'generativelanguage.googleapis.com',
            path,
            method,
            headers
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                if (job) job.reqs.delete(req);
                const raw = Buffer.concat(chunks).toString('utf8');
                let json = null;
                try { json = JSON.parse(raw); } catch (e) {}
                resolve({ status: res.statusCode, json });
            });
            res.on('error', (e) => { if (job) job.reqs.delete(req); reject(e); });
        });

        if (job) job.reqs.add(req);
        req.on('error', (e) => { if (job) job.reqs.delete(req); reject(e); });
        if (body) req.write(body);
        req.end();
    });
}

function geminiApiError(res) {
    const msg = (res.json && res.json.error && res.json.error.message) ? res.json.error.message : ('HTTP ' + res.status);
    const err = new Error(msg);
    err.status = res.status;
    return err;
}

// ---------- Запит із потоком (для завантаження файлів у Gemini Files API) ----------
function geminiHttpStream(options, bodyString, readStream, job) {
    return new Promise((resolve, reject) => {
        if (job && job.cancelled) return reject(new Error('CANCELLED'));
        const req = https.request(options, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                if (job) job.reqs.delete(req);
                const raw = Buffer.concat(chunks).toString('utf8');
                let json = null;
                try { json = JSON.parse(raw); } catch (e) {}
                resolve({ status: res.statusCode, headers: res.headers, json });
            });
            res.on('error', (e) => { if (job) job.reqs.delete(req); reject(e); });
        });
        if (job) job.reqs.add(req);
        req.on('error', (e) => { if (job) job.reqs.delete(req); reject(e); });
        if (readStream) {
            readStream.on('error', (e) => { try { req.destroy(e); } catch (x) {} });
            readStream.pipe(req);
        } else {
            if (bodyString) req.write(bodyString);
            req.end();
        }
    });
}

// Завантажує файл з диска сервера в Gemini Files API (resumable upload) і чекає, поки він стане ACTIVE
async function geminiUploadFile(filePath, mime, displayName, job) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('NO_KEY');
    const size = fs.statSync(filePath).size;

    const startBody = JSON.stringify({ file: { display_name: displayName } });
    const start = await geminiHttpStream({
        hostname: 'generativelanguage.googleapis.com',
        path: '/upload/v1beta/files',
        method: 'POST',
        headers: {
            'x-goog-api-key': apiKey,
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Header-Content-Length': String(size),
            'X-Goog-Upload-Header-Content-Type': mime,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(startBody)
        }
    }, startBody, null, job);

    const uploadUrl = start.headers['x-goog-upload-url'];
    if (start.status !== 200 || !uploadUrl) {
        const e = new Error((start.json && start.json.error && start.json.error.message) || ('HTTP ' + start.status));
        e.status = start.status;
        throw e;
    }

    const u = new URL(uploadUrl);
    const up = await geminiHttpStream({
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
            'Content-Length': String(size),
            'X-Goog-Upload-Offset': '0',
            'X-Goog-Upload-Command': 'upload, finalize'
        }
    }, null, fs.createReadStream(filePath), job);

    let file = up.json && up.json.file;
    if (up.status !== 200 || !file) {
        const e = new Error((up.json && up.json.error && up.json.error.message) || ('HTTP ' + up.status));
        e.status = up.status;
        throw e;
    }

    // Відео спочатку "PROCESSING": чекаємо без обмеження часу (до зупинки користувачем)
    let guard = 0;
    while (file.state && file.state !== 'ACTIVE') {
        if (file.state === 'FAILED') throw new Error('FILE_FAILED');
        geminiCheckCancelled(job);
        await geminiSleep(2000);
        const poll = await geminiRequest('GET', `/v1beta/${file.name}`, null, job);
        if (poll.status !== 200 || !poll.json) throw geminiApiError(poll);
        file = poll.json;
        if (++guard > 900) throw new Error('FILE_FAILED');
    }
    return { name: file.name, uri: file.uri, mime: file.mimeType || mime };
}

// Повертає fileUri у Gemini для файлу з /media/<id> (з кешем на 40 годин — файли в Gemini живуть 48 годин)
async function geminiEnsureFile(mediaRecord, job) {
    const cached = await new Promise((resolve) => {
        db.get("SELECT file_name, file_uri, mime, uploaded FROM gemini_media WHERE media_id = ?", [mediaRecord.id], (err, row) => resolve(err ? null : row));
    });
    if (cached && Date.now() - cached.uploaded < 40 * 3600 * 1000) {
        return { uri: cached.file_uri, mime: cached.mime };
    }
    const filePath = path.join(UPLOAD_DIR, mediaRecord.id);
    if (!fs.existsSync(filePath)) throw new Error('ATTACH_MISSING');
    const uploaded = await geminiUploadFile(filePath, mediaRecord.mime, 'kishka-' + mediaRecord.id.slice(0, 8), job);
    await geminiDbRun(
        "INSERT OR REPLACE INTO gemini_media (media_id, file_name, file_uri, mime, uploaded) VALUES (?, ?, ?, ?, ?)",
        [mediaRecord.id, uploaded.name, uploaded.uri, uploaded.mime, Date.now()]
    );
    return { uri: uploaded.uri, mime: uploaded.mime };
}

function geminiGetMediaRecord(relativeUrl) {
    const m = typeof relativeUrl === 'string' ? relativeUrl.match(/^\/media\/([a-zA-Z0-9_-]+)$/) : null;
    if (!m) return Promise.resolve(null);
    return new Promise((resolve) => {
        db.get("SELECT id, mime, size FROM media_files WHERE id = ?", [m[1]], (err, row) => resolve(err ? null : (row || null)));
    });
}

// ---------- Каталог моделей ----------
let geminiCatalogCache = { at: 0, ttl: 0, models: null };

async function geminiFetchRemoteModels() {
    const all = [];
    let pageToken = '';
    for (let page = 0; page < 4; page++) {
        const q = '/v1beta/models?pageSize=1000' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
        const res = await geminiRequest('GET', q, null, null);
        if (res.status !== 200 || !res.json || !Array.isArray(res.json.models)) throw geminiApiError(res);
        all.push(...res.json.models);
        pageToken = res.json.nextPageToken || '';
        if (!pageToken) break;
    }
    return all;
}

async function geminiGetCatalog() {
    const now = Date.now();
    if (geminiCatalogCache.models && now - geminiCatalogCache.at < geminiCatalogCache.ttl) {
        return geminiCatalogCache.models;
    }

    const models = GEMINI_CATALOG.map(m => Object.assign({}, m));

    // Додаткові моделі з Environment (перекривають однакові id)
    geminiExtraModels().forEach((extra) => {
        const idx = models.findIndex(m => m.id === extra.id);
        if (idx >= 0) models[idx] = extra; else models.push(extra);
    });

    // Відкриті моделі Gemma (безкоштовні) підтягуємо автоматично зі списку Google
    let remoteOk = false;
    try {
        const remote = await geminiFetchRemoteModels();
        remoteOk = true;
        remote.forEach((m) => {
            const id = String(m.name || '').replace(/^models\//, '');
            const methods = m.supportedGenerationMethods || [];
            if (/^gemma-/.test(id) && methods.includes('generateContent') && !models.some(x => x.id === id)) {
                models.push({ id, label: m.displayName || id, type: 'text', paid: false, note: 'Gemma (відкрита модель)', noSystem: true });
            }
        });
    } catch (e) {
        console.error('Gemini ListModels:', e.message);
    }

    const hidden = new Set(geminiParseList(process.env.GEMINI_HIDE_MODELS));
    const result = models.filter(m => !hidden.has(m.id));

    geminiCatalogCache = { at: now, ttl: remoteOk ? 3600000 : 300000, models: result };
    return result;
}

function geminiDefaultModel(catalog) {
    return catalog.find(m => m.id === GEMINI_DEFAULT_MODEL && m.type === 'text')
        || catalog.find(m => m.type === 'text' && !m.paid)
        || catalog.find(m => m.type === 'text')
        || catalog[0];
}

function geminiPickModel(catalog, requestedId) {
    return catalog.find(m => m.id === requestedId) || geminiDefaultModel(catalog);
}

// ---------- Текстова відповідь ----------
async function callGemini(contents, systemText, model, job) {
    const body = { contents };
    if (model.noSystem) {
        // Gemma не підтримує systemInstruction: вшиваємо інструкцію в перше повідомлення
        body.contents = contents.map(c => ({ role: c.role, parts: c.parts.map(p => ({ text: p.text })) }));
        if (body.contents[0] && body.contents[0].parts[0]) {
            body.contents[0].parts[0].text = systemText + '\n\n' + body.contents[0].parts[0].text;
        }
    } else {
        body.systemInstruction = { parts: [{ text: systemText }] };
    }

    const res = await geminiRequest('POST', `/v1beta/models/${encodeURIComponent(model.id)}:generateContent`, body, job);
    if (res.status !== 200) throw geminiApiError(res);
    if (!res.json) throw new Error('BAD_RESPONSE');

    const candidate = res.json.candidates && res.json.candidates[0];
    const parts = candidate && candidate.content && candidate.content.parts;
    const text = parts ? parts.filter(p => !p.thought).map(p => p.text || '').join('') : '';
    if (!text.trim()) throw new Error('EMPTY');
    return text;
}

function geminiIsOverload(err) {
    const s = err && err.status;
    if (s === 500 || s === 502 || s === 503 || s === 504) return true;
    const m = err && err.message ? err.message : '';
    return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(m);
}

function isRetryableGeminiError(err) {
    return geminiIsOverload(err) || (err && err.status === 429);
}

const geminiSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Обрана модель (до 6 спроб при перевантаженні) -> запасна безкоштовна модель (2 спроби).
// Запасна модель вмикається ТІЛЬКИ при перевантаженні Google (5xx), а не при ліміті/платній моделі.
async function callGeminiResilient(contents, systemText, picked, catalog, job) {
    const chain = [picked];
    const fallback = catalog.find(m => m.type === 'text' && m.id === GEMINI_FALLBACK_MODEL && m.id !== picked.id && !m.paid)
        || catalog.find(m => m.type === 'text' && !m.paid && !m.noSystem && m.id !== picked.id);
    if (fallback) chain.push(fallback);

    let firstError = null;
    for (let m = 0; m < chain.length; m++) {
        const maxAttempts = m === 0 ? 6 : 2;
        for (let a = 0; a < maxAttempts; a++) {
            geminiCheckCancelled(job);
            try {
                const text = await callGemini(contents, systemText, chain[m], job);
                return { text, model: chain[m].id };
            } catch (err) {
                if (err.message === 'CANCELLED' || err.message === 'NO_KEY') throw err;
                if (!firstError) firstError = err;
                if (!isRetryableGeminiError(err)) throw (m > 0 ? firstError : err);

                const limit = err.status === 429 ? 2 : maxAttempts; // ліміт квоти повторами не лікується
                console.error(`Gemini ${chain[m].id} спроба ${a + 1}/${limit}:`, err.message);
                if (a + 1 >= limit) {
                    if (err.status === 429) throw err;   // без підміни моделі
                    break;                               // перевантаження -> пробуємо запасну модель
                }
                await geminiSleep(Math.min(2000 * (a + 1), 10000));
            }
        }
    }
    throw firstError || new Error('UNAVAILABLE');
}

// ---------- Генерація зображення ----------
function geminiExtractImage(json) {
    let text = '';
    let image = null;

    const visit = (b) => {
        if (!b || typeof b !== 'object') return;
        if (b.type === 'text' && typeof b.text === 'string') text += b.text;
        else if (!b.type && typeof b.text === 'string' && !b.thought) text += b.text;

        if (b.type === 'image' && b.data && !image) {
            image = { mime: b.mime_type || b.mimeType || 'image/png', data: b.data };
        }
        const inline = b.inlineData || b.inline_data;
        if (inline && inline.data && !image) {
            image = { mime: inline.mimeType || inline.mime_type || 'image/png', data: inline.data };
        }
    };

    // Interactions API
    if (Array.isArray(json.steps)) {
        json.steps.forEach((st) => {
            if (st && st.type === 'model_output' && Array.isArray(st.content)) st.content.forEach(visit);
        });
    }
    if (!image && json.output_image && json.output_image.data) {
        image = { mime: json.output_image.mime_type || 'image/png', data: json.output_image.data };
    }
    if (!text && typeof json.output_text === 'string') text = json.output_text;

    // Класичний generateContent
    if (Array.isArray(json.candidates)) {
        json.candidates.forEach((c) => {
            const parts = c && c.content && c.content.parts;
            if (Array.isArray(parts)) parts.forEach((p) => { if (!p.thought) visit(p); });
        });
    }

    return image ? { mime: image.mime, data: image.data, text: text.trim() } : null;
}

async function callGeminiImage(prompt, modelId, job, inputImage) {
    // 1) Interactions API (так зображення генеруються за актуальною документацією)
    const inputBlocks = [{ type: 'text', text: prompt }];
    if (inputImage) inputBlocks.push({ type: 'image', data: inputImage.data, mime_type: inputImage.mime });
    let res = await geminiRequest('POST', '/v1beta/interactions', {
        model: modelId,
        input: inputBlocks
    }, job);

    if (res.status === 200 && res.json) {
        const out = geminiExtractImage(res.json);
        if (out) return out;
        throw new Error('EMPTY_IMAGE');
    }

    // 2) Запасний шлях: класичний generateContent з режимом IMAGE
    if (res.status === 400 || res.status === 404 || res.status === 501) {
        const parts = [{ text: prompt }];
        if (inputImage) parts.push({ inlineData: { mimeType: inputImage.mime, data: inputImage.data } });
        res = await geminiRequest('POST', `/v1beta/models/${encodeURIComponent(modelId)}:generateContent`, {
            contents: [{ role: 'user', parts }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
        }, job);

        if (res.status === 200 && res.json) {
            const out = geminiExtractImage(res.json);
            if (out) return out;
            throw new Error('EMPTY_IMAGE');
        }
    }
    throw geminiApiError(res);
}

async function callGeminiImageResilient(prompt, modelId, job, inputImage) {
    let lastErr = null;
    for (let a = 0; a < 3; a++) {
        geminiCheckCancelled(job);
        try {
            return await callGeminiImage(prompt, modelId, job, inputImage);
        } catch (err) {
            lastErr = err;
            if (err.message === 'CANCELLED' || err.message === 'NO_KEY') throw err;
            if (!geminiIsOverload(err)) throw err;   // 429/403/400 повторами не лікуються
            console.error(`Gemini image ${modelId} спроба ${a + 1}/3:`, err.message);
            await geminiSleep(3000 * (a + 1));
        }
    }
    throw lastErr;
}

const GEMINI_ERRORS = {
    stopped:       { uk: 'Запит зупинено', ru: 'Запрос остановлен', en: 'Request stopped' },
    attach_missing:{ uk: 'Файл вкладення не знайдено на сервері (сервер міг перезапуститися). Надішліть його ще раз', ru: 'Файл вложения не найден на сервере (сервер мог перезапуститься). Отправьте его ещё раз', en: 'The attachment was not found on the server (it may have restarted). Please send it again' },
    attach_bad:    { uk: 'Gemini аналізує лише фото та відео', ru: 'Gemini анализирует только фото и видео', en: 'Gemini can only analyse photos and videos' },
    file_failed:   { uk: 'Gemini не зміг обробити цей файл. Спробуйте інший формат або коротше відео', ru: 'Gemini не смог обработать этот файл. Попробуйте другой формат или более короткое видео', en: 'Gemini could not process this file. Try another format or a shorter video' },
    video_to_image:{ uk: 'Моделі створення зображень не приймають відео. Оберіть текстову модель для аналізу відео', ru: 'Модели создания изображений не принимают видео. Выберите текстовую модель для анализа видео', en: 'Image models do not accept video. Choose a text model to analyse a video' },
    attach_big:    { uk: 'Фото завелике для редагування моделлю зображень (максимум 15 МБ)', ru: 'Фото слишком большое для редактирования моделью изображений (максимум 15 МБ)', en: 'The photo is too large for the image model (15 MB max)' },
    no_key:        { uk: 'На сервері не налаштований GEMINI_API_KEY', ru: 'На сервере не настроен GEMINI_API_KEY', en: 'GEMINI_API_KEY is not configured on the server' },
    paid:          { uk: '%s платна: ваш ключ Google не має до неї доступу (потрібен платний тариф Gemini API)', ru: '%s платная: у вашего ключа Google нет к ней доступа (нужен платный тариф Gemini API)', en: '%s is a paid model: your Google key has no access (a paid Gemini API plan is required)' },
    forbidden:     { uk: 'Немає доступу до моделі %s з вашим ключем Google', ru: 'Нет доступа к модели %s с вашим ключом Google', en: 'No access to %s with your Google key' },
    not_found:     { uk: 'Модель %s недоступна для вашого ключа Google', ru: 'Модель %s недоступна для вашего ключа Google', en: 'Model %s is not available for your Google key' },
    image_quota:   { uk: 'Генерація зображень моделлю %s недоступна на вашому ключі (ліміт або платний тариф)', ru: 'Генерация изображений моделью %s недоступна на вашем ключе (лимит или платный тариф)', en: 'Image generation with %s is not available on your key (quota or paid plan)' },
    quota:         { uk: 'Перевищено ліміт запитів до Gemini. Зачекайте хвилину і спробуйте ще раз', ru: 'Превышен лимит запросов к Gemini. Подождите минуту и попробуйте ещё раз', en: 'Gemini request limit exceeded. Wait a minute and try again' },
    overloaded:    { uk: 'Gemini зараз перевантажений. Спробуйте ще раз за хвилину', ru: 'Gemini сейчас перегружен. Попробуйте ещё раз через минуту', en: 'Gemini is overloaded right now. Try again in a minute' },
    empty:         { uk: 'Gemini не зміг відповісти на це повідомлення', ru: 'Gemini не смог ответить на это сообщение', en: 'Gemini could not answer this message' },
    empty_image:   { uk: 'Gemini не повернув зображення (можливо, запит заблоковано фільтром безпеки). Спробуйте інший опис', ru: 'Gemini не вернул изображение (возможно, запрос заблокирован фильтром безопасности). Попробуйте другое описание', en: 'Gemini returned no image (the request may have been blocked by a safety filter). Try another description' },
    bad_response:  { uk: 'Некоректна відповідь від Gemini', ru: 'Некорректный ответ от Gemini', en: 'Invalid response from Gemini' },
    generic:       { uk: 'Помилка Gemini: %s', ru: 'Ошибка Gemini: %s', en: 'Gemini error: %s' },
    unknown:       { uk: 'невідома', ru: 'неизвестная', en: 'unknown' },
    empty_msg:     { uk: 'Порожнє повідомлення', ru: 'Пустое сообщение', en: 'Empty message' },
    too_long:      { uk: 'Повідомлення занадто довге', ru: 'Сообщение слишком длинное', en: 'The message is too long' },
    busy:          { uk: 'Gemini ще відповідає на попереднє повідомлення', ru: 'Gemini ещё отвечает на предыдущее сообщение', en: 'Gemini is still answering the previous message' }
};

function geminiT(key, lang, arg) {
    const entry = GEMINI_ERRORS[key] || GEMINI_ERRORS.generic;
    const text = entry[lang] || entry.uk;
    return arg === undefined ? text : text.replace('%s', arg);
}

function geminiLang(value) {
    return value === 'ru' || value === 'en' ? value : 'uk';
}

function geminiErrorText(err, picked, lang) {
    lang = geminiLang(lang);
    const m = err && err.message ? err.message : '';
    const s = err && err.status;
    const name = picked ? picked.label : (lang === 'en' ? 'This model' : (lang === 'ru' ? 'Эта модель' : 'Ця модель'));

    if (m === 'CANCELLED') return geminiT('stopped', lang);
    if (m === 'ATTACH_MISSING') return geminiT('attach_missing', lang);
    if (m === 'ATTACH_BAD') return geminiT('attach_bad', lang);
    if (m === 'FILE_FAILED') return geminiT('file_failed', lang);
    if (m === 'VIDEO_TO_IMAGE_MODEL') return geminiT('video_to_image', lang);
    if (m === 'ATTACH_TOO_BIG') return geminiT('attach_big', lang);
    if (m === 'NO_KEY') return geminiT('no_key', lang);
    if ((s === 403 || s === 429) && picked && picked.paid) return geminiT('paid', lang, name);
    if (s === 403) return geminiT('forbidden', lang, name);
    if (s === 404) return geminiT('not_found', lang, name);
    if (s === 429) {
        return picked && picked.type === 'image' ? geminiT('image_quota', lang, name) : geminiT('quota', lang);
    }
    if (s === 500 || s === 502 || s === 503 || s === 504) return geminiT('overloaded', lang);
    if (m === 'EMPTY') return geminiT('empty', lang);
    if (m === 'EMPTY_IMAGE') return geminiT('empty_image', lang);
    if (m === 'BAD_RESPONSE') return geminiT('bad_response', lang);
    return geminiT('generic', lang, m || geminiT('unknown', lang));
}

function geminiCleanEmail(email) {
    return (typeof email === 'string' ? email : '').trim().toLowerCase();
}

io.on('connection', (socket) => {

    // Список моделей
    socket.on('gemini_get_models', async (arg1, arg2) => {
        const cb = typeof arg1 === 'function' ? arg1 : (typeof arg2 === 'function' ? arg2 : () => {});
        try {
            const catalog = await geminiGetCatalog();
            cb({
                success: true,
                defaultModel: geminiDefaultModel(catalog).id,
                models: catalog.map(m => ({ id: m.id, label: m.label, type: m.type, paid: !!m.paid, note: m.note || '' }))
            });
        } catch (err) {
            console.error('Gemini models error:', err.message);
            cb({ success: false, models: [] });
        }
    });

    // Історія (памʼять) Gemini конкретного користувача
    socket.on('gemini_get_history', async (email, callback) => {
        const cb = typeof callback === 'function' ? callback : () => {};
        const cleanEmail = geminiCleanEmail(email);
        if (!cleanEmail) return cb({ success: false, messages: [] });
        try {
            const rows = await geminiDbAll(
                `SELECT id, role, text, timestamp, imageId, model, attachUrl, attachType, attachThumb FROM (
                    SELECT id, role, text, timestamp, image_id AS imageId, model,
                           attach_url AS attachUrl, attach_type AS attachType, attach_thumb AS attachThumb
                    FROM gemini_messages
                    WHERE email = ? ORDER BY timestamp DESC LIMIT ?
                 ) ORDER BY timestamp ASC`,
                [cleanEmail, GEMINI_HISTORY_LIMIT]
            );
            const messages = rows.map(r => ({
                id: r.id,
                role: r.role,
                text: r.text,
                timestamp: r.timestamp,
                model: r.model || null,
                imageUrl: r.imageId ? '/gemini-image/' + r.imageId : (r.attachUrl || null),
                fileType: r.attachType || null,
                thumbUrl: r.attachThumb || null
            }));
            cb({ success: true, messages });
        } catch (err) {
            console.error('Gemini history error:', err.message);
            cb({ success: false, messages: [] });
        }
    });

    // Чи Gemini зараз відповідає (для відновлення стану після повороту екрана / перепідключення)
    socket.on('gemini_get_status', (email, callback) => {
        const cb = typeof callback === 'function' ? callback : () => {};
        const cleanEmail = geminiCleanEmail(email);
        if (cleanEmail) socket.join(cleanEmail);
        const job = cleanEmail ? geminiJobs.get(cleanEmail) : null;
        cb({ success: true, busy: !!job, startedAt: job ? job.startedAt : 0 });
    });

    // Нове повідомлення до Gemini (текст, фото/відео для аналізу або генерація зображення залежно від моделі)
    socket.on('gemini_send', async (data, callback) => {
        const ackCb = typeof callback === 'function' ? callback : () => {};
        const { email, name, text, model, attachment, lang: rawLang } = data || {};
        const lang = geminiLang(rawLang);
        const cleanEmail = geminiCleanEmail(email);
        const cleanText = (typeof text === 'string' ? text : '').trim();

        const attachUrl = attachment && typeof attachment.url === 'string' ? attachment.url : null;
        const attachType = attachment && attachment.type === 'video' ? 'video' : (attachUrl ? 'image' : null);
        const attachThumb = attachment && typeof attachment.thumbUrl === 'string' && /^\/media\/[a-zA-Z0-9_-]+$/.test(attachment.thumbUrl)
            ? attachment.thumbUrl : null;

        if (!cleanEmail || (!cleanText && !attachUrl)) return ackCb({ success: false, error: geminiT('empty_msg', lang) });
        if (cleanText.length > GEMINI_MAX_TEXT) return ackCb({ success: false, error: geminiT('too_long', lang) });
        if (geminiJobs.has(cleanEmail)) return ackCb({ success: false, error: geminiT('busy', lang) });

        socket.join(cleanEmail);
        const job = geminiMakeJob();
        geminiJobs.set(cleanEmail, job);

        // Результат віддаємо і через ack, і через подію gemini_done: якщо сокет перепідключився, ack загубиться,
        // а подія все одно дійде до застосунку.
        const finish = (payload) => {
            ackCb(payload);
            io.to(cleanEmail).emit('gemini_done', payload);
        };

        const now = Date.now();
        const userMsgId = `g_${now}_${Math.random().toString(36).slice(2, 8)}`;
        let picked = null;

        try {
            const catalog = await geminiGetCatalog();
            picked = geminiPickModel(catalog, typeof model === 'string' ? model : '');
            const isImage = picked.type === 'image';

            let mediaRecord = null;
            if (attachUrl) {
                mediaRecord = await geminiGetMediaRecord(attachUrl);
                if (!mediaRecord) throw new Error('ATTACH_MISSING');
                if (!/^(image|video)\//.test(mediaRecord.mime || '')) throw new Error('ATTACH_BAD');
                if (isImage && attachType === 'video') throw new Error('VIDEO_TO_IMAGE_MODEL');
            }

            await geminiDbRun(
                "INSERT INTO gemini_messages (id, email, role, text, timestamp, attach_url, attach_type, attach_thumb) VALUES (?, ?, 'user', ?, ?, ?, ?, ?)",
                [userMsgId, cleanEmail, cleanText, now, attachUrl, attachType, attachThumb]
            );

            let reply;

            if (isImage) {
                let inputImage = null;
                if (mediaRecord) {
                    if (mediaRecord.size > 15 * 1024 * 1024) throw new Error('ATTACH_TOO_BIG');
                    const filePath = path.join(UPLOAD_DIR, mediaRecord.id);
                    if (!fs.existsSync(filePath)) throw new Error('ATTACH_MISSING');
                    inputImage = { mime: mediaRecord.mime, data: fs.readFileSync(filePath).toString('base64') };
                }
                const prompt = cleanText || 'Покращ це зображення';
                const img = await callGeminiImageResilient(prompt, picked.id, job, inputImage);
                geminiCheckCancelled(job);
                const imageId = crypto.randomBytes(16).toString('hex');
                await geminiDbRun(
                    "INSERT INTO gemini_images (id, email, mime, data, timestamp) VALUES (?, ?, ?, ?, ?)",
                    [imageId, cleanEmail, img.mime, Buffer.from(img.data, 'base64'), Date.now()]
                );
                reply = {
                    id: `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    role: 'model',
                    text: img.text || '',
                    timestamp: Date.now(),
                    model: picked.id,
                    imageId
                };
            } else {
                const rows = await geminiDbAll(
                    `SELECT role, text, image_id AS imageId, attach_url AS attachUrl, attach_type AS attachType
                     FROM gemini_messages WHERE email = ? ORDER BY timestamp DESC, rowid DESC LIMIT ?`,
                    [cleanEmail, GEMINI_CONTEXT_LIMIT]
                );
                rows.reverse();
                while (rows.length > 0 && rows[0].role !== 'user') rows.shift();

                // У запит потрапляють щонайбільше 2 останні вкладення (щоб не роздувати запит)
                let included = 0;
                for (let i = rows.length - 1; i >= 0 && included < 2; i--) {
                    if (rows[i].attachUrl && rows[i].role === 'user') { rows[i].include = true; included++; }
                }

                const contents = [];
                for (const r of rows) {
                    const parts = [];
                    if (r.include && !picked.noSystem) {
                        const rec = await geminiGetMediaRecord(r.attachUrl);
                        if (rec) {
                            const file = await geminiEnsureFile(rec, job);
                            geminiCheckCancelled(job);
                            parts.push({ fileData: { mimeType: file.mime, fileUri: file.uri } });
                        } else if (r.attachUrl === attachUrl) {
                            throw new Error('ATTACH_MISSING');
                        } else {
                            parts.push({ text: '[вкладення більше недоступне]' });
                        }
                    }
                    let t = (r.text || '');
                    if (r.imageId) t += ' [згенероване зображення]';
                    if (r.attachUrl && !r.include) t += (r.attachType === 'video' ? ' [користувач надіслав відео]' : ' [користувач надіслав фото]');
                    t = t.trim();
                    if (!t && parts.length === 0) t = '[порожнє повідомлення]';
                    if (!t && parts.length > 0) t = r.attachType === 'video' ? 'Проаналізуй це відео.' : 'Проаналізуй це фото.';
                    parts.push({ text: t });
                    contents.push({ role: r.role, parts });
                }

                const safeName = (typeof name === 'string' ? name : '').trim().slice(0, 60);
                const systemText =
                    'Ти — Gemini, штучний інтелект усередині месенджера Kishka. ' +
                    'Відповідай тією мовою, якою пише користувач. Пиши чітко, доброзичливо і по суті. ' +
                    'Ти памʼятаєш попередні повідомлення цієї розмови з цим користувачем. ' +
                    'Користувач може надсилати фото та відео: уважно аналізуй їх і відповідай на запитання про вміст.' +
                    (safeName ? ` Користувача звати ${safeName}.` : '');

                const result = await callGeminiResilient(contents, systemText, picked, catalog, job);
                geminiCheckCancelled(job);
                reply = {
                    id: `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    role: 'model',
                    text: result.text,
                    timestamp: Date.now(),
                    model: result.model,
                    imageId: null
                };
            }

            await geminiDbRun(
                "INSERT INTO gemini_messages (id, email, role, text, timestamp, image_id, model) VALUES (?, ?, 'model', ?, ?, ?, ?)",
                [reply.id, cleanEmail, reply.text, reply.timestamp, reply.imageId, reply.model]
            );

            finish({
                success: true,
                reply: {
                    id: reply.id,
                    role: 'model',
                    text: reply.text,
                    timestamp: reply.timestamp,
                    model: reply.model,
                    imageUrl: reply.imageId ? '/gemini-image/' + reply.imageId : null
                }
            });
        } catch (err) {
            const cancelled = err && err.message === 'CANCELLED';
            if (!cancelled) console.error('Gemini send error:', err && err.message);
            // Відкочуємо повідомлення користувача, щоб памʼять не мала "висячих" питань без відповіді
            try { await geminiDbRun("DELETE FROM gemini_messages WHERE id = ?", [userMsgId]); } catch (e) {}
            if (cancelled) {
                ackCb({ success: false, cancelled: true, error: geminiErrorText(err, picked, lang) });
            } else {
                finish({ success: false, cancelled: false, error: geminiErrorText(err, picked, lang) });
            }
        } finally {
            if (geminiJobs.get(cleanEmail) === job) geminiJobs.delete(cleanEmail);
        }
    });

    // Зупинка поточного запиту до Gemini (кнопка "стоп" у застосунку)
    socket.on('gemini_cancel', (email, callback) => {
        const cb = typeof callback === 'function' ? callback : () => {};
        const cleanEmail = geminiCleanEmail(email);
        const job = geminiJobs.get(cleanEmail);
        if (job) {
            geminiCancelJob(job);
            geminiJobs.delete(cleanEmail);
        }
        cb({ success: true });
    });

    // Очищення памʼяті Gemini (тільки для цього користувача)
    socket.on('gemini_clear', async (email, callback) => {
        const cb = typeof callback === 'function' ? callback : () => {};
        const cleanEmail = geminiCleanEmail(email);
        if (!cleanEmail) return cb({ success: false });
        try {
            await geminiDbRun("DELETE FROM gemini_messages WHERE email = ?", [cleanEmail]);
            await geminiDbRun("DELETE FROM gemini_images WHERE email = ?", [cleanEmail]);
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
