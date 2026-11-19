// =====================================================================
// KishkaBlox — світ гри «Realistic cars»: об'ємний рельєф, майданчик, дорога й велика гірка-трамплін.
// Чиста математика без WebGL: працює і в грі (window.KishkaWorld), і в тестах Node (require), і на сервері.
//
// Одиниці — «студи» (як у Roblox): персонаж заввишки 5, ходить 16 студів/с. 1 студ = 0.28 м.
//
// КАРТА (вид зверху, вісь +X вправо):
//   • (0,0) — круглий сірий майданчик (радіус 26), тут з'являється персонаж;
//   • від майданчика на +X йде асфальтова дорога до підніжжя гірки;
//   • ГІРКА — як на відео-орієнтирі, але ВИЩА (було 52 студи, стало 120 ≈ 42 м): широка (144 студи) сіра плита з тим самим
//     рівним підйомом (~12°, тож довжина підйому 560 студів), темними вертикальними бічними стінами, величезним плоским верхом
//     і різким краєм: з нього можна злетіти.
//     Це суцільне тіло: у нього можна в'їхати, лише знизу по схилу; збоку — стіна;
//   • навколо — велика рівнина-«полігон» (рівна земля довкола гірки й дороги), а далі об'ємний рельєф:
//     хвилясті пагорби, долини, гряди гір, кругла «чаша»-кратери й горби-трампліни різної висоти;
//   • по краю карти — гори, що «закривають» горизонт (за межу не виїхати).
// Площа карти у 15 разів більша за попередню: радіус 640 -> 2480 студів (площа росте з квадратом радіуса).
//
// Трава й гірка — ОДИН матеріал: та сама «шахова» плитка (її малює шейдер за світовими координатами, див. game.js),
// різниться лише основний колір (зелений / сірий), як у відео-орієнтирі.
// =====================================================================
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.KishkaWorld = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var CFG = {
        platformR: 26,          // радіус круглого майданчика
        platformH: 0.6,         // висота майданчика над землею
        platformEdge: 1.6,      // ширина м'якого бордюру
        roadHalf: 9,            // півширина дороги
        roadX0: 22,             // де дорога виходить із майданчика
        // Гірка: тіло з прямокутним планом, підйом уздовж +X. Кути профілю скруглені (e — півширина скруглення).
        ramp: { x0: 140, lenRamp: 560, lenTop: 260, hw: 72, h: 120, e: 18 },
        plazaHalf: 170,         // півширина рівного «полігону» довкола дороги й гірки
        plazaFade: 260,         // ширина переходу від рівного полігону до пагорбів
        limitR: 2480,           // межа світу (радіус) — площа в 15 разів більша за стару (640)
        meshHalf: 2520,         // рельєф намальований на ±2520
        tile: 8,                // розмір плитки «шахової» текстури (трава)
        rampTile: 4,            // розмір плитки на гірці
        killY: -400             // нижче цього — повернення на майданчик
    };
    CFG.ramp.xs = CFG.ramp.x0 - CFG.ramp.e;                                  // початок плану гірки (де висота = 0)
    CFG.ramp.xEnd = CFG.ramp.x0 + CFG.ramp.lenRamp + CFG.ramp.lenTop;        // різкий край зверху
    CFG.ramp.slope = CFG.ramp.h / CFG.ramp.lenRamp;                          // тангенс кута підйому

    // Матеріали поверхні: зчеплення шин (grip), опір кочення (roll) і назва
    var SURF = {
        GRASS: 0, ASPHALT: 1, CONCRETE: 2, DIRT: 3,
        table: [
            { name: 'grass', grip: 0.86, roll: 1.0 },
            { name: 'asphalt', grip: 1.0, roll: 0.7 },
            { name: 'concrete', grip: 0.96, roll: 0.75 },
            { name: 'dirt', grip: 0.72, roll: 1.3 }
        ]
    };

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function smooth(e0, e1, x) {
        var t = clamp((x - e0) / (e1 - e0), 0, 1);
        return t * t * (3 - 2 * t);
    }
    function mixv(a, b, t) { return a + (b - a) * t; }

    // ---------------------------------------------------------------- шум (детермінований: однаковий на клієнті, сервері й у тестах)
    function hash2(ix, iz, seed) {
        var h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul((seed | 0) + 1013, 1274126177);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    }
    function vnoise(x, z, seed) {
        var ix = Math.floor(x), iz = Math.floor(z);
        var fx = x - ix, fz = z - iz;
        var u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
        var v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
        var a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    function fbm(x, z, oct, seed) {
        var s = 0, amp = 0.5, f = 1, norm = 0;
        for (var i = 0; i < oct; i++) {
            s += amp * vnoise(x * f, z * f, seed + i * 17);
            norm += amp;
            amp *= 0.5; f *= 2.03;
        }
        return s / norm;               // 0..1, середнє ~0.5
    }

    // ---------------------------------------------------------------- гірка
    var RP = CFG.ramp;
    function inRampPlan(x, z) { return x >= RP.xs && x <= RP.xEnd && z >= -RP.hw && z <= RP.hw; }

    // Висота верху гірки (над нулем) і похідна dh/dx у точці x уздовж плити. Скруглені кути профілю — параболи.
    function rampProfile(x, out) {
        var t = x - RP.x0, s = RP.slope, e = RP.e, H = RP.h, Lr = RP.lenRamp;
        var h, d;
        if (t <= -e) { h = 0; d = 0; }
        else if (t < e) { h = s * (t + e) * (t + e) / (4 * e); d = s * (t + e) / (2 * e); }
        else if (t <= Lr - e) { h = s * t; d = s; }
        else if (t < Lr + e) { var q = Lr + e - t; h = H - s * q * q / (4 * e); d = s * q / (2 * e); }
        else { h = H; d = 0; }
        if (out) { out.h = h; out.d = d; }
        return h;
    }
    var _rp = { h: 0, d: 0 };
    function rampTop(x, z) {
        if (!inRampPlan(x, z)) return -Infinity;
        return rampProfile(x, _rp);
    }

    // ---------------------------------------------------------------- рельєф (без гірки)
    // Відстань до осі дороги/гірки (відрізок від майданчика до кінця гірки)
    function plazaDist(x, z) {
        var x0 = -30, x1 = RP.xEnd + 620;      // за краєм гірки — довга рівна зона приземлення (з високої гірки летять далеко)
        var cx = clamp(x, x0, x1);
        var dx = x - cx;
        return Math.sqrt(dx * dx + z * z);
    }

    // Горби-трампліни: у кожній клітинці 460×460 може бути круглий горб (висота 5..16, радіус 38..95)
    // або чаша-кратер (глибина 6..14). Рахуємо клітинку точки та сусідні вздовж обох осей.
    var MOUND_CELL = 460;
    function mounds(x, z) {
        var gx = x / MOUND_CELL, gz = z / MOUND_CELL;
        var ix = Math.floor(gx), iz = Math.floor(gz);
        var sum = 0;
        for (var a = -1; a <= 1; a++) {
            for (var b = -1; b <= 1; b++) {
                var cx = ix + a, cz = iz + b;
                var kind = hash2(cx, cz, 91);
                if (kind < 0.38) continue;                                       // у частині клітинок нічого немає
                var px = (cx + 0.15 + 0.7 * hash2(cx, cz, 92)) * MOUND_CELL;
                var pz = (cz + 0.15 + 0.7 * hash2(cx, cz, 93)) * MOUND_CELL;
                var R = 38 + 57 * hash2(cx, cz, 94);
                var dx = x - px, dz = z - pz;
                var d2 = dx * dx + dz * dz;
                if (d2 >= R * R) continue;
                var t = 1 - Math.sqrt(d2) / R;
                var prof = t * t * (3 - 2 * t);                                  // м'який дзвін
                var H = 5 + 11 * hash2(cx, cz, 95);
                sum += (kind > 0.8 ? -0.85 * H : H) * prof;                      // ~20% — чаші
            }
        }
        return sum;
    }

    // Об'ємний рельєф: великі пагорби, середні хвилі, дрібні горби, гряди гір і гірський пояс по краю карти.
    function terrainRaw(x, z) {
        var r = Math.sqrt(x * x + z * z);
        var big = (fbm(x * 0.0016 + 11, z * 0.0016 - 7, 4, 3) - 0.5) * 2;        // -1..1, довжина хвилі ~600
        var mid = (fbm(x * 0.0065 - 5, z * 0.0065 + 19, 3, 21) - 0.5) * 2;       // ~150
        var small = (vnoise(x * 0.034 + 3, z * 0.034 - 11, 5) - 0.5) * 2;        // ~30
        var fine = (vnoise(x * 0.13 - 8, z * 0.13 + 2, 8) - 0.5) * 2;            // ~8
        var rn = vnoise(x * 0.00105 + 7, z * 0.00105 + 3, 41);
        var ridge = 1 - Math.abs(2 * rn - 1);
        var mountains = ridge * ridge * ridge * 150 * smooth(650, 1500, r);       // далекі гряди
        var rim = 190 * smooth(CFG.limitR - 340, CFG.limitR + 40, r);             // «стіна» гір по краю
        return big * 62 + mid * 13 + small * 1.7 + fine * 0.32 + mounds(x, z) + mountains + rim;
    }

    function plazaMask(x, z) {                  // 0 — рівний полігон, 1 — повний рельєф
        return smooth(CFG.plazaHalf, CFG.plazaHalf + CFG.plazaFade, plazaDist(x, z));
    }

    // Висота землі без гірки
    function groundHeight(x, z) {
        var m = plazaMask(x, z);
        var h = 0;
        if (m > 0) h = terrainRaw(x, z) * m;
        // на полігоні лише дуже легка нерівність, щоб асфальт і трава не були «стеклом»
        if (m < 1) h += (vnoise(x * 0.11, z * 0.11, 13) - 0.5) * 0.12 * (1 - m);
        // круглий майданчик
        var r = Math.sqrt(x * x + z * z);
        if (r < CFG.platformR + CFG.platformEdge) {
            var pl = CFG.platformH * (1 - smooth(CFG.platformR, CFG.platformR + CFG.platformEdge, r));
            if (pl > h) h = pl;
        }
        return h;
    }

    function heightAt(x, z) {
        var g = groundHeight(x, z);
        if (x >= RP.xs && x <= RP.xEnd && z >= -RP.hw && z <= RP.hw) {
            var t = rampProfile(x, null);
            if (t > g) return t;
        }
        return g;
    }

    // Нормаль землі (без гірки) — скінченні різниці
    function groundNormal(x, z, out) {
        var e = 0.7;
        var dx = groundHeight(x + e, z) - groundHeight(x - e, z);
        var dz = groundHeight(x, z + e) - groundHeight(x, z - e);
        var nx = -dx / (2 * e), ny = 1, nz = -dz / (2 * e);
        var l = Math.sqrt(nx * nx + ny * ny + nz * nz);
        out = out || [0, 0, 0];
        out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
        return out;
    }

    // Нормаль верхньої поверхні в точці: на гірці — аналітична, поза нею — рельєф
    function normalAt(x, z, out) {
        out = out || [0, 0, 0];
        if (inRampPlan(x, z)) {
            var t = rampProfile(x, _rp);
            if (t > groundHeight(x, z)) {
                var nx = -_rp.d, l = Math.sqrt(nx * nx + 1);
                out[0] = nx / l; out[1] = 1 / l; out[2] = 0;
                return out;
            }
        }
        return groundNormal(x, z, out);
    }

    // Матеріал поверхні під точкою (для зчеплення шин і звуку)
    function surfaceAt(x, z) {
        if (inRampPlan(x, z) && rampProfile(x, null) > groundHeight(x, z) + 0.02) return SURF.CONCRETE;
        var r = Math.sqrt(x * x + z * z);
        if (r < CFG.platformR + 0.6) return SURF.CONCRETE;
        if (Math.abs(z) < CFG.roadHalf && x > CFG.roadX0 && x < RP.xs + 4) return SURF.ASPHALT;
        var n = groundNormal(x, z, _n3);
        if (n[1] < 0.8) return SURF.DIRT;                                        // крутий схил — земля без трави
        return SURF.GRASS;
    }
    var _n3 = [0, 0, 0];

    // ---------------------------------------------------------------- зіткнення з твердим тілом гірки
    // Точка (x,y,z) всередині гірки? Повертає глибину проникнення і нормаль виходу (найкоротший шлях назовні).
    // Земля теж враховується: якщо y нижче землі — глибина = висота землі - y, нормаль — нормаль землі.
    var _c = { depth: 0, nx: 0, ny: 1, nz: 0, solid: false };
    function contact(x, y, z, out) {
        out = out || _c;
        out.depth = 0; out.nx = 0; out.ny = 1; out.nz = 0; out.solid = false;
        var g = groundHeight(x, z);
        if (g > y) {
            out.depth = g - y;
            groundNormal(x, z, _n3);
            out.nx = _n3[0]; out.ny = _n3[1]; out.nz = _n3[2];
        }
        if (inRampPlan(x, z)) {
            var top = rampProfile(x, _rp);
            if (top > y && top > g - 1e-6) {
                // всередині гірки: вибираємо найкоротший вихід — вгору (по нормалі схилу), вбік або через різкий край
                var nxs = -_rp.d, nl = Math.sqrt(nxs * nxs + 1);
                var upDepth = (top - y) / nl;
                var best = upDepth, bnx = nxs / nl, bny = 1 / nl, bnz = 0;
                var sideL = z + RP.hw, sideR = RP.hw - z, back = RP.xEnd - x;
                if (sideL < best) { best = sideL; bnx = 0; bny = 0; bnz = -1; }
                if (sideR < best) { best = sideR; bnx = 0; bny = 0; bnz = 1; }
                if (back < best && top >= RP.h - 0.01) { best = back; bnx = 1; bny = 0; bnz = 0; }
                if (best > out.depth) { out.depth = best; out.nx = bnx; out.ny = bny; out.nz = bnz; out.solid = true; }
            }
        }
        return out.depth > 0 ? out : null;
    }

    // Промінь униз із точки (x, y, z): повертає відстань до поверхні (або -1, якщо під точкою нічого немає ближче maxLen)
    // й записує нормаль та матеріал у out. Якщо точка всередині гірки — промінь «не бачить» землі (колесо в стіні).
    function rayDown(x, y, z, maxLen, out) {
        var g = groundHeight(x, z);
        var h = g, wall = false;
        if (inRampPlan(x, z)) {
            var top = rampProfile(x, _rp);
            if (top > g) {
                if (top > y + 0.35) wall = true;       // верх гірки вище за початок променя: це стіна, а не земля
                else h = top;
            }
        }
        if (wall) return -1;
        var d = y - h;
        if (d < -0.35 || d > maxLen) return -1;
        out = out || {};
        normalAt(x, z, _n3);
        out.nx = _n3[0]; out.ny = _n3[1]; out.nz = _n3[2];
        out.surf = surfaceAt(x, z);
        out.h = h;
        return Math.max(0, d);
    }

    // ---------------------------------------------------------------- вигляд (кольори вершин рельєфу; плитку додає шейдер)
    function checkerAt(x, z) {
        var t = CFG.tile;
        return ((Math.floor(x / t) + Math.floor(z / t)) & 1) ? 1 : 0;
    }
    function rampness(x, z) { return inRampPlan(x, z) && rampProfile(x, null) > groundHeight(x, z) + 0.02 ? 1 : 0; }

    function colorAt(x, z, out) {
        var g = groundHeight(x, z);
        var ny = groundNormal(x, z, _n3)[1];
        var ao = clamp(1 + (g - 0.5 * (groundHeight(x + 9, z) + groundHeight(x - 9, z))) * 0.025, 0.86, 1.1);
        return colorCore(x, z, g, ny, ao, out);
    }
    // Те саме, але з уже відомими висотою, нормаллю (y) і «затіненням у заглибинах» (ao) — для швидкої побудови шматків рельєфу
    function colorFast(x, z, g, ny, hMean, out) {
        return colorCore(x, z, g, ny, clamp(1 + (g - hMean) * 0.025, 0.86, 1.1), out);
    }
    function colorCore(x, z, g, ny, ao, out) {
        out = out || [0, 0, 0];
        var n = Math.sin(x * 0.011 + z * 0.007) * 0.5 + 0.5;
        // трава: насичена, світла, як у відео; легка зміна відтінку
        var cr = 0.30 + 0.03 * n, cg = 0.72 - 0.04 * n, cb = 0.20;
        // крутий схил -> земля, на великих висотах — світлий камінь
        var steep = smooth(0.80, 0.62, ny);
        if (steep > 0) { cr += (0.52 - cr) * steep; cg += (0.42 - cg) * steep; cb += (0.27 - cb) * steep; }
        var high = smooth(95, 170, g);
        if (high > 0) { cr += (0.62 - cr) * high; cg += (0.62 - cg) * high; cb += (0.64 - cb) * high; }
        cr *= ao; cg *= ao; cb *= ao;
        // асфальт: дорога від майданчика до підніжжя гірки
        var roadW = (1 - smooth(CFG.roadHalf - 0.4, CFG.roadHalf + 0.5, Math.abs(z))) *
            smooth(CFG.roadX0 - 2, CFG.roadX0 + 1, x) * (1 - smooth(RP.xs + 2, RP.xs + 8, x));
        if (roadW > 0) { cr += (0.20 - cr) * roadW; cg += (0.20 - cg) * roadW; cb += (0.22 - cb) * roadW; }
        // круглий майданчик: сірий, світліший бордюр
        var r = Math.sqrt(x * x + z * z);
        var onPlat = 1 - smooth(CFG.platformR - 0.2, CFG.platformR + 0.8, r);
        if (onPlat > 0) {
            var curb = smooth(CFG.platformR - 1.8, CFG.platformR - 0.6, r);
            var pv = 0.56 + 0.1 * curb;
            cr += (pv - cr) * onPlat; cg += (pv + 0.01 - cg) * onPlat; cb += (pv + 0.03 - cb) * onPlat;
        }
        out[0] = cr; out[1] = cg; out[2] = cb;
        return out;
    }

    // ---------------------------------------------------------------- межі, перешкоди
    var props = { trees: [], rocks: [] };
    var obstacles = [];
    function resolveObstacles(x, z, radius) { return { x: x, z: z, hit: false }; }

    function clampToWorld(x, z, margin) {
        var lim = CFG.limitR - (margin || 0);
        var r = Math.sqrt(x * x + z * z);
        if (r <= lim) return { x: x, z: z, hit: false };
        var k = lim / r;
        return { x: x * k, z: z * k, hit: true };
    }

    function spawnPoint() { return { x: 0, y: heightAt(0, 0), z: 0 }; }

    return {
        CFG: CFG, SURF: SURF, RAMP: RP,
        heightAt: heightAt, groundHeight: groundHeight, normalAt: normalAt, groundNormal: groundNormal,
        surfaceAt: surfaceAt, contact: contact, rayDown: rayDown,
        rampTop: rampTop, rampProfile: rampProfile, inRampPlan: inRampPlan,
        colorAt: colorAt, colorFast: colorFast, checkerAt: checkerAt, rampness: rampness,
        props: props, obstacles: obstacles, resolveObstacles: resolveObstacles,
        clampToWorld: clampToWorld, spawnPoint: spawnPoint, smooth: smooth,
        vnoise: vnoise, fbm: fbm, hash2: hash2, plazaDist: plazaDist
    };
});
