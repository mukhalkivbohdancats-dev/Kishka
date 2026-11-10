// =====================================================================
// ===== KISHKABLOX: сервер ігрової кімнати (синхронізація гравців) =====
// Підключається з kishkablox.js: createBloxGame({ io, getNick }).attach(socket) для кожного сокета.
// Стан гравців зберігається ЛИШЕ в пам'яті цього процесу, поки гравець у кімнаті. Тому сервер Render має працювати
// в ОДНОМУ екземплярі (інстансі): гравці на різних інстансах не побачать один одного (див. інструкцію в кінці файла).
//
// ---------- Події сокета (клієнт -> сервер) ----------
//   blox_game_join   { email, game, x?, y?, z?, ry? }  + ack
//        -> { success:true, id, nick, game, x, y, z, ry, a, count, tickMs, players:[{id,nick,x,y,z,ry,a}] }   (players — ІНШІ гравці)
//        -> { success:false, code }   code: bad_payload | unknown_game | not_identified | not_logged_in | game_full | error
//      Повторний вхід (перепідключення) з x,y,z,ry відновлює місце; якщо ті самі гравець зайшов менше ніж за RECONNECT_GRACE_MS
//      після обриву — він отримує той самий id.
//   blox_game_state  { x, y, z, ry, a }                без ack, до ~12 разів на секунду (дозволено сплеск, далі зайве відкидається)
//        x, z — від -300 до 300; y — від -20 до 80; ry — кут у радіанах (нормалізується до -PI..PI);
//        a — поза: 0 стоїть, 1 іде, 2 у повітрі. Усе, що не число/NaN/Infinity/поза межами, відкидається.
//   blox_game_leave  {}                                 + необов'язковий ack -> { success:true }
// ---------- Події сервер -> клієнт ----------
//   blox_game_roster { game, count, players:[{id,nick}] }   повний список гравців кімнати (кількість = довжина списку)
//   blox_game_tick   [[id, x, y, z, ry, a], ...]            лише ті, хто змінився за останні 100 мс (10 разів на секунду)
//   blox_game_kicked { reason }                             'other_device' (акаунт зайшов з іншого пристрою) | 'timeout'
//
// Кімната Socket.IO: 'blox:' + game. Дані однієї гри ніколи не потрапляють в іншу.
// Один акаунт Kishka = один гравець у грі. Якщо той самий акаунт заходить з іншого пристрою, НОВИЙ вхід перемагає:
// старому пристрою приходить blox_game_kicked, його гравець видаляється (дублікатів не буває).
// Особу сервер бере з сокета (socket.userEmail, його ставить register_or_update_user / identify), а не лише з пакета:
// email із blox_game_join мусить збігатися з ним, і цей акаунт мусить бути ВВІЙДЕНИЙ у KishkaBlox (нік — з бази, не від клієнта).
// У репозиторії для звичайних подій немає токенів сокета (Firebase-токен перевіряється лише для адміністратора),
// тому підміна email з іншого сокета, який вже назвався чужою поштою, неможлива, але це не криптографічний захист.
// =====================================================================

const GAMES = new Set(['realistic_cars']);          // дозволені ідентифікатори ігор (Bloxgame.kt -> BloxGame.GAME_ID)
const MAX_PLAYERS = 50;
const TICK_MS = 100;                                // частота розсилки станів (10 Гц)
const BOUND_XZ = 300;                               // світ ±250, запас на край
const BOUND_Y_MIN = -20;
const BOUND_Y_MAX = 80;
const RATE_BURST = 30;                              // ведро: сплеск пакетів
const RATE_PER_SEC = 20;                            // ведро: сталий темп (клієнт надсилає ~11/с)
const STALE_MS = 60 * 1000;                         // жодного пакета стану 60 с -> гравець виходить із гри
const RECONNECT_GRACE_MS = 15 * 1000;               // стільки часу після обриву сервер тримає id і позицію
const SPAWN = { x: 0, y: 4, z: 30 };

function isNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

function round2(v) {
    return Math.round(v * 100) / 100;
}

function wrapAngle(a) {
    const TWO = Math.PI * 2;
    let r = a % TWO;
    if (r > Math.PI) r -= TWO;
    else if (r < -Math.PI) r += TWO;
    return r;
}

// Перевіряє й нормалізує стан. Повертає { x, y, z, ry, a } або null, якщо щось некоректне.
function sanitizeState(d) {
    if (!d || typeof d !== 'object') return null;
    if (!isNum(d.x) || !isNum(d.y) || !isNum(d.z) || !isNum(d.ry)) return null;
    if (Math.abs(d.x) > BOUND_XZ || Math.abs(d.z) > BOUND_XZ) return null;
    if (d.y < BOUND_Y_MIN || d.y > BOUND_Y_MAX) return null;
    if (Math.abs(d.ry) > 1000) return null;
    const a = d.a === undefined ? 0 : d.a;
    if (!(a === 0 || a === 1 || a === 2)) return null;
    return { x: round2(d.x), y: round2(d.y), z: round2(d.z), ry: round2(wrapAngle(d.ry)), a };
}

function cleanEmail(value) {
    return String(value || '').trim().toLowerCase();
}

// Безпечний для логів вигляд ніку (без переносів рядків і зайвої довжини)
function logNick(nick) {
    return JSON.stringify(String(nick || '').slice(0, 24));
}

function createBloxGame(options) {
    const opts = options || {};
    const io = opts.io;
    const getNick = opts.getNick; // async (email) -> нік (рядок) або null, якщо акаунт не ввійшов у KishkaBlox
    const log = opts.logger || console;
    const now = opts.now || (() => Date.now());
    const tickMs = opts.tickMs || TICK_MS;
    const staleMs = opts.staleMs || STALE_MS;
    const graceMs = opts.graceMs === undefined ? RECONNECT_GRACE_MS : opts.graceMs;
    const maxPlayers = opts.maxPlayers || MAX_PLAYERS;
    const games = opts.games || GAMES;
    if (!io || typeof getNick !== 'function') throw new Error('createBloxGame: потрібні io та getNick');

    // game -> { players: Map<id, player>, byEmail: Map<email, id>, reserved: Map<email, {...}>, nextId, timer }
    const rooms = new Map();
    // Помилки, які повторюються, пишемо в лог не частіше ніж раз на 10 с на тип
    const logGate = new Map();

    function logLimited(key, text) {
        const t = now();
        const g = logGate.get(key);
        if (g && t - g.t < 10000) {
            g.skipped++;
            return;
        }
        logGate.set(key, { t, skipped: 0 });
        log.warn('[blox-game] ' + text + (g && g.skipped ? ' (пропущено схожих: ' + g.skipped + ')' : ''));
    }

    function roomName(game) {
        return 'blox:' + game;
    }

    function getRoom(game) {
        let r = rooms.get(game);
        if (!r) {
            r = { players: new Map(), byEmail: new Map(), reserved: new Map(), nextId: 1, timer: null };
            rooms.set(game, r);
        }
        return r;
    }

    function rosterPayload(game, room) {
        const players = Array.from(room.players.values()).map((p) => ({ id: p.id, nick: p.nick }));
        return { game, count: players.length, players };
    }

    function broadcastRoster(game, room) {
        io.to(roomName(game)).emit('blox_game_roster', rosterPayload(game, room));
    }

    function startTimer(game, room) {
        if (room.timer) return;
        room.timer = setInterval(() => tick(game, room), tickMs);
        if (room.timer.unref) room.timer.unref();
    }

    function stopTimerIfEmpty(room) {
        if (room.players.size === 0 && room.timer) {
            clearInterval(room.timer);
            room.timer = null;
        }
    }

    function tick(game, room) {
        const t = now();
        const out = [];
        for (const p of Array.from(room.players.values())) {
            if (t - p.lastStateAt > staleMs) {
                // Сокет живий, але стану нема: згорнутий застосунок чи завис WebView
                log.warn('[blox-game] тайм-аут стану: гра=' + game + ' id=' + p.id + ' нік=' + logNick(p.nick) + ' (' + Math.round((t - p.lastStateAt) / 1000) + ' с без оновлень)');
                io.to(p.socketId).emit('blox_game_kicked', { reason: 'timeout' });
                removePlayer(game, room, p, 'timeout');
                continue;
            }
            if (p.dirty) {
                p.dirty = false;
                out.push([p.id, p.x, p.y, p.z, p.ry, p.a]);
            }
        }
        for (const [email, r] of Array.from(room.reserved.entries())) {
            if (t - r.at > graceMs) room.reserved.delete(email);
        }
        if (out.length > 0) io.to(roomName(game)).emit('blox_game_tick', out);
        stopTimerIfEmpty(room);
    }

    // Прибирає гравця з кімнати й повідомляє інших. Повертає кількість гравців ДО зміни.
    function removePlayer(game, room, p, why) {
        const before = room.players.size;
        room.players.delete(p.id);
        if (room.byEmail.get(p.email) === p.id) room.byEmail.delete(p.email);
        const s = io.sockets && io.sockets.sockets && io.sockets.sockets.get ? io.sockets.sockets.get(p.socketId) : null;
        if (s) {
            try { s.leave(roomName(game)); } catch (e) { /* ignore */ }
            if (s.bloxGame && s.bloxGame.id === p.id) s.bloxGame = null;
        }
        broadcastRoster(game, room);
        log.log('[blox-game] вихід (' + why + '): гра=' + game + ' id=' + p.id + ' нік=' + logNick(p.nick) + ' гравців ' + before + ' -> ' + room.players.size);
        stopTimerIfEmpty(room);
        return before;
    }

    function fail(ack, code, text) {
        log.warn('[blox-game] відмова у вході: ' + code + (text ? ' — ' + text : ''));
        if (typeof ack === 'function') {
            try { ack({ success: false, code }); } catch (e) { /* клієнт уже відключився */ }
        }
    }

    async function handleJoin(socket, data, ack) {
        if (!data || typeof data !== 'object') return fail(ack, 'bad_payload', 'порожній пакет');
        const email = cleanEmail(data.email);
        const game = typeof data.game === 'string' ? data.game : '';
        if (!email || !email.includes('@')) return fail(ack, 'bad_payload', 'немає email');
        if (!games.has(game)) return fail(ack, 'unknown_game', 'гра ' + JSON.stringify(game.slice(0, 40)));
        if (!socket.userEmail) return fail(ack, 'not_identified', 'сокет ще не назвався (register_or_update_user)');
        if (socket.userEmail !== email) return fail(ack, 'not_identified', 'email у пакеті не збігається з акаунтом сокета');

        let nick;
        try {
            nick = await getNick(email);
        } catch (e) {
            log.error('[blox-game] не вдалося перевірити акаунт KishkaBlox: ' + (e && e.message));
            return fail(ack, 'error', 'збій перевірки акаунта');
        }
        if (!nick) return fail(ack, 'not_logged_in', 'акаунт не ввійшов у KishkaBlox');
        // Поки чекали базу, сокет міг відключитись
        if (socket.disconnected === true) return fail(ack, 'error', 'сокет відключився під час входу');

        const room = getRoom(game);
        const before = room.players.size;

        // Дублікат: той самий акаунт уже в кімнаті (інший пристрій або ще не закритий старий сокет)
        let reusedId = null;
        let startState = null;
        const existingId = room.byEmail.get(email);
        if (existingId !== undefined) {
            const old = room.players.get(existingId);
            if (old) {
                if (old.socketId !== socket.id) {
                    io.to(old.socketId).emit('blox_game_kicked', { reason: 'other_device' });
                    log.log('[blox-game] дублікат входу: гра=' + game + ' id=' + old.id + ' нік=' + logNick(old.nick) + ' — старий пристрій відключено');
                    const oldSocket = io.sockets && io.sockets.sockets && io.sockets.sockets.get ? io.sockets.sockets.get(old.socketId) : null;
                    if (oldSocket) {
                        try { oldSocket.leave(roomName(game)); } catch (e) { /* ignore */ }
                        oldSocket.bloxGame = null;
                    }
                }
                reusedId = old.id;
                startState = { x: old.x, y: old.y, z: old.z, ry: old.ry, a: 0 };
                room.players.delete(old.id);
                room.byEmail.delete(email);
            }
        }
        if (reusedId === null) {
            const res = room.reserved.get(email);
            if (res && now() - res.at <= graceMs) {
                reusedId = res.id;
                startState = { x: res.x, y: res.y, z: res.z, ry: res.ry, a: 0 };
                log.log('[blox-game] повторне підключення: гра=' + game + ' id=' + res.id + ' нік=' + logNick(nick));
            }
            room.reserved.delete(email);
        }
        if (reusedId === null && room.players.size >= maxPlayers) return fail(ack, 'game_full', 'гравців ' + room.players.size);

        // Початковий стан: те, що надіслав клієнт при повторному вході (перевірене), інакше збережене, інакше точка появи
        const given = (isNum(data.x) && isNum(data.y) && isNum(data.z) && isNum(data.ry)) ? sanitizeState({ x: data.x, y: data.y, z: data.z, ry: data.ry, a: 0 }) : null;
        const id = reusedId !== null ? reusedId : room.nextId++;
        const spawn = given || startState || {
            x: SPAWN.x + (((id - 1) % 5) - 2) * 4,
            y: SPAWN.y,
            z: SPAWN.z + Math.floor(((id - 1) % 25) / 5) * 4,
            ry: 0,
            a: 0
        };

        const player = {
            id, email, nick, socketId: socket.id,
            x: spawn.x, y: spawn.y, z: spawn.z, ry: spawn.ry, a: 0,
            dirty: true, lastStateAt: now(),
            tokens: RATE_BURST, tokensAt: now()
        };
        room.players.set(id, player);
        room.byEmail.set(email, id);
        socket.bloxGame = { game, id };
        socket.join(roomName(game));
        startTimer(game, room);

        broadcastRoster(game, room);
        log.log('[blox-game] вхід: гра=' + game + ' id=' + id + ' нік=' + logNick(nick) + ' гравців ' + before + ' -> ' + room.players.size);

        if (typeof ack === 'function') {
            const others = [];
            for (const p of room.players.values()) {
                if (p.id !== id) others.push({ id: p.id, nick: p.nick, x: p.x, y: p.y, z: p.z, ry: p.ry, a: p.a });
            }
            try {
                ack({ success: true, id, nick, game, x: player.x, y: player.y, z: player.z, ry: player.ry, a: 0, count: room.players.size, tickMs, players: others });
            } catch (e) { /* клієнт уже відключився */ }
        }
    }

    function handleState(socket, data) {
        const m = socket.bloxGame;
        if (!m) {
            logLimited('state_nojoin', 'стан від сокета без входу в гру (' + socket.id + ') — відкинуто');
            return;
        }
        const room = rooms.get(m.game);
        const p = room && room.players.get(m.id);
        if (!p || p.socketId !== socket.id) return;

        // Обмеження частоти: ведро з жетонами
        const t = now();
        p.tokens = Math.min(RATE_BURST, p.tokens + ((t - p.tokensAt) / 1000) * RATE_PER_SEC);
        p.tokensAt = t;
        if (p.tokens < 1) {
            logLimited('rate:' + p.id, 'забагато пакетів стану: гра=' + m.game + ' id=' + p.id + ' нік=' + logNick(p.nick));
            return;
        }
        p.tokens -= 1;

        const s = sanitizeState(data);
        if (!s) {
            logLimited('bad_state:' + p.id, 'некоректний стан: гра=' + m.game + ' id=' + p.id + ' нік=' + logNick(p.nick) + ' — відкинуто');
            return;
        }
        p.lastStateAt = t;
        if (s.x !== p.x || s.y !== p.y || s.z !== p.z || s.ry !== p.ry || s.a !== p.a) {
            p.x = s.x; p.y = s.y; p.z = s.z; p.ry = s.ry; p.a = s.a;
            p.dirty = true;
        }
    }

    function handleLeave(socket, ack) {
        const m = socket.bloxGame;
        if (m) {
            const room = rooms.get(m.game);
            const p = room && room.players.get(m.id);
            if (room && p && p.socketId === socket.id) {
                room.reserved.delete(p.email);
                removePlayer(m.game, room, p, 'гравець вийшов');
            }
            socket.bloxGame = null;
        }
        if (typeof ack === 'function') {
            try { ack({ success: true }); } catch (e) { /* ignore */ }
        }
    }

    function handleDisconnect(socket, reason) {
        const m = socket.bloxGame;
        if (!m) return;
        const room = rooms.get(m.game);
        const p = room && room.players.get(m.id);
        if (!room || !p || p.socketId !== socket.id) return; // гравця вже замінив новий вхід
        // Зберігаємо id і позицію на короткий час: швидке перепідключення не створює «нового» гравця
        room.reserved.set(p.email, { id: p.id, x: p.x, y: p.y, z: p.z, ry: p.ry, at: now() });
        removePlayer(m.game, room, p, 'відключення: ' + reason);
        socket.bloxGame = null;
    }

    function attach(socket) {
        socket.bloxGame = null;
        socket.on('blox_game_join', (data, ack) => {
            handleJoin(socket, data, ack).catch((e) => {
                log.error('[blox-game] blox_game_join: ' + (e && e.stack || e));
                if (typeof ack === 'function') {
                    try { ack({ success: false, code: 'error' }); } catch (x) { /* ignore */ }
                }
            });
        });
        socket.on('blox_game_state', (data) => {
            try { handleState(socket, data); } catch (e) { log.error('[blox-game] blox_game_state: ' + (e && e.message)); }
        });
        socket.on('blox_game_leave', (data, ack) => {
            // Клієнт може надіслати leave без даних і без ack (Bloxgame.kt): тоді перший аргумент — ack
            const cb = typeof data === 'function' ? data : ack;
            try { handleLeave(socket, cb); } catch (e) { log.error('[blox-game] blox_game_leave: ' + (e && e.message)); }
        });
        socket.on('disconnect', (reason) => {
            try { handleDisconnect(socket, reason); } catch (e) { log.error('[blox-game] disconnect: ' + (e && e.message)); }
        });
    }

    log.log('[blox-game] ігровий сервіс запущено: ігор ' + games.size + ' (' + Array.from(games).join(', ') + '), оновлення ' + Math.round(1000 / tickMs) + ' разів на секунду, режим одного інстанса (стан у пам\'яті)');

    function stats(game) {
        const r = rooms.get(game);
        return { count: r ? r.players.size : 0, reserved: r ? r.reserved.size : 0, timer: !!(r && r.timer) };
    }

    function shutdown() {
        for (const r of rooms.values()) {
            if (r.timer) clearInterval(r.timer);
            r.timer = null;
        }
    }

    return { attach, stats, shutdown, rooms };
}

module.exports = { createBloxGame, sanitizeState, GAMES, TICK_MS, BOUND_XZ, BOUND_Y_MIN, BOUND_Y_MAX, RATE_BURST, RATE_PER_SEC };
