// =====================================================================
// ===== KISHKABLOX: акаунти (нік + пароль), окремі від акаунта месенджера =====
// Підключається з server.js: require('./kishkablox.js')({ io, dbRun, dbAll }).
// Дані зберігаються в тій самій базі, що й месенджер (Neon / SQLite), тож акаунт не зникає.
//
// Події сокета (кожна повертає відповідь через ack):
//   blox_register { nick, password }   -> { success, code?, nick?, token? }
//   blox_login    { nick, password }   -> { success, code?, nick?, token? }
//   blox_check    { nick, token }      -> { success, valid }
//   blox_logout   { token }            -> { success }
// Коди помилок: bad_nick, bad_password, taken, not_found, wrong_password, too_many, error
//
// Правила, як у Roblox: нік 3–20 символів (літери, цифри, підкреслення), вільний нік — ще ніхто не використав
// (регістр не враховується); пароль — будь-який, від 6 символів. Підтвердження поштою не потрібне.
// Пароль на сервері зберігається лише у вигляді хешу (scrypt із випадковою «сіллю»).
// =====================================================================
const crypto = require('crypto');

const NICK_MIN = 3;
const NICK_MAX = 20;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 128;
const SESSION_TTL_MS = 365 * 24 * 3600 * 1000;

// Захист від підбору пароля: не більше 8 невдалих входів за 10 хвилин на один нік
const failures = new Map(); // nickLower -> { count, first }
const FAIL_LIMIT = 8;
const FAIL_WINDOW_MS = 10 * 60 * 1000;

function tooManyFailures(nickLower) {
    const f = failures.get(nickLower);
    if (!f) return false;
    if (Date.now() - f.first > FAIL_WINDOW_MS) {
        failures.delete(nickLower);
        return false;
    }
    return f.count >= FAIL_LIMIT;
}

function noteFailure(nickLower) {
    const f = failures.get(nickLower);
    if (!f || Date.now() - f.first > FAIL_WINDOW_MS) failures.set(nickLower, { count: 1, first: Date.now() });
    else f.count++;
}

function validNick(nick) {
    if (typeof nick !== 'string') return false;
    if (nick.length < NICK_MIN || nick.length > NICK_MAX) return false;
    return /^[\p{L}\p{N}_]+$/u.test(nick);
}

function validPassword(password) {
    return typeof password === 'string' && password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX;
}

function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}

function sha256(text) {
    return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function safeEqualHex(a, b) {
    try {
        const x = Buffer.from(String(a), 'hex');
        const y = Buffer.from(String(b), 'hex');
        return x.length === y.length && crypto.timingSafeEqual(x, y);
    } catch (e) {
        return false;
    }
}

module.exports = function initKishkaBlox(ctx) {
    const { io, dbRun, dbAll } = ctx;

    const ready = (async () => {
        await dbRun(`CREATE TABLE IF NOT EXISTS blox_accounts (
            nick_lower TEXT PRIMARY KEY,
            nick TEXT NOT NULL,
            pass_salt TEXT NOT NULL,
            pass_hash TEXT NOT NULL,
            created INTEGER NOT NULL
        )`);
        await dbRun(`CREATE TABLE IF NOT EXISTS blox_sessions (
            token_hash TEXT PRIMARY KEY,
            nick_lower TEXT NOT NULL,
            created INTEGER NOT NULL
        )`);
    })().catch((e) => console.error('KishkaBlox: не вдалося створити таблиці:', e && e.message));

    async function newSession(nickLower) {
        const token = crypto.randomBytes(32).toString('hex');
        await dbRun('INSERT INTO blox_sessions (token_hash, nick_lower, created) VALUES (?, ?, ?)', [sha256(token), nickLower, Date.now()]);
        return token;
    }

    function reply(cb, payload) {
        if (typeof cb === 'function') {
            try { cb(payload); } catch (e) { /* клієнт уже відключився */ }
        }
    }

    io.on('connection', (socket) => {
        socket.on('blox_register', async (data, cb) => {
            try {
                await ready;
                const nick = String((data && data.nick) || '').trim();
                const password = String((data && data.password) || '');
                if (!validNick(nick)) return reply(cb, { success: false, code: 'bad_nick' });
                if (!validPassword(password)) return reply(cb, { success: false, code: 'bad_password' });

                const nickLower = nick.toLowerCase();
                const existing = await dbAll('SELECT nick_lower FROM blox_accounts WHERE nick_lower = ?', [nickLower]);
                if (existing.length > 0) return reply(cb, { success: false, code: 'taken' });

                const salt = crypto.randomBytes(16).toString('hex');
                try {
                    await dbRun(
                        'INSERT INTO blox_accounts (nick_lower, nick, pass_salt, pass_hash, created) VALUES (?, ?, ?, ?, ?)',
                        [nickLower, nick, salt, hashPassword(password, salt), Date.now()]
                    );
                } catch (e) {
                    // Двоє одночасно зайняли один нік: база пропустила лише першого
                    const again = await dbAll('SELECT nick_lower FROM blox_accounts WHERE nick_lower = ?', [nickLower]);
                    if (again.length > 0) return reply(cb, { success: false, code: 'taken' });
                    throw e;
                }
                const token = await newSession(nickLower);
                reply(cb, { success: true, nick, token });
            } catch (e) {
                console.error('blox_register:', e && e.message);
                reply(cb, { success: false, code: 'error' });
            }
        });

        socket.on('blox_login', async (data, cb) => {
            try {
                await ready;
                const nick = String((data && data.nick) || '').trim();
                const password = String((data && data.password) || '');
                const nickLower = nick.toLowerCase();
                if (!nick || !password) return reply(cb, { success: false, code: 'wrong_password' });
                if (tooManyFailures(nickLower)) return reply(cb, { success: false, code: 'too_many' });

                const rows = await dbAll('SELECT nick, pass_salt, pass_hash FROM blox_accounts WHERE nick_lower = ?', [nickLower]);
                if (rows.length === 0) {
                    noteFailure(nickLower);
                    return reply(cb, { success: false, code: 'not_found' });
                }
                const row = rows[0];
                if (!safeEqualHex(hashPassword(password, row.pass_salt), row.pass_hash)) {
                    noteFailure(nickLower);
                    return reply(cb, { success: false, code: 'wrong_password' });
                }
                failures.delete(nickLower);
                const token = await newSession(nickLower);
                reply(cb, { success: true, nick: row.nick, token });
            } catch (e) {
                console.error('blox_login:', e && e.message);
                reply(cb, { success: false, code: 'error' });
            }
        });

        // Перевірка збереженого входу при відкритті вкладки: якщо акаунт або сесію видалено — користувача виводить із акаунта
        socket.on('blox_check', async (data, cb) => {
            try {
                await ready;
                const nickLower = String((data && data.nick) || '').trim().toLowerCase();
                const token = String((data && data.token) || '');
                if (!nickLower || !token) return reply(cb, { success: true, valid: false });
                const rows = await dbAll('SELECT nick_lower, created FROM blox_sessions WHERE token_hash = ?', [sha256(token)]);
                const ok = rows.length > 0 && rows[0].nick_lower === nickLower && (Date.now() - Number(rows[0].created)) < SESSION_TTL_MS;
                reply(cb, { success: true, valid: ok });
            } catch (e) {
                console.error('blox_check:', e && e.message);
                // Сервер не зміг перевірити — не виходимо з акаунта через збій
                reply(cb, { success: false });
            }
        });

        socket.on('blox_logout', async (data, cb) => {
            try {
                await ready;
                const token = String((data && data.token) || '');
                if (token) await dbRun('DELETE FROM blox_sessions WHERE token_hash = ?', [sha256(token)]);
                reply(cb, { success: true });
            } catch (e) {
                console.error('blox_logout:', e && e.message);
                reply(cb, { success: false });
            }
        });
    });
};
