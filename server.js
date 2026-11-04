const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
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
    maxHttpBufferSize: 1e7,
    pingInterval: 20000,
    pingTimeout: 30000
});

// Додано кореневий маршрут для підтримання активності (keep-alive) на Render
app.get('/', (req, res) => {
    res.send('Kishka Messenger Server is active and running!');
});

// Для моніторингу (UptimeRobot тощо): показує, чи база постійна
app.get('/health', (req, res) => {
    res.json({ ok: true, time: Date.now(), database: USE_PG ? 'postgres' : 'sqlite' });
});

const busyUsers = new Set();
const userSockets = new Map();

// =====================================================================
// ===== БАЗА ДАНИХ =====
// DATABASE_URL (Neon / будь-який Postgres) задано -> дані зберігаються НАЗАВЖДИ (рекомендовано для Render Free).
// DATABASE_URL не задано -> локальний SQLite (на Render Free диск тимчасовий: дані зникають при перезапуску!).
// =====================================================================
const DATABASE_URL = process.env.DATABASE_URL || '';
const USE_PG = /^postgres(ql)?:\/\//i.test(DATABASE_URL);

// Таблиці та їхні первинні ключі (для INSERT OR REPLACE у Postgres)
const PG_PRIMARY_KEYS = {
    push_tokens: ['email', 'token'],
    gemini_media: ['media_id'],
    contact_removed: ['owner_email', 'contact_email'],
    gemini_caps: ['model_id'],
    media_blobs: ['id']
};

function pgTranslate(sql) {
    let s = String(sql).trim();
    let orIgnore = false;
    let orReplace = false;
    s = s.replace(/^INSERT\s+OR\s+IGNORE\s+INTO/i, () => { orIgnore = true; return 'INSERT INTO'; });
    s = s.replace(/^INSERT\s+OR\s+REPLACE\s+INTO/i, () => { orReplace = true; return 'INSERT INTO'; });
    if (/^ALTER\s+TABLE/i.test(s)) s = s.replace(/ADD\s+COLUMN\s+/i, 'ADD COLUMN IF NOT EXISTS ');
    if (/^CREATE\s+TABLE/i.test(s)) {
        s = s.replace(/\bINTEGER\b/g, 'BIGINT').replace(/\bBLOB\b/g, 'BYTEA');
    }
    if (/^ALTER\s+TABLE/i.test(s)) {
        s = s.replace(/\bINTEGER\b/g, 'BIGINT').replace(/\bBLOB\b/g, 'BYTEA');
    }
    if (orIgnore) {
        s += ' ON CONFLICT DO NOTHING';
    } else if (orReplace) {
        const m = s.match(/^INSERT\s+INTO\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/i);
        if (m) {
            const table = m[1].toLowerCase();
            const cols = m[2].split(',').map(c => c.trim());
            const pk = PG_PRIMARY_KEYS[table] || [cols[0]];
            const rest = cols.filter(c => !pk.includes(c));
            s += ' ON CONFLICT (' + pk.join(', ') + ') DO ' +
                (rest.length ? 'UPDATE SET ' + rest.map(c => c + ' = EXCLUDED.' + c).join(', ') : 'NOTHING');
        }
    }
    let i = 0;
    s = s.replace(/\?/g, () => '$' + (++i));
    return s;
}

function createPgDatabase() {
    const { Pool, types } = require('pg');
    types.setTypeParser(20, (v) => parseInt(v, 10));   // BIGINT -> число (а не рядок)
    types.setTypeParser(1700, (v) => parseFloat(v));

    const pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: /sslmode=disable/i.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
        max: 6,
        idleTimeoutMillis: 20000,
        connectionTimeoutMillis: 30000
    });
    // Neon зупиняє "сплячу" базу: розрив зʼєднання не повинен валити сервер
    pool.on('error', (e) => console.error('Postgres (idle):', e.message));

    let queue = Promise.resolve();
    let serial = false;

    async function query(sql, params) {
        const text = pgTranslate(sql);
        let lastErr = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                return await pool.query(text, params || []);
            } catch (e) {
                lastErr = e;
                const transient = /terminated|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|timeout|Connection/i.test(e.message || '');
                if (!transient) break;
                await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
            }
        }
        throw lastErr;
    }

    function schedule(task) {
        if (serial) {
            queue = queue.then(task, task);
            return queue;
        }
        return queue.then(task, task);
    }

    function safeCall(cb, ctx, err, arg) {
        if (typeof cb !== 'function') {
            if (err) console.error('DB:', err.message);
            return;
        }
        try {
            cb.call(ctx, err, arg);
        } catch (e) {
            console.error('DB callback:', e && e.message);
        }
    }

    const api = {
        serialize(fn) {
            serial = true;
            try { fn(); } finally { serial = false; }
        },
        run(sql, params, cb) {
            if (typeof params === 'function') { cb = params; params = []; }
            schedule(() => query(sql, params).then(
                (r) => safeCall(cb, { changes: r.rowCount || 0, lastID: 0 }, null),
                (e) => safeCall(cb, {}, e)
            ));
        },
        get(sql, params, cb) {
            if (typeof params === 'function') { cb = params; params = []; }
            schedule(() => query(sql, params).then(
                (r) => safeCall(cb, null, null, r.rows[0]),
                (e) => safeCall(cb, null, e)
            ));
        },
        all(sql, params, cb) {
            if (typeof params === 'function') { cb = params; params = []; }
            schedule(() => query(sql, params).then(
                (r) => safeCall(cb, null, null, r.rows),
                (e) => safeCall(cb, null, e)
            ));
        },
        prepare(sql) {
            const pending = [];
            return {
                run(...args) {
                    let cb = null;
                    if (typeof args[args.length - 1] === 'function') cb = args.pop();
                    pending.push(new Promise((resolve) => {
                        api.run(sql, args, function (err) { if (cb) cb(err); resolve(); });
                    }));
                },
                finalize(cb) {
                    Promise.all(pending).then(() => { if (typeof cb === 'function') cb(); });
                }
            };
        }
    };

    // Перевірка зʼєднання при старті
    query('SELECT 1').then(
        () => console.log('Успішно підключено до Postgres (дані зберігаються постійно).'),
        (e) => console.error('ПОМИЛКА підключення до Postgres:', e.message)
    );
    return api;
}

function createSqliteDatabase() {
    const sqlite3 = require('sqlite3').verbose();
    const file = process.env.SQLITE_PATH || './chat.db';
    const instance = new sqlite3.Database(file, (err) => {
        if (err) console.error('Помилка бази даних:', err.message);
        else console.log('Підключено до SQLite (' + file + ').');
    });
    console.warn('УВАГА: DATABASE_URL не задано. На Render Free диск тимчасовий: акаунти, контакти й історія ЗНИКНУТЬ при перезапуску. Підключіть Postgres (див. інструкцію).');
    return instance;
}

const db = USE_PG ? createPgDatabase() : createSqliteDatabase();

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
    // Галочки «прочитано» (час, коли отримувач побачив повідомлення) та другий учасник чату для відповідей @gemini / @chatgpt
    db.run("ALTER TABLE messages ADD COLUMN seen_at INTEGER", () => {});
    db.run("ALTER TABLE messages ADD COLUMN also_for TEXT", () => {});
    db.run("CREATE INDEX IF NOT EXISTS idx_messages_also_for ON messages (also_for, timestamp)", () => {});

    // Видалені контакти (щоб видалення дійшло й до інших пристроїв цього акаунта і контакт не «воскресав»)
    db.run(`CREATE TABLE IF NOT EXISTS contact_removed (
        owner_email TEXT NOT NULL,
        contact_email TEXT NOT NULL,
        removed_at INTEGER NOT NULL,
        PRIMARY KEY (owner_email, contact_email)
    )`);

    // Токени push-сповіщень (FCM) для доставки повідомлень, коли застосунок закритий
    db.run(`CREATE TABLE IF NOT EXISTS push_tokens (
        email TEXT NOT NULL,
        token TEXT NOT NULL,
        updated INTEGER NOT NULL,
        PRIMARY KEY (email, token)
    )`);

    // Ярлики видалених повідомлень: щоб видалення дійшло і до пристрою, який був офлайн
    db.run(`CREATE TABLE IF NOT EXISTS deleted_messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        sender_email TEXT,
        receiver_email TEXT,
        deleted_at INTEGER NOT NULL
    )`);
    db.run("CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages (sender_email, timestamp)", () => {});
    db.run("CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages (receiver_email, timestamp)", () => {});
    db.run("CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages (chat_id, timestamp)", () => {});
    db.run("CREATE INDEX IF NOT EXISTS idx_deleted_sender ON deleted_messages (sender_email, deleted_at)", () => {});
    db.run("CREATE INDEX IF NOT EXISTS idx_deleted_receiver ON deleted_messages (receiver_email, deleted_at)", () => {});

    // Копії невеликих файлів у базі (на Render Free диск тимчасовий — файли відновлюються звідси)
    db.run(`CREATE TABLE IF NOT EXISTS media_blobs (
        id TEXT PRIMARY KEY,
        data BLOB NOT NULL
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
// Файли до цього розміру додатково зберігаються в базі Postgres (переживають перезапуск Render)
const DB_MEDIA_MAX_BYTES = (parseInt(process.env.DB_MEDIA_MAX_MB || '12', 10) || 12) * 1024 * 1024;

// Гарантує, що файл є на диску: якщо диск було очищено — відновлює його з бази
function ensureMediaOnDisk(id, cb) {
    const filePath = path.join(UPLOAD_DIR, id);
    if (fs.existsSync(filePath)) return cb(true);
    if (!USE_PG) return cb(false);
    db.get("SELECT data FROM media_blobs WHERE id = ?", [id], (err, row) => {
        if (err || !row || !row.data) return cb(false);
        fs.writeFile(filePath, row.data, (wErr) => cb(!wErr));
    });
}

function ensureMediaOnDiskAsync(id) {
    return new Promise((resolve) => ensureMediaOnDisk(id, resolve));
}

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
                const respond = () => res.json({ success: true, id, url: '/media/' + id, mime, size, name: fileName });
                if (USE_PG && size > 0 && size <= DB_MEDIA_MAX_BYTES) {
                    fs.readFile(filePath, (rErr, buf) => {
                        if (rErr) return respond();
                        db.run("INSERT INTO media_blobs (id, data) VALUES (?, ?)", [id, buf], () => respond());
                    });
                } else {
                    respond();
                }
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
        ensureMediaOnDisk(id, (ok) => {
            if (!ok) return res.status(404).send('Not found');
            res.sendFile(path.join(UPLOAD_DIR, id), (sendErr) => {
                if (sendErr && !res.headersSent) res.status(404).end();
            });
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

function geminiCleanEmailEarly(email) {
    return (typeof email === 'string' ? email : '').trim().toLowerCase();
}

function mediaPreviewText(text, fileType) {
    if (text) return text;
    if (fileType === 'video') return 'Video';
    if (fileType === 'image') return 'Photo';
    if (fileType === 'file') return 'File';
    return '';
}

// Стан активних дзвінків (для відновлення після короткого розриву мережі)
const activeCalls = new Map();   // email -> email співрозмовника
const callGrace = new Map();     // email -> timer
const CALL_GRACE_MS = 12000;
const ringTimers = new Map();    // "caller|receiver" -> timer (дзвінок без відповіді завершується сам)
const RING_TIMEOUT_MS = 60000;

function clearRingTimer(a, b) {
    [a + '|' + b, b + '|' + a].forEach((key) => {
        const t = ringTimers.get(key);
        if (t) { clearTimeout(t); ringTimers.delete(key); }
    });
}

// Повністю очищає стан дзвінка двох користувачів
function finishCall(a, b) {
    [a, b].forEach((e) => {
        if (!e) return;
        busyUsers.delete(e);
        activeCalls.delete(e);
        const g = callGrace.get(e);
        if (g) { clearTimeout(g); callGrace.delete(e); }
    });
    if (a && b) clearRingTimer(a, b);
}

function userIsOnline(email) {
    const room = io.sockets.adapter.rooms.get(email);
    return !!(room && room.size > 0);
}

// Захист від "завислих" станів: зайнятий, але дзвінка немає
setInterval(() => {
    busyUsers.forEach((e) => { if (!activeCalls.has(e)) busyUsers.delete(e); });
}, 5 * 60 * 1000);

// ===================== ЗАПИСИ ПРО ДЗВІНКИ У ЧАТІ + СЛУЖБОВІ ПОВІДОМЛЕННЯ =====================
// Той самий алгоритм, що й у застосунку (KishkaManager.chatIdFor)
function serverChatIdFor(a, b) {
    const e1 = String(a || '').trim().toLowerCase().replace(/\./g, '_dot_');
    const e2 = String(b || '').trim().toLowerCase().replace(/\./g, '_dot_');
    return e1 < e2 ? `${e1}_${e2}` : `${e2}_${e1}`;
}

// Записує повідомлення в базу і надсилає його ВСІМ учасникам (кожному — зі своїм receiverEmail)
async function serverDeliverMessage(msg, recipients) {
    await geminiDbRun(
        'INSERT INTO messages (id, chat_id, sender_email, receiver_email, text, timestamp, also_for) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [msg.id, msg.chatId, msg.senderEmail, msg.receiverEmail, msg.text, msg.timestamp, msg.alsoFor || null]
    );
    recipients.forEach((rcv) => {
        io.to(rcv).emit('receive_message', {
            id: msg.id, chatId: msg.chatId, senderEmail: msg.senderEmail, receiverEmail: rcv, text: msg.text,
            timestamp: msg.timestamp, fileUrl: msg.fileUrl || null, fileType: msg.fileType || null, thumbUrl: null, fileName: null
        });
    });
}

// Дзвінок: caller|receiver -> { caller, receiver, startedAt, answeredAt }
const callMeta = new Map();
function takeCallMeta(a, b) {
    const k1 = a + '|' + b;
    const k2 = b + '|' + a;
    const meta = callMeta.get(k1) || callMeta.get(k2) || null;
    callMeta.delete(k1);
    callMeta.delete(k2);
    return meta;
}

// status: ended (з тривалістю) | cancelled (дзвонивший скинув до відповіді) | missed (ніхто не відповів) |
//         declined (абонент відхилив) | unavailable (абонент не в мережі)
// Текст запису: [[call:статус:секунди]] — застосунок показує його як «Пропущений виклик», «Виклик 2:15» тощо.
function recordCall(caller, receiver, status, durationSec) {
    if (!caller || !receiver) return;
    const now = Date.now();
    const id = 'call_' + now + '_' + crypto.randomBytes(4).toString('hex');
    const text = '[[call:' + status + ':' + Math.max(0, Math.round(durationSec || 0)) + ']]';
    serverDeliverMessage(
        { id, chatId: serverChatIdFor(caller, receiver), senderEmail: caller, receiverEmail: receiver, text, timestamp: now },
        [caller, receiver]
    ).catch((e) => console.error('Запис про дзвінок:', e.message));
}

setInterval(() => {
    const cutoff = Date.now() - 3 * 3600 * 1000;
    callMeta.forEach((m, k) => { if (m.startedAt < cutoff) callMeta.delete(k); });
}, 30 * 60 * 1000);

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
        // Щоб у контактів завжди був «останній раз у мережі» (а не порожньо)
        geminiDbRun('INSERT OR IGNORE INTO user_presence (email, last_seen, online, updated) VALUES (?, ?, 0, ?)', [cleanEmail, Date.now(), Date.now()]).catch(() => {});
    });

    socket.on('get_user_profile', (email, callback) => {
        const safeCallback = typeof callback === 'function' ? callback : () => {};
        if (!email || typeof email !== 'string') return safeCallback(null);
        
        const cleanEmail = email.trim().toLowerCase();
        socket.userEmail = cleanEmail;
        userSockets.set(cleanEmail, socket.id);
        socket.join(cleanEmail);
        
        db.get("SELECT email, name, avatar_url as \"avatarUrl\" FROM users WHERE email = ?", [cleanEmail], (err, row) => {
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

    // Додати контакт можна лише того, хто вже зареєстрований у Kishka (хоча б раз входив у застосунок)
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

        if (!cleanMy || !cleanTarget || !cleanTarget.includes('@') || cleanMy === cleanTarget) {
            return safeCallback({ success: false, code: 'invalid', message: "Invalid address or adding yourself" });
        }

        db.get("SELECT email, name, avatar_url AS \"avatarUrl\" FROM users WHERE email = ?", [cleanTarget], (err, targetUser) => {
            if (err) return safeCallback({ success: false, code: 'error', message: "Database error" });
            if (!targetUser) {
                return safeCallback({ success: false, code: 'not_found', message: "User is not registered in Kishka" });
            }

            db.run("DELETE FROM contact_removed WHERE owner_email = ? AND contact_email = ?", [cleanMy, cleanTarget], () => {});
            db.run("DELETE FROM contact_removed WHERE owner_email = ? AND contact_email = ?", [cleanTarget, cleanMy], () => {});
            const stmt = db.prepare("INSERT OR IGNORE INTO contacts (owner_email, contact_email) VALUES (?, ?)");
            stmt.run(cleanMy, cleanTarget);
            stmt.run(cleanTarget, cleanMy);
            stmt.finalize(() => {
                io.to(cleanMy).emit('contact_updated');
                io.to(cleanTarget).emit('contact_updated');
                safeCallback({ success: true, user: targetUser, message: "Contact added" });
            });
        });
    });

    // Пристрій надсилає свої збережені контакти: якщо сервер "забув" їх (перезапуск), вони відновлюються.
    // Додаються лише користувачі, які зареєстровані в Kishka.
    socket.on('sync_contacts', (data, callback) => {
        const safeCallback = typeof callback === 'function' ? callback : () => {};
        const { myEmail, contacts } = data || {};
        const cleanMy = (typeof myEmail === 'string' ? myEmail : '').trim().toLowerCase();
        if (!cleanMy || !Array.isArray(contacts)) return safeCallback({ success: false });

        socket.userEmail = cleanMy;
        userSockets.set(cleanMy, socket.id);
        socket.join(cleanMy);

        const wanted = Array.from(new Set(
            contacts.map((c) => (typeof c === 'string' ? c : '').trim().toLowerCase())
                .filter((c) => c && c.includes('@') && c !== cleanMy)
        )).slice(0, 500);

        if (wanted.length === 0) return safeCallback({ success: true, added: 0 });

        const placeholders = wanted.map(() => '?').join(',');
        db.all("SELECT email FROM users WHERE email IN (" + placeholders + ")", wanted, (err, rows) => {
            if (err || !rows || rows.length === 0) return safeCallback({ success: true, added: 0 });
            // Контакти, які користувач видалив, не повертаємо (інший пристрій міг ще їх пам'ятати)
            db.all("SELECT contact_email FROM contact_removed WHERE owner_email = ?", [cleanMy], (rmErr, rmRows) => {
                const removed = new Set((rmRows || []).map((r) => r.contact_email));
                const existing = rows.map((r) => r.email).filter((e) => !removed.has(e));
                if (existing.length === 0) return safeCallback({ success: true, added: 0 });
                const stmt = db.prepare("INSERT OR IGNORE INTO contacts (owner_email, contact_email) VALUES (?, ?)");
                existing.forEach((email) => {
                    stmt.run(cleanMy, email);
                    stmt.run(email, cleanMy);
                });
                stmt.finalize(() => {
                    existing.forEach((email) => io.to(email).emit('contact_updated'));
                    safeCallback({ success: true, added: existing.length });
                });
            });
        });
    });

    socket.on('get_contacts', (myEmail, callback) => {
        const safeCallback = typeof callback === 'function' ? callback : () => {};
        if (!myEmail || typeof myEmail !== 'string') return safeCallback({ success: false, contacts: [] });
        const cleanEmail = myEmail.trim().toLowerCase();
        socket.userEmail = cleanEmail;
        userSockets.set(cleanEmail, socket.id);
        socket.join(cleanEmail);

        const query = `
            SELECT u.email, u.name, u.avatar_url AS "avatarUrl"
            FROM contacts c
            JOIN users u ON c.contact_email = u.email
            WHERE c.owner_email = ?
        `;
        db.all(query, [cleanEmail], (err, rows) => {
            // Помилка бази НЕ має виглядати як "контактів немає"
            if (err) return safeCallback({ success: false, contacts: [] });
            db.all("SELECT contact_email FROM contact_removed WHERE owner_email = ?", [cleanEmail], (rmErr, rmRows) => {
                safeCallback({ success: true, contacts: rows || [], removed: (rmRows || []).map((r) => r.contact_email) });
            });
        });
    });

    socket.on('join_chat', (data) => {
        const chatId = typeof data === 'string' ? data : (data ? data.chatId : null);
        if (!chatId) return;
        socket.join(chatId);

        db.all(
            "SELECT id, chat_id AS \"chatId\", sender_email AS \"senderEmail\", receiver_email AS \"receiverEmail\", text, timestamp, file_url AS \"fileUrl\", file_type AS \"fileType\", thumb_url AS \"thumbUrl\", file_name AS \"fileName\", seen_at AS \"seenAt\" FROM messages WHERE chat_id = ? ORDER BY timestamp ASC",
            [chatId],
            (err, rows) => {
                if (!err) socket.emit('load_history', rows || []);
            }
        );
        db.all("SELECT id FROM deleted_messages WHERE chat_id = ?", [chatId], (err, rows) => {
            if (!err) socket.emit('load_deleted', { chatId, ids: (rows || []).map((r) => r.id) });
        });
    });

    // Усі повідомлення користувача, що надійшли, поки він був офлайн (для всіх чатів, не лише відкритого)
    socket.on('sync_messages', (data, callback) => {
        const safeCallback = typeof callback === 'function' ? callback : () => {};
        const email = geminiCleanEmailEarly(data && data.email);
        const since = Math.max(0, Number(data && data.since) || 0);
        if (!email) return safeCallback({ success: false, messages: [] });
        socket.userEmail = email;
        userSockets.set(email, socket.id);
        socket.join(email);
        db.all(
            "SELECT id, chat_id AS \"chatId\", sender_email AS \"senderEmail\", receiver_email AS \"receiverEmail\", text, timestamp, file_url AS \"fileUrl\", file_type AS \"fileType\", thumb_url AS \"thumbUrl\", file_name AS \"fileName\", seen_at AS \"seenAt\" FROM messages WHERE (sender_email = ? OR receiver_email = ? OR also_for = ?) AND timestamp > ? ORDER BY timestamp ASC LIMIT 5000",
            [email, email, email, since],
            (err, rows) => {
                if (err) return safeCallback({ success: false, messages: [] });
                safeCallback({ success: true, messages: rows || [] });
            }
        );
    });

    // Які повідомлення були видалені на сервері (щоб видалити їх і на цьому пристрої)
    socket.on('sync_deleted', (data, callback) => {
        const safeCallback = typeof callback === 'function' ? callback : () => {};
        const email = geminiCleanEmailEarly(data && data.email);
        const since = Math.max(0, Number(data && data.since) || 0);
        if (!email) return safeCallback({ success: false, deleted: [] });
        db.all(
            "SELECT id, chat_id AS \"chatId\", deleted_at AS \"deletedAt\" FROM deleted_messages WHERE (sender_email = ? OR receiver_email = ?) AND deleted_at > ? ORDER BY deleted_at ASC LIMIT 5000",
            [email, email, since],
            (err, rows) => {
                if (err) return safeCallback({ success: false, deleted: [] });
                safeCallback({ success: true, deleted: rows || [] });
            }
        );
    });

    socket.on('leave_chat', (chatId) => {
        if (chatId) socket.leave(chatId);
    });

    // Отримувач побачив повідомлення: відправнику приходять дві фіолетові галочки (як у Viber)
    socket.on('messages_seen', async (data) => {
        const reader = geminiCleanEmailEarly(data && data.reader);
        const peer = geminiCleanEmailEarly(data && data.peer);
        const chatId = data && typeof data.chatId === 'string' ? data.chatId : '';
        if (!reader || !peer || !chatId) return;
        try {
            const now = Date.now();
            const rows = await geminiDbAll(
                'SELECT id FROM messages WHERE chat_id = ? AND receiver_email = ? AND sender_email = ? AND seen_at IS NULL',
                [chatId, reader, peer]
            );
            if (!rows.length) return;
            await geminiDbRun(
                'UPDATE messages SET seen_at = ? WHERE chat_id = ? AND receiver_email = ? AND sender_email = ? AND seen_at IS NULL',
                [now, chatId, reader, peer]
            );
            io.to(peer).emit('messages_seen', { chatId, reader, ids: rows.map(r => r.id), seenAt: now });
        } catch (e) {
            console.error('messages_seen:', e.message);
        }
    });

    // Видалення контакту ЛИШЕ у того, хто його видаляє (у співрозмовника контакт лишається)
    socket.on('delete_contact', async (data, callback) => {
        const cb = typeof callback === 'function' ? callback : () => {};
        const me = geminiCleanEmailEarly(data && data.myEmail);
        const other = geminiCleanEmailEarly(data && data.contactEmail);
        if (!me || !other) return cb({ success: false });
        try {
            await geminiDbRun('DELETE FROM contacts WHERE owner_email = ? AND contact_email = ?', [me, other]);
            await geminiDbRun('INSERT OR REPLACE INTO contact_removed (owner_email, contact_email, removed_at) VALUES (?, ?, ?)', [me, other, Date.now()]);
            io.to(me).emit('contact_updated');
            cb({ success: true });
        } catch (e) {
            console.error('delete_contact:', e.message);
            cb({ success: false });
        }
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
                // Підтвердження відправнику: повідомлення збережено (або вже було збережене раніше)
                const duplicate = !!(err && /unique|constraint|duplicate/i.test(err.message || ''));
                socket.emit('message_ack', { id: msgId, ok: !err || duplicate });
                if (err) return;
                const newMessage = {
                    id: msgId, chatId, senderEmail, receiverEmail, text: safeText, timestamp: msgTimestamp,
                    fileUrl: safeFileUrl, fileType: safeFileType, thumbUrl: safeThumbUrl, fileName: safeFileName
                };

                io.to(chatId).emit('receive_message', newMessage);
                if (senderEmail) {
                    io.to(String(senderEmail).trim().toLowerCase()).emit('receive_message', newMessage);
                }
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

    // Видалення для всіх: дозволено ЛИШЕ автору повідомлення. Чужі повідомлення видалити неможливо.
    socket.on('delete_message', (data) => {
        const { messageId, chatId, requesterEmail } = data || {};
        if (!messageId || !chatId) return;
        const requester = (typeof requesterEmail === 'string' && requesterEmail ? requesterEmail : (socket.userEmail || '')).trim().toLowerCase();
        if (!requester) return;

        db.get("SELECT sender_email, receiver_email, file_url, thumb_url FROM messages WHERE id = ? AND chat_id = ?", [messageId, chatId], (selErr, row) => {
            if (selErr || !row) return;
            const author = (row.sender_email || '').trim().toLowerCase();
            if (author !== requester) return;
            const receiver = (row.receiver_email || '').trim().toLowerCase();

            db.run("DELETE FROM messages WHERE id = ?", [messageId], (err) => {
                if (err) return;
                db.run(
                    "INSERT OR IGNORE INTO deleted_messages (id, chat_id, sender_email, receiver_email, deleted_at) VALUES (?, ?, ?, ?, ?)",
                    [messageId, chatId, author, receiver, Date.now()],
                    () => {}
                );
                // Сигнал на видалення отримують обидва учасники (і в чаті, і на інших пристроях)
                const payload = { messageId, chatId };
                let target = io.to(chatId);
                if (author) target = target.to(author);
                if (receiver) target = target.to(receiver);
                target.emit('message_deleted', payload);

                // Файл видаляємо лише якщо на нього більше не посилається жодне повідомлення (його могли переслати)
                [row.file_url, row.thumb_url].forEach((u) => {
                    const m = typeof u === 'string' ? u.match(/^\/media\/([a-zA-Z0-9_-]+)$/) : null;
                    if (!m) return;
                    db.get("SELECT COUNT(*) AS n FROM messages WHERE file_url = ? OR thumb_url = ?", [u, u], (cErr, cRow) => {
                        if (cErr || (cRow && cRow.n > 0)) return;
                        db.run("DELETE FROM media_files WHERE id = ?", [m[1]], () => {});
                        db.run("DELETE FROM media_blobs WHERE id = ?", [m[1]], () => {});
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

        const cleanCaller = String(callerEmail).trim().toLowerCase();
        const cleanReceiver = String(receiverEmail).trim().toLowerCase();
        if (!cleanCaller || !cleanReceiver || cleanCaller === cleanReceiver) return;

        socket.userEmail = cleanCaller;
        userSockets.set(cleanCaller, socket.id);
        socket.join(cleanCaller);

        if (busyUsers.has(cleanReceiver) || busyUsers.has(cleanCaller)) {
            io.to(cleanCaller).emit(`call_busy_${cleanCaller}`, { callerEmail: cleanCaller, receiverEmail: cleanReceiver });
            return;
        }

        // Абонент не в мережі: повідомляємо про це окремою подією (а не "лінія зайнята")
        if (!userIsOnline(cleanReceiver)) {
            io.to(cleanCaller).emit(`call_unavailable_${cleanCaller}`, { callerEmail: cleanCaller, receiverEmail: cleanReceiver });
            recordCall(cleanCaller, cleanReceiver, 'unavailable', 0);
            return;
        }

        busyUsers.add(cleanCaller);
        busyUsers.add(cleanReceiver);
        socket.myCallEmails = [cleanCaller, cleanReceiver];
        activeCalls.set(cleanCaller, cleanReceiver);
        activeCalls.set(cleanReceiver, cleanCaller);
        callMeta.set(cleanCaller + '|' + cleanReceiver, { caller: cleanCaller, receiver: cleanReceiver, startedAt: Date.now(), answeredAt: 0 });

        // Якщо ніхто не відповів за 60 секунд — дзвінок завершується на обох пристроях
        clearRingTimer(cleanCaller, cleanReceiver);
        ringTimers.set(cleanCaller + '|' + cleanReceiver, setTimeout(() => {
            ringTimers.delete(cleanCaller + '|' + cleanReceiver);
            const metaTimeout = takeCallMeta(cleanCaller, cleanReceiver);
            if (metaTimeout && !metaTimeout.answeredAt) recordCall(cleanCaller, cleanReceiver, 'missed', 0);
            finishCall(cleanCaller, cleanReceiver);
            io.to(cleanCaller).emit(`call_ended_${cleanCaller}`, { reason: 'no_answer' });
            io.to(cleanReceiver).emit(`call_ended_${cleanReceiver}`, { reason: 'no_answer' });
        }, RING_TIMEOUT_MS));

        db.get("SELECT name, avatar_url AS \"avatarUrl\" FROM users WHERE email = ?", [cleanCaller], (err, row) => {
            io.to(cleanReceiver).emit(`incoming_call_${cleanReceiver}`, {
                callerEmail: cleanCaller,
                receiverEmail: cleanReceiver,
                callerName: (row && row.name) ? row.name : cleanCaller.split('@')[0],
                callerAvatar: (row && row.avatarUrl) ? row.avatarUrl : ''
            });
        });
    });

    socket.on('answer_call', (data) => {
        const { callerEmail, receiverEmail } = data || {};
        const cleanCaller = String(callerEmail || '').trim().toLowerCase();
        const cleanReceiver = String(receiverEmail || '').trim().toLowerCase();
        if (!cleanCaller || !cleanReceiver) return;

        // Дзвінок уже завершено (таймаут або скасування) — повідомляємо тому, хто відповів
        if (activeCalls.get(cleanReceiver) !== cleanCaller) {
            io.to(cleanReceiver).emit(`call_ended_${cleanReceiver}`, { reason: 'gone' });
            return;
        }

        clearRingTimer(cleanCaller, cleanReceiver);
        busyUsers.add(cleanCaller);
        busyUsers.add(cleanReceiver);
        activeCalls.set(cleanCaller, cleanReceiver);
        activeCalls.set(cleanReceiver, cleanCaller);
        const metaAnswer = callMeta.get(cleanCaller + '|' + cleanReceiver);
        if (metaAnswer && !metaAnswer.answeredAt) metaAnswer.answeredAt = Date.now();

        io.to(cleanCaller).emit(`call_answered_${cleanCaller}`, { callerEmail: cleanCaller, receiverEmail: cleanReceiver });
    });

    socket.on('reject_call', (data) => {
        const { callerEmail, receiverEmail } = data || {};
        const cleanCaller = String(callerEmail || '').trim().toLowerCase();
        const cleanReceiver = String(receiverEmail || '').trim().toLowerCase();

        const metaReject = takeCallMeta(cleanCaller, cleanReceiver);
        if (metaReject && !metaReject.answeredAt) recordCall(metaReject.caller, metaReject.receiver, 'declined', 0);
        finishCall(cleanCaller, cleanReceiver);
        if (cleanCaller) io.to(cleanCaller).emit(`call_rejected_${cleanCaller}`, { callerEmail: cleanCaller, receiverEmail: cleanReceiver });
        // Інші пристрої того, хто відхилив, теж припиняють дзвонити
        if (cleanReceiver) io.to(cleanReceiver).emit(`call_ended_${cleanReceiver}`, { reason: 'rejected' });
    });

    socket.on('end_call', (data) => {
        const { callerEmail, receiverEmail } = data || {};
        const cleanCaller = String(callerEmail || '').trim().toLowerCase();
        const cleanReceiver = String(receiverEmail || '').trim().toLowerCase();

        const metaEnd = takeCallMeta(cleanCaller, cleanReceiver);
        if (metaEnd) {
            if (metaEnd.answeredAt) {
                recordCall(metaEnd.caller, metaEnd.receiver, 'ended', (Date.now() - metaEnd.answeredAt) / 1000);
            } else {
                // До відповіді завершив той, хто дзвонив — «скасований»; якщо завершив абонент — «відхилений»
                const by = socket.userEmail || '';
                recordCall(metaEnd.caller, metaEnd.receiver, by === metaEnd.receiver ? 'declined' : 'cancelled', 0);
            }
        }
        finishCall(cleanCaller, cleanReceiver);
        if (cleanCaller) io.to(cleanCaller).emit(`call_ended_${cleanCaller}`, {});
        if (cleanReceiver) io.to(cleanReceiver).emit(`call_ended_${cleanReceiver}`, {});
    });

    socket.on('voice_chunk', (data) => {
        const { targetEmail, chunk } = data || {};
        if (!targetEmail || !chunk) return;
        const cleanTarget = targetEmail.trim().toLowerCase();
        // volatile: якщо мережа клієнта «забита», застарілі пакети голосу відкидаються, а не накопичуються (інакше за 10+ хв звук «ламається»)
        const voiceRoom = io.to(cleanTarget);
        (voiceRoom.volatile || voiceRoom).emit(`voice_chunk_${cleanTarget}`, chunk);
    });

    // ---------- Відео в дзвінку (камера / екран телефона): H.264 кадри бінарно, без перекодування на сервері ----------
    // video_frame — кадри (volatile: застарілі кадри відкидаються, а не накопичуються, тож затримка не росте).
    // video_ctl   — службові повідомлення: стан відео (увімк/вимк, розмір, поворот) і запит ключового кадра.
    socket.on('video_frame', (data, ack) => {
        // ack потрібен відправнику для контролю затору: він бачить, скільки кадрів ще «в дорозі», і знижує бітрейт, якщо мережа слабка
        if (typeof ack === 'function') { try { ack(); } catch (e) {} }
        const { targetEmail, chunk } = data || {};
        if (!targetEmail || !chunk) return;
        if (chunk.length !== undefined && chunk.length > 2 * 1024 * 1024) return;
        const cleanTarget = String(targetEmail).trim().toLowerCase();
        const room = io.to(cleanTarget);
        (room.volatile || room).emit(`video_frame_${cleanTarget}`, chunk);
    });

    socket.on('video_ctl', (data) => {
        const { targetEmail, ctl } = data || {};
        if (!targetEmail || !ctl || typeof ctl !== 'object') return;
        const cleanTarget = String(targetEmail).trim().toLowerCase();
        const safe = {
            type: String(ctl.type || '').slice(0, 16),
            on: !!ctl.on,
            source: ctl.source === 'screen' ? 'screen' : 'camera',
            w: Math.max(0, Math.min(8192, parseInt(ctl.w, 10) || 0)),
            h: Math.max(0, Math.min(8192, parseInt(ctl.h, 10) || 0)),
            rot: [0, 90, 180, 270].includes(parseInt(ctl.rot, 10)) ? parseInt(ctl.rot, 10) : 0
        };
        io.to(cleanTarget).emit(`video_ctl_${cleanTarget}`, safe);
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
                if (userSockets.has(email) || userIsOnline(email)) return;
                const metaGrace = takeCallMeta(email, peer);
                if (metaGrace) {
                    recordCall(metaGrace.caller, metaGrace.receiver, metaGrace.answeredAt ? 'ended' : 'cancelled',
                        metaGrace.answeredAt ? (Date.now() - metaGrace.answeredAt) / 1000 : 0);
                }
                finishCall(email, peer);
                io.to(peer).emit(`call_ended_${peer}`, {});
            }, CALL_GRACE_MS));
        } else if (socket.myCallEmails && !(email && activeCalls.has(email))) {
            socket.myCallEmails.forEach(e => busyUsers.delete(e));
        }
        console.log('Клієнт відключився');
    });
});

// =====================================================================
// ===== ПРИСУТНІСТЬ: «в мережі» / «був(-ла) в мережі 3 хв тому» — зберігається в базі (Neon) =====
// Користувач вважається «в мережі», коли застосунок відкритий на екрані (застосунок надсилає presence_state).
// Фонова служба, яка просто тримає сокет для сповіщень, «в мережі» не робить.
// Події: presence_state {email, active}; get_presence {email} -> {presence: {email: {online, lastSeen}}};
//        presence_changed {email, online, lastSeen} — надсилається всім, у кого цей користувач у контактах.
// =====================================================================
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS user_presence (
        email TEXT PRIMARY KEY,
        last_seen INTEGER NOT NULL,
        online INTEGER NOT NULL DEFAULT 0,
        updated INTEGER NOT NULL
    )`);
    // Після перезапуску сервера жодного сокета немає: усіх вважаємо офлайн (час останньої активності вже збережений)
    db.run('UPDATE user_presence SET online = 0');
});

const presenceActive = new Map();   // email -> Set(socket.id), у яких застосунок зараз на екрані

function presenceIsOnline(email) {
    const set = presenceActive.get(email);
    return !!(set && set.size > 0);
}

async function presenceSave(email, online) {
    const now = Date.now();
    try {
        await geminiDbRun(
            'INSERT INTO user_presence (email, last_seen, online, updated) VALUES (?, ?, ?, ?) ' +
            'ON CONFLICT(email) DO UPDATE SET last_seen = excluded.last_seen, online = excluded.online, updated = excluded.updated',
            [email, now, online ? 1 : 0, now]
        );
    } catch (e) {
        console.error('Presence save:', e.message);
    }
    return now;
}

async function presenceBroadcast(email, online, lastSeen) {
    try {
        const rows = await geminiDbAll('SELECT owner_email FROM contacts WHERE contact_email = ?', [email]);
        rows.forEach((r) => io.to(r.owner_email).emit('presence_changed', { email, online, lastSeen }));
    } catch (e) {
        console.error('Presence broadcast:', e.message);
    }
}

async function presenceSet(socket, email, active) {
    const before = presenceIsOnline(email);
    let set = presenceActive.get(email);
    if (active) {
        if (!set) { set = new Set(); presenceActive.set(email, set); }
        set.add(socket.id);
    } else if (set) {
        set.delete(socket.id);
        if (set.size === 0) presenceActive.delete(email);
    }
    const after = presenceIsOnline(email);
    if (before !== after) {
        const ts = await presenceSave(email, after);
        presenceBroadcast(email, after, ts);
    }
}

// Поки користувач в мережі, раз на хвилину оновлюємо «останню активність» — якщо сервер впаде, час буде майже точним
setInterval(() => {
    const now = Date.now();
    presenceActive.forEach((set, email) => {
        geminiDbRun('UPDATE user_presence SET last_seen = ?, updated = ? WHERE email = ?', [now, now, email]).catch(() => {});
    });
}, 60 * 1000);

io.on('connection', (socket) => {
    socket.on('presence_state', async (data) => {
        const email = geminiCleanEmailEarly(data && data.email);
        if (!email) return;
        if (socket.presenceEmail && socket.presenceEmail !== email) {
            await presenceSet(socket, socket.presenceEmail, false);
        }
        socket.presenceEmail = email;
        socket.join(email);
        await presenceSet(socket, email, !!(data && data.active));
    });

    socket.on('get_presence', async (data, callback) => {
        const cb = typeof callback === 'function' ? callback : () => {};
        const me = geminiCleanEmailEarly(data && data.email);
        if (!me) return cb({ success: false, presence: {} });
        try {
            const rows = await geminiDbAll(
                'SELECT p.email AS email, p.last_seen AS "lastSeen" FROM contacts c JOIN user_presence p ON p.email = c.contact_email WHERE c.owner_email = ?',
                [me]
            );
            const presence = {};
            rows.forEach((r) => {
                presence[r.email] = { online: presenceIsOnline(r.email), lastSeen: Number(r.lastSeen) || 0 };
            });
            cb({ success: true, presence });
        } catch (e) {
            console.error('get_presence:', e.message);
            cb({ success: false, presence: {} });
        }
    });

    socket.on('disconnect', () => {
        if (socket.presenceEmail) presenceSet(socket, socket.presenceEmail, false);
    });
});

// =====================================================================
// ===== GEMINI (ДОДАНО): моделі, зображення, зупинка запиту, памʼять ШІ =====
// Існуючі події (повідомлення, контакти, дзвінки) НЕ змінені.
//
// Environment (Render -> Environment):
//   GEMINI_API_KEY        — ключ з Google AI Studio (обовʼязково)
//   GEMINI_MODEL          — модель, яка береться ЛИШЕ коли користувач не вибрав жодної (необовʼязково, напр. gemini-3.8-flash)
//   GEMINI_FALLBACK_MODEL — запасна модель, теж лише коли користувач не вибирав модель (необовʼязково)
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
// Модель, яку користувач вибрав у застосунку, використовується ТОЧНО вона: жодних тихих підмін на іншу.
// Міркування не обмежені (thinkingBudget = -1), відповідь надходить потоком, щоб Google не обривав довгі запити.

// ---------------------------------------------------------------------
// КАТАЛОГ МОДЕЛЕЙ (усі моделі зі списку AI Studio, які працюють як чат / генерація зображень).
// paid: true  — у AI Studio позначені "Paid" (потрібен платний ключ Gemini API).
// type: 'text' | 'image' | 'audio' | 'video' | 'agent'.   noSystem: модель не підтримує system instruction (Gemma).
// ---------------------------------------------------------------------
const GEMINI_CATALOG = [
    // ----- Текстові (чат, аналіз фото/відео) -----
    { id: 'gemini-4-argon',                          label: 'Gemini 4 Argon',                    type: 'text',  paid: true,  note: 'Найпотужніша модель' },
    { id: 'gemini-3.8-flash',                        label: 'Gemini 3.8 Flash',                  type: 'text',  paid: false, note: 'Найрозумніша Flash-модель' },
    { id: 'gemini-3.6-flash',                        label: 'Gemini 3.6 Flash',                  type: 'text',  paid: true,  note: 'Попереднє покоління Flash' },
    { id: 'gemini-3.5-flash',                        label: 'Gemini 3.5 Flash',                  type: 'text',  paid: false, note: 'Швидка Flash-модель (за замовчуванням для @gemini)' },
    { id: 'gemini-3.5-flash-lite',                   label: 'Gemini 3.5 Flash-Lite',             type: 'text',  paid: false, note: 'Найшвидша' },
    { id: 'gemini-3.1-pro-preview',                  label: 'Gemini 3.1 Pro Preview',            type: 'text',  paid: false, note: 'Складні завдання та код' },
    { id: 'gemini-3.1-flash-lite',                   label: 'Gemini 3.1 Flash-Lite',             type: 'text',  paid: false, note: 'Легка та швидка' },
    { id: 'gemini-3-flash-preview',                  label: 'Gemini 3 Flash Preview',            type: 'text',  paid: true,  note: 'Застаріла Flash' },
    { id: 'gemini-pro-latest',                       label: 'Gemini Pro Latest',                 type: 'text',  paid: false, note: 'Завжди остання Pro' },
    { id: 'gemini-flash-latest',                     label: 'Gemini Flash Latest',               type: 'text',  paid: false, note: 'Завжди остання Flash' },
    { id: 'gemini-flash-lite-latest',                label: 'Gemini Flash-Lite Latest',          type: 'text',  paid: false, note: 'Завжди остання Flash-Lite' },
    { id: 'gemini-robotics-er-2-preview',            label: 'Gemini Robotics-ER 2 Preview',      type: 'text',  paid: false, note: 'Розуміння простору та відео', special: true },
    { id: 'gemini-robotics-er-2-streaming-preview',  label: 'Gemini Robotics-ER 2 Streaming',    type: 'text',  paid: false, note: 'Швидкий потоковий режим', special: true },
    { id: 'gemma-4-31b-it',                          label: 'Gemma 4 31B IT',                    type: 'text',  paid: false, note: 'Відкрита модель Gemma', noSystem: true },
    { id: 'gemma-4-26b-a4b-it',                      label: 'Gemma 4 26B A4B IT',                type: 'text',  paid: false, note: 'Відкрита модель Gemma (MoE)', noSystem: true },
    { id: 'gemini-3.5-transcribe',                   label: 'Gemini 3.5 Transcribe',             type: 'text',  paid: false, note: 'Розпізнавання мовлення з відео', special: true, transcribe: true },
    // ----- Генерація зображень -----
    { id: 'gemini-nano-banana-2.1',                  label: 'Nano Banana 2.1',                   type: 'image', paid: true,  note: 'Найкраща якість, до 4K' },
    { id: 'gemini-3.1-flash-lite-image',             label: 'Nano Banana 2 Lite',                type: 'image', paid: false, note: 'Найшвидша' },
    { id: 'gemini-3.1-flash-image',                  label: 'Nano Banana 2',                     type: 'image', paid: true,  note: 'Збалансована' },
    { id: 'gemini-3-pro-image',                      label: 'Nano Banana Pro',                   type: 'image', paid: true,  note: 'Професійна' },
    { id: 'gemini-2.5-flash-image',                  label: 'Nano Banana',                       type: 'image', paid: true,  note: 'Перша версія' },
    // ----- Озвучка тексту (повертає аудіо) -----
    { id: 'gemini-3.8-flash-tts',                    label: 'Gemini 3.8 Flash TTS',              type: 'audio', paid: false, note: 'Озвучка тексту', audioKind: 'tts' },
    { id: 'gemini-3.8-flash-lite-tts',               label: 'Gemini 3.8 Flash Lite TTS',         type: 'audio', paid: false, note: 'Швидка озвучка', audioKind: 'tts' },
    { id: 'gemini-3.1-flash-tts-preview',            label: 'Gemini 3.1 Flash TTS Preview',      type: 'audio', paid: false, note: 'Озвучка з низькою затримкою', audioKind: 'tts' },
    { id: 'gemini-2.5-flash-preview-tts',            label: 'Gemini 2.5 Flash Preview TTS',      type: 'audio', paid: false, note: 'Озвучка (попередня версія)', audioKind: 'tts' },
    { id: 'gemini-2.5-pro-preview-tts',              label: 'Gemini 2.5 Pro Preview TTS',        type: 'audio', paid: false, note: 'Озвучка вищої якості', audioKind: 'tts' },
    // ----- Музика (повертає аудіо) -----
    { id: 'lyria-3.5',                               label: 'Lyria 3.5',                         type: 'audio', paid: true,  note: 'Створення повних пісень', audioKind: 'music' },
    { id: 'lyria-3-pro-preview',                     label: 'Lyria 3 Pro Preview',               type: 'audio', paid: true,  note: 'Музика вищої якості', audioKind: 'music' },
    { id: 'lyria-3-clip-preview',                    label: 'Lyria 3 Clip Preview',              type: 'audio', paid: true,  note: 'Короткі музичні кліпи', audioKind: 'music' },
    // ----- Відео -----
    { id: 'gemini-omni-1.1-flash',                   label: 'Gemini Omni 1.1 Flash',             type: 'video', paid: true,  note: 'Створення відео' },
    // ----- Агенти (довгі завдання: Gemini думає, поки не закінчить або поки його не зупинять) -----
    { id: 'deep-research-preview-04-2026',           label: 'Deep Research Preview',             type: 'agent', paid: true,  note: 'Глибоке дослідження' },
    { id: 'deep-research-max-preview-04-2026',       label: 'Deep Research Max Preview',         type: 'agent', paid: true,  note: 'Максимально повне дослідження' },
    { id: 'antigravity-preview-09-2026',             label: 'Antigravity Agent Preview',         type: 'agent', paid: true,  note: 'Автономний агент' }
];
// Не включені Live-моделі (gemini-3.8-live, gemini-3.8-live-extended-thinking, gemini-3.1-flash-live-preview,
// gemini-3.5-transcribe-live, gemini-3.5-live-translate-preview): вони працюють лише через голосовий WebSocket у реальному часі,
// а не через текстовий чат.

// ---------- Поточна дата для Gemini (його власні знання застарілі, тому він має знати, який зараз рік) ----------
function geminiNowText() {
    try {
        return new Date().toLocaleString('uk-UA', {
            timeZone: process.env.GEMINI_TIMEZONE || 'Europe/Kyiv',
            dateStyle: 'full',
            timeStyle: 'short'
        });
    } catch (e) {
        return new Date().toISOString();
    }
}

function geminiCurrentYear() {
    try {
        return new Date().toLocaleString('en-US', { timeZone: process.env.GEMINI_TIMEZONE || 'Europe/Kyiv', year: 'numeric' });
    } catch (e) {
        return String(new Date().getUTCFullYear());
    }
}

// У месенджері немає емодзі: прибираємо їх із відповідей моделі
const EMOJI_REGEX = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u200D\u{20E3}]/gu;
function stripEmoji(text) {
    if (process.env.GEMINI_KEEP_EMOJI === '1') return String(text || '');
    return String(text || '')
        .replace(EMOJI_REGEX, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

const GEMINI_SEARCH_ENABLED = process.env.GEMINI_SEARCH !== '0';
const geminiNoSearchModels = new Set();   // моделі, які не підтримують пошук Google
const geminiNoThinkCfg = new Set();       // моделі, які не приймають thinkingConfig

// Запамʼятовуємо можливості моделей у базі: після перезапуску сервера не витрачаємо зайві запити до Google
db.run(`CREATE TABLE IF NOT EXISTS gemini_caps (model_id TEXT PRIMARY KEY, no_think INTEGER, no_search INTEGER)`, () => {
    db.all('SELECT model_id, no_think, no_search FROM gemini_caps', [], (err, rows) => {
        (rows || []).forEach((r) => {
            if (Number(r.no_think)) geminiNoThinkCfg.add(r.model_id);
            if (Number(r.no_search)) geminiNoSearchModels.add(r.model_id);
        });
    });
});
function geminiCapsSave(modelId, field) {
    if (field !== 'no_think' && field !== 'no_search') return;
    db.run(`INSERT INTO gemini_caps (model_id, no_think, no_search) VALUES (?, ?, ?) ON CONFLICT(model_id) DO UPDATE SET ${field} = 1`,
        [modelId, field === 'no_think' ? 1 : 0, field === 'no_search' ? 1 : 0], () => {});
}

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
            type: ['image', 'text', 'audio', 'video', 'agent'].includes(typeLower) ? typeLower : guessedType,
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

// Віддаємо згенеровані зображення, аудіо та відео (id випадковий і непередбачуваний). Підтримується Range, щоб плеєр міг перемотувати.
const GEMINI_MEDIA_MIME = /^(image\/(png|jpeg|webp|gif)|audio\/(wav|x-wav|mpeg|mp3|mp4|aac|ogg|webm|flac)|video\/(mp4|webm|quicktime))$/;
app.get('/gemini-image/:id', (req, res) => {
    const id = String(req.params.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
    db.get("SELECT mime, data FROM gemini_images WHERE id = ?", [id], (err, row) => {
        if (err || !row) return res.status(404).send('Not found');
        const mime = GEMINI_MEDIA_MIME.test(row.mime) ? row.mime : 'image/png';
        const buf = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
        res.set('Content-Type', mime);
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        res.set('Accept-Ranges', 'bytes');
        const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (range && (range[1] || range[2])) {
            let start = range[1] ? parseInt(range[1], 10) : buf.length - parseInt(range[2], 10);
            let end = range[1] && range[2] ? parseInt(range[2], 10) : buf.length - 1;
            if (isNaN(start) || start < 0) start = 0;
            if (isNaN(end) || end >= buf.length) end = buf.length - 1;
            if (start > end) { res.status(416).set('Content-Range', `bytes */${buf.length}`); return res.end(); }
            res.status(206);
            res.set('Content-Range', `bytes ${start}-${end}/${buf.length}`);
            res.set('Content-Length', String(end - start + 1));
            return res.end(buf.subarray(start, end + 1));
        }
        res.send(buf);
    });
});

// ---------- Активні запити та їх зупинка ----------
const geminiJobs = new Map(); // email -> { cancelled, reqs }

function geminiMakeJob() {
    return { cancelled: false, reqs: new Set(), startedAt: Date.now() };
}

function geminiCancelJob(job) {
    job.cancelled = true;
    if (typeof job.cleanup === 'function') { try { job.cleanup(); } catch (e) {} }
    job.reqs.forEach((r) => { try { r.destroy(new Error('CANCELLED')); } catch (e) {} });
    job.reqs.clear();
}

function geminiCheckCancelled(job) {
    if (job && job.cancelled) throw new Error('CANCELLED');
}

// ---------- ОДИН запит на повідомлення: рівномірний темп без «залпів» ----------
// Помилки 429 від Google виникають, коли запити летять купою. Тому запити до однієї моделі йдуть по черзі з мінімальним проміжком
// (GEMINI_MIN_GAP_MS, за замовчуванням 4000 мс; 0 вимикає). Лише службові POST до моделей; список моделей і опитування не чіпаємо.
const GEMINI_MIN_GAP_MS = process.env.GEMINI_MIN_GAP_MS !== undefined && process.env.GEMINI_MIN_GAP_MS !== ''
    ? Math.max(0, parseInt(process.env.GEMINI_MIN_GAP_MS, 10) || 0) : 4000;
const GEMINI_MAX_RATE_RETRIES = process.env.GEMINI_RATE_RETRIES !== undefined && process.env.GEMINI_RATE_RETRIES !== ''
    ? Math.max(0, parseInt(process.env.GEMINI_RATE_RETRIES, 10) || 0) : 2;
const geminiGateNext = new Map();

async function geminiGate(path, job) {
    if (!GEMINI_MIN_GAP_MS) return;
    const m = String(path).match(/models\/([^:/?]+)/);
    const key = m ? m[1] : 'other';
    const now = Date.now();
    const at = Math.max(now, geminiGateNext.get(key) || 0);
    geminiGateNext.set(key, at + GEMINI_MIN_GAP_MS);
    while (Date.now() < at) {
        if (job && job.cancelled) throw new Error('CANCELLED');
        await new Promise((r) => setTimeout(r, Math.min(500, Math.max(50, at - Date.now()))));
    }
    if (job && job.cancelled) throw new Error('CANCELLED');
}

function geminiRequest(method, path, bodyObj, job, timeoutMs) {
    if (method === 'POST' && !/\/cancel$/.test(path)) {
        return geminiGate(path, job).then(() => geminiRequestRaw(method, path, bodyObj, job, timeoutMs));
    }
    return geminiRequestRaw(method, path, bodyObj, job, timeoutMs);
}

function geminiStreamRequest(path, bodyObj, job, onThought) {
    return geminiGate(path, job).then(() => geminiStreamRequestRaw(path, bodyObj, job, onThought));
}

// ---------- Низькорівневий HTTPS-запит до Gemini API (БЕЗ таймауту) ----------
function geminiRequestRaw(method, path, bodyObj, job, timeoutMs) {
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
        // Мертве зʼєднання (обрив мережі без повідомлення) виявляємо через TCP keep-alive, а не через таймер відповіді моделі
        req.on('socket', (sock) => { try { sock.setKeepAlive(true, 15000); } catch (e) {} });
        // Таймаут застосовується ТІЛЬКИ до службових запитів (список моделей), а не до відповіді моделі
        if (timeoutMs) req.setTimeout(timeoutMs, () => req.destroy(new Error('TIMEOUT')));
        req.on('error', (e) => { if (job) job.reqs.delete(req); reject(e); });
        if (body) req.write(body);
        req.end();
    });
}

// ---------- Потокова генерація (SSE) ----------
// Під час довгих міркувань зʼєднання не «мовчить»: Gemini надсилає шматки відповіді, тому Google не обриває запит за часом.
// Результат збираємо в таку саму структуру, як у звичайного generateContent.
function geminiStreamRequestRaw(path, bodyObj, job, onThought) {
    return new Promise((resolve, reject) => {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return reject(new Error('NO_KEY'));
        if (job && job.cancelled) return reject(new Error('CANCELLED'));

        const body = JSON.stringify(bodyObj);
        let settled = false;
        const done = (fn, v) => { if (settled) return; settled = true; fn(v); };

        const req = https.request({
            hostname: 'generativelanguage.googleapis.com',
            path: path + (path.includes('?') ? '&' : '?') + 'alt=sse',
            method: 'POST',
            headers: {
                'x-goog-api-key': apiKey,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            const cleanup = () => { if (job) job.reqs.delete(req); };

            if (res.statusCode !== 200) {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    cleanup();
                    let json = null;
                    try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) {}
                    done(resolve, { status: res.statusCode, json });
                });
                res.on('error', (e) => { cleanup(); done(reject, e); });
                return;
            }

            const parts = [];
            let finishReason = null;
            let promptFeedback = null;
            let apiError = null;
            let buf = '';
            res.setEncoding('utf8');

            const handleBlock = (block) => {
                block.split(/\r?\n/).forEach((line) => {
                    if (!line.startsWith('data:')) return;
                    const payload = line.slice(5).trim();
                    if (!payload || payload === '[DONE]') return;
                    let obj;
                    try { obj = JSON.parse(payload); } catch (e) { return; }
                    if (obj.error) { apiError = obj.error; return; }
                    if (obj.promptFeedback) promptFeedback = obj.promptFeedback;
                    const cand = obj.candidates && obj.candidates[0];
                    if (!cand) return;
                    if (cand.finishReason) finishReason = cand.finishReason;
                    const cp = cand.content && cand.content.parts;
                    if (Array.isArray(cp)) {
                        cp.forEach((part) => {
                            parts.push(part);
                            if (part.thought && typeof onThought === 'function') { try { onThought(); } catch (e) {} }
                        });
                    }
                });
            };

            res.on('data', (chunk) => {
                buf += chunk;
                let m;
                while ((m = buf.match(/\r?\n\r?\n/))) {
                    handleBlock(buf.slice(0, m.index));
                    buf = buf.slice(m.index + m[0].length);
                }
            });
            res.on('end', () => {
                cleanup();
                if (buf.trim()) handleBlock(buf);
                if (apiError) {
                    return done(resolve, { status: apiError.code || 500, json: { error: apiError } });
                }
                done(resolve, {
                    status: 200,
                    json: { candidates: [{ content: { parts }, finishReason }], promptFeedback }
                });
            });
            res.on('error', (e) => { cleanup(); done(reject, e); });
            // Звʼязок обірвався посеред відповіді: це мережева помилка, її повторюємо тією самою моделлю
            res.on('close', () => { if (!res.complete) { cleanup(); done(reject, new Error('ECONNRESET')); } });
        });

        if (job) job.reqs.add(req);
        req.on('socket', (sock) => { try { sock.setKeepAlive(true, 15000); } catch (e) {} });
        req.on('error', (e) => { if (job) job.reqs.delete(req); done(reject, e); });
        req.write(body);
        req.end();
    });
}

// Генерація однієї моделлю: спершу потоком, а якщо потік не підтримується — звичайним запитом
async function geminiGenerate(model, body, job) {
    const base = `/v1beta/models/${encodeURIComponent(model.id)}`;
    const res = await geminiStreamRequest(base + ':streamGenerateContent', body, job, () => {
        // Підказку «Gemini міркує» надсилаємо один раз, а не на кожен шматок міркувань
        if (!job || !job.note || job.note.kind !== 'thinking') {
            geminiNote(job, { kind: 'thinking', seconds: 0, model: model.label });
        }
    });
    const msg = (res.json && res.json.error && res.json.error.message) || '';
    if (res.status === 400 && /stream/i.test(msg) && !/think|thought/i.test(msg)) {
        return geminiRequest('POST', base + ':generateContent', body, job);
    }
    return res;
}

// Розбір відповіді 429: скільки чекати (retryDelay) і який саме ліміт вичерпано (хвилинний, добовий чи нульовий)
function geminiQuotaInfo(json) {
    const info = { retryMs: 0, kind: null };
    const e = json && json.error;
    if (!e) return info;
    (Array.isArray(e.details) ? e.details : []).forEach((d) => {
        const type = String((d && d['@type']) || '');
        if (/RetryInfo/.test(type) && d.retryDelay) {
            const m = String(d.retryDelay).match(/([\d.]+)\s*(ms|s|m)?/);
            if (m) {
                const n = parseFloat(m[1]);
                info.retryMs = Math.ceil(m[2] === 'ms' ? n : (m[2] === 'm' ? n * 60000 : n * 1000));
            }
        }
        if (/QuotaFailure/.test(type) && Array.isArray(d.violations)) {
            d.violations.forEach((v) => {
                const id = String(v.quotaId || '') + ' ' + String(v.quotaMetric || '');
                if (/PerDay/i.test(id) && info.kind !== 'zero') info.kind = 'day';
                else if (/PerMinute/i.test(id) && !info.kind) info.kind = 'minute';
                if (v.quotaValue !== undefined && String(v.quotaValue) === '0') info.kind = 'zero';
            });
        }
    });
    const msg = String(e.message || '');
    if (!info.retryMs) {
        const m = msg.match(/retry in ([\d.]+)\s*s/i);
        if (m) info.retryMs = Math.ceil(parseFloat(m[1]) * 1000);
    }
    if (/limit:\s*0\b/.test(msg)) info.kind = 'zero';
    if (!info.kind && /per\s*day|PerDay/i.test(msg)) info.kind = 'day';
    return info;
}

function geminiApiError(res) {
    const msg = (res.json && res.json.error && res.json.error.message) ? res.json.error.message : ('HTTP ' + res.status);
    const err = new Error(msg);
    err.status = res.status;
    if (res.status === 429) {
        const q = geminiQuotaInfo(res.json);
        err.retryMs = q.retryMs;
        err.quota = q.kind;      // 'minute' | 'day' | 'zero' | null
    }
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
    if (!(await ensureMediaOnDiskAsync(mediaRecord.id))) throw new Error('ATTACH_MISSING');
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
        const res = await geminiRequest('GET', q, null, null, 15000);
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
    let remoteIds = null;
    try {
        const remote = await geminiFetchRemoteModels();
        remoteOk = true;
        remoteIds = new Set();
        remote.forEach((m) => {
            const id = String(m.name || '').replace(/^models\//, '');
            const methods = m.supportedGenerationMethods || [];
            remoteIds.add(id);
            if (!methods.includes('generateContent') || models.some(x => x.id === id)) return;
            if (/^gemma-/.test(id)) {
                models.push({ id, label: m.displayName || id, type: 'text', paid: false, note: 'Gemma (відкрита модель)', noSystem: true });
            } else if (/^(gemini|nano-banana)/.test(id) && !/embed|live|native-audio|aqa|computer-use|learnlm/i.test(id)) {
                // Усі інші моделі зі списку Google для цього ключа з'являються самі — нічого не треба додавати вручну
                const type = geminiGuessType(id);
                models.push({ id, label: m.displayName || id, type, paid: false, note: 'З вашого списку Google', audioKind: type === 'audio' ? 'tts' : undefined });
            }
        });
    } catch (e) {
        console.error('Gemini ListModels:', e.message);
    }

    // Якщо Google точно знає список моделей цього ключа — ховаємо ті, яких там немає (вони дають лише помилку 404).
    // Агенти, відео та музика працюють через інший API, тому їх не чіпаємо. GEMINI_SHOW_ALL=1 вимикає це приховування.
    const extraIds = new Set(geminiExtraModels().map(m => m.id));
    let visible = models;
    if (remoteIds && remoteIds.size >= 5 && process.env.GEMINI_SHOW_ALL !== '1') {
        visible = models.filter((m) => {
            if (extraIds.has(m.id)) return true;
            const checkable = m.type === 'text' || m.type === 'image' || (m.type === 'audio' && m.audioKind === 'tts');
            return !checkable || remoteIds.has(m.id);
        });
    }

    const hidden = new Set(geminiParseList(process.env.GEMINI_HIDE_MODELS));
    const result = visible.filter(m => !hidden.has(m.id));

    geminiCatalogCache = { at: now, ttl: remoteOk ? 3600000 : 300000, models: result };
    return result;
}

function geminiDefaultModel(catalog) {
    return catalog.find(m => m.id === GEMINI_DEFAULT_MODEL && m.type === 'text')
        || catalog.find(m => m.type === 'text' && !m.paid)
        || catalog.find(m => m.type === 'text')
        || catalog[0];
}

// Якщо користувач ВИБРАВ модель — працюємо саме з нею (жодних тихих підмін на іншу). Якщо її немає в каталозі —
// пробуємо її за id, а Google сам скаже, чи вона існує. Модель за замовчуванням беремо тільки коли нічого не вибрано.
function geminiGuessType(id) {
    if (/image/i.test(id)) return 'image';
    if (/tts|lyria/i.test(id)) return 'audio';
    if (/veo|omni/i.test(id)) return 'video';
    if (/deep-research|antigravity/i.test(id)) return 'agent';
    return 'text';
}

function geminiPickModel(catalog, requestedId) {
    const wanted = typeof requestedId === 'string' ? requestedId.trim() : '';
    if (!wanted) return geminiDefaultModel(catalog);
    const found = catalog.find(m => m.id === wanted);
    if (found) return found;
    if (/^[A-Za-z0-9._-]{3,80}$/.test(wanted)) {
        const type = geminiGuessType(wanted);
        return { id: wanted, label: wanted, type, paid: false, adhoc: true, audioKind: type === 'audio' ? (/lyria/i.test(wanted) ? 'music' : 'tts') : undefined };
    }
    return geminiDefaultModel(catalog);
}

// ---------- Текстова відповідь ----------
async function callGemini(contents, systemText, model, job, opts) {
    const options = opts || {};
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

    // Міркування БЕЗ обмеження: thinkingBudget = -1 означає «модель сама вирішує, скільки думати»
    const useThinking = !model.noSystem && !model.special && !model.transcribe && model.type === 'text' && !geminiNoThinkCfg.has(model.id);
    if (useThinking) {
        body.generationConfig = Object.assign({}, body.generationConfig, { thinkingConfig: { thinkingBudget: -1, includeThoughts: true } });
    }

    const useSearch = GEMINI_SEARCH_ENABLED && options.search !== false && !options.noSearch && !model.noSystem
        && !model.special && model.type === 'text' && !geminiNoSearchModels.has(model.id);

    let res;
    if (useSearch) {
        // Пошук Google: Gemini може шукати актуальну інформацію (ігри, тренди, новини) в інтернеті
        res = await geminiGenerate(model, Object.assign({}, body, { tools: [{ google_search: {} }] }), job);
        const msg = (res.json && res.json.error && res.json.error.message) || '';
        if (res.status === 400 && /tool|search|ground|function/i.test(msg) && !/think|thought/i.test(msg)) {
            geminiNoSearchModels.add(model.id);
            geminiCapsSave(model.id, 'no_search');
            res = await geminiGenerate(model, body, job);
        }
    } else {
        res = await geminiGenerate(model, body, job);
    }
    // Модель не підтримує налаштування міркувань — запамʼятовуємо й повторюємо без нього (модель лишається та сама)
    if (res.status === 400 && useThinking && /think|thought/i.test((res.json && res.json.error && res.json.error.message) || '')) {
        geminiNoThinkCfg.add(model.id);
        geminiCapsSave(model.id, 'no_think');
        return callGemini(contents, systemText, model, job, opts);
    }
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
    return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|aborted|TIMEOUT/i.test(m);
}

const geminiSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Ланцюг моделей: ліміти, перевантаження і недоступні моделі більше не показують помилку ----------
// 429 (хвилинний ліміт)  -> чекаємо рівно стільки, скільки просить Google (retryDelay), і пробуємо знову; після двох очікувань
//                           перемикаємось на іншу модель; далі по колу БЕЗ кінця — доки Gemini не відповість або користувач не зупинить.
// 429 (добовий / нульовий) -> модель на 1-6 годин вважається недоступною для цього ключа, беремо наступну.
// 5xx / мережа            -> кілька спроб, потім наступна модель.
// 403 / 404 / 400 / порожня відповідь -> наступна модель.
const geminiDeadUntil = new Map();   // id моделі -> до якого часу не пробуємо

function geminiNote(job, note) {
    if (!job) return;
    job.note = note;
    if (typeof job.onNote === 'function') { try { job.onNote(note); } catch (e) {} }
}

async function geminiWait(ms, job, model, kind) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        geminiCheckCancelled(job);
        geminiNote(job, { kind, seconds: Math.max(1, Math.ceil((until - Date.now()) / 1000)), model: model ? model.label : '' });
        await geminiSleep(Math.min(2000, Math.max(200, until - Date.now())));
    }
    geminiCheckCancelled(job);
}

async function geminiRunChain(chain, runner, job, strict) {
    const nowMs = Date.now();
    let list = chain.filter(m => !((geminiDeadUntil.get(m.id) || 0) > nowMs));
    if (list.length === 0) list = chain.slice();
    let i = 0;
    let rateWaits = 0;
    let serverFails = 0;
    let rounds = 0;
    let emptyFails = 0;
    let firstError = null;

    const advance = () => {
        i = (i + 1) % list.length;
        rateWaits = 0;
        serverFails = 0;
        if (i === 0) rounds++;
        geminiNote(job, { kind: 'switch', model: list[i].label });
    };
    const dropCurrent = (model) => {
        list = list.filter(x => x.id !== model.id);
        if (list.length === 0) return false;
        i = i % list.length;
        rateWaits = 0;
        serverFails = 0;
        geminiNote(job, { kind: 'switch', model: list[i].label });
        return true;
    };

    for (;;) {
        geminiCheckCancelled(job);
        const model = list[i];
        try {
            const result = await runner(model);
            geminiDeadUntil.delete(model.id);
            geminiNote(job, null);
            return { result, model };
        } catch (err) {
            const m = err && err.message;
            if (m === 'CANCELLED' || m === 'NO_KEY') throw err;
            if (!firstError) firstError = err;
            const s = err && err.status;

            if (s === 429 && (err.quota === 'day' || err.quota === 'zero')) {
                geminiDeadUntil.set(model.id, Date.now() + (err.quota === 'zero' ? 6 * 3600000 : 3600000));
                console.error(`Gemini ${model.id}: ліміт недоступний (${err.quota}), беремо іншу модель`);
                if (!dropCurrent(model)) throw firstError;
                continue;
            }
            if (s === 429) {
                // Мінутний ліміт: чекаємо рівно стільки, скільки просить Google, і повторюємо ТІЄЮ САМОЮ моделлю
                // не більше GEMINI_RATE_RETRIES разів (без шторму запитів і без перебору інших моделей).
                rateWaits++;
                if (rateWaits > GEMINI_MAX_RATE_RETRIES) throw firstError;
                const wait = Math.min(Math.max(err.retryMs || 0, 6000), 65000) + 1000;
                console.error(`Gemini ${model.id}: ліміт запитів, один повтор через ${Math.round(wait / 1000)} с (${rateWaits}/${GEMINI_MAX_RATE_RETRIES})`);
                await geminiWait(wait, job, model, 'wait');
                continue;
            }
            if (geminiIsOverload(err)) {
                serverFails++;
                if (strict) {
                    // Обрана модель: не міняємо її на іншу, а повторюємо, доки Google не відповість або користувач не натисне «Стоп»
                    console.error(`Gemini ${model.id}: перевантаження або обрив звʼязку (${s || m}), повтор ${serverFails}`);
                    await geminiWait(Math.min(30000, 2000 * serverFails), job, model, 'busy');
                    continue;
                }
                if (serverFails >= 4) {
                    if (list.length > 1 && rounds < 2) { advance(); continue; }
                    throw firstError;
                }
                console.error(`Gemini ${model.id}: перевантаження (${s || m}), спроба ${serverFails}/4`);
                await geminiWait(2000 * serverFails, job, model, 'busy');
                continue;
            }
            if (s === 403 || s === 404) {
                geminiDeadUntil.set(model.id, Date.now() + 3600000);
                if (!dropCurrent(model)) throw firstError;
                continue;
            }
            if (strict && emptyFails < 3 && (m === 'EMPTY' || m === 'BAD_RESPONSE' || m === 'EMPTY_IMAGE' || m === 'EMPTY_AUDIO' || m === 'EMPTY_VIDEO')) {
                emptyFails++;
                console.error(`Gemini ${model.id}: порожня відповідь, повтор ${emptyFails}/3`);
                await geminiWait(1500, job, model, 'busy');
                continue;
            }
            if (s === 400 || m === 'EMPTY' || m === 'BAD_RESPONSE' || m === 'EMPTY_IMAGE' || m === 'EMPTY_AUDIO' || m === 'EMPTY_VIDEO') {
                console.error(`Gemini ${model.id}: ${m}`);
                if (!dropCurrent(model)) throw firstError;
                continue;
            }
            throw err;
        }
    }
}

// Запасні моделі для тексту: безкоштовні загальні моделі, потім Gemma
function geminiTextChain(picked, catalog) {
    const chain = [picked];
    const extra = catalog.filter(m => m.type === 'text' && !m.paid && !m.special && !m.noSystem && m.id !== picked.id);
    extra.sort((a, b) => (b.id === GEMINI_FALLBACK_MODEL ? 1 : 0) - (a.id === GEMINI_FALLBACK_MODEL ? 1 : 0));
    chain.push(...extra);
    chain.push(...catalog.filter(m => m.type === 'text' && m.noSystem && !m.paid && m.id !== picked.id));
    return chain;
}

async function callGeminiResilient(contents, systemText, picked, catalog, job, opts) {
    const strict = !!(opts && opts.strict);
    const chain = strict ? [picked] : geminiTextChain(picked, catalog);
    const out = await geminiRunChain(chain, (m) => callGemini(contents, systemText, m, job, opts), job, strict);
    return { text: out.result, model: out.model.id };
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

async function callGeminiImageResilient(prompt, picked, catalog, job, inputImage, strict) {
    const chain = strict ? [picked] : [picked].concat(catalog.filter(m => m.type === 'image' && !m.paid && m.id !== picked.id));
    const out = await geminiRunChain(chain, (m) => callGeminiImage(prompt, m.id, job, inputImage), job, strict);
    return Object.assign({}, out.result, { modelId: out.model.id });
}

// ---------- Аудіо: озвучка (TTS) та музика (Lyria) ----------
function geminiPcmToWav(pcm, sampleRate, channels) {
    const bits = 16;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * channels * bits / 8, 28);
    header.writeUInt16LE(channels * bits / 8, 32);
    header.writeUInt16LE(bits, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

// MP3 (бібліотека @breezystack/lamejs). Якщо вона недоступна — залишаємо WAV, озвучка все одно працює.
let geminiMp3Encoder = null;
try {
    const lame = require('@breezystack/lamejs');
    geminiMp3Encoder = lame.Mp3Encoder || (lame.default && lame.default.Mp3Encoder) || null;
} catch (e) {
    console.warn('MP3-кодувальник недоступний (npm install @breezystack/lamejs). Озвучка зберігатиметься як WAV.');
}

function geminiPcmToMp3(pcm, sampleRate) {
    if (!geminiMp3Encoder) return null;
    try {
        const samples = new Int16Array(Math.floor(pcm.length / 2));
        for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2);
        const encoder = new geminiMp3Encoder(1, sampleRate, 128);
        const out = [];
        for (let i = 0; i < samples.length; i += 1152) {
            const chunk = encoder.encodeBuffer(samples.subarray(i, i + 1152));
            if (chunk && chunk.length) out.push(Buffer.from(chunk));
        }
        const tail = encoder.flush();
        if (tail && tail.length) out.push(Buffer.from(tail));
        const buf = Buffer.concat(out);
        return buf.length > 100 ? buf : null;
    } catch (e) {
        console.error('PCM -> MP3:', e.message);
        return null;
    }
}

async function callGeminiAudio(model, text, job) {
    const endpoint = `/v1beta/models/${encodeURIComponent(model.id)}:generateContent`;
    const base = { contents: [{ role: 'user', parts: [{ text }] }] };
    let res;
    if (model.audioKind === 'music') {
        res = await geminiRequest('POST', endpoint, Object.assign({}, base, { generationConfig: { responseModalities: ['AUDIO', 'TEXT'] } }), job);
        if (res.status === 400) {
            res = await geminiRequest('POST', endpoint, Object.assign({}, base, { generationConfig: { responseModalities: ['AUDIO'] } }), job);
        }
    } else {
        res = await geminiRequest('POST', endpoint, Object.assign({}, base, {
            generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_TTS_VOICE || 'Kore' } } }
            }
        }), job);
    }
    if (res.status !== 200) throw geminiApiError(res);
    if (!res.json) throw new Error('BAD_RESPONSE');

    let audio = null;
    let note = '';
    const parts = (res.json.candidates && res.json.candidates[0] && res.json.candidates[0].content && res.json.candidates[0].content.parts) || [];
    parts.forEach((p) => {
        if (typeof p.text === 'string' && !p.thought) note += p.text;
        const inl = p.inlineData || p.inline_data;
        const mime = inl && (inl.mimeType || inl.mime_type);
        if (inl && inl.data && /^audio\//i.test(mime || '') && !audio) audio = { mime, data: Buffer.from(inl.data, 'base64') };
    });
    if (!audio) throw new Error('EMPTY_AUDIO');
    if (/L16|pcm/i.test(audio.mime)) {
        const rate = parseInt((audio.mime.match(/rate=(\d+)/) || [])[1] || '24000', 10);
        const mp3 = geminiPcmToMp3(audio.data, rate);
        audio = mp3 ? { mime: 'audio/mpeg', data: mp3 } : { mime: 'audio/wav', data: geminiPcmToWav(audio.data, rate, 1) };
    }
    return { mime: audio.mime.split(';')[0].trim().toLowerCase(), data: audio.data, text: note.trim() };
}

// ---------- Довгі завдання через Interactions API (агенти, відео): опитуємо результат, доки він не готовий або не натиснуто "Стоп" ----------
function geminiCollectText(json) {
    const outputs = [];
    if (Array.isArray(json.outputs)) {
        json.outputs.forEach((o) => { if (o && typeof o.text === 'string' && o.text.trim()) outputs.push(o.text); });
    }
    if (Array.isArray(json.steps)) {
        json.steps.forEach((st) => {
            if (st && st.type === 'model_output' && Array.isArray(st.content)) {
                const joined = st.content.filter(b => b && typeof b.text === 'string' && !b.thought).map(b => b.text).join('');
                if (joined.trim()) outputs.push(joined);
            }
        });
    }
    if (outputs.length === 0 && typeof json.output_text === 'string' && json.output_text.trim()) outputs.push(json.output_text);
    return outputs.length ? outputs[outputs.length - 1] : '';
}

function geminiFindMedia(node, mimeRe, depth) {
    depth = depth || 0;
    if (!node || typeof node !== 'object' || depth > 12) return null;
    const mime = node.mime_type || node.mimeType;
    if (typeof mime === 'string' && mimeRe.test(mime)) {
        if (typeof node.data === 'string' && node.data.length > 100) return { mime, data: Buffer.from(node.data, 'base64') };
        const uri = node.uri || node.url || node.file_uri || node.fileUri;
        if (typeof uri === 'string' && /^https:\/\//.test(uri)) return { mime, uri };
    }
    const children = Array.isArray(node) ? node : Object.values(node);
    for (const child of children) {
        const found = geminiFindMedia(child, mimeRe, depth + 1);
        if (found) return found;
    }
    return null;
}

function geminiDownload(uriStr, job, redirects) {
    redirects = redirects || 0;
    return new Promise((resolve, reject) => {
        if (job && job.cancelled) return reject(new Error('CANCELLED'));
        let u;
        try { u = new URL(uriStr); } catch (e) { return reject(e); }
        const headers = {};
        if (/(^|\.)googleapis\.com$/.test(u.hostname) && process.env.GEMINI_API_KEY) headers['x-goog-api-key'] = process.env.GEMINI_API_KEY;
        const req = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers }, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 3) {
                res.resume();
                if (job) job.reqs.delete(req);
                let next;
                try { next = new URL(res.headers.location, uriStr).toString(); } catch (e) { return reject(e); }
                return resolve(geminiDownload(next, job, redirects + 1));
            }
            const chunks = [];
            let total = 0;
            res.on('data', (c) => {
                total += c.length;
                if (total > 80 * 1024 * 1024) { req.destroy(new Error('TOO_BIG')); return; }
                chunks.push(c);
            });
            res.on('end', () => {
                if (job) job.reqs.delete(req);
                if (res.statusCode !== 200) { const e = new Error('HTTP ' + res.statusCode); e.status = res.statusCode; return reject(e); }
                resolve({ mime: String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase(), data: Buffer.concat(chunks) });
            });
            res.on('error', (e) => { if (job) job.reqs.delete(req); reject(e); });
        });
        if (job) job.reqs.add(req);
        req.on('error', (e) => { if (job) job.reqs.delete(req); reject(e); });
    });
}

async function geminiRunInteraction(startBody, job, finish) {
    let res = await geminiRequest('POST', '/v1beta/interactions', startBody, job);
    if (res.status !== 200 || !res.json) throw geminiApiError(res);
    let it = res.json;
    const id = it.id || (it.name ? String(it.name).replace(/^interactions\//, '') : '');
    if (id) {
        job.cleanup = () => {
            geminiRequest('POST', `/v1beta/interactions/${encodeURIComponent(id)}/cancel`, {}, null).catch(() => {});
        };
    }
    for (;;) {
        geminiCheckCancelled(job);
        const status = String(it.status || '').toLowerCase();
        if (/^(failed|cancelled|canceled|expired|incomplete)$/.test(status)) throw new Error('AGENT_FAILED');
        if (!status || /^(completed|succeeded|done)$/.test(status)) {
            const out = await finish(it);
            if (out) return out;
            if (status) throw new Error('EMPTY');
        }
        if (!id) throw new Error('BAD_RESPONSE');
        await geminiSleep(5000);
        geminiCheckCancelled(job);
        const poll = await geminiRequest('GET', `/v1beta/interactions/${encodeURIComponent(id)}`, null, job);
        if (poll.status === 429 || poll.status >= 500) continue;   // тимчасово: просто опитуємо далі
        if (poll.status !== 200 || !poll.json) throw geminiApiError(poll);
        it = poll.json;
    }
}

async function callGeminiAgent(model, prompt, job) {
    geminiNote(job, { kind: 'agent', model: model.label });
    const text = await geminiRunInteraction({ agent: model.id, input: prompt, background: true }, job, async (it) => geminiCollectText(it));
    return { text };
}

async function callGeminiVideo(model, prompt, job) {
    const out = await geminiRunInteraction(
        { model: model.id, input: [{ type: 'text', text: prompt }], background: true },
        job,
        async (it) => {
            const media = geminiFindMedia(it, /^video\//i);
            if (!media) return null;
            if (media.data) return { mime: media.mime, data: media.data, text: geminiCollectText(it) };
            const dl = await geminiDownload(media.uri, job);
            return { mime: /^video\//.test(dl.mime) ? dl.mime : media.mime, data: dl.data, text: geminiCollectText(it) };
        }
    );
    return out;
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
    preview_image_failed: { uk: 'Не вдалося створити зображення: безкоштовний сервіс зараз зайнятий. Спробуйте ще раз за хвилину', ru: 'Не удалось создать изображение: бесплатный сервис сейчас занят. Попробуйте ещё раз через минуту', en: 'Could not create the image: the free service is busy right now. Try again in a minute' },
    zero_quota:    { uk: 'Google не дає моделі %s безкоштовної квоти для вашого ключа (limit: 0). Підключіть оплату: aistudio.google.com -> Get API key -> Set up billing',
                     ru: 'Google не даёт модели %s бесплатной квоты для вашего ключа (limit: 0). Подключите оплату: aistudio.google.com -> Get API key -> Set up billing',
                     en: 'Google gives %s no free quota for your key (limit: 0). Enable billing: aistudio.google.com -> Get API key -> Set up billing' },
    quota_day:     { uk: 'Добовий ліміт безкоштовного ключа Gemini вичерпано для всіх доступних моделей. Він оновиться завтра, або підключіть платний тариф Google AI Studio', ru: 'Суточный лимит бесплатного ключа Gemini исчерпан для всех доступных моделей. Он обновится завтра, либо подключите платный тариф Google AI Studio', en: 'The daily limit of the free Gemini key is used up for all available models. It resets tomorrow, or enable a paid Google AI Studio plan' },
    empty_audio:   { uk: 'Gemini не повернув аудіо. Спробуйте інший текст або іншу модель', ru: 'Gemini не вернул аудио. Попробуйте другой текст или другую модель', en: 'Gemini returned no audio. Try another text or another model' },
    empty_video:   { uk: 'Gemini не повернув відео. Спробуйте інший опис або іншу модель', ru: 'Gemini не вернул видео. Попробуйте другое описание или другую модель', en: 'Gemini returned no video. Try another description or another model' },
    agent_failed:  { uk: 'Агент Gemini не зміг завершити завдання. Спробуйте сформулювати його інакше', ru: 'Агент Gemini не смог завершить задание. Попробуйте сформулировать его иначе', en: 'The Gemini agent could not finish the task. Try rewording it' },
    attach_unsupported: { uk: 'Ця модель не приймає фото чи відео. Оберіть текстову модель для аналізу файлів', ru: 'Эта модель не принимает фото или видео. Выберите текстовую модель для анализа файлов', en: 'This model does not accept photos or videos. Choose a text model to analyse files' },
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
    if (m === 'ATTACH_UNSUPPORTED') return geminiT('attach_unsupported', lang);
    if (m === 'EMPTY_AUDIO') return geminiT('empty_audio', lang);
    if (m === 'EMPTY_VIDEO') return geminiT('empty_video', lang);
    if (m === 'AGENT_FAILED') return geminiT('agent_failed', lang);
    if (s === 429 && err.quota === 'day') return geminiT('quota_day', lang);
    if (s === 429 && err.quota === 'zero') return geminiT('zero_quota', lang, name);
    if ((s === 403 || s === 429) && picked && picked.paid) return geminiT('paid', lang, name);
    if (s === 403) return geminiT('forbidden', lang, name);
    if (s === 404 || (s === 429 && err.quota === 'zero')) return geminiT('not_found', lang, name);
    if (s === 429) {
        return picked && picked.type === 'image' ? geminiT('image_quota', lang, name) : geminiT('quota', lang);
    }
    if (s === 500 || s === 502 || s === 503 || s === 504) return geminiT('overloaded', lang);
    if (m === 'EMPTY') return geminiT('empty', lang);
    if (m === 'EMPTY_IMAGE') return geminiT('empty_image', lang);
    if (m === 'BAD_RESPONSE') return geminiT('bad_response', lang);
    return geminiT('generic', lang, m || geminiT('unknown', lang));
}

// Налаштування вкладки Gemini, які надсилає застосунок разом із повідомленням
function geminiCleanSettings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
        search: r.search !== false,
        style: ['balanced', 'short', 'detailed'].includes(r.style) ? r.style : 'balanced'
    };
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
                `SELECT id, role, text, timestamp, "imageId", model, "attachUrl", "attachType", "attachThumb" FROM (
                    SELECT id, role, text, timestamp, image_id AS "imageId", model,
                           attach_url AS "attachUrl", attach_type AS "attachType", attach_thumb AS "attachThumb"
                    FROM gemini_messages
                    WHERE email = ? ORDER BY timestamp DESC LIMIT ?
                 ) AS recent ORDER BY timestamp ASC`,
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
        cb({ success: true, busy: !!job, startedAt: job ? job.startedAt : 0, note: job && job.note ? job.note : null });
    });

    // Нове повідомлення до Gemini (текст, фото/відео для аналізу, зображення, озвучка, музика, відео, агенти — залежно від моделі)
    socket.on('gemini_send', async (data, callback) => {
        const ackCb = typeof callback === 'function' ? callback : () => {};
        const { email, name, text, model, attachment, lang: rawLang, settings: rawSettings } = data || {};
        const lang = geminiLang(rawLang);
        const cleanEmail = geminiCleanEmail(email);
        const cleanText = (typeof text === 'string' ? text : '').trim();
        const gset = geminiCleanSettings(rawSettings);

        const attachUrl = attachment && typeof attachment.url === 'string' ? attachment.url : null;
        const attachType = attachment && attachment.type === 'video' ? 'video' : (attachUrl ? 'image' : null);
        const attachThumb = attachment && typeof attachment.thumbUrl === 'string' && /^\/media\/[a-zA-Z0-9_-]+$/.test(attachment.thumbUrl)
            ? attachment.thumbUrl : null;

        if (!cleanEmail || (!cleanText && !attachUrl)) return ackCb({ success: false, error: geminiT('empty_msg', lang) });
        if (cleanText.length > GEMINI_MAX_TEXT) return ackCb({ success: false, error: geminiT('too_long', lang) });
        if (geminiJobs.has(cleanEmail)) return ackCb({ success: false, error: geminiT('busy', lang) });

        socket.join(cleanEmail);
        const job = geminiMakeJob();
        // Що зараз відбувається (чекаємо ліміт Google, перемкнулись на іншу модель...) — показуємо в застосунку
        job.onNote = (note) => io.to(cleanEmail).emit('gemini_progress', note || { kind: 'clear' });
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
            const explicitModel = typeof model === 'string' && model.trim() !== '';
            picked = geminiPickModel(catalog, typeof model === 'string' ? model : '');
            const kind = picked.type;                 // text | image | audio | video | agent
            const isImage = kind === 'image';

            let mediaRecord = null;
            if (attachUrl) {
                if (kind !== 'text' && kind !== 'image') throw new Error('ATTACH_UNSUPPORTED');
                mediaRecord = await geminiGetMediaRecord(attachUrl);
                if (!mediaRecord) throw new Error('ATTACH_MISSING');
                if (!/^(image|video)\//.test(mediaRecord.mime || '')) throw new Error('ATTACH_BAD');
                if (isImage && attachType === 'video') throw new Error('VIDEO_TO_IMAGE_MODEL');
            }

            await geminiDbRun(
                "INSERT INTO gemini_messages (id, email, role, text, timestamp, attach_url, attach_type, attach_thumb) VALUES (?, ?, 'user', ?, ?, ?, ?, ?)",
                [userMsgId, cleanEmail, cleanText, now, attachUrl, attachType, attachThumb]
            );

            const newId = () => `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const saveMedia = async (mime, buffer) => {
                const mediaId = crypto.randomBytes(16).toString('hex');
                await geminiDbRun(
                    "INSERT INTO gemini_images (id, email, mime, data, timestamp) VALUES (?, ?, ?, ?, ?)",
                    [mediaId, cleanEmail, mime, buffer, Date.now()]
                );
                return mediaId;
            };

            let reply;

            if (isImage) {
                let inputImage = null;
                if (mediaRecord) {
                    if (mediaRecord.size > 15 * 1024 * 1024) throw new Error('ATTACH_TOO_BIG');
                    const filePath = path.join(UPLOAD_DIR, mediaRecord.id);
                    if (!(await ensureMediaOnDiskAsync(mediaRecord.id))) throw new Error('ATTACH_MISSING');
                    inputImage = { mime: mediaRecord.mime, data: fs.readFileSync(filePath).toString('base64') };
                }
                const prompt = cleanText || 'Покращ це зображення';
                const img = await callGeminiImageResilient(prompt, picked, catalog, job, inputImage, explicitModel);
                geminiCheckCancelled(job);
                const imageId = await saveMedia(img.mime, Buffer.from(img.data, 'base64'));
                reply = { id: newId(), role: 'model', text: img.text || '', timestamp: Date.now(), model: img.modelId || picked.id, imageId, fileType: null };
            } else if (kind === 'audio') {
                const chain = explicitModel ? [picked] : [picked].concat(catalog.filter(m => m.type === 'audio' && m.audioKind === picked.audioKind && !m.paid && m.id !== picked.id));
                const out = await geminiRunChain(chain, (m) => callGeminiAudio(m, cleanText, job), job, explicitModel);
                geminiCheckCancelled(job);
                const mediaId = await saveMedia(out.result.mime, out.result.data);
                reply = { id: newId(), role: 'model', text: out.result.text || '', timestamp: Date.now(), model: out.model.id, imageId: mediaId, fileType: 'video' };
            } else if (kind === 'video') {
                const out = await geminiRunChain([picked], (m) => callGeminiVideo(m, cleanText, job), job, true);
                geminiCheckCancelled(job);
                const mediaId = await saveMedia(out.result.mime, out.result.data);
                reply = { id: newId(), role: 'model', text: out.result.text || '', timestamp: Date.now(), model: out.model.id, imageId: mediaId, fileType: 'video' };
            } else if (kind === 'agent') {
                const out = await geminiRunChain([picked], (m) => callGeminiAgent(m, cleanText, job), job, true);
                geminiCheckCancelled(job);
                reply = { id: newId(), role: 'model', text: stripEmoji(out.result.text), timestamp: Date.now(), model: out.model.id, imageId: null, fileType: null };
            } else {
                const rows = await geminiDbAll(
                    `SELECT role, text, image_id AS "imageId", attach_url AS "attachUrl", attach_type AS "attachType"
                     FROM gemini_messages WHERE email = ? ORDER BY timestamp DESC, id DESC LIMIT ?`,
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
                    if (r.imageId) t += (r.attachType === 'video' ? ' [згенероване аудіо або відео]' : ' [згенероване зображення]');
                    if (r.attachUrl && !r.include) t += (r.attachType === 'video' ? ' [користувач надіслав відео]' : ' [користувач надіслав фото]');
                    t = t.trim();
                    if (!t && parts.length === 0) t = '[порожнє повідомлення]';
                    if (!t && parts.length > 0) t = r.attachType === 'video' ? 'Проаналізуй це відео.' : 'Проаналізуй це фото.';
                    parts.push({ text: t });
                    contents.push({ role: r.role, parts });
                }

                const safeName = (typeof name === 'string' ? name : '').trim().slice(0, 60);
                let systemText;
                if (picked.transcribe) {
                    systemText = 'Ти — модель розпізнавання мовлення. Зроби повну дослівну розшифровку мовлення з наданого відео чи аудіо тією мовою, якою воно звучить. ' +
                        'Якщо мовлення немає — скажи про це. Не додавай коментарів.';
                } else {
                    const styleLine = gset.style === 'short'
                        ? 'Відповідай максимально коротко: 1-4 речення, якщо користувач не просить докладніше. '
                        : (gset.style === 'detailed' ? 'Відповідай докладно, з поясненнями, прикладами та кроками. ' : '');
                    const searchLine = gset.search
                        ? 'Твої внутрішні знання можуть бути застарілими, тому коли питають про актуальне (нові ігри, тренди, новини, ціни, релізи, події, версії програм, погоду, спорт) — ' +
                          'ОБОВʼЯЗКОВО скористайся пошуком Google і спирайся на свіжі джерела, а не на памʼять. '
                        : 'Пошук в інтернеті вимкнений у налаштуваннях користувача: відповідай зі своїх знань і чесно попереджай, якщо інформація може бути застарілою. ';
                    systemText =
                        'Ти — Gemini, штучний інтелект усередині месенджера Kishka (Кішка месенджер). ' +
                        'Відповідай тією мовою, якою пише користувач. Пиши чітко, доброзичливо і по суті. ' + styleLine +
                        'Ти памʼятаєш попередні повідомлення цієї розмови з цим користувачем. ' +
                        'Користувач може надсилати фото та відео: уважно аналізуй їх і відповідай на запитання про вміст. ' +
                        `Зараз ${geminiNowText()}, рік — ${geminiCurrentYear()}. ` + searchLine +
                        'Ніколи не вважай, що зараз 2023 рік. Не використовуй емодзі та смайлики.' +
                        (safeName ? ` Користувача звати ${safeName}.` : '');
                }

                const result = await callGeminiResilient(contents, systemText, picked, catalog, job, { search: gset.search, strict: explicitModel });
                geminiCheckCancelled(job);
                reply = { id: newId(), role: 'model', text: stripEmoji(result.text), timestamp: Date.now(), model: result.model, imageId: null, fileType: null };
            }

            await geminiDbRun(
                "INSERT INTO gemini_messages (id, email, role, text, timestamp, image_id, model, attach_type) VALUES (?, ?, 'model', ?, ?, ?, ?, ?)",
                [reply.id, cleanEmail, reply.text, reply.timestamp, reply.imageId, reply.model, reply.fileType]
            );

            finish({
                success: true,
                reply: {
                    id: reply.id,
                    role: 'model',
                    text: reply.text,
                    timestamp: reply.timestamp,
                    model: reply.model,
                    imageUrl: reply.imageId ? '/gemini-image/' + reply.imageId : null,
                    fileType: reply.fileType
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
            io.to(cleanEmail).emit('gemini_progress', { kind: 'clear' });
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

// =====================================================================
// ===== KISHKA AI (Кішка ШІ): власний ШІ месенджера, окремий від Gemini — див. файл kishkaai.js =====
// Він замінив вкладку AI Preview. Працює БЕЗ чужих ШІ (власні моделі Kishka-1 і Kishka-image, файли kishkaai.js,
// kishkaknowledge.js, kishkaimage.js). Події сокета: kai_get_models, kai_get_history, kai_get_status, kai_send,
// kai_cancel, kai_clear, kai_get_facts, kai_clear_facts. Пошуку в інтернеті там немає (гуглить тільки Gemini).
// =====================================================================
// Файл модуля шукаємо БЕЗ урахування регістру: на Linux (Render) Kishkaai.js і kishkaai.js — різні файли
function loadKishkaAI() {
    const found = fs.readdirSync(__dirname).find(f => f.toLowerCase() === 'kishkaai.js');
    if (!found) {
        console.error('Файл Kishkaai.js не знайдено поруч із server.js — Kishka AI вимкнено, решта сервера працює.');
        return null;
    }
    return require(path.join(__dirname, found));
}
const initKishkaAI = loadKishkaAI();
if (initKishkaAI) initKishkaAI({
    io,
    db,
    dbRun: geminiDbRun,
    dbAll: geminiDbAll,
    cleanEmail: geminiCleanEmail,
    langOf: geminiLang,
    stripEmoji,
    makeJob: geminiMakeJob,
    cancelJob: geminiCancelJob,
    checkCancelled: geminiCheckCancelled,
    sleep: geminiSleep,
    tz: process.env.GEMINI_TIMEZONE || 'Europe/Kyiv',
    nowText: (lang) => {
        try {
            return new Date().toLocaleString(lang === 'en' ? 'en-GB' : (lang === 'ru' ? 'ru-RU' : 'uk-UA'), {
                timeZone: process.env.GEMINI_TIMEZONE || 'Europe/Kyiv', dateStyle: 'full', timeStyle: 'short'
            });
        } catch (e) {
            return new Date().toISOString();
        }
    }
});
// ===================== КІНЕЦЬ БЛОКУ KISHKA AI =====================

// =====================================================================
// ===== CHATGPT (файл chatgpt.js) =====
// =====================================================================
function loadSiblingModule(fileName) {
    const found = fs.readdirSync(__dirname).find(f => f.toLowerCase() === fileName.toLowerCase());
    if (!found) { console.error(`Файл ${fileName} не знайдено поруч із server.js — відповідна функція вимкнена, решта сервера працює.`); return null; }
    return require(path.join(__dirname, found));
}
let chatgptApi = null;
try {
    const initChatGPT = loadSiblingModule('chatgpt.js');
    if (initChatGPT) {
        chatgptApi = initChatGPT({
            app, io, db,
            dbRun: geminiDbRun, dbAll: geminiDbAll,
            cleanEmail: geminiCleanEmail, langOf: geminiLang, stripEmoji,
            makeJob: geminiMakeJob, cancelJob: geminiCancelJob, checkCancelled: geminiCheckCancelled, sleep: geminiSleep,
            nowText: (lang) => {
                try {
                    return new Date().toLocaleString(lang === 'en' ? 'en-GB' : (lang === 'ru' ? 'ru-RU' : 'uk-UA'), {
                        timeZone: process.env.GEMINI_TIMEZONE || 'Europe/Kyiv', dateStyle: 'full', timeStyle: 'short'
                    });
                } catch (e) { return new Date().toISOString(); }
            },
            loadMedia: async (relUrl) => {
                const rec = await geminiGetMediaRecord(relUrl);
                if (!rec || !(await ensureMediaOnDiskAsync(rec.id))) return null;
                return { mime: rec.mime, data: fs.readFileSync(path.join(UPLOAD_DIR, rec.id)) };
            }
        });
    }
} catch (e) {
    console.error('ChatGPT не запустився:', e && e.message);
}
// ===================== КІНЕЦЬ БЛОКУ CHATGPT =====================

// =====================================================================
// ===== @gemini / @chatgpt У ЧАТАХ =====
// Застосунок надсилає ai_mention {asker, peer, provider, model, question, lang}. Відповідь приходить у чат
// звичайним повідомленням від «gemini@kishka.ai» / «chatgpt@kishka.ai» ОБОМ учасникам розмови.
// Gemini за замовчуванням відповідає на gemini-3.5-flash (MENTION_GEMINI_MODEL), модель можна обрати через @ після питання.
// =====================================================================
const AI_BOTS = {
    gemini:  { email: 'gemini@kishka.ai',  name: 'Gemini' },
    chatgpt: { email: 'chatgpt@kishka.ai', name: 'ChatGPT' }
};
const aiMentionBusy = new Set();

async function aiPostBotMessage(provider, asker, peer, text, modelLabel) {
    const bot = AI_BOTS[provider];
    const ts = Date.now();
    const body = `${bot.name}${modelLabel ? ' (' + modelLabel + ')' : ''}:\n${text}`.slice(0, 12000);
    await serverDeliverMessage(
        { id: 'ai_' + ts + '_' + crypto.randomBytes(4).toString('hex'), chatId: serverChatIdFor(asker, peer), senderEmail: bot.email, receiverEmail: asker, text: body, timestamp: ts, alsoFor: peer },
        [asker, peer]
    );
}

async function aiAnswerGemini(question, modelReq, lang, askerName) {
    const catalog = await geminiGetCatalog();
    const userChose = !!modelReq;
    const wanted = userChose ? modelReq : (process.env.MENTION_GEMINI_MODEL || 'gemini-3.5-flash');
    const systemText = 'Ти — Gemini у чаті месенджера Kishka. Відповідай по суті тією мовою, якою поставлено питання, без емодзі. ' +
        `Зараз ${geminiNowText()}, рік — ${geminiCurrentYear()}. Для актуальних питань (новини, ціни, релізи, погода) скористайся пошуком Google.` +
        (askerName ? ` Питання поставив(ла) ${askerName}.` : '');
    const contents = [{ role: 'user', parts: [{ text: question }] }];

    let picked = geminiPickModel(catalog, wanted);
    if (picked.type !== 'text') throw Object.assign(new Error('MENTION_TEXT_ONLY'), {});
    const run = async (model) => {
        const job = geminiMakeJob();
        const out = await callGeminiResilient(contents, systemText, model, catalog, job, { search: true, strict: true });
        return { text: stripEmoji(out.text), model };
    };
    try {
        return await run(picked);
    } catch (err) {
        // Моделі за замовчуванням може не бути для ключа — тоді відповідає основна модель; обрану користувачем не підміняємо
        if (!userChose && (err.status === 404 || err.status === 403 || err.status === 400)) return run(geminiDefaultModel(catalog));
        throw err;
    }
}

io.on('connection', (socket) => {
    socket.on('ai_mention', async (data, callback) => {
        const cb = typeof callback === 'function' ? callback : () => {};
        const asker = geminiCleanEmailEarly(data && data.asker);
        const peer = geminiCleanEmailEarly(data && data.peer);
        const provider = data && (data.provider === 'gemini' || data.provider === 'chatgpt') ? data.provider : null;
        const question = String((data && data.question) || '').trim().slice(0, 4000);
        const modelReq = typeof (data && data.model) === 'string' ? data.model.trim() : '';
        const lang = geminiLang(data && data.lang);
        const askerName = String((data && data.name) || '').trim().slice(0, 60);
        if (!asker || !peer || !provider || !question) return cb({ success: false });

        const key = asker + '|' + peer + '|' + provider;
        if (aiMentionBusy.has(key)) return cb({ success: false, busy: true });
        aiMentionBusy.add(key);
        socket.join(asker);
        cb({ success: true });
        io.to(asker).to(peer).emit('ai_status', { chatId: serverChatIdFor(asker, peer), provider, state: 'thinking' });

        let model = null;
        try {
            let result;
            if (provider === 'gemini') {
                result = await aiAnswerGemini(question, modelReq, lang, askerName);
            } else {
                if (!chatgptApi) throw Object.assign(new Error('NO_KEY'), {});
                result = await chatgptApi.answerOnce({ text: question, model: modelReq, lang, name: askerName });
            }
            model = result.model;
            await aiPostBotMessage(provider, asker, peer, result.text, model && model.label ? model.label : '');
        } catch (err) {
            console.error('ai_mention ' + provider + ':', err && err.message);
            let text;
            if (err && err.message === 'MENTION_TEXT_ONLY') {
                text = lang === 'en' ? 'Only text models can answer inside a chat. Pick a text model after @.' : (lang === 'ru' ? 'В чате отвечают только текстовые модели. Выберите текстовую модель после @.' : 'У чаті відповідають лише текстові моделі. Оберіть текстову модель після @.');
            } else if (err && err.message === 'ATTACH_MODEL') {
                text = lang === 'en' ? 'Only text models can answer inside a chat. Pick a text model after @.' : (lang === 'ru' ? 'В чате отвечают только текстовые модели. Выберите текстовую модель после @.' : 'У чаті відповідають лише текстові моделі. Оберіть текстову модель після @.');
            } else if (provider === 'gemini') {
                text = geminiErrorText(err, null, lang);
            } else {
                text = chatgptApi ? chatgptApi.errorText(err, null, lang) : String(err && err.message);
            }
            try { await aiPostBotMessage(provider, asker, peer, text, ''); } catch (e) {}
        } finally {
            aiMentionBusy.delete(key);
            io.to(asker).to(peer).emit('ai_status', { chatId: serverChatIdFor(asker, peer), provider, state: 'done' });
        }
    });
});
// ===================== КІНЕЦЬ БЛОКУ @gemini / @chatgpt =====================

// Не даємо Render Free "заснути" (він вимикає сервіс після 15 хв без запитів) — сервер сам звертається до себе
(function keepAlive() {
    const url = process.env.RENDER_EXTERNAL_URL;
    if (!url || process.env.KEEP_ALIVE === '0') return;
    setInterval(() => {
        try {
            https.get(url.replace(/\/$/, '') + '/health', (res) => res.resume()).on('error', () => {});
        } catch (e) {}
    }, 10 * 60 * 1000);
})();

// Сторожовий таймер: помилки не валять сервер
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e && e.message));
process.on('uncaughtException', (e) => console.error('uncaughtException:', e && e.message));


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер працює на порту ${PORT}`);
});
