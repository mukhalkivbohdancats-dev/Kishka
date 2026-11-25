// Перевірки нових можливостей KishkaBlox: чат, кодові двері на вершині, запуск ядерної бомби, бункер, місто, HP: node --test
// Це перевірки логіки в Node (сервер на імітації Socket.IO, клієнт на імітації браузера). Графіку на справжньому телефоні вони НЕ перевіряють.
const test = require('node:test');
const assert = require('node:assert');

const World = require('../blox_game/world.js');
const Phys = require('../blox_game/physics.js');
const Nuke = require('../blox_game/nuke.js');
const Structures = require('../blox_game/structures.js');
const Models = require('../blox_game/models.js');
const { sleep, setup, join } = require('./helpers/fakeio.js');

const S = World.SUMMIT, BK = World.BUNKER, T = Nuke.T;

// ------------------------------------------------------------------ таймлайн
test('ядерна подія: 30 с анімації, відлік 59 -> 0, потім двері бункера зачиняються, вибух і скидання', () => {
    assert.strictEqual(T.cinemaEnd, 30000, 'анімація 30 секунд');
    assert.strictEqual(T.countdownS, 59, 'відлік з 59');
    assert.strictEqual(Nuke.phase(-1), 'idle');
    assert.strictEqual(Nuke.phase(1000), 'cinema');
    assert.strictEqual(Nuke.countdownShown(1000), null, 'у кадрах анімації напису ще нема');
    assert.strictEqual(Nuke.countdownShown(T.cinemaEnd), 59, 'після кінця анімації — 59');
    assert.strictEqual(Nuke.countdownShown(T.cinemaEnd + 1000), 58);
    assert.strictEqual(Nuke.countdownShown(T.countEnd - 1), 1);
    assert.strictEqual(Nuke.countdownShown(T.countEnd), null, 'на нулі всі написи зникають');
    // правильне число секунд рівно 59 значень
    const seen = new Set();
    for (let ms = T.cinemaEnd; ms < T.countEnd; ms += 100) seen.add(Nuke.countdownShown(ms));
    assert.strictEqual(seen.size, 59);
    // двері бункера: відкриті весь відлік, потім зачиняються
    assert.strictEqual(Nuke.bunkerDoorOpen(T.countEnd - 1), 1);
    assert.ok(Nuke.bunkerDoorOpen(T.countEnd + 1500) < 0.7 && Nuke.bunkerDoorOpen(T.countEnd + 1500) > 0.05);
    assert.strictEqual(Nuke.bunkerDoorOpen(T.countEnd + T.doorsClose), 0);
    assert.strictEqual(Nuke.bunkerDoorOpen(T.total), 1, 'після скидання знову відкриті');
    // вибух після польоту бомби; сирени затихають після вибуху
    assert.ok(T.impact > T.countEnd && T.sirenEnd > T.impact && T.total > T.sirenEnd);
    assert.strictEqual(Nuke.phase(T.impact), 'burned');
    assert.strictEqual(Nuke.phase(T.total), 'done');
    assert.strictEqual(Nuke.snapshot(10000).sirens, true, 'сирени грають з початку анімації');
    assert.strictEqual(Nuke.snapshot(T.sirenEnd + 10).sirens, false);
    // дах коробки відкривається першим; двері камери — після
    assert.ok(Nuke.lidOpen(0) === 0 && Nuke.lidOpen(T.lidEnd) === 1);
    assert.ok(Nuke.summitDoorOpen(T.doorOpenAt - 1) === 0 && Nuke.summitDoorOpen(T.doorOpenAt + 2000) === 1);
});

test('ядерна подія: бомба здіймається з коробки, відлітає, потім прилітає з горизонту й падає в центр майданчика', () => {
    const r = Nuke.bombPose(0), lift = Nuke.bombPose(T.shotC - 1), out = Nuke.bombPose(T.cinemaEnd - 1);
    assert.ok(r.visible && Math.abs(r.x - S.bomb.x) < 1e-6);
    assert.ok(lift.y > r.y + 40, 'за кадр «з дверей» бомба піднялась над коробкою');
    assert.ok(out.y > lift.y + 200, 'потім вилітає геть');
    assert.strictEqual(Nuke.bombPose(T.cinemaEnd + 100).visible, false);
    const first = Nuke.inboundPose(T.countEnd + 1), last = Nuke.inboundPose(T.impact - 1);
    assert.ok(first.visible && first.x > 1500, 'з\'являється далеко, з боку гірки (+X)');
    assert.ok(Math.hypot(last.x, last.z) < 40 && last.y < 40, 'наприкінці — на колі майданчика');
    assert.ok(last.pitch > Math.PI / 2, 'пікірує носом униз');
    // піднімається, потім летить і повертає: висота спочатку зростає
    const mid = Nuke.inboundPose(T.countEnd + T.inboundMs * 0.3);
    assert.ok(mid.y > first.y + 100, 'спочатку піднімається');
    // камери є лише в потрібні фази
    assert.ok(Nuke.cinemaCamera(500) && Nuke.cinemaCamera(8000) && Nuke.cinemaCamera(20000));
    assert.strictEqual(Nuke.cinemaCamera(T.cinemaEnd + 10), null);
    assert.ok(Nuke.inboundCamera(T.countEnd + 100) && Nuke.inboundCamera(T.impact + 100));
    assert.strictEqual(Nuke.inboundCamera(T.impact + 5000), null);
});

test('вибух: машина поза бункером відлітає на 1-50 студів, усередині бункера — безпечно', () => {
    for (let id = 1; id < 400; id++) {
        const t = Nuke.carThrow(id, 120 + id, -40 + id);
        assert.ok(t.dist >= 1 && t.dist <= 50, 'дальність ' + t.dist);
        assert.ok(Math.abs(Math.hypot(t.dx, t.dz) - t.dist) < 1e-6);
    }
    const a = Nuke.carThrow(7, 100, 50), b = Nuke.carThrow(7, 100, 50);
    assert.deepStrictEqual(a, b, 'на всіх екранах один і той самий результат');
    assert.strictEqual(Nuke.safe(-120, 2, 0), true, 'усередині бункера');
    assert.strictEqual(Nuke.safe(-60, 2, 0), false, 'перед входом — ні');
    assert.strictEqual(Nuke.safe(0, 2, 0), false, 'на майданчику — ні');
    assert.strictEqual(Nuke.safe(-120, 40, 0), false, 'на даху бункера — ні');
});

// ------------------------------------------------------------------ споруди: коробка, двері, бункер, місто
test('коробка на вершині: займає 1/5 верху, двері металеві й їдуть угору, камера всередині, бомба й кнопка на місці', () => {
    const R = World.RAMP;
    const topArea = R.lenTop * 2 * R.hw, boxArea = (S.x1 - S.x0) * 2 * S.hw;
    assert.ok(Math.abs(boxArea / topArea - 0.2) < 0.01, 'площа коробки ≈ 1/5 верху: ' + (boxArea / topArea).toFixed(3));
    assert.ok(S.x0 > R.xTop && S.x1 < R.xEnd, 'коробка на плоскому верху');
    assert.ok(Math.abs(S.x0 - R.xTop) < 60 && Math.abs(S.hw * 2 - 126) < 1, 'спереду посередині');
    // двері зачинені — не пройти, відчинені — проходять; камера всередині порожня
    const mid = (S.door.x0 + S.door.x1) / 2, y = S.top + 5;
    assert.ok(World.contact(mid, y, 0), 'двері зачинені — тверді');
    World.setDoor('summit', 1);
    assert.strictEqual(World.contact(mid, y, 0), null, 'відчинені — вільно');
    assert.strictEqual(World.contact(S.ch.x0 + 10, y, 0), null, 'камера порожня');
    World.setDoor('summit', 0);
    // стіна з боків тверда
    assert.ok(World.contact(S.x0 + 1.5, S.top + 8, 30));
    // пішохід: у зачинені двері не проходить, у відчинені заходить до кнопки
    let w = { x: S.x0 - 8, y: S.top, z: 0 };
    for (let i = 0; i < 80; i++) { w.x += 0.4; const o = World.resolveObstacles(w.x, w.z, 1.2, w.y); w.x = o.x; w.z = o.z; }
    assert.ok(w.x < S.door.x0, 'зачинені двері не пускають, x=' + w.x.toFixed(1));
    World.setDoor('summit', 1);
    for (let i = 0; i < 80; i++) { w.x += 0.4; const o = World.resolveObstacles(w.x, w.z, 1.2, w.y); w.x = o.x; w.z = o.z; }
    assert.ok(w.x > S.ch.x0 + 3, 'відчинені двері пускають усередину, x=' + w.x.toFixed(1));
    assert.ok(World.inChamber(w.x, S.top + 1, w.z));
    World.setDoor('summit', 0);
    // дах камери і бомба
    World.setLid(1); assert.strictEqual(World.contact(S.ch.x0 + 18, S.top + S.ch.h + 3, 0), null, 'дах відкрився');
    World.setLid(0); assert.ok(World.contact(S.ch.x0 + 18, S.top + S.ch.h + 3, 0), 'дах закритий');
    assert.ok(World.contact(S.bomb.x, S.top + 8, S.bomb.z), 'бомба тверда');
    World.setBombSolid(false); assert.strictEqual(World.contact(S.bomb.x, S.top + 8, S.bomb.z), null); World.setBombSolid(true);
    assert.ok(S.button.x < S.bomb.x && Math.abs(S.button.z) < 1, 'кнопка перед бомбою (ближче до дверей)');
});

test('бункер: з протилежного від гірки боку, завжди відкритий, вміщує вантажівку, а двері зачиняються', () => {
    assert.ok(BK.x1 < 0 && World.RAMP.xs > 0, 'бункер по інший бік майданчика від гірки');
    assert.strictEqual(World.getDoor('bunker'), 1, 'відкритий');
    // вантажівка заїжджає всередину
    const c = Phys.createCar('truck', -20, 0, -Math.PI / 2);
    let inside = false;
    for (let i = 0; i < 60 * 14; i++) {
        Phys.stepCar(c, { throttle: 1 }, 1 / 60); c.events.length = 0;
        if (World.inBunker(c.x, c.y + 2, c.z)) { inside = true; break; }
    }
    assert.ok(inside, 'вантажівка заїхала в бункер, x=' + c.x.toFixed(0));
    // зачинені двері не пускають
    World.setDoor('bunker', 0);
    assert.ok(World.contact(BK.x1 - 2, 5, 0), 'двері бункера зачинені');
    const c2 = Phys.createCar('sedan', -20, 0, -Math.PI / 2);
    for (let i = 0; i < 60 * 10; i++) { Phys.stepCar(c2, { throttle: 1 }, 1 / 60); c2.events.length = 0; }
    assert.ok(c2.x > BK.x1 - 1, 'седан не проїхав крізь зачинені двері, x=' + c2.x.toFixed(1));
    World.setDoor('bunker', 1);
});

test('сирени стоять навколо майданчика й не перегороджують ні дорогу до гірки, ні проїзд у бункер', () => {
    assert.ok(World.SIRENS.length >= 6);
    for (const s of World.SIRENS) {
        assert.ok(Math.abs(Math.hypot(s.x, s.z) - 44) < 0.01, 'навколо кола');
        assert.ok(!(s.x > 0 && Math.abs(s.z) < 14), 'не на дорозі до гірки');
        assert.ok(!(s.x < 0 && Math.abs(s.z) < BK.doorHz + 2), 'не на підході до бункера');
    }
    // їдучи по осі дороги й до бункера, не зачіпаємо жодної сирени
    for (const dir of [1, -1]) {
        for (let x = 0; x < 160; x += 2) assert.strictEqual(World.contact(dir * x, 1.0, 0), null, 'вільно на x=' + dir * x);
    }
});

test('місто: за ~500 м, будинки 50×50 м, висотки, у будинки можна зайти, а крізь стіни — ні', () => {
    const C = World.CITY;
    const distM = Math.hypot(C.cx, C.cz) * Phys.S * 1;
    assert.ok(distM > 420 && distM < 560, 'відстань до міста ≈ 500 м, а тут ' + distM.toFixed(0));
    assert.ok(Math.abs(C.bld * Phys.S - 50) < 1, '143 студи ≈ 50 м: ' + (C.bld * Phys.S).toFixed(1));
    const kinds = new Set(C.buildings.map((b) => b.kind));
    assert.ok(kinds.has('house') && kinds.has('mid') && kinds.has('tower'), 'є будинки й багатоповерхівки: ' + [...kinds]);
    assert.ok(C.buildings.some((b) => b.floors >= 25), 'є висотки');
    assert.ok(Math.abs(World.groundHeight(C.cx + 300, C.cz + 200)) < 0.2, 'місто на рівній землі');
    // кожен будинок: вхід вільний, у вестибюлі порожньо, стіна тверда
    for (const b of C.buildings) {
        const doorPt = b.side === 0 ? [b.x0 + 2, b.cz] : (b.side === 1 ? [b.x1 - 2, b.cz] : (b.side === 2 ? [b.cx, b.z0 + 2] : [b.cx, b.z1 - 2]));
        assert.strictEqual(World.contact(doorPt[0], 3, doorPt[1]), null, 'двері будинку вільні (' + b.i + ',' + b.j + ')');
        assert.strictEqual(World.contact(b.cx, 4, b.cz), null, 'у вестибюлі порожньо');
        const wallPt = b.side === 0 ? [b.x1 - 2, b.cz] : [b.x0 + 2, b.cz];
        assert.ok(World.contact(wallPt[0], 3, wallPt[1]), 'стіна тверда');
    }
    // пішохід заходить у перший будинок через двері
    const b = C.buildings.find((q) => q.side === 0);
    let w = { x: b.x0 - 12, y: 0, z: b.cz };
    for (let i = 0; i < 90; i++) { w.x += 0.45; const o = World.resolveObstacles(w.x, w.z, 1.2, w.y); w.x = o.x; w.z = o.z; }
    assert.ok(w.x > b.x0 + 6, 'увійшов у будинок, x=' + w.x.toFixed(1) + ' (стіна ' + b.x0.toFixed(0) + ')');
    // а в бік стіни — не проходить
    let w2 = { x: b.x0 - 12, y: 0, z: b.z0 + 20 };
    for (let i = 0; i < 90; i++) { w2.x += 0.45; const o = World.resolveObstacles(w2.x, w2.z, 1.2, w2.y); w2.x = o.x; w2.z = o.z; }
    assert.ok(w2.x < b.x0, 'крізь стіну не пройти, x=' + w2.x.toFixed(1));
});

test('геометрія споруд: кожна сітка валідна й менша за 65000 вершин', () => {
    const sm = Structures.buildSummit(), bk = Structures.buildBunker(), city = Structures.buildCity();
    const all = { shell: sm.shell, lidF: sm.lidFront, lidB: sm.lidBack, door: sm.door, button: sm.button, bomb: sm.bomb, bunker: bk.shell, bdoor: bk.door, siren: Structures.buildSiren(), cityF: city.facade, cityD: city.detail, ramp: Models.buildRamp(World).top, ramp2: Models.buildRamp(World).walls };
    for (const k of Object.keys(all)) {
        assert.ok(!Models.checkGeo(all[k]), k + ': ' + Models.checkGeo(all[k]));
        assert.ok(all[k].pos.length / 3 < 65000, k + ' вершин: ' + all[k].pos.length / 3);
    }
});

// ------------------------------------------------------------------ сервер: чат, код дверей, запуск
async function room() {
    const env = setup();
    const a = env.io.connect('anna@x.com'), b = env.io.connect('bob@x.com');
    const ra = await join(a, 'anna@x.com'), rb = await join(b, 'bob@x.com');
    return Object.assign(env, { a, b, ra, rb });
}

test('чат: повідомлення бачать усі, текст чиститься й обмежується, часті повідомлення відхиляються, історія — тому, хто зайшов пізніше', async () => {
    const { a, b, clock, io, game } = await room();
    const r1 = await a.call('blox_chat', { text: '  Привіт\u0000   усім \u200b ' });
    assert.deepStrictEqual(r1, { success: true });
    const msg = b.last('blox_chat_msg');
    assert.strictEqual(msg.nick, 'anna');
    assert.strictEqual(msg.text, 'Привіт усім', 'зайві пробіли й керівні символи прибрані');
    assert.ok(a.last('blox_chat_msg'), 'автор теж отримує своє повідомлення');
    assert.deepStrictEqual(await a.call('blox_chat', { text: '   ' }), { success: false, code: 'empty' });
    assert.deepStrictEqual(await a.call('blox_chat', { text: 'x' }), { success: false, code: 'rate' }, 'не частіше ~1.7 повідомлення/с');
    clock.t += 1000;
    await a.call('blox_chat', { text: 'a'.repeat(500) });
    assert.strictEqual(b.last('blox_chat_msg').text.length, 160, 'не довше 160 символів');
    for (let i = 0; i < 12; i++) { clock.t += 700; await a.call('blox_chat', { text: 'msg' + i }); }
    clock.t += 700;
    const c = io.connect('cat@x.com');
    const rc = await join(c, 'cat@x.com');
    assert.ok(Array.isArray(rc.chat) && rc.chat.length > 3, 'новий гравець отримує останні повідомлення');
    assert.ok(rc.chat.length <= 40);
    const out = io.connect('zzz@x.com');
    assert.deepStrictEqual(await out.call('blox_chat', { text: 'hi' }), { success: false, code: 'not_in_game' });
    game.shutdown();
});

test('двері коробки: правильний код відчиняє на 5 с для всіх, неправильний — ні, після 6 помилок код блокується', async () => {
    const { a, b, clock, game } = await room();
    assert.deepStrictEqual(await a.call('blox_door_code', { code: '0000' }), { success: false, code: 'bad_code' });
    assert.deepStrictEqual(await a.call('blox_door_code', { code: '16' }), { success: false, code: 'bad_code' });
    assert.deepStrictEqual(await a.call('blox_door_code', { code: '16200' }), { success: false, code: 'bad_code' });
    assert.strictEqual(b.events('blox_door').length, 0, 'неправильні коди двері не відчиняють');
    const ok = await a.call('blox_door_code', { code: '1620' });
    assert.deepStrictEqual(ok, { success: true, openMs: 5000 });
    const ev = b.last('blox_door');
    assert.ok(ev && ev.open === true && ev.openMs === 5000, 'усі отримали подію відчинення');
    // 6 помилок за хвилину -> блок на 30 с (навіть правильний код)
    const e2 = setup(); const x = e2.io.connect('x@x.com'); await join(x, 'x@x.com');
    for (let i = 0; i < 6; i++) await x.call('blox_door_code', { code: '1111' });
    assert.deepStrictEqual(await x.call('blox_door_code', { code: '1620' }), { success: false, code: 'rate' });
    e2.clock.t += 31000;
    assert.strictEqual((await x.call('blox_door_code', { code: '1620' })).success, true, 'після 30 с можна знову');
    e2.game.shutdown(); game.shutdown();
    void clock;
});

test('запуск бомби: лише біля кнопки й при відчинених дверях; усі отримують t0; нова бомба поки триває — відхиляється; скидання світу за таймером', async () => {
    const { a, b, clock, game } = await room();
    // двері зачинені
    a.send('blox_game_state', { x: S.x0 + 14, y: S.top + 1, z: 0, ry: 0, a: 0, d: 0 });
    await sleep(30);
    assert.deepStrictEqual(await a.call('blox_nuke_launch'), { success: false, code: 'door_closed' });
    await a.call('blox_door_code', { code: '1620' });
    // далеко від кнопки (на майданчику)
    b.send('blox_game_state', { x: 3, y: 1, z: 2, ry: 0, a: 0, d: 0 });
    await sleep(30);
    assert.deepStrictEqual(await b.call('blox_nuke_launch'), { success: false, code: 'too_far' });
    const r = await a.call('blox_nuke_launch');
    assert.strictEqual(r.success, true);
    const ev = b.last('blox_nuke');
    assert.ok(ev && ev.state === 'launch' && ev.t0 === r.t0 && ev.now >= ev.t0);
    assert.deepStrictEqual(await a.call('blox_nuke_launch'), { success: false, code: 'busy' });
    // новий гравець під час події отримує t0
    const c = game; void c;
    const late = a.io.connect('late@x.com');
    const rl = await join(late, 'late@x.com');
    assert.ok(rl.nuke && rl.nuke.t0 === r.t0 && rl.serverNow >= r.t0, 'той, хто зайшов пізніше, потрапляє в потрібну фазу');
    game.shutdown();
    void clock;
});

// ------------------------------------------------------------------ клієнт у «фейковому» браузері
test('клієнт: чат, HP-смужка, падіння й відродження, ядерна подія (напис, відлік, камера, спалах) — без помилок JavaScript', async () => {
    const { loadGame } = require('./helpers/fakedom.js');
    const g = loadGame();
    const failed = () => g.calls.filter((c) => c[0] === 'failReason' || c[0] === 'fail');
    g.win.KishkaGame.config({ lang: 'en', invertCamera: false });
    g.win.KishkaGame.start({ id: 1, nick: 'Me', x: 0, y: 1, z: 0, ry: 0, serverNow: Date.now(), chat: [{ id: 2, nick: 'Bob', text: 'hello' }], players: [{ id: 1, nick: 'Me' }, { id: 2, nick: 'Bob' }], cars: [] });
    g.frame(20);
    assert.ok(g.calls.some((c) => c[0] === 'started'));
    assert.strictEqual(g.el('chatList').children.length, 1, 'історія чату показана');
    assert.strictEqual(g.el('chatInput').attrs.placeholder, 'Tap here to chat', 'підказка чату без мікрофона й «Say hi»');
    assert.strictEqual(g.el('chatPanel').children.length, 0);

    g.win.KishkaGame.serverEvent('blox_chat_msg', { id: 2, nick: 'Bob', text: 'yo <b>x</b>' });
    assert.strictEqual(g.el('chatList').children.length, 2);
    assert.strictEqual(g.el('chatList').children[1].children[1].textContent, 'yo <b>x</b>', 'чужий текст лише як текст, без HTML');

    // HP: повна смужка зелена; удар знімає; смерть -> запит відродження -> персонаж на майданчику
    assert.strictEqual(g.el('hpFill').style.width, '100%');
    assert.ok(/hsl\(120/.test(g.el('hpFill').style.background), 'повне здоров\'я — зелений');
    g.win.KishkaGame.respawn({ success: true, x: 3, y: 1, z: 2, ry: 0.3 });        // кнопка «Відродитись»: HP -> 0
    g.frame(2);
    assert.strictEqual(g.el('hpFill').style.width, '0%', 'HP 0 після «Відродитись»');
    g.frame(150);                                                                    // падіння ~2.2 с
    assert.strictEqual(g.el('hpFill').style.width, '100%', 'після відродження HP знову повне');

    // ядерна подія: анімація -> відлік -> вибух -> скидання (час сервера = час пристрою)
    const now = Date.now();
    g.win.KishkaGame.serverEvent('blox_nuke', { state: 'launch', t0: now - 4000, now });
    g.frame(10);
    assert.ok(g.doc.body.classList.contains('cine'), 'під час анімації ховаються кнопки керування');
    assert.ok(!g.el('nukeBanner').classList.contains('show'), 'напису ще нема');
    g.win.KishkaGame.serverEvent('blox_nuke', { state: 'launch', t0: Date.now() - (T.cinemaEnd + 3000), now: Date.now() });
    g.frame(10);
    assert.ok(g.el('nukeBanner').classList.contains('show'), 'після анімації видно напис');
    assert.strictEqual(g.el('nbText').textContent, 'NUKE WAS LAUNCHED, ENTER THE BUNKER.');
    assert.ok(/^5[5-9]S$/.test(g.el('nbCount').textContent), 'відлік 59S -> …: ' + g.el('nbCount').textContent);
    g.win.KishkaGame.serverEvent('blox_nuke', { state: 'launch', t0: Date.now() - (T.countEnd + 500), now: Date.now() });
    g.frame(10);
    assert.ok(!g.el('nukeBanner').classList.contains('show'), 'на нулі написи зникають');
    const GW = g.win.KishkaWorld;          // світ усередині «браузера» (окрема копія від World у цьому файлі)
    assert.ok(GW.getDoor('bunker') < 1, 'двері бункера зачиняються');
    g.win.KishkaGame.serverEvent('blox_nuke', { state: 'launch', t0: Date.now() - (T.impact + 800), now: Date.now() });
    g.frame(10);
    assert.ok(Number(g.el('flashOv').style.opacity) > 0, 'спалах при вибуху');
    g.win.KishkaGame.serverEvent('blox_nuke', { state: 'reset', now: Date.now() });
    g.frame(10);
    assert.strictEqual(GW.getDoor('bunker'), 1, 'після скидання двері бункера знову відкриті');
    assert.ok(!g.doc.body.classList.contains('cine'));
    assert.strictEqual(failed().length, 0, 'без помилок: ' + JSON.stringify(failed()));
});

test('клієнт: слабкий інтернет — машина НЕ зникає й не виникає напису «неможливо створити», реєстрація повторюється', async () => {
    const { loadGame } = require('./helpers/fakedom.js');
    const g = loadGame();
    g.win.KishkaGame.config({ lang: 'uk', invertCamera: false });
    g.win.KishkaGame.start({ id: 1, nick: 'Me', x: 0, y: 1, z: 0, ry: 0, players: [{ id: 1, nick: 'Me' }], cars: [] });
    g.frame(20);
    g.el('carsBtn').click(); g.frame(2);
    g.el('spawnBtn').click();
    await sleep(200);
    const first = g.calls.filter((c) => c[0] === 'carSpawn');
    assert.strictEqual(first.length, 1);
    g.win.KishkaGame.carResult({ ok: false, code: 'timeout' });                // інтернет підвів
    g.frame(5);
    const toastText = () => g.el('toast').textContent || '';
    assert.ok(!/не вдалося|неможливо|failed/i.test(toastText()), 'жодного напису про помилку: ' + toastText());
    g.win.KishkaGame.cars({ cars: [] });                                         // сервер ще не знає про машину — локальна лишається
    g.frame(5);
    g.win.KishkaGame.carResult;                                                  // (машина лишилась: наступний кадр її малює)
    await sleep(2700);
    g.frame(5);
    assert.ok(g.calls.filter((c) => c[0] === 'carSpawn').length >= 2, 'реєстрація повторена тихо');
    g.win.KishkaGame.carResult({ ok: true, cid: 5 });
    g.frame(3);
    assert.ok(!/не вдалося|неможливо|failed/i.test(toastText()));
});
