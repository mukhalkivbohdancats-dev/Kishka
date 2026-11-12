// =====================================================================
// KishkaBlox — світ гри «Realistic cars»: рельєф, майданчик, дорога, пандус, верхня плита, перешкоди.
// Чиста математика без WebGL: працює і в грі (window.KishkaWorld), і в тестах Node (require).
//
// Одиниці — «студи» (як у Roblox): персонаж заввишки 5, ходить 16 студів/с.
// Вся висота землі — одна гладка функція heightAt(x, z). Ніяких коробок-сходинок: усі переходи — smoothstep.
//
// Задум карти (вид зверху, вісь +X вправо):
//   • (0,0)  — великий круглий сірий майданчик (радіус 24), тут з'являється персонаж;
//   • від майданчика на +X йде дорога (шириною 12) до довгого плавного пандуса (80 студів завдовжки, підйом 14);
//   • пандус переходить у широку верхню плиту (центр x=180, 80×104) — її краї плавно сходять до землі;
//   • навколо — велика зелена місцевість із пагорбами; по краю світу — гори, які природно обмежують карту.
// =====================================================================
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.KishkaWorld = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var CFG = {
        platformR: 24,          // радіус круглого майданчика
        platformH: 0.6,         // висота майданчика над рівнем землі
        platformEdge: 1.6,      // ширина м'якого бордюру
        roadHalf: 6,            // півширини дороги
        roadX0: 20,             // де дорога починається (вона виходить із майданчика)
        rampX0: 60,             // початок підйому
        rampX1: 140,            // кінець підйому (довжина пандуса 80)
        rampH: 14,              // висота верхньої плити
        plateau: { cx: 180, cz: 0, hx: 40, hz: 52, r: 18, fall: 34 },
        limitR: 265,            // межа світу (радіус); далі — не пройти
        mountainFrom: 252,
        mountainTo: 300,
        mountainH: 26,
        meshHalf: 300           // рельєф намальований на ±300
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

    function hills(x, z) {
        return 3.4 * Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017 + 0.4) +
            2.4 * Math.sin(x * 0.043 + z * 0.031 + 2.0) +
            1.3 * Math.sin(x * 0.09 - z * 0.07 + 0.5) * Math.cos(x * 0.05 + 1.1) +
            0.5 * Math.sin(x * 0.19 + z * 0.23);
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
        var farMask = smooth(40, 120, r);
        var corridorX = smooth(0, 40, x) * (1 - smooth(230, 270, x));
        var corridor = (1 - smooth(22, 60, Math.abs(z))) * corridorX;
        var pd = plateauDist(x, z);
        var plateauMask = smooth(0, 40, pd);
        var base = hills(x, z) * farMask * (1 - corridor) * plateauMask;
        var mountain = CFG.mountainH * smooth(CFG.mountainFrom, CFG.mountainTo, r);
        var ground = base + mountain;

        // Круглий майданчик
        var platform = CFG.platformH * (1 - smooth(CFG.platformR, CFG.platformR + CFG.platformEdge, r));

        // Дорога + пандус (коридор уздовж +X). Боки пандуса сходять до землі тим довше, чим він вищий
        var p = roadProfile(x);
        var gate = smooth(CFG.roadX0 - 6, CFG.roadX0 + 4, x) * (1 - smooth(190, 215, x));
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

    // Колір поверхні в точці (для вершин рельєфу): [r, g, b]
    function colorAt(x, z, out) {
        var q = parts(x, z);
        var h = heightAt(x, z);
        out = out || [0, 0, 0];

        // Трава: легка строкатість + відтінок за висотою
        var n = Math.sin(x * 0.37 + z * 0.11) * Math.sin(z * 0.29 - x * 0.07);
        var g0 = 0.33 + 0.045 * n, g1 = 0.56 + 0.05 * n, g2 = 0.2 + 0.03 * n;
        var hi = smooth(2, 12, h);
        var cr = g0 + 0.04 * hi, cg = g1 - 0.03 * hi, cb = g2;
        // Гори — сіро-зелена скеля
        var rock = smooth(CFG.mountainFrom + 10, CFG.mountainTo, q.r);
        cr += (0.46 - cr) * rock; cg += (0.47 - cg) * rock; cb += (0.45 - cb) * rock;

        // Верхня плита — світлий бетон, що сходить на траву на схилі
        var concrete = 1 - smooth(-2, 9, q.pd);
        if (concrete > 0) {
            cr += (0.66 - cr) * concrete; cg += (0.67 - cg) * concrete; cb += (0.68 - cb) * concrete;
        }
        // Дорога й пандус: темний асфальт у межах ширини дороги
        var roadW = (1 - smooth(CFG.roadHalf - 0.4, CFG.roadHalf + 0.5, Math.abs(z))) * smooth(CFG.roadX0 - 2, CFG.roadX0 + 1, x) * (1 - smooth(CFG.rampX1 + 4, CFG.rampX1 + 10, x));
        if (roadW > 0) {
            cr += (0.19 - cr) * roadW; cg += (0.19 - cg) * roadW; cb += (0.21 - cb) * roadW;
        }
        // Круглий майданчик: сірий, світліший бордюр
        var onPlat = 1 - smooth(CFG.platformR - 0.2, CFG.platformR + 0.8, q.r);
        if (onPlat > 0) {
            var curb = smooth(CFG.platformR - 1.8, CFG.platformR - 0.6, q.r);
            var pv = 0.56 + 0.12 * curb;
            cr += (pv - cr) * onPlat; cg += (pv + 0.01 - cg) * onPlat; cb += (pv + 0.03 - cb) * onPlat;
        }
        out[0] = cr; out[1] = cg; out[2] = cb;
        return out;
    }

    // ---------------------------------------------------------------- перешкоди (дерева, каміння)
    function rng(seed) {
        var s = seed >>> 0;
        return function () {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
            return s / 4294967296;
        };
    }

    function buildProps() {
        var rand = rng(20261110);
        var trees = [], rocks = [];
        var tries = 0;
        while (trees.length < 150 && tries < 4000) {
            tries++;
            var a = rand() * Math.PI * 2;
            var rr = 46 + rand() * 200;
            var x = Math.cos(a) * rr, z = Math.sin(a) * rr;
            var q = parts(x, z);
            // Не на дорозі, не біля пандуса, не на верхній плиті й не на крутому схилі
            if (Math.abs(z) < 44 && x > -10 && x < 262) continue;
            if (q.pd < 14) continue;
            if (q.r > CFG.limitR - 12) continue;
            var h = heightAt(x, z);
            var s = 0.8 + rand() * 0.9;
            trees.push({ x: x, z: z, y: h, s: s, r: 0.9 * s, tone: rand() });
        }
        tries = 0;
        while (rocks.length < 36 && tries < 2000) {
            tries++;
            var a2 = rand() * Math.PI * 2;
            var rr2 = 40 + rand() * 210;
            var x2 = Math.cos(a2) * rr2, z2 = Math.sin(a2) * rr2;
            if (Math.abs(z2) < 30 && x2 > -10 && x2 < 262) continue;
            if (parts(x2, z2).pd < 10) continue;
            var s2 = 1.2 + rand() * 2.4;
            rocks.push({ x: x2, z: z2, y: heightAt(x2, z2), s: s2, r: s2 * 1.05, rot: rand() * 6.28 });
        }
        return { trees: trees, rocks: rocks };
    }

    var props = buildProps();
    var obstacles = [];
    props.trees.forEach(function (t) { obstacles.push({ x: t.x, z: t.z, r: t.r }); });
    props.rocks.forEach(function (t) { obstacles.push({ x: t.x, z: t.z, r: t.r }); });

    // Виштовхує круг (x, z, radius) із перешкод. Повертає { x, z, hit }
    function resolveObstacles(x, z, radius) {
        var hit = false;
        for (var i = 0; i < obstacles.length; i++) {
            var o = obstacles[i];
            var dx = x - o.x;
            if (dx > 20 || dx < -20) continue;
            var dz = z - o.z;
            var min = o.r + radius;
            var d2 = dx * dx + dz * dz;
            if (d2 < min * min) {
                if (d2 < 1e-8) { dx = 1; dz = 0; d2 = 1; }       // центри збіглися: напрямок виштовхування довільний
                var d = Math.sqrt(d2);
                x = o.x + (dx / d) * min;
                z = o.z + (dz / d) * min;
                hit = true;
            }
        }
        return { x: x, z: z, hit: hit };
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
