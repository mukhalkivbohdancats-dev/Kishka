// =====================================================================
// KishkaBlox — 3D-моделі гри, зібрані кодом (без зовнішніх файлів і без інтернету):
//   • персонаж: голова, шия, торс, руки з ліктями, ноги з колінами, кисті, стопи, обличчя;
//   • три машини: sedan (звичайний автомобіль), van (компактний мінівен), truck (вантажівка);
//   • дерева, каміння, дорожня розмітка й шматки рельєфу.
// Файл лежить у blox_game/, тому входить у маніфест і в оновлення KishkaBlox (як і решта файлів гри).
// Чиста геометрія без WebGL: працює у браузері (window.KishkaModels) і в тестах Node.
//
// Формат геометрії: { pos:[], nrm:[], col:[], idx:[] } — масиви чисел; вершина = позиція, нормаль, колір.
// Системи координат: Y вгору, модель дивиться в бік +Z, ліва сторона водія — +X.
// =====================================================================
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.KishkaModels = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var MAX_VERTS = 65000; // індекси 16-бітні

    function newGeo() { return { pos: [], nrm: [], col: [], idx: [] }; }

    function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
    function sgn(v) { return v < 0 ? -1 : 1; }

    // Обертання вектора: спочатку навколо Z, потім X, потім Y (кути в радіанах)
    function rotate(v, r) {
        var x = v[0], y = v[1], z = v[2], c, s, t;
        if (r[2]) { c = Math.cos(r[2]); s = Math.sin(r[2]); t = x * c - y * s; y = x * s + y * c; x = t; }
        if (r[0]) { c = Math.cos(r[0]); s = Math.sin(r[0]); t = y * c - z * s; z = y * s + z * c; y = t; }
        if (r[1]) { c = Math.cos(r[1]); s = Math.sin(r[1]); t = x * c + z * s; z = -x * s + z * c; x = t; }
        return [x, y, z];
    }

    // Додає вершину з перетворенням: масштаб S -> обертання R -> зсув C
    function pushVert(g, p, n, color, o) {
        var s = o.s || [1, 1, 1], r = o.rot || [0, 0, 0], c = o.c || [0, 0, 0];
        var q = rotate([p[0] * s[0], p[1] * s[1], p[2] * s[2]], r);
        var nn = rotate([n[0] / s[0], n[1] / s[1], n[2] / s[2]], r);
        var l = Math.sqrt(nn[0] * nn[0] + nn[1] * nn[1] + nn[2] * nn[2]) || 1;
        g.pos.push(q[0] + c[0], q[1] + c[1], q[2] + c[2]);
        g.nrm.push(nn[0] / l, nn[1] / l, nn[2] / l);
        g.col.push(color[0], color[1], color[2]);
    }

    // Колір вершини: однотонний або з градієнтом знизу вгору (o.grad = [низ, верх], за локальним y від -1 до 1)
    function colorFor(o, ly) {
        if (o.grad) return mix(o.grad[0], o.grad[1], Math.max(0, Math.min(1, (ly + 1) / 2)));
        return o.color || [0.7, 0.7, 0.7];
    }

    // ---- супереліпсоїд: n = 2 — еліпсоїд, n = 4..8 — «скруглена коробка». o.s — півосі.
    function superEllipsoid(g, o) {
        var n = o.n || 2.5;
        var su = (o.seg && o.seg[0]) || 14, sv = (o.seg && o.seg[1]) || 10;
        var base = g.pos.length / 3;
        var e = 2 / n;
        function sp(v, ex) { return sgn(v) * Math.pow(Math.abs(v), ex); }
        for (var i = 0; i <= sv; i++) {
            var u = -Math.PI / 2 + (i / sv) * Math.PI;
            for (var j = 0; j <= su; j++) {
                var v = -Math.PI + (j / su) * Math.PI * 2;
                var x = sp(Math.cos(u), e) * sp(Math.cos(v), e);
                var y = sp(Math.sin(u), e);
                var z = sp(Math.cos(u), e) * sp(Math.sin(v), e);
                // нормаль із градієнта неявної поверхні |x|^n + |y|^n + |z|^n = 1
                var nx = sgn(x) * Math.pow(Math.abs(x), n - 1);
                var ny = sgn(y) * Math.pow(Math.abs(y), n - 1);
                var nz = sgn(z) * Math.pow(Math.abs(z), n - 1);
                var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
                var pr = { s: o.s, rot: o.rot, c: o.c };
                pushVert(g, [x, y, z], [nx / nl, ny / nl, nz / nl], colorFor(o, y), pr);
            }
        }
        for (var a = 0; a < sv; a++) {
            for (var b = 0; b < su; b++) {
                var i0 = base + a * (su + 1) + b, i1 = i0 + 1, i2 = i0 + su + 1, i3 = i2 + 1;
                g.idx.push(i0, i2, i1, i1, i2, i3);
            }
        }
    }

    // ---- тіло обертання: profile = [[радіус, y], ...] знизу вгору. Осі: Y (за замовчуванням), далі o.rot.
    function lathe(g, o) {
        var seg = o.seg || 12;
        var pf = o.profile;
        var base = g.pos.length / 3;
        for (var i = 0; i < pf.length; i++) {
            var p0 = pf[Math.max(0, i - 1)], p1 = pf[Math.min(pf.length - 1, i + 1)];
            var tr = p1[0] - p0[0], ty = p1[1] - p0[1];
            var tl = Math.sqrt(tr * tr + ty * ty) || 1;
            var nr = ty / tl, ny = -tr / tl;
            for (var j = 0; j <= seg; j++) {
                var a = (j / seg) * Math.PI * 2;
                var ca = Math.cos(a), sa = Math.sin(a);
                var pr = { s: o.s, rot: o.rot, c: o.c };
                pushVert(g, [pf[i][0] * ca, pf[i][1], pf[i][0] * sa], [nr * ca, ny, nr * sa], colorFor(o, pf[i][1] > 0 ? 1 : -1), pr);
            }
        }
        for (var r = 0; r < pf.length - 1; r++) {
            for (var k = 0; k < seg; k++) {
                var i0 = base + r * (seg + 1) + k, i1 = i0 + 1, i2 = i0 + seg + 1, i3 = i2 + 1;
                g.idx.push(i0, i1, i2, i1, i3, i2);
            }
        }
    }

    // Циліндр висотою h (по Y, від -h/2 до h/2) із торцями
    function cylinder(g, o) {
        var r = o.r, r2 = o.r2 === undefined ? o.r : o.r2, h = o.h;
        lathe(g, { profile: [[0, -h / 2], [r, -h / 2], [r, -h / 2 + 0.001], [r2, h / 2 - 0.001], [r2, h / 2], [0, h / 2]], seg: o.seg || 14, c: o.c, rot: o.rot, s: o.s, color: o.color });
    }

    // Капсула: довжина h між центрами півсфер, радіус r. Іде вниз від початку (0 -> -h-r*2 по Y), якщо o.down
    function capsule(g, o) {
        var r = o.r, h = o.h, pf = [], k, steps = 5;
        for (k = 0; k <= steps; k++) {
            var a = -Math.PI / 2 + (k / steps) * (Math.PI / 2);
            pf.push([Math.cos(a) * r, -h / 2 + Math.sin(a) * r]);
        }
        for (k = 0; k <= steps; k++) {
            var b = (k / steps) * (Math.PI / 2);
            pf.push([Math.cos(b) * r, h / 2 + Math.sin(b) * r]);
        }
        pf[0][0] = 0; pf[pf.length - 1][0] = 0;
        lathe(g, { profile: pf, seg: o.seg || 10, c: o.c, rot: o.rot, s: o.s, color: o.color, grad: o.grad });
    }

    // Плоска коробка з різкими гранями (фари, номерні знаки, смуги). o.s — півосі
    function box(g, o) {
        var faces = [
            [[0, 0, 1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
            [[0, 0, -1], [1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
            [[1, 0, 0], [1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]],
            [[-1, 0, 0], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
            [[0, 1, 0], [-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]],
            [[0, -1, 0], [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]
        ];
        for (var f = 0; f < faces.length; f++) {
            var face = faces[f], base = g.pos.length / 3;
            for (var k = 1; k <= 4; k++) {
                var p = face[k];
                pushVert(g, p, face[0], colorFor(o, p[1]), { s: o.s, rot: o.rot, c: o.c });
            }
            g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
    }

    // ---- дрібні помічники
    function sphere(g, c, r, color, extra) {
        var o = { n: 2, s: [r, r, r], c: c, color: color, seg: [10, 8] };
        if (extra) for (var k in extra) o[k] = extra[k];
        superEllipsoid(g, o);
    }

    function mirrorX(list, fn) {
        for (var i = 0; i < list.length; i++) { fn(list[i], 1); fn(list[i], -1); }
    }

    // =================================================================
    // Персонаж
    // =================================================================
    var SKIN = [0.84, 0.85, 0.89], SHIRT = [0.6, 0.66, 0.8], PANTS = [0.4, 0.44, 0.55], SHOES = [0.15, 0.15, 0.18];
    var HAIR = [0.2, 0.21, 0.26], FEATURE = [0.07, 0.07, 0.09];

    var CHAR = {
        hipY: 2.35, shoulderY: 3.95, shoulderX: 1.12, hipX: 0.5,
        thigh: 1.15, shin: 1.2, upperArm: 1.05, foreArm: 0.95,
        height: 5.1
    };

    function buildCharacter() {
        var parts = {};
        var g;

        // Торс і таз (позиція в просторі персонажа: ноги стоять на y = 0)
        g = newGeo();
        superEllipsoid(g, { c: [0, 3.22, 0], s: [0.98, 0.86, 0.56], n: 2.7, grad: [[SHIRT[0] * 0.8, SHIRT[1] * 0.8, SHIRT[2] * 0.8], [SHIRT[0] * 1.08, SHIRT[1] * 1.08, SHIRT[2] * 1.08]], seg: [16, 10] });
        superEllipsoid(g, { c: [0, 2.5, 0], s: [0.92, 0.36, 0.52], n: 3, color: PANTS, seg: [14, 8] });
        cylinder(g, { c: [0, 4.12, 0], r: 0.24, h: 0.34, color: SKIN, seg: 10 });
        parts.torso = g;

        // Голова з обличчям і волоссям
        g = newGeo();
        superEllipsoid(g, { c: [0, 4.62, 0], s: [0.6, 0.64, 0.6], n: 2.2, color: SKIN, seg: [18, 12] });
        // волосся: шапка зверху й ззаду, обличчя відкрите
        superEllipsoid(g, { c: [0, 4.78, -0.08], s: [0.65, 0.5, 0.65], n: 2.3, color: HAIR, seg: [16, 8] });
        superEllipsoid(g, { c: [0, 4.5, -0.28], s: [0.58, 0.5, 0.38], n: 2.3, color: HAIR, seg: [12, 8] });
        // вуха, ніс
        sphere(g, [0.6, 4.58, 0], 0.13, SKIN); sphere(g, [-0.6, 4.58, 0], 0.13, SKIN);
        superEllipsoid(g, { c: [0, 4.52, 0.62], s: [0.09, 0.12, 0.1], n: 2, color: mix(SKIN, [0.6, 0.6, 0.64], 0.3), seg: [8, 6] });
        // очі (темні овали з білим відблиском) та брови
        [-1, 1].forEach(function (sx) {
            superEllipsoid(g, { c: [sx * 0.23, 4.68, 0.55], s: [0.09, 0.13, 0.06], n: 2, color: FEATURE, seg: [8, 6] });
            sphere(g, [sx * 0.21, 4.72, 0.6], 0.025, [0.95, 0.95, 0.98], { seg: [6, 4] });
            box(g, { c: [sx * 0.24, 4.88, 0.54], s: [0.14, 0.025, 0.03], rot: [0, 0, sx * -0.12], color: HAIR });
        });
        // усмішка: дуга з маленьких овалів
        for (var i = -3; i <= 3; i++) {
            var mx = i * 0.07;
            sphere(g, [mx, 4.36 + 0.07 * (mx / 0.21) * (mx / 0.21), 0.57 - Math.abs(mx) * 0.25], 0.032, FEATURE, { seg: [6, 4] });
        }
        parts.head = g;

        // Рука: верхня частина (плече -> лікоть) і передпліччя з кистю. Початок координат — суглоб, кінцівка вниз по -Y
        g = newGeo();
        sphere(g, [0, 0, 0], 0.37, SHIRT);
        capsule(g, { c: [0, -CHAR.upperArm / 2 - 0.05, 0], r: 0.33, h: CHAR.upperArm - 0.5, color: SHIRT });
        parts.upperArm = g;
        g = newGeo();
        sphere(g, [0, 0, 0], 0.31, SKIN);
        capsule(g, { c: [0, -CHAR.foreArm / 2 + 0.1, 0], r: 0.28, h: CHAR.foreArm - 0.6, color: SKIN });
        sphere(g, [0, -CHAR.foreArm - 0.05, 0.02], 0.34, SKIN);
        parts.foreArm = g;

        // Нога: стегно (стегно -> коліно) і гомілка зі стопою
        g = newGeo();
        sphere(g, [0, 0, 0], 0.46, PANTS);
        capsule(g, { c: [0, -CHAR.thigh / 2, 0], r: 0.44, h: CHAR.thigh - 0.55, color: PANTS });
        parts.thigh = g;
        g = newGeo();
        sphere(g, [0, 0, 0], 0.4, PANTS);
        capsule(g, { c: [0, -CHAR.shin / 2 + 0.1, 0], r: 0.38, h: CHAR.shin - 0.7, color: PANTS });
        superEllipsoid(g, { c: [0, -CHAR.shin + 0.05, 0.28], s: [0.46, 0.3, 0.8], n: 2.4, color: SHOES, seg: [12, 8] });
        parts.shin = g;

        return { parts: parts, dims: CHAR };
    }

    // =================================================================
    // Машини
    // =================================================================
    var DARK = [0.08, 0.08, 0.1], GLASS = [0.13, 0.2, 0.3], HEAD = [1, 0.95, 0.72], TAIL = [0.9, 0.1, 0.1], CHROME = [0.72, 0.74, 0.78];

    function wheelGeo(radius, width, tire, rim) {
        var g = newGeo();
        // шина (вісь X), диск і маточина
        cylinder(g, { r: radius, h: width, rot: [0, 0, Math.PI / 2], color: tire || [0.07, 0.07, 0.08], seg: 18 });
        cylinder(g, { r: radius * 0.62, h: width + 0.06, rot: [0, 0, Math.PI / 2], color: rim || CHROME, seg: 14 });
        cylinder(g, { r: radius * 0.22, h: width + 0.16, rot: [0, 0, Math.PI / 2], color: [0.35, 0.36, 0.4], seg: 8 });
        return g;
    }

    function pair(g, fn) { fn(g, 1); fn(g, -1); }

    function buildSedan() {
        var body = newGeo(), glass = newGeo();
        var red = [0.78, 0.09, 0.12];
        var redLow = [0.55, 0.05, 0.08];
        // підлога (темна), щоб між колесами не було просвіту
        box(body, { c: [0, 0.85, 0], s: [2.1, 0.25, 5.0], color: DARK });
        // нижній кузов із м'яким градієнтом і скругленими краями
        superEllipsoid(body, { c: [0, 1.62, 0], s: [2.3, 0.78, 5.5], n: 5, grad: [redLow, red], seg: [22, 14] });
        // капот і багажник трохи нижчі, ніж салон
        superEllipsoid(body, { c: [0, 2.05, 3.4], s: [2.1, 0.32, 2.0], n: 4, color: red, seg: [14, 8] });
        superEllipsoid(body, { c: [0, 2.08, -3.5], s: [2.1, 0.3, 1.8], n: 4, color: red, seg: [14, 8] });
        // салон: скло + дах + стійки
        superEllipsoid(glass, { c: [0, 2.9, -0.4], s: [2.05, 0.72, 2.7], n: 3.2, color: GLASS, seg: [18, 10] });
        superEllipsoid(body, { c: [0, 3.5, -0.4], s: [2.1, 0.2, 2.5], n: 4, color: red, seg: [16, 8] });
        box(body, { c: [0, 2.9, -0.4], s: [2.12, 0.7, 0.1], color: redLow });          // B-стійка
        box(body, { c: [0, 2.85, 1.95], s: [2.0, 0.72, 0.09], rot: [-0.62, 0, 0], color: redLow }); // A-стійки (перед)
        box(body, { c: [0, 2.85, -2.75], s: [2.0, 0.7, 0.09], rot: [0.62, 0, 0], color: redLow });  // задня стійка
        // бампери, решітка, фари, ліхтарі
        superEllipsoid(body, { c: [0, 1.0, 5.35], s: [2.35, 0.36, 0.34], n: 4, color: DARK, seg: [12, 6] });
        superEllipsoid(body, { c: [0, 1.0, -5.35], s: [2.35, 0.36, 0.34], n: 4, color: DARK, seg: [12, 6] });
        box(body, { c: [0, 1.6, 5.52], s: [1.2, 0.22, 0.05], color: DARK });
        pair(body, function (g, s) {
            superEllipsoid(g, { c: [s * 1.6, 1.85, 5.42], s: [0.55, 0.22, 0.18], n: 2.4, color: HEAD, seg: [10, 6] });
            superEllipsoid(g, { c: [s * 1.7, 1.85, -5.45], s: [0.5, 0.2, 0.15], n: 2.4, color: TAIL, seg: [10, 6] });
            superEllipsoid(g, { c: [s * 2.42, 2.75, 1.55], s: [0.2, 0.17, 0.3], n: 2.4, color: redLow, seg: [8, 6] }); // дзеркала
        });
        box(body, { c: [0, 1.15, -5.5], s: [0.7, 0.16, 0.03], color: [0.9, 0.9, 0.92] });                // номер
        return { opaque: body, glass: glass };
    }

    function buildVan() {
        var body = newGeo(), glass = newGeo();
        var yel = [0.95, 0.76, 0.16], yelLow = [0.75, 0.55, 0.08], white = [0.94, 0.94, 0.96];
        box(body, { c: [0, 0.95, 0], s: [2.2, 0.25, 5.5], color: DARK });
        superEllipsoid(body, { c: [0, 2.9, -0.4], s: [2.55, 1.75, 5.5], n: 4.4, grad: [yelLow, yel], seg: [22, 14] });
        // скошений капот (ніс мінівена)
        superEllipsoid(body, { c: [0, 2.2, 5.0], s: [2.45, 1.0, 1.25], n: 3.4, grad: [yelLow, yel], seg: [16, 10] });
        // боковий пояс скла й лобове скло
        superEllipsoid(glass, { c: [0, 3.6, -0.7], s: [2.58, 0.68, 4.2], n: 7, color: GLASS, seg: [20, 8] });
        superEllipsoid(glass, { c: [0, 3.55, 4.45], s: [2.2, 0.8, 0.9], n: 3, color: GLASS, rot: [0.5, 0, 0], seg: [14, 8] });
        // дах, білі смуги й лінія розсувних дверей
        superEllipsoid(body, { c: [0, 4.6, -0.4], s: [2.4, 0.22, 5.2], n: 4, color: white, seg: [16, 8] });
        pair(body, function (g, s) {
            box(g, { c: [s * 2.56, 2.35, -0.4], s: [0.04, 0.12, 4.9], color: white });
            box(g, { c: [s * 2.57, 2.9, 0.6], s: [0.03, 0.9, 0.03], color: yelLow });
            superEllipsoid(g, { c: [s * 1.7, 1.95, 6.15], s: [0.5, 0.22, 0.14], n: 2.4, color: HEAD, seg: [10, 6] });
            superEllipsoid(g, { c: [s * 2.0, 2.9, -5.9], s: [0.4, 0.3, 0.1], n: 2.4, color: TAIL, seg: [10, 6] });
            superEllipsoid(g, { c: [s * 2.6, 3.0, 4.4], s: [0.2, 0.2, 0.3], n: 2.4, color: DARK, seg: [8, 6] });
        });
        // бампери, решітка, рейлінг на даху
        superEllipsoid(body, { c: [0, 1.15, 6.2], s: [2.5, 0.34, 0.3], n: 4, color: DARK, seg: [12, 6] });
        superEllipsoid(body, { c: [0, 1.15, -6.0], s: [2.5, 0.34, 0.3], n: 4, color: DARK, seg: [12, 6] });
        box(body, { c: [0, 2.0, 6.24], s: [1.3, 0.3, 0.05], color: DARK });
        pair(body, function (g, s) { box(g, { c: [s * 1.6, 4.95, -0.4], s: [0.06, 0.08, 4.4], color: CHROME }); });
        box(body, { c: [0, 4.9, -0.4], s: [1.7, 0.05, 0.08], color: CHROME });
        box(body, { c: [0, 4.9, 1.6], s: [1.7, 0.05, 0.08], color: CHROME });
        box(body, { c: [0, 4.9, -2.4], s: [1.7, 0.05, 0.08], color: CHROME });
        return { opaque: body, glass: glass };
    }

    function buildTruck() {
        var body = newGeo(), glass = newGeo();
        var blue = [0.14, 0.36, 0.74], blueLow = [0.08, 0.22, 0.5], cargo = [0.9, 0.9, 0.92], cargoLow = [0.66, 0.67, 0.7];
        // рама
        box(body, { c: [0, 1.65, -0.5], s: [2.0, 0.45, 6.8], color: DARK });
        // кабіна
        superEllipsoid(body, { c: [0, 3.5, 4.5], s: [2.5, 1.75, 2.1], n: 4.2, grad: [blueLow, blue], seg: [18, 12] });
        superEllipsoid(body, { c: [0, 2.3, 5.2], s: [2.45, 0.7, 1.6], n: 4, color: blueLow, seg: [14, 8] });
        superEllipsoid(glass, { c: [0, 4.0, 5.55], s: [2.2, 0.85, 0.7], n: 3, color: GLASS, rot: [0.28, 0, 0], seg: [14, 8] });
        superEllipsoid(glass, { c: [0, 4.0, 4.1], s: [2.56, 0.72, 1.2], n: 6, color: GLASS, seg: [14, 8] });
        // вантажний кузов із ребрами
        superEllipsoid(body, { c: [0, 4.1, -3.35], s: [2.68, 2.35, 5.15], n: 9, grad: [cargoLow, cargo], seg: [18, 10] });
        for (var i = 0; i < 6; i++) {
            var z = -7.2 + i * 1.7;
            pair(body, function (g, s) { box(g, { c: [s * 2.7, 4.1, z], s: [0.05, 2.1, 0.09], color: cargoLow }); });
        }
        // передок кабіни: решітка, фари, бампер
        box(body, { c: [0, 2.55, 6.46], s: [1.8, 0.7, 0.07], color: DARK });
        superEllipsoid(body, { c: [0, 1.6, 6.6], s: [2.55, 0.4, 0.32], n: 4, color: CHROME, seg: [14, 6] });
        pair(body, function (g, s) {
            superEllipsoid(g, { c: [s * 1.9, 2.55, 6.5], s: [0.5, 0.26, 0.14], n: 2.4, color: HEAD, seg: [10, 6] });
            superEllipsoid(g, { c: [s * 2.0, 2.2, -8.45], s: [0.45, 0.25, 0.12], n: 2.4, color: TAIL, seg: [10, 6] });
            superEllipsoid(g, { c: [s * 2.65, 3.7, 6.0], s: [0.2, 0.2, 0.28], n: 2.4, color: DARK, seg: [8, 6] });
            cylinder(g, { c: [s * 2.55, 1.7, 1.5], r: 0.5, h: 2.2, rot: [Math.PI / 2, 0, 0], color: [0.5, 0.52, 0.56], seg: 10 });  // паливний бак
        });
        cylinder(body, { c: [2.1, 5.35, 2.5], r: 0.17, h: 3.2, color: CHROME, seg: 8 });           // вихлопна труба
        superEllipsoid(body, { c: [0, 1.25, -8.0], s: [2.4, 0.32, 0.3], n: 4, color: DARK, seg: [12, 6] });   // задній бампер
        return { opaque: body, glass: glass };
    }

    // Колеса: [x, z, кермове?] відносно центру моделі, y = радіус
    var CAR_DEFS = {
        sedan: { build: buildSedan, wheelR: 0.95, wheelW: 0.85, wheels: [[2.25, 3.3, true], [-2.25, 3.3, true], [2.25, -3.3, false], [-2.25, -3.3, false]], seat: [1.0, 1.2, -0.5], height: 3.7, len: 11, wid: 5.0 },
        van:   { build: buildVan,   wheelR: 1.0,  wheelW: 0.9,  wheels: [[2.35, 3.6, true], [-2.35, 3.6, true], [2.35, -3.6, false], [-2.35, -3.6, false]], seat: [1.15, 2.0, 2.0], height: 5.0, len: 12, wid: 5.2 },
        truck: { build: buildTruck, wheelR: 1.15, wheelW: 0.95, wheels: [[2.4, 4.5, true], [-2.4, 4.5, true], [2.4, -3.2, false], [-2.4, -3.2, false], [2.4, -5.5, false], [-2.4, -5.5, false]], seat: [1.25, 2.6, 4.1], height: 6.7, len: 15, wid: 5.6 }
    };
    var CAR_TYPES = Object.keys(CAR_DEFS);

    function buildCar(type) {
        var def = CAR_DEFS[type];
        if (!def) throw new Error('unknown car type: ' + type);
        var m = def.build();
        // кермо перед водієм
        cylinder(m.opaque, { c: [def.seat[0], def.seat[1] + 0.95, def.seat[2] + 1.3], r: 0.5, h: 0.09, rot: [1.1, 0, 0], color: [0.1, 0.1, 0.12], seg: 14 });
        var wheelPos = def.wheels.map(function (w) {
            return { x: w[0], y: def.wheelR, z: w[1], steer: !!w[2], flip: w[0] < 0 };
        });
        return {
            type: type, opaque: m.opaque, glass: m.glass,
            wheel: wheelGeo(def.wheelR, def.wheelW), wheelPos: wheelPos, wheelR: def.wheelR,
            seat: def.seat, height: def.height, len: def.len, wid: def.wid
        };
    }

    // =================================================================
    // Дерева, каміння, розмітка, рельєф
    // =================================================================
    function buildProps(World) {
        var g = newGeo();
        var P = World.props;
        P.trees.forEach(function (t) {
            var s = t.s;
            var leaf = mix([0.14, 0.42, 0.16], [0.3, 0.58, 0.2], t.tone);
            cylinder(g, { c: [t.x, t.y + 1.6 * s, t.z], r: 0.55 * s, r2: 0.38 * s, h: 3.2 * s, color: [0.36, 0.25, 0.15], seg: 7 });
            superEllipsoid(g, { c: [t.x, t.y + 4.2 * s, t.z], s: [2.6 * s, 2.2 * s, 2.6 * s], n: 2.2, grad: [mix(leaf, [0, 0, 0], 0.25), leaf], seg: [9, 7] });
            superEllipsoid(g, { c: [t.x, t.y + 6.0 * s, t.z], s: [1.8 * s, 1.7 * s, 1.8 * s], n: 2.2, grad: [mix(leaf, [0, 0, 0], 0.15), mix(leaf, [1, 1, 1], 0.12)], seg: [9, 7] });
        });
        P.rocks.forEach(function (r) {
            superEllipsoid(g, { c: [r.x, r.y + r.s * 0.35, r.z], s: [r.s * 1.1, r.s * 0.75, r.s], n: 2.6, rot: [0, r.rot, 0], grad: [[0.38, 0.39, 0.4], [0.58, 0.59, 0.6]], seg: [9, 7] });
        });
        return g;
    }

    // Смуга шириною w вздовж ламаної, що «лежить» на рельєфі
    function drapedStrip(g, pts, w, color, lift, World) {
        var base = g.pos.length / 3;
        for (var i = 0; i < pts.length; i++) {
            var p = pts[i];
            var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
            var dx = b[0] - a[0], dz = b[1] - a[1];
            var l = Math.sqrt(dx * dx + dz * dz) || 1;
            var nx = -dz / l * w / 2, nz = dx / l * w / 2;
            [[p[0] - nx, p[1] - nz], [p[0] + nx, p[1] + nz]].forEach(function (q) {
                g.pos.push(q[0], World.heightAt(q[0], q[1]) + lift, q[1]);
                g.nrm.push(0, 1, 0);
                g.col.push(color[0], color[1], color[2]);
            });
        }
        for (var k = 0; k < pts.length - 1; k++) {
            var i0 = base + k * 2;
            g.idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
        }
    }

    function line(x0, z0, x1, z1, step) {
        var n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
        var pts = [];
        for (var i = 0; i <= n; i++) pts.push([x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]);
        return pts;
    }

    function buildDecals(World) {
        var g = newGeo();
        var C = World.CFG;
        var yellow = [0.96, 0.8, 0.16], white = [0.93, 0.93, 0.94];
        // Осьова розмітка дороги (пунктир) від майданчика до верхньої плити
        for (var x = C.platformR + 6; x < C.rampX1 + 2; x += 8) drapedStrip(g, line(x, 0, x + 4, 0, 1), 0.5, yellow, 0.07, World);
        // Краї дороги
        drapedStrip(g, line(C.platformR + 1, C.roadHalf - 0.6, C.rampX1 + 4, C.roadHalf - 0.6, 1), 0.4, white, 0.07, World);
        drapedStrip(g, line(C.platformR + 1, -(C.roadHalf - 0.6), C.rampX1 + 4, -(C.roadHalf - 0.6), 1), 0.4, white, 0.07, World);
        // Кільце розмітки на майданчику
        var ring = [];
        for (var i = 0; i <= 96; i++) { var a = (i / 96) * Math.PI * 2; ring.push([Math.cos(a) * 19, Math.sin(a) * 19]); }
        drapedStrip(g, ring, 0.6, white, 0.08, World);
        // Хрест-мітка в центрі, звідки з'являється персонаж
        drapedStrip(g, line(-3, 0, 3, 0, 1), 0.5, white, 0.08, World);
        drapedStrip(g, line(0, -3, 0, 3, 1), 0.5, white, 0.08, World);
        return g;
    }

    // Рельєф: сітка з кроком cell, поділена на шматки по chunkCells клітинок (вершин < 65000 на шматок)
    function buildTerrain(World, cell, chunkCells) {
        cell = cell || 2;
        chunkCells = chunkCells || 40;
        var half = World.CFG.meshHalf;
        var n = Math.round((half * 2) / cell);          // клітинок на сторону
        var N = n + 1;
        var hs = new Float32Array(N * N);
        var i, j;
        for (i = 0; i < N; i++) for (j = 0; j < N; j++) hs[i * N + j] = World.heightAt(-half + j * cell, -half + i * cell);
        function H(ii, jj) {
            ii = ii < 0 ? 0 : (ii > n ? n : ii); jj = jj < 0 ? 0 : (jj > n ? n : jj);
            return hs[ii * N + jj];
        }
        var chunks = [];
        var col = [0, 0, 0];
        for (var ci = 0; ci < n; ci += chunkCells) {
            for (var cj = 0; cj < n; cj += chunkCells) {
                var g = newGeo();
                var ei = Math.min(n, ci + chunkCells), ej = Math.min(n, cj + chunkCells);
                var w = ej - cj + 1;
                var minY = 1e9, maxY = -1e9;
                for (i = ci; i <= ei; i++) {
                    for (j = cj; j <= ej; j++) {
                        var x = -half + j * cell, z = -half + i * cell, y = H(i, j);
                        var nx = (H(i, j - 1) - H(i, j + 1)) / (2 * cell);
                        var nz = (H(i - 1, j) - H(i + 1, j)) / (2 * cell);
                        var nl = Math.sqrt(nx * nx + 1 + nz * nz);
                        World.colorAt(x, z, col);
                        // крутий схил — трохи темніший, «скельний»
                        var steep = Math.min(1, Math.max(0, (Math.sqrt(nx * nx + nz * nz) - 0.55) * 1.6));
                        g.pos.push(x, y, z);
                        g.nrm.push(nx / nl, 1 / nl, nz / nl);
                        g.col.push(col[0] + (0.42 - col[0]) * steep * 0.5, col[1] + (0.4 - col[1]) * steep * 0.5, col[2] + (0.36 - col[2]) * steep * 0.5);
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
                for (i = 0; i < ei - ci; i++) {
                    for (j = 0; j < ej - cj; j++) {
                        var i0 = i * w + j, i1 = i0 + 1, i2 = i0 + w, i3 = i2 + 1;
                        g.idx.push(i0, i2, i1, i1, i2, i3);
                    }
                }
                chunks.push({
                    geo: g,
                    cx: -half + (cj + ej) / 2 * cell, cz: -half + (ci + ei) / 2 * cell,
                    radius: Math.sqrt(2) * (ej - cj) * cell / 2 + (maxY - minY),
                    cy: (minY + maxY) / 2
                });
            }
        }
        return chunks;
    }

    // Перевірка геометрії (для тестів і діагностики): кількість вершин, кінцеві числа, індекси в межах
    function checkGeo(g) {
        var nv = g.pos.length / 3;
        if (nv > MAX_VERTS) return 'забагато вершин: ' + nv;
        if (g.nrm.length !== g.pos.length || g.col.length !== g.pos.length) return 'довжини масивів не збігаються';
        for (var i = 0; i < g.pos.length; i++) if (!isFinite(g.pos[i]) || !isFinite(g.nrm[i]) || !isFinite(g.col[i])) return 'не число у вершині ' + i;
        for (var k = 0; k < g.idx.length; k++) if (!(g.idx[k] >= 0 && g.idx[k] < nv)) return 'індекс поза межами: ' + g.idx[k];
        if (g.idx.length % 3 !== 0) return 'індекси не кратні 3';
        return '';
    }

    return {
        newGeo: newGeo, superEllipsoid: superEllipsoid, lathe: lathe, capsule: capsule, cylinder: cylinder, box: box,
        buildCharacter: buildCharacter, buildCar: buildCar, buildProps: buildProps, buildDecals: buildDecals, buildTerrain: buildTerrain,
        checkGeo: checkGeo, CAR_TYPES: CAR_TYPES, CAR_DEFS: CAR_DEFS, CHAR: CHAR
    };
});
