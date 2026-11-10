// Перевірки ігрової кімнати KishkaBlox (blox_game_server.js): node --test   (або npm test)
// Не потребують ні бази, ні інтернету, ні справжнього Socket.IO: використовується проста імітація io/сокета,
// яка поводиться так само, як Socket.IO для методів, що викликає сервер (on, join, leave, to(room).emit, id).
// Справжній транспорт (WebSocket/polling) цими тестами НЕ перевіряється.
const test = require('node:test');
const assert = require('node:assert');
const { createBloxGame, sanitizeState, RATE_BURST } = require('../blox_game_server.js');

const quiet = { log() {}, warn() {}, error() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class FakeSocket {
    constructor(io, id, email) {
        this.io = io;
        this.id = id;
        this.userEmail = email || null;
        this.handlers = {};
        this.rooms = new Set([id]);
        this.received = [];
        this.disconnected = false;
    }
    on(ev, fn) { this.handlers[ev] = fn; }
    join(room) { this.rooms.add(room); }
    leave(room) { this.rooms.delete(room); }
    // Клієнт надсилає подію серверу
    send(ev, data, ack) {
        const h = this.handlers[ev];
        if (h) h(data, ack);
    }
    call(ev, data) {
        return new Promise((resolve) => this.send(ev, data, resolve));
    }
    disconnect(reason) {
        this.disconnected = true;
        this.io.sockets.sockets.delete(this.id);
        const h = this.handlers.disconnect;
        if (h) h(reason || 'transport close');
    }
    events(name) { return this.received.filter((e) => e.ev === name).map((e) => e.payload); }
    last(name) { const a = this.events(name); return a[a.length - 1]; }
}

class FakeIO {
    constructor() {
        this.sockets = { sockets: new Map() };
        this.connectionHandlers = [];
        this.seq = 0;
    }
    on(ev, fn) { if (ev === 'connection') this.connectionHandlers.push(fn); }
    to(room) {
        const self = this;
        return {
            emit(ev, payload) {
                for (const s of self.sockets.sockets.values()) {
                    if (s.rooms.has(room)) s.received.push({ ev, payload: JSON.parse(JSON.stringify(payload)) });
                }
            }
        };
    }
    connect(email, noIdentify) {
        const s = new FakeSocket(this, 'sock' + (++this.seq), noIdentify ? null : email);
        this.sockets.sockets.set(s.id, s);
        this.connectionHandlers.forEach((h) => h(s));
        return s;
    }
}

// Усі акаунти, яких немає в списку відмов, вважаються «увійшли в KishkaBlox» і мають нік з пошти до '@'
function setup(extra) {
    const io = new FakeIO();
    const clock = { t: 1000000 };
    const logged = (extra && extra.logged) || null;
    const game = createBloxGame(Object.assign({
        io,
        logger: quiet,
        now: () => clock.t,
        tickMs: 10,
        graceMs: 200,
        getNick: async (email) => {
            if (logged && !logged.has(email)) return null;
            return email.split('@')[0];
        }
    }, (extra && extra.opts) || {}));
    // Підключення: кожен новий сокет отримує обробники гри
    io.on('connection', (s) => game.attach(s));
    return { io, game, clock };
}

const GAME = 'realistic_cars';
const join = (client, email, extra) => client.call('blox_game_join', Object.assign({ email, game: GAME }, extra || {}));

test('два гравці: id, нік із сервера, повний список і кількість', async () => {
    const { io, game } = setup();
    const a = io.connect('anna@x.com');
    const b = io.connect('bob@x.com');
    const ra = await join(a, 'anna@x.com');
    assert.strictEqual(ra.success, true);
    assert.strictEqual(ra.nick, 'anna');
    assert.strictEqual(ra.count, 1);
    assert.deepStrictEqual(ra.players, []);
    const rb = await join(b, 'bob@x.com');
    assert.strictEqual(rb.success, true);
    assert.notStrictEqual(rb.id, ra.id);
    assert.strictEqual(rb.count, 2);
    assert.strictEqual(rb.players.length, 1);
    assert.strictEqual(rb.players[0].id, ra.id);
    assert.strictEqual(rb.players[0].nick, 'anna');
    for (const c of [a, b]) {
        const roster = c.last('blox_game_roster');
        assert.strictEqual(roster.count, 2);
        assert.strictEqual(roster.players.length, roster.count);
        assert.deepStrictEqual(roster.players.map((p) => p.nick).sort(), ['anna', 'bob']);
    }
    game.shutdown();
});

test('нік не береться з пакета клієнта', async () => {
    const { io, game } = setup();
    const a = io.connect('anna@x.com');
    const r = await join(a, 'anna@x.com', { nick: 'Hacker', name: 'Hacker' });
    assert.strictEqual(r.nick, 'anna');
    game.shutdown();
});

test('синхронізація позиції, повороту й пози: інший клієнт отримує tick', async () => {
    const { io, game } = setup();
    const a = io.connect('anna@x.com');
    const b = io.connect('bob@x.com');
    const ra = await join(a, 'anna@x.com');
    await join(b, 'bob@x.com');
    a.send('blox_game_state', { x: 10.123, y: 4, z: -20.5, ry: 1.5, a: 1 });
    await sleep(50);
    const ticks = b.events('blox_game_tick').flat();
    const mine = ticks.filter((t) => t[0] === ra.id);
    const last = mine[mine.length - 1];
    assert.deepStrictEqual(last, [ra.id, 10.12, 4, -20.5, 1.5, 1]);
    // Поза «у повітрі» теж передається
    a.send('blox_game_state', { x: 10.123, y: 9, z: -20.5, ry: 1.5, a: 2 });
    await sleep(50);
    const t2 = b.events('blox_game_tick').flat().filter((t) => t[0] === ra.id);
    assert.strictEqual(t2[t2.length - 1][5], 2);
    assert.strictEqual(t2[t2.length - 1][2], 9);
    game.shutdown();
});

test('стан, що не змінився, не розсилається повторно', async () => {
    const { io, game } = setup();
    const a = io.connect('anna@x.com');
    const b = io.connect('bob@x.com');
    const ra = await join(a, 'anna@x.com');
    await join(b, 'bob@x.com');
    a.send('blox_game_state', { x: 1, y: 4, z: 1, ry: 0, a: 0 });
    await sleep(40);
    const before = b.events('blox_game_tick').flat().filter((t) => t[0] === ra.id).length;
    a.send('blox_game_state', { x: 1, y: 4, z: 1, ry: 0, a: 0 });
    await sleep(40);
    const after = b.events('blox_game_tick').flat().filter((t) => t[0] === ra.id).length;
    assert.strictEqual(after, before);
    game.shutdown();
});

test('кімнати різних ігор не змішуються', async () => {
    const { io, game } = setup({ opts: { games: new Set(['g1', 'g2']) } });
    const a = io.connect('anna@x.com');
    const b = io.connect('bob@x.com');
    const c = io.connect('carl@x.com');
    const ra = await a.call('blox_game_join', { email: 'anna@x.com', game: 'g1' });
    const rb = await b.call('blox_game_join', { email: 'bob@x.com', game: 'g2' });
    await c.call('blox_game_join', { email: 'carl@x.com', game: 'g1' });
    assert.strictEqual(rb.count, 1);
    assert.deepStrictEqual(rb.players, []);
    a.send('blox_game_state', { x: 5, y: 4, z: 5, ry: 0, a: 1 });
    await sleep(50);
    assert.strictEqual(b.events('blox_game_tick').flat().filter((t) => t[1] === 5).length, 0, 'гравець іншої гри не отримує чужих станів');
    assert.ok(c.events('blox_game_tick').flat().some((t) => t[0] === ra.id));
    assert.strictEqual(b.last('blox_game_roster').count, 1);
    assert.strictEqual(c.last('blox_game_roster').count, 2);
    game.shutdown();
});

test('вихід: гравець зникає зі списку, іншим приходить новий список', async () => {
    const { io, game } = setup();
    const a = io.connect('anna@x.com');
    const b = io.connect('bob@x.com');
    await join(a, 'anna@x.com');
    await join(b, 'bob@x.com');
    const res = await b.call('blox_game_leave', {});
    assert.strictEqual(res.success, true);
    assert.strictEqual(a.last('blox_game_roster').count, 1);
    assert.deepStrictEqual(a.last('blox_game_roster').players.map((p) => p.nick), ['anna']);
    assert.strictEqual(game.stats(GAME).count, 1);
    // Клієнт з Bloxgame.kt надсилає leave без ack і без даних
    b.send('blox_game_leave', undefined, undefined);
    game.shutdown();
});

test('відключення прибирає гравця й повідомляє інших', async () => {
    const { io, game } = setup();
    const a = io.connect('anna@x.com');
    const b = io.connect('bob@x.com');
    await join(a, 'anna@x.com');
    await join(b, 'bob@x.com');
    b.disconnect();
    assert.strictEqual(a.last('blox_game_roster').count, 1);
    assert.strictEqual(game.stats(GAME).count, 1);
    game.shutdown();
});

test('повторне підключення: той самий id і остання позиція, якщо не минув час очікування', async () => {
    const { io, game, clock } = setup();
    const a = io.connect('anna@x.com');
    const ra = await join(a, 'anna@x.com');
    a.send('blox_game_state', { x: 40, y: 4, z: 50, ry: 2, a: 0 });
    a.disconnect();
    clock.t += 100; // менше за graceMs (200)
    const a2 = io.connect('anna@x.com');
    const r2 = await join(a2, 'anna@x.com');
    assert.strictEqual(r2.success, true);
    assert.strictEqual(r2.id, ra.id);
    assert.strictEqual(r2.x, 40);
    assert.strictEqual(r2.z, 50);
    assert.strictEqual(r2.count, 1);
    game.shutdown();
});

test('повторне підключення після закінчення часу очікування дає нового гравця; клієнтська позиція приймається', async () => {
    const { io, game, clock } = setup();
    const a = io.connect('anna@x.com');
    const ra = await join(a, 'anna@x.com');
    a.disconnect();
    clock.t += 5000;
    const a2 = io.connect('anna@x.com');
    const r2 = await join(a2, 'anna@x.com', { x: 12, y: 4, z: -8, ry: 0.5 });
    assert.notStrictEqual(r2.id, ra.id);
    assert.strictEqual(r2.x, 12);
    assert.strictEqual(r2.z, -8);
    game.shutdown();
});

test('дубльований вхід: старий пристрій відключається, дубліката немає', async () => {
    const { io, game } = setup();
    const phone = io.connect('anna@x.com');
    const tablet = io.connect('anna@x.com');
    const r1 = await join(phone, 'anna@x.com');
    const r2 = await join(tablet, 'anna@x.com');
    assert.strictEqual(r2.success, true);
    assert.strictEqual(r2.count, 1);
    assert.strictEqual(r2.id, r1.id);
    assert.deepStrictEqual(r2.players, []);
    assert.deepStrictEqual(phone.last('blox_game_kicked'), { reason: 'other_device' });
    assert.strictEqual(tablet.events('blox_game_kicked').length, 0);
    assert.strictEqual(game.stats(GAME).count, 1);
    // Закриття старого сокета не видаляє нового гравця
    phone.disconnect();
    assert.strictEqual(game.stats(GAME).count, 1);
    // Старий пристрій більше не впливає на гру
    phone.send('blox_game_state', { x: 99, y: 4, z: 99, ry: 0, a: 1 });
    await sleep(30);
    assert.strictEqual(tablet.events('blox_game_tick').flat().filter((t) => t[1] === 99).length, 0);
    game.shutdown();
});

test('некоректні координати й пози відкидаються', async () => {
    const { io, game } = setup();
    const a = io.connect('anna@x.com');
    const b = io.connect('bob@x.com');
    const ra = await join(a, 'anna@x.com');
    await join(b, 'bob@x.com');
    await sleep(30);
    const base = b.events('blox_game_tick').flat().filter((t) => t[0] === ra.id).length;
    const bad = [
        { x: NaN, y: 4, z: 0, ry: 0, a: 0 },
        { x: Infinity, y: 4, z: 0, ry: 0, a: 0 },
        { x: -Infinity, y: 4, z: 0, ry: 0, a: 0 },
        { x: '5', y: 4, z: 0, ry: 0, a: 0 },
        { x: 1e9, y: 4, z: 0, ry: 0, a: 0 },
        { x: 0, y: 9999, z: 0, ry: 0, a: 0 },
        { x: 0, y: -500, z: 0, ry: 0, a: 0 },
        { x: 0, y: 4, z: 301, ry: 0, a: 0 },
        { x: 0, y: 4, z: 0, ry: 5000, a: 0 },
        { x: 0, y: 4, z: 0, ry: 0, a: 7 },
        { x: 0, y: 4, z: 0, ry: 0, a: 1.5 },
        { x: 0, y: 4, z: 0, ry: 0, a: 'run' },
        null, 'x', 42, [], {}
    ];
    for (const d of bad) {
        assert.strictEqual(sanitizeState(d), null, JSON.stringify(d));
        a.send('blox_game_state', d);
    }
    await sleep(50);
    const after = b.events('blox_game_tick').flat().filter((t) => t[0] === ra.id).length;
    assert.strictEqual(after, base, 'жоден некоректний стан не розіслано');
    game.shutdown();
});

test('кут нормалізується, а відсутня поза означає «стоїть»', () => {
    const s = sanitizeState({ x: 0, y: 4, z: 0, ry: Math.PI * 3 });
    assert.ok(Math.abs(s.ry) <= Math.PI + 1e-9);
    assert.strictEqual(s.a, 0);
});

test('обмеження частоти: надлишок пакетів відкидається, потім ліміт відновлюється', async () => {
    const { io, game, clock } = setup();
    const a = io.connect('anna@x.com');
    const b = io.connect('bob@x.com');
    const ra = await join(a, 'anna@x.com');
    await join(b, 'bob@x.com');
    // Година не рухається: пропустити можна лише RATE_BURST пакетів
    for (let i = 1; i <= 100; i++) a.send('blox_game_state', { x: i, y: 4, z: 0, ry: 0, a: 1 });
    await sleep(40);
    const xs = b.events('blox_game_tick').flat().filter((t) => t[0] === ra.id).map((t) => t[1]);
    assert.strictEqual(xs[xs.length - 1], RATE_BURST, 'прийнято рівно ' + RATE_BURST + ' пакетів');
    // Після паузи знову можна
    clock.t += 2000;
    a.send('blox_game_state', { x: 200, y: 4, z: 0, ry: 0, a: 1 });
    await sleep(40);
    const xs2 = b.events('blox_game_tick').flat().filter((t) => t[0] === ra.id).map((t) => t[1]);
    assert.strictEqual(xs2[xs2.length - 1], 200);
    game.shutdown();
});

test('перевірка особи: чужий email, сокет без імені, не ввійшов у KishkaBlox, невідома гра, порожній пакет', async () => {
    const { io, game } = setup({ logged: new Set(['anna@x.com', 'bob@x.com']) });
    const eve = io.connect('eve@x.com');
    // Сокет назвався eve, але просить зайти як anna
    const spoof = await join(eve, 'anna@x.com');
    assert.deepStrictEqual(spoof, { success: false, code: 'not_identified' });
    // Сокет, який ще не назвався
    const anon = io.connect('anna@x.com', true);
    assert.strictEqual((await join(anon, 'anna@x.com')).code, 'not_identified');
    // Є акаунт Kishka, але не ввійшов у KishkaBlox
    assert.strictEqual((await join(eve, 'eve@x.com')).code, 'not_logged_in');
    const a = io.connect('anna@x.com');
    assert.strictEqual((await a.call('blox_game_join', { email: 'anna@x.com', game: 'nope' })).code, 'unknown_game');
    assert.strictEqual((await a.call('blox_game_join', { email: 'anna@x.com' })).code, 'unknown_game');
    assert.strictEqual((await a.call('blox_game_join', null)).code, 'bad_payload');
    assert.strictEqual((await a.call('blox_game_join', { game: GAME })).code, 'bad_payload');
    assert.strictEqual(game.stats(GAME).count, 0, 'жодна відмова не створила гравця');
    game.shutdown();
});

test('збій перевірки акаунта (база недоступна) повертає code=error, а не нескінченне очікування', async () => {
    const { io, game } = setup({ opts: { getNick: async () => { throw new Error('db down'); } } });
    const a = io.connect('anna@x.com');
    const r = await join(a, 'anna@x.com');
    assert.deepStrictEqual(r, { success: false, code: 'error' });
    game.shutdown();
});

test('ліміт гравців у грі', async () => {
    const { io, game } = setup({ opts: { maxPlayers: 2 } });
    const a = io.connect('a@x.com');
    const b = io.connect('b@x.com');
    const c = io.connect('c@x.com');
    assert.strictEqual((await join(a, 'a@x.com')).success, true);
    assert.strictEqual((await join(b, 'b@x.com')).success, true);
    assert.strictEqual((await join(c, 'c@x.com')).code, 'game_full');
    game.shutdown();
});

test('стан від сокета, який не заходив у гру, ігнорується без помилок', async () => {
    const { io, game } = setup();
    const a = io.connect('anna@x.com');
    a.send('blox_game_state', { x: 1, y: 4, z: 1, ry: 0, a: 0 });
    a.send('blox_game_leave', {});
    a.disconnect();
    assert.strictEqual(game.stats(GAME).count, 0);
    game.shutdown();
});

test('без станів довше за тайм-аут гравець виходить із гри (клієнту приходить kicked)', async () => {
    const { io, game, clock } = setup({ opts: { staleMs: 1000 } });
    const a = io.connect('anna@x.com');
    const b = io.connect('bob@x.com');
    await join(a, 'anna@x.com');
    await join(b, 'bob@x.com');
    clock.t += 1500;
    b.send('blox_game_state', { x: 3, y: 4, z: 3, ry: 0, a: 0 }); // bob живий
    await sleep(40);
    assert.deepStrictEqual(a.last('blox_game_kicked'), { reason: 'timeout' });
    assert.strictEqual(game.stats(GAME).count, 1);
    game.shutdown();
});

test('таймер розсилки зупиняється, коли кімната порожня', async () => {
    const { io, game } = setup();
    const a = io.connect('anna@x.com');
    await join(a, 'anna@x.com');
    assert.strictEqual(game.stats(GAME).timer, true);
    await a.call('blox_game_leave', {});
    assert.strictEqual(game.stats(GAME).timer, false);
    game.shutdown();
});

// ---------- Підключення до kishkablox.js: нік береться з акаунта KishkaBlox у базі ----------
test('kishkablox.js підключає гру: ввійшов — зайшов, вийшов із KishkaBlox — відмова', async () => {
    const initKishkaBlox = require('../kishkablox.js');
    const io = new FakeIO();
    const accounts = { 'anna@x.com': { nick: 'AnnaBlox', logged_in: 1 }, 'eve@x.com': { nick: 'Eve', logged_in: 0 } };
    const dbRun = async () => ({});
    const dbAll = async (sql, params) => {
        if (/FROM blox_accounts WHERE owner_email = \?/.test(sql)) {
            const acc = accounts[params[0]];
            return acc ? [{ nick_lower: acc.nick.toLowerCase(), nick: acc.nick, pass_salt: 's', pass_hash: 'h', logged_in: acc.logged_in, owner_email: params[0] }] : [];
        }
        return [];
    };
    const origErr = console.error;
    const origLog = console.log;
    const origWarn = console.warn;
    console.error = () => {}; console.log = () => {}; console.warn = () => {};
    try {
        initKishkaBlox({ io, app: { use() {} }, db: null, dbRun, dbAll });
    } finally {
        console.error = origErr; console.log = origLog; console.warn = origWarn;
    }
    const anna = io.connect('anna@x.com');
    const eve = io.connect('eve@x.com');
    const ok = await anna.call('blox_game_join', { email: 'anna@x.com', game: GAME });
    assert.strictEqual(ok.success, true);
    assert.strictEqual(ok.nick, 'AnnaBlox');
    const no = await eve.call('blox_game_join', { email: 'eve@x.com', game: GAME });
    assert.deepStrictEqual(no, { success: false, code: 'not_logged_in' });
    await anna.call('blox_game_leave', {});
});
