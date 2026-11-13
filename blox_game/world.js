// =====================================================================
// KishkaBlox — світ гри «Realistic cars»: рельєф, майданчик, дорога, пандус, верхня плита.
// Чиста математика без WebGL: працює і в грі (window.KishkaWorld), і в тестах Node (require).
//
// Одиниці — «студи» (як у Roblox): персонаж заввишки 5, ходить 16 студів/с.
// Вся висота землі — одна гладка функція heightAt(x, z). Ніяких коробок-сходинок: усі переходи — smoothstep.
//
// Карта (вид зверху, вісь +X вправо). На ній НЕМАЄ дерев, каміння й іншого «сміття» — лише:
//   • (0,0)  — великий круглий сірий майданчик (радіус 26), тут з'являється персонаж;
//   • від майданчика на +X йде асфальтова дорога (шириною 16) до гірки;
//   • довга плавна гірка-пандус (130 студів завдовжки, підйом 22) із сірого «бетону»;
//   • гірка переходить у широку верхню плиту (140×180); її краї плавно сходять до землі — з краю можна злетіти;
//   • навкруги — велика зелена рівнина з дуже м'якими пагорбами (без гір і стін).
// Трава й гірка — ОДИН матеріал: та сама «шахова» плитка (її малює шейдер за світовими координатами,
// див. game.js, uTile), різниться лише основний колір (зелений / сірий), як у відео-орієнтирі.
// =====================================================================
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.KishkaWorld = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var CFG = {
        platformR: 26,          // радіус круглого майданчика
        platformH: 0.6,         // висота майданчика над рівнем землі
        platformEdge: 1.6,      // ширина м'якого бордюру
        roadHalf: 8,            // півширини дороги
        roadX0: 22,             // де дорога починається (вона виходить із майданчика)
        rampX0: 100,            // початок підйому
        rampX1: 230,            // кінець підйому (довжина пандуса 130)
        rampH: 22,              // висота верхньої плити
        plateau: { cx: 310, cz: 0, hx: 70, hz: 90, r: 26, fall: 46 },
        limitR: 640,            // межа світу (радіус); далі — не пройти
        meshHalf: 700,          // рельєф намальований на ±700
        tile: 8                 // розмір плитки «шахової» текстури (однакова для трави й гірки)
    };

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function smooth(e0, e1, x) {
        var t = clamp((x - e0) / (e1 - e0), 0, 1);
        return t * t * (3 - 2 * t);
    }

    // Профіль висоти вздовж дороги: 0.6 на рівні майданчика, потім S-подібний підйом до rampH
    function roadProfile(x) {
        return CFG.platformH + (CFG.rampH - CFG.platformH) * smooth(CFG.rampX0, CFG.rampX1, x);
    }

    // Дуже м'які великі пагорби (амплітуда ~2 студи): земля не плоска, але ніщо не заважає їзді
    function hills(x, z) {
        return 1.6 * Math.sin(x * 0.012 + 1.3) * Math.cos(z * 0.010 + 0.4) +
            1.1 * Math.sin(x * 0.021 + z * 0.017 + 2.0) +
            0.35 * Math.sin(x * 0.047 - z * 0.039 + 0.5);
    }

    function plateauDist(x, z) {
        var p = CFG.plateau;
        var qx = Math.abs(x - p.cx) - p.hx + p.r;
        var qz = Math.abs(z - p.cz) - p.hz + p.r;
        var ox = Math.max(qx, 0), oz = Math.max(qz, 0);
        return Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(qx, qz), 0) - p.r;
    }

    // Компоненти висоти (для фарбування й для heightAt)
    function parts(x, z) {
        var r = Math.sqrt(x * x + z * z);

        // Пагорби: вимкнені біля майданчика, біля коридору дороги/пандуса та на верхній плиті
        var farMask = smooth(60, 220, r);
        var corridorX = smooth(0, 40, x) * (1 - smooth(300, 380, x));
        var corridor = (1 - smooth(30, 90, Math.abs(z))) * corridorX;
        var pd = plateauDist(x, z);
        var plateauMask = smooth(0, 70, pd);
        var ground = hills(x, z) * farMask * (1 - corridor) * plateauMask;

        // Круглий майданчик
        var platform = CFG.platformH * (1 - smooth(CFG.platformR, CFG.platformR + CFG.platformEdge, r));

        // Дорога + пандус (коридор уздовж +X). Боки пандуса сходять до землі тим довше, чим він вищий
        var p = roadProfile(x);
        var gate = smooth(CFG.roadX0 - 6, CFG.roadX0 + 4, x) * (1 - smooth(255, 280, x));
        var fall = 4 + (p - CFG.platformH) * 1.9;
        var lateral = 1 - smooth(CFG.roadHalf, CFG.roadHalf + fall, Math.abs(z));
        var ramp = p * lateral * gate;

        // Верхня плита: пласка зверху, краї плавно доходять до землі
        var plateau = CFG.rampH * (1 - smooth(0, CFG.plateau.fall, pd));

        return { r: r, ground: ground, platform: platform, ramp: ramp, plateau: plateau, pd: pd, lateral: lateral, gate: gate };
    }

    function heightAt(x, z) {
        var q = parts(x, z);
        var h = q.ground;
        if (q.platform > h) h = q.platform;
        if (q.ramp > h) h = q.ramp;
        if (q.plateau > h) h = q.plateau;
        return h;
    }

    function normalAt(x, z, out) {
        var e = 0.6;
        var dx = heightAt(x + e, z) - heightAt(x - e, z);
        var dz = heightAt(x, z + e) - heightAt(x, z - e);
        var nx = -dx / (2 * e), ny = 1, nz = -dz / (2 * e);
        var l = Math.sqrt(nx * nx + ny * ny + nz * nz);
        out = out || [0, 0, 0];
        out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
        return out;
    }

    // Яскравість «шахової» плитки в точці (так само її рахує шейдер): 0 або 1. Потрібна тестам і діагностиці.
    function checkerAt(x, z) {
        var t = CFG.tile;
        return ((Math.floor(x / t) + Math.floor(z / t)) & 1) ? 1 : 0;
    }

    // Наскільки точка — «гірка» (сірий бетон): 0 — трава, 1 — повністю гірка. Дорога поза пандусом не рахується.
    function rampness(x, z) {
        var q = parts(x, z);
        var rise = Math.max(q.ramp, q.plateau) - CFG.platformH;
        return smooth(0.3, 2.2, rise);
    }

    // Колір поверхні в точці (для вершин рельєфу): [r, g, b]. Плитку додає шейдер.
    function colorAt(x, z, out) {
        var q = parts(x, z);
        out = out || [0, 0, 0];

        // Трава: насичена, світла, як у відео; дуже легка зміна відтінку, щоб поле не було пласким
        var n = Math.sin(x * 0.011 + z * 0.007) * 0.5 + 0.5;
        var cr = 0.30 + 0.03 * n, cg = 0.72 - 0.04 * n, cb = 0.20;

        // Гірка (пандус і верхня плита): сірий бетон — той самий матеріал, інший колір
        var g = rampness(x, z);
        if (g > 0) {
            cr += (0.60 - cr) * g; cg += (0.60 - cg) * g; cb += (0.62 - cb) * g;
        }
        // Асфальт: дорога від майданчика до початку гірки
        var roadW = (1 - smooth(CFG.roadHalf - 0.4, CFG.roadHalf + 0.5, Math.abs(z))) *
            smooth(CFG.roadX0 - 2, CFG.roadX0 + 1, x) * (1 - smooth(CFG.rampX0 + 4, CFG.rampX0 + 16, x));
        if (roadW > 0) {
            cr += (0.20 - cr) * roadW; cg += (0.20 - cg) * roadW; cb += (0.22 - cb) * roadW;
        }
        // Круглий майданчик: сірий, світліший бордюр
        var onPlat = 1 - smooth(CFG.platformR - 0.2, CFG.platformR + 0.8, q.r);
        if (onPlat > 0) {
            var curb = smooth(CFG.platformR - 1.8, CFG.platformR - 0.6, q.r);
            var pv = 0.56 + 0.1 * curb;
            cr += (pv - cr) * onPlat; cg += (pv + 0.01 - cg) * onPlat; cb += (pv + 0.03 - cb) * onPlat;
        }
        out[0] = cr; out[1] = cg; out[2] = cb;
        return out;
    }

    // ---------------------------------------------------------------- перешкоди
    // На карті немає ні дерев, ні каміння: списки порожні (інтерфейс лишився, щоб фізика не мінялась).
    var props = { trees: [], rocks: [] };
    var obstacles = [];

    function resolveObstacles(x, z, radius) {
        return { x: x, z: z, hit: false };
    }

    // Тримає точку всередині світу (коло радіуса limitR)
    function clampToWorld(x, z, margin) {
        var lim = CFG.limitR - (margin || 0);
        var r = Math.sqrt(x * x + z * z);
        if (r <= lim) return { x: x, z: z, hit: false };
        var k = lim / r;
        return { x: x * k, z: z * k, hit: true };
    }

    function spawnPoint() {
        return { x: 0, y: heightAt(0, 0), z: 0 };
    }

    return {
        CFG: CFG,
        heightAt: heightAt,
        normalAt: normalAt,
        colorAt: colorAt,
        checkerAt: checkerAt,
        rampness: rampness,
        parts: parts,
        plateauDist: plateauDist,
        roadProfile: roadProfile,
        props: props,
        obstacles: obstacles,
        resolveObstacles: resolveObstacles,
        clampToWorld: clampToWorld,
        spawnPoint: spawnPoint,
        smooth: smooth
    };
});
