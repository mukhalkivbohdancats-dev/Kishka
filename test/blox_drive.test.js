// Перевірки водіння KishkaBlox: спідометр, плавний підйом, відрив від землі, підвіска, зіткнення машин,
// а також серверна перевірка руху, respawn і швидкості (kmh) для всіх гравців: node --test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const World = require('../blox_game/world.js');
const Phys = require('../blox_game/physics.js');
const { setup, join, sleep, GAME } = require('./helpers/fakeio.js');
const { kmhOf } = require('../blox_game_server.js');

const DT = 1 / 60;

test('спідометр: 0 за замовчуванням, росте з швидкістю, відповідає реальній швидкості', () => {
    assert.strictEqual(Phys.kmh(0), 0);
    assert.strictEqual(Phys.kmh(NaN), 0);
    assert.strictEqual(Phys.kmh(-50), Phys.kmh(50), 'задній хід теж показує швидкість');
    assert.strictEqual(Phys.kmh(100), Math.round(100 * 1.008));
    const c = Phys.createCar('sedan', -30, 300, -Math.PI / 2);
    assert.strictEqual(Phys.kmh(c.speed), 0);
    let prev = 0;
    for (let i = 0; i < 60 * 3; i++) {
        Phys.stepCar(c, { throttle: 1, steer: 0 }, DT);
        const v = Phys.kmh(c.speed);
        assert.ok(v >= prev, 'число не зменшується під час розгону');
        prev = v;
    }
    assert.ok(prev > 60, 'за 3 с набрали швидкість: ' + prev);
    // число на спідометрі = справжній шлях за секунду
    const x0 = c.x, z0 = c.z, v0 = Phys.kmh(c.speed);
    for (let i = 0; i < 6; i++) Phys.stepCar(c, { throttle: 0.2, steer: 0 }, DT);
    const dist = Math.hypot(c.x - x0, c.z - z0) / (6 * DT);
    assert.ok(Math.abs(dist * Phys.STUD_TO_KMH - v0) < v0 * 0.08, 'спідометр збігається з реальним рухом');
    // передачі
    assert.strictEqual(Phys.gearOf('sedan', 0), 0);
    assert.strictEqual(Phys.gearOf('sedan', -10), -1);
    assert.strictEqual(Phys.gearOf('sedan', 5), 1);
    assert.strictEqual(Phys.gearOf('sedan', 1000), Phys.CARS.sedan.gears);
});

test('машини: на рівному полі розганяються до реалістичної швидкості, ступінь залежить від типу', () => {
    const top = {};
    for (const type of Phys.CAR_TYPES) {
        const c = Phys.createCar(type, -30, 300, -Math.PI / 2);
        let best = 0;
        for (let i = 0; i < 60 * 30; i++) { Phys.stepCar(c, { throttle: 1, steer: 0 }, DT); best = Math.max(best, c.speed); }
        top[type] = Phys.kmh(best);
        assert.ok(top[type] > 70 && top[type] < 190, type + ' ' + top[type] + ' км/год');
    }
    assert.ok(top.sedan > top.van && top.van > top.truck, 'легка машина швидша за важку');
});

test('гірка: машина плавно заїжджає, не провалюється й на плиті стоїть на землі', () => {
    const c = Phys.createCar('sedan', 30, 0, Math.PI / 2);
    const def = Phys.CARS.sedan;
    let maxPitchStep = 0, prevPitch = 0, minClear = 1e9;
    for (let i = 0; i < 60 * 14; i++) {
        Phys.stepCar(c, { throttle: 1, steer: 0 }, DT);
        maxPitchStep = Math.max(maxPitchStep, Math.abs(c.pitch - prevPitch));
        prevPitch = c.pitch;
        minClear = Math.min(minClear, c.y - Phys.groundSample(def, c).y);
        if (c.x > 330) break;
    }
    assert.ok(c.x > 230, 'заїхала на верхню плиту: x=' + c.x.toFixed(0));
    assert.ok(maxPitchStep < 0.05, 'нахил кузова змінюється плавно: ' + maxPitchStep.toFixed(3));
    assert.ok(minClear > -0.01, 'не провалюється: ' + minClear.toFixed(3));
});

test('політ: з краю плити на швидкості машина відривається від землі, приземляється і підвіска пружинить', () => {
    const c = Phys.createCar('sedan', 30, 0, Math.PI / 2);
    let airFrames = 0, maxHeight = 0, landed = false, minClear = 1e9, sawSpring = false;
    for (let i = 0; i < 60 * 25; i++) {
        const wasAir = c.air;
        Phys.stepCar(c, { throttle: 1, steer: 0 }, DT);
        if (c.air) { airFrames++; maxHeight = Math.max(maxHeight, c.y - World.heightAt(c.x, c.z)); }
        if (wasAir && !c.air) landed = true;
        if (landed && Math.abs(c.sy) > 0.05) sawSpring = true;
        minClear = Math.min(minClear, c.y - Phys.groundSample(Phys.CARS.sedan, c).y);
        assert.ok(Number.isFinite(c.y) && Number.isFinite(c.speed));
        if (landed && i > 60 * 20) break;
    }
    assert.ok(airFrames > 10, 'відірвалась від землі: кадрів у польоті ' + airFrames);
    assert.ok(maxHeight > 2, 'висота польоту ' + maxHeight.toFixed(1));
    assert.ok(landed, 'приземлилась');
    assert.ok(sawSpring, 'після приземлення кузов просів на підвісці');
    assert.ok(minClear > -0.01, 'у польоті й після нього не під землею');
    for (let i = 0; i < 120; i++) Phys.stepCar(c, { throttle: 0, steer: 0 }, DT);
    assert.ok(!c.air && Math.abs(c.sy) < 0.02, 'підвіска заспокоїлась, машина не «залипла» й не тремтить');
});

test('низька швидкість: машина не злітає на гладкій дорозі й не залипає на місці', () => {
    const c = Phys.createCar('truck', 30, 0, Math.PI / 2);
    for (let i = 0; i < 60 * 3; i++) {
        Phys.stepCar(c, { throttle: 0.6, steer: 0 }, DT);
        assert.ok(!c.air, 'на рівній дорозі без відриву');
    }
    assert.ok(c.speed > 8);
    const stopped = Phys.createCar('van', 0, 100, 0);
    Phys.stepCar(stopped, { throttle: 0, steer: 0 }, DT);
    assert.ok(stopped.speed === 0 && !stopped.air);
});

test('машини доторкаються: зіткнення відштовхує, гасить швидкість і не лишає перекриття', () => {
    const a = Phys.createCar('sedan', -100, 300, Math.PI / 2);      // їде вздовж +X
    const b = { x: -60, y: a.y, z: 300, ry: Math.PI / 2, type: 'truck', speed: 0 };   // стоїть попереду
    let maxSpeed = 0, hit = false;
    for (let i = 0; i < 60 * 8; i++) {
        Phys.stepCar(a, { throttle: 1, steer: 0 }, DT, [b]);
        maxSpeed = Math.max(maxSpeed, a.speed);
        if (a.hit) hit = true;
        const ov = Phys.overlapCars(a, Phys.CARS.sedan, b, Phys.CARS.truck);
        assert.ok(!ov || ov.depth < 0.6, 'перекриття залишається малим');
    }
    assert.ok(hit, 'зіткнення було');
    assert.ok(maxSpeed > 20, 'до удару розігналась');
    assert.ok(a.x < b.x - (Phys.CARS.sedan.len + Phys.CARS.truck.len) / 2 * 0.9, 'не проїхала крізь вантажівку');
    // машини, що не торкаються, не взаємодіють
    const c = Phys.createCar('sedan', 0, 300, 0);
    const far = { x: 50, y: c.y, z: 300, ry: 0, type: 'van', speed: 0 };
    assert.strictEqual(Phys.collideCars(c, [far]), false);
    // одна над іншою (стрибок) — теж без зіткнення
    const above = { x: c.x, y: c.y + 9, z: c.z, ry: 0, type: 'van', speed: 0 };
    assert.strictEqual(Phys.collideCars(c, [above]), false);
    // лобове зіткнення з рухомою машиною: швидкості гасяться в обидва боки
    const p = Phys.createCar('sedan', 0, 400, 0); p.speed = 40;
    const q = { x: 0, y: p.y, z: 410, ry: Math.PI, type: 'sedan', speed: 40 };
    assert.strictEqual(Phys.collideCars(p, [q]), true);
    assert.ok(p.speed < 40, 'удар зменшив швидкість');
});

test('сервер: швидкість для спідометра рахує сервер і розсилає всім (kmh)', async () => {
    const { io, game } = setup();
    const a = io.connect('a@x.com'), b = io.connect('b@x.com');
    const ra = await join(a, 'a@x.com'); await join(b, 'b@x.com');
    const r = await a.call('blox_car_spawn', { game: GAME, type: 'sedan', x: 5, y: 1, z: 5, ry: 0 });
    assert.strictEqual(r.success, true);
    a.send('blox_game_state', { x: 6, y: 1, z: 7, ry: 0, a: 0, d: 1, c: { t: 'sedan', x: 6, y: 1, z: 7, ry: 0, s: 100, st: 0 } });
    await sleep(40);
    const ct = b.events('blox_car_tick').flat().filter((t) => t[0] === ra.id).pop();
    assert.strictEqual(ct[8], kmhOf(100), 'kmh рахує сервер');
    assert.strictEqual(ct[8], 101);
    assert.strictEqual(b.last('blox_game_cars').cars[0].kmh, 0, 'у списку машин — знімок на момент створення (0), далі швидкість іде в blox_car_tick');
    game.shutdown();
});

test('сервер: неможливі стрибки позиції відкидаються, нормальний рух проходить, ID чужих не підмінити', async () => {
    const { io, game, clock } = setup({ opts: { motionCheck: true } });
    const a = io.connect('a@x.com'), b = io.connect('b@x.com');
    const ra = await join(a, 'a@x.com'); const rb = await join(b, 'b@x.com');
    const ticks = () => b.events('blox_game_tick').flat().filter((t) => t[0] === ra.id);
    clock.t += 1000;
    a.send('blox_game_state', { x: 10, y: 1, z: 0, ry: 0, a: 1, d: 0 });                 // 10 студів за 1 с — нормально
    await sleep(30);
    assert.strictEqual(ticks().pop()[1], 10);
    const rbBefore = b.events('blox_game_tick').flat().filter((t) => t[0] === rb.id).length;
    clock.t += 1000;
    a.send('blox_game_state', { x: 600, y: 1, z: 0, ry: 0, a: 0, d: 0, id: rb.id, x2: 5 });   // телепорт на 590 студів + підроблений id
    await sleep(30);
    assert.strictEqual(ticks().pop()[1], 10, 'позиція не змінилась');
    assert.strictEqual(b.events('blox_game_tick').flat().filter((t) => t[0] === rb.id).length, rbBefore, 'чужий id не вплинув на інших');
    // фальшивий пакет «від імені» іншого гравця: ID завжди беруться із сокета, а не з даних клієнта
    a.send('blox_game_state', { id: rb.id, x: 12, y: 1, z: 0, ry: 0, a: 1, d: 0 });
    await sleep(30);
    assert.strictEqual(ticks().pop()[1], 12, 'рух записано саме гравцю a');
    assert.ok(!b.events('blox_game_tick').flat().some((t) => t[0] === rb.id && t[1] === 12), 'гравцю b позицію не підмінили');
    clock.t += 1000;
    a.send('blox_game_state', { x: 30, y: 1, z: 0, ry: 0, a: 1, d: 0 });                 // знову нормально
    await sleep(30);
    assert.strictEqual(ticks().pop()[1], 30);
    game.shutdown();
});

test('сервер: respawn повертає на майданчик, виходить з машини, обмежений за частотою і не працює без гри', async () => {
    const lines = [];
    const logger = { log: (l) => lines.push(l), warn: (l) => lines.push(l), error: (l) => lines.push(l) };
    const { io, game, clock } = setup({ opts: { logger, motionCheck: true } });
    const a = io.connect('a@x.com'), b = io.connect('b@x.com');
    const stranger = io.connect('s@x.com');
    assert.deepStrictEqual(await stranger.call('blox_game_respawn', {}), { success: false, code: 'not_in_game' });
    const ra = await join(a, 'a@x.com'); await join(b, 'b@x.com');
    await a.call('blox_car_spawn', { game: GAME, type: 'van', x: 5, y: 1, z: 5, ry: 0 });
    clock.t += 1000;
    a.send('blox_game_state', { x: 30, y: 1, z: 0, ry: 0, a: 0, d: 1, c: { t: 'van', x: 30, y: 1, z: 0, ry: 0, s: 20, st: 0 } });
    await sleep(30);
    clock.t += 5000;
    const r = await a.call('blox_game_respawn', {});
    assert.strictEqual(r.success, true);
    assert.ok(Math.abs(r.x) < 10 && Math.abs(r.z) < 10, 'повернуто біля майданчика');
    await sleep(30);
    const t = b.events('blox_game_tick').flat().filter((x) => x[0] === ra.id).pop();
    assert.strictEqual(t[6], 0, 'вийшов з машини');
    assert.strictEqual(b.last('blox_game_cars').count, 1, 'машина лишилась на місці');
    assert.deepStrictEqual(await a.call('blox_game_respawn', {}), { success: false, code: 'rate' });
    assert.ok(lines.some((l) => /respawn: гра=realistic_cars id=\d+ нік="a"/.test(l)), 'respawn є в логах Render');
    assert.ok(lines.some((l) => /посадка в машину|вихід із машини/.test(l)), 'посадка/вихід із машини є в логах');
    // після respawn наступний стан від місця спавну проходить без «телепорту»
    clock.t += 1000;
    a.send('blox_game_state', { x: r.x + 3, y: 1, z: r.z, ry: 0, a: 1, d: 0 });
    await sleep(30);
    assert.strictEqual(b.events('blox_game_tick').flat().filter((x) => x[0] === ra.id).pop()[1], r.x + 3);
    game.shutdown();
});

test('гра: у коді є спідометр, вікно спавну, зіткнення й зелена кнопка Spawn', () => {
    const dir = path.join(__dirname, '..', 'blox_game');
    const html = fs.readFileSync(path.join(dir, 'game.html'), 'utf8');
    const js = fs.readFileSync(path.join(dir, 'game.js'), 'utf8');
    assert.ok(/id="speedo"/.test(html) && /id="spdNum"/.test(html) && />0</.test(html), 'спідометр з нулем за замовчуванням');
    assert.ok(/Phys\.kmh\(myCar\.speed\)/.test(js), 'число — з реальної швидкості машини');
    assert.ok(/stepCar\(myCar, \{ throttle: th, steer: st \}, h, otherCars\)/.test(js), 'зіткнення з чужими машинами');
    assert.ok(/#carsPanel[\s\S]*width: min\(94vw, 1040px\)/.test(html), 'вікно вибору широке');
    assert.ok(/#spawnBtn[\s\S]*#4ee06a/.test(html) && /@keyframes spawnPulse/.test(html), 'кнопка Spawn зелена й анімована');
    assert.ok(/respawn: function/.test(js), 'KishkaGame.respawn');
});

test('сервер: скарга на гравця пишеться в журнал, обмежена за частотою й перевіряє ціль', async () => {
    const lines = [];
    const logger = { log: (l) => lines.push(l), warn: (l) => lines.push(l), error: (l) => lines.push(l) };
    const { io, game, clock } = setup({ opts: { logger } });
    const a = io.connect('a@x.com'), b = io.connect('b@x.com');
    const ra = await join(a, 'a@x.com'); const rb = await join(b, 'b@x.com');
    assert.deepStrictEqual(await a.call('blox_game_report', { target: ra.id }), { success: false, code: 'bad_target' });
    assert.deepStrictEqual(await a.call('blox_game_report', { target: 999 }), { success: false, code: 'bad_target' });
    assert.deepStrictEqual(await a.call('blox_game_report', { target: '2' }), { success: false, code: 'bad_target' });
    assert.deepStrictEqual(await a.call('blox_game_report', { target: rb.id }), { success: true });
    assert.deepStrictEqual(await a.call('blox_game_report', { target: rb.id }), { success: false, code: 'rate' });
    clock.t += 11000;
    assert.deepStrictEqual(await a.call('blox_game_report', { target: rb.id }), { success: true });
    assert.ok(lines.some((l) => /скарга: гра=realistic_cars від id=\d+ нік="a" на id=\d+ нік="b"/.test(l)));
    game.shutdown();
});

test('Android: меню в стилі Roblox має вкладки, рядки гравців, Invite/Leave/Respawn/Resume і рядки в uk, ru, en', () => {
    const dir = path.join(__dirname, '..', 'app', 'src', 'main', 'java', 'com', 'kishka', 'messenger');
    const menu = fs.readFileSync(path.join(dir, 'Bloxmenu.kt'), 'utf8');
    const game = fs.readFileSync(path.join(dir, 'Bloxgame.kt'), 'utf8');
    const tab = fs.readFileSync(path.join(dir, 'Kishkabloxtab.kt'), 'utf8');
    for (const k of ['tab_people', 'tab_settings', 'tab_gallery', 'tab_report', 'tab_help', 'invite_friends', 'in_server', 'respawn', 'resume', 'add_friend', 'leave']) {
        assert.ok(menu.includes('b("' + k + '")'), 'меню використовує ' + k);
        assert.strictEqual((tab.match(new RegExp('"' + k + '" to "', 'g')) || []).length, 3, k + ' є в трьох мовах');
    }
    assert.ok(/BloxTopBar/.test(game) && /BloxRobloxMenu/.test(game), 'екран гри показує верхній ряд і меню');
    assert.ok(/blox_game_respawn/.test(game) && /blox_game_report/.test(game) && /KishkaGame\.respawn/.test(game), 'respawn і скарги йдуть через сервер');
    assert.ok(/Leave|leave/.test(menu) && /confirmLeave/.test(menu), 'вихід з підтвердженням');
    assert.ok(/LazyVerticalGrid/.test(menu) && /ViewList/.test(menu), 'перемикач список/плитки');
    assert.ok(/BloxAuth\.addFriend/.test(menu), 'Add Friend працює через існуючий акаунт KishkaBlox');
});

test('димовий запуск game.js (імітація браузера): старт, кадри, вікно машин, Spawn, спідометр, respawn, блок гравця', () => {
    const { loadGame } = require('./helpers/fakedom.js');
    const g = loadGame();
    assert.ok(g.calls.some((c) => c[0] === 'ready'), 'сторінка повідомила застосунок, що готова');
    const failed = () => g.calls.filter((c) => c[0] === 'failReason' || c[0] === 'fail');
    assert.strictEqual(failed().length, 0, 'без помилок запуску: ' + JSON.stringify(failed()));
    g.win.KishkaGame.config({ lang: 'uk', invertCamera: false });
    g.win.KishkaGame.start({ id: 1, nick: 'Me', x: 0, y: 1, z: 0, ry: 0, players: [{ id: 1, nick: 'Me' }, { id: 2, nick: 'Bob' }], cars: [] });
    g.frame(30);
    assert.ok(g.calls.some((c) => c[0] === 'started'), 'перший кадр світу намальовано');

    // вікно машин: три картки + велика кнопка Spawn
    g.el('carsBtn').click();
    g.frame(2);
    const cards = g.el('carsList').children.filter((c) => /card/.test(c.className || '')).length;
    assert.strictEqual(cards, 3, 'у вікні три машини');
    assert.ok(/Створити|Spawn/.test(g.el('spawnBtn').textContent) || g.el('spawnBtn').textContent.length > 0, 'кнопка Spawn підписана');
    g.el('spawnBtn').click();
    return new Promise((resolve) => setTimeout(resolve, 200)).then(() => {
        const spawn = g.calls.find((c) => c[0] === 'carSpawn');
        assert.ok(spawn, 'Spawn відправив запит створення машини застосунку');
        g.win.KishkaGame.carResult({ ok: true, cid: 1 });
        g.win.KishkaGame.cars({ cars: [{ id: 1, cid: 1, type: spawn[1], x: spawn[2], y: spawn[3], z: spawn[4], ry: spawn[5] }] });
        g.frame(10);
        // газ: спідометр оживає й показує реальну швидкість машини (дані рахує та сама фізика, що й сервер)
        assert.strictEqual(g.el('spdNum').textContent, '0', 'спідометр показує 0, поки машина стоїть');
        const fire = (id, ev) => (g.el(id)._listeners[ev] || []).forEach((f) => f({ pointerId: 7, preventDefault() {} }));
        fire('gas', 'pointerdown');
        g.frame(150);
        const shown = Number(g.el('spdNum').textContent);
        assert.ok(shown > 40, 'число на спідометрі росте з швидкістю: ' + shown);
        assert.ok(Number(g.el('spdBar').attrs['stroke-dasharray'].split(' ')[0]) > 10, 'стрілка-дуга заповнюється');
        assert.ok(/^D[1-9]$/.test(g.el('spdGear').textContent), 'передача: ' + g.el('spdGear').textContent);
        fire('gas', 'pointerup');
        // респавн і блок гравця не ламають гру
        g.win.KishkaGame.respawn({ x: 3, y: 1, z: 0, ry: 1.57 });
        g.win.KishkaGame.hidePlayer(2, true);
        g.win.KishkaGame.lookAt(2);
        g.frame(20);
        assert.strictEqual(failed().length, 0, 'після дій гра не впала');
        assert.ok(!g.calls.some((c) => c[0] === 'log' && /ПОМИЛКА|Error|TypeError/.test(String(c[1]))), 'у логах гри немає помилок JS');
    });
});
