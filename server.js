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
            const existing = rows.map((r) => r.email);
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
            if (err) safeCallback({ success: false, contacts: [] });
            else safeCallback({ success: true, contacts: rows || [] });
        });
    });

    socket.on('join_chat', (data) => {
        const chatId = typeof data === 'string' ? data : (data ? data.chatId : null);
        if (!chatId) return;
        socket.join(chatId);

        db.all(
            "SELECT id, chat_id AS \"chatId\", sender_email AS \"senderEmail\", receiver_email AS \"receiverEmail\", text, timestamp, file_url AS \"fileUrl\", file_type AS \"fileType\", thumb_url AS \"thumbUrl\", file_name AS \"fileName\" FROM messages WHERE chat_id = ? ORDER BY timestamp ASC",
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
            "SELECT id, chat_id AS \"chatId\", sender_email AS \"senderEmail\", receiver_email AS \"receiverEmail\", text, timestamp, file_url AS \"fileUrl\", file_type AS \"fileType\", thumb_url AS \"thumbUrl\", file_name AS \"fileName\" FROM messages WHERE (sender_email = ? OR receiver_email = ?) AND timestamp > ? ORDER BY timestamp ASC LIMIT 5000",
            [email, email, since],
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
            return;
        }

        busyUsers.add(cleanCaller);
        busyUsers.add(cleanReceiver);
        socket.myCallEmails = [cleanCaller, cleanReceiver];
        activeCalls.set(cleanCaller, cleanReceiver);
        activeCalls.set(cleanReceiver, cleanCaller);

        // Якщо ніхто не відповів за 60 секунд — дзвінок завершується на обох пристроях
        clearRingTimer(cleanCaller, cleanReceiver);
        ringTimers.set(cleanCaller + '|' + cleanReceiver, setTimeout(() => {
            ringTimers.delete(cleanCaller + '|' + cleanReceiver);
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

        io.to(cleanCaller).emit(`call_answered_${cleanCaller}`, { callerEmail: cleanCaller, receiverEmail: cleanReceiver });
    });

    socket.on('reject_call', (data) => {
        const { callerEmail, receiverEmail } = data || {};
        const cleanCaller = String(callerEmail || '').trim().toLowerCase();
        const cleanReceiver = String(receiverEmail || '').trim().toLowerCase();

        finishCall(cleanCaller, cleanReceiver);
        if (cleanCaller) io.to(cleanCaller).emit(`call_rejected_${cleanCaller}`, { callerEmail: cleanCaller, receiverEmail: cleanReceiver });
        // Інші пристрої того, хто відхилив, теж припиняють дзвонити
        if (cleanReceiver) io.to(cleanReceiver).emit(`call_ended_${cleanReceiver}`, { reason: 'rejected' });
    });

    socket.on('end_call', (data) => {
        const { callerEmail, receiverEmail } = data || {};
        const cleanCaller = String(callerEmail || '').trim().toLowerCase();
        const cleanReceiver = String(receiverEmail || '').trim().toLowerCase();

        finishCall(cleanCaller, cleanReceiver);
        if (cleanCaller) io.to(cleanCaller).emit(`call_ended_${cleanCaller}`, {});
        if (cleanReceiver) io.to(cleanReceiver).emit(`call_ended_${cleanReceiver}`, {});
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
                if (userSockets.has(email) || userIsOnline(email)) return;
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

    const endpoint = `/v1beta/models/${encodeURIComponent(model.id)}:generateContent`;
    const useSearch = GEMINI_SEARCH_ENABLED && !options.noSearch && !model.noSystem
        && model.type !== 'image' && !geminiNoSearchModels.has(model.id);

    let res;
    if (useSearch) {
        // Пошук Google: Gemini може шукати актуальну інформацію (ігри, тренди, новини) в інтернеті
        res = await geminiRequest('POST', endpoint, Object.assign({}, body, { tools: [{ google_search: {} }] }), job);
        const msg = (res.json && res.json.error && res.json.error.message) || '';
        if (res.status === 400 && /tool|search|ground|function/i.test(msg)) {
            geminiNoSearchModels.add(model.id);
            res = await geminiRequest('POST', endpoint, body, job);
        }
    } else {
        res = await geminiRequest('POST', endpoint, body, job);
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
    preview_image_failed: { uk: 'Не вдалося створити зображення: безкоштовний сервіс зараз зайнятий. Спробуйте ще раз за хвилину', ru: 'Не удалось создать изображение: бесплатный сервис сейчас занят. Попробуйте ещё раз через минуту', en: 'Could not create the image: the free service is busy right now. Try again in a minute' },
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
                    if (!(await ensureMediaOnDiskAsync(mediaRecord.id))) throw new Error('ATTACH_MISSING');
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
                    'Ти — Gemini, штучний інтелект усередині месенджера Kishka (Кішка месенджер). ' +
                    'Відповідай тією мовою, якою пише користувач. Пиши чітко, доброзичливо і по суті. ' +
                    'Ти памʼятаєш попередні повідомлення цієї розмови з цим користувачем. ' +
                    'Користувач може надсилати фото та відео: уважно аналізуй їх і відповідай на запитання про вміст. ' +
                    `Зараз ${geminiNowText()}, рік — ${geminiCurrentYear()}. Твої внутрішні знання можуть бути застарілими, ` +
                    'тому коли питають про актуальне (нові ігри, тренди, новини, ціни, релізи, події, версії програм, погоду, спорт) — ' +
                    'ОБОВʼЯЗКОВО скористайся пошуком Google і спирайся на свіжі джерела, а не на памʼять. ' +
                    'Ніколи не вважай, що зараз 2023 рік. Не використовуй емодзі та смайлики.' +
                    (safeName ? ` Користувача звати ${safeName}.` : '');

                const result = await callGeminiResilient(contents, systemText, picked, catalog, job);
                geminiCheckCancelled(job);
                reply = {
                    id: `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    role: 'model',
                    text: stripEmoji(result.text),
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

// =====================================================================
// ===== AI PREVIEW: безкоштовна генерація зображень + чат із памʼяттю та пошуком =====
// Зображення: Pollinations (безкоштовно, без ключа). Запасний варіант — безкоштовна модель Gemini (якщо є GEMINI_API_KEY).
// Environment (необовʼязково):
//   PREVIEW_IMAGE_PROVIDER     — pollinations (за замовчуванням) | gemini
//   PREVIEW_GEMINI_IMAGE_MODEL — запасна модель зображень (за замовчуванням gemini-3.1-flash-lite-image)
//   PREVIEW_TEXT_MODEL         — модель для відповідей (за замовчуванням як у Gemini-вкладці)
// =====================================================================
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS preview_messages (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        image_id TEXT,
        model TEXT
    )`);
    db.run("CREATE INDEX IF NOT EXISTS idx_preview_email_time ON preview_messages (email, timestamp)", () => {});
});

const previewJobs = new Map(); // email -> job
const PREVIEW_CONTEXT_LIMIT = 40;
const PREVIEW_HISTORY_LIMIT = 300;

const IMAGE_INTENT_REGEX = new RegExp(
    '(намал[юі]|нарису[йй]|згенеру[йї]|сгенери[рр]у[йй]|створи[^.!?\\n]{0,20}(зображенн|картинк|малюн|фото|ілюстрац|постер|логотип|обої)|' +
    'создай[^.!?\\n]{0,20}(изображени|картинк|рисун|фото|иллюстрац|постер|логотип|обои)|' +
    'зроби[^.!?\\n]{0,20}(зображенн|картинк|малюн|ілюстрац|постер|логотип|обої)|' +
    'сделай[^.!?\\n]{0,20}(изображени|картинк|рисун|иллюстрац|постер|логотип|обои)|' +
    '\\bdraw\\b|\\bpaint\\b|\\billustrate\\b|' +
    '(generate|create|make|render)[^.!?\\n]{0,25}(image|picture|photo|drawing|illustration|logo|wallpaper|poster|avatar|art))',
    'i'
);

function previewWantsImage(text, mode) {
    if (mode === 'image') return true;
    if (mode === 'chat') return false;
    return IMAGE_INTENT_REGEX.test(String(text || ''));
}

function previewImageSize(text) {
    const t = String(text || '').toLowerCase();
    if (/(горизонталь|горизонтальн|landscape|16:9|широк|панорам)/.test(t)) return { w: 1344, h: 768 };
    if (/(вертикаль|portrait|9:16|для телефон|сторіс|stories|обої на телефон|обои на телефон)/.test(t)) return { w: 768, h: 1344 };
    return { w: 1024, h: 1024 };
}

// Завантаження зображення за URL (з редіректами, з можливістю скасування)
function previewHttpGet(urlStr, job, redirects) {
    redirects = redirects || 0;
    return new Promise((resolve, reject) => {
        if (job && job.cancelled) return reject(new Error('CANCELLED'));
        let u;
        try { u = new URL(urlStr); } catch (e) { return reject(e); }
        const req = https.get({
            hostname: u.hostname,
            path: u.pathname + u.search,
            headers: { 'User-Agent': 'KishkaMessenger/3.0', 'Accept': 'image/*,*/*;q=0.5' }
        }, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 3) {
                res.resume();
                if (job) job.reqs.delete(req);
                let next;
                try { next = new URL(res.headers.location, urlStr).toString(); } catch (e) { return reject(e); }
                return resolve(previewHttpGet(next, job, redirects + 1));
            }
            const chunks = [];
            let total = 0;
            res.on('data', (c) => {
                total += c.length;
                if (total > 20 * 1024 * 1024) { req.destroy(new Error('TOO_BIG')); return; }
                chunks.push(c);
            });
            res.on('end', () => {
                if (job) job.reqs.delete(req);
                resolve({
                    status: res.statusCode,
                    mime: String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase(),
                    data: Buffer.concat(chunks)
                });
            });
            res.on('error', (e) => { if (job) job.reqs.delete(req); reject(e); });
        });
        if (job) job.reqs.add(req);
        req.setTimeout(240000, () => req.destroy(new Error('IMAGE_TIMEOUT')));
        req.on('error', (e) => { if (job) job.reqs.delete(req); reject(e); });
    });
}

async function previewPollinations(prompt, size, job) {
    const seed = Math.floor(Math.random() * 1000000000);
    const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt.slice(0, 900)) +
        `?model=flux&width=${size.w}&height=${size.h}&seed=${seed}&nologo=true&private=true`;
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        geminiCheckCancelled(job);
        try {
            const r = await previewHttpGet(url, job);
            if (r.status === 200 && /^image\//.test(r.mime) && r.data.length > 1000) {
                return { mime: r.mime === 'image/jpg' ? 'image/jpeg' : r.mime, data: r.data };
            }
            lastErr = new Error('HTTP ' + r.status);
            lastErr.status = r.status;
        } catch (e) {
            if (e.message === 'CANCELLED') throw e;
            lastErr = e;
        }
        await geminiSleep(2500 * (attempt + 1));
    }
    throw lastErr || new Error('EMPTY_IMAGE');
}

async function previewGeminiImage(prompt, job) {
    if (!process.env.GEMINI_API_KEY) throw new Error('NO_KEY');
    const modelId = process.env.PREVIEW_GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-lite-image';
    const img = await callGeminiImageResilient(prompt, modelId, job, null);
    return { mime: img.mime, data: Buffer.from(img.data, 'base64') };
}

// Перетворює прохання користувача на детальний англійський опис для моделі зображень
async function previewBuildImagePrompt(userText, catalog, job) {
    if (!process.env.GEMINI_API_KEY) return userText;
    try {
        const model = geminiPickModel(catalog, process.env.PREVIEW_TEXT_MODEL || GEMINI_DEFAULT_MODEL);
        if (!model || model.type !== 'text') return userText;
        const system = 'Rewrite the user request into ONE detailed English prompt for a text-to-image model. ' +
            'Describe subject, style, lighting, colors and composition. Do not add any text, letters or watermarks to the image. ' +
            'Output ONLY the prompt, without quotes or explanations.';
        const out = await callGemini([{ role: 'user', parts: [{ text: userText }] }], system, model, job, { noSearch: true });
        const cleaned = String(out || '').replace(/^["'\s]+|["'\s]+$/g, '');
        return cleaned.length >= 5 ? cleaned.slice(0, 900) : userText;
    } catch (e) {
        if (e && e.message === 'CANCELLED') throw e;
        return userText;
    }
}

async function previewGenerateImage(userText, catalog, job) {
    const size = previewImageSize(userText);
    const prompt = await previewBuildImagePrompt(userText, catalog, job);
    geminiCheckCancelled(job);

    const order = (process.env.PREVIEW_IMAGE_PROVIDER || 'pollinations').toLowerCase() === 'gemini'
        ? ['gemini', 'pollinations'] : ['pollinations', 'gemini'];
    let lastErr = null;
    for (const provider of order) {
        try {
            const img = provider === 'gemini' ? await previewGeminiImage(prompt, job) : await previewPollinations(prompt, size, job);
            return { mime: img.mime, data: img.data, prompt };
        } catch (e) {
            if (e && e.message === 'CANCELLED') throw e;
            lastErr = e;
            console.error(`AI Preview (${provider}):`, e && e.message);
        }
    }
    const err = new Error('IMAGE_FAILED');
    err.cause = lastErr;
    throw err;
}

function previewErrorText(err, lang) {
    lang = geminiLang(lang);
    if (err && err.message === 'IMAGE_FAILED') return geminiT('preview_image_failed', lang);
    return geminiErrorText(err, null, lang);
}

io.on('connection', (socket) => {

    socket.on('preview_get_history', async (email, callback) => {
        const cb = typeof callback === 'function' ? callback : () => {};
        const cleanEmail = geminiCleanEmail(email);
        if (!cleanEmail) return cb({ success: false, messages: [] });
        try {
            const rows = await geminiDbAll(
                `SELECT id, role, text, timestamp, "imageId", model FROM (
                    SELECT id, role, text, timestamp, image_id AS "imageId", model
                    FROM preview_messages WHERE email = ? ORDER BY timestamp DESC LIMIT ?
                 ) AS recent ORDER BY timestamp ASC`,
                [cleanEmail, PREVIEW_HISTORY_LIMIT]
            );
            cb({
                success: true,
                messages: rows.map((r) => ({
                    id: r.id, role: r.role, text: r.text, timestamp: r.timestamp, model: r.model || null,
                    imageUrl: r.imageId ? '/gemini-image/' + r.imageId : null
                }))
            });
        } catch (err) {
            console.error('Preview history error:', err.message);
            cb({ success: false, messages: [] });
        }
    });

    socket.on('preview_get_status', (email, callback) => {
        const cb = typeof callback === 'function' ? callback : () => {};
        const cleanEmail = geminiCleanEmail(email);
        if (cleanEmail) socket.join(cleanEmail);
        const job = cleanEmail ? previewJobs.get(cleanEmail) : null;
        cb({ success: true, busy: !!job, startedAt: job ? job.startedAt : 0, image: !!(job && job.isImage) });
    });

    socket.on('preview_send', async (data, callback) => {
        const ackCb = typeof callback === 'function' ? callback : () => {};
        const { email, name, text, mode, lang: rawLang } = data || {};
        const lang = geminiLang(rawLang);
        const cleanEmail = geminiCleanEmail(email);
        const cleanText = (typeof text === 'string' ? text : '').trim();

        if (!cleanEmail || !cleanText) return ackCb({ success: false, error: geminiT('empty_msg', lang) });
        if (cleanText.length > GEMINI_MAX_TEXT) return ackCb({ success: false, error: geminiT('too_long', lang) });
        if (previewJobs.has(cleanEmail)) return ackCb({ success: false, error: geminiT('busy', lang) });

        socket.join(cleanEmail);
        const job = geminiMakeJob();
        const wantsImage = previewWantsImage(cleanText, mode);
        job.isImage = wantsImage;
        previewJobs.set(cleanEmail, job);

        const finish = (payload) => {
            ackCb(payload);
            io.to(cleanEmail).emit('preview_done', payload);
        };

        const now = Date.now();
        const userMsgId = `p_${now}_${Math.random().toString(36).slice(2, 8)}`;

        try {
            const catalog = await geminiGetCatalog();
            await geminiDbRun(
                "INSERT INTO preview_messages (id, email, role, text, timestamp) VALUES (?, ?, 'user', ?, ?)",
                [userMsgId, cleanEmail, cleanText, now]
            );

            let reply;
            if (wantsImage) {
                const img = await previewGenerateImage(cleanText, catalog, job);
                geminiCheckCancelled(job);
                const imageId = crypto.randomBytes(16).toString('hex');
                await geminiDbRun(
                    "INSERT INTO gemini_images (id, email, mime, data, timestamp) VALUES (?, ?, ?, ?, ?)",
                    [imageId, cleanEmail, img.mime, img.data, Date.now()]
                );
                reply = {
                    id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    role: 'model', text: '', timestamp: Date.now(), model: 'ai-preview', imageId,
                    memoryText: '[згенероване зображення за запитом: ' + cleanText.slice(0, 200) + ']'
                };
            } else {
                const picked = geminiPickModel(catalog, process.env.PREVIEW_TEXT_MODEL || GEMINI_DEFAULT_MODEL);
                const rows = await geminiDbAll(
                    `SELECT role, text, image_id AS "imageId" FROM preview_messages
                     WHERE email = ? ORDER BY timestamp DESC, id DESC LIMIT ?`,
                    [cleanEmail, PREVIEW_CONTEXT_LIMIT]
                );
                rows.reverse();
                while (rows.length > 0 && rows[0].role !== 'user') rows.shift();
                const contents = rows.map((r) => {
                    let t = r.text || '';
                    if (r.imageId && !t) t = '[згенероване зображення]';
                    return { role: r.role, parts: [{ text: t || '[порожнє повідомлення]' }] };
                });

                const safeName = (typeof name === 'string' ? name : '').trim().slice(0, 60);
                const systemText =
                    'Ти — помічник вкладки AI Preview у месенджері Kishka. Ти вмієш: відповідати на повідомлення, памʼятати цю розмову, ' +
                    'шукати актуальну інформацію в Google і створювати зображення (користувач просить: «намалюй ...» або вмикає кнопку малювання). ' +
                    'Відповідай мовою користувача, чітко і по суті. ' +
                    `Зараз ${geminiNowText()}, рік — ${geminiCurrentYear()}. Для актуальних питань (ігри, тренди, новини, ціни, події) використовуй пошук Google, ` +
                    'а не застарілу памʼять. Не використовуй емодзі та смайлики.' +
                    (safeName ? ` Користувача звати ${safeName}.` : '');

                const result = await callGeminiResilient(contents, systemText, picked, catalog, job);
                geminiCheckCancelled(job);
                reply = {
                    id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    role: 'model', text: stripEmoji(result.text), timestamp: Date.now(), model: result.model, imageId: null
                };
            }

            await geminiDbRun(
                "INSERT INTO preview_messages (id, email, role, text, timestamp, image_id, model) VALUES (?, ?, 'model', ?, ?, ?, ?)",
                [reply.id, cleanEmail, reply.text, reply.timestamp, reply.imageId, reply.model]
            );

            finish({
                success: true,
                reply: {
                    id: reply.id, role: 'model', text: reply.text, timestamp: reply.timestamp, model: reply.model,
                    imageUrl: reply.imageId ? '/gemini-image/' + reply.imageId : null
                }
            });
        } catch (err) {
            const cancelled = err && err.message === 'CANCELLED';
            if (!cancelled) console.error('Preview send error:', err && err.message);
            try { await geminiDbRun("DELETE FROM preview_messages WHERE id = ?", [userMsgId]); } catch (e) {}
            if (cancelled) {
                ackCb({ success: false, cancelled: true, error: geminiT('stopped', lang) });
            } else {
                finish({ success: false, cancelled: false, error: previewErrorText(err, lang) });
            }
        } finally {
            if (previewJobs.get(cleanEmail) === job) previewJobs.delete(cleanEmail);
        }
    });

    socket.on('preview_cancel', (email, callback) => {
        const cb = typeof callback === 'function' ? callback : () => {};
        const cleanEmail = geminiCleanEmail(email);
        const job = previewJobs.get(cleanEmail);
        if (job) {
            geminiCancelJob(job);
            previewJobs.delete(cleanEmail);
        }
        cb({ success: true });
    });

    socket.on('preview_clear', async (email, callback) => {
        const cb = typeof callback === 'function' ? callback : () => {};
        const cleanEmail = geminiCleanEmail(email);
        if (!cleanEmail) return cb({ success: false });
        try {
            await geminiDbRun("DELETE FROM preview_messages WHERE email = ?", [cleanEmail]);
            cb({ success: true });
        } catch (err) {
            console.error('Preview clear error:', err.message);
            cb({ success: false });
        }
    });
});
// ===================== КІНЕЦЬ БЛОКУ AI PREVIEW =====================

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
