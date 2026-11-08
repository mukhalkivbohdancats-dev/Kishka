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
    const { io, dbRun, dbAll } = ctx;

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
