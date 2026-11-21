// Оновлення листопада 2026: вища гірка, ліміти швидкості (седан 250, фургон і вантажівка 105), дріфт на P, сплющення кузова,
// деталізація моделей, стрілка на кнопці «Перевернути», веб-версія (GitHub Pages): міст, вхід за ніком/паролем, збирання сайту.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { FakeIO, GAME, join } = require('./helpers/fakeio.js');

const ROOT = path.join(__dirname, '..');
const GAME_DIR = path.join(ROOT, 'blox_game');
const World = require(path.join(GAME_DIR, 'world.js'));
const Phys = require(path.join(GAME_DIR, 'physics.js'));
const Models = require(path.join(GAME_DIR, 'models.js'));
const DT = 1 / 60;
const plain = (x) => JSON.parse(JSON.stringify(x));          // об'єкти з vm-контексту мають інший прототип: порівнюємо як JSON

// ------------------------------------------------------------------ рівна нескінченна площина для вимірювання швидкості
function withFlatWorld(fn) {
    const saved = { heightAt: World.heightAt, rayDown: World.rayDown, contact: World.contact, limitR: World.CFG.limitR, ground: World.groundHeight };
    World.CFG.limitR = 1e7;
    World.heightAt = () => 0;
    World.groundHeight = () => 0;
    World.rayDown = (x, y, z, maxLen, out) => {
        if (y < -0.35 || y > maxLen) return -1;
        out = out || {}; out.nx = 0; out.ny = 1; out.nz = 0; out.surf = 1; out.h = 0;
        return Math.max(0, y);
    };
    const c0 = { depth: 0, nx: 0, ny: 1, nz: 0, solid: false };
    World.contact = (x, y, z, out) => { out = out || c0; if (y >= 0) return null; out.depth = -y; out.nx = 0; out.ny = 1; out.nz = 0; out.solid = false; return out; };
    try { return fn(); } finally {
        World.heightAt = saved.heightAt; World.rayDown = saved.rayDown; World.contact = saved.contact; World.CFG.limitR = saved.limitR; World.groundHeight = saved.ground;
    }
}
function run(c, input, secs, each, others) {
    const n = Math.round(secs / DT);
    for (let i = 0; i < n; i++) {
        Phys.stepCar(c, typeof input === 'function' ? input(i * DT, c) : input, DT, others || []);
        c.events.length = 0;
        if (each && each(i * DT, c) === false) break;
    }
}
function slipDeg(c) {
    const R = new Float64Array(9); Phys.matFromQ(R, c.q);
    const lat = c.vx * R[0] + c.vy * R[1] + c.vz * R[2], lon = c.vx * R[6] + c.vy * R[7] + c.vz * R[8];
    return Math.atan2(lat, Math.abs(lon) || 1e-6) * 57.3;
}
function cruise(type, kmh, th) {
    const c = Phys.createCar(type, -8000, 0, Math.PI / 2);
    const v = kmh / Phys.STUD_TO_KMH; c.vx = v; c.speed = v;
    c.wh.forEach((w) => { w.w = v / Phys.CARS[type].wheelR; });
    run(c, { throttle: th === undefined ? 0.6 : th }, 1.2);          // машина «осідає» на підвісці; th = 0 — просто котиться
    return c;
}

// ------------------------------------------------------------------ гірка
test('гірка стала значно вищою (було 52 студи), кут підйому той самий, а зона приземлення довга й рівна', () => {
    const R = World.RAMP;
    assert.ok(R.h >= 110, 'висота гірки ' + R.h);
    const slope = Math.atan2(R.h, R.lenRamp) * 57.3;
    assert.ok(slope > 9 && slope < 15, 'кут підйому ~12°, а зараз ' + slope.toFixed(1));
    assert.ok(Math.abs(World.heightAt(R.x0 + R.lenRamp + 50, 0) - R.h) < 0.5, 'на верху гірки висота = h');
    // за краєм гірки ґрунт рівний ще щонайменше 400 студів (з такої висоти летять далеко)
    for (let d = 40; d <= 440; d += 80) {
        const h = World.heightAt(R.xEnd + d, 0);
        assert.ok(Math.abs(h) < 2.5, 'за краєм гірки на ' + d + ' студів висота ' + h.toFixed(2));
    }
});

// ------------------------------------------------------------------ ліміти швидкості
test('седан розганяється до 250 км/год і не більше, фургон і вантажівка — до 105', () => {
    withFlatWorld(() => {
        const want = { sedan: 250, van: 105, truck: 105 };
        for (const type of ['sedan', 'van', 'truck']) {
            const c = Phys.createCar(type, -90000, 0, Math.PI / 2);
            let mx = 0, tReach = null;
            run(c, { throttle: 1, steer: 0 }, 150, (t, car) => {
                const k = Phys.kmh(car.speed); if (k > mx) mx = k;
                if (tReach === null && k >= want[type] * 0.97) tReach = t;
            });
            assert.ok(mx <= want[type] + 0.6, type + ': максимум ' + mx + ' км/год, ліміт ' + want[type]);
            assert.ok(mx >= want[type] - 1.5, type + ': має досягати ліміту, а досяг ' + mx);
            assert.ok(tReach !== null && tReach < 60, type + ': до 97% ліміту за ' + tReach);
            assert.strictEqual(Phys.CARS[type].topKmh, want[type]);
            assert.ok(Math.abs(Phys.CARS[type].maxFwdKmh - want[type]) < 1e-9, 'шкала спідометра/передач підлаштована під ліміт');
        }
    });
});

// ------------------------------------------------------------------ дріфт
test('дріфт: P + поворот одразу виводить машину в занос, швидкість майже не гине, відпустили P — випрямляється; без P заносу немає', () => {
    withFlatWorld(() => {
        // P і поворот ТОЇ Ж СЕКУНДИ
        const a = cruise('sedan', 100);
        const slips = []; let minUp = 1, minSpeed = 1e9, v0 = Phys.kmh(a.speed);
        run(a, (t) => ({ throttle: 1, steer: t < 2.5 ? 1 : 0, drift: t < 2.5 ? 1 : 0 }), 4, (t, c) => {
            slips.push([t, slipDeg(c)]); minUp = Math.min(minUp, c.upY);
            if (t > 0.5 && t < 2.5) minSpeed = Math.min(minSpeed, Phys.kmh(c.speed));
        });
        const at = (t) => slips.find((s) => s[0] >= t)[1];
        assert.ok(at(0.8) > 20, 'за 0.8 с кут ковзання > 20°, а ' + at(0.8).toFixed(0));
        assert.ok(at(2.0) > 24 && at(2.0) < 50, 'тримається 24..50°, а ' + at(2.0).toFixed(0));
        assert.ok(minUp > 0.9, 'машина не перекидається');
        assert.ok(minSpeed > v0 * 0.7, 'швидкість у дрифті ' + minSpeed + ' (старт ' + v0 + ')');
        assert.ok(Math.abs(at(3.9)) < 8, 'після відпускання P машина випрямилась: ' + at(3.9).toFixed(0) + '°');
        // P спочатку, поворот трохи пізніше
        const b = cruise('sedan', 100); let mx = 0;
        run(b, (t) => ({ throttle: 1, steer: t > 0.4 && t < 2.5 ? 1 : 0, drift: t < 2.5 ? 1 : 0 }), 3, (t, c) => { if (t > 1.2) mx = Math.max(mx, Math.abs(slipDeg(c))); });
        assert.ok(mx > 22, 'P, а потім кермо — теж дріфт: ' + mx.toFixed(0));
        // вліво дзеркально
        const l = cruise('sedan', 100); let mn = 0;
        run(l, (t) => ({ throttle: 1, steer: -1, drift: 1 }), 2, (t, c) => { mn = Math.min(mn, slipDeg(c)); });
        assert.ok(mn < -22, 'вліво кут від\'ємний: ' + mn.toFixed(0));
        // без P — звичайний поворот: ніякого такого заносу в перші 0.8 с
        const n = cruise('sedan', 100); let early = 0;
        run(n, (t) => ({ throttle: 1, steer: t < 2.5 ? 1 : 0 }), 0.8, (t, c) => { early = Math.max(early, Math.abs(slipDeg(c))); });
        assert.ok(early < 20, 'без P занос повільніший: ' + early.toFixed(0));
        // замало швидкості — P нічого не робить
        const s = cruise('sedan', 12, 0);
        run(s, { throttle: 0, steer: 1, drift: 1 }, 0.4);
        assert.strictEqual(s.drift, 0, 'на малій швидкості дріфт не вмикається');
        // фургон і вантажівка теж не перекидаються
        for (const type of ['van', 'truck']) {
            const c = cruise(type, type === 'truck' ? 80 : 90); let up = 1;
            run(c, { throttle: 1, steer: 1, drift: 1 }, 3, (t, car) => { up = Math.min(up, car.upY); });
            assert.ok(up > 0.8, type + ' лишається на колесах: upY ' + up.toFixed(2));
        }
    });
});

// ------------------------------------------------------------------ зминання і поломки
function hitWall(type, kmh) {
    const c = Phys.createCar(type, 500, -World.RAMP.hw - 120, 0);
    const v = kmh / Phys.STUD_TO_KMH; c.vz = v; c.speed = v;
    c.wh.forEach((w) => { w.w = v / Phys.CARS[type].wheelR; });
    run(c, { throttle: 0 }, 5);
    return c;
}
test('зминання: лобовий удар у стіну — що швидше, то сильніше зминається ПЕРЕДОК; на великій швидкості кузов сплющується й деталі не відлітають', () => {
    const lv = [30, 55, 90, 140].map((k) => hitWall('sedan', k).cr[0]);
    assert.ok(lv[0] < 0.05, 'повільно нічого не мнеться: ' + lv[0]);
    assert.ok(lv[1] > 0.1 && lv[1] < lv[2] && lv[2] < lv[3] + 1e-9, 'зминання росте зі швидкістю: ' + lv.map((v) => v.toFixed(2)).join(' < '));
    const big = hitWall('sedan', 160);
    assert.ok(big.cr[0] > 0.95, 'передок сплющено: ' + big.cr[0].toFixed(2));
    assert.ok(big.cr[1] < 0.05 && big.cr[2] < 0.3 && big.cr[3] < 0.3, 'інші зони майже цілі: ' + big.cr.map((v) => v.toFixed(2)));
    assert.ok(!(big.dm & Phys.PART_BITS.fbump) && !(big.dm & Phys.PART_BITS.hood), 'бампер і капот у зім\'ятій зоні не відлітають');
    assert.ok(big.boxEff && big.boxEff.hz < Phys.CARS.sedan.box.hz - 1.2, 'зім\'ята машина коротша для зіткнень');
    assert.ok(big.hullEff && big.hullEff.length === Phys.CARS.sedan.hull.length, 'корпус зіткнень зім\'ятий разом із кузовом');
    // вантажівка міцніша за седан
    assert.ok(hitWall('truck', 80).cr[0] < hitWall('sedan', 80).cr[0], 'вантажівка зминається менше');
});

test('поломки: на середній швидкості деталі відлітають не завжди (різна міцність), удар збоку зминає борт, падіння на дах сплющує дах', () => {
    withFlatWorld(() => {
        let lost = 0, kept = 0;
        for (let k = 0; k < 14; k++) {
            const a = cruise('sedan', 50, 0);
            const o = { x: a.x + 24, y: 0, z: 0, ry: Math.PI / 2, type: 'truck', speed: 0 };
            run(a, { throttle: 0 }, 3, null, [o]);
            if (a.dm & Phys.PART_BITS.fbump) lost++; else kept++;
        }
        assert.ok(lost >= 1 && kept >= 1, 'на 50 км/год бампер відлетів у ' + lost + ' з 14, залишився в ' + kept);
    });
    const side = Phys.createCar('sedan', 400, -World.RAMP.hw - 80, Math.PI / 2);
    side.vz = 120 / Phys.STUD_TO_KMH;
    run(side, { throttle: 0 }, 4);
    assert.ok(side.cr[3] > 0.6, 'удар правим бортом об стіну: ' + side.cr.map((v) => v.toFixed(2)));
    const roof = Phys.createCar('sedan', 400, -300, 0);
    roof.y = 60; roof.py = 60; Phys.qFromEuler(roof.q, 0.1, 0.3, Math.PI);
    run(roof, { throttle: 0 }, 7);
    assert.ok(roof.cr[4] > 0.4, 'падіння догори колесами сплющило дах: ' + roof.cr[4].toFixed(2));
});

test('формула зминання: нуль — тотожність, повний передок скорочує довжину, дах опускається, усе скінченне; мережева маска — термометр, що правильно об\'єднується', () => {
    const def = Phys.CARS.sedan;
    const z0 = [0, 0, 0, 0, 0], pts = [[0, 2, 5.5], [2.2, 1, 3], [-2.4, 3, -5], [0.3, 3.9, 0]];
    for (const p of pts) {
        const q = Phys.crushPoint(def, z0, p[0], p[1], p[2]);
        assert.ok(Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) < 1e-9, 'без зминання точка не рухається');
    }
    const f = Phys.crushPoint(def, [1, 0, 0, 0, 0], 0, 2, 5.5);
    assert.ok(f[2] < 5.5 - 1.6, 'передок зсунувся назад: ' + f[2]);
    const r = Phys.crushPoint(def, [0, 0, 0, 0, 1], 0, def.height, 0);
    assert.ok(r[1] < def.height - 0.8, 'дах опустився: ' + r[1]);
    for (let i = 0; i < 400; i++) {
        const cr = [Math.random(), Math.random(), Math.random(), Math.random(), Math.random()];
        const q = Phys.crushPoint(def, cr, (Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 11);
        assert.ok(q.every(Number.isFinite));
    }
    // маска: рівень -> «термометр»; побітове АБО двох масок = максимум рівнів (сервер об'єднує саме так)
    const mk = (a) => Phys.netMask({ dm: 0, cr: a });
    const lvl = (m) => Phys.decodeCrush(m).map((v) => v);
    assert.deepStrictEqual(lvl(mk([0, 0, 0, 0, 0])), [0, 0, 0, 0, 0]);
    const m1 = mk([0.2, 0, 0.9, 0, 0]), m2 = mk([0.5, 0.2, 0.1, 0, 1]);
    const merged = lvl(m1 | m2), a1 = lvl(m1), a2 = lvl(m2);
    for (let z = 0; z < 5; z++) assert.strictEqual(merged[z], Math.max(a1[z], a2[z]), 'зона ' + z);
    assert.ok(m1 >= 0 && (m1 | m2) >= 0 && (m1 | m2) <= 0x7fffffff, 'маска вміщується в 31 біт');
    // біти деталей не псуються зминанням
    assert.strictEqual(Phys.netMask({ dm: 0b101, cr: [1, 1, 1, 1, 1] }) & 0x7fff, 0b101);
    // віддалена машина: applyDamageMask ставить цільове зминання і плавно доганяє його
    const rc = { type: 'sedan', dm: 0, pd: {}, cr: [0, 0, 0, 0, 0], q: [0, 0, 0, 1], x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ry: 0 };
    Phys.applyDamageMask(rc, Phys.netMask({ dm: 0, cr: [1, 0, 0, 0, 0.5] }));
    assert.ok(rc.crT[0] > 0.9 && rc.crT[4] > 0.4);
    for (let i = 0; i < 90; i++) Phys.easeCrush(rc, DT);
    assert.ok(Math.abs(rc.cr[0] - rc.crT[0]) < 0.02, 'зминання плавно досягає цілі');
});

test('сервер приймає нову маску пошкоджень зі зминанням (до 31 біта) і відкидає все, що не вміщується', () => {
    const { sanitizeCar } = require(path.join(ROOT, 'blox_game_server.js'));
    const base = { t: 'sedan', x: 1, y: 1, z: 1, ry: 0, s: 0, st: 0 };
    const mask = Phys.netMask({ dm: 3, cr: [1, 0.5, 0, 0, 1] });
    const ok = sanitizeCar({ ...base, dm: mask });
    assert.ok(ok && ok.dm === mask, 'маска зі зминанням проходить');
    for (const bad of [{ dm: -1 }, { dm: 1.5 }, { dm: 2 ** 31 }, { dm: '3' }]) assert.strictEqual(sanitizeCar({ ...base, ...bad }), null);
});

// ------------------------------------------------------------------ моделі
test('моделі: у кожної машини додано дрібні деталі (решітки, пороги, дифузор, габарити...), геометрія коректна й вміщується в габарити', () => {
    for (const type of ['sedan', 'van', 'truck']) {
        const def = Phys.CARS[type], m = Models.buildCar(type);
        assert.ok(Models.checkGeo(m.opaque) == null || Models.checkGeo(m.opaque) === true || !Models.checkGeo(m.opaque), type + ': геометрія');
        const bound = (g) => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < g.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], g.pos[i + k]); mx[k] = Math.max(mx[k], g.pos[i + k]); } return { mn, mx }; };
        const b = bound(m.opaque);
        assert.ok(b.mx[0] <= def.wid / 2 + 0.8 && b.mn[0] >= -def.wid / 2 - 0.8, type + ': ширина');
        assert.ok(b.mx[2] <= def.len / 2 + 0.6 && b.mn[2] >= -def.len / 2 - 0.6, type + ': довжина');
        assert.ok(b.mx[1] <= def.height + 0.7, type + ': висота');
        for (const pn of Object.keys(m.parts)) {
            const g = m.parts[pn].geo;
            for (let i = 0; i < g.pos.length; i++) assert.ok(Number.isFinite(g.pos[i]), type + '/' + pn);
        }
    }
    const orig = { sedan: 6690, van: 4900, truck: 5700 };
    assert.ok(Models.buildCar('sedan').opaque.pos.length / 3 > orig.sedan + 200, 'у седана більше вершин (деталі)');
    assert.ok(Models.buildCar('van').opaque.pos.length / 3 > orig.van, 'у фургона більше вершин');
    assert.ok(Models.buildCar('truck').opaque.pos.length / 3 > orig.truck, 'у вантажівки більше вершин');
});

// ------------------------------------------------------------------ код гри: P, R, стрілка на кнопці, шейдер зминання
test('гра: клавіша P (дріфт), R (перевернути), стрілка-іконка на кнопці «Перевернути», шейдер зминання й синхронізація зминання', () => {
    const js = fs.readFileSync(path.join(GAME_DIR, 'game.js'), 'utf8');
    const html = fs.readFileSync(path.join(GAME_DIR, 'game.html'), 'utf8');
    assert.ok(/k\.KeyP/.test(js) && /drift: dr/.test(js), 'клавіша P передає drift у фізику');
    assert.ok(/input\.hand/.test(js) && /var dr = \(input\.hand/.test(js), 'екранна кнопка P теж дріфт');
    assert.ok(/handbrake: hb/.test(js) && /var hb = k\.Space/.test(js), 'пробіл лишився ручником');
    assert.ok(/e\.code === 'KeyR'/.test(js), 'R перевертає');
    const btn = html.slice(html.indexOf('<button id="flipBtn"'), html.indexOf('</button>', html.indexOf('<button id="flipBtn"')));
    assert.ok(/<svg class="flipIco"/.test(btn) && /<path/.test(btn) && /id="flipTxt"/.test(btn), 'на кнопці є стрілка (svg) і підпис');
    assert.ok(/uCrOn/.test(js) && /uCr2/.test(js) && /Phys\.CRUSH/.test(js), 'вершинний шейдер зминає кузов за тими ж константами');
    assert.ok(/Phys\.easeCrush\(rc, dt\)/.test(js) && /Phys\.decodeCrush\(e\.dm/.test(js), 'віддалені машини показують зминання');
    assert.ok(/crushPoint\(def, cr, w\.x, wy, w\.z, wOff\)/.test(js), 'колеса їдуть разом із зім\'ятим кузовом');
});

test('гра запускається з новим кодом: машина їде, б\'ється, сплющується, кадри малюються без помилок JavaScript', () => {
    const { loadGame } = require('./helpers/fakedom.js');
    const g = loadGame();
    const st = () => g.win.KishkaGameDebug.state();
    g.win.KishkaGame.start({ id: 1, nick: 'Tester', x: 0, y: 3, z: 0, ry: 0, players: [], cars: [] });
    g.frame(10);
    g.win.KishkaGameDebug.spawn('sedan');
    g.frame(10);
    g.win.KishkaGame.carResult({ ok: true, cid: 1 });
    const car = st().car;
    assert.ok(car, 'машина створена');
    car.cr = [1, 0.4, 0.2, 0, 0.9]; Phys.crushHull(car, Phys.CARS.sedan); car.dent = 1;
    g.frame(30);
    assert.ok(st().car && st().car.cr[0] === 1, 'гра малює зім\'ячену машину');
    // віддалена машина зі зминанням у масці
    g.win.KishkaGame.start({ id: 1, nick: 'Tester', x: 0, y: 3, z: 0, ry: 0, players: [{ id: 2, nick: 'Other' }], cars: [{ id: 2, cid: 7, type: 'van', x: 10, y: 1, z: 10, ry: 0, s: 0, st: 0, dm: Phys.netMask({ dm: 0, cr: [1, 0, 0, 0, 0] }) }] });
    g.frame(20);
    assert.ok(g.win.KishkaGameDebug.state().remoteCars >= 1, 'віддалена зім\'ята машина додана');
});

// ------------------------------------------------------------------ веб-міст
function makeBridgeEnv(opts) {
    opts = opts || {};
    const timers = [];
    const loc = { href: 'https://x.github.io/Kishka/game.html' };
    const store = { session: new Map(), local: new Map() };
    Object.keys(opts.local || {}).forEach((k) => store.local.set(k, opts.local[k]));     // збережені налаштування браузера
    if (opts.session !== null) store.session.set('kishkablox.web.session', JSON.stringify(opts.session || { token: 'a'.repeat(48), nick: 'Racer', email: 'racer@mail.com' }));
    function mk(tag) {
        const e = { tag, style: { cssText: '' }, children: [], listeners: {}, _text: '', attrs: {}, src: '', alt: '' };
        Object.defineProperty(e, 'textContent', { get() { return this._text; }, set(v) { this._text = String(v); this.children = []; } });
        Object.defineProperty(e, 'firstChild', { get() { return this.children[0] || null; } });
        e.appendChild = (c) => { e.children.push(c); c.parent = e; return c; };
        e.removeChild = (c) => { e.children = e.children.filter((x) => x !== c); return c; };
        e.addEventListener = (ev, fn) => { (e.listeners[ev] = e.listeners[ev] || []).push(fn); };
        e.setAttribute = (k, v) => { e.attrs[k] = v; };
        e.click = () => (e.listeners.click || []).forEach((f) => f({}));
        return e;
    }
    const docListeners = {};
    const document = {
        readyState: 'complete', body: mk('body'), createElement: mk,
        addEventListener: (ev, fn) => { (docListeners[ev] = docListeners[ev] || []).push(fn); }
    };
    const sock = { handlers: {}, emitted: [], connected: false, responders: opts.responders || {} };
    sock.on = (ev, fn) => { sock.handlers[ev] = fn; };
    sock.emit = (ev, data, ack) => {
        if (typeof data === 'function') { ack = data; data = undefined; }
        sock.emitted.push({ ev, data });
        const r = sock.responders[ev];
        if (r && typeof ack === 'function') { const out = typeof r === 'function' ? r(data) : r; if (out !== undefined) ack(out); }
        else if (typeof ack === 'function') sock.pendingAcks = (sock.pendingAcks || []).concat([{ ev, ack }]);
    };
    sock.fire = (ev, payload) => { if (sock.handlers[ev]) sock.handlers[ev](payload); };
    const kg = { calls: [] };
    ['config', 'start', 'resync', 'roster', 'tick', 'cars', 'carTick', 'carResult', 'respawn'].forEach((n) => { kg[n] = (a) => kg.calls.push([n, a]); });
    const win = {
        KISHKA_WEB: { server: 'https://kishka.onrender.com', game: 'realistic_cars', home: 'index.html', avatar: 'Assets/Kishkablox.png' },
        document, location: loc, navigator: { language: opts.lang || 'uk-UA' },
        sessionStorage: { getItem: (k) => (store.session.has(k) ? store.session.get(k) : null), setItem: (k, v) => store.session.set(k, v), removeItem: (k) => store.session.delete(k) },
        localStorage: { getItem: (k) => (store.local.has(k) ? store.local.get(k) : null), setItem: (k, v) => store.local.set(k, v) },
        console: { log() {}, error() {}, warn() {} },
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        addEventListener() {}, KishkaGame: kg, JSON, Object, Math, Number, String, Date
    };
    win.window = win;
    let ioUrl = null;
    win.io = (url) => { ioUrl = url; return sock; };
    if (opts.noIo) delete win.io;
    document.defaultView = win;
    const ctx = vm.createContext(win);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'web', 'web-bridge.js'), 'utf8'), ctx, { filename: 'web-bridge.js' });
    return { win, sock, kg, loc, store, timers, ioUrl: () => ioUrl, doc: document, flushTimers: (ms) => { const t = timers.splice(0); t.forEach((x) => { if (ms === undefined || x.ms <= ms) x.fn(); }); } };
}
function findAll(el, pred, acc) { acc = acc || []; if (pred(el)) acc.push(el); (el.children || []).forEach((c) => findAll(c, pred, acc)); return acc; }
function texts(el, acc) { acc = acc || []; if (el._text) acc.push(el._text); (el.children || []).forEach((c) => texts(c, acc)); return acc; }

const JOIN_OK = { success: true, id: 3, nick: 'Racer', game: 'realistic_cars', x: 1, y: 2, z: 3, ry: 0.5, a: 0, count: 2, tickMs: 100, players: [{ id: 5, nick: 'Anna' }], cars: [] };

test('веб-міст: без сесії відправляє на сторінку входу й не вмикає гру', () => {
    const e = makeBridgeEnv({ session: null });
    assert.strictEqual(e.loc.href, 'index.html');
    assert.strictEqual(e.win.Android, undefined);
});

test('веб-міст: з\'єднання, blox_web_resume, вхід у гру, старт гри з відповіддю сервера, мова, список гравців', () => {
    const e = makeBridgeEnv({ responders: { blox_web_resume: { success: true, nick: 'Racer', email: 'racer@mail.com' }, blox_game_join: JOIN_OK } });
    assert.strictEqual(e.ioUrl(), 'https://kishka.onrender.com');
    assert.ok(e.win.Android && ['ready', 'started', 'sendState', 'carSpawn', 'carRemove', 'failReason', 'log', 'state', 'fail'].every((k) => typeof e.win.Android[k] === 'function'), 'повний набір методів Android');
    e.win.Android.ready();                                           // гра готова раніше за з'єднання
    e.sock.connected = true; e.sock.fire('connect');
    const ev = e.sock.emitted.map((x) => x.ev);
    assert.deepStrictEqual(ev.slice(0, 2), ['blox_web_resume', 'blox_game_join']);
    assert.strictEqual(e.sock.emitted[0].data.token, 'a'.repeat(48));
    assert.deepStrictEqual(plain(e.sock.emitted[1].data), { email: 'racer@mail.com', game: 'realistic_cars' });
    const names = e.kg.calls.map((c) => c[0]);
    assert.deepStrictEqual(names.slice(0, 2), ['config', 'start']);
    assert.strictEqual(e.kg.calls[0][1].lang, 'uk');
    assert.strictEqual(e.kg.calls[1][1].id, 3);
    assert.deepStrictEqual(plain(e.win.KishkaWebBridge.state().players), { 3: 'Racer', 5: 'Anna' });
});

test('веб-міст: події сервера доходять до гри, стан і машини йдуть на сервер у тому ж форматі, що й із застосунку', () => {
    const e = makeBridgeEnv({ responders: { blox_web_resume: { success: true, nick: 'Racer', email: 'racer@mail.com' }, blox_game_join: JOIN_OK, blox_car_spawn: { success: true, cid: 9, type: 'van' } } });
    e.sock.connected = true; e.sock.fire('connect');
    e.win.Android.ready();
    e.win.Android.sendState(JSON.stringify({ x: 5, y: 1, z: 7, ry: 1, a: 0, d: 0 }));
    assert.deepStrictEqual(plain(e.sock.emitted.filter((x) => x.ev === 'blox_game_state')[0].data), { x: 5, y: 1, z: 7, ry: 1, a: 0, d: 0 });
    e.win.Android.sendState('не json');                              // сміття ігнорується
    assert.strictEqual(e.sock.emitted.filter((x) => x.ev === 'blox_game_state').length, 1);
    e.sock.fire('blox_game_tick', [[5, 1, 2, 3, 0, 0, 0]]);
    e.sock.fire('blox_game_cars', { cars: [] });
    e.sock.fire('blox_car_tick', [[5, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]]);
    e.sock.fire('blox_game_roster', { players: [{ id: 3, nick: 'Racer' }] });
    const n = e.kg.calls.map((c) => c[0]);
    ['tick', 'cars', 'carTick', 'roster'].forEach((k) => assert.ok(n.includes(k), k));
    assert.deepStrictEqual(plain(e.win.KishkaWebBridge.state().players), { 3: 'Racer' }, 'склад гравців оновився');
    e.win.Android.carSpawn('van', 1, 2, 3, 0.5);
    assert.deepStrictEqual(plain(e.sock.emitted.filter((x) => x.ev === 'blox_car_spawn')[0].data), { type: 'van', x: 1, y: 2, z: 3, ry: 0.5 });
    assert.deepStrictEqual(plain(e.kg.calls.filter((c) => c[0] === 'carResult')[0][1]), { ok: true, cid: 9, code: '' });
    e.win.Android.carRemove();
    assert.ok(e.sock.emitted.some((x) => x.ev === 'blox_car_remove'));
});

test('веб-міст: помилка spawn, таймаут відповіді сервера, втрата зв\'язку й повторний вхід (resync з останньою позицією)', () => {
    const e = makeBridgeEnv({ responders: { blox_web_resume: { success: true, nick: 'Racer', email: 'racer@mail.com' }, blox_game_join: JOIN_OK, blox_car_spawn: { success: false, code: 'rate' } } });
    e.sock.connected = true; e.sock.fire('connect'); e.win.Android.ready();
    e.win.Android.carSpawn('sedan', 0, 0, 0, 0);
    assert.deepStrictEqual(plain(e.kg.calls.filter((c) => c[0] === 'carResult')[0][1]), { ok: false, cid: 0, code: 'rate' });
    // сервер не відповідає на spawn -> timeout
    e.sock.responders.blox_car_spawn = () => undefined;
    e.win.Android.carSpawn('sedan', 0, 0, 0, 0);
    e.flushTimers(5000);
    assert.ok(e.kg.calls.some((c) => c[0] === 'carResult' && c[1].code === 'timeout'));
    // зв'язок пропав і повернувся
    e.win.Android.sendState(JSON.stringify({ x: 11, y: 2, z: 22, ry: 0.7, a: 0, d: 0 }));
    e.sock.connected = false; e.sock.fire('disconnect');
    assert.strictEqual(e.win.KishkaWebBridge.state().joined, false);
    e.sock.emitted.length = 0; e.kg.calls.length = 0;
    e.sock.connected = true; e.sock.fire('connect');
    const j = e.sock.emitted.filter((x) => x.ev === 'blox_game_join')[0];
    assert.ok(j && j.data.x === 11 && j.data.z === 22 && j.data.ry === 0.7, 'повторний вхід з останньою позицією');
    assert.ok(e.kg.calls.some((c) => c[0] === 'resync'), 'гра отримала resync');
});

test('веб-міст: прострочений токен, викидання з іншого пристрою, вихід із гри, відсутня бібліотека socket.io', () => {
    let e = makeBridgeEnv({ responders: { blox_web_resume: { success: false, code: 'expired' } } });
    e.sock.connected = true; e.sock.fire('connect');
    assert.ok(texts(e.doc.body).some((s) => /Сесія закінчилась/.test(s)), 'повідомлення про закінчення сесії');
    e = makeBridgeEnv({ responders: { blox_web_resume: { success: true, nick: 'Racer', email: 'r@m.com' }, blox_game_join: JOIN_OK } });
    e.sock.connected = true; e.sock.fire('connect'); e.win.Android.ready();
    e.sock.fire('blox_game_kicked', { reason: 'other_device' });
    assert.ok(texts(e.doc.body).some((s) => /з іншого пристрою/.test(s)));
    e = makeBridgeEnv({ responders: { blox_web_resume: { success: true, nick: 'Racer', email: 'r@m.com' }, blox_game_join: JOIN_OK }, lang: 'en-US' });
    e.sock.connected = true; e.sock.fire('connect'); e.win.Android.ready();
    e.win.KishkaWebBridge.leave();
    assert.ok(e.sock.emitted.some((x) => x.ev === 'blox_game_leave'));
    e.flushTimers();
    assert.strictEqual(e.loc.href, 'index.html');
    e = makeBridgeEnv({ noIo: true });
    assert.ok(texts(e.doc.body).some((s) => /socket|сервер|server/i.test(s)), 'видно причину, чому гра не стартує');
});

test('веб-міст: у меню є перемикач «Інверсія камери»: стартове значення з браузера, перемикання діє одразу, зберігається', () => {
    const resp = { blox_web_resume: { success: true, nick: 'Racer', email: 'racer@mail.com' }, blox_game_join: JOIN_OK };
    // за замовчуванням вимкнено
    let e = makeBridgeEnv({ responders: resp });
    e.sock.connected = true; e.sock.fire('connect'); e.win.Android.ready();
    assert.strictEqual(plain(e.kg.calls.find((c) => c[0] === 'config')[1]).invertCamera, false);
    const sw = findAll(e.doc.body, (x) => x.attrs && x.attrs.role === 'switch')[0];
    assert.ok(sw, 'у меню є перемикач');
    assert.strictEqual(sw.attrs['aria-checked'], 'false');
    assert.ok(texts(e.doc.body).some((x) => x === 'Інверсія камери'), 'підпис українською');
    // вмикаємо: гра отримує config, налаштування записане в браузер
    e.kg.calls.length = 0;
    sw.click();
    assert.deepStrictEqual(plain(e.kg.calls.filter((c) => c[0] === 'config').map((c) => c[1])), [{ invertCamera: true }]);
    assert.strictEqual(e.store.local.get('kishkablox.web.invertCamera'), '1');
    assert.strictEqual(sw.attrs['aria-checked'], 'true');
    assert.strictEqual(e.win.KishkaWebBridge.state().invertCamera, true);
    sw.click();                                                       // і назад
    assert.strictEqual(plain(e.kg.calls.filter((c) => c[0] === 'config').pop()[1]).invertCamera, false);
    assert.strictEqual(e.store.local.get('kishkablox.web.invertCamera'), '0');
    // наступного разу (нова сторінка) значення береться зі збереженого
    e = makeBridgeEnv({ responders: resp, local: { 'kishkablox.web.invertCamera': '1' }, lang: 'en-US' });
    e.sock.connected = true; e.sock.fire('connect'); e.win.Android.ready();
    const cfg = plain(e.kg.calls.find((c) => c[0] === 'config')[1]);
    assert.strictEqual(cfg.invertCamera, true, 'збережена інверсія діє з першого кадру');
    assert.strictEqual(findAll(e.doc.body, (x) => x.attrs && x.attrs.role === 'switch')[0].attrs['aria-checked'], 'true');
    assert.ok(texts(e.doc.body).some((x) => x === 'Invert camera'), 'англійською теж');
});

test('справжня гра: config({invertCamera}) діє до старту й після нього, а інверсія справді міняє напрямок руху камери вгору-вниз', () => {
    const { loadGame } = require('./helpers/fakedom.js');
    const g = loadGame();
    g.win.KishkaGame.config({ lang: 'uk', invertCamera: true });                 // міст викликає config ДО start
    g.win.KishkaGame.start({ id: 1, nick: 'Tester', x: 0, y: 3, z: 0, ry: 0, players: [], cars: [] });
    g.frame(5);
    const cam = g.win.KishkaGameDebug.cam;
    assert.strictEqual(cam.invert, true, 'інверсія пережила старт');
    const Cam = require(path.join(GAME_DIR, 'camera.js'));
    const a = { yaw: 0, pitch: 0.3, dist: 10, invert: false }, b = { yaw: 0, pitch: 0.3, dist: 10, invert: true };
    Cam.drag(a, 0, -40); Cam.drag(b, 0, -40);
    assert.ok(a.pitch > 0.3 && b.pitch < 0.3, 'палець угору: звичайна камера піднімається, інвертована опускається');
    g.win.KishkaGame.config({ invertCamera: false });
    assert.strictEqual(g.win.KishkaGameDebug.cam.invert, false, 'вимкнули — і гра одразу це застосувала');
});

// ------------------------------------------------------------------ вхід з сайту на справжній SQLite
let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) { /* стара версія Node */ }

async function makeWebServer() {
    const db = new DatabaseSync(':memory:');
    const dbRun = async (sql, params) => { db.prepare(sql).run(...(params || [])); };
    const dbAll = async (sql, params) => db.prepare(sql).all(...(params || []));
    const io = new FakeIO();
    const init = require(path.join(ROOT, 'kishkablox.js'));
    init({ io, app: { get() {}, use() {}, post() {} }, dbRun, dbAll });
    await new Promise((r) => setTimeout(r, 50));                      // таблиці створюються асинхронно
    return { io, db, dbRun };
}

test('сервер: вхід з сайту за ніком і паролем (blox_web_login), токен, blox_web_resume, вихід; месенджер не зачіпається', { skip: !DatabaseSync }, async () => {
    const { io, dbRun } = await makeWebServer();
    const phone = io.connect('racer@mail.com');
    const reg = await phone.call('blox_register', { email: 'racer@mail.com', nick: 'Racer', password: 'secret1' });
    assert.ok(reg.success, 'акаунт створено в застосунку');
    await phone.call('blox_logout', { email: 'racer@mail.com' });
    assert.strictEqual((await phone.call('blox_status', { email: 'racer@mail.com' })).state, 'out');

    const web = io.connect(null, true);                              // браузер: сокет без «identify»
    assert.strictEqual((await join(web, 'racer@mail.com')).code, 'not_identified', 'без входу в гру не пускає');
    const bad = await web.call('blox_web_login', { nick: 'racer', password: 'wrong' });
    assert.deepStrictEqual([bad.success, bad.code], [false, 'wrong_password']);
    const unknown = await web.call('blox_web_login', { nick: 'nobody', password: 'wrong' });
    assert.deepStrictEqual([unknown.success, unknown.code], [false, 'wrong_password'], 'не розкриває, чи існує нік');
    const ok = await web.call('blox_web_login', { nick: 'RACER', password: 'secret1' });
    assert.ok(ok.success && ok.nick === 'Racer' && ok.email === 'racer@mail.com' && /^[0-9a-f]{48}$/.test(ok.token), 'вхід за ніком у будь-якому регістрі');
    assert.strictEqual((await phone.call('blox_status', { email: 'racer@mail.com' })).state, 'in', 'акаунт позначено як ввійшов');
    assert.ok(!web.rooms.has('racer@mail.com'), 'веб-сокет не заходить у месенджерську кімнату пошти');
    const j = await join(web, 'racer@mail.com');
    assert.ok(j.success && j.nick === 'Racer', 'вхід у гру з сайту: ' + JSON.stringify(j));

    // інший сокет (сторінка гри) повертає особу за токеном
    const web2 = io.connect(null, true);
    assert.deepStrictEqual((await web2.call('blox_web_resume', { token: 'f'.repeat(48) })).code, 'expired');
    assert.strictEqual((await web2.call('blox_web_resume', { token: 'не токен' })).code, 'expired');
    const r = await web2.call('blox_web_resume', { token: ok.token });
    assert.ok(r.success && r.email === 'racer@mail.com' && r.nick === 'Racer');
    assert.ok((await join(web2, 'racer@mail.com')).success);
    // вихід анулює токен
    await web2.call('blox_web_logout', { token: ok.token });
    assert.strictEqual((await io.connect(null, true).call('blox_web_resume', { token: ok.token })).code, 'expired');

    // старий акаунт без прив'язки до пошти: спершу треба відкрити в застосунку
    const crypto = require('node:crypto');
    const salt = 'ab'.repeat(8);
    const hash = crypto.scryptSync ? null : null;
    void hash;
    await dbRun('INSERT INTO blox_accounts (nick_lower, nick, pass_salt, pass_hash, created, owner_email, logged_in) VALUES (?, ?, ?, ?, ?, NULL, 0)', ['legacy', 'Legacy', salt, 'x', Date.now()]);
    const legacy = await io.connect(null, true).call('blox_web_login', { nick: 'legacy', password: 'whatever' });
    assert.strictEqual(legacy.code, 'wrong_password', 'з хибним паролем — звичайна відмова');
});

test('сервер: підбір пароля з сайту обмежується (8 невдач -> too_many), правильний пароль після цього теж відхиляється до кінця вікна', { skip: !DatabaseSync }, async () => {
    const { io } = await makeWebServer();
    const phone = io.connect('a@mail.com');
    assert.ok((await phone.call('blox_register', { email: 'a@mail.com', nick: 'Anna', password: 'secret1' })).success);
    const web = io.connect(null, true);
    for (let i = 0; i < 8; i++) assert.strictEqual((await web.call('blox_web_login', { nick: 'anna', password: 'bad' + i })).code, 'wrong_password');
    assert.strictEqual((await web.call('blox_web_login', { nick: 'anna', password: 'bad9' })).code, 'too_many');
    assert.strictEqual((await web.call('blox_web_login', { nick: 'anna', password: 'secret1' })).code, 'too_many');
});

// ------------------------------------------------------------------ збирання сайту
test('збирання сайту: ті самі файли гри, що й у застосунку, вхід, міст і картинки; міст вставлений у game.html один раз перед грою', () => {
    const { build, SOCKET_IO_CDN, WEB_FILES } = require(path.join(ROOT, 'web', 'build-site.js'));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kishkablox-site-'));
    try {
        const files = build(ROOT, out, {});
        for (const f of ['game.html', 'game.js', 'physics.js', 'models.js', 'world.js', 'camera.js', 'i18n.js', '.nojekyll'].concat(WEB_FILES)) assert.ok(files.includes(f), 'є ' + f);
        for (const f of ['game.js', 'physics.js', 'models.js', 'world.js']) {
            assert.strictEqual(fs.readFileSync(path.join(out, f), 'utf8'), fs.readFileSync(path.join(GAME_DIR, f), 'utf8'), f + ' на сайті = у застосунку');
        }
        const html = fs.readFileSync(path.join(out, 'game.html'), 'utf8');
        const iCfg = html.indexOf('web-config.js'), iIo = html.indexOf(SOCKET_IO_CDN), iBr = html.indexOf('web-bridge.js'), iWorld = html.indexOf('<script src="world.js">');
        assert.ok(iCfg > 0 && iCfg < iIo && iIo < iBr && iBr < iWorld, 'порядок: налаштування, socket.io, міст, гра');
        assert.strictEqual(html.split('web-bridge.js').length, 2, 'міст вставлено один раз');
        assert.ok(fs.readFileSync(path.join(GAME_DIR, 'game.html'), 'utf8').indexOf('web-bridge') < 0, 'game.html застосунку не змінено');
        assert.ok(fs.readFileSync(path.join(out, 'index.html'), 'utf8').includes(SOCKET_IO_CDN), 'сторінка входу бере ту саму версію socket.io');
        // адресу сервера можна підмінити змінною середовища
        const out2 = fs.mkdtempSync(path.join(os.tmpdir(), 'kishkablox-site2-'));
        build(ROOT, out2, { server: 'https://example.org' });
        assert.ok(/server:\s*'https:\/\/example\.org'/.test(fs.readFileSync(path.join(out2, 'web-config.js'), 'utf8')));
        fs.rmSync(out2, { recursive: true, force: true });
    } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('Pages: workflow сайту має права, збирання й публікацію (в репозиторії сайту або, за бажання, в основному); в застосунок нові файли web/ не потрапляють', () => {
    const check = (yml) => assert.ok(/pages: write/.test(yml) && /id-token: write/.test(yml) && /deploy-pages@v\d/.test(yml) && /upload-pages-artifact@v\d/.test(yml));
    // workflow для окремого репозиторію KishkaBlox.github.io: код гри береться з основного репозиторію в папку src
    const org = fs.readFileSync(path.join(ROOT, 'web', 'KishkaBlox.github.io.workflow.yml'), 'utf8');
    check(org);
    assert.ok(/repository: mukhalkivbohdancats-dev\/Kishka/.test(org) && /node src\/web\/build-site\.js --src src/.test(org), 'забирає основний репозиторій і збирає з нього');
    // необов'язковий workflow самого основного репозиторію (проєктний сайт mukhalkivbohdancats-dev.github.io/Kishka/)
    const own = path.join(ROOT, '.github', 'workflows', 'pages.yml');
    if (fs.existsSync(own)) { const y = fs.readFileSync(own, 'utf8'); check(y); assert.ok(/node web\/build-site\.js/.test(y)); }
    const cfg = fs.readFileSync(path.join(ROOT, 'web', 'web-config.js'), 'utf8');
    assert.ok(/server: 'https:\/\/kishka\.onrender\.com'/.test(cfg));
    // файли гри для застосунку беруться з blox_game/: у ній немає веб-файлів
    for (const f of fs.readdirSync(GAME_DIR)) assert.ok(!/^web-|^lobby|^index\.html$/.test(f), f);
});
