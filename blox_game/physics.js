// =====================================================================
// KishkaBlox — реалістична фізика персонажа й машин (чиста логіка без WebGL; працює в грі та в тестах Node).
// Залежить від world.js (KishkaWorld).
//
// МАШИНА — справжнє жорстке тіло в 3D (позиція, кватерніон, лінійна й кутова швидкість, тензор інерції):
//   • чотири (або шість) колеса на підвісці: промінь униз, пружина + амортизатор (різний на стиск і відбій),
//     обмежувачі ходу, стабілізатор поперечної стійкості;
//   • шини: проковзування по куту й по ковзанню колеса (модель типу Пацейки), коло тертя, залежність від матеріалу
//     поверхні (асфальт, бетон гірки, трава, земля), навантаження на колесо, блокування й пробуксовка;
//   • двигун із кривою моменту, автоматична коробка (D1..Dn й R), зчеплення, гальма, ручник, гальмування двигуном;
//   • аеродинаміка: опір, притиск, опір обертанню у повітрі;
//   • відрив від землі ВСЮДИ: щойно колеса втрачають контакт (горб, край гірки, схил) — машина летить за інерцією,
//     зберігає обертання, а при приземленні кузов б'ється об землю кутами й може перекинутися;
//   • зіткнення кузова з землею й твердою гіркою (14 точок корпуса), зіткнення машина—машина (SAT для орієнтованих
//     коробок, імпульси з тертям); сильний удар відламує деталі (бампер, капот, двері, дзеркала, колеса…),
//     які летять окремими тілами (уламки) і лежать на землі, поки не зникнуть.
// Усі розрахунки йдуть кроками ≤ 1/120 с — тож на слабкому телефоні машина не «пролітає» крізь землю.
//
// ОДИНИЦІ: позиції — студи, маса — кг, час — с. 1 студ = 0.35 м (персонаж 5 студів ≈ 1.75 м), g = 9.81 / 0.35.
// Сили вважаємо в «кг·студ/с²» (= Н / 0.35): тоді a = F / m без перерахунків. Пружини й демпфери мають ті самі числа, що й в СІ.
//
// ЯК НАЛАШТОВУВАТИ (таблиця CARS нижче, усі числа — в одиницях СІ, довжини — в студах):
//   mass, com           — маса (кг) і центр мас [x, y, z]; нижчий com = стійкіша машина, вищий = легше перекидається;
//   springK / bumpC / reboundC / arbK — жорсткість пружини (Н/м), демпфер на стиск і відбій (Н·с/м), стабілізатор: м'якша підвіска
//                         гойдається більше, жорсткіша — «твердо»; reboundC > bumpC дає плавне повернення після горбів;
//   travelUp / travelDown — хід підвіски вгору/вниз (студи): більший хід = довший «політ» коліс після відриву кузова;
//   tireMu / tireB / tireC — піковий коефіцієнт зчеплення, жорсткість і форма кривої шини (B менший — «розмитіше» ковзання);
//   engine.peak / torque / redline, gears_r, final — момент (Н·м), крива, оберти відсічки, передавальні числа коробки;
//   cdA / clA           — опір повітря й притиск (м²): чим більше cdA, тим нижча максимальна швидкість;
//   brakeTotal, handbrake — сумарний гальмівний момент і ручник (Н·м);
//   parts[...].hp       — «міцність» деталі в м/с зміни швидкості понад DAMAGE_MIN: менше — відлітає від слабшого удару.
// Поверхні (зчеплення, опір кочення) задає SURF.table у world.js. Гравітація й масштаб — S та G угорі цього файлу.
//
// НОВЕ (листопад 2026):
//   • ЛІМІТ ШВИДКОСТІ: поле topKmh — седан 250 км/год, фургон і вантажівка 105 км/год. Двигун плавно «відсікається» біля ліміту,
//     а на спуску м'який «регулятор» не дає розігнатися понад нього (у польоті з гірки машина летить за інерцією, як і раніше);
//   • ДРІФТ: вхід input.drift (клавіша P або кнопка «P»). Задня вісь втрачає бічне зчеплення, колеса можуть пробуксовувати, а контролер
//     заносу за кілька десятих секунди виводить машину на кут ковзання, який задає кермо (до ~35°), і тримає його. Відпустили P —
//     зчеплення повертається й машина випрямляється. Вмикається лише на ходу (від ~25 км/год), на землі, не перекинутою;
//   • ЗМІНАННЯ КУЗОВА: c.cr = [передок, задок, лівий борт, правий борт, дах] (0..1). Сильний удар не відриває деталі, а зминає зону:
//     передок/задок стискаються по довжині, борти — всередину, дах плющиться. Деталі в зім'ятій зоні лишаються на машині.
//     Формула crushPoint — та сама, що в шейдері game.js (вершинний). Зім'ятий кузов має менші габарити для зіткнень.
//     Для мережі стан зминання пакується у старші біти маски dm (netMask): 3 біти на зону «термометром», тому об'єднання
//     масок сервером (побітове АБО) лишається правильним — зминання лише росте.
//
// Напрямок «уперед» при повороті ry: (sin ry, 0, cos ry); модель дивиться в бік +Z, ліва сторона водія — +X.
// Кермо: steer > 0 — праворуч (кут ry зменшується), steer < 0 — ліворуч.
// =====================================================================
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./world.js'));
    else root.KishkaPhysics = factory(root.KishkaWorld);
})(typeof self !== 'undefined' ? self : this, function (World) {
    'use strict';

    // ------------------------------------------------------------------ масштаб і загальні константи
    var S = 0.35;                         // метрів в одному студі
    var G = 9.81 / S;                     // гравітація, студів/с² (≈ 28.0)
    var STUD_TO_KMH = 3.6 * S;            // 1 студ/с = 1.26 км/год
    var KMH = STUD_TO_KMH;
    var STEP = 1 / 120;                   // максимальний внутрішній крок інтеграції
    var PI = Math.PI, TWO_PI = Math.PI * 2;

    var WALK = {
        speed: 16,
        jump: 50,
        gravity: 196.2,
        radius: 0.9,
        height: 5,
        maxSlope: 1.35,     // найкрутіший схил, на який можна ступити (~54 градуси)
        snapDown: 1.4,      // скільки можна «спуститися» по схилу, не перейшовши в падіння
        accel: 130,         // розгін на землі, студів/с²: повна швидкість за ~0.12 с (плавний, а не різкий старт)
        decel: 190,         // гальмування на землі при відпущеному джойстику
        air: 0.45           // у повітрі керування слабше (частка від наземного розгону)
    };

    var CAR = {
        gravity: G,
        fallY: World.CFG.killY,          // нижче цього — машину повертаємо на землю
        maxSpeed: 330,                   // жорстка межа швидкості, студів/с (захист від збою)
        maxSpin: 30,                     // межа кутової швидкості, рад/с
        airDensity: 1.2,                 // кг/м³
        debrisMax: 48,
        debrisLife: 30
    };

    // Дріфт (див. шапку): minSpeed — м/с, з якої він вмикається; rearLat — частка бічного зчеплення, яку втрачає задня вісь;
    // maxSlip — кут ковзання (рад) при повністю вивернутому кермі; kp/kd — коефіцієнти контролера заносу; maxAcc — межа кутового прискорення
    var DRIFT = { minSpeed: 7, rearLat: 0.58, maxSlip: 0.62, kp: 46, kd: 10.5, maxAcc: 20, rise: 7, fall: 2.4 };
    // Зминання кузова: зони (індекси в c.cr) і геометрія формули crushPoint
    var ZONE_FRONT = 0, ZONE_REAR = 1, ZONE_LEFT = 2, ZONE_RIGHT = 3, ZONE_ROOF = 4, ZONES = 5;
    var CRUSH = { zf: 0.22, xs: 0.35, front: 0.74, side: 0.5, roof: 0.8, noise: 0.2 };
    var CR_BIT0 = 16;                     // перший біт зминання в мережевій масці (біти 0..14 — деталі й колеса)
    var CR_LEVELS = [0, 0.25, 0.58, 0.95];
    var carSeq = 0;                       // номер створеної машини: від нього залежить «міцність» її деталей (різна, але відтворювана)

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function isNum(v) { return typeof v === 'number' && isFinite(v); }
    function angDiff(from, to) {
        var d = (to - from) % TWO_PI;
        if (d > PI) d -= TWO_PI;
        if (d < -PI) d += TWO_PI;
        return d;
    }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function sign(v) { return v < 0 ? -1 : 1; }
    function smooth01(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

    // Кусково-лінійна функція за таблицею [[x, y], ...]
    function table(tab, x) {
        if (x <= tab[0][0]) return tab[0][1];
        for (var i = 1; i < tab.length; i++) {
            if (x <= tab[i][0]) {
                var a = tab[i - 1], b = tab[i];
                return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
            }
        }
        return tab[tab.length - 1][1];
    }

    // ------------------------------------------------------------------ кватерніони й матриці 3×3
    // q = [x, y, z, w]; матриця R — стовпці — осі тіла у світі: R[0..2] — «вправо/вліво» (+X моделі), R[3..5] — вгору, R[6..8] — уперед.
    function qIdent(q) { q[0] = 0; q[1] = 0; q[2] = 0; q[3] = 1; return q; }
    function qNormalize(q) {
        var l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
        if (!(l > 1e-9)) return qIdent(q);
        q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
        return q;
    }
    function qFromAxisAngle(q, ax, ay, az, ang) {
        var s = Math.sin(ang / 2);
        q[0] = ax * s; q[1] = ay * s; q[2] = az * s; q[3] = Math.cos(ang / 2);
        return q;
    }
    function qMul(o, a, b) {
        var ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
        o[0] = aw * bx + ax * bw + ay * bz - az * by;
        o[1] = aw * by - ax * bz + ay * bw + az * bx;
        o[2] = aw * bz + ax * by - ay * bx + az * bw;
        o[3] = aw * bw - ax * bx - ay * by - az * bz;
        return o;
    }
    function matFromQ(R, q) {
        var x = q[0], y = q[1], z = q[2], w = q[3];
        var xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
        R[0] = 1 - 2 * (yy + zz); R[1] = 2 * (xy + wz); R[2] = 2 * (xz - wy);
        R[3] = 2 * (xy - wz); R[4] = 1 - 2 * (xx + zz); R[5] = 2 * (yz + wx);
        R[6] = 2 * (xz + wy); R[7] = 2 * (yz - wx); R[8] = 1 - 2 * (xx + yy);
        return R;
    }
    // Локальний вектор (lx,ly,lz) -> світовий
    function rotV(R, lx, ly, lz, out) {
        out[0] = R[0] * lx + R[3] * ly + R[6] * lz;
        out[1] = R[1] * lx + R[4] * ly + R[7] * lz;
        out[2] = R[2] * lx + R[5] * ly + R[8] * lz;
        return out;
    }
    // Світовий вектор -> локальний (транспонована матриця)
    function unrotV(R, wx, wy, wz, out) {
        out[0] = R[0] * wx + R[1] * wy + R[2] * wz;
        out[1] = R[3] * wx + R[4] * wy + R[5] * wz;
        out[2] = R[6] * wx + R[7] * wy + R[8] * wz;
        return out;
    }
    // Кватерніон із кута повороту навколо Y, потім нахилу вперед-назад і вбік (старий формат ry/pitch/roll)
    function qFromEuler(q, ry, pitch, roll) {
        var a = [0, 0, 0, 1], b = [0, 0, 0, 1], c = [0, 0, 0, 1], t = [0, 0, 0, 1];
        qFromAxisAngle(a, 0, 1, 0, ry);
        qFromAxisAngle(b, 1, 0, 0, -pitch);
        qFromAxisAngle(c, 0, 0, 1, -roll);
        qMul(t, a, b);
        qMul(q, t, c);
        return qNormalize(q);
    }
    // З кватерніона: курс (ry), нахил носа вгору (pitch), крен (roll; додатній — правий бік вище)
    function eulerFromQ(q, out) {
        var R = _Re;
        matFromQ(R, q);
        var fx = R[6], fy = R[7], fz = R[8];
        out = out || {};
        out.ry = Math.atan2(fx, fz);
        out.pitch = Math.atan2(fy, Math.sqrt(fx * fx + fz * fz));
        // крен: висота лівої осі моделі над горизонтом (знак як у старої моделі: + якщо правий бік вище)
        out.roll = Math.atan2(-R[1], Math.sqrt(R[0] * R[0] + R[2] * R[2]));
        out.upY = R[4];
        return out;
    }
    var _Re = new Float64Array(9);

    // ------------------------------------------------------------------ персонаж
    function createWalker(x, z) {
        var s = World.spawnPoint();
        var px = isNum(x) ? x : s.x, pz = isNum(z) ? z : s.z;
        return { x: px, y: World.heightAt(px, pz), z: pz, ry: 0, vy: 0, vx: 0, vz: 0, onGround: true, speed: 0, a: 0 };
    }

    // Виштовхує персонажа з машин (машина — тверда коробка на землі). Персонаж не проходить крізь кузов,
    // але може стояти впритул і сідати: відстань посадки більша за габарит.
    function pushWalkerOutOfCars(w, cars) {
        if (!cars) return;
        for (var i = 0; i < cars.length; i++) {
            var car = cars[i];
            if (!car || !isNum(car.x) || !isNum(car.z)) continue;
            var def = CARS[car.type] || CARS.sedan;
            var dx = w.x - car.x, dz = w.z - car.z;
            var far = def.len / 2 + WALK.radius + 2;
            if (dx * dx + dz * dz > far * far) continue;
            var cy = isNum(car.y) ? car.y : 0;
            if (w.y > cy + def.height - 0.3 || w.y + WALK.height < cy + 0.5) continue;      // над дахом чи під машиною (у польоті)
            var cs = Math.cos(car.ry || 0), sn = Math.sin(car.ry || 0);
            var lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
            var hx = def.wid / 2 + WALK.radius, hz = def.len / 2 + WALK.radius;
            if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
                if (hx - Math.abs(lx) < hz - Math.abs(lz)) lx = (lx < 0 ? -1 : 1) * hx; else lz = (lz < 0 ? -1 : 1) * hz;
                w.x = car.x + lx * cs + lz * sn;
                w.z = car.z - lx * sn + lz * cs;
                w.vx = 0; w.vz = 0;
            }
        }
    }

    // input: { mx, mz } — напрямок руху у світі (довжина 0..1), jump — чи тримають стрибок; cars — машини, крізь які не пройти
    function stepWalker(w, input, dt, cars) {
        var mx = input.mx || 0, mz = input.mz || 0;
        var mag = Math.sqrt(mx * mx + mz * mz);
        if (mag > 1) { mx /= mag; mz /= mag; mag = 1; }
        var moving = mag > 0.12;
        // плавний розгін до потрібної швидкості (на землі — швидко, у повітрі — слабше)
        var tvx = 0, tvz = 0;
        if (moving) {
            tvx = (mx / mag) * WALK.speed;
            tvz = (mz / mag) * WALK.speed;
            var want = Math.atan2(mx, mz);
            w.ry += angDiff(w.ry, want) * Math.min(1, dt * 14);
        }
        var rate = (moving ? WALK.accel : WALK.decel) * (w.onGround ? 1 : WALK.air);
        w.vx = (w.vx || 0); w.vz = (w.vz || 0);
        var ex = tvx - w.vx, ez = tvz - w.vz, el = Math.sqrt(ex * ex + ez * ez);
        if (el > 1e-6) {
            var stp = Math.min(el, rate * dt);
            w.vx += ex / el * stp; w.vz += ez / el * stp;
        }
        var dx = w.vx * dt, dz = w.vz * dt;
        var gliding = dx * dx + dz * dz > 1e-8;
        var startX = w.x, startZ = w.z;

        if (gliding) {
            var tryMove = function (ax, az) {
                var nx = w.x + ax, nz = w.z + az;
                var len = Math.sqrt(ax * ax + az * az) || 1;
                if (w.onGround) {
                    var rise = World.heightAt(nx, nz) - World.heightAt(w.x, w.z);
                    if (rise / len > WALK.maxSlope) return false;
                } else {
                    // У повітрі: не входимо в землю чи стіну гірки збоку
                    if (World.heightAt(nx, nz) > w.y + 1.6) return false;
                }
                w.x = nx; w.z = nz;
                return true;
            };
            if (!tryMove(dx, dz)) {
                // ковзаємо вздовж схилу або стіни: пробуємо кожну вісь окремо
                if (!tryMove(dx, 0)) { w.vx = 0; tryMove(0, dz) || (w.vz = 0); }
            }
            var c = World.clampToWorld(w.x, w.z, WALK.radius);
            w.x = c.x; w.z = c.z;
            var o = World.resolveObstacles(w.x, w.z, WALK.radius);
            w.x = o.x; w.z = o.z;
            pushWalkerOutOfCars(w, cars);
        }

        // Стрибок (поки кнопку тримають — стрибає знову, як у Roblox)
        if (input.jump && w.onGround) {
            w.vy = WALK.jump;
            w.onGround = false;
        }

        var ground = World.heightAt(w.x, w.z);
        if (w.onGround) {
            if (w.y - ground <= WALK.snapDown && w.vy <= 0) {
                w.y = ground; // іде по землі або сходить схилом
            } else {
                w.onGround = false;
            }
        }
        if (!w.onGround) {
            w.vy -= WALK.gravity * dt;
            w.y += w.vy * dt;
            if (w.y <= ground && w.vy <= 0) {
                w.y = ground;
                w.vy = 0;
                w.onGround = true;
            }
        }

        // Падіння за межі: повертаємо на майданчик
        if (w.y < World.CFG.killY || !isNum(w.x) || !isNum(w.y) || !isNum(w.z)) {
            var s = World.spawnPoint();
            w.x = s.x; w.y = s.y + 2; w.z = s.z; w.vy = 0; w.vx = 0; w.vz = 0; w.onGround = false;
        }

        var moved = Math.sqrt((w.x - startX) * (w.x - startX) + (w.z - startZ) * (w.z - startZ)) / Math.max(dt, 1e-4);
        w.speed = (moving || gliding) ? Math.min(WALK.speed, moved) : 0;
        w.a = !w.onGround ? 2 : (w.speed > 1 ? 1 : 0);
        return w;
    }

    // ------------------------------------------------------------------ характеристики машин
    // Довжина вздовж Z, ширина вздовж X. Ті самі типи дозволені на сервері (blox_game_server.js).
    // Колесо: x, z (у системі моделі; x > 0 — ліва сторона), steer (кермове), drive (ведуче), brake (частка гальмівного моменту).
    // Двигун: torque — крива [об/хв, частка пікового моменту]; gears — передавальні числа D1..Dn, final — головна передача.
    // Пружини, демпфери, стабілізатор — в одиницях СІ (Н/м, Н·с/м): у наших одиницях числа збігаються (дивись вгорі).
    var PART_BITS = { fbump: 1, rbump: 2, hood: 4, trunk: 8, doorL: 16, doorR: 32, mirL: 64, mirR: 128, extra: 256 };
    var WHEEL_BIT0 = 9;                      // колесо i має біт 1 << (9 + i)
    var PART_NAMES = ['fbump', 'rbump', 'hood', 'trunk', 'doorL', 'doorR', 'mirL', 'mirR', 'extra'];

    var CARS = {
        sedan: {
            len: 11, wid: 5.0, height: 3.95, wheelbase: 6.6, track: 4.3, wheelR: 0.95, wheelW: 0.85,
            mass: 1450, com: [0, 1.5, 0.12], maxFwd: 198, topKmh: 250, maxRev: 30, steerMax: 0.62, gears: 6, seat: [1.0, 1.2, -0.5],
            wheels: [
                { x: 2.15, z: 3.3, steer: true, drive: false, brake: 0.34 }, { x: -2.15, z: 3.3, steer: true, drive: false, brake: 0.34 },
                { x: 2.15, z: -3.3, steer: false, drive: true, brake: 0.16 }, { x: -2.15, z: -3.3, steer: false, drive: true, brake: 0.16 }
            ],
            springK: 31000, bumpC: 2300, reboundC: 3400, arbK: 15000, travelUp: 0.55, travelDown: 0.75,
            engine: { idle: 900, redline: 6900, peak: 450, torque: [[0, 0.5], [900, 0.62], [2000, 0.84], [3500, 0.97], [4800, 1.0], [5800, 0.94], [6600, 0.8], [6900, 0.55], [7100, 0]] },
            gears_r: [3.58, 2.2, 1.52, 1.12, 0.89, 0.72], reverseRatio: 3.3, final: 3.42, brakeTotal: 5200, handbrake: 0.9, brakeBias: 0.66,
            cdA: 0.72, clA: 0.18, tireMu: 1.25, tireB: 9.5, tireC: 1.45, wheelI: 1.4, driveEff: 0.9,
            hullH: 3.95, deck: 2.6, cabin: [-2.8, 2.2],
            parts: {
                fbump: { p: [0, 1.25, 5.45], hp: 7, r: 3.2 }, rbump: { p: [0, 1.25, -5.45], hp: 7, r: 3.2 },
                hood: { p: [0, 2.55, 3.7], hp: 10, r: 3.0 }, trunk: { p: [0, 2.6, -3.9], hp: 10, r: 3.0 },
                doorL: { p: [2.45, 2.0, 0.5], hp: 11, r: 2.8 }, doorR: { p: [-2.45, 2.0, 0.5], hp: 11, r: 2.8 },
                mirL: { p: [2.55, 3.0, 1.9], hp: 3.5, r: 1.6 }, mirR: { p: [-2.55, 3.0, 1.9], hp: 3.5, r: 1.6 },
                extra: { p: [0, 3.05, -4.9], hp: 6, r: 2.0 }
            },
            wheelHp: 24, crush: { v0: 6.0, span: 26 }
        },
        van: {
            len: 12, wid: 5.2, height: 5.1, wheelbase: 7.2, track: 4.7, wheelR: 1.0, wheelW: 0.9,
            mass: 2150, com: [0, 2.0, -0.2], maxFwd: 83, topKmh: 105, maxRev: 24, steerMax: 0.56, gears: 5, seat: [1.15, 2.0, 2.0],
            wheels: [
                { x: 2.35, z: 3.6, steer: true, drive: false, brake: 0.34 }, { x: -2.35, z: 3.6, steer: true, drive: false, brake: 0.34 },
                { x: 2.35, z: -3.6, steer: false, drive: true, brake: 0.16 }, { x: -2.35, z: -3.6, steer: false, drive: true, brake: 0.16 }
            ],
            springK: 42000, bumpC: 3300, reboundC: 5000, arbK: 20000, travelUp: 0.6, travelDown: 0.8,
            engine: { idle: 850, redline: 5600, peak: 320, torque: [[0, 0.5], [850, 0.7], [1800, 0.9], [3000, 1.0], [4200, 0.96], [5000, 0.85], [5600, 0.6], [5800, 0]] },
            gears_r: [3.9, 2.3, 1.5, 1.0, 0.78], reverseRatio: 3.6, final: 3.9, brakeTotal: 7600, handbrake: 0.9, brakeBias: 0.62,
            cdA: 1.6, clA: 0.0, tireMu: 1.15, tireB: 8.8, tireC: 1.4, wheelI: 1.9, driveEff: 0.88,
            hullH: 5.1, deck: 3.0, cabin: [-5.0, 3.0],
            parts: {
                fbump: { p: [0, 1.3, 5.9], hp: 8, r: 3.2 }, rbump: { p: [0, 1.3, -5.9], hp: 8, r: 3.2 },
                hood: { p: [0, 2.9, 4.9], hp: 11, r: 2.6 }, trunk: { p: [0, 3.2, -5.95], hp: 12, r: 3.4 },
                doorL: { p: [2.6, 3.0, 3.3], hp: 12, r: 2.6 }, doorR: { p: [-2.6, 3.0, 3.3], hp: 12, r: 2.6 },
                mirL: { p: [2.9, 3.6, 3.6], hp: 4, r: 1.7 }, mirR: { p: [-2.9, 3.6, 3.6], hp: 4, r: 1.7 },
                extra: { p: [0, 5.3, -1.2], hp: 7, r: 3.0 }
            },
            wheelHp: 26, crush: { v0: 6.5, span: 28 }
        },
        truck: {
            len: 16, wid: 5.6, height: 7.5, wheelbase: 9.0, track: 4.8, wheelR: 1.15, wheelW: 0.95,
            mass: 7600, com: [0, 3.0, -0.8], maxFwd: 83, topKmh: 105, maxRev: 20, steerMax: 0.46, gears: 6, seat: [1.25, 2.6, 4.1],
            wheels: [
                { x: 2.4, z: 4.5, steer: true, drive: false, brake: 0.2 }, { x: -2.4, z: 4.5, steer: true, drive: false, brake: 0.2 },
                { x: 2.4, z: -3.2, steer: false, drive: true, brake: 0.15 }, { x: -2.4, z: -3.2, steer: false, drive: true, brake: 0.15 },
                { x: 2.4, z: -5.5, steer: false, drive: true, brake: 0.15 }, { x: -2.4, z: -5.5, steer: false, drive: true, brake: 0.15 }
            ],
            springK: 125000, bumpC: 9500, reboundC: 14500, arbK: 70000, travelUp: 0.7, travelDown: 0.9,
            engine: { idle: 700, redline: 2600, peak: 1100, torque: [[0, 0.6], [700, 0.8], [1200, 1.0], [1800, 1.0], [2200, 0.9], [2600, 0.6], [2750, 0]] },
            gears_r: [7.6, 4.6, 3.1, 2.1, 1.45, 1.0], reverseRatio: 7.2, final: 3.7, brakeTotal: 26000, handbrake: 0.8, brakeBias: 0.45,
            cdA: 3.6, clA: 0.0, tireMu: 1.05, tireB: 8.2, tireC: 1.38, wheelI: 4.5, driveEff: 0.86,
            hullH: 7.5, deck: 3.9, cabin: [-7.0, 1.6],
            parts: {
                fbump: { p: [0, 1.6, 7.55], hp: 10, r: 3.6 }, rbump: { p: [0, 1.7, -7.8], hp: 10, r: 3.6 },
                hood: { p: [0, 3.8, 6.0], hp: 14, r: 3.0 }, trunk: { p: [0, 4.9, -7.85], hp: 15, r: 3.8 },
                doorL: { p: [2.75, 4.1, 3.6], hp: 14, r: 2.8 }, doorR: { p: [-2.75, 4.1, 3.6], hp: 14, r: 2.8 },
                mirL: { p: [3.0, 4.4, 5.0], hp: 4.5, r: 1.8 }, mirR: { p: [-3.0, 4.4, 5.0], hp: 4.5, r: 1.8 },
                extra: { p: [2.3, 6.5, 2.85], hp: 6, r: 2.0 }
            },
            wheelHp: 34, crush: { v0: 8.0, span: 38 }
        }
    };
    var CAR_TYPES = Object.keys(CARS);

    // Допоміжні величини, що виводяться з опису: інерція (коробка), опорна довжина підвіски, точки корпуса для зіткнень
    function finishDef(def) {
        var m = def.mass, L = def.len, W = def.wid, H = def.hullH;
        def.inertia = [m / 12 * (H * H + L * L), m / 12 * (W * W + L * L), m / 12 * (W * W + H * H)];   // [Ix (тангаж), Iy (курс), Iz (крен)]
        def.invI = [1 / def.inertia[0], 1 / def.inertia[1], 1 / def.inertia[2]];
        def.gearsR = def.gears_r;
        def.nWheels = def.wheels.length;
        def.nDrive = def.wheels.filter(function (w) { return w.drive; }).length;
        def.suspTop = def.wheelR + def.travelUp;                        // висота кріплення підвіски над землею (початок променя)
        def.suspRest = def.travelUp;                                    // довжина підвіски в спокої
        def.suspMax = def.travelUp + def.travelDown;                    // повне розтягнення
        def.staticFree = def.suspRest + (m * G / def.nWheels) / def.springK;   // вільна довжина пружини: у спокої колесо стоїть на своєму місці в моделі
        // Статичне навантаження на колесо (для жорсткості обмежувача й калібрування)
        def.wheelLoad = m * G / def.nWheels;
        var hl = L / 2 * 0.97, hw = W / 2 * 0.96, yb = 0.62, deck = def.deck;
        var c0 = def.cabin[0], c1 = def.cabin[1];
        def.hull = [
            [hw, yb, hl], [-hw, yb, hl], [hw, yb, -hl], [-hw, yb, -hl],
            [0, yb * 0.8, hl], [0, yb * 0.8, -hl], [hw, yb, 0], [-hw, yb, 0],
            [hw * 0.92, deck, hl], [-hw * 0.92, deck, hl], [hw * 0.92, deck, -hl], [-hw * 0.92, deck, -hl],
            [hw * 0.82, H, c0], [-hw * 0.82, H, c0], [hw * 0.82, H, c1], [-hw * 0.82, H, c1]
        ];
        // габаритна коробка для зіткнень машина—машина: півосі й центр (локально)
        def.box = { hx: W / 2 * 0.96, hy: H / 2 * 0.98, hz: L / 2 * 0.97, cy: H / 2 + 0.25 };
        def.partNames = PART_NAMES.slice();
        def.partList = PART_NAMES.map(function (n) { return { name: n, bit: PART_BITS[n], p: def.parts[n].p, hp: def.parts[n].hp, r: def.parts[n].r }; });
        for (var i = 0; i < def.nWheels; i++) {
            def.partList.push({ name: 'wheel' + i, bit: 1 << (WHEEL_BIT0 + i), p: [def.wheels[i].x, def.wheelR, def.wheels[i].z], hp: def.wheelHp, r: 2.2, wheel: i });
        }
        // Ідеальні межі: максимальна швидкість для гальмівних/аеро розрахунків у студах/с (довідково)
        def.driftK = def.name === 'truck' ? 0.55 : (def.name === 'van' ? 0.8 : 1);   // важка машина ковзає на менший кут
        def.extraZone = def.name === 'van' ? ZONE_ROOF : (def.name === 'truck' ? ZONE_LEFT : ZONE_REAR);   // де стоїть «extra»: спойлер / багажник на даху / труба
        def.maxFwd = def.topKmh / KMH;                 // студів/с на ліміті швидкості
        def.maxFwdKmh = def.topKmh;
        def.topMs = def.topKmh / 3.6;                  // м/с
        return def;
    }
    CAR_TYPES.forEach(function (t) { CARS[t].name = t; finishDef(CARS[t]); });

    // Швидкість для спідометра (км/год) з уздовжньої швидкості машини (студи/с)
    function kmh(speed) { return isNum(speed) ? Math.round(Math.abs(speed) * STUD_TO_KMH) : 0; }

    // Передача для спідометра за швидкістю (-1 = R, 0 = N, 1..gears = D1..Dn). Для живої машини точніша c.gear.
    function gearOf(type, speed) {
        var def = CARS[type] || CARS.sedan;
        if (!isNum(speed)) return 0;
        if (speed < -0.8) return -1;
        if (speed < 0.8) return 0;
        var ratio = clamp(speed / def.maxFwd, 0, 1);
        return Math.min(def.gears, 1 + Math.floor(ratio * def.gears * 0.999));
    }

    // ------------------------------------------------------------------ створення машини й службові функції
    // Висота землі під колесами: для початкової постановки й для віддалених машин (нахил за землею)
    function groundSample(def, c) {
        var s = Math.sin(c.ry), co = Math.cos(c.ry);
        var hl = def.wheelbase / 2, ht = def.track / 2;
        var fx = s * hl, fz = co * hl;
        var rx = -co * ht, rz = s * ht;
        var hFL = World.heightAt(c.x + fx - rx, c.z + fz - rz);
        var hFR = World.heightAt(c.x + fx + rx, c.z + fz + rz);
        var hRL = World.heightAt(c.x - fx - rx, c.z - fz - rz);
        var hRR = World.heightAt(c.x - fx + rx, c.z - fz + rz);
        var front = (hFL + hFR) / 2, rear = (hRL + hRR) / 2;
        var right = (hFR + hRR) / 2, left = (hFL + hRL) / 2;
        var bl = def.len / 2;
        var hFB = World.heightAt(c.x + s * bl, c.z + co * bl);
        var hRB = World.heightAt(c.x - s * bl, c.z - co * bl);
        var y = Math.max((front + rear) / 2, Math.max(hFL, hFR, hRL, hRR) - 0.35, hFB - 1.1, hRB - 1.1);
        return {
            y: y,
            pitch: Math.atan2(front - rear, def.wheelbase),
            roll: Math.atan2(right - left, def.track),
            slope: (front - rear) / def.wheelbase
        };
    }

    function newWheelState(def, i) {
        return { s: def.suspRest, prevS: def.suspRest, rot: 0, w: 0, load: 0, D: 1e5, contact: false, steerAng: 0, slip: 0, slipA: 0, surf: 0, fx: 0, fy: 0, sx: 0, sy: 0 };
    }

    // Нова машина на землі: стоїть на пружинах у стані спокою, нахил за схилом
    function createCar(type, x, z, ry) {
        var def = CARS[type] || CARS.sedan;
        var px = isNum(x) ? x : 0, pz = isNum(z) ? z : 0, yaw = isNum(ry) ? ry : 0;
        var c = {
            type: CARS[type] ? type : 'sedan',
            x: px, y: 0, z: pz, ry: yaw, pitch: 0, roll: 0,
            q: [0, 0, 0, 1],
            px: 0, py: 0, pz: 0,                  // центр мас у світі
            vx: 0, vy: 0, vz: 0,                  // швидкість центру мас
            wx: 0, wy: 0, wz: 0,                  // кутова швидкість у системі тіла
            speed: 0, steer: 0, air: false, hit: false, bump: 0,
            vyG: 0, sy: 0, svy: 0, wheel: 0,       // старі поля (для сумісності з тестами й видом)
            wh: [], rpm: def.engine.idle, gear: 1, gearTimer: 0, thr: 0, brk: 0, hand: 0,
            dm: 0, pd: {}, dent: 0, impact: 0, upY: 1, flipped: false, flipTimer: 0, still: 0, sinceDrive: 0,
            events: [], airTime: 0, lastGroundAt: 0, age: 0,
            cr: [0, 0, 0, 0, 0], crT: null, hullEff: null, boxEff: null,          // зминання кузова (див. crushPoint)
            drift: 0, driftBeta: 0, driftDb: 0, driftFresh: true, stIn: 0, seed: (++carSeq * 2654435761) >>> 0
        };
        for (var i = 0; i < def.nWheels; i++) c.wh.push(newWheelState(def, i));
        var g = groundSample(def, c);
        c.pitch = g.pitch; c.roll = g.roll; c.y = g.y;
        qFromEuler(c.q, c.ry, c.pitch, c.roll);
        syncCOM(c, def);
        return c;
    }

    // Центр мас із положення початку координат моделі
    function syncCOM(c, def) {
        matFromQ(_R, c.q);
        rotV(_R, def.com[0], def.com[1], def.com[2], _v1);
        c.px = c.x + _v1[0]; c.py = c.y + _v1[1]; c.pz = c.z + _v1[2];
    }
    // Початок координат моделі й старі поля (ry, pitch, roll, speed) із центру мас
    function syncOrigin(c, def) {
        matFromQ(_R, c.q);
        rotV(_R, def.com[0], def.com[1], def.com[2], _v1);
        c.x = c.px - _v1[0]; c.y = c.py - _v1[1]; c.z = c.pz - _v1[2];
        eulerFromQ(c.q, _eul);
        c.ry = _eul.ry; c.pitch = _eul.pitch; c.roll = _eul.roll; c.upY = _eul.upY;
        c.speed = c.vx * _R[6] + c.vy * _R[7] + c.vz * _R[8];
        c.vyG = c.vy;
    }
    var _R = new Float64Array(9), _v1 = [0, 0, 0], _v2 = [0, 0, 0], _v3 = [0, 0, 0], _eul = {};

    // Ставить машину на землю біля майданчика, нульова швидкість
    function resetCar(c) {
        var def = CARS[c.type] || CARS.sedan;
        var s = World.spawnPoint();
        c.x = s.x + 14; c.z = s.z; c.ry = Math.PI / 2;
        var g = groundSample(def, c);
        c.y = g.y; c.pitch = 0; c.roll = 0;
        qFromEuler(c.q, c.ry, 0, 0);
        c.vx = c.vy = c.vz = 0; c.wx = c.wy = c.wz = 0;
        c.speed = 0; c.steer = 0; c.air = false; c.bump = 0; c.vyG = 0; c.sy = 0; c.svy = 0; c.drift = 0; c.driftFresh = true;
        c.rpm = def.engine.idle; c.gear = 1; c.gearTimer = 0;
        for (var i = 0; i < c.wh.length; i++) { c.wh[i].w = 0; c.wh[i].s = def.suspRest; c.wh[i].prevS = def.suspRest; c.wh[i].contact = false; }
        syncCOM(c, def);
        syncOrigin(c, def);
        return c;
    }

    // Ставить перекинуту машину на колеса там же (кнопка «перевернути»)
    function flipCar(c) {
        var def = CARS[c.type] || CARS.sedan;
        matFromQ(_R, c.q);
        var yaw = Math.atan2(_R[6], _R[8]);
        if (Math.abs(_R[7]) > 0.95) yaw = Math.atan2(-_R[4] * 0 + _R[0], _R[2]) + PI / 2;   // ніс униз/вгору — курс беремо з осі боку
        c.ry = yaw;
        c.q = qFromEuler(c.q, yaw, 0, 0);
        var g = World.heightAt(c.x, c.z);
        c.y = Math.max(c.y, g) + 2.5;
        c.vx *= 0.2; c.vy = 0; c.vz *= 0.2; c.wx = c.wy = c.wz = 0;
        c.flipped = false; c.flipTimer = 0;
        syncCOM(c, def);
        syncOrigin(c, def);
        return c;
    }

    // Перевстановлює машину за положенням і курсом (для сервера/відновлення) без швидкості
    function placeCar(c, x, y, z, ry) {
        var def = CARS[c.type] || CARS.sedan;
        c.x = x; c.y = y; c.z = z; c.ry = ry;
        qFromEuler(c.q, ry, 0, 0);
        c.vx = c.vy = c.vz = 0; c.wx = c.wy = c.wz = 0;
        syncCOM(c, def);
        syncOrigin(c, def);
        return c;
    }

    // Місце для нової машини перед гравцем (не всередині перешкоди й не в гірці)
    function spawnSpot(px, pz, ry, type) {
        var def = CARS[type] || CARS.sedan;
        var dist = def.len / 2 + 4;
        var x = px + Math.sin(ry) * dist, z = pz + Math.cos(ry) * dist;
        var cl = World.clampToWorld(x, z, def.len / 2 + 2);
        x = cl.x; z = cl.z;
        for (var i = 0; i < 6; i++) {
            var r = World.resolveObstacles(x, z, def.len / 2);
            if (!r.hit) break;
            x = r.x; z = r.z;
        }
        // Якщо місце всередині твердого тіла гірки (стіна) — ставимо машину біля гравця на землі збоку
        var tries = 0;
        while (World.contact(x, World.groundHeight(x, z) + 1.2, z) && World.contact(x, World.groundHeight(x, z) + 1.2, z).solid && tries < 6) {
            x -= Math.sin(ry) * 4; z -= Math.cos(ry) * 4; tries++;
        }
        var g = groundSample(def, { x: x, z: z, ry: ry });
        return { x: x, y: g.y, z: z, ry: ry };
    }

    // Кадр з кроками не більше 1/60 с
    function stepMany(dt, fn) {
        var d = Math.min(dt, 0.1);
        var steps = Math.max(1, Math.ceil(d / (1 / 60)));
        var h = d / steps;
        for (var i = 0; i < steps; i++) fn(h);
    }

    // ------------------------------------------------------------------ імпульси жорсткого тіла
    // Обернена інерція у світі, застосована до вектора: R · diag(invI) · Rᵀ · v
    function invInertiaTimes(def, R, vx, vy, vz, out) {
        unrotV(R, vx, vy, vz, _v3);
        _v3[0] *= def.invI[0]; _v3[1] *= def.invI[1]; _v3[2] *= def.invI[2];
        return rotV(R, _v3[0], _v3[1], _v3[2], out);
    }
    // Лише для тіла-машини: застосувати імпульс J (світовий) у точці зі зсувом r від центру мас
    function applyImpulse(c, def, R, rx, ry, rz, jx, jy, jz) {
        var im = 1 / def.mass;
        c.vx += jx * im; c.vy += jy * im; c.vz += jz * im;
        // L = r × J -> кутова швидкість у тілі
        var lx = ry * jz - rz * jy, ly = rz * jx - rx * jz, lz = rx * jy - ry * jx;
        unrotV(R, lx, ly, lz, _v3);
        c.wx += _v3[0] * def.invI[0]; c.wy += _v3[1] * def.invI[1]; c.wz += _v3[2] * def.invI[2];
    }
    // Знаменник імпульсу вздовж n в точці зі зсувом r: 1/m + n·((I⁻¹ (r × n)) × r)
    function impulseDenom(def, R, rx, ry, rz, nx, ny, nz) {
        var cx = ry * nz - rz * ny, cy = rz * nx - rx * nz, cz = rx * ny - ry * nx;
        invInertiaTimes(def, R, cx, cy, cz, _v2);
        var ax = _v2[1] * rz - _v2[2] * ry, ay = _v2[2] * rx - _v2[0] * rz, az = _v2[0] * ry - _v2[1] * rx;
        return 1 / def.mass + (ax * nx + ay * ny + az * nz);
    }

    // ------------------------------------------------------------------ шини, двигун, коробка, підвіска
    // Формула Пацейки (спрощена): D·sin(C·atan(B·x − E·(B·x − atan(B·x)))); D — максимальна сила тертя
    function pacejka(B, C, E, D, x) {
        var bx = B * x;
        return D * Math.sin(C * Math.atan(bx - E * (bx - Math.atan(bx))));
    }

    function partGone(c, bit) { return (c.dm & bit) !== 0; }

    // Кути керма коліс (Аккерман): внутрішнє колесо повертається більше, зовнішнє — менше. angle > 0 — праворуч.
    function wheelSteerAngle(def, w, angle) {
        if (!w.steer || Math.abs(angle) < 1e-4) return 0;
        var L = def.wheelbase, T = def.track, a = Math.abs(angle);
        var R0 = L / Math.tan(a);
        // праворуч: внутрішнє — праве колесо (x < 0); ліворуч: внутрішнє — ліве (x > 0)
        var inner = angle > 0 ? (w.x < 0) : (w.x > 0);
        var r = inner ? Math.max(R0 - T / 2, 0.5) : (R0 + T / 2);
        return Math.sign(angle) * Math.atan(L / r);
    }

    // Максимальний кут керма залежно від швидкості (м/с): на швидкості кермо «закручується» менше
    function steerLock(def, speedMs) {
        var k = speedMs / 18;
        return def.steerMax / (1 + k * k);
    }

    // Наслідки пошкоджень для їзди (рахуються раз на кадр): зім'ятий передній кінець (радіатор) — менша потужність;
    // пошкоджене колесо — менше зчеплення (як спущена шина); неоднакові пошкодження передніх коліс — машину «веде» вбік.
    function damageEffects(c, def) {
        var pd = c.pd || {};
        var front = clamp(((pd.fbump || 0) + (pd.hood || 0)) / 2, 0, 1);
        if (c.cr && c.cr[ZONE_FRONT] > front) front = c.cr[ZONE_FRONT];
        var power = 1 - 0.38 * smooth01((front - 0.45) / 0.5);
        if (c.dm & PART_BITS.hood) power *= 0.92;                                     // без капота двигун гірше охолоджується
        c.fxPower = power;
        if (!c.fxGrip || c.fxGrip.length !== def.nWheels) c.fxGrip = new Array(def.nWheels);
        var pull = 0, steerW = 0;
        for (var i = 0; i < def.nWheels; i++) {
            var d = pd['wheel' + i] || 0;
            c.fxGrip[i] = 1 - 0.5 * smooth01((d - 0.35) / 0.6);
            if (def.wheels[i].steer) { pull += (def.wheels[i].x > 0 ? 1 : -1) * d; steerW++; }
        }
        c.fxPull = steerW ? clamp(pull * 0.07, -0.07, 0.07) : 0;
    }

    // Двигун + автоматична коробка + гальма. Заповнює c.drvT (момент на одне ведуче колесо, Н·м), c.brkAll, c.rpm.
    function driveline(c, def, inp, h) {
        var vf = c.speed * S;
        var th = inp.throttle, brk = inp.brake || 0, eng = 0;
        if (th > 0.05) {
            if (vf < -1.2) brk = Math.max(brk, th);                 // їхали назад — спершу гальмуємо
            else { if (c.gear < 1) { c.gear = 1; c.gearTimer = 0.22; } eng = th; }
        } else if (th < -0.05) {
            if (vf > 1.2) brk = Math.max(brk, -th);                 // їхали вперед — гальмуємо
            else { if (c.gear !== -1) { c.gear = -1; c.gearTimer = 0.22; } eng = -th; }
        } else if (Math.abs(vf) < 1.5) {
            brk = Math.max(brk, 0.55);                              // утримання на місці (без повзучості на схилі)
        }
        // Ведучі колеса: їхня середня швидкість обертання
        var wd = 0, n = 0, i;
        for (i = 0; i < def.nWheels; i++) {
            if (def.wheels[i].drive && !partGone(c, 1 << (WHEEL_BIT0 + i))) { wd += c.wh[i].w; n++; }
        }
        wd = n ? wd / n : 0;
        var g = c.gear < 1 ? -1 : c.gear;
        var ratio = g > 0 ? def.gearsR[g - 1] * def.final : -def.reverseRatio * def.final;
        var aR = Math.abs(ratio);
        var rpmWheel = Math.abs(wd) * aR * 30 / PI;
        var rpmGround = Math.abs(vf) / (def.wheelR * S) * aR * 30 / PI;       // оберти за швидкістю руху (без пробуксовки)
        if (rpmWheel > rpmGround * 1.3 + 500) rpmWheel = rpmGround * 1.3 + 500;
        var E = def.engine;
        var rpm = rpmWheel;
        if (eng > 0.02) {
            // зчеплення на старті: двигун не падає нижче «стартових» обертів
            var clutch = (Math.abs(g) === 1) ? lerp(E.idle, 0.4 * E.redline, eng) : E.idle;
            rpm = Math.max(rpm, clutch);
        } else rpm = Math.max(rpm, E.idle);
        var Teng = table(E.torque, rpm) * E.peak * eng;
        var Tw = Teng * aR * def.driveEff * (ratio < 0 ? -1 : 1);
        if (eng <= 0.02) {
            // гальмування двигуном
            if (Math.abs(wd) > 0.6 && c.gear >= 1) Tw = -Math.sign(wd) * E.peak * 0.17 * (rpm / E.redline) * aR * def.driveEff;
            else Tw = 0;
        }
        // Ліміт швидкості (topKmh): біля нього момент двигуна плавно зникає
        if (vf > 0 && Tw > 0) Tw *= 1 - smooth01((vf - def.topMs * 0.994) / (def.topMs * 0.014));
        if (c.gearTimer > 0) { c.gearTimer -= h; Tw = Math.min(Tw, 0) * 0.5; }
        else if (c.gear >= 1) {
            var up = lerp(0.5, 0.93, eng) * E.redline, down = lerp(0.29, 0.5, eng) * E.redline;
            c.sinceShift = (c.sinceShift || 0) + h;
            if (rpmWheel > up && c.gear < def.gears && c.sinceShift > 0.5) { c.gear++; c.gearTimer = 0.2; c.sinceShift = 0; }
            else if (rpmWheel < down && c.gear > 1 && eng > 0.02 && c.sinceShift > 0.5) { c.gear--; c.gearTimer = 0.12; c.sinceShift = 0; }
            else if (rpmWheel < 0.2 * E.redline && c.gear > 1 && Math.abs(vf) < 6) c.gear = 1;
        }
        c.brkAll = clamp(brk, 0, 1);
        c.engThr = eng;
        // Оберти двигуна мають інерцію маховика: при перемиканні (зчеплення розімкнене) вони падають/ростуть самі, а біля
        // відсічки подачі палива «стукають» об обмежувач. Це лише для приладів і звуку; момент рахується за rpm вище.
        var engineFree = c.gearTimer > 0;
        var target = engineFree ? lerp(E.idle, E.redline * 0.82, eng) : rpm;
        var riseRate = (4200 + 9000 * eng) * (engineFree ? 1 : 3), fallRate = engineFree ? 5200 : 9000;
        var dr = clamp(target - c.rpm, -fallRate * h, riseRate * h);
        c.rpm += dr;
        if (c.rpm > E.redline * 1.01) { c.rpm = E.redline * 0.985; c.limiter = 0.08; }
        if (c.limiter > 0) { c.limiter -= h; Tw *= 0.2; }
        c.drvT = n ? (Tw * (c.fxPower || 1)) / n : 0;
        c.ratioAbs = aR;
    }

    // Один внутрішній крок інтеграції машини
    var _F = [0, 0, 0], _T = [0, 0, 0], _Wd = [0, 0, 0], _rA = [0, 0, 0], _fw = [0, 0, 0], _f = [0, 0, 0], _l = [0, 0, 0], _n = [0, 1, 0];
    var _vP = [0, 0, 0], _hit = { nx: 0, ny: 1, nz: 0, surf: 0, h: 0 }, _tb = [0, 0, 0], _rr = [0, 0, 0];
    var _cnt = { dm: 0 };

    function substep(c, def, inp, h) {
        driftControl(c, def, h);
        matFromQ(_R, c.q);
        var R = _R, m = def.mass, com = def.com;
        rotV(R, c.wx, c.wy, c.wz, _Wd);
        var Fx = 0, Fy = 0, Fz = 0, Tx = 0, Ty = 0, Tz = 0;
        var i, w, wh;
        var upY = R[4];
        var nGround = 0;

        driveline(c, def, inp, h);
        var Rm = def.wheelR * S;
        var rearCount = 0;
        for (i = 0; i < def.nWheels; i++) if (!def.wheels[i].steer) rearCount++;

        // --- крок 1: для кожного колеса знаходимо контакт із землею й довжину підвіски
        for (i = 0; i < def.nWheels; i++) {
            w = def.wheels[i]; wh = c.wh[i];
            wh.contact = false;
            wh.gone = partGone(c, 1 << (WHEEL_BIT0 + i));
            var s = def.suspMax;
            if (!wh.gone && upY > 0.18) {
                rotV(R, w.x - com[0], def.suspTop - com[1], w.z - com[2], _rA);
                var ax = c.px + _rA[0], ay = c.py + _rA[1], az = c.pz + _rA[2];
                var d = World.rayDown(ax, ay, az, (def.suspMax + def.wheelR * 2 + 0.6) / upY, _hit);
                if (d >= 0) {
                    var ny = _hit.ny < 0.45 ? 0.45 : _hit.ny;
                    var hg = _hit.h;
                    var s1 = (ay - hg - def.wheelR / ny) / upY;
                    // уточнення: висота землі під передбаченим центром колеса (схил/гірка)
                    var hg2 = World.heightAt(ax - R[3] * s1, az - R[5] * s1);
                    if (hg2 <= ay + 0.35) hg = Math.max(hg2, Math.min(hg, hg2 + 3));
                    s = (ay - hg - def.wheelR / ny) / upY;
                    if (s <= def.suspMax) {
                        wh.contact = true;
                        wh.ax = ax; wh.ay = ay; wh.az = az;
                        wh.nx = _hit.nx; wh.ny = _hit.ny; wh.nz = _hit.nz; wh.surf = _hit.surf;
                    } else s = def.suspMax;
                }
            }
            if (!wh.contact) s = def.suspMax;
            wh.sNew = s;
            wh.x = def.staticFree - s;                      // стиснення пружини (студи); > 0 — стиснута
        }

        // --- крок 2: сили підвіски й шин
        var angle = c.steer;
        for (i = 0; i < def.nWheels; i++) {
            w = def.wheels[i]; wh = c.wh[i];
            var dsdt = wh.contact && wh.wasContact ? (wh.sNew - wh.s) / h : 0;
            wh.prevS = wh.s;
            wh.s = wh.sNew;
            wh.steerAng = wheelSteerAngle(def, w, angle) + (w.steer ? (c.fxPull || 0) : 0);
            var Ti = 0;                                      // момент на колесі, Н·м (ведучий)
            if (w.drive && !wh.gone) {
                Ti = c.drvT;
                // диференціал підвищеного тертя: колесо, що пробуксовує більше за сусіднє на осі, отримує менше моменту
                var pj2 = c.wh[i ^ 1];
                if (pj2 && def.wheels[i ^ 1] && def.wheels[i ^ 1].drive && !pj2.gone && wh.wasContact && pj2.wasContact) {
                    Ti *= 1 + 0.5 * clamp((pj2.slip - wh.slip) * 3.5, -0.6, 0.6);
                }
                // антипробуксовка: момент не більший за той, що шина може реалізувати (вимикається ручником)
                if (wh.wasContact && !(inp.handbrake > 0.1)) {
                    var dr = c.drift || 0;                                     // у дріфті колесам дозволено пробуксовувати більше (але не безмежно)
                    var over = smooth01((Math.abs(wh.slip) - 0.1 - 0.3 * dr) / 0.17);     // чим більша пробуксовка, тим сильніше зрізаємо момент
                    var cap = wh.D * Rm * (1.08 + 0.6 * dr) * (1 - over) + 20;
                    if (Ti > cap) Ti = cap; else if (Ti < -cap) Ti = -cap;
                }
            }
            var brkT = def.brakeTotal * c.brkAll * w.brake;
            // ABS: колесо, що починає блокуватись (вповільнюється сильніше за машину), на мить відпускається — шлях гальмування коротший
            if (brkT > 0 && wh.wasContact && !(inp.handbrake > 0.1) && Math.abs(c.speed) * S > 3) {
                brkT *= 1 - 0.85 * smooth01((-wh.slip - 0.13) / 0.12);
            }
            if (!w.steer && inp.handbrake > 0) brkT += def.brakeTotal * def.handbrake * inp.handbrake / Math.max(1, rearCount);
            var Iw = def.wheelI + (w.drive ? 0.06 * c.ratioAbs * c.ratioAbs / Math.max(1, def.nDrive) : 0);
            if (wh.gone) { wh.w = 0; wh.wasContact = false; continue; }

            var fxSI = 0, kw = 0;
            if (wh.contact) {
                var comp = wh.x;
                var compSpeed = -dsdt;
                var Fspring = def.springK * comp;
                if (wh.s < 0) Fspring += def.springK * 7 * (-wh.s);               // обмежувач стиснення
                var damp = compSpeed > 0 ? def.bumpC * compSpeed : def.reboundC * compSpeed;
                var arb = 0, pj = c.wh[i ^ 1];
                if (pj && pj.contact) arb = def.arbK * (comp - pj.x);
                var N = Fspring + damp + arb;
                if (N < 0) N = 0;
                if (N > m * G * 6) N = m * G * 6;
                wh.load = N;
                if (N > 0 && wh.s < 0.02 && compSpeed > 12) c.bottomed = Math.max(c.bottomed || 0, compSpeed);

                // положення центру колеса й точка контакту
                var cxw = wh.ax - R[3] * wh.s, cyw = wh.ay - R[4] * wh.s, czw = wh.az - R[5] * wh.s;
                var nx = wh.nx, ny = wh.ny, nz = wh.nz;
                var px = cxw - nx * def.wheelR, py = cyw - ny * def.wheelR, pz = czw - nz * def.wheelR;
                var rx = px - c.px, ry = py - c.py, rz = pz - c.pz;
                // напрямок «вперед» колеса (з урахуванням керма) у площині землі
                var sa = Math.sin(wh.steerAng), ca = Math.cos(wh.steerAng);
                rotV(R, -sa, 0, ca, _fw);
                var dn = _fw[0] * nx + _fw[1] * ny + _fw[2] * nz;
                var fx = _fw[0] - nx * dn, fy = _fw[1] - ny * dn, fz = _fw[2] - nz * dn;
                var fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
                fx /= fl; fy /= fl; fz /= fl;
                // бічний напрямок l = n × f (до лівого боку)
                var lx = ny * fz - nz * fy, ly = nz * fx - nx * fz, lz = nx * fy - ny * fx;
                // швидкість точки контакту
                var vpx = c.vx + _Wd[1] * rz - _Wd[2] * ry, vpy = c.vy + _Wd[2] * rx - _Wd[0] * rz, vpz = c.vz + _Wd[0] * ry - _Wd[1] * rx;
                var vlong = (vpx * fx + vpy * fy + vpz * fz) * S;
                var vlat = (vpx * lx + vpy * ly + vpz * lz) * S;
                var speedM = Math.sqrt(vlong * vlong + vlat * vlat);
                var surf = World.SURF.table[wh.surf] || World.SURF.table[0];
                var mu = def.tireMu * surf.grip * (c.fxGrip ? c.fxGrip[i] : 1);          // пошкоджене колесо гірше тримає дорогу
                var Nsi = N * S;
                var load = clamp(N / (def.wheelLoad || 1), 0, 4);
                mu *= 1 - 0.07 * Math.max(0, load - 1);                           // чутливість до навантаження
                var D = mu * Nsi;
                wh.D = D;
                var vden = Math.max(Math.abs(vlong), 1.4);
                var kappa = clamp((wh.w * Rm - vlong) / vden, -2, 2);
                var alpha = Math.atan2(vlat, vden);
                var Bx = def.tireB * 1.25;
                var Fx0 = pacejka(Bx, def.tireC, 0.0, D, kappa);
                var dFdk = (pacejka(Bx, def.tireC, 0.0, D, kappa + 0.02) - pacejka(Bx, def.tireC, 0.0, D, kappa - 0.02)) / 0.04;
                kw = dFdk > 0 ? dFdk * Rm / vden : 0;             // жорсткість шини за обертанням колеса (для неявного кроку)
                var Fy0 = -pacejka(def.tireB, def.tireC, -0.3, D, alpha);
                if (!w.steer && c.drift > 0) Fy0 *= 1 - DRIFT.rearLat * c.drift;          // дріфт: задня вісь легко ковзає вбік
                var mag = Math.sqrt(Fx0 * Fx0 + Fy0 * Fy0);
                if (mag > D && mag > 0) { Fx0 *= D / mag; Fy0 *= D / mag; }
                // повільний рух: «прилипання» — гасимо швидкість за один-два кроки в межах кола тертя
                var stickW = 1 - smooth01((speedM - 0.35) / 1.5);
                var mc = m / def.nWheels;
                if (stickW > 0) {
                    var Fys = clamp(-mc * vlat / h * 0.55, -D * 0.98, D * 0.98);
                    Fy0 = lerp(Fy0, Fys, stickW);
                    if (Math.abs(wh.w) * Rm < 0.6 && (brkT > 1 || Ti === 0)) {
                        var Fxs = clamp(-mc * vlong / h * 0.55, -D * 0.98, D * 0.98);
                        Fx0 = lerp(Fx0, Fxs, stickW);
                    }
                }
                // опір кочення
                var Fr = -Math.sign(vlong) * 0.014 * surf.roll * Nsi * smooth01(Math.abs(vlong) / 0.6);
                fxSI = Fx0;
                var FxT = (Fx0 + Fr) / S, FyT = Fy0 / S;
                var Ftx = N * nx + FxT * fx + FyT * lx, Fty = N * ny + FxT * fy + FyT * ly, Ftz = N * nz + FxT * fz + FyT * lz;
                Fx += Ftx; Fy += Fty; Fz += Ftz;
                Tx += ry * Ftz - rz * Fty; Ty += rz * Ftx - rx * Ftz; Tz += rx * Fty - ry * Ftx;
                wh.slip = kappa; wh.slipA = alpha; wh.fx = Fx0; wh.fy = Fy0; wh.speedM = speedM;
                nGround++;
            } else {
                wh.load = 0; wh.slip = 0; wh.slipA = 0; wh.fx = 0; wh.fy = 0;
            }
            wh.wasContact = wh.contact;

            // обертання колеса: двигун, гальма, реакція шини
            var tq = Ti - fxSI * Rm;
            var w1 = wh.w + h * tq / (Iw + h * Rm * kw);           // неявний крок: шина дуже жорстка, явний метод тут нестійкий
            var dwb = h * brkT / Iw;
            if (Math.abs(w1) <= dwb) w1 = 0; else w1 -= Math.sign(w1) * dwb;
            if (!wh.contact) w1 *= 1 - Math.min(1, h * 0.35);            // у повітрі колесо потроху гальмується повітрям
            wh.w = clamp(w1, -420, 420);
            wh.rot += wh.w * h;
        }

        // --- крок 3: аеродинаміка
        var vm = Math.sqrt(c.vx * c.vx + c.vy * c.vy + c.vz * c.vz) * S;
        if (vm > 0.05) {
            var drag = 0.5 * CAR.airDensity * def.cdA * vm * vm / S;       // кг·студ/с²
            var inv = 1 / (vm / S);
            Fx -= drag * c.vx * inv; Fy -= drag * c.vy * inv; Fz -= drag * c.vz * inv;
            Fy -= 0.5 * CAR.airDensity * def.clA * vm * vm / S;            // притиск
        }
        // Регулятор швидкості: на землі вище ліміту (довгий спуск) м'яко гальмує; у польоті не діє
        if (nGround >= 2) {
            var vfw = (c.vx * R[6] + c.vy * R[7] + c.vz * R[8]) * S;
            var exs = vfw - def.topMs * 1.02;
            if (exs > 0) {
                var ga = Math.min(1, exs / (def.topMs * 0.1)) * 6 / S * m;
                Fx -= R[6] * ga; Fy -= R[7] * ga; Fz -= R[8] * ga;
            }
        }
        // легкий опір обертанню в повітрі й ковзанню бортами
        Tx -= _Wd[0] * m * 0.9; Ty -= _Wd[1] * m * 0.9; Tz -= _Wd[2] * m * 0.9;

        // --- крок 4: інтеграція швидкостей
        c.vx += (Fx / m) * h;
        c.vy += (Fy / m - G) * h;
        c.vz += (Fz / m) * h;
        unrotV(R, Tx, Ty, Tz, _tb);
        var Ix = def.inertia[0], Iy = def.inertia[1], Iz = def.inertia[2];
        var gx = (Iz - Iy) * c.wy * c.wz, gy = (Ix - Iz) * c.wz * c.wx, gz = (Iy - Ix) * c.wx * c.wy;   // гіроскопічний член: w × (I w)
        c.wx += (_tb[0] + gx) * def.invI[0] * h;
        c.wy += (_tb[1] + gy) * def.invI[1] * h;
        c.wz += (_tb[2] + gz) * def.invI[2] * h;
        var sp = Math.sqrt(c.vx * c.vx + c.vy * c.vy + c.vz * c.vz);
        if (sp > CAR.maxSpeed) { var k = CAR.maxSpeed / sp; c.vx *= k; c.vy *= k; c.vz *= k; }
        var ws = Math.sqrt(c.wx * c.wx + c.wy * c.wy + c.wz * c.wz);
        if (ws > CAR.maxSpin) { var k2 = CAR.maxSpin / ws; c.wx *= k2; c.wy *= k2; c.wz *= k2; }

        // --- крок 5: положення й орієнтація
        c.px += c.vx * h; c.py += c.vy * h; c.pz += c.vz * h;
        var qx = c.q[0], qy = c.q[1], qz = c.q[2], qw = c.q[3];
        var hx = 0.5 * h * c.wx, hy = 0.5 * h * c.wy, hz = 0.5 * h * c.wz;      // q ⊗ (w, 0)
        c.q[0] = qx + qw * hx + qy * hz - qz * hy;
        c.q[1] = qy + qw * hy + qz * hx - qx * hz;
        c.q[2] = qz + qw * hz + qx * hy - qy * hx;
        c.q[3] = qw - qx * hx - qy * hy - qz * hz;
        qNormalize(c.q);

        // --- крок 6: зіткнення корпуса із землею й гіркою
        hullContacts(c, def, h);
        c.nGround = nGround;
        c.air = nGround === 0;
    }

    // ------------------------------------------------------------------ зіткнення корпуса з землею й гіркою
    var _ct = { depth: 0, nx: 0, ny: 1, nz: 0, solid: false };
    var _nl = [0, 0, 0], _bn = [0, 0, 0];
    var _rv = [0, 0, 0];

    function hullPoints(c, def) {
        // справжні точки корпуса + точки на місці відірваних коліс (кут «сідає» на землю)
        var base = c.hullEff || def.hull;
        if (!c.dm || ((c.dm & 0x7fff) >> WHEEL_BIT0) === 0) return base;
        var pts = base.slice();
        for (var i = 0; i < def.nWheels; i++) {
            if (partGone(c, 1 << (WHEEL_BIT0 + i))) pts.push([def.wheels[i].x, 0.5, def.wheels[i].z]);
        }
        return pts;
    }

    function hullContacts(c, def, h) {
        var pts = hullPoints(c, def), com = def.com;
        var best = 0, bestLp = null, bestN = _bn;
        for (var iter = 0; iter < 2; iter++) {
            matFromQ(_R, c.q);
            var R = _R;
            for (var k = 0; k < pts.length; k++) {
                var lp = pts[k];
                rotV(R, lp[0] - com[0], lp[1] - com[1], lp[2] - com[2], _rv);
                var rx = _rv[0], ry = _rv[1], rz = _rv[2];
                var cont = World.contact(c.px + rx, c.py + ry, c.pz + rz, _ct);
                if (!cont) continue;
                var nx = cont.nx, ny = cont.ny, nz = cont.nz, depth = cont.depth;
                rotV(R, c.wx, c.wy, c.wz, _Wd);
                var vpx = c.vx + _Wd[1] * rz - _Wd[2] * ry, vpy = c.vy + _Wd[2] * rx - _Wd[0] * rz, vpz = c.vz + _Wd[0] * ry - _Wd[1] * rx;
                var vn = vpx * nx + vpy * ny + vpz * nz;
                if (vn < 0) {
                    var e = vn < -14 ? 0.2 : (vn < -5 ? 0.08 : 0);
                    _nl[0] = nx * R[0] + ny * R[1] + nz * R[2]; _nl[1] = nx * R[3] + ny * R[4] + nz * R[5]; _nl[2] = nx * R[6] + ny * R[7] + nz * R[8];   // нормаль у координатах машини
                    if (-vn * S > def.crush.v0 && crushScore(def, lp, null, _nl) >= 0.45) e = 0.02;   // кузов зминається, а не відскакує (удар у днище — як і раніше)
                    var den = impulseDenom(def, R, rx, ry, rz, nx, ny, nz);
                    var j = -(1 + e) * vn / den;
                    applyImpulse(c, def, R, rx, ry, rz, nx * j, ny * j, nz * j);
                    // тертя об землю/стіну
                    var tx = vpx - vn * nx, ty = vpy - vn * ny, tz = vpz - vn * nz;
                    var tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
                    if (tl > 1e-4) {
                        tx /= tl; ty /= tl; tz /= tl;
                        var denT = impulseDenom(def, R, rx, ry, rz, tx, ty, tz);
                        var jt = Math.min(tl / denT, (cont.solid ? 0.45 : 0.62) * j);
                        applyImpulse(c, def, R, rx, ry, rz, -tx * jt, -ty * jt, -tz * jt);
                    }
                    if (iter === 0 && -vn > best) { best = -vn; bestLp = lp; bestN[0] = _nl[0]; bestN[1] = _nl[1]; bestN[2] = _nl[2]; }
                    c.hit = true;
                }
                if (iter === 0 && depth > 0.001) {
                    var push = Math.min(depth, 2.5) * 0.45;
                    c.px += nx * push; c.py += ny * push; c.pz += nz * push;
                }
            }
        }
        if (best > 0) {
            var dv = best * S;
            if (dv > c.impact) c.impact = dv;
            if (dv > 2.2) c.events.push({ t: 'ground', v: dv, lx: bestLp[0], ly: bestLp[1], lz: bestLp[2] });
            damageFrom(c, def, bestLp, dv, 'ground', bestN);
            c.bump = Math.max(c.bump, best);
        }
    }

    // ------------------------------------------------------------------ пошкодження й відламування деталей
    var DAMAGE_MIN = 4.5;               // зміна швидкості (м/с), нижче якої нічого не ламається (~16 км/год)

    // Які деталі до якої зони зминання належать і при якому зминанні зони вони вже НЕ відлітають (їх зім'яло разом із кузовом).
    // Дзеркала можуть відлетіти завжди. Колеса мають власні правила (міцність колеса, удар підвіски).
    var PART_ZONE = { fbump: ZONE_FRONT, hood: ZONE_FRONT, rbump: ZONE_REAR, trunk: ZONE_REAR, doorL: ZONE_LEFT, doorR: ZONE_RIGHT, mirL: ZONE_LEFT, mirR: ZONE_RIGHT };
    var PART_LIMIT = { fbump: 0.42, hood: 0.42, rbump: 0.42, trunk: 0.42, doorL: 0.55, doorR: 0.55, extra: 0.5, mirL: 9, mirR: 9 };

    // Псевдовипадкове число 0..1 для (машини, індексу деталі): однакове при повторі, різне для різних машин
    function partRand(c, i) {
        var h = Math.imul(((c.seed | 0) + Math.imul(i + 1, 374761393)) | 0, 668265263);
        h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
        return (h >>> 0) / 4294967296;
    }

    function damageFrom(c, def, lp, dvSI, kind, nl) {
        if (dvSI <= DAMAGE_MIN) return;
        var e = dvSI - DAMAGE_MIN;
        if (e / 22 > c.dent) c.dent = Math.min(1, e / 22);
        addCrush(c, def, lp, dvSI, nl);                               // від ~22 км/год кузов починає зминатися
        var list = def.partList;
        for (var i = 0; i < list.length; i++) {
            var part = list[i];
            if (c.dm & part.bit) continue;
            var dx = lp[0] - part.p[0], dy = lp[1] - part.p[1], dz = lp[2] - part.p[2];
            var d2 = (dx * dx + dy * dy + dz * dz) / (part.r * part.r);
            var infl = Math.exp(-d2 * 1.1);
            if (infl < 0.04) continue;
            var hpMul = 0.85 + 0.9 * partRand(c, i);                  // деталі різної міцності: одні відлітають від слабшого удару, інші тримаються
            var dd = e * infl / (part.hp * hpMul);
            if (kind === 'ground' && part.wheel !== undefined) dd *= 0.5;      // колесо краще переносить удар об землю
            c.pd[part.name] = (c.pd[part.name] || 0) + dd;
            if (c.pd[part.name] >= 1) {
                var zone = part.wheel === undefined ? (part.name === 'extra' ? def.extraZone : PART_ZONE[part.name]) : -1;
                var lim = PART_LIMIT[part.name] === undefined ? 0.5 : PART_LIMIT[part.name];
                if (zone >= 0 && c.cr && c.cr[zone] >= lim) c.pd[part.name] = 0.98;      // зім'ята разом із кузовом — лишається на машині
                else detachPart(c, def, part, lp, dvSI);
            }
        }
    }

    // ------------------------------------------------------------------ зминання кузова
    function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
    function crNoise(x, y, z) {
        return Math.sin(x * 2.9 + z * 1.3) * Math.sin(y * 3.7 - z * 2.1) + 0.5 * Math.sin(x * 6.3 + y * 5.1 + z * 3.7);
    }
    function crushActive(cr) { return !!cr && (cr[0] > 0.004 || cr[1] > 0.004 || cr[2] > 0.004 || cr[3] > 0.004 || cr[4] > 0.004); }

    // Куди переходить точка кузова (x, y, z — локальні координати моделі) при зминанні cr. Те саме рахує вершинний шейдер у game.js
    // (функція crushP): якщо міняєте тут — міняйте й там. Шум рахується з початкової точки, ваги зон — теж.
    function crushPoint(def, cr, x, y, z, out) {
        out = out || [0, 0, 0];
        var hl = def.len * 0.5, hw = def.wid * 0.5, H = def.height;
        var f = cr[0], r = cr[1], l = cr[2], rt = cr[3], rf = cr[4];
        var n0 = crNoise(x, y, z);
        var zf0 = hl * CRUSH.zf, xs0 = hw * CRUSH.xs;
        var wf = f * sstep(zf0, hl * 1.05, z), wr = r * sstep(zf0, hl * 1.05, -z);
        var wl = l * sstep(xs0, hw * 1.05, x), wt = rt * sstep(xs0, hw * 1.05, -x);
        var wroof = rf * sstep(H * 0.45, H, y);
        var yb = H * 0.52;
        if (y > yb) y = yb + (y - yb) * (1 - CRUSH.roof * rf);                     // дах сплющується вниз
        if (z > zf0) z = zf0 + (z - zf0) * (1 - CRUSH.front * f);                  // передок стискається по довжині
        else if (z < -zf0) z = -zf0 + (z + zf0) * (1 - CRUSH.front * r);           // задок теж
        if (x > xs0) x = xs0 + (x - xs0) * (1 - CRUSH.side * l);                   // борти вдавлюються всередину
        else if (x < -xs0) x = -xs0 + (x + xs0) * (1 - CRUSH.side * rt);
        y += wf * 0.3 + wr * 0.14 + (wf + wr + wl + wt + wroof) * CRUSH.noise * n0;    // капот «вигинається» догори, поверхня гофрується
        x = x * (1 - 0.12 * (wf + wr)) * (1 + 0.06 * wroof) - (wl - wt) * 0.18 * (0.6 + 0.4 * n0);
        out[0] = x; out[1] = y; out[2] = z;
        return out;
    }

    // Габаритна коробка зіткнень зім'ятої машини (симетризована: переднє й заднє зминання усереднюються)
    function crushBoxOf(def, cr) {
        var B = def.box, hl = def.len * 0.5, hw = def.wid * 0.5;
        var zf0 = hl * CRUSH.zf, xs0 = hw * CRUSH.xs;
        var zF = zf0 + (B.hz - zf0) * (1 - CRUSH.front * cr[0]), zR = zf0 + (B.hz - zf0) * (1 - CRUSH.front * cr[1]);
        var xL = xs0 + (B.hx - xs0) * (1 - CRUSH.side * cr[2]), xR = xs0 + (B.hx - xs0) * (1 - CRUSH.side * cr[3]);
        var top = B.cy + B.hy, bot = B.cy - B.hy, yb = def.height * 0.52;
        if (top > yb) top = yb + (top - yb) * (1 - CRUSH.roof * cr[4]);
        return { hx: (xL + xR) / 2, hz: (zF + zR) / 2, hy: (top - bot) / 2, cy: (top + bot) / 2 };
    }

    // Перераховує точки корпуса й коробку після зміни зминання
    function crushHull(c, def) {
        if (!crushActive(c.cr)) { c.hullEff = null; c.boxEff = null; return; }
        var cr = c.cr;
        c.hullEff = def.hull.map(function (p) { return crushPoint(def, cr, p[0], p[1], p[2], [0, 0, 0]); });
        c.boxEff = crushBoxOf(def, cr);
    }

    // Наскільки точка lp (локальні координати) «дивиться» у кожну зону; повертає найбільше значення. Менше ~0.45 — це днище/центр.
    var _crs = [0, 0, 0, 0, 0];
    // nl — нормаль удару в координатах машини (від перешкоди до машини, одинична), якщо відома: вона вирішує, яка зона «дивиться» на перешкоду
    // (лобовий удар кутовою точкою мне передок, а не борт). Без нормалі рахуємо лише за положенням точки.
    function crushScore(def, lp, sc, nl) {
        sc = sc || _crs;
        var B = def.box;
        var nx = lp[0] / B.hx, nz = lp[2] / B.hz, ny = (lp[1] - B.cy) / B.hy;
        sc[0] = nz > 0 ? nz : 0; sc[1] = nz < 0 ? -nz : 0; sc[2] = nx > 0 ? nx : 0; sc[3] = nx < 0 ? -nx : 0; sc[4] = ny > 0.35 ? ny * 0.95 : 0;
        if (nl) {
            var ux = -nl[0], uy = -nl[1], uz = -nl[2];                // куди «дивиться» поверхня машини, що вдарилась
            sc[0] *= 0.15 + 0.85 * clamp(uz, 0, 1); sc[1] *= 0.15 + 0.85 * clamp(-uz, 0, 1);
            sc[2] *= 0.15 + 0.85 * clamp(ux, 0, 1); sc[3] *= 0.15 + 0.85 * clamp(-ux, 0, 1);
            sc[4] *= 0.15 + 0.85 * clamp(uy, 0, 1);
        }
        var mx = 0;
        for (var i = 0; i < ZONES; i++) if (sc[i] > mx) mx = sc[i];
        return mx;
    }

    // Додає зминання від удару в локальній точці lp зі зміною швидкості dvSI (м/с). Повертає величину приросту.
    function addCrush(c, def, lp, dvSI, nl) {
        var K = def.crush;
        if (dvSI <= K.v0) return 0;
        if (!c.cr) c.cr = [0, 0, 0, 0, 0];
        var add = clamp((dvSI - K.v0) / K.span, 0, 1.6);
        var sc = _crs, mx = crushScore(def, lp, sc, nl), i;
        if (mx < 0.45) return 0;                                      // удар у днище чи центр: кузов не зминається (лише підвіска)
        for (i = 0; i < ZONES; i++) {
            var w = sc[i] >= mx * 0.999 ? 1 : (sc[i] >= mx * 0.6 ? 0.35 : 0);
            if (w > 0) c.cr[i] = Math.min(1, c.cr[i] + add * w * (1 - 0.5 * c.cr[i]));
        }
        var avg = (c.cr[0] + c.cr[1] + c.cr[2] + c.cr[3] + c.cr[4]) / 2.5;
        if (avg > c.dent) c.dent = Math.min(1, avg);
        crushHull(c, def);
        c.events.push({ t: 'crush', v: dvSI });
        return add;
    }

    // Мережева маска: біти деталей (0..14) + зминання зон «термометром» по 3 біти (від біта 16): 0 -> 000, рівень 1 -> 001, 2 -> 011, 3 -> 111
    function crLevel(v) { return v < 0.08 ? 0 : (v < 0.4 ? 1 : (v < 0.75 ? 2 : 3)); }
    function netMask(c) {
        var m = (c.dm | 0) & 0x7fff;
        if (c.cr) for (var z = 0; z < ZONES; z++) m |= ((1 << crLevel(c.cr[z])) - 1) << (CR_BIT0 + 3 * z);
        return m;
    }
    function decodeCrush(mask, out) {
        out = out || [0, 0, 0, 0, 0];
        for (var z = 0; z < ZONES; z++) {
            var b = ((mask | 0) >> (CR_BIT0 + 3 * z)) & 7;
            out[z] = CR_LEVELS[(b & 1) + ((b >> 1) & 1) + ((b >> 2) & 1)];
        }
        return out;
    }
    // Віддалена машина: плавно наближає показане зминання до отриманого від сервера
    function easeCrush(c, dt) {
        if (!c.crT) return;
        if (!c.cr) c.cr = [0, 0, 0, 0, 0];
        var k = Math.min(1, dt * 5), mx = 0;
        for (var z = 0; z < ZONES; z++) { c.cr[z] += (c.crT[z] - c.cr[z]) * k; if (c.cr[z] > mx) mx = c.cr[z]; }
        if (mx > c.dent) c.dent = Math.min(1, mx);
    }

    // Контролер дріфту: тримає кут ковзання машини (між курсом і напрямком руху) таким, якого просить кермо
    function driftControl(c, def, h) {
        var d = c.drift;
        if (!(d > 0.001)) { c.driftBeta = 0; c.driftFresh = true; return; }
        matFromQ(_R, c.q);
        var lat = c.vx * _R[0] + c.vy * _R[1] + c.vz * _R[2];
        var lon = c.vx * _R[6] + c.vy * _R[7] + c.vz * _R[8];
        var vmag = Math.sqrt(lat * lat + lon * lon);
        var beta = Math.atan2(lat, Math.max(lon, 1));
        var target = clamp(c.stIn, -1, 1) * DRIFT.maxSlip * def.driftK * smooth01((vmag * S - 6) / 8);
        if (c.driftFresh) { c.driftDb = 0; c.driftFresh = false; }
        else c.driftDb += ((beta - c.driftBeta) / h - c.driftDb) * Math.min(1, h * 40);
        var a = clamp(-DRIFT.kp * (target - beta) + DRIFT.kd * c.driftDb, -DRIFT.maxAcc, DRIFT.maxAcc) * d;
        c.wy += a * h;
        c.driftBeta = beta;
    }

    // Відламує деталь    // Відламує деталь: біт у масці, подія й уламок, що летить із швидкістю точки удару
    function detachPart(c, def, part, lp, dvSI) {
        if (c.dm & part.bit) return;
        c.dm |= part.bit;
        c.pd[part.name] = 1;
        c.events.push({ t: 'detach', part: part.name, wheel: part.wheel });
        spawnDebrisFromCar(c, def, part, dvSI);
    }

    var PART_SHAPE = {
        fbump: [2.1, 0.45, 0.55], rbump: [2.1, 0.45, 0.55], hood: [1.8, 0.14, 1.7], trunk: [1.8, 0.14, 1.5],
        doorL: [0.12, 0.85, 1.35], doorR: [0.12, 0.85, 1.35], mirL: [0.28, 0.2, 0.3], mirR: [0.28, 0.2, 0.3], extra: [0.9, 0.2, 0.55]
    };

    function spawnDebrisFromCar(c, def, part, dvSI) {
        matFromQ(_R, c.q);
        var R = _R;
        rotV(R, part.p[0], part.p[1], part.p[2], _v1);
        var px = c.x + _v1[0], py = c.y + _v1[1], pz = c.z + _v1[2];
        // швидкість тіла в точці деталі
        rotV(R, part.p[0] - def.com[0], part.p[1] - def.com[1], part.p[2] - def.com[2], _v2);
        rotV(R, c.wx, c.wy, c.wz, _Wd);
        var vx = c.vx + _Wd[1] * _v2[2] - _Wd[2] * _v2[1], vy = c.vy + _Wd[2] * _v2[0] - _Wd[0] * _v2[2], vz = c.vz + _Wd[0] * _v2[1] - _Wd[1] * _v2[0];
        var out = _v2; var ol = Math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2]) || 1;
        var kick = Math.min(26, 4 + dvSI * 0.7);
        var rnd = function () { return Math.random() * 2 - 1; };
        var wheel = part.wheel !== undefined;
        var d = {
            car: c.type, part: part.name, wheel: wheel, q: c.q.slice(0),
            p: [px, py, pz], v: [vx + out[0] / ol * kick + rnd() * 3, vy + 6 + Math.abs(rnd()) * 6, vz + out[2] / ol * kick + rnd() * 3],
            w: [rnd() * 8, rnd() * 8, rnd() * 8], life: CAR.debrisLife, age: 0,
            half: wheel ? [def.wheelW / 2, def.wheelR, def.wheelR] : (PART_SHAPE[part.name] || [0.5, 0.3, 0.5]).map(function (v) { return v * def.len / 11; }),
            mass: wheel ? 22 : 14, r: wheel ? def.wheelR : 0, rest: 0
        };
        if (wheel) {
            // колесо котиться в напрямку руху: його вісь — вісь осей машини
            rotV(R, 1, 0, 0, _v1);
            d.w = [_v1[0] * (c.speed / def.wheelR), _v1[1] * (c.speed / def.wheelR), _v1[2] * (c.speed / def.wheelR)];
        }
        addDebris(d);
        return d;
    }

    // Для віддалених машин: нова маска пошкоджень -> уламки зі стану машини (без швидкостей)
    function applyDamageMask(c, mask) {
        var def = CARS[c.type] || CARS.sedan;
        c.crT = decodeCrush(mask, c.crT);                           // нове зминання: машина плавно наближається до нього (easeCrush)
        if (!c.cr) c.cr = [0, 0, 0, 0, 0];
        var changed = ((mask | 0) & 0x7fff) & ~c.dm;
        if (!changed) { return 0; }
        for (var i = 0; i < def.partList.length; i++) {
            var part = def.partList[i];
            if (changed & part.bit) {
                c.dm |= part.bit;
                c.pd[part.name] = 1;
                spawnDebrisFromCar(c, def, part, 12);
            }
        }
        return changed;
    }

    // ------------------------------------------------------------------ уламки (окремі тіла)
    var debris = [];
    function addDebris(d) {
        debris.push(d);
        while (debris.length > CAR.debrisMax) debris.shift();
    }
    function clearDebris() { debris.length = 0; }

    var _dq = [0, 0, 0, 1], _dR = new Float64Array(9), _dr = [0, 0, 0], _dc = { depth: 0, nx: 0, ny: 1, nz: 0, solid: false };
    function stepDebrisOne(d, h) {
        d.v[1] -= G * h;
        d.p[0] += d.v[0] * h; d.p[1] += d.v[1] * h; d.p[2] += d.v[2] * h;
        // орієнтація
        var q = d.q, wx = d.w[0], wy = d.w[1], wz = d.w[2];
        var hx = 0.5 * h * wx, hy = 0.5 * h * wy, hz = 0.5 * h * wz;
        var qx = q[0], qy = q[1], qz = q[2], qw = q[3];
        q[0] = qx + qw * hx + qy * hz - qz * hy;
        q[1] = qy + qw * hy + qz * hx - qx * hz;
        q[2] = qz + qw * hz + qx * hy - qy * hx;
        q[3] = qw - qx * hx - qy * hy - qz * hz;
        qNormalize(q);
        var I = d.mass * (d.half[0] * d.half[0] + d.half[1] * d.half[1] + d.half[2] * d.half[2]) / 3 * 0.9 + 0.01;
        var pts, k;
        if (d.wheel) pts = [[0, 0, 0]];
        else {
            var hx2 = d.half[0], hy2 = d.half[1], hz2 = d.half[2];
            pts = [[hx2, hy2, hz2], [-hx2, hy2, hz2], [hx2, -hy2, hz2], [-hx2, -hy2, hz2], [hx2, hy2, -hz2], [-hx2, hy2, -hz2], [hx2, -hy2, -hz2], [-hx2, -hy2, -hz2]];
        }
        matFromQ(_dR, q);
        var touched = false;
        for (k = 0; k < pts.length; k++) {
            var lp = pts[k];
            rotV(_dR, lp[0], lp[1], lp[2], _dr);
            var cont = World.contact(d.p[0] + _dr[0], d.p[1] + _dr[1] - (d.wheel ? d.r : 0), d.p[2] + _dr[2], _dc);
            if (!cont) continue;
            touched = true;
            var rx = _dr[0], ry = _dr[1] - (d.wheel ? d.r : 0), rz = _dr[2];
            var vpx = d.v[0] + d.w[1] * rz - d.w[2] * ry, vpy = d.v[1] + d.w[2] * rx - d.w[0] * rz, vpz = d.v[2] + d.w[0] * ry - d.w[1] * rx;
            var nx = cont.nx, ny = cont.ny, nz = cont.nz;
            var vn = vpx * nx + vpy * ny + vpz * nz;
            d.p[0] += nx * cont.depth * 0.6; d.p[1] += ny * cont.depth * 0.6; d.p[2] += nz * cont.depth * 0.6;
            if (vn < 0) {
                var e = d.wheel ? 0.38 : 0.28;
                // знаменник: 1/m + |r×n|²/I
                var cx = ry * nz - rz * ny, cy = rz * nx - rx * nz, cz = rx * ny - ry * nx;
                var den = 1 / d.mass + (cx * cx + cy * cy + cz * cz) / I;
                var j = -(1 + e) * vn / den;
                d.v[0] += nx * j / d.mass; d.v[1] += ny * j / d.mass; d.v[2] += nz * j / d.mass;
                d.w[0] += (ry * nz - rz * ny) * j / I; d.w[1] += (rz * nx - rx * nz) * j / I; d.w[2] += (rx * ny - ry * nx) * j / I;
                var tx = vpx - vn * nx, ty = vpy - vn * ny, tz = vpz - vn * nz;
                var tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
                if (tl > 1e-4) {
                    var jt = Math.min(tl / (1 / d.mass + 1e-3), (d.wheel ? 0.08 : 0.55) * j);
                    tx /= tl; ty /= tl; tz /= tl;
                    d.v[0] -= tx * jt / d.mass; d.v[1] -= ty * jt / d.mass; d.v[2] -= tz * jt / d.mass;
                    d.w[0] -= (ry * tz - rz * ty) * jt / I; d.w[1] -= (rz * tx - rx * tz) * jt / I; d.w[2] -= (rx * ty - ry * tx) * jt / I;
                }
            }
        }
        var damp = touched ? Math.max(0, 1 - h * 1.4) : Math.max(0, 1 - h * 0.03);
        d.v[0] *= damp; d.v[2] *= damp; d.w[0] *= damp; d.w[1] *= damp; d.w[2] *= damp;
        if (touched) {
            var sp = Math.sqrt(d.v[0] * d.v[0] + d.v[1] * d.v[1] + d.v[2] * d.v[2]);
            d.rest = sp < 1.2 ? d.rest + h : 0;
        }
    }
    function stepDebris(dt) {
        var n = Math.max(1, Math.ceil(dt / (1 / 90))), h = dt / n;
        for (var i = debris.length - 1; i >= 0; i--) {
            var d = debris[i];
            d.age += dt;
            if (d.rest > 0.6) { d.v[0] = d.v[1] = d.v[2] = 0; d.w[0] = d.w[1] = d.w[2] = 0; }
            else for (var s = 0; s < n; s++) stepDebrisOne(d, h);
            if (d.age > d.life || d.p[1] < World.CFG.killY || !isNum(d.p[0]) || !isNum(d.p[1])) debris.splice(i, 1);
        }
    }

    // ------------------------------------------------------------------ зіткнення машина—машина (орієнтовані коробки, SAT)
    var _qb = [0, 0, 0, 1], _Rb = new Float64Array(9), _Ra = new Float64Array(9);
    var _axes = [], _ca = [0, 0, 0], _cb = [0, 0, 0], _ptsIn = [];
    for (var _ai = 0; _ai < 15; _ai++) _axes.push([0, 0, 0]);

    // Проекція півосей коробки на вісь (a)
    function boxRadius(R, hx, hy, hz, ax, ay, az) {
        return hx * Math.abs(R[0] * ax + R[1] * ay + R[2] * az) + hy * Math.abs(R[3] * ax + R[4] * ay + R[5] * az) + hz * Math.abs(R[6] * ax + R[7] * ay + R[8] * az);
    }
    function pointInBox(R, cx, cy, cz, hx, hy, hz, px, py, pz, m) {
        var dx = px - cx, dy = py - cy, dz = pz - cz;
        var lx = R[0] * dx + R[1] * dy + R[2] * dz, ly = R[3] * dx + R[4] * dy + R[5] * dz, lz = R[6] * dx + R[7] * dy + R[8] * dz;
        return Math.abs(lx) <= hx + m && Math.abs(ly) <= hy + m && Math.abs(lz) <= hz + m;
    }

    // Орієнтовані коробки двох машин: повертає null або { nx, ny, nz (від іншої до моєї), depth, px, py, pz (точка контакту) }
    function overlapBoxes(a, defA, b, defB) {
        matFromQ(_Ra, a.q);
        var bq = b.q && b.q.length === 4 ? b.q : qFromEuler(_qb, b.ry || 0, b.pitch || 0, b.roll || 0);
        matFromQ(_Rb, bq);
        var A = a.boxEff || defA.box, B = b.boxEff || defB.box;       // зім'ятий кузов має менші габарити
        rotV(_Ra, 0, A.cy, 0, _ca);
        var ax0 = a.x + _ca[0], ay0 = a.y + _ca[1], az0 = a.z + _ca[2];
        rotV(_Rb, 0, B.cy, 0, _cb);
        var bx0 = b.x + _cb[0], by0 = b.y + _cb[1], bz0 = b.z + _cb[2];
        var dx = ax0 - bx0, dy = ay0 - by0, dz = az0 - bz0;
        var n = 0, i, j;
        for (i = 0; i < 3; i++) { _axes[n][0] = _Ra[i * 3]; _axes[n][1] = _Ra[i * 3 + 1]; _axes[n][2] = _Ra[i * 3 + 2]; n++; }
        for (i = 0; i < 3; i++) { _axes[n][0] = _Rb[i * 3]; _axes[n][1] = _Rb[i * 3 + 1]; _axes[n][2] = _Rb[i * 3 + 2]; n++; }
        for (i = 0; i < 3; i++) for (j = 0; j < 3; j++) {
            var ux = _Ra[i * 3], uy = _Ra[i * 3 + 1], uz = _Ra[i * 3 + 2], vx = _Rb[j * 3], vy = _Rb[j * 3 + 1], vz = _Rb[j * 3 + 2];
            var cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
            var cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
            if (cl < 1e-4) { _axes[n][0] = 0; _axes[n][1] = 0; _axes[n][2] = 0; }
            else { _axes[n][0] = cx / cl; _axes[n][1] = cy / cl; _axes[n][2] = cz / cl; }
            n++;
        }
        var best = Infinity, bn = null, bsign = 1;
        for (i = 0; i < 15; i++) {
            var ax = _axes[i][0], ay = _axes[i][1], az = _axes[i][2];
            if (ax === 0 && ay === 0 && az === 0) continue;
            var ra = boxRadius(_Ra, A.hx, A.hy, A.hz, ax, ay, az);
            var rb = boxRadius(_Rb, B.hx, B.hy, B.hz, ax, ay, az);
            var dist = dx * ax + dy * ay + dz * az;
            var ov = ra + rb - Math.abs(dist);
            if (ov <= 0) return null;
            // перевага граням (осі 0..5) перед ребрами: ребро-ребро лише якщо помітно менше проникнення
            var w = i < 6 ? ov : ov * 1.08 + 0.01;
            if (w < best) { best = w; bn = i; bsign = dist >= 0 ? 1 : -1; }
        }
        var nx = _axes[bn][0] * bsign, ny = _axes[bn][1] * bsign, nz = _axes[bn][2] * bsign;
        var depth = best;
        // Точка контакту: середнє кутів однієї коробки всередині іншої; інакше — середина між центрами
        var sx = 0, sy = 0, sz = 0, cnt = 0, corner = [0, 0, 0];
        for (i = 0; i < 8; i++) {
            var sxn = (i & 1) ? 1 : -1, syn = (i & 2) ? 1 : -1, szn = (i & 4) ? 1 : -1;
            rotV(_Ra, sxn * A.hx, syn * A.hy, szn * A.hz, corner);
            if (pointInBox(_Rb, bx0, by0, bz0, B.hx, B.hy, B.hz, ax0 + corner[0], ay0 + corner[1], az0 + corner[2], 0.1)) { sx += ax0 + corner[0]; sy += ay0 + corner[1]; sz += az0 + corner[2]; cnt++; }
            rotV(_Rb, sxn * B.hx, syn * B.hy, szn * B.hz, corner);
            if (pointInBox(_Ra, ax0, ay0, az0, A.hx, A.hy, A.hz, bx0 + corner[0], by0 + corner[1], bz0 + corner[2], 0.1)) { sx += bx0 + corner[0]; sy += by0 + corner[1]; sz += bz0 + corner[2]; cnt++; }
        }
        var px, py, pz;
        if (cnt > 0) { px = sx / cnt; py = sy / cnt; pz = sz / cnt; }
        else { px = (ax0 + bx0) / 2; py = (ay0 + by0) / 2; pz = (az0 + bz0) / 2; }
        return { nx: nx, ny: ny, nz: nz, depth: depth, px: px, py: py, pz: pz };
    }

    // Зіткнення моєї машини c з іншими (others: [{x,y,z,ry,type,speed,q?,vx?,vy?,vz?}]). Інші машини не рухаємо —
    // кожен клієнт відштовхує лише свою; удар розраховується симетрично, тож обидві машини реагують однаково.
    function collideCars(c, others) {
        var hit = false;
        if (!others || !others.length) return hit;
        var def = CARS[c.type] || CARS.sedan;
        for (var i = 0; i < others.length; i++) {
            var o = others[i];
            if (!o || !isNum(o.x) || !isNum(o.z)) continue;
            var dx0 = o.x - c.x, dz0 = o.z - c.z;
            var far = def.len + 20;
            if (dx0 * dx0 + dz0 * dz0 > far * far) continue;
            if (isNum(o.y) && Math.abs(o.y - c.y) > 9) continue;
            var od = CARS[o.type] || CARS.sedan;
            if (o.cr && !o.boxEff && crushActive(o.cr)) o.boxEff = crushBoxOf(od, o.cr);
            var ov = overlapBoxes(c, def, o, od);
            if (!ov) continue;
            hit = true;
            matFromQ(_R, c.q);
            var R = _R;
            var rx = ov.px - c.px, ry = ov.py - c.py, rz = ov.pz - c.pz;
            // швидкість іншої машини
            var ovx, ovy, ovz;
            if (isNum(o.vx) && isNum(o.vz)) { ovx = o.vx; ovy = isNum(o.vy) ? o.vy : 0; ovz = o.vz; }
            else {
                var os = isNum(o.speed) ? o.speed : 0;
                ovx = Math.sin(o.ry || 0) * os; ovy = 0; ovz = Math.cos(o.ry || 0) * os;
            }
            rotV(R, c.wx, c.wy, c.wz, _Wd);
            var vax = c.vx + _Wd[1] * rz - _Wd[2] * ry, vay = c.vy + _Wd[2] * rx - _Wd[0] * rz, vaz = c.vz + _Wd[0] * ry - _Wd[1] * rx;
            var rvx = vax - ovx, rvy = vay - ovy, rvz = vaz - ovz;
            var vn = rvx * ov.nx + rvy * ov.ny + rvz * ov.nz;
            // виштовхування: ділимо проникнення пропорційно масам (моя частка)
            var share = od.mass / (def.mass + od.mass);
            var push = Math.min(ov.depth, 4) * (0.3 + 0.5 * share);
            c.px += ov.nx * push; c.py += ov.ny * push * 0.5; c.pz += ov.nz * push;
            if (vn < 0) {
                var e = (-vn * S > def.crush.v0) ? 0.05 : 0.24;
                var denA = impulseDenom(def, R, rx, ry, rz, ov.nx, ov.ny, ov.nz);
                var den = denA + 1 / od.mass;
                var j = -(1 + e) * vn / den;
                applyImpulse(c, def, R, rx, ry, rz, ov.nx * j, ov.ny * j, ov.nz * j);
                // тертя вздовж поверхні
                var tx = rvx - vn * ov.nx, ty = rvy - vn * ov.ny, tz = rvz - vn * ov.nz;
                var tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
                if (tl > 1e-3) {
                    tx /= tl; ty /= tl; tz /= tl;
                    var jt = Math.min(tl / (impulseDenom(def, R, rx, ry, rz, tx, ty, tz) + 1 / od.mass), 0.35 * j);
                    applyImpulse(c, def, R, rx, ry, rz, -tx * jt, -ty * jt, -tz * jt);
                }
                var dv = j / def.mass * S;                       // зміна швидкості моєї машини, м/с
                if (dv > c.impact) c.impact = dv;
                c.bump = Math.max(c.bump, -vn);
                // локальна точка удару для відламування деталей
                unrotV(R, ov.px - c.x, ov.py - c.y, ov.pz - c.z, _v1);
                var lp = [_v1[0], _v1[1], _v1[2]];
                c.events.push({ t: 'car', v: -vn * S, dv: dv, lx: lp[0], ly: lp[1], lz: lp[2] });
                _nl[0] = ov.nx * R[0] + ov.ny * R[1] + ov.nz * R[2]; _nl[1] = ov.nx * R[3] + ov.ny * R[4] + ov.nz * R[5]; _nl[2] = ov.nx * R[6] + ov.ny * R[7] + ov.nz * R[8];
                damageFrom(c, def, lp, dv * 1.25, 'car', _nl);
            }
        }
        if (hit) c.hit = true;
        return hit;
    }

    // Чи перетинаються два прямокутники (старий інтерфейс; корисний для діагностики): за коробками
    function overlapCars(a, defA, b, defB) {
        var aa = a.q ? a : Object.assign({ q: qFromEuler([0, 0, 0, 1], a.ry || 0, a.pitch || 0, a.roll || 0) }, a);
        var r = overlapBoxes(aa, defA || CARS[a.type] || CARS.sedan, b, defB || CARS[b.type] || CARS.sedan);
        return r ? { nx: r.nx, nz: r.nz, depth: r.depth } : null;
    }

    // ------------------------------------------------------------------ головний крок машини
    var _inp = { throttle: 0, brake: 0, handbrake: 0, drift: 0 };

    // input: { throttle: -1..1 (вперед +), steer: -1..1 (праворуч +), brake: 0..1 (необов'язково), handbrake: 0..1 (необов'язково) }
    // others — інші машини для зіткнень. dt — не більше ~1/60 с (більші кадри поділяються всередині).
    function stepCar(c, input, dt, others) {
        var def = CARS[c.type] || CARS.sedan;
        input = input || {};
        _inp.throttle = clamp(isNum(input.throttle) ? input.throttle : 0, -1, 1);
        var st = clamp(isNum(input.steer) ? input.steer : 0, -1, 1);
        _inp.brake = clamp(isNum(input.brake) ? input.brake : 0, 0, 1);
        _inp.handbrake = clamp(isNum(input.handbrake) ? input.handbrake : (input.handbrake ? 1 : 0), 0, 1);
        _inp.drift = clamp(isNum(input.drift) ? input.drift : (input.drift ? 1 : 0), 0, 1);
        c.stIn = st;
        if (!(dt > 0)) return c;
        dt = Math.min(dt, 0.1);

        // допомога при заносі (контркермо): якщо машину несе боком, передні колеса м'яко повертаються в бік ковзання — як
        // стабілізація в сучасних авто; корисно при керуванні кнопками (є лише «вліво/вправо», без плавного руля)
        var vm = Math.abs(c.speed) * S;
        // дріфт (клавіша P): вмикається на ходу, на землі, не перекинутою; плавно вмикається й вимикається
        var wantDrift = _inp.drift > 0.5 && c.nGround >= 2 && c.speed * S > DRIFT.minSpeed && c.upY > 0.7;
        c.drift += clamp((wantDrift ? 1 : 0) - c.drift, -DRIFT.fall * dt, DRIFT.rise * dt);
        if (c.drift < 0.001) c.drift = 0;
        if (vm > 7 && !(_inp.handbrake > 0.1) && !(c.drift > 0.05) && c.nGround >= 2) {
            matFromQ(_R, c.q);
            var vlatB = c.vx * _R[0] + c.vy * _R[1] + c.vz * _R[2];          // швидкість убік (до лівого боку)
            var beta = Math.atan2(vlatB, Math.max(Math.abs(c.speed), 2) * (c.speed < 0 ? -1 : 1));
            if (Math.abs(beta) > 0.1) st = clamp(st - clamp((beta - Math.sign(beta) * 0.1) * 2.4, -0.3, 0.3), -1, 1);
        }
        // кермо: цільовий кут зменшується з швидкістю; повернення до центру швидше, ніж поворот
        var target = st * steerLock(def, vm);
        // у дріфті передні колеса «контркермують»: дивляться туди, куди їде машина (кут задає контролер заносу)
        if (c.drift > 0.02) target = target * (1 - c.drift) + clamp(-(c.driftBeta || 0) * 0.9, -0.5, 0.5) * c.drift;
        var rate = (Math.abs(target) > Math.abs(c.steer) && target * c.steer >= 0) ? 2.3 : 3.8;
        if (c.drift > 0.02) rate = 9;
        var dsteer = target - c.steer;
        c.steer += clamp(dsteer, -rate * dt, rate * dt);

        c.hit = false; c.impact = 0; c.bottomed = 0;
        damageEffects(c, def);
        var n = Math.max(1, Math.ceil(dt / STEP));
        var h = dt / n;
        for (var i = 0; i < n; i++) substep(c, def, _inp, h);

        // ковзаючі колеса: сума обертання для старого поля
        var ws = 0; for (var k = 0; k < c.wh.length; k++) ws += c.wh[k].rot;
        c.wheel = ws / c.wh.length;

        // межі світу
        var cl = World.clampToWorld(c.px, c.pz, def.len / 2);
        if (cl.hit) {
            c.px = cl.x; c.pz = cl.z; c.vx *= 0.35; c.vz *= 0.35; c.hit = true;
        }
        collideCars(c, others);

        // жорсткий удар колесами об землю (обмежувачі підвіски): ламає колесо й дає подію
        if (c.bottomed > 0) {
            var dvL = c.bottomed * S;
            if (dvL > 3) c.events.push({ t: 'land', v: dvL });
            if (dvL > 9) {
                // удар по підвісці: колеса, що найбільше навантажені, гинуть першими
                for (var q = 0; q < def.nWheels; q++) {
                    var wp = def.partList[PART_NAMES.length + q];
                    if (c.dm & wp.bit) continue;
                    c.pd[wp.name] = (c.pd[wp.name] || 0) + (dvL - 9) / (wp.hp * 1.4) * (c.wh[q].load > 0 ? 1 : 0.3);
                    if (c.pd[wp.name] >= 1) detachPart(c, def, wp, wp.p, dvL);
                }
            }
        }

        // захист від «провалу» й від збою розрахунків
        var gh = World.heightAt(c.px, c.pz);
        if (c.py < gh - 4) { c.py = gh + def.com[1] + 1.5; if (c.vy < 0) c.vy = 0; }
        if (c.py < CAR.fallY || !isNum(c.px) || !isNum(c.py) || !isNum(c.pz) || !isNum(c.q[0]) || !isNum(c.vx) || !isNum(c.wx)) {
            resetCar(c);
            return c;
        }
        syncOrigin(c, def);
        if (c.bump > 0) c.bump = Math.max(0, c.bump - dt * 60);

        // перекинута й нерухома машина: кнопка «перевернути»
        if (c.upY < 0.25 && Math.abs(c.speed) < 10) c.flipTimer += dt; else c.flipTimer = 0;
        c.flipped = c.flipTimer > 1.4;
        if (c.upY > 0.6) c.flipped = false;
        c.age += dt;
        if (c.events.length > 12) c.events.splice(0, c.events.length - 12);
        return c;
    }

    // Короткий опис стану машини для налагодження й тестів: швидкість, передача, оберти й стан кожного колеса
    function describe(c) {
        var def = CARS[c.type] || CARS.sedan;
        return {
            kmh: kmh(c.speed), gear: c.gear, rpm: Math.round(c.rpm), air: !!c.air, grounded: c.nGround | 0, dent: +(c.dent || 0).toFixed(2), dm: c.dm | 0, drift: +(c.drift || 0).toFixed(2), crush: (c.cr || []).map(function (v) { return +v.toFixed(2); }),
            upright: c.upY > 0.5, steerDeg: +(c.steer * 57.2958).toFixed(1),
            wheels: c.wh.map(function (w, i) {
                return {
                    contact: !!w.contact, load: Math.round(w.load), slipRatio: +w.slip.toFixed(2), slipAngleDeg: +(w.slipA * 57.2958).toFixed(1),
                    surface: (World.SURF.table[w.surf] || World.SURF.table[0]).name, gone: !!(c.dm & (1 << (WHEEL_BIT0 + i))), compression: +(def.suspRest - w.s).toFixed(2)
                };
            })
        };
    }

    // Швидкість точки (локальної) машини у світі — для інших гравців і відламаних деталей
    function pointVelocity(c, lx, ly, lz, out) {
        var def = CARS[c.type] || CARS.sedan;
        matFromQ(_R, c.q);
        rotV(_R, lx - def.com[0], ly - def.com[1], lz - def.com[2], _v2);
        rotV(_R, c.wx, c.wy, c.wz, _Wd);
        out = out || [0, 0, 0];
        out[0] = c.vx + _Wd[1] * _v2[2] - _Wd[2] * _v2[1];
        out[1] = c.vy + _Wd[2] * _v2[0] - _Wd[0] * _v2[2];
        out[2] = c.vz + _Wd[0] * _v2[1] - _Wd[1] * _v2[0];
        return out;
    }

    // Нахил для віддалених машин, якщо в пакеті немає кватерніона: за землею під колесами
    function qForRemote(def, c, out) {
        var g = groundSample(def, c);
        return qFromEuler(out || [0, 0, 0, 1], c.ry, g.pitch, g.roll);
    }

    return {
        S: S, G: G, STEP: STEP, WALK: WALK, CARS: CARS, CAR_TYPES: CAR_TYPES, CAR: CAR, STUD_TO_KMH: STUD_TO_KMH,
        PART_BITS: PART_BITS, PART_NAMES: PART_NAMES, WHEEL_BIT0: WHEEL_BIT0,
        createWalker: createWalker, stepWalker: stepWalker,
        createCar: createCar, stepCar: stepCar, resetCar: resetCar, flipCar: flipCar, placeCar: placeCar, groundSample: groundSample,
        collideCars: collideCars, overlapCars: overlapCars, overlapBoxes: overlapBoxes,
        kmh: kmh, gearOf: gearOf, spawnSpot: spawnSpot, stepMany: stepMany, angDiff: angDiff,
        damageFrom: damageFrom, detachPart: detachPart, applyDamageMask: applyDamageMask,
        DRIFT: DRIFT, CRUSH: CRUSH, ZONES: ZONES, crushPoint: crushPoint, crushActive: crushActive, crushBoxOf: crushBoxOf, addCrush: addCrush, crushHull: crushHull,
        netMask: netMask, decodeCrush: decodeCrush, easeCrush: easeCrush,
        debris: debris, stepDebris: stepDebris, clearDebris: clearDebris, addDebris: addDebris,
        pointVelocity: pointVelocity, describe: describe, pushWalkerOutOfCars: pushWalkerOutOfCars, qForRemote: qForRemote, steerLock: steerLock, wheelSteerAngle: wheelSteerAngle,
        qFromEuler: qFromEuler, eulerFromQ: eulerFromQ, qFromAxisAngle: qFromAxisAngle, qMul: qMul, qNormalize: qNormalize,
        matFromQ: matFromQ, rotV: rotV, syncOrigin: syncOrigin, syncCOM: syncCOM
    };
});
