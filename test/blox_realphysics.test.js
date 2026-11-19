// Перевірки нової реалістичної фізики KishkaBlox: велика об'ємна карта, гірка як на відео, відрив від землі будь-де,
// підвіска й шини, поломки при ударі, окремі уламки, повний поворот машини в протоколі: node --test
// Це перевірки логіки в Node; вони НЕ замінюють перевірку на реальному телефоні/планшеті.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const World = require('../blox_game/world.js');
const Phys = require('../blox_game/physics.js');
const Models = require('../blox_game/models.js');
const { setup, join, sleep, GAME } = require('./helpers/fakeio.js');
const { sanitizeCar, sanitizeState, kmhOf, BOUND_XZ } = require('../blox_game_server.js');


const DT = 1 / 60;
const GAME_DIR = path.join(__dirname, '..', 'blox_game');
const lane = (type, x, ry) => Phys.createCar(type, x, -110, ry === undefined ? Math.PI / 2 : ry);   // рівна смуга полігону вздовж +X
function run(c, input, secs, fn, others) {
    for (let i = 0; i < Math.round(secs / DT); i++) { Phys.stepCar(c, typeof input === 'function' ? input(i * DT, c) : input, DT, others); c.events.length = 0; if (fn && fn(i * DT, c) === false) break; }
}
const finite = (c) => ['x', 'y', 'z', 'vx', 'vy', 'vz', 'wx', 'wy', 'wz'].every((k) => Number.isFinite(c[k])) && c.q.every(Number.isFinite);

// ------------------------------------------------------------------ світ
test('карта: площа в 15 разів більша, об\'ємний рельєф (пагорби, долини, гори), без дерев і зайвих об\'єктів', () => {
    assert.ok(Math.abs((World.CFG.limitR / 640) ** 2 - 15) < 0.5, 'площа ×15: радіус ' + World.CFG.limitR);
    assert.ok(BOUND_XZ > World.CFG.limitR, 'сервер пускає на всю карту');
    let mn = 1e9, mx = -1e9, rough = 0, n = 0;
    for (let x = -2400; x <= 2400; x += 40) for (let z = -2400; z <= 2400; z += 40) {
        if (Math.hypot(x, z) > 2400) continue;
        const h = World.groundHeight(x, z);
        assert.ok(Number.isFinite(h));
        mn = Math.min(mn, h); mx = Math.max(mx, h);
        rough += Math.abs(World.groundHeight(x + 8, z) - h); n++;
    }
    assert.ok(mx - mn > 150, 'перепад висот ' + (mx - mn).toFixed(0));
    assert.ok(mn < -5, 'є долини й чаші');
    assert.ok(rough / n > 0.5, 'земля не пласка');
    assert.strictEqual(World.props.trees.length, 0);
    assert.strictEqual(World.obstacles.length, 0);
    // біля майданчика й гірки — рівний полігон (як у відео), майданчик посередині
    assert.deepStrictEqual([World.spawnPoint().x, World.spawnPoint().z], [0, 0]);
    for (let a = 0; a < 6.28; a += 0.5) assert.ok(Math.abs(World.heightAt(Math.cos(a) * 15, Math.sin(a) * 15) - World.CFG.platformH) < 0.02);
    for (let x = 200; x < 900; x += 50) assert.ok(Math.abs(World.groundHeight(x, 140)) < 0.2, 'рівний полігон');
});

test('карта: поверхня скрізь їздна — схили помірні на відстані до 1000 студів, а гори лише по краях', () => {
    let maxNear = 0;
    for (let a = 0; a < 360; a += 2) for (const R of [300, 600, 900]) {
        const n = World.groundNormal(R * Math.cos(a * Math.PI / 180), R * Math.sin(a * Math.PI / 180));
        maxNear = Math.max(maxNear, Math.sqrt(1 - n[1] * n[1]) / n[1]);
    }
    assert.ok(maxNear < 0.75, 'найкрутіший схил усередині карти ' + maxNear.toFixed(2));
    assert.ok(World.groundHeight(2400, 0) > 60 || World.groundHeight(0, 2400) > 60, 'гори по краю');
});

test('гірка як на відео: широка сіра плита з рівним підйомом, вертикальними стінами, плоским верхом і різким краєм', () => {
    const R = World.RAMP;
    assert.ok(R.hw >= 40, 'гірка широка: ' + (R.hw * 2));
    const slope = R.h / R.lenRamp;
    assert.ok(slope > 0.15 && slope < 0.3, 'кут підйому ~' + Math.round(Math.atan(slope) * 57.3) + '°');
    // рівний підйом без сходинок уздовж осі
    let maxStep = 0;
    for (let x = R.xs; x < R.x0 + R.lenRamp + 30; x += 0.5) maxStep = Math.max(maxStep, Math.abs(World.heightAt(x + 0.5, 0) - World.heightAt(x, 0)) / 0.5);
    assert.ok(maxStep < slope * 1.05, 'плавний підйом без уступів ' + maxStep.toFixed(3));
    assert.ok(World.heightAt(R.xs - 1, 0) < 0.5, 'біля землі гірка починається врівень');
    // плоский верх
    for (let x = R.x0 + R.lenRamp + 30; x < R.xEnd - 1; x += 20) assert.ok(Math.abs(World.heightAt(x, 10) - R.h) < 0.05, 'верх плоский');
    // вертикальні стіни збоку й різкий край у кінці
    assert.ok(World.heightAt(R.x0 + 200, R.hw - 0.5) > 30 && World.heightAt(R.x0 + 200, R.hw + 0.5) < 1, 'бічна стіна');
    assert.ok(World.heightAt(R.xEnd - 0.5, 0) > R.h - 0.1 && World.heightAt(R.xEnd + 0.5, 0) < 0.5, 'різкий край зверху');
    // тверде тіло: усередині гірки точка виштовхується
    const inside = World.contact(R.x0 + 200, 20, R.hw - 3);
    assert.ok(inside && inside.solid && inside.depth > 0, 'стіна тверда');
    // колір: гірка сіра (шейдер дає ту саму шахову плитку, що й траві)
    assert.ok(World.CFG.rampTile > 0 && World.CFG.tile > 0);
    const m = Models.buildRamp(World);
    assert.strictEqual(Models.checkGeo(m.top), '');
    assert.strictEqual(Models.checkGeo(m.walls), '');
    for (let i = 0; i < m.top.col.length; i += 3) assert.ok(Math.abs(m.top.col[i] - m.top.col[i + 1]) < 0.08, 'верх сірий');
    const game = fs.readFileSync(path.join(GAME_DIR, 'game.js'), 'utf8');
    assert.ok(/R\.checker\(true, World\.CFG\.rampTile\)/.test(game) && /R\.rampWalls/.test(game), 'гірка малюється шаховою плиткою');
});

// ------------------------------------------------------------------ фізика машини
test('фізика: машина стоїть на місці на пружинах без дрижання, на всіх типах', () => {
    for (const t of Phys.CAR_TYPES) {
        const c = lane(t, 60, 0.3);
        run(c, { throttle: 0 }, 6);
        assert.ok(finite(c));
        assert.ok(Math.hypot(c.vx, c.vy, c.vz) < 0.05, t + ' не повзе: ' + Math.hypot(c.vx, c.vy, c.vz));
        assert.ok(!c.air && c.nGround === Phys.CARS[t].nWheels, t + ' усі колеса на землі');
        assert.ok(Math.abs(c.pitch) < 0.05 && Math.abs(c.roll) < 0.05);
        const g = World.heightAt(c.x, c.z);
        assert.ok(Math.abs(c.y - g) < 0.2, t + ' на правильній висоті: ' + (c.y - g).toFixed(3));
    }
});

test('фізика: розгін, коробка передач, гальмування й поворот реалістичні; задній хід; швидкості за типом', () => {
    const top = {};
    for (const t of Phys.CAR_TYPES) {
        const c = lane(t, -30);
        let t100 = null, gears = new Set(), best = 0;
        run(c, { throttle: 1 }, 25, (tt, cc) => { const k = Phys.kmh(cc.speed); if (t100 === null && k >= 100) t100 = tt; gears.add(cc.gear); best = Math.max(best, k); });
        top[t] = best;
        assert.ok(gears.size >= 3, t + ' перемикає передачі: ' + [...gears]);
        assert.ok(best > 70 && best < 280, t + ' ' + best + ' км/год');
        if (t === 'sedan') assert.ok(t100 > 4 && t100 < 11, 'седан 0-100 за ' + t100.toFixed(1) + ' с');
    }
    assert.ok(top.sedan > top.van && top.van > top.truck, 'легка машина швидша за важку: ' + JSON.stringify(top));
    // гальмування зі 100 км/год: ~1 g на траві — шлях 30..70 м
    const c = lane('sedan', -30);
    const v0 = 100 / Phys.STUD_TO_KMH; c.vx = v0; c.speed = v0; c.wh.forEach((w) => { w.w = v0 / Phys.CARS.sedan.wheelR; });
    const x0 = c.x; run(c, { throttle: 0, brake: 1 }, 8);
    const dist = (c.x - x0) * Phys.S;
    assert.ok(dist > 28 && dist < 75, 'гальмівний шлях ' + dist.toFixed(0) + ' м');
    // задній хід має нижчу швидкість і вмикається після зупинки
    const r = lane('sedan', 0); run(r, { throttle: -1 }, 6);
    assert.ok(r.speed < -3 && r.gear === -1, 'їде назад: ' + r.speed.toFixed(1));
    assert.ok(-r.speed < Phys.CARS.sedan.maxFwd * 0.4);
    // поворот: рух по дузі, а не на місці
    const t2 = lane('sedan', -30); run(t2, (tt, cc) => ({ throttle: Phys.kmh(cc.speed) < 50 ? 0.7 : 0.3, steer: 0 }), 6);
    const y0 = t2.ry; run(t2, { throttle: 0.3, steer: 1 }, 2);
    assert.ok(y0 - t2.ry > 0.3, 'вправо — кут зменшується');
});

test('фізика: відрив від землі — на горбах і краях легко, а не в одному місці; у польоті машина зберігає обертання', () => {
    let air = 0, frames = 0, lifts = 0;
    for (let h = 0; h < 14; h++) {
        const c = Phys.createCar('sedan', 600 + h * 37, 800 - h * 53, h * 1.1 + 0.3);
        let was = false;
        run(c, (tt, cc) => ({ throttle: Phys.kmh(cc.speed) < 110 ? 1 : 0.15, steer: Math.sin(tt * 1.2 + h) * 0.3 }), 40, (tt, cc) => {
            frames++; if (cc.air) { air++; if (!was) lifts++; } was = cc.air;
            assert.ok(finite(cc));
        });
    }
    assert.ok(lifts >= 10, 'відривів від землі на пересіченій місцевості: ' + lifts);
    assert.ok(air / frames > 0.02, 'частка часу в повітрі ' + (air / frames * 100).toFixed(1) + '%');
});

test('гірка: машина заїжджає по схилу, на верху стоїть на землі, з краю злітає, летить за інерцією й приземляється на підвіску', () => {
    const c = Phys.createCar('sedan', 30, 0, Math.PI / 2);
    let climbed = false, topSpeed = 0, airFrames = 0, maxH = 0, landed = false, compressed = 0, wasAir = false, maxPitchStep = 0, pp = 0;
    run(c, { throttle: 1 }, 25, (t, cc) => {
        assert.ok(finite(cc));
        if (cc.x > 300 && cc.y > 25 && !cc.air) climbed = true;
        topSpeed = Math.max(topSpeed, cc.speed);
        if (cc.x < 400) { maxPitchStep = Math.max(maxPitchStep, Math.abs(cc.pitch - pp)); pp = cc.pitch; }
        if (cc.air) { airFrames++; maxH = Math.max(maxH, cc.y - World.heightAt(cc.x, cc.z)); }
        if (wasAir && !cc.air) landed = true;
        if (landed) compressed = Math.max(compressed, ...cc.wh.map((w) => Phys.CARS.sedan.suspRest - w.s));
        wasAir = cc.air;
        if (landed && t > 18) return false;
    });
    assert.ok(climbed, 'заїхала на верх гірки');
    assert.ok(maxPitchStep < 0.07, 'нахил змінюється плавно: ' + maxPitchStep.toFixed(3));
    assert.ok(airFrames > 20 && maxH > 10, 'злетіла з краю: ' + airFrames + ' кадрів, висота ' + maxH.toFixed(0));
    assert.ok(landed, 'приземлилась');
    assert.ok(compressed > 0.05, 'підвіска стиснулась при приземленні: ' + compressed.toFixed(2));
    for (let i = 0; i < 180; i++) Phys.stepCar(c, { throttle: 0 }, DT);
    assert.ok(finite(c) && c.y < 5, 'після польоту стоїть на землі');
});

test('гірка: бічна стіна тверда — машина не в\'їжджає в неї, а вдаряється; на схилі без газу не скочується', () => {
    const c = Phys.createCar('sedan', 300, -130, 0);       // їде вздовж +Z у бічну стіну (z = -60)
    const v0 = 80 / Phys.STUD_TO_KMH; c.vz = v0; c.speed = v0;
    run(c, { throttle: 0 }, 5);
    assert.ok(c.z < -World.RAMP.hw + 1, 'не проїхала крізь стіну: z=' + c.z.toFixed(1));
    assert.ok(c.dm > 0 || Phys.crushActive(c.cr), 'сильний удар зім\'яв кузов або відламав деталь');
    const s = Phys.createCar('sedan', 250, 0, Math.PI / 2);
    s.y = World.heightAt(250, 0) + 0.3; Phys.syncCOM(s, Phys.CARS.sedan);
    run(s, { throttle: 0 }, 8);
    assert.ok(Math.abs(s.x - 250) < 3, 'на схилі стоїть (утримання): зсув ' + (s.x - 250).toFixed(2));
});

test('фізика: різкий поворот на швидкості може перекинути, перекинуту машину можна поставити на колеса', () => {
    const c = Phys.createCar('sedan', 0, -120, Math.PI / 2);
    const v0 = 150 / Phys.STUD_TO_KMH; c.vx = v0; c.speed = v0; c.wh.forEach((w) => { w.w = v0 / Phys.CARS.sedan.wheelR; });
    let maxRoll = 0;
    run(c, (t) => ({ throttle: 0, steer: t < 1 ? 1 : 0, handbrake: t < 0.6 ? 1 : 0 }), 8, (t, cc) => { maxRoll = Math.max(maxRoll, Math.abs(cc.roll)); assert.ok(finite(cc)); });
    assert.ok(maxRoll > 0.4, 'сильно накренилась: ' + maxRoll.toFixed(2));
    // перекидаємо силоміць і перевіряємо кнопку «перевернути»
    const f = lane('sedan', 40, 0);
    Phys.qFromEuler(f.q, 0.5, 0, Math.PI); f.py += 2; f.wx = f.wy = f.wz = 0;
    run(f, { throttle: 0 }, 6);
    assert.ok(f.upY < 0.3, 'лежить на даху');
    assert.ok(f.flipped, 'нерухома перекинута машина показує кнопку «перевернути»');
    Phys.flipCar(f);
    run(f, { throttle: 0 }, 3);
    assert.ok(f.upY > 0.95 && !f.flipped && finite(f), 'знову на колесах');
});

test('машини: фізика не дає NaN і не провалює землю на випадкових діях (спротив збою)', () => {
    for (const t of Phys.CAR_TYPES) {
        const c = Phys.createCar(t, 100, -100, 1);
        run(c, (tt) => ({ throttle: Math.sin(tt * 0.8), steer: Math.sin(tt * 1.9), handbrake: (tt % 7 < 0.6) ? 1 : 0 }), 90, (tt, cc) => { assert.ok(finite(cc), t + ' ' + tt); assert.ok(cc.y > World.heightAt(cc.x, cc.z) - 6); });
    }
    const c = Phys.createCar('sedan', 0, 0, 0);
    Phys.stepCar(c, { throttle: NaN, steer: Infinity, brake: 'x' }, DT);
    assert.ok(finite(c));
    c.y = -1000; c.py = -1000; Phys.stepCar(c, { throttle: 0 }, DT);
    assert.ok(c.y > -50 && finite(c), 'повернуто з прірви');
});

// ------------------------------------------------------------------ зіткнення й поломки
test('машини торкаються: зіткнення відштовхує, не лишає великого перекриття й не пропускає крізь; чужа швидкість враховується', () => {
    const b = { x: -60, y: 0, z: -110, ry: Math.PI / 2, type: 'truck', speed: 0 };
    const a = lane('sedan', -100);
    let hit = false;
    run(a, { throttle: 1 }, 8, () => { if (a.hit) hit = true; const ov = Phys.overlapCars(a, Phys.CARS.sedan, b, Phys.CARS.truck); assert.ok(!ov || ov.depth < 1.6, 'перекриття лишається малим'); }, [b]);
    assert.ok(hit, 'зіткнення було');
    assert.ok(a.x < b.x - (Phys.CARS.sedan.len + Phys.CARS.truck.len) / 2 * 0.85, 'не проїхала крізь вантажівку');
    const far = lane('sedan', 0); assert.strictEqual(Phys.collideCars(far, [{ x: 80, y: 0, z: -110, ry: 0, type: 'van', speed: 0 }]), false);
    assert.strictEqual(Phys.collideCars(far, [{ x: far.x, y: far.y + 14, z: far.z, ry: 0, type: 'van', speed: 0 }]), false, 'одна над іншою — без зіткнення');
    // лобове зіткнення з рухомою машиною гасить швидкість
    const p = Phys.createCar('sedan', 0, -110, 0); p.vz = 40; p.speed = 40;
    assert.strictEqual(Phys.collideCars(p, [{ x: 0, y: p.y, z: 10.5 - 110, ry: Math.PI, type: 'sedan', vz: -40, speed: 40 }]), true);
    assert.ok(p.vz < 40, 'удар зменшив швидкість');
});

test('поломки: слабкий удар нічого не ламає, сильний відламує бампер, капот, двері, дзеркала, колеса — вони летять окремими тілами', () => {
    // слабкий: 10 км/год у нерухому машину
    const soft = lane('sedan', -100); soft.vx = 10 / Phys.STUD_TO_KMH; soft.speed = soft.vx;
    run(soft, { throttle: 0 }, 2, null, [{ x: -85, y: 0, z: -110, ry: Math.PI / 2, type: 'sedan', speed: 0 }]);
    assert.strictEqual(soft.dm, 0, 'слабкий удар не ламає');
    // середній удар (50 км/год у вантажівку): в одних машин бампер відлітає, в інших лишається (різна міцність деталей)
    const hitTruck = (kmh) => {
        Phys.clearDebris();
        const a = lane('sedan', -100); const v = kmh / Phys.STUD_TO_KMH; a.vx = v; a.speed = v; a.wh.forEach((w) => { w.w = v / Phys.CARS.sedan.wheelR; });
        run(a, { throttle: 0 }, 3, null, [{ x: -80, y: 0, z: -110, ry: Math.PI / 2, type: 'truck', speed: 0 }]);
        return a;
    };
    let lost = 0, kept = 0, debrisKept = null;
    for (let k = 0; k < 12; k++) {
        const a = hitTruck(50);
        if (a.dm & Phys.PART_BITS.fbump) { lost++; if (!debrisKept) debrisKept = Phys.debris.slice(); } else kept++;
    }
    assert.ok(lost >= 1, 'на 50 км/год бампер відлітає в частини машин: ' + lost + ' з 12');
    assert.ok(kept >= 1, 'а в частини тримається: ' + kept + ' з 12');
    assert.ok(debrisKept && debrisKept.length >= 1, 'є уламки');
    // сильний удар (120 км/год): передок СПЛЮЩУЄТЬСЯ, бампер і капот не відлітають, а лишаються зім'ятими на машині
    const big = hitTruck(120);
    assert.ok(big.cr[0] > 0.9, 'передок зім\'ятий: ' + big.cr[0].toFixed(2));
    assert.ok(!(big.dm & Phys.PART_BITS.fbump) && !(big.dm & Phys.PART_BITS.hood), 'у зім\'ятій зоні бампер і капот не відлітають');
    assert.ok(big.boxEff && big.boxEff.hz < Phys.CARS.sedan.box.hz - 1, 'габарит по довжині менший');
    Phys.debris.length = 0; debrisKept.forEach((q) => Phys.debris.push(q));      // уламки від середнього удару
    const d = Phys.debris[0];
    assert.ok(['fbump', 'hood', 'doorL', 'doorR', 'mirL', 'mirR', 'rbump', 'trunk', 'extra'].includes(d.part) || d.wheel);
    // уламок падає й лежить на землі
    for (let i = 0; i < 600; i++) Phys.stepDebris(DT);
    for (const q of Phys.debris) assert.ok(q.p[1] > World.heightAt(q.p[0], q.p[2]) - 1.5 && Number.isFinite(q.p[1]), 'уламок на землі');
    // віддалена машина: нова маска -> уламок, повторна та сама маска — нічого
    Phys.clearDebris();
    const rc = { type: 'van', x: 0, y: 0, z: -110, q: [0, 0, 0, 1], vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, dm: 0, pd: {}, speed: 0 };
    assert.ok(Phys.applyDamageMask(rc, Phys.PART_BITS.hood | Phys.PART_BITS.doorL) > 0);
    assert.strictEqual(Phys.debris.length, 2);
    assert.strictEqual(Phys.applyDamageMask(rc, rc.dm), 0);
    // відламане колесо: машина їде далі на трьох і не вилітає в NaN
    const w = lane('sedan', 40); w.dm |= 1 << Phys.WHEEL_BIT0;
    run(w, { throttle: 0.6 }, 5, (t, cc) => { assert.ok(finite(cc)); });
    assert.ok(w.speed > 3, 'їде на трьох колесах');
});

test('поломки: усі типи машин мають деталі, що відламуються, і відповідні моделі (бампери, капот, двері, дзеркала, спойлер/рейка/труба)', () => {
    for (const t of Phys.CAR_TYPES) {
        const m = Models.buildCar(t), def = Phys.CARS[t];
        for (const n of Phys.PART_NAMES) {
            assert.ok(m.parts[n], t + ' має модель деталі ' + n);
            assert.strictEqual(Models.checkGeo(m.parts[n].geo), '', t + '.' + n);
            assert.ok(m.parts[n].geo.pos.length > 0, t + '.' + n + ' не порожня');
            assert.ok(def.parts[n] && def.parts[n].hp > 0, t + ' фізика деталі ' + n);
        }
        assert.strictEqual(def.partList.filter((p) => p.wheel !== undefined).length, def.nWheels);
    }
});

// ------------------------------------------------------------------ моделі
test('моделі: суцільні кузови без стирчачих деталей, рельєф шматками з рівнями деталізації, персонаж справний', () => {
    const ch = Models.buildCharacter();
    for (const part of ['torso', 'head', 'upperArm', 'foreArm', 'thigh', 'shin']) assert.strictEqual(Models.checkGeo(ch.parts[part]), '', part);
    for (const t of Models.CAR_TYPES) {
        const m = Models.buildCar(t), def = Phys.CARS[t];
        for (const g of [m.opaque, m.glass, m.wheel]) assert.strictEqual(Models.checkGeo(g), '', t);
        assert.ok(m.opaque.pos.length / 3 > 2500, t + ' детальний кузов');
        // розміри моделі збігаються з фізикою: нічого не стирчить за габарити більше ніж на ~0.3 студа
        let mx = 0, mz = 0, top = 0;
        for (let i = 0; i < m.opaque.pos.length; i += 3) { mx = Math.max(mx, Math.abs(m.opaque.pos[i])); mz = Math.max(mz, Math.abs(m.opaque.pos[i + 2])); top = Math.max(top, m.opaque.pos[i + 1]); }
        assert.ok(mx <= def.wid / 2 + 0.6, t + ' ширина ' + mx.toFixed(2));
        assert.ok(mz <= def.len / 2 + 0.5, t + ' довжина ' + mz.toFixed(2));
        assert.ok(top <= def.height + 0.6, t + ' висота ' + top.toFixed(2));
        // колеса моделі збігаються з колесами фізики
        assert.strictEqual(m.wheelPos.length, def.nWheels);
        m.wheelPos.forEach((w, i) => { assert.ok(Math.abs(w.x - def.wheels[i].x) < 0.01 && Math.abs(w.z - def.wheels[i].z) < 0.01, t + ' колесо ' + i); });
    }
    // шматки рельєфу: різні рівні деталізації, спідниці проти щілин, на межі шматків висоти збігаються
    const lods = [0, 1, 2, 3].map((l) => Models.terrainChunk(World, 5, 3, l));
    for (let i = 1; i < 4; i++) assert.ok(lods[i].geo.pos.length < lods[i - 1].geo.pos.length, 'грубіший рівень має менше вершин');
    for (const c of lods) assert.strictEqual(Models.checkGeo(c.geo), '');
    const a = Models.terrainChunk(World, 2, 2, 0), b = Models.terrainChunk(World, 3, 2, 0);
    const edgeH = (c, x) => { const out = []; for (let i = 0; i < c.geo.pos.length; i += 3) if (Math.abs(c.geo.pos[i] - x) < 1e-6 && Math.abs(c.geo.pos[i + 2] - 2 * 160 - 40) < 1e-6) out.push(c.geo.pos[i + 1]); return out; };
    assert.ok(edgeH(a, 480).length > 0 && Math.abs(edgeH(a, 480)[0] - edgeH(b, 480)[0]) < 1e-6, 'шматки зшиваються без щілин');
    assert.strictEqual(Models.checkGeo(Models.buildDecals(World)), '');
    assert.strictEqual(Models.buildProps(World).idx.length, 0);
});

// ------------------------------------------------------------------ протокол сервера
test('сервер: стан машини з поворотом (q) і маскою деталей (dm) перевіряється й розсилається, старий формат теж працює', async () => {
    assert.strictEqual(kmhOf(100), Math.round(100 * Phys.STUD_TO_KMH));
    const base = { t: 'sedan', x: 1, y: 1, z: 1, ry: 0, s: 5, st: 0 };
    assert.deepStrictEqual(sanitizeCar(base).q, null);
    assert.strictEqual(sanitizeCar(base).dm, 0);
    const ok = sanitizeCar({ ...base, q: [0, 0.7071, 0, 0.7071], dm: 5 });
    assert.ok(ok && ok.q.length === 4 && ok.dm === 5);
    for (const bad of [{ q: [1, 2, 3] }, { q: [0, 0, 0, 0] }, { q: [NaN, 0, 0, 1] }, { q: 'x' }, { dm: -1 }, { dm: 1.5 }, { dm: 2 ** 31 }, { dm: '3' }]) {
        assert.strictEqual(sanitizeCar({ ...base, ...bad }), null, JSON.stringify(bad));
    }
    // уся карта допустима, а за нею — ні
    assert.ok(sanitizeState({ x: 2400, y: 150, z: 0, ry: 0 }) && sanitizeState({ x: 0, y: -40, z: -2400, ry: 0 }));
    assert.strictEqual(sanitizeState({ x: 2601, y: 0, z: 0, ry: 0 }), null);
    // розсилка
    const { io, game } = setup();
    const a = io.connect('a@x.com'), b = io.connect('b@x.com');
    const ra = await join(a, 'a@x.com'); await join(b, 'b@x.com');
    const r = await a.call('blox_car_spawn', { game: GAME, type: 'sedan', x: 5, y: 1, z: 5, ry: 0 });
    a.send('blox_game_state', { x: 6, y: 20, z: 7, ry: 0.5, a: 0, d: 1, c: { t: 'sedan', x: 6, y: 20, z: 7, ry: 0.5, s: 31.5, st: -0.2, q: [0, 0.2474, 0, 0.969], dm: 3 } });
    await sleep(40);
    const ct = b.events('blox_car_tick').flat().filter((t) => t[0] === ra.id).pop();
    assert.deepStrictEqual(ct.slice(0, 9), [ra.id, r.cid, 6, 20, 7, 0.5, 31.5, -0.2, kmhOf(31.5)]);
    assert.deepStrictEqual(ct.slice(9, 13), [0, 0.247, 0, 0.969]);
    assert.strictEqual(ct[13], 3);
    // маска лише додається: клієнт не може «відремонтувати» чужою підміною
    a.send('blox_game_state', { x: 6.5, y: 20, z: 7, ry: 0.5, a: 0, d: 1, c: { t: 'sedan', x: 6.5, y: 20, z: 7, ry: 0.5, s: 30, st: 0, q: [0, 0.2474, 0, 0.969], dm: 0 } });
    await sleep(40);
    assert.strictEqual(b.events('blox_car_tick').flat().filter((t) => t[0] === ra.id).pop()[13], 3);
    // новий гравець при вході отримує машину з уже відламаними деталями
    const c = io.connect('c@x.com');
    const rc = await join(c, 'c@x.com');
    assert.strictEqual(rc.cars[0].dm, 3);
    game.shutdown();
});

test('гра: вікно машин не залежить від CSS min()/clamp() (старі WebView), нові кнопки, терен шматками, уламки й поворот у пакетах', () => {
    const html = fs.readFileSync(path.join(GAME_DIR, 'game.html'), 'utf8');
    const js = fs.readFileSync(path.join(GAME_DIR, 'game.js'), 'utf8');
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/\bmin\(|\bclamp\(|aspect-ratio/.test(css), 'у CSS немає min()/clamp()/aspect-ratio');
    assert.ok(/#carsPanel \{[^}]*width: 84%[^}]*min-width: 560px/.test(css), 'вікно машин широке з мінімумом');
    assert.ok(/function layoutPanel/.test(js) && /style\.width = w \+ 'px'/.test(js), 'розмір вікна задається ще й у пікселях');
    assert.ok(/id="hand"/.test(html) && /id="flipBtn"/.test(html));
    assert.ok(/createTerrainStream/.test(js) && /Models\.terrainChunk/.test(js) && /drawDebris/.test(js) && /applyDamageMask/.test(js));
    assert.ok(/q: \[r3\(myCar\.q\[0\]\)/.test(js) && /dm: Phys\.netMask\(myCar\)/.test(js), 'клієнт шле поворот і маску деталей та зминання');
    assert.ok(/handbrake: hb/.test(js) && /stepCar\(myCar, \{ throttle: th, steer: st, handbrake: hb, drift: dr \}, h, otherCars\)/.test(js), 'зіткнення з чужими машинами й ручник');
});

test('Android: у грі зверху лишилась лише кнопка меню (без іконки людей і інших іконок)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app/src/main/java/com/kishka/messenger/Bloxmenu.kt'), 'utf8');
    const i = src.indexOf('fun BoxScope.BloxTopBar');
    assert.ok(i > 0);
    const body = src.slice(i, src.indexOf('\n}\n', i));
    assert.ok(!/Icons\.Filled\.People|Icons\.Default\.People|Icons\.Outlined\.People|Group|Person/.test(body), 'іконки людей немає');
    assert.ok(/Icons\.Default\.Menu|Icons\.Filled\.Menu/.test(body), 'іконка меню є');
    assert.ok(!/Kishkablox\.png|kishkablox/i.test(body), 'круглої кнопки-логотипа немає');
});

test('спідометр: нуль за замовчуванням, шкала 1 студ = 0.35 м, число збігається з реальним рухом, передачі', () => {
    assert.strictEqual(Phys.kmh(0), 0);
    assert.strictEqual(Phys.kmh(NaN), 0);
    assert.strictEqual(Phys.kmh(-50), Phys.kmh(50), 'задній хід теж показує швидкість');
    assert.strictEqual(Phys.kmh(100), Math.round(100 * 1.26));
    const c = lane('sedan', -30);
    assert.strictEqual(Phys.kmh(c.speed), 0);
    run(c, { throttle: 1 }, 3);
    assert.ok(Phys.kmh(c.speed) > 30, 'за 3 с набрали швидкість: ' + Phys.kmh(c.speed));
    const x0 = c.x, z0 = c.z, v0 = Phys.kmh(c.speed);
    run(c, { throttle: 0.2 }, 0.1);
    const dist = Math.hypot(c.x - x0, c.z - z0) / 0.1;
    assert.ok(Math.abs(dist * Phys.STUD_TO_KMH - v0) < v0 * 0.1, 'спідометр збігається з реальним рухом');
    assert.strictEqual(Phys.gearOf('sedan', 0), 0);
    assert.strictEqual(Phys.gearOf('sedan', -10), -1);
    assert.strictEqual(Phys.gearOf('sedan', 1000), Phys.CARS.sedan.gears);
});
