// =====================================================================
// ===== KISHKABLOX: акаунти, прив'язані до акаунта Kishka, та друзі =====
// Підключається з server.js: require('./kishkablox.js')({ io, dbRun, dbAll }).
// Дані зберігаються в тій самій базі, що й месенджер (Neon / SQLite), тож акаунт не зникає.
//
// ГОЛОВНЕ: акаунт KishkaBlox належить акаунту Kishka (його пошті), а НЕ пристрою.
// Хто й коли увійшов у KishkaBlox, пам'ятає сервер, тому на іншому телефоні з тим самим акаунтом Kishka
// KishkaBlox відкривається вже з усім (нік, друзі, запити).
//
// Події сокета (кожна повертає відповідь через ack; у кожну передається email акаунта Kishka):
//   blox_status     { email }                    -> { success, state: 'none'|'out'|'in', nick?, friends?, incoming?, outgoing? }
//   blox_register   { email, nick, password }    -> { success, code?, nick? }
//   blox_login      { email, nick, password }    -> { success, code?, nick? }
//   blox_logout     { email }                    -> { success }
//   blox_search     { email, query }             -> { success, found, nick?, relation? }   relation: none|sent|incoming|friend
//   blox_add_friend { email, nick }              -> { success, code?, relation? }
//   blox_respond    { email, nick, accept }      -> { success, code? }
//   blox_delete_friend { email, nick }           -> { success, code? }
// HTTP-маршрути установки гри (їх викликає застосунок, див. Bloxinstall.kt):
//   GET /blox/manifest.json       -> { version, files: [{ name, size, sha256 }], total }
//   GET /blox/files/<ім'я>        -> байти файла (розмір точно дорівнює size з маніфесту)
// Файли беруться з папки blox_game/ (змінна BLOX_GAME_DIR) + дві картинки з Assets/ (див. BLOX_ASSET_ALIASES).
// Помилки завжди повертаються як JSON { ok:false, error, message } з відповідним HTTP-статусом — ніколи не HTML.
// Сервер сам надсилає подію 'blox_update' у кімнату пошти (усі пристрої цього акаунта Kishka), коли змінились друзі/запити.
// Коди помилок: bad_nick, bad_password, taken, has_account, not_found, wrong_password, too_many, not_logged_in, self, error
//
// Правила, як у Roblox: нік 3–20 символів (літери, цифри, підкреслення), унікальний (регістр не враховується);
// пароль — будь-який, від 6 символів. Підтвердження поштою не потрібне. Один акаунт Kishka = один акаунт KishkaBlox.
// Пароль на сервері зберігається лише у вигляді хешу (scrypt із випадковою «сіллю»).
// Старі акаунти (створені до цієї версії, без прив'язки) «прив'язуються» до акаунта Kishka при першому вході з ніком і паролем.
// =====================================================================
const crypto = require('crypto');

const NICK_MIN = 3;
const NICK_MAX = 20;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 128;

// Захист від підбору пароля: не більше 8 невдалих входів за 10 хвилин на один нік / одну пошту
const failures = new Map(); // ключ -> { count, first }
const FAIL_LIMIT = 8;
const FAIL_WINDOW_MS = 10 * 60 * 1000;

function tooManyFailures(key) {
    const f = failures.get(key);
    if (!f) return false;
    if (Date.now() - f.first > FAIL_WINDOW_MS) {
        failures.delete(key);
        return false;
    }
    return f.count >= FAIL_LIMIT;
}

function noteFailure(key) {
    const f = failures.get(key);
    if (!f || Date.now() - f.first > FAIL_WINDOW_MS) failures.set(key, { count: 1, first: Date.now() });
    else f.count++;
}

// =====================================================================
// ===== Роздача файлів гри для установки (GET /blox/manifest.json, GET /blox/files/<ім'я>) =====
// Нічого не залежить від бази: якщо база недоступна, файли гри все одно віддаються.
// Розміри й хеші рахуються з реальних файлів на сервері під час кожного запиту (кешуються за розміром і датою зміни).
// Віддавати можна ТІЛЬКИ файли, що є у списку установки: ім'я з URL ніколи не підставляється в шлях до файла.
// =====================================================================
const fs = require('fs');
const path = require('path');

const BLOX_FILE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const BLOX_MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ogg': 'audio/ogg',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.glb': 'model/gltf-binary',
    '.woff2': 'font/woff2'
};
// Без цих двох файлів гра не запуститься: тоді маніфест повертає 503 замість неповного списку
const BLOX_REQUIRED_FILES = ['game.html', 'game.js'];
// Застосунок бере ці файли з телефона під такими іменами (Bloxgame.kt -> bloxImageModel), а в репозиторії вони лежать в Assets/
const BLOX_ASSET_ALIASES = [
    { name: 'kishkablox.png', source: 'Kishkablox.png' },
    { name: 'realistic_cars.jpg', source: 'Realistic_cars.jpg' }
];
const BLOX_MAX_FILE_BYTES = 50 * 1024 * 1024;

function bloxSafeLog(value) {
    return JSON.stringify(String(value)).slice(0, 200);
}

function isSafeBloxName(name) {
    return typeof name === 'string' && BLOX_FILE_NAME_RE.test(name) && name !== '.' && name !== '..';
}

function createBloxFiles(options) {
    const opts = options || {};
    const gameDir = path.resolve(opts.gameDir || process.env.BLOX_GAME_DIR || path.join(__dirname, 'blox_game'));
    const assetsDir = path.resolve(opts.assetsDir || process.env.BLOX_ASSETS_DIR || path.join(__dirname, 'Assets'));
    const log = opts.logger || console;
    const hashCache = new Map(); // абсолютний шлях -> { sig, size, sha256 }

    // Чи лежить справжній шлях файла (з урахуванням symlink) всередині папки root
    function insideRoot(realFile, realRoot) {
        return realFile === realRoot || realFile.startsWith(realRoot + path.sep);
    }

    function candidate(name, abs, realRoot, entries, problems) {
        try {
            const real = fs.realpathSync(abs);
            if (!insideRoot(real, realRoot)) {
                problems.push('файл ' + bloxSafeLog(name) + ' вказує за межі папки гри — пропущено');
                return;
            }
            const st = fs.statSync(real);
            if (!st.isFile()) return;
            if (st.size > BLOX_MAX_FILE_BYTES) {
                problems.push('файл ' + bloxSafeLog(name) + ' завеликий (' + st.size + ' байт) — пропущено');
                return;
            }
            entries.set(name, { name, abs: real, size: st.size, mtimeMs: st.mtimeMs });
        } catch (e) {
            if (!(e && e.code === 'ENOENT')) problems.push('файл ' + bloxSafeLog(name) + ': ' + (e && e.message));
        }
    }

    // Поточний список файлів установки: Map ім'я -> запис. Кидає помилку, якщо папки гри немає.
    function scan() {
        const entries = new Map();
        const problems = [];
        let realGame;
        try {
            realGame = fs.realpathSync(gameDir);
        } catch (e) {
            const err = new Error('Папки гри немає: ' + gameDir + ' (' + (e && e.code) + ')');
            err.code = 'dir_missing';
            throw err;
        }
        let names;
        try {
            names = fs.readdirSync(realGame);
        } catch (e) {
            const err = new Error('Не вдалося прочитати папку гри ' + gameDir + ': ' + (e && e.message));
            err.code = 'dir_unreadable';
            throw err;
        }
        names.sort();
        for (const name of names) {
            if (name.startsWith('.')) continue;
            const ext = path.extname(name).toLowerCase();
            if (!BLOX_MIME[ext]) {
                problems.push('файл ' + bloxSafeLog(name) + ' має тип, який не віддається — пропущено');
                continue;
            }
            if (!isSafeBloxName(name)) {
                problems.push('ім\'я файла ' + bloxSafeLog(name) + ' містить недозволені символи — пропущено');
                continue;
            }
            candidate(name, path.join(realGame, name), realGame, entries, problems);
        }
        let realAssets = null;
        try { realAssets = fs.realpathSync(assetsDir); } catch (e) { /* папки Assets немає */ }
        for (const alias of BLOX_ASSET_ALIASES) {
            if (entries.has(alias.name)) continue; // файл із папки гри важливіший
            if (!realAssets) {
                problems.push('немає папки Assets (' + assetsDir + '), тому «' + alias.name + '» не додано');
                continue;
            }
            candidate(alias.name, path.join(realAssets, alias.source), realAssets, entries, problems);
            if (!entries.has(alias.name)) problems.push('немає файла Assets/' + alias.source + ', тому «' + alias.name + '» не додано');
        }
        return { entries, problems };
    }

    function readFileChecked(entry) {
        return fs.readFileSync(entry.abs);
    }

    // sha256 і справжній розмір (за прочитаними байтами) з кешем за розміром і датою зміни
    function describe(entry) {
        const sig = entry.size + ':' + entry.mtimeMs;
        const cached = hashCache.get(entry.abs);
        if (cached && cached.sig === sig) return cached;
        const buf = readFileChecked(entry);
        const info = {
            sig,
            size: buf.length,
            sha256: require('crypto').createHash('sha256').update(buf).digest('hex')
        };
        hashCache.set(entry.abs, info);
        return info;
    }

    function buildManifest() {
        const { entries, problems } = scan();
        const missing = BLOX_REQUIRED_FILES.filter((n) => !entries.has(n));
        if (missing.length > 0) {
            const err = new Error('У папці гри ' + gameDir + ' немає обов\'язкових файлів: ' + missing.join(', '));
            err.code = 'required_missing';
            err.missing = missing;
            throw err;
        }
        const files = [];
        const versionHash = require('crypto').createHash('sha256');
        for (const entry of entries.values()) {
            const info = describe(entry);
            files.push({ name: entry.name, size: info.size, sha256: info.sha256 });
            versionHash.update(entry.name + ':' + info.size + ':' + info.sha256 + '\n');
        }
        const total = files.reduce((sum, f) => sum + f.size, 0);
        return { manifest: { version: versionHash.digest('hex').slice(0, 16), files, total }, problems };
    }

    function sendJson(res, status, code, message, extraHeaders) {
        const body = JSON.stringify({ ok: false, error: code, message });
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (extraHeaders) for (const k of Object.keys(extraHeaders)) res.setHeader(k, extraHeaders[k]);
        res.setHeader('Content-Length', Buffer.byteLength(body));
        res.end(body);
    }

    function serveManifest(req, res) {
        let built;
        try {
            built = buildManifest();
        } catch (e) {
            const code = e && e.code === 'required_missing' ? 'game_files_missing' : e && e.code === 'dir_missing' ? 'game_dir_missing' : 'manifest_error';
            log.error('KishkaBlox /blox/manifest.json: ' + (e && e.message) + ' (cwd=' + process.cwd() + ', __dirname=' + __dirname + ')');
            return sendJson(res, 503, code, 'Файли гри на сервері недоступні. Спробуйте пізніше.');
        }
        for (const p of built.problems) log.warn('KishkaBlox /blox/manifest.json: ' + p);
        const body = JSON.stringify(built.manifest);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Length', Buffer.byteLength(body));
        res.end(body);
    }

    function serveFile(req, res, rawName) {
        let name;
        try {
            name = decodeURIComponent(rawName);
        } catch (e) {
            log.warn('KishkaBlox /blox/files: некоректне кодування імені ' + bloxSafeLog(rawName));
            return sendJson(res, 400, 'bad_name', 'Некоректне ім\'я файла');
        }
        if (!isSafeBloxName(name)) {
            log.warn('KishkaBlox /blox/files: заблоковано небезпечне ім\'я ' + bloxSafeLog(name));
            return sendJson(res, 400, 'bad_name', 'Некоректне ім\'я файла');
        }
        let scanned;
        try {
            scanned = scan();
        } catch (e) {
            log.error('KishkaBlox /blox/files/' + name + ': ' + (e && e.message));
            return sendJson(res, 503, 'game_dir_missing', 'Файли гри на сервері недоступні. Спробуйте пізніше.');
        }
        const entry = scanned.entries.get(name);
        if (!entry) {
            log.error('KishkaBlox /blox/files/' + name + ': файла немає у списку установки (папка ' + gameDir + ')');
            return sendJson(res, 404, 'file_not_found', 'Файла немає в установці гри');
        }
        let buf;
        try {
            buf = readFileChecked(entry);
        } catch (e) {
            if (e && e.code === 'ENOENT') {
                log.error('KishkaBlox /blox/files/' + name + ': файл зник з диска: ' + entry.abs);
                return sendJson(res, 404, 'file_not_found', 'Файла немає в установці гри');
            }
            log.error('KishkaBlox /blox/files/' + name + ': не вдалося прочитати ' + entry.abs + ': ' + (e && e.message));
            return sendJson(res, 500, 'read_error', 'Не вдалося прочитати файл');
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', BLOX_MIME[path.extname(name).toLowerCase()] || 'application/octet-stream');
        res.setHeader('Content-Length', buf.length);
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.end(buf);
    }

    // Єдиний обробник усього, що починається з /blox. Підключається як app.use('/blox', handle):
    // Express відрізає '/blox' від req.url, тому тут шляхи виглядають як /manifest.json та /files/<ім'я>.
    function handle(req, res) {
        try {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                return sendJson(res, 405, 'method_not_allowed', 'Дозволено лише GET', { Allow: 'GET, HEAD' });
            }
            const raw = String(req.url || '/').split('?')[0].split('#')[0];
            if (raw === '/manifest.json') return serveManifest(req, res);
            if (raw.startsWith('/files/')) return serveFile(req, res, raw.slice('/files/'.length));
            return sendJson(res, 404, 'not_found', 'Невідомий маршрут KishkaBlox');
        } catch (e) {
            log.error('KishkaBlox ' + req.method + ' ' + bloxSafeLog(req.url) + ': ' + (e && e.stack || e));
            if (!res.headersSent) sendJson(res, 500, 'server_error', 'Помилка сервера');
            else res.end();
        }
    }

    // Один раз при запуску пишемо в лог, що саме сервер бачить (допомагає знайти неправильний шлях на Render)
    function logStartup() {
        try {
            const built = buildManifest();
            log.log('KishkaBlox: роздача гри з ' + gameDir + ': ' + built.manifest.files.length + ' файлів, ' + built.manifest.total + ' байт, версія ' + built.manifest.version + ' (' + built.manifest.files.map((f) => f.name).join(', ') + ')');
            for (const p of built.problems) log.warn('KishkaBlox: ' + p);
        } catch (e) {
            log.error('KishkaBlox: УСТАНОВКА ГРИ НЕ ПРАЦЮЄ — ' + (e && e.message) + ' (cwd=' + process.cwd() + ', __dirname=' + __dirname + '). Перевірте, що Render розгортає потрібний репозиторій/гілку і що папка blox_game є у корені проєкту.');
        }
    }

    function register(app) {
        app.use('/blox', handle);
        logStartup();
    }

    return { handle, register, buildManifest, scan, gameDir, assetsDir };
}

function cleanEmail(value) {
    return String(value || '').trim().toLowerCase();
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
    const { io, app, dbRun, dbAll } = ctx;

    // Маршрути установки гри реєструємо першими й окремо від бази: що б не сталося з таблицями, файли гри віддаються
    try {
        if (!app) throw new Error('server.js не передав app у KishkaBlox');
        createBloxFiles().register(app);
    } catch (e) {
        console.error('KishkaBlox: маршрути /blox/* не підключено:', e && e.message);
    }

    const ready = (async () => {
        await dbRun(`CREATE TABLE IF NOT EXISTS blox_accounts (
            nick_lower TEXT PRIMARY KEY,
            nick TEXT NOT NULL,
            pass_salt TEXT NOT NULL,
            pass_hash TEXT NOT NULL,
            created INTEGER NOT NULL
        )`);
        // Прив'язка до акаунта Kishka (пошта) і стан «увійшов / вийшов» — на сервері, а не на пристрої.
        // Якщо колонка вже є — база поверне помилку, її ігноруємо.
        try { await dbRun('ALTER TABLE blox_accounts ADD COLUMN owner_email TEXT'); } catch (e) { /* вже є */ }
        try { await dbRun('ALTER TABLE blox_accounts ADD COLUMN logged_in INTEGER DEFAULT 0'); } catch (e) { /* вже є */ }
        await dbRun('CREATE UNIQUE INDEX IF NOT EXISTS idx_blox_owner ON blox_accounts (owner_email)');

        await dbRun(`CREATE TABLE IF NOT EXISTS blox_friend_requests (
            from_lower TEXT NOT NULL,
            to_lower TEXT NOT NULL,
            created INTEGER NOT NULL,
            PRIMARY KEY (from_lower, to_lower)
        )`);
        await dbRun(`CREATE TABLE IF NOT EXISTS blox_friends (
            a_lower TEXT NOT NULL,
            b_lower TEXT NOT NULL,
            created INTEGER NOT NULL,
            PRIMARY KEY (a_lower, b_lower)
        )`);
    })().catch((e) => console.error('KishkaBlox: не вдалося створити таблиці:', e && e.message));

    function reply(cb, payload) {
        if (typeof cb === 'function') {
            try { cb(payload); } catch (e) { /* клієнт уже відключився */ }
        }
    }

    // Обгортка: чекає на таблиці, ловить помилки, завжди відповідає клієнту
    function on(socket, event, fn) {
        socket.on(event, async (data, cb) => {
            try {
                await ready;
                await fn(data || {}, (payload) => reply(cb, payload));
            } catch (e) {
                console.error(event + ':', e && e.message);
                reply(cb, { success: false, code: 'error' });
            }
        });
    }

    async function accountByOwner(email) {
        if (!email) return null;
        const rows = await dbAll(
            'SELECT nick_lower, nick, pass_salt, pass_hash, logged_in, owner_email FROM blox_accounts WHERE owner_email = ?',
            [email]
        );
        return rows[0] || null;
    }

    async function accountByNick(nickLower) {
        if (!nickLower) return null;
        const rows = await dbAll(
            'SELECT nick_lower, nick, pass_salt, pass_hash, logged_in, owner_email FROM blox_accounts WHERE nick_lower = ?',
            [nickLower]
        );
        return rows[0] || null;
    }

    // Акаунт Kishka, який зараз увійшов у KishkaBlox (інакше null)
    async function loggedInAccount(email) {
        const acc = await accountByOwner(email);
        return acc && Number(acc.logged_in) === 1 ? acc : null;
    }

    // Повідомляє всі пристрої акаунта Kishka, що друзі/запити/вхід змінились
    function notifyOwner(email) {
        if (email) io.to(email).emit('blox_update');
    }

    async function notifyNick(nickLower) {
        const acc = await accountByNick(nickLower);
        if (acc && acc.owner_email) notifyOwner(acc.owner_email);
    }

    async function relationBetween(myLower, otherLower) {
        const friend = await dbAll('SELECT a_lower FROM blox_friends WHERE a_lower = ? AND b_lower = ?', [myLower, otherLower]);
        if (friend.length > 0) return 'friend';
        const sent = await dbAll('SELECT from_lower FROM blox_friend_requests WHERE from_lower = ? AND to_lower = ?', [myLower, otherLower]);
        if (sent.length > 0) return 'sent';
        const incoming = await dbAll('SELECT from_lower FROM blox_friend_requests WHERE from_lower = ? AND to_lower = ?', [otherLower, myLower]);
        if (incoming.length > 0) return 'incoming';
        return 'none';
    }

    async function makeFriends(aLower, bLower) {
        const now = Date.now();
        await dbRun('INSERT OR IGNORE INTO blox_friends (a_lower, b_lower, created) VALUES (?, ?, ?)', [aLower, bLower, now]);
        await dbRun('INSERT OR IGNORE INTO blox_friends (a_lower, b_lower, created) VALUES (?, ?, ?)', [bLower, aLower, now]);
        await dbRun('DELETE FROM blox_friend_requests WHERE (from_lower = ? AND to_lower = ?) OR (from_lower = ? AND to_lower = ?)', [aLower, bLower, bLower, aLower]);
    }

    io.on('connection', (socket) => {
        // Повний стан для екрана: чи є акаунт, чи увійшов, а якщо так — друзі та запити
        on(socket, 'blox_status', async (data, done) => {
            const email = cleanEmail(data.email);
            if (!email) return done({ success: false, code: 'error' });
            const acc = await accountByOwner(email);
            if (!acc) return done({ success: true, state: 'none' });
            if (Number(acc.logged_in) !== 1) return done({ success: true, state: 'out', nick: acc.nick });

            const friends = await dbAll(
                `SELECT a.nick AS nick FROM blox_friends f JOIN blox_accounts a ON a.nick_lower = f.b_lower
                 WHERE f.a_lower = ? ORDER BY f.created ASC`,
                [acc.nick_lower]
            );
            const incoming = await dbAll(
                `SELECT a.nick AS nick FROM blox_friend_requests r JOIN blox_accounts a ON a.nick_lower = r.from_lower
                 WHERE r.to_lower = ? ORDER BY r.created ASC`,
                [acc.nick_lower]
            );
            const outgoing = await dbAll(
                `SELECT a.nick AS nick FROM blox_friend_requests r JOIN blox_accounts a ON a.nick_lower = r.to_lower
                 WHERE r.from_lower = ? ORDER BY r.created ASC`,
                [acc.nick_lower]
            );
            done({
                success: true,
                state: 'in',
                nick: acc.nick,
                friends: friends.map((r) => r.nick),
                incoming: incoming.map((r) => r.nick),
                outgoing: outgoing.map((r) => r.nick)
            });
        });

        on(socket, 'blox_register', async (data, done) => {
            const email = cleanEmail(data.email);
            const nick = String(data.nick || '').trim();
            const password = String(data.password || '');
            if (!email) return done({ success: false, code: 'error' });
            if (!validNick(nick)) return done({ success: false, code: 'bad_nick' });
            if (!validPassword(password)) return done({ success: false, code: 'bad_password' });

            // Один акаунт Kishka — один акаунт KishkaBlox
            if (await accountByOwner(email)) return done({ success: false, code: 'has_account' });

            const nickLower = nick.toLowerCase();
            if (await accountByNick(nickLower)) return done({ success: false, code: 'taken' });

            const salt = crypto.randomBytes(16).toString('hex');
            try {
                await dbRun(
                    'INSERT INTO blox_accounts (nick_lower, nick, pass_salt, pass_hash, created, owner_email, logged_in) VALUES (?, ?, ?, ?, ?, ?, 1)',
                    [nickLower, nick, salt, hashPassword(password, salt), Date.now(), email]
                );
            } catch (e) {
                // Двоє одночасно зайняли один нік (або один акаунт Kishka створив двічі): база пропустила лише першого
                if (await accountByNick(nickLower)) return done({ success: false, code: 'taken' });
                if (await accountByOwner(email)) return done({ success: false, code: 'has_account' });
                throw e;
            }
            notifyOwner(email);
            done({ success: true, nick });
        });

        on(socket, 'blox_login', async (data, done) => {
            const email = cleanEmail(data.email);
            const nick = String(data.nick || '').trim();
            const password = String(data.password || '');
            if (!email) return done({ success: false, code: 'error' });
            if (!nick || !password) return done({ success: false, code: 'wrong_password' });

            const nickLower = nick.toLowerCase();
            const emailKey = 'e:' + email;
            if (tooManyFailures(nickLower) || tooManyFailures(emailKey)) return done({ success: false, code: 'too_many' });

            const fail = (code) => {
                noteFailure(nickLower);
                noteFailure(emailKey);
                done({ success: false, code });
            };

            const mine = await accountByOwner(email);
            let target;
            if (mine) {
                // В акаунта Kishka вже є свій KishkaBlox: увійти можна лише в нього
                if (mine.nick_lower !== nickLower) return fail('wrong_password');
                target = mine;
            } else {
                target = await accountByNick(nickLower);
                if (!target) return fail('not_found');
                // Чужий акаунт (прив'язаний до іншого акаунта Kishka) — не відкриваємо, не розкриваючи подробиць
                if (target.owner_email && target.owner_email !== email) return fail('wrong_password');
            }

            if (!safeEqualHex(hashPassword(password, target.pass_salt), target.pass_hash)) return fail('wrong_password');

            if (!target.owner_email) {
                // Старий акаунт без прив'язки: прив'язуємо до цього акаунта Kishka (лише якщо його ще ніхто не забрав)
                await dbRun('UPDATE blox_accounts SET owner_email = ?, logged_in = 1 WHERE nick_lower = ? AND owner_email IS NULL', [email, target.nick_lower]);
                const after = await accountByNick(target.nick_lower);
                if (!after || after.owner_email !== email) return fail('wrong_password');
            } else {
                await dbRun('UPDATE blox_accounts SET logged_in = 1 WHERE nick_lower = ? AND owner_email = ?', [target.nick_lower, email]);
            }

            failures.delete(nickLower);
            failures.delete(emailKey);
            notifyOwner(email);
            done({ success: true, nick: target.nick });
        });

        on(socket, 'blox_logout', async (data, done) => {
            const email = cleanEmail(data.email);
            if (!email) return done({ success: false, code: 'error' });
            await dbRun('UPDATE blox_accounts SET logged_in = 0 WHERE owner_email = ?', [email]);
            notifyOwner(email);
            done({ success: true });
        });

        // Пошук за ніком: точний збіг (регістр не важливий)
        on(socket, 'blox_search', async (data, done) => {
            const email = cleanEmail(data.email);
            const me = await loggedInAccount(email);
            if (!me) return done({ success: false, code: 'not_logged_in' });

            const queryLower = String(data.query || '').trim().toLowerCase();
            if (!queryLower || queryLower === me.nick_lower) return done({ success: true, found: false });

            const target = await accountByNick(queryLower);
            if (!target) return done({ success: true, found: false });

            done({ success: true, found: true, nick: target.nick, relation: await relationBetween(me.nick_lower, target.nick_lower) });
        });

        on(socket, 'blox_add_friend', async (data, done) => {
            const email = cleanEmail(data.email);
            const me = await loggedInAccount(email);
            if (!me) return done({ success: false, code: 'not_logged_in' });

            const targetLower = String(data.nick || '').trim().toLowerCase();
            const target = await accountByNick(targetLower);
            if (!target) return done({ success: false, code: 'not_found' });
            if (target.nick_lower === me.nick_lower) return done({ success: false, code: 'self' });

            const relation = await relationBetween(me.nick_lower, target.nick_lower);
            if (relation === 'friend') return done({ success: true, relation: 'friend' });
            if (relation === 'sent') return done({ success: true, relation: 'sent' });
            if (relation === 'incoming') {
                // Людина вже надіслала запит нам — надсилання у відповідь одразу робить вас друзями
                await makeFriends(me.nick_lower, target.nick_lower);
                notifyOwner(email);
                if (target.owner_email) notifyOwner(target.owner_email);
                return done({ success: true, relation: 'friend' });
            }

            await dbRun('INSERT OR IGNORE INTO blox_friend_requests (from_lower, to_lower, created) VALUES (?, ?, ?)', [me.nick_lower, target.nick_lower, Date.now()]);
            if (target.owner_email) notifyOwner(target.owner_email);
            done({ success: true, relation: 'sent' });
        });

        // Відповідь на вхідний запит: accept = true — прийняти, false — відхилити
        on(socket, 'blox_respond', async (data, done) => {
            const email = cleanEmail(data.email);
            const me = await loggedInAccount(email);
            if (!me) return done({ success: false, code: 'not_logged_in' });

            const fromLower = String(data.nick || '').trim().toLowerCase();
            const pending = await dbAll('SELECT from_lower FROM blox_friend_requests WHERE from_lower = ? AND to_lower = ?', [fromLower, me.nick_lower]);
            if (pending.length === 0) return done({ success: true }); // запит уже оброблено/скасовано — екран просто оновиться

            if (data.accept === true) {
                await makeFriends(me.nick_lower, fromLower);
            } else {
                await dbRun('DELETE FROM blox_friend_requests WHERE from_lower = ? AND to_lower = ?', [fromLower, me.nick_lower]);
            }
            notifyOwner(email);
            await notifyNick(fromLower);
            done({ success: true });
        });

        // Видалення друга. Нічого не блокується: запит можна надіслати знову
        on(socket, 'blox_delete_friend', async (data, done) => {
            const email = cleanEmail(data.email);
            const me = await loggedInAccount(email);
            if (!me) return done({ success: false, code: 'not_logged_in' });

            const otherLower = String(data.nick || '').trim().toLowerCase();
            await dbRun('DELETE FROM blox_friends WHERE (a_lower = ? AND b_lower = ?) OR (a_lower = ? AND b_lower = ?)', [me.nick_lower, otherLower, otherLower, me.nick_lower]);
            await dbRun('DELETE FROM blox_friend_requests WHERE (from_lower = ? AND to_lower = ?) OR (from_lower = ? AND to_lower = ?)', [me.nick_lower, otherLower, otherLower, me.nick_lower]);
            notifyOwner(email);
            await notifyNick(otherLower);
            done({ success: true });
        });
    });
};

// Для тестів (test/blox.test.js)
module.exports.createBloxFiles = createBloxFiles;
module.exports.isSafeBloxName = isSafeBloxName;
