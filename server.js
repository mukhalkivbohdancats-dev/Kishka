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
// =====================================================================
const https = require('https');
const crypto = require('crypto');

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
    db.run(`CREATE INDEX IF NOT EXISTS idx_gemini_email_time ON gemini_messages (email, timestamp)`);
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
    return { cancelled: false, reqs: new Set() };
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

async function callGeminiImage(prompt, modelId, job) {
    // 1) Interactions API (так зображення генеруються за актуальною документацією)
    let res = await geminiRequest('POST', '/v1beta/interactions', {
        model: modelId,
        input: [{ type: 'text', text: prompt }]
    }, job);

    if (res.status === 200 && res.json) {
        const out = geminiExtractImage(res.json);
        if (out) return out;
        throw new Error('EMPTY_IMAGE');
    }

    // 2) Запасний шлях: класичний generateContent з режимом IMAGE
    if (res.status === 400 || res.status === 404 || res.status === 501) {
        res = await geminiRequest('POST', `/v1beta/models/${encodeURIComponent(modelId)}:generateContent`, {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
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

async function callGeminiImageResilient(prompt, modelId, job) {
    let lastErr = null;
    for (let a = 0; a < 3; a++) {
        geminiCheckCancelled(job);
        try {
            return await callGeminiImage(prompt, modelId, job);
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

function geminiErrorText(err, picked) {
    const m = err && err.message ? err.message : '';
    const s = err && err.status;
    const name = picked ? picked.label : 'Ця модель';

    if (m === 'CANCELLED') return 'Запит зупинено';
    if (m === 'NO_KEY') return 'На сервері не налаштований GEMINI_API_KEY';
    if ((s === 403 || s === 429) && picked && picked.paid) {
        return `${name} платна: ваш ключ Google не має до неї доступу (потрібен платний тариф Gemini API)`;
    }
    if (s === 403) return `Немає доступу до моделі ${name} з вашим ключем Google`;
    if (s === 404) return `Модель ${name} недоступна для вашого ключа Google`;
    if (s === 429) {
        return picked && picked.type === 'image'
            ? `Генерація зображень моделлю ${name} недоступна на вашому ключі (ліміт або платний тариф)`
            : 'Перевищено ліміт запитів до Gemini. Зачекайте хвилину і спробуйте ще раз';
    }
    if (s === 500 || s === 502 || s === 503 || s === 504) return 'Gemini зараз перевантажений. Спробуйте ще раз за хвилину';
    if (m === 'EMPTY') return 'Gemini не зміг відповісти на це повідомлення';
    if (m === 'EMPTY_IMAGE') return 'Gemini не повернув зображення (можливо, запит заблоковано фільтром безпеки). Спробуйте інший опис';
    if (m === 'BAD_RESPONSE') return 'Некоректна відповідь від Gemini';
    return 'Помилка Gemini: ' + (m || 'невідома');
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
                `SELECT id, role, text, timestamp, imageId, model FROM (
                    SELECT id, role, text, timestamp, image_id AS imageId, model FROM gemini_messages
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
                imageUrl: r.imageId ? '/gemini-image/' + r.imageId : null
            }));
            cb({ success: true, messages });
        } catch (err) {
            console.error('Gemini history error:', err.message);
            cb({ success: false, messages: [] });
        }
    });

    // Нове повідомлення до Gemini (текст або зображення залежно від моделі)
    socket.on('gemini_send', async (data, callback) => {
        const cb = typeof callback === 'function' ? callback : () => {};
        const { email, name, text, model } = data || {};
        const cleanEmail = geminiCleanEmail(email);
        const cleanText = (typeof text === 'string' ? text : '').trim();

        if (!cleanEmail || !cleanText) return cb({ success: false, error: 'Порожнє повідомлення' });
        if (cleanText.length > GEMINI_MAX_TEXT) return cb({ success: false, error: 'Повідомлення занадто довге' });
        if (geminiJobs.has(cleanEmail)) return cb({ success: false, error: 'Gemini ще відповідає на попереднє повідомлення' });

        const job = geminiMakeJob();
        geminiJobs.set(cleanEmail, job);

        const now = Date.now();
        const userMsgId = `g_${now}_${Math.random().toString(36).slice(2, 8)}`;
        let picked = null;

        try {
            const catalog = await geminiGetCatalog();
            picked = geminiPickModel(catalog, typeof model === 'string' ? model : '');
            const isImage = picked.type === 'image';

            await geminiDbRun(
                "INSERT INTO gemini_messages (id, email, role, text, timestamp) VALUES (?, ?, 'user', ?, ?)",
                [userMsgId, cleanEmail, cleanText, now]
            );

            let reply;

            if (isImage) {
                const img = await callGeminiImageResilient(cleanText, picked.id, job);
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
                    "SELECT role, text, image_id AS imageId FROM gemini_messages WHERE email = ? ORDER BY timestamp DESC, rowid DESC LIMIT ?",
                    [cleanEmail, GEMINI_CONTEXT_LIMIT]
                );
                rows.reverse();
                while (rows.length > 0 && rows[0].role !== 'user') rows.shift();

                const contents = rows.map(r => ({
                    role: r.role,
                    parts: [{ text: (((r.text || '') + (r.imageId ? ' [згенероване зображення]' : '')).trim()) || '[порожнє повідомлення]' }]
                }));

                const safeName = (typeof name === 'string' ? name : '').trim().slice(0, 60);
                const systemText =
                    'Ти — Gemini, штучний інтелект усередині месенджера Kishka. ' +
                    'Відповідай тією мовою, якою пише користувач. Пиши чітко, доброзичливо і по суті. ' +
                    'Ти памʼятаєш попередні повідомлення цієї розмови з цим користувачем.' +
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

            cb({
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
            cb({ success: false, cancelled, error: geminiErrorText(err, picked) });
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
