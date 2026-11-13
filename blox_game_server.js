// =====================================================================
// ===== KISHKABLOX: сервер ігрової кімнати (синхронізація гравців) =====
// Підключається з kishkablox.js: createBloxGame({ io, getNick }).attach(socket) для кожного сокета.
// Стан гравців зберігається ЛИШЕ в пам'яті цього процесу, поки гравець у кімнаті. Тому сервер Render має працювати
// в ОДНОМУ екземплярі (інстансі): гравці на різних інстансах не побачать один одного (див. інструкцію в кінці файла).
//
// ---------- Події сокета (клієнт -> сервер) ----------
//   blox_game_join   { email, game, x?, y?, z?, ry? }  + ack
//        -> { success:true, id, nick, game, x, y, z, ry, a, count, tickMs, players:[{id,nick,x,y,z,ry,a,d}], cars:[...] }   (players — ІНШІ гравці)
//        -> { success:false, code }   code: bad_payload | unknown_game | not_identified | not_logged_in | game_full | error
//      Повторний вхід (перепідключення) з x,y,z,ry відновлює місце; якщо ті самі гравець зайшов менше ніж за RECONNECT_GRACE_MS
//      після обриву — він отримує той самий id.
//   blox_game_state  { x, y, z, ry, a, d?, c? }        без ack, до ~12 разів на секунду (дозволено сплеск, далі зайве відкидається)
//        x, z — від -700 до 700; y — від -20 до 120; ry — кут у радіанах (нормалізується до -PI..PI);
//        a — поза: 0 стоїть, 1 іде, 2 у повітрі. Усе, що не число/NaN/Infinity/поза межами, відкидається.
//        d — 1, якщо гравець сидить у своїй машині (інакше 0; без існуючої машини сервер ставить 0).
//        c — стан МОЄЇ машини { t, x, y, z, ry, s, st }: t — тип (sedan | van | truck, мусить збігатися з тим, що створено),
//            s — швидкість у студах/с (від -200 до 200), st — кут керма (від -1.2 до 1.2).
//            Сервер сам рахує швидкість для спідометра kmh = |s| · 1.008 і розсилає її всім (клієнтське значення не береться). Створити машину через state не можна — лише blox_car_spawn.
//   blox_car_spawn   { type, x, y, z, ry }              + ack -> { success:true, cid, type } | { success:false, code }
//        code: not_in_game | bad_payload | bad_type | too_far | rate | error. У гравця не більше ОДНІЄЇ машини: нова замінює стару.
//   blox_car_remove  {}                                 + необов'язковий ack -> { success:true }
//   blox_game_respawn {}                                + ack -> { success:true, x, y, z, ry } | { success:false, code }  (code: not_in_game | rate)
//        повертає персонажа на майданчик (виходить з машини; сама машина лишається на місці).
//   blox_game_report { target }                         + ack -> { success:true } | { success:false, code } (code: not_in_game | bad_target | rate)
//        скарга на гравця з меню: пишеться в журнал Render, щоб адміністратор міг розібратися.
//   blox_game_leave  {}                                 + необов'язковий ack -> { success:true }
// ---------- Події сервер -> клієнт ----------
//   blox_game_roster { game, count, players:[{id,nick}] }   повний список гравців кімнати (кількість = довжина списку)
//   blox_game_tick   [[id, x, y, z, ry, a, d], ...]         лише ті, хто змінився за останні 100 мс (10 разів на секунду)
//   blox_game_cars   { game, count, cars:[{id, cid, type, x, y, z, ry, kmh}] }   ПОВНИЙ список машин (id — власник; cid — номер створення)
//   blox_car_tick    [[id, cid, x, y, z, ry, speed, steer, kmh], ...]       рух машин, що змінилися (10 разів на секунду)
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
const BOUND_XZ = 700;                               // світ — коло радіуса 640 (world.js limitR), запас на край
const BOUND_Y_MIN = -20;
const BOUND_Y_MAX = 120;
const RATE_BURST = 30;                              // ведро: сплеск пакетів
const RATE_PER_SEC = 20;                            // ведро: сталий темп (клієнт надсилає ~11/с)
const STALE_MS = 60 * 1000;                         // жодного пакета стану 60 с -> гравець виходить із гри
const RECONNECT_GRACE_MS = 15 * 1000;               // стільки часу після обриву сервер тримає id і позицію
const SPAWN = { x: 0, y: 1, z: 0 };                  // центр круглого майданчика
const CAR_TYPES = ['sedan', 'van', 'truck'];         // дозволені машини (ті самі, що в blox_game/physics.js)
const MAX_CAR_SPEED = 200;                           // студів/с (найшвидша машина ~188 на спуску)
const STUD_TO_KMH = 1.008;                           // 1 студ = 0.28 м -> км/год на спідометрі
const MAX_WALK_SPEED = 70;                           // студів/с: ходьба 16, падіння/стрибок — із запасом
const MAX_DRIVE_SPEED = 230;                         // студів/с для гравця в машині (із запасом на польоти)
const JUMP_SLACK = 14;                               // допуск на одну дистанцію (вихід із машини, мережа)
const MAX_JUMP_REJECTS = 12;                         // стільки «телепортів» підряд відкидаємо, потім приймаємо нове місце
const RESPAWN_COOLDOWN_MS = 1000;
const MAX_STEER = 1.2;
const CAR_SPAWN_COOLDOWN_MS = 1200;                  // не частіше одного spawn на 1,2 с від гравця
const CAR_SPAWN_MAX_DIST = 60;                       // машину можна створити лише поблизу себе

function isNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

function kmhOf(s) {
    return Math.round(Math.abs(s) * STUD_TO_KMH);
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

// Стан моєї машини: { t, x, y, z, ry, s, st } або null, якщо щось некоректне
function sanitizeCar(c) {
    if (!c || typeof c !== 'object') return null;
    if (typeof c.t !== 'string' || !CAR_TYPES.includes(c.t)) return null;
    if (!isNum(c.x) || !isNum(c.y) || !isNum(c.z) || !isNum(c.ry) || !isNum(c.s) || !isNum(c.st)) return null;
    if (Math.abs(c.x) > BOUND_XZ || Math.abs(c.z) > BOUND_XZ) return null;
    if (c.y < BOUND_Y_MIN || c.y > BOUND_Y_MAX) return null;
    if (Math.abs(c.ry) > 1000) return null;
    if (Math.abs(c.s) > MAX_CAR_SPEED || Math.abs(c.st) > MAX_STEER) return null;
    return { t: c.t, x: round2(c.x), y: round2(c.y), z: round2(c.z), ry: round2(wrapAngle(c.ry)), s: round2(c.s), st: round2(c.st) };
}

// Перевіряє й нормалізує стан. Повертає { x, y, z, ry, a, d, c } (c — або null, якщо машини в пакеті немає) або null, якщо щось некоректне.
function sanitizeState(d) {
    if (!d || typeof d !== 'object') return null;
    if (!isNum(d.x) || !isNum(d.y) || !isNum(d.z) || !isNum(d.ry)) return null;
    if (Math.abs(d.x) > BOUND_XZ || Math.abs(d.z) > BOUND_XZ) return null;
    if (d.y < BOUND_Y_MIN || d.y > BOUND_Y_MAX) return null;
    if (Math.abs(d.ry) > 1000) return null;
    const a = d.a === undefined ? 0 : d.a;
    if (!(a === 0 || a === 1 || a === 2)) return null;
    const dr = d.d === undefined ? 0 : d.d;
    if (!(dr === 0 || dr === 1)) return null;
    let car = null;
    if (d.c !== undefined && d.c !== null) {
        car = sanitizeCar(d.c);
        if (!car) return null;
    }
    return { x: round2(d.x), y: round2(d.y), z: round2(d.z), ry: round2(wrapAngle(d.ry)), a, d: dr, c: car };
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
    const motionCheck = opts.motionCheck !== false;       // перевірка правдоподібності руху (у тестах із «телепортами» вимикається)
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

    function carsPayload(game, room) {
        const cars = [];
        for (const p of room.players.values()) {
            if (p.car) cars.push({ id: p.id, cid: p.car.cid, type: p.car.type, x: p.car.x, y: p.car.y, z: p.car.z, ry: p.car.ry, kmh: kmhOf(p.car.s) });
        }
        return { game, count: cars.length, cars };
    }

    function broadcastCars(game, room) {
        io.to(roomName(game)).emit('blox_game_cars', carsPayload(game, room));
    }

    // Прибирає машину гравця (без розсилки — розсилає той, хто викликав). Повертає true, якщо машина була
    function dropCar(game, p, why) {
        if (!p.car) return false;
        log.log('[blox-game] машину прибрано (' + why + '): гра=' + game + ' id=' + p.id + ' нік=' + logNick(p.nick) + ' тип=' + p.car.type + ' cid=' + p.car.cid);
        p.car = null;
        p.d = 0;
        return true;
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
        const carOut = [];
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
                out.push([p.id, p.x, p.y, p.z, p.ry, p.a, p.d]);
            }
            if (p.car && p.car.dirty) {
                p.car.dirty = false;
                carOut.push([p.id, p.car.cid, p.car.x, p.car.y, p.car.z, p.car.ry, p.car.s, p.car.st, kmhOf(p.car.s)]);
            }
        }
        for (const [email, r] of Array.from(room.reserved.entries())) {
            if (t - r.at > graceMs) room.reserved.delete(email);
        }
        if (out.length > 0) io.to(roomName(game)).emit('blox_game_tick', out);
        if (carOut.length > 0) io.to(roomName(game)).emit('blox_car_tick', carOut);
        stopTimerIfEmpty(room);
    }

    // Прибирає гравця з кімнати й повідомляє інших. Повертає кількість гравців ДО зміни.
    function removePlayer(game, room, p, why) {
        const before = room.players.size;
        const hadCar = dropCar(game, p, 'гравець пішов: ' + why);
        room.players.delete(p.id);
        if (room.byEmail.get(p.email) === p.id) room.byEmail.delete(p.email);
        const s = io.sockets && io.sockets.sockets && io.sockets.sockets.get ? io.sockets.sockets.get(p.socketId) : null;
        if (s) {
            try { s.leave(roomName(game)); } catch (e) { /* ignore */ }
            if (s.bloxGame && s.bloxGame.id === p.id) s.bloxGame = null;
        }
        broadcastRoster(game, room);
        if (hadCar) broadcastCars(game, room);
        log.log('[blox-game] вихід (' + why + '): гра=' + game + ' id=' + p.id + ' нік=' + logNick(p.nick) + ' кімната=' + roomName(game) + ' гравців ' + before + ' -> ' + room.players.size);
        stopTimerIfEmpty(room);
        return before;
    }

    function fail(ack, code, text) {
        log.warn('[blox-game] відмова у вході: причина=' + code + (text ? ' — ' + text : '') + (typeof ack === 'function' ? '' : ' (клієнт не передав ACK)'));
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
        let carry = null;                               // машина, яку повертаємо гравцеві (інший пристрій / перепідключення)
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
                carry = old.car || null;
                old.car = null;
                room.players.delete(old.id);
                room.byEmail.delete(email);
            }
        }
        if (reusedId === null) {
            const res = room.reserved.get(email);
            if (res && now() - res.at <= graceMs) {
                reusedId = res.id;
                startState = { x: res.x, y: res.y, z: res.z, ry: res.ry, a: 0 };
                carry = res.car || null;
                log.log('[blox-game] повторне підключення: гра=' + game + ' id=' + res.id + ' нік=' + logNick(nick) + (carry ? ' (машина ' + carry.type + ' збережена)' : ''));
            }
            room.reserved.delete(email);
        }
        if (reusedId === null && room.players.size >= maxPlayers) return fail(ack, 'game_full', 'гравців ' + room.players.size);

        // Початковий стан: те, що надіслав клієнт при повторному вході (перевірене), інакше збережене, інакше точка появи
        const given = (isNum(data.x) && isNum(data.y) && isNum(data.z) && isNum(data.ry)) ? sanitizeState({ x: data.x, y: data.y, z: data.z, ry: data.ry, a: 0 }) : null;
        const id = reusedId !== null ? reusedId : room.nextId++;
        // Перший гравець — рівно в центрі майданчика, наступні — по колу радіуса 6 (не один в одному)
        const slot = (id - 1) % 12;
        const ang = ((slot - 1) / 11) * Math.PI * 2;
        const spawn = given || startState || {
            x: slot === 0 ? SPAWN.x : round2(SPAWN.x + Math.cos(ang) * 6),
            y: SPAWN.y,
            z: slot === 0 ? SPAWN.z : round2(SPAWN.z + Math.sin(ang) * 6),
            ry: 1.57,
            a: 0
        };

        const player = {
            id, email, nick, socketId: socket.id,
            x: spawn.x, y: spawn.y, z: spawn.z, ry: spawn.ry, a: 0, d: 0,
            car: carry ? Object.assign({}, carry, { dirty: true }) : null,
            lastCarSpawnAt: -1e9,
            dirty: true, lastStateAt: now(), lastMoveAt: now(), allowJump: false, jumpRejects: 0,
            tokens: RATE_BURST, tokensAt: now()
        };
        room.players.set(id, player);
        room.byEmail.set(email, id);
        socket.bloxGame = { game, id };
        socket.join(roomName(game));
        startTimer(game, room);

        broadcastRoster(game, room);
        if (player.car) broadcastCars(game, room);
        log.log('[blox-game] вхід: гра=' + game + ' id=' + id + ' нік=' + logNick(nick) + ' кімната=' + roomName(game) + ' гравців ' + before + ' -> ' + room.players.size);

        if (typeof ack !== 'function') logLimited('join_noack', 'blox_game_join без ACK: гра=' + game + ' id=' + id + ' — клієнт не дізнається свій id');
        if (typeof ack === 'function') {
            const others = [];
            for (const p of room.players.values()) {
                if (p.id !== id) others.push({ id: p.id, nick: p.nick, x: p.x, y: p.y, z: p.z, ry: p.ry, a: p.a, d: p.d });
            }
            try {
                ack({ success: true, id, nick, game, x: player.x, y: player.y, z: player.z, ry: player.ry, a: 0, count: room.players.size, tickMs, players: others, cars: carsPayload(game, room).cars });
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
        let d = s.d;
        if (d === 1 && !p.car) {
            logLimited('drive_nocar:' + p.id, 'гравець id=' + p.id + ' нік=' + logNick(p.nick) + ' каже, що в машині, але машини немає — d=0');
            d = 0;
        }
        // Правдоподібність руху: за час між пакетами не можна подолати більше, ніж дозволяє швидкість. Інакше — підроблена
        // або зіпсована координата: пакет відкидаємо, позиція лишається попередньою (кілька підряд — приймаємо нове місце).
        const dtSec = Math.max(0.1, Math.min(2, (t - (p.lastMoveAt || t)) / 1000));
        const maxMove = (d === 1 ? MAX_DRIVE_SPEED : MAX_WALK_SPEED) * dtSec + JUMP_SLACK;
        const moved = Math.hypot(s.x - p.x, s.z - p.z);
        if (motionCheck && !p.allowJump && moved > maxMove) {
            p.jumpRejects = (p.jumpRejects || 0) + 1;
            if (p.jumpRejects <= MAX_JUMP_REJECTS) {
                logLimited('jump:' + p.id, 'неможливий стрибок позиції: id=' + p.id + ' нік=' + logNick(p.nick) + ' зсув ' + Math.round(moved) + ' студів за ' + dtSec.toFixed(1) + ' с (дозволено ' + Math.round(maxMove) + ') — пакет відкинуто');
                return;
            }
            log.warn('[blox-game] позиція id=' + p.id + ' нік=' + logNick(p.nick) + ' відхилялась ' + p.jumpRejects + ' разів підряд — приймаю нове місце (' + Math.round(s.x) + ', ' + Math.round(s.z) + ')');
        }
        p.jumpRejects = 0;
        p.allowJump = false;
        p.lastMoveAt = t;
        if (d !== p.d) {
            log.log('[blox-game] ' + (d === 1 ? 'посадка в машину' : 'вихід із машини') + ': гра=' + m.game + ' id=' + p.id + ' нік=' + logNick(p.nick) + (p.car ? ' тип=' + p.car.type + ' cid=' + p.car.cid : ''));
        }
        if (s.x !== p.x || s.y !== p.y || s.z !== p.z || s.ry !== p.ry || s.a !== p.a || d !== p.d) {
            p.x = s.x; p.y = s.y; p.z = s.z; p.ry = s.ry; p.a = s.a; p.d = d;
            p.dirty = true;
        }
        if (s.c) {
            if (!p.car) {
                logLimited('car_nospawn:' + p.id, 'стан машини без створення: id=' + p.id + ' нік=' + logNick(p.nick) + ' — відкинуто (машину створює лише blox_car_spawn)');
            } else if (s.c.t !== p.car.type) {
                logLimited('car_type:' + p.id, 'тип машини в стані (' + s.c.t + ') не збігається зі створеною (' + p.car.type + '): id=' + p.id + ' — відкинуто');
            } else if (motionCheck && p.car.moved && Math.hypot(s.c.x - p.car.x, s.c.z - p.car.z) > MAX_DRIVE_SPEED * dtSec + JUMP_SLACK) {
                logLimited('car_jump:' + p.id, 'неможливий стрибок машини: id=' + p.id + ' нік=' + logNick(p.nick) + ' — стан машини відкинуто');
            } else if (s.c.x !== p.car.x || s.c.y !== p.car.y || s.c.z !== p.car.z || s.c.ry !== p.car.ry || s.c.s !== p.car.s || s.c.st !== p.car.st) {
                p.car.x = s.c.x; p.car.y = s.c.y; p.car.z = s.c.z; p.car.ry = s.c.ry; p.car.s = s.c.s; p.car.st = s.c.st;
                p.car.dirty = true;
                p.car.moved = true;
            }
        }
    }

    function carAck(ack, payload) {
        if (typeof ack === 'function') {
            try { ack(payload); } catch (e) { /* клієнт уже відключився */ }
        }
    }

    // Створення машини: у гравця завжди не більше однієї — стара прибирається перед появою нової
    function handleCarSpawn(socket, data, ack) {
        if (typeof ack !== 'function') logLimited('spawn_noack', 'blox_car_spawn без ACK (' + socket.id + ') — клієнт не дізнається результат');
        const m = socket.bloxGame;
        const room = m && rooms.get(m.game);
        const p = room && room.players.get(m.id);
        if (!p || p.socketId !== socket.id) {
            logLimited('spawn_nogame:' + socket.id, 'spawn машини від сокета без входу в гру (' + socket.id + ')');
            return carAck(ack, { success: false, code: 'not_in_game' });
        }
        if (!data || typeof data !== 'object') {
            logLimited('spawn_bad:' + p.id, 'spawn машини: порожній або не об\'єкт, id=' + p.id + ' нік=' + logNick(p.nick));
            return carAck(ack, { success: false, code: 'bad_payload' });
        }
        if (typeof data.type !== 'string' || !CAR_TYPES.includes(data.type)) {
            logLimited('spawn_type:' + p.id, 'spawn машини: недозволений тип ' + JSON.stringify(String(data.type).slice(0, 20)) + ', id=' + p.id + ' нік=' + logNick(p.nick));
            return carAck(ack, { success: false, code: 'bad_type' });
        }
        const st = sanitizeState({ x: data.x, y: data.y, z: data.z, ry: data.ry, a: 0 });
        if (!st) {
            logLimited('spawn_num:' + p.id, 'spawn машини: некоректні координати, id=' + p.id + ' нік=' + logNick(p.nick));
            return carAck(ack, { success: false, code: 'bad_payload' });
        }
        const t = now();
        if (t - p.lastCarSpawnAt < CAR_SPAWN_COOLDOWN_MS) {
            logLimited('spawn_rate:' + p.id, 'забагато spawn машин від id=' + p.id + ' нік=' + logNick(p.nick));
            return carAck(ack, { success: false, code: 'rate' });
        }
        const dx = st.x - p.x, dz = st.z - p.z;
        if (Math.sqrt(dx * dx + dz * dz) > CAR_SPAWN_MAX_DIST) {
            logLimited('spawn_far:' + p.id, 'spawn машини надто далеко від гравця id=' + p.id + ' нік=' + logNick(p.nick));
            return carAck(ack, { success: false, code: 'too_far' });
        }
        p.lastCarSpawnAt = t;
        const old = p.car;
        const cid = (room.nextCid = (room.nextCid || 0) + 1);
        p.car = { cid, type: data.type, x: st.x, y: st.y, z: st.z, ry: st.ry, s: 0, st: 0, dirty: true };
        p.lastStateAt = t;
        p.lastMoveAt = p.lastMoveAt || t;
        if (old) {
            log.log('[blox-game] зміна машини: гра=' + m.game + ' id=' + p.id + ' нік=' + logNick(p.nick) + ' ' + old.type + ' -> ' + data.type + ' cid=' + cid + ' (стару прибрано)');
        } else {
            log.log('[blox-game] spawn машини: гра=' + m.game + ' id=' + p.id + ' нік=' + logNick(p.nick) + ' тип=' + data.type + ' cid=' + cid);
        }
        broadcastCars(m.game, room);
        carAck(ack, { success: true, cid, type: data.type });
    }

    function handleCarRemove(socket, ack) {
        const m = socket.bloxGame;
        const room = m && rooms.get(m.game);
        const p = room && room.players.get(m.id);
        if (p && p.socketId === socket.id) {
            if (dropCar(m.game, p, 'гравець сам прибрав')) {
                p.dirty = true;
                broadcastCars(m.game, room);
            }
        } else {
            logLimited('remove_nogame:' + socket.id, 'blox_car_remove від сокета без входу в гру (' + socket.id + ')');
        }
        carAck(ack, { success: true });
    }

    // Respawn: персонаж повертається на майданчик (вихід із машини); сама машина лишається там, де стоїть
    function handleRespawn(socket, ack) {
        const m = socket.bloxGame;
        const room = m && rooms.get(m.game);
        const p = room && room.players.get(m.id);
        if (!p || p.socketId !== socket.id) {
            logLimited('respawn_nogame:' + socket.id, 'respawn від сокета без входу в гру (' + socket.id + ')');
            return carAck(ack, { success: false, code: 'not_in_game' });
        }
        const t = now();
        if (t - (p.lastRespawnAt || -1e9) < RESPAWN_COOLDOWN_MS) {
            logLimited('respawn_rate:' + p.id, 'забагато respawn від id=' + p.id + ' нік=' + logNick(p.nick));
            return carAck(ack, { success: false, code: 'rate' });
        }
        p.lastRespawnAt = t;
        const slot = (p.id - 1) % 12;
        const ang = ((slot - 1) / 11) * Math.PI * 2;
        const sp = {
            x: slot === 0 ? SPAWN.x : round2(SPAWN.x + Math.cos(ang) * 6),
            y: SPAWN.y,
            z: slot === 0 ? SPAWN.z : round2(SPAWN.z + Math.sin(ang) * 6),
            ry: 1.57
        };
        const wasDriving = p.d === 1;
        p.x = sp.x; p.y = sp.y; p.z = sp.z; p.ry = sp.ry; p.a = 0; p.d = 0;
        p.dirty = true;
        p.allowJump = true;
        p.lastStateAt = t;
        p.lastMoveAt = t;
        log.log('[blox-game] respawn: гра=' + m.game + ' id=' + p.id + ' нік=' + logNick(p.nick) + (wasDriving ? ' (вийшов із машини)' : '') + ' -> (' + sp.x + ', ' + sp.z + ')');
        carAck(ack, { success: true, x: sp.x, y: sp.y, z: sp.z, ry: sp.ry });
    }

    // Скарга на гравця (меню «Report»): лише запис у журнал, не частіше разу на 10 секунд від одного гравця
    function handleReport(socket, data, ack) {
        const m = socket.bloxGame;
        const room = m && rooms.get(m.game);
        const p = room && room.players.get(m.id);
        if (!p || p.socketId !== socket.id) return carAck(ack, { success: false, code: 'not_in_game' });
        const target = data && Number.isInteger(data.target) ? room.players.get(data.target) : null;
        if (!target || target.id === p.id) return carAck(ack, { success: false, code: 'bad_target' });
        const t = now();
        if (t - (p.lastReportAt || -1e9) < 10000) return carAck(ack, { success: false, code: 'rate' });
        p.lastReportAt = t;
        log.warn('[blox-game] скарга: гра=' + m.game + ' від id=' + p.id + ' нік=' + logNick(p.nick) + ' на id=' + target.id + ' нік=' + logNick(target.nick));
        carAck(ack, { success: true });
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
        room.reserved.set(p.email, { id: p.id, x: p.x, y: p.y, z: p.z, ry: p.ry, at: now(), car: p.car ? { cid: p.car.cid, type: p.car.type, x: p.car.x, y: p.car.y, z: p.car.z, ry: p.car.ry, s: 0, st: 0 } : null });
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
        socket.on('blox_car_spawn', (data, ack) => {
            try { handleCarSpawn(socket, data, ack); } catch (e) {
                log.error('[blox-game] blox_car_spawn: ' + (e && e.stack || e));
                carAck(typeof data === 'function' ? data : ack, { success: false, code: 'error' });
            }
        });
        socket.on('blox_car_remove', (data, ack) => {
            const cb = typeof data === 'function' ? data : ack;
            try { handleCarRemove(socket, cb); } catch (e) { log.error('[blox-game] blox_car_remove: ' + (e && e.message)); }
        });
        socket.on('error', (err) => {
            log.warn('[blox-game] помилка Socket.IO сокета ' + socket.id + ': ' + (err && err.message || err));
        });
        socket.on('blox_game_state', (data) => {
            try { handleState(socket, data); } catch (e) { log.error('[blox-game] blox_game_state: ' + (e && e.message)); }
        });
        socket.on('blox_game_respawn', (data, ack) => {
            const cb = typeof data === 'function' ? data : ack;
            try { handleRespawn(socket, cb); } catch (e) {
                log.error('[blox-game] blox_game_respawn: ' + (e && e.stack || e));
                carAck(cb, { success: false, code: 'error' });
            }
        });
        socket.on('blox_game_report', (data, ack) => {
            const cb = typeof data === 'function' ? data : ack;
            try { handleReport(socket, typeof data === 'function' ? null : data, cb); } catch (e) {
                log.error('[blox-game] blox_game_report: ' + (e && e.stack || e));
                carAck(cb, { success: false, code: 'error' });
            }
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

    // Збої самого з'єднання (не вдалося підняти сокет): видно в Render Logs
    if (io.engine && typeof io.engine.on === 'function') {
        io.engine.on('connection_error', (err) => {
            logLimited('engine_error', 'збій підключення Socket.IO: код=' + (err && err.code) + ' ' + (err && err.message));
        });
    }

    log.log('[blox-game] ігровий сервіс запущено: ігор ' + games.size + ' (' + Array.from(games).join(', ') + '), оновлення ' + Math.round(1000 / tickMs) + ' разів на секунду, режим одного інстанса (стан у пам\'яті)');

    function stats(game) {
        const r = rooms.get(game);
        let cars = 0;
        if (r) for (const p of r.players.values()) if (p.car) cars++;
        return { count: r ? r.players.size : 0, reserved: r ? r.reserved.size : 0, cars, timer: !!(r && r.timer) };
    }

    function shutdown() {
        for (const r of rooms.values()) {
            if (r.timer) clearInterval(r.timer);
            r.timer = null;
        }
    }

    return { attach, stats, shutdown, rooms };
}

module.exports = { createBloxGame, sanitizeState, sanitizeCar, kmhOf, STUD_TO_KMH, CAR_TYPES, GAMES, TICK_MS, BOUND_XZ, BOUND_Y_MIN, BOUND_Y_MAX, RATE_BURST, RATE_PER_SEC };
