// =====================================================================
// KishkaBlox — світ гри «Realistic cars»: об'ємний рельєф, майданчик, дорога й велика гірка-трамплін.
// Чиста математика без WebGL: працює і в грі (window.KishkaWorld), і в тестах Node (require), і на сервері.
//
// Одиниці — «студи» (як у Roblox): персонаж заввишки 5, ходить 16 студів/с. 1 студ = 0.28 м.
//
// КАРТА (вид зверху, вісь +X вправо):
//   • (0,0) — круглий сірий майданчик (радіус 26), тут з'являється персонаж;
//   • від майданчика на +X йде асфальтова дорога до підніжжя гірки;
//   • ГІРКА (листопад 2026): у 17 разів ДОВША за стару (підйом 560 -> 9520 студів) і КРУТІША (12° -> 18°), тому висота
//     зросла до 3100 студів (≈ 1085 м): щоб заїхати нагору, треба довго й упевнено їхати. Вхід у підйом і вихід на верх
//     скруглені дуже плавно (радіус кілька кілометрів), щоб підвіска не «пробивалася» й колеса не відлітали.
//     Широка (144 студи) сіра плита з темними вертикальними бічними стінами, плоским верхом і різким краєм;
//     це суцільне тіло: у нього можна в'їхати, лише знизу по схилу; збоку — стіна;
//   • НА ВЕРХУ ГІРКИ — велика коробка (1/5 площі верху) з кодовими дверима, камерою з бомбою й червоною кнопкою (див. SUMMIT);
//   • БУНКЕР за майданчиком, з протилежного від гірки боку (див. BUNKER), і СИРЕНИ навколо круглого майданчика (SIRENS);
//   • МІСТО за ~500 м від майданчика (CITY): квартали 143×143 студи (≈ 50 м), будинки й висотки, до яких можна зайти;
//   • навколо — велика рівнина-«полігон» (рівна земля довкола гірки й дороги), а далі об'ємний рельєф:
//     хвилясті пагорби, долини, гряди гір, кругла «чаша»-кратери й горби-трампліни різної висоти;
//   • по краю карти — гори, що «закривають» горизонт (за межу не виїхати).
// Площа карти у 50 разів більша за попередню версію (радіус 2480 -> 17500 студів: площа росте з квадратом радіуса, 7.06² ≈ 50).
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
        // x0 — де лінія підйому перетинає землю; e — півдовжина скруглення на вході й виході (радіус кривої ≈ 2e/нахил ≈ 4 км);
        // h/lenRamp = 3100/9520 = 0.3256 -> 18°. Плоский верх: від x0+lenRamp+e на lenTop студів.
        ramp: { x0: 900, lenRamp: 9520, lenTop: 420, hw: 72, h: 3100, e: 700 },
        plazaHalf: 170,         // півширина рівного «полігону» довкола дороги й гірки
        plazaFade: 260,         // ширина переходу від рівного полігону до пагорбів
        limitR: 17500,          // межа світу (радіус): площа в 50 разів більша за версію з радіусом 2480
        meshHalf: 17540,        // рельєф намальований на ±17540
        tile: 8,                // розмір плитки «шахової» текстури (трава)
        rampTile: 4,            // розмір плитки на гірці
        killY: -400             // нижче цього — повернення на майданчик
    };
    CFG.ramp.xs = CFG.ramp.x0 - CFG.ramp.e;                                  // початок плану гірки (де висота = 0)
    CFG.ramp.xTop = CFG.ramp.x0 + CFG.ramp.lenRamp + CFG.ramp.e;             // де починається плоский верх
    CFG.ramp.xEnd = CFG.ramp.xTop + CFG.ramp.lenTop;                         // різкий край зверху
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
        // місто стоїть на рівному майданчику: рельєф плавно «стирається» до нуля
        var cmk = cityMask(x, z);
        if (cmk > 0) { h *= (1 - cmk); m = Math.min(m, 1 - cmk); }
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
        var cp = cityPlot(x, z);
        if (cp === 0) return SURF.ASPHALT;
        if (cp === 1) return SURF.CONCRETE;
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
        structContact(x, y, z, out);
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
        // місто: асфальт вулиць із жовтою розміткою посередині й світлий бетон під будинками
        var cp = cityPlot(x, z);
        if (cp >= 0) {
            var pv2, pg2, pb2;
            if (cp === 1) { pv2 = 0.60; pg2 = 0.60; pb2 = 0.62; }
            else {
                pv2 = 0.17; pg2 = 0.17; pb2 = 0.19;
                var uu = (x - CITY.x0) % CITY.pitch, vv = (z - CITY.z0) % CITY.pitch;
                if (uu < 0) uu += CITY.pitch; if (vv < 0) vv += CITY.pitch;
                var du = Math.abs(uu), dv = Math.abs(vv);
                var onU = du < 1.2 || Math.abs(du - CITY.pitch) < 1.2, onV = dv < 1.2 || Math.abs(dv - CITY.pitch) < 1.2;
                if ((onU && (Math.floor(vv / 12) & 1)) || (onV && (Math.floor(uu / 12) & 1))) { pv2 = 0.82; pg2 = 0.7; pb2 = 0.15; }
            }
            cr = pv2; cg = pg2; cb = pb2;
        }
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

    // ================================================================= СПОРУДИ
    // Усі розміри — студи. Споруди складаються з твердих коробок (solids): ними керує contact() і resolveObstacles().
    var solids = [];                       // усі статичні коробки: { x0, x1, y0, y1, z0, z1, group }
    var groups = [];                       // групи для швидкого відсіву: { name, x0, x1, z0, z1, list }
    function addBox(list, x0, x1, y0, y1, z0, z1) {
        var b = { x0: x0, x1: x1, y0: y0, y1: y1, z0: z0, z1: z1, on: true };
        list.push(b); solids.push(b);
        return b;
    }
    function addGroup(name, list) {
        var g = { name: name, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, list: list };
        for (var i = 0; i < list.length; i++) {
            var b = list[i];
            if (b.x0 < g.x0) g.x0 = b.x0; if (b.x1 > g.x1) g.x1 = b.x1;
            if (b.z0 < g.z0) g.z0 = b.z0; if (b.z1 > g.z1) g.z1 = b.z1;
        }
        groups.push(g);
        return g;
    }

    // ---- КОРОБКА НА ВЕРХУ ГІРКИ: рівно посередині переднього краю верху (з боку підйому), займає 1/5 площі верху.
    // Верх: lenTop × 2hw = 420 × 144; коробка 96 × 126 = 12096 ≈ 60480 / 5. Усередині камера 36 × 36 × 32 з бомбою й червоною кнопкою,
    // вхід через металеві двері на передній стіні (вони їдуть угору в стіну, їх не видно), код-панель праворуч від дверей.
    var SUMMIT = (function () {
        var bx0 = RP.xTop + 30, depth = 96, hw = 63, h = 38, wall = 3;
        var top = RP.h;
        var S = {
            top: top, x0: bx0, x1: bx0 + depth, hw: hw, h: h, wall: wall,
            ch: { x0: bx0 + wall, x1: bx0 + wall + 36, hz: 18, h: 32 },       // камера
            door: { x0: bx0 + 0.5, x1: bx0 + 2.5, hz: 7, h: 15 },            // отвір дверей: z ±7, висота 15
            keypad: { x: bx0, y: top + 6.5, z: 11 },                          // код-панель на передній стіні, праворуч від дверей (+Z)
            bomb: { x: bx0 + wall + 24, z: 0, h: 22, r: 5 },                  // бомба стоїть носом угору в центрі камери
            button: { x: bx0 + wall + 9, z: 0, h: 4 },                        // червона кнопка на постаменті перед бомбою
            openMs: 5000, openAnimMs: 900,
            doorSolid: null, lidSolid: null, open: 0, lid: 0, list: []
        };
        var L = S.list, c = S.ch, d = S.door;
        addBox(L, c.x1, bx0 + depth, top, top + h, -hw, hw);                  // задня маса
        addBox(L, bx0, c.x1, top, top + h, c.hz, hw);                         // ліва маса
        addBox(L, bx0, c.x1, top, top + h, -hw, -c.hz);                       // права маса
        addBox(L, bx0, c.x0, top, top + h, -c.hz, -d.hz);                     // передня стіна: ліворуч від дверей
        addBox(L, bx0, c.x0, top, top + h, d.hz, c.hz);                       //                праворуч від дверей
        addBox(L, bx0, c.x0, top + d.h, top + h, -d.hz, d.hz);                // перемичка над дверима
        S.lidSolid = addBox(L, c.x0, c.x1, top + c.h, top + h, -c.hz, c.hz);  // дах камери (відкривається при запуску)
        S.doorSolid = addBox(L, d.x0, d.x1, top, top + d.h, -d.hz, d.hz);     // сама стулка дверей
        S.bombSolid = addBox(L, S.bomb.x - 4.6, S.bomb.x + 4.6, top, top + S.bomb.h, S.bomb.z - 4.6, S.bomb.z + 4.6);   // бомба (зникає, коли злітає)
        S.buttonSolid = addBox(L, S.button.x - 2.3, S.button.x + 2.3, top, top + S.button.h, S.button.z - 2.3, S.button.z + 2.3);   // постамент кнопки
        addGroup('summit', L);
        return S;
    })();

    // ---- БУНКЕР: з протилежного від гірки боку майданчика. Завжди відкритий, поки не закінчиться відлік. Усередині вміщується фургон і вантажівка.
    var BUNKER = (function () {
        var xf = -70, depth = 110, hw = 34, h = 34, wall = 4, dhz = 15, dh = 15;
        var B = {
            x0: xf - depth, x1: xf, hw: hw, h: h, wall: wall, doorHz: dhz, doorH: dh,
            inner: { x0: xf - depth + wall, x1: xf - wall, hz: hw - wall, h: h - wall },
            doorSolid: null, open: 1, list: []
        };
        var L = B.list;
        addBox(L, B.x0, B.x0 + wall, 0, h, -hw, hw);                          // задня стіна
        addBox(L, B.x0, xf, 0, h, hw - wall, hw);                             // бокові стіни
        addBox(L, B.x0, xf, 0, h, -hw, -(hw - wall));
        addBox(L, B.x0, xf, h - wall, h, -hw, hw);                            // дах
        addBox(L, xf - wall, xf, 0, h, dhz, hw);                              // передня стіна з отвором 30 × 15
        addBox(L, xf - wall, xf, 0, h, -hw, -dhz);
        addBox(L, xf - wall, xf, dh, h, -dhz, dhz);                           // перемичка
        B.doorSolid = addBox(L, xf - wall + 0.8, xf - 0.8, dh, 2 * dh, -dhz, dhz);   // двері відкриті: стоять у перемичці
        addGroup('bunker', L);
        return B;
    })();

    // ---- СИРЕНИ навколо круглого майданчика: не ближче 20° до дороги й не ближче 40° до проїзду в бункер, тож нічого не перегороджують
    var SIRENS = (function () {
        var list = [], R0 = 44;
        function adiff(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
        for (var i = 0; i < 12; i++) {
            var deg = i * 30 + 15;
            if (adiff(deg, 0) < 20 || adiff(deg, 180) < 40) continue;
            var a = deg * Math.PI / 180;
            list.push({ x: Math.cos(a) * R0, z: Math.sin(a) * R0, ry: -a + Math.PI / 2, h: 24, id: list.length });
        }
        var L = [];
        for (var k = 0; k < list.length; k++) addBox(L, list[k].x - 0.9, list[k].x + 0.9, 0, list[k].h, list[k].z - 0.9, list[k].z + 0.9);
        addGroup('sirens', L);
        return list;
    })();

    // ---- МІСТО: квартал 7 × 7, будинок 143 × 143 студи (≈ 50 м), вулиця 60. Центральний квартал — площа.
    var CITY = (function () {
        var C = { cx: 0, cz: 1430, n: 7, bld: 143, street: 60, floor: 12, lobby: 14, wall: 4, doorW: 16, doorH: 11, buildings: [] };
        C.pitch = C.bld + C.street;
        C.half = C.n * C.pitch / 2;                         // півширина міста з вулицею довкола ≈ 710
        C.flat = C.half + 80;                               // рівний майданчик
        C.fade = 240;
        C.x0 = C.cx - C.n * C.pitch / 2; C.z0 = C.cz - C.n * C.pitch / 2;
        for (var i = 0; i < C.n; i++) {
            for (var j = 0; j < C.n; j++) {
                if (i === 3 && j === 3) continue;
                var k = hash2(i, j, 7), kind, floors;
                if (k < 0.34) { kind = 'house'; floors = 2 + Math.floor(hash2(i, j, 8) * 2); }
                else if (k < 0.7) { kind = 'mid'; floors = 6 + Math.floor(hash2(i, j, 9) * 6); }
                else { kind = 'tower'; floors = 20 + Math.floor(hash2(i, j, 10) * 26); }
                var bx = C.x0 + i * C.pitch + C.street / 2, bz = C.z0 + j * C.pitch + C.street / 2;
                var b = {
                    i: i, j: j, kind: kind, floors: floors, h: floors * C.floor,
                    x0: bx, x1: bx + C.bld, z0: bz, z1: bz + C.bld, cx: bx + C.bld / 2, cz: bz + C.bld / 2,
                    side: Math.floor(hash2(i, j, 11) * 4),           // стіна з дверима: 0 -X, 1 +X, 2 -Z, 3 +Z
                    tone: hash2(i, j, 12), list: []
                };
                var L = b.list, w = C.wall, t = b.h, dw = C.doorW / 2, dh = C.doorH;
                // чотири стіни по всій висоті; у стіні з дверима — отвір dw×dh і перемичка над ним
                function wallX(xa, xb, side) {      // стіна вздовж Z (на -X або +X)
                    if (b.side === side) {
                        addBox(L, xa, xb, 0, t, b.z0, b.cz - dw); addBox(L, xa, xb, 0, t, b.cz + dw, b.z1);
                        addBox(L, xa, xb, dh, t, b.cz - dw, b.cz + dw);
                    } else addBox(L, xa, xb, 0, t, b.z0, b.z1);
                }
                function wallZ(za, zb, side) {      // стіна вздовж X (на -Z або +Z)
                    if (b.side === side) {
                        addBox(L, b.x0 + w, b.cx - dw, 0, t, za, zb); addBox(L, b.cx + dw, b.x1 - w, 0, t, za, zb);
                        addBox(L, b.cx - dw, b.cx + dw, dh, t, za, zb);
                    } else addBox(L, b.x0 + w, b.x1 - w, 0, t, za, zb);
                }
                wallX(b.x0, b.x0 + w, 0); wallX(b.x1 - w, b.x1, 1);
                wallZ(b.z0, b.z0 + w, 2); wallZ(b.z1 - w, b.z1, 3);
                addBox(L, b.x0 + w, b.x1 - w, C.lobby, t, b.z0 + w, b.z1 - w);     // усе над вестибюлем — суцільне
                C.buildings.push(b);
            }
        }
        return C;
    })();
    function cityBuildingAt(x, z) {
        if (x < CITY.x0 || z < CITY.z0 || x >= CITY.x0 + CITY.n * CITY.pitch || z >= CITY.z0 + CITY.n * CITY.pitch) return null;
        var i = Math.floor((x - CITY.x0) / CITY.pitch), j = Math.floor((z - CITY.z0) / CITY.pitch);
        for (var q = 0; q < CITY.buildings.length; q++) { var b = CITY.buildings[q]; if (b.i === i && b.j === j) return b; }
        return null;
    }
    // індекс будинків за клітинкою — щоб contact() не перебирав усі
    var cityGrid = {};
    for (var cb = 0; cb < CITY.buildings.length; cb++) cityGrid[CITY.buildings[cb].i * 16 + CITY.buildings[cb].j] = CITY.buildings[cb];
    function cityCell(x, z) {
        if (x < CITY.x0 || z < CITY.z0) return null;
        var i = Math.floor((x - CITY.x0) / CITY.pitch), j = Math.floor((z - CITY.z0) / CITY.pitch);
        if (i >= CITY.n || j >= CITY.n) return null;
        return cityGrid[i * 16 + j] || null;
    }
    function cityMask(x, z) {
        var d = Math.max(Math.abs(x - CITY.cx), Math.abs(z - CITY.cz));
        return 1 - smooth(CITY.flat, CITY.flat + CITY.fade, d);
    }
    // 0 — вулиця (асфальт), 1 — майданчик під будинком/тротуар, -1 — поза містом
    function cityPlot(x, z) {
        var d = Math.max(Math.abs(x - CITY.cx), Math.abs(z - CITY.cz));
        if (d > CITY.n * CITY.pitch / 2) return -1;
        var u = (x - CITY.x0) % CITY.pitch, v = (z - CITY.z0) % CITY.pitch;
        if (u < 0) u += CITY.pitch; if (v < 0) v += CITY.pitch;
        var m = CITY.street / 2 - 5;
        return (u > m && u < CITY.pitch - m && v > m && v < CITY.pitch - m) ? 1 : 0;
    }

    // ---- двері й дах: керує грою за подіями сервера
    function setDoor(name, f) {
        f = clamp(f, 0, 1);
        if (name === 'summit') {
            SUMMIT.open = f;
            var d = SUMMIT.door, rise = f * d.h;
            SUMMIT.doorSolid.y0 = SUMMIT.top + rise; SUMMIT.doorSolid.y1 = SUMMIT.top + d.h + rise;
        } else if (name === 'bunker') {
            BUNKER.open = f;
            var rise2 = f * BUNKER.doorH;
            BUNKER.doorSolid.y0 = rise2; BUNKER.doorSolid.y1 = BUNKER.doorH + rise2;
        }
    }
    function getDoor(name) { return name === 'summit' ? SUMMIT.open : (name === 'bunker' ? BUNKER.open : 0); }
    function setBombSolid(on) { SUMMIT.bombSolid.on = !!on; }
    function setLid(f) { SUMMIT.lid = clamp(f, 0, 1); SUMMIT.lidSolid.on = SUMMIT.lid < 0.2; }
    setDoor('bunker', 1);

    function inChamber(x, y, z) {
        var c = SUMMIT.ch;
        return x > c.x0 && x < c.x1 && z > -c.hz && z < c.hz && y > SUMMIT.top - 0.5 && y < SUMMIT.top + c.h;
    }
    function inBunker(x, y, z) {
        var b = BUNKER.inner;
        return x > b.x0 && x < b.x1 && z > -b.hz && z < b.hz && y < b.h;
    }

    // Точка (x,y,z) усередині твердої коробки? Повертає глибину й нормаль виходу найкоротшим шляхом.
    function boxPush(b, x, y, z, out) {
        if (!b.on) return;
        var dx0 = x - b.x0, dx1 = b.x1 - x, dy0 = y - b.y0, dy1 = b.y1 - y, dz0 = z - b.z0, dz1 = b.z1 - z;
        if (dx0 <= 0 || dx1 <= 0 || dy0 <= 0 || dy1 <= 0 || dz0 <= 0 || dz1 <= 0) return;
        var best = dx0, nx = -1, ny = 0, nz = 0;
        if (dx1 < best) { best = dx1; nx = 1; ny = 0; nz = 0; }
        if (dy0 < best) { best = dy0; nx = 0; ny = -1; nz = 0; }
        if (dy1 < best) { best = dy1; nx = 0; ny = 1; nz = 0; }
        if (dz0 < best) { best = dz0; nx = 0; ny = 0; nz = -1; }
        if (dz1 < best) { best = dz1; nx = 0; ny = 0; nz = 1; }
        if (best > out.depth) { out.depth = best; out.nx = nx; out.ny = ny; out.nz = nz; out.solid = true; }
    }
    function structContact(x, y, z, out) {
        var i, g, list;
        for (i = 0; i < groups.length; i++) {
            g = groups[i];
            if (x < g.x0 || x > g.x1 || z < g.z0 || z > g.z1) continue;
            list = g.list;
            for (var k = 0; k < list.length; k++) boxPush(list[k], x, y, z, out);
        }
        if (x >= CITY.x0 && z >= CITY.z0) {
            var b = cityCell(x, z);
            if (b && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) for (var q = 0; q < b.list.length; q++) boxPush(b.list[q], x, y, z, out);
        }
    }

    // Круг радіуса radius на висоті y (тіло персонажа від y до y+height) виштовхується з коробок
    function resolveObstacles(x, z, radius, y) {
        var hit = false, i, g, list, k, b;
        var y0 = isFinite(y) ? y : -1e9, y1 = y0 + 4.4, ylo = y0 + 0.7;
        function push(b) {
            if (!b.on || b.y1 <= ylo || b.y0 >= y1) return;
            var nx = x < b.x0 ? b.x0 : (x > b.x1 ? b.x1 : x);
            var nz = z < b.z0 ? b.z0 : (z > b.z1 ? b.z1 : z);
            var dx = x - nx, dz = z - nz, d2 = dx * dx + dz * dz;
            if (d2 >= radius * radius) return;
            if (x === nx && z === nz) {                                  // центр усередині коробки: виштовхуємо найближчою стороною
                var l = x - b.x0, r = b.x1 - x, f = z - b.z0, bk = b.z1 - z, m = Math.min(l, r, f, bk);
                if (m === l) x = b.x0 - radius; else if (m === r) x = b.x1 + radius; else if (m === f) z = b.z0 - radius; else z = b.z1 + radius;
            } else {
                var dd = Math.sqrt(d2) || 1e-6;
                x = nx + dx / dd * radius; z = nz + dz / dd * radius;
            }
            hit = true;
        }
        for (i = 0; i < groups.length; i++) {
            g = groups[i];
            if (x < g.x0 - radius || x > g.x1 + radius || z < g.z0 - radius || z > g.z1 + radius) continue;
            list = g.list;
            for (k = 0; k < list.length; k++) push(list[k]);
        }
        if (x >= CITY.x0 - 4 && z >= CITY.z0 - 4) {
            b = cityCell(x, z);
            if (b) for (k = 0; k < b.list.length; k++) push(b.list[k]);
        }
        return { x: x, z: z, hit: hit };
    }

    // Куди поставити гравця, якщо двері закрились, а він усередині: перед дверима, зовні
    function summitExit() { return { x: SUMMIT.x0 - 10, z: 0, y: SUMMIT.top + 0.3 }; }

    // ---------------------------------------------------------------- межі, перешкоди
    var props = { trees: [], rocks: [] };
    var obstacles = [];

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
        vnoise: vnoise, fbm: fbm, hash2: hash2, plazaDist: plazaDist,
        // споруди
        SUMMIT: SUMMIT, BUNKER: BUNKER, SIRENS: SIRENS, CITY: CITY, solids: solids,
        setDoor: setDoor, getDoor: getDoor, setLid: setLid, setBombSolid: setBombSolid, inChamber: inChamber, inBunker: inBunker, summitExit: summitExit,
        cityPlot: cityPlot, cityMask: cityMask, cityBuildingAt: cityBuildingAt
    };
});
