// =====================================================================
// KishkaBlox — ядерна подія: єдиний ТАЙМЛАЙН для сервера й гри (чиста математика, без WebGL; є і в браузері, і в Node).
//
// Усе рахується від моменту запуску t0 (мілісекунди на ГОДИННИКУ СЕРВЕРА). Сервер лише повідомляє t0, а кожен клієнт
// сам знає, що в цю мить показувати: тому всі бачать одне й те саме одночасно, а той, хто зайшов пізніше, одразу потрапляє в потрібну фазу.
//
//   0 ..  6 с   «A»: камера зверху збоку — дах коробки на вершині гірки відкривається, як коробка; починається звук сирен
//   6 .. 16 с   «B»: камера в дверях — двері відчиняються, бомба повільно здіймається з коробки
//  16 .. 30 с   «C»: камера збоку — бомба вилітає з коробки й іде геть у бік майданчика (кінець анімації: 30 с)
//  30 .. 89 с   відлік: напис «NUKE WAS LAUNCHED, ENTER THE BUNKER.» і 59S -> 0; усі біжать у бункер
//  89 .. 92 с   метал дверей бункера закривається (відлік дійшов до нуля, написи зникають)
//  89 ..103 с   «D»: бомба, що піднялась, летить до круглого майданчика, повертає й падає на нього
//  103 с        ВИБУХ: усе поза бункером горить; машини поза бункером підлітають на 1-50 студів, гравці поза бункером гинуть
// 103 ..107 с   сирени затихають (вони вже впали)
// 103 ..193 с   світ згорілий; потім усе повертається як було (двері бункера знову відчиняються, бомба знову в коробці)
//
// Усі числа нижче — в одному місці: змінюйте тут, і сервер, і гра підхоплять.
// =====================================================================
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./world.js'));
    else root.KishkaNuke = factory(root.KishkaWorld);
})(typeof self !== 'undefined' ? self : this, function (World) {
    'use strict';

    var T = {
        lidEnd: 6000,            // дах коробки відкрився повністю
        doorOpenAt: 6000,        // двері камери починають відчинятися (під час анімації вони відчиняються самі)
        shotB: 6000,             // початок кадру з дверей
        shotC: 16000,            // початок бокового кадру
        cinemaEnd: 30000,        // кінець анімації; з цього моменту видно напис і відлік
        countdownS: 59,          // відлік у секундах: 59 -> 0
        doorsClose: 3000,        // скільки секунд зачиняються двері бункера
        inboundMs: 14000,        // анімація «бомба прилетіла»
        sirenFade: 4000,         // сирени затихають після вибуху
        burnMs: 90000            // скільки світ лишається згорілим
    };
    T.countEnd = T.cinemaEnd + T.countdownS * 1000;       // 89 000: відлік дійшов до нуля
    T.impact = T.countEnd + T.inboundMs;                  // 103 000: вибух
    T.sirenEnd = T.impact + T.sirenFade;
    T.total = T.impact + T.burnMs;                        // 193 000: усе повертається як було

    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
    function lerp(a, b, t) { return a + (b - a) * t; }

    // Фаза за часом від запуску (мс): 'idle' | 'cinema' | 'countdown' | 'inbound' | 'burned' | 'done'
    function phase(ms) {
        if (!(ms >= 0)) return 'idle';
        if (ms < T.cinemaEnd) return 'cinema';
        if (ms < T.countEnd) return 'countdown';
        if (ms < T.impact) return 'inbound';
        if (ms < T.total) return 'burned';
        return 'done';
    }

    // Секунди, які показує лічильник (59, 58 ... 1). Після нуля — null (написи зникають)
    function countdownShown(ms) {
        if (ms < T.cinemaEnd || ms >= T.countEnd) return null;
        return Math.ceil((T.countEnd - ms) / 1000);
    }

    // Дах коробки: 0 — закритий, 1 — відкритий повністю (дві стулки відкидаються назовні)
    function lidOpen(ms) { return smooth(ms / T.lidEnd); }

    // Двері камери на вершині: під час анімації відчиняються самі
    function summitDoorOpen(ms) {
        if (ms < T.doorOpenAt) return 0;
        return smooth((ms - T.doorOpenAt) / 1500);
    }

    // Двері бункера: 1 — відкриті; зачиняються за T.doorsClose, коли відлік дійшов до нуля
    function bunkerDoorOpen(ms) {
        if (ms < T.countEnd) return 1;
        if (ms >= T.total) return 1;
        return 1 - smooth((ms - T.countEnd) / T.doorsClose);
    }

    // ---------------------------------------------------------------- бомба
    // Поза бомби: { x, y, z, pitch, yaw, visible }. y — низ бомби. pitch: 0 — носом угору, >0 — нахил уперед (по yaw).
    function summitBombRest() {
        var S = World.SUMMIT, b = S.bomb;
        return { x: b.x, y: S.top + 1.2, z: b.z };
    }
    var DIRX = -1, DIRZ = 0;                 // з вершини бомба йде в бік майданчика (-X)

    function bombPose(ms) {
        var r = summitBombRest(), S = World.SUMMIT;
        var p = { x: r.x, y: r.y, z: r.z, pitch: 0, yaw: Math.atan2(DIRX, DIRZ), visible: true };
        if (ms < T.shotB) return p;
        if (ms < T.shotC) {                   // повільно здіймається з коробки (вертикально)
            var u = (ms - T.shotB) / (T.shotC - T.shotB);
            p.y = r.y + 58 * smooth(u) + 6 * u * u;
            return p;
        }
        if (ms < T.cinemaEnd) {               // вилітає: розгін, нахил у бік майданчика
            var v = (ms - T.shotC) / (T.cinemaEnd - T.shotC);
            var acc = v * v * (0.4 + 0.6 * v);
            p.y = r.y + 64 + 520 * acc + 40 * v;
            p.x = r.x + DIRX * (40 * v + 900 * acc);
            p.pitch = smooth(Math.min(1, v * 1.4)) * 1.1;
            return p;
        }
        p.visible = false;                    // далі бомба далеко; її показує лише анімація «прилетіла»
        return p;
    }

    // Анімація «бомба прилетіла» (центр вибуху — центр майданчика, точка (0, 0, 0)):
    // з'являється вдалині над горизонтом (з боку гірки, +X), помаленьку піднімається, повертає й пікірує на коло дороги.
    var IN_P = [[2300, 40, -260], [1700, 900, -170], [900, 780, 40], [0, 2, 0]];
    function bez(t, i) {
        var u = 1 - t;
        return u * u * u * IN_P[0][i] + 3 * u * u * t * IN_P[1][i] + 3 * u * t * t * IN_P[2][i] + t * t * t * IN_P[3][i];
    }
    function bez1(t, i) {
        var u = 1 - t;
        return 3 * u * u * (IN_P[1][i] - IN_P[0][i]) + 6 * u * t * (IN_P[2][i] - IN_P[1][i]) + 3 * t * t * (IN_P[3][i] - IN_P[2][i]);
    }
    function inboundPose(ms) {
        var u = clamp((ms - T.countEnd) / T.inboundMs, 0, 1);
        var t = u < 0.5 ? 0.5 * Math.pow(u * 2, 1.35) : 1 - 0.5 * Math.pow((1 - u) * 2, 0.8);    // повільно на початку, швидше наприкінці
        t = clamp(t, 0, 1);
        var x = bez(t, 0), y = bez(t, 1), z = bez(t, 2);
        var dx = bez1(t, 0), dy = bez1(t, 1), dz = bez1(t, 2);
        var hl = Math.sqrt(dx * dx + dz * dz) || 1;
        return {
            x: x, y: y, z: z,
            yaw: Math.atan2(dx, dz),
            pitch: Math.atan2(hl, dy),                  // кут від вертикалі: 0 — носом угору, π/2 — горизонтально, π — носом униз
            visible: ms >= T.countEnd && ms < T.impact,
            near: Math.sqrt(x * x + y * y + z * z)
        };
    }

    // ---------------------------------------------------------------- камери анімації (повертають { eye:[x,y,z], at:[x,y,z], fov } або null)
    function cinemaCamera(ms) {
        var S = World.SUMMIT, top = S.top, bp = bombPose(Math.max(ms, 0));
        if (ms >= 0 && ms < T.shotB) {
            var a = smooth(ms / T.shotB);
            return { eye: [S.x0 - 70 + 10 * a, top + 78 - 6 * a, 92 - 12 * a], at: [S.x0 + 34, top + 24, 4], fov: 0.95 };
        }
        if (ms >= T.shotB && ms < T.shotC) {
            var b = (ms - T.shotB) / (T.shotC - T.shotB);
            return { eye: [S.x0 - 30, top + 9.5, 7], at: [bp.x, bp.y + 12 + 6 * b, 0], fov: 1.05 };
        }
        if (ms >= T.shotC && ms < T.cinemaEnd) {
            var c = (ms - T.shotC) / (T.cinemaEnd - T.shotC);
            return { eye: [S.x0 - 40 - 30 * c, top + 46 + 20 * c, -150 - 40 * c], at: [bp.x, bp.y + 10, bp.z], fov: 0.9 };
        }
        return null;
    }
    // Камера під час польоту до майданчика: стоїть на даху бункера збоку й слідкує за бомбою
    var INBOUND_EYE = [-40, 64, 150];
    function inboundCamera(ms) {
        if (ms < T.countEnd || ms >= T.impact + 2500) return null;
        var bp = inboundPose(Math.min(ms, T.impact));
        var tx = bp.x, ty = bp.y, tz = bp.z;
        var u = clamp((ms - T.countEnd) / T.inboundMs, 0, 1);
        // на початку дивимось на горизонт у бік гірки, наприкінці — на майданчик
        var k = smooth(u * 1.15);
        return { eye: INBOUND_EYE, at: [lerp(600, tx, k), lerp(160, ty, k), lerp(0, tz, k)], fov: lerp(0.8, 0.95, u) };
    }

    // ---------------------------------------------------------------- вибух і наслідки
    // Куля вогню: радіус, яскравість (0..1) залежно від часу після вибуху (мс)
    function fireball(msAfter) {
        if (msAfter < 0) return { r: 0, a: 0 };
        var t = msAfter / 1000;
        return { r: 14 + 150 * (1 - Math.exp(-t * 1.1)), a: clamp(1.15 - t / 5.5, 0, 1), ring: 30 + t * 210, ringA: clamp(1 - t / 4, 0, 1) };
    }
    // Спалах екрана (біле тло, що згасає): 0..1
    function flash(msAfter) {
        if (msAfter < -80) return 0;
        if (msAfter < 0) return (msAfter + 80) / 80;
        return clamp(1 - msAfter / 1600, 0, 1);
    }
    // Скільки студів від центру вибуху сягає ударна хвиля: усе поза бункером у цьому колі горить
    var BLAST_R = 4200;

    // Куди відлітає машина: 1..50 студів, напрямок — від центру вибуху (детерміновано від номера машини, щоб на всіх екранах збігалось)
    function carThrow(id, x, z) {
        var h = Math.imul((id | 0) + 17, 2654435761) >>> 0;
        var d = 1 + (h % 5000) / 5000 * 49;                                   // 1..50
        var base = Math.atan2(z, x);
        var jitter = (((h >>> 8) % 1000) / 1000 - 0.5) * 1.6;
        return { dist: d, dx: Math.cos(base + jitter) * d, dz: Math.sin(base + jitter) * d };
    }

    // Чи цей гравець/машина у безпеці: усередині бункера (поки двері ще не зачинились чи вже зачинені)
    function safe(x, y, z) { return World.inBunker(x, y, z); }

    // Повний знімок стану для клієнта за часом від запуску
    function snapshot(ms) {
        return {
            ms: ms, phase: phase(ms), countdown: countdownShown(ms), lid: lidOpen(ms), summitDoor: summitDoorOpen(ms), bunkerDoor: bunkerDoorOpen(ms),
            sirens: ms >= 0 && ms < T.sirenEnd, burned: ms >= T.impact && ms < T.total, bomb: bombPose(ms), inbound: inboundPose(ms)
        };
    }

    return {
        T: T, phase: phase, countdownShown: countdownShown, lidOpen: lidOpen, summitDoorOpen: summitDoorOpen, bunkerDoorOpen: bunkerDoorOpen,
        bombPose: bombPose, inboundPose: inboundPose, cinemaCamera: cinemaCamera, inboundCamera: inboundCamera, fireball: fireball, flash: flash,
        carThrow: carThrow, safe: safe, snapshot: snapshot, BLAST_R: BLAST_R, INBOUND_EYE: INBOUND_EYE, summitBombRest: summitBombRest
    };
});
