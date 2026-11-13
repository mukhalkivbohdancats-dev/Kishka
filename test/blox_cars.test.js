// Перевірки машин, синхронізації й журналів ігрового сервера KishkaBlox: node --test
// Використовують імітацію Socket.IO (test/helpers/fakeio.js): справжній WebSocket цими тестами НЕ перевіряється.
const test = require('node:test');
const assert = require('node:assert');
const { sanitizeState, sanitizeCar, CAR_TYPES } = require('../blox_game_server.js');
const { sleep, setup, join } = require('./helpers/fakeio.js');

// Логер, що запам'ятовує рядки, щоб перевіряти, що саме потрапить у Render Logs
function recorder() {
    const lines = [];
    const push = (level) => (text) => lines.push(level + ' ' + text);
    return { lines, logger: { log: push('log'), warn: push('warn'), error: push('error') } };
}
const has = (rec, part) => rec.lines.some((l) => l.includes(part));

const car = (over) => Object.assign({ type: 'sedan', x: 5, y: 1, z: 5, ry: 0.5 }, over || {});

async function twoPlayers(extra) {
    const env = setup(extra);
    const a = env.io.connect('anna@x.com');
    const b = env.io.connect('bob@x.com');
    const ra = await join(a, 'anna@x.com');
    const rb = await join(b, 'bob@x.com');
    return Object.assign(env, { a, b, ra, rb });
}

test('перший гравець з\'являється в центрі майданчика', async () => {
    const { io, game } = setup();
    const a = io.connect('anna@x.com');
    const r = await join(a, 'anna@x.com');
    assert.strictEqual(r.x, 0);
    assert.strictEqual(r.z, 0);
    const b = io.connect('bob@x.com');
    const rb = await join(b, 'bob@x.com');
    assert.ok(Math.hypot(rb.x - r.x, rb.z - r.z) > 3, 'другий гравець не стоїть у першому');
    assert.ok(Math.hypot(rb.x, rb.z) < 24, 'і лишається на майданчику');
    game.shutdown();
});

test('три дозволені типи машин створюються, інші — відхиляються', async () => {
    assert.deepStrictEqual(CAR_TYPES, ['sedan', 'van', 'truck']);
    const { a, ra, clock, game } = await twoPlayers();
    for (const t of CAR_TYPES) {
        clock.t += 2000;
        const r = await a.call('blox_car_spawn', car({ type: t }));
        assert.strictEqual(r.success, true, t);
        assert.strictEqual(r.type, t);
        assert.ok(r.cid > 0);
    }
    for (const bad of ['tank', '', 'SEDAN', null, 7, { a: 1 }, '__proto__']) {
        clock.t += 2000;
        const r = await a.call('blox_car_spawn', car({ type: bad }));
        assert.deepStrictEqual(r, { success: false, code: 'bad_type' }, String(bad));
    }
    assert.strictEqual(game.stats('realistic_cars').cars, 1, 'машина в гравця одна');
    assert.ok(ra.id > 0);
    game.shutdown();
});

test('spawn: інший гравець бачить машину зі списку, а новий гравець отримує її при вході', async () => {
    const { io, a, b, ra, game } = await twoPlayers();
    const r = await a.call('blox_car_spawn', car({ type: 'van', x: 7, z: 3 }));
    assert.strictEqual(r.success, true);
    for (const c of [a, b]) {
        const list = c.last('blox_game_cars');
        assert.strictEqual(list.count, 1);
        assert.deepStrictEqual(list.cars[0], { id: ra.id, cid: r.cid, type: 'van', x: 7, y: 1, z: 3, ry: 0.5, kmh: 0 });
    }
    const c = io.connect('carl@x.com');
    const rc = await join(c, 'carl@x.com');
    assert.strictEqual(rc.cars.length, 1);
    assert.strictEqual(rc.cars[0].type, 'van');
    assert.strictEqual(rc.cars[0].id, ra.id);
    game.shutdown();
});

test('повторний spawn прибирає стару машину: дублікатів немає, тип змінюється', async () => {
    const rec = recorder();
    const { a, b, clock, game } = await twoPlayers({ opts: { logger: rec.logger } });
    const r1 = await a.call('blox_car_spawn', car({ type: 'sedan' }));
    clock.t += 2000;
    const r2 = await a.call('blox_car_spawn', car({ type: 'truck' }));
    assert.strictEqual(r2.success, true);
    assert.notStrictEqual(r2.cid, r1.cid);
    const list = b.last('blox_game_cars');
    assert.strictEqual(list.cars.length, 1);
    assert.strictEqual(list.cars[0].type, 'truck');
    assert.strictEqual(list.cars[0].cid, r2.cid);
    assert.ok(has(rec, 'зміна машини'), 'у логах видно зміну машини');
    game.shutdown();
});

test('spawn: частота, відстань, координати, гра без входу', async () => {
    const rec = recorder();
    const { io, a, game } = await twoPlayers({ opts: { logger: rec.logger } });
    assert.strictEqual((await a.call('blox_car_spawn', car())).success, true);
    // одразу ще раз — забагато
    assert.deepStrictEqual(await a.call('blox_car_spawn', car()), { success: false, code: 'rate' });
    game.shutdown();

    const env = await twoPlayers({ opts: { logger: rec.logger } });
    env.clock.t += 5000;
    assert.deepStrictEqual(await env.a.call('blox_car_spawn', car({ x: 250, z: 250 })), { success: false, code: 'too_far' });
    assert.deepStrictEqual(await env.a.call('blox_car_spawn', car({ x: NaN })), { success: false, code: 'bad_payload' });
    assert.deepStrictEqual(await env.a.call('blox_car_spawn', car({ y: 'високо' })), { success: false, code: 'bad_payload' });
    assert.deepStrictEqual(await env.a.call('blox_car_spawn', null), { success: false, code: 'bad_payload' });
    assert.deepStrictEqual(await env.a.call('blox_car_spawn', 'sedan'), { success: false, code: 'bad_payload' });
    const stranger = env.io.connect('zed@x.com');
    assert.deepStrictEqual(await stranger.call('blox_car_spawn', car()), { success: false, code: 'not_in_game' });
    assert.ok(has(rec, 'недозволений тип') || has(rec, 'некоректні координати'), 'помилки валідації потрапляють у лог');
    assert.ok(io);
    env.game.shutdown();
});

test('стан гравця й машини: інший клієнт отримує d і рух машини', async () => {
    const { a, b, ra, game } = await twoPlayers();
    const r = await a.call('blox_car_spawn', car({ type: 'sedan', x: 5, z: 5 }));
    a.send('blox_game_state', { x: 6, y: 1, z: 7, ry: 0.5, a: 0, d: 1, c: { t: 'sedan', x: 6, y: 1, z: 7, ry: 0.5, s: 31.5, st: -0.2 } });
    await sleep(40);
    const tick = b.events('blox_game_tick').flat().filter((t) => t[0] === ra.id).pop();
    assert.deepStrictEqual(tick, [ra.id, 6, 1, 7, 0.5, 0, 1]);
    const ct = b.events('blox_car_tick').flat().filter((t) => t[0] === ra.id).pop();
    assert.deepStrictEqual(ct, [ra.id, r.cid, 6, 1, 7, 0.5, 31.5, -0.2, 32]);
    // вийшов з машини: d=0, машина стоїть
    a.send('blox_game_state', { x: 9, y: 1, z: 7, ry: 0.5, a: 1, d: 0 });
    await sleep(40);
    const t2 = b.events('blox_game_tick').flat().filter((t) => t[0] === ra.id).pop();
    assert.strictEqual(t2[6], 0);
    game.shutdown();
});

test('не можна «сісти» в неіснуючу машину, підмінити тип чи надіслати нісенітницю', async () => {
    const rec = recorder();
    const { a, b, ra, game } = await twoPlayers({ opts: { logger: rec.logger } });
    // машини ще немає: d=1 і c ігноруються
    a.send('blox_game_state', { x: 1, y: 1, z: 1, ry: 0, a: 0, d: 1, c: { t: 'truck', x: 1, y: 1, z: 1, ry: 0, s: 0, st: 0 } });
    await sleep(40);
    assert.strictEqual(b.events('blox_game_tick').flat().filter((t) => t[0] === ra.id).pop()[6], 0);
    assert.strictEqual(b.events('blox_car_tick').flat().length, 0);
    assert.strictEqual(game.stats('realistic_cars').cars, 0, 'машину стан не створює');
    // є sedan, а клієнт шле тип truck
    await a.call('blox_car_spawn', car({ type: 'sedan' }));
    a.send('blox_game_state', { x: 2, y: 1, z: 2, ry: 0, a: 0, d: 1, c: { t: 'truck', x: 2, y: 1, z: 2, ry: 0, s: 1, st: 0 } });
    await sleep(40);
    const cars = b.last('blox_game_cars').cars;
    assert.strictEqual(cars[0].type, 'sedan');
    assert.ok(has(rec, 'не збігається зі створеною') || has(rec, 'без створення'));
    // швидкість поза межами — весь пакет відкинуто
    const before = b.events('blox_game_tick').flat().length;
    a.send('blox_game_state', { x: 3, y: 1, z: 3, ry: 0, a: 0, d: 1, c: { t: 'sedan', x: 3, y: 1, z: 3, ry: 0, s: 9999, st: 0 } });
    await sleep(40);
    assert.strictEqual(b.events('blox_game_tick').flat().length, before);
    assert.ok(has(rec, 'некоректний стан'));
    game.shutdown();
});

test('перевірка чисел: sanitizeState / sanitizeCar', () => {
    const ok = { x: 1, y: 2, z: 3, ry: 4, a: 1, d: 0 };
    assert.ok(sanitizeState(ok));
    for (const bad of [
        { ...ok, x: Infinity }, { ...ok, y: NaN }, { ...ok, z: '3' }, { ...ok, x: 701 }, { ...ok, y: 121 }, { ...ok, a: 3 }, { ...ok, d: 2 },
        { ...ok, c: { t: 'sedan', x: 1, y: 1, z: 1, ry: 0, s: 1 } },
        { ...ok, c: { t: 'boat', x: 1, y: 1, z: 1, ry: 0, s: 1, st: 0 } },
        { ...ok, c: { t: 'sedan', x: 1, y: 1, z: 1, ry: 0, s: 201, st: 0 } },
        { ...ok, c: { t: 'sedan', x: 1, y: 1, z: 1, ry: 0, s: 1, st: 5 } }
    ]) assert.strictEqual(sanitizeState(bad), null, JSON.stringify(bad));
    assert.strictEqual(sanitizeCar({ t: 'van', x: 0, y: 0, z: 0, ry: 0, s: -200, st: 1.2 }).t, 'van');
});

test('вихід з гри прибирає гравця й машину і оновлює список', async () => {
    const rec = recorder();
    const { a, b, ra, game } = await twoPlayers({ opts: { logger: rec.logger } });
    await a.call('blox_car_spawn', car());
    assert.strictEqual(game.stats('realistic_cars').count, 2);
    const r = await a.call('blox_game_leave', {});
    assert.deepStrictEqual(r, { success: true });
    assert.strictEqual(b.last('blox_game_roster').count, 1);
    assert.strictEqual(b.last('blox_game_cars').cars.length, 0);
    assert.strictEqual(game.stats('realistic_cars').cars, 0);
    assert.ok(has(rec, 'машину прибрано'), 'очищення машини видно в логах');
    assert.ok(has(rec, 'гравців 2 -> 1'));
    assert.ok(ra.id > 0);
    game.shutdown();
});

test('відключення й повторне підключення: той самий id і та сама машина', async () => {
    const { io, a, b, ra, clock, game } = await twoPlayers();
    const r = await a.call('blox_car_spawn', car({ type: 'truck', x: 4, z: 4 }));
    a.disconnect('transport close');
    assert.strictEqual(b.last('blox_game_roster').count, 1);
    assert.strictEqual(b.last('blox_game_cars').cars.length, 0, 'на час обриву машина зникає з гри');
    clock.t += 100;
    const a2 = io.connect('anna@x.com');
    const r2 = await join(a2, 'anna@x.com');
    assert.strictEqual(r2.id, ra.id, 'id збережено');
    assert.strictEqual(r2.cars.length, 1);
    assert.strictEqual(r2.cars[0].cid, r.cid);
    assert.strictEqual(r2.cars[0].type, 'truck');
    assert.strictEqual(b.last('blox_game_roster').count, 2);
    assert.strictEqual(b.last('blox_game_cars').cars.length, 1);
    game.shutdown();
});

test('після закінчення пільгового часу машина не повертається', async () => {
    const { io, a, ra, clock, game } = await twoPlayers();
    await a.call('blox_car_spawn', car());
    a.disconnect('transport close');
    clock.t += 5000;
    await sleep(40);                                   // tick чистить застарілі резерви
    const a2 = io.connect('anna@x.com');
    const r2 = await join(a2, 'anna@x.com');
    assert.strictEqual(r2.cars.length, 0);
    assert.notStrictEqual(r2.id, ra.id);
    game.shutdown();
});

test('вхід з іншого пристрою: старий відключається, дубліката немає, машина лишається', async () => {
    const { io, a, ra, game } = await twoPlayers();
    const r = await a.call('blox_car_spawn', car({ type: 'van' }));
    const phone2 = io.connect('anna@x.com');
    const r2 = await join(phone2, 'anna@x.com');
    assert.strictEqual(r2.success, true);
    assert.strictEqual(r2.id, ra.id);
    assert.strictEqual(a.last('blox_game_kicked').reason, 'other_device');
    assert.strictEqual(game.stats('realistic_cars').count, 2, 'гравців усе ще двоє');
    assert.strictEqual(r2.cars.length, 1);
    assert.strictEqual(r2.cars[0].cid, r.cid);
    // старий пристрій закрився: це не прибирає нового гравця й машину
    a.disconnect('client namespace disconnect');
    assert.strictEqual(game.stats('realistic_cars').count, 2);
    assert.strictEqual(game.stats('realistic_cars').cars, 1);
    game.shutdown();
});

test('blox_car_remove прибирає машину й розсилає список', async () => {
    const { a, b, game } = await twoPlayers();
    await a.call('blox_car_spawn', car());
    assert.strictEqual(b.last('blox_game_cars').cars.length, 1);
    assert.deepStrictEqual(await a.call('blox_car_remove', {}), { success: true });
    assert.strictEqual(b.last('blox_game_cars').cars.length, 0);
    game.shutdown();
});

test('журнал: причина відмови у вході, відсутній ACK, помилка сокета', async () => {
    const rec = recorder();
    const env = setup({ opts: { logger: rec.logger }, logged: new Set(['anna@x.com']) });
    const bob = env.io.connect('bob@x.com');
    const r = await join(bob, 'bob@x.com');
    assert.strictEqual(r.code, 'not_logged_in');
    assert.ok(has(rec, 'відмова у вході: причина=not_logged_in'));
    // join без ACK
    const anna = env.io.connect('anna@x.com');
    anna.send('blox_game_join', { email: 'anna@x.com', game: 'realistic_cars' });
    await sleep(30);
    assert.ok(has(rec, 'без ACK'));
    // spawn без ACK
    anna.send('blox_car_spawn', car());
    await sleep(10);
    assert.ok(has(rec, 'blox_car_spawn без ACK'));
    // збій сокета
    anna.handlers.error(new Error('boom'));
    assert.ok(has(rec, 'помилка Socket.IO сокета'));
    // неправильний пакет входу
    const bad = await bob.call('blox_game_join', 'не об\'єкт');
    assert.strictEqual(bad.code, 'bad_payload');
    assert.ok(has(rec, 'причина=bad_payload'));
    // у логах немає паролів/токенів/пошти
    assert.ok(!rec.lines.some((l) => /password|token|пароль|@x\.com/i.test(l)), 'секрети не потрапляють у лог');
    env.game.shutdown();
});

test('три гравці: кожен бачить усіх, а список і кількість збігаються', async () => {
    const { io, a, b, game } = await twoPlayers();
    const c = io.connect('carl@x.com');
    await join(c, 'carl@x.com');
    for (const cl of [a, b, c]) {
        const roster = cl.last('blox_game_roster');
        assert.strictEqual(roster.count, 3);
        assert.deepStrictEqual(roster.players.map((p) => p.nick).sort(), ['anna', 'bob', 'carl']);
    }
    b.disconnect('ping timeout');
    for (const cl of [a, c]) assert.strictEqual(cl.last('blox_game_roster').count, 2);
    game.shutdown();
});
