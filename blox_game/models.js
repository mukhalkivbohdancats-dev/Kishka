// =====================================================================
// KishkaBlox — 3D-моделі гри, зібрані кодом (без зовнішніх файлів і без інтернету):
//   • персонаж у стилі Roblox-«бекон»: світле обличчя, коричневе волосся, чорна куртка, синя майка, темні штани;
//   • три машини: sedan (звичайний автомобіль), van (компактний фургон), truck (вантажівка) — об'ємні кузови з плавних перерізів;
//   • дорожня розмітка й шматки рельєфу (дерев і каміння на карті немає).
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
        var nn = rotate([n[0] / (s[0] || 1e-6), n[1] / (s[1] || 1e-6), n[2] / (s[2] || 1e-6)], r);
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
    // Персонаж у стилі фото-орієнтира («Roblox bacon»): світле обличчя, руде-коричневе волосся «бекон»,
    // чорна куртка поверх синьої майки, темні штани, світле взуття й кисті. Усе — округлі форми, не кубики.
    var SKIN = [0.93, 0.89, 0.84], JACKET = [0.09, 0.09, 0.11], JACKET_HI = [0.17, 0.17, 0.2], SHIRT = [0.12, 0.46, 0.8];
    var PANTS = [0.08, 0.08, 0.1], SHOES = [0.94, 0.94, 0.96], HAIR = [0.56, 0.34, 0.17], HAIR_HI = [0.68, 0.44, 0.22], FEATURE = [0.06, 0.06, 0.08];

    var CHAR = {
        hipY: 2.35, shoulderY: 3.95, shoulderX: 1.12, hipX: 0.5,
        thigh: 1.15, shin: 1.2, upperArm: 1.05, foreArm: 0.95,
        height: 5.1
    };

    function buildCharacter() {
        var parts = {};
        var g;

        // Торс: чорна куртка, у розрізі видно синю майку; таз у темних штанах
        g = newGeo();
        superEllipsoid(g, { c: [0, 3.22, 0], s: [1.0, 0.88, 0.58], n: 2.7, grad: [[JACKET[0] * 0.8, JACKET[1] * 0.8, JACKET[2] * 0.8], JACKET_HI], seg: [18, 12] });
        superEllipsoid(g, { c: [0, 3.3, 0.5], s: [0.42, 0.78, 0.16], n: 3, grad: [[SHIRT[0] * 0.8, SHIRT[1] * 0.8, SHIRT[2] * 0.8], SHIRT], seg: [12, 8] });
        [-1, 1].forEach(function (sx) {
            box(g, { c: [sx * 0.52, 3.3, 0.56], s: [0.1, 0.8, 0.05], rot: [0, 0, sx * 0.14], color: JACKET_HI });       // лацкани куртки
        });
        superEllipsoid(g, { c: [0, 2.5, 0], s: [0.94, 0.38, 0.54], n: 3, color: PANTS, seg: [14, 8] });
        cylinder(g, { c: [0, 4.12, 0], r: 0.24, h: 0.34, color: SKIN, seg: 10 });
        parts.torso = g;

        // Голова: світла, рівна, з простим обличчям; волосся «бекон» — густа шапка, чубчик і пасма
        g = newGeo();
        superEllipsoid(g, { c: [0, 4.62, 0], s: [0.6, 0.64, 0.6], n: 2.2, color: SKIN, seg: [20, 14] });
        superEllipsoid(g, { c: [0, 4.84, -0.1], s: [0.67, 0.5, 0.66], n: 2.3, grad: [HAIR, HAIR_HI], seg: [18, 10] });       // шапка
        superEllipsoid(g, { c: [0, 4.5, -0.3], s: [0.6, 0.52, 0.38], n: 2.3, color: HAIR, seg: [14, 8] });                    // потилиця
        superEllipsoid(g, { c: [0.16, 5.03, 0.3], s: [0.52, 0.2, 0.36], n: 2.3, rot: [0.28, 0, -0.18], grad: [HAIR, HAIR_HI], seg: [12, 8] });  // чубчик-хвиля
        superEllipsoid(g, { c: [-0.32, 4.98, 0.4], s: [0.3, 0.16, 0.24], n: 2.3, rot: [0.3, 0, 0.35], color: HAIR_HI, seg: [10, 6] });
        [-1, 1].forEach(function (sx) {
            superEllipsoid(g, { c: [sx * 0.6, 4.7, -0.02], s: [0.1, 0.3, 0.24], n: 2.3, color: HAIR, seg: [8, 6] });          // бакенбарди
        });
        // вуха
        sphere(g, [0.6, 4.55, 0.02], 0.12, SKIN); sphere(g, [-0.6, 4.55, 0.02], 0.12, SKIN);
        // обличчя: два темні овали-очі та проста усмішка (рівне, спокійне, без носа й брів)
        [-1, 1].forEach(function (sx) {
            superEllipsoid(g, { c: [sx * 0.22, 4.64, 0.56], s: [0.07, 0.11, 0.05], n: 2, color: FEATURE, seg: [8, 6] });
        });
        for (var i = -3; i <= 3; i++) {
            var mx = i * 0.065;
            sphere(g, [mx, 4.38 + 0.06 * (mx / 0.2) * (mx / 0.2), 0.56 - Math.abs(mx) * 0.2], 0.028, FEATURE, { seg: [6, 4] });
        }
        parts.head = g;

        // Рука: чорний рукав куртки (плече -> лікоть), далі рукав до зап'ястя і світла кисть
        g = newGeo();
        sphere(g, [0, 0, 0], 0.38, JACKET);
        capsule(g, { c: [0, -CHAR.upperArm / 2 - 0.05, 0], r: 0.34, h: CHAR.upperArm - 0.5, color: JACKET });
        parts.upperArm = g;
        g = newGeo();
        sphere(g, [0, 0, 0], 0.32, JACKET);
        capsule(g, { c: [0, -CHAR.foreArm / 2 + 0.1, 0], r: 0.29, h: CHAR.foreArm - 0.62, grad: [JACKET, JACKET_HI] });
        sphere(g, [0, -CHAR.foreArm - 0.02, 0.02], 0.35, SKIN);
        parts.foreArm = g;

        // Нога: чорні штани, світле взуття
        g = newGeo();
        sphere(g, [0, 0, 0], 0.47, PANTS);
        capsule(g, { c: [0, -CHAR.thigh / 2, 0], r: 0.45, h: CHAR.thigh - 0.55, color: PANTS });
        parts.thigh = g;
        g = newGeo();
        sphere(g, [0, 0, 0], 0.41, PANTS);
        capsule(g, { c: [0, -CHAR.shin / 2 + 0.1, 0], r: 0.39, h: CHAR.shin - 0.7, color: PANTS });
        superEllipsoid(g, { c: [0, -CHAR.shin + 0.05, 0.28], s: [0.48, 0.3, 0.82], n: 2.4, color: SHOES, seg: [12, 8] });
        parts.shin = g;

        return { parts: parts, dims: CHAR };
    }

    // =================================================================
    // Машини: кузови «витягнуті» вздовж осі Z зі сплавних перерізів (loft) — плавні боки, капот, скошене скло,
    // колісні арки, дзеркала, дверні шви, ліхтарі. Це справжні об'ємні форми, а не набір кубиків.
    // =================================================================
    var DARK = [0.07, 0.07, 0.09], GLASS = [0.12, 0.19, 0.28], HEAD = [1, 0.96, 0.78], TAIL = [0.88, 0.08, 0.1], AMBER = [1, 0.6, 0.12], CHROME = [0.78, 0.8, 0.84];
    var WHITE = [0.94, 0.95, 0.97], WHITE_LOW = [0.7, 0.72, 0.77], SEAM = [0.5, 0.52, 0.56];

    function wheelGeo(radius, width, tire, rim) {
        var g = newGeo();
        // шина (вісь X) з округлим боком, диск зі спицями-«зіркою» і маточина
        lathe(g, { profile: [[0, -width / 2], [radius * 0.86, -width / 2], [radius, -width * 0.32], [radius, width * 0.32], [radius * 0.86, width / 2], [0, width / 2]], seg: 22, rot: [0, 0, Math.PI / 2], color: tire || [0.06, 0.06, 0.07] });
        cylinder(g, { r: radius * 0.64, h: width + 0.08, rot: [0, 0, Math.PI / 2], color: rim || CHROME, seg: 18 });
        cylinder(g, { r: radius * 0.4, h: width + 0.14, rot: [0, 0, Math.PI / 2], color: [0.28, 0.29, 0.33], seg: 14 });
        for (var k = 0; k < 5; k++) {
            var a = (k / 5) * Math.PI * 2;
            box(g, { c: [(width + 0.2) / 2, Math.sin(a) * radius * 0.42, Math.cos(a) * radius * 0.42], s: [0.03, radius * 0.06, radius * 0.24], rot: [a, 0, 0], color: [0.9, 0.91, 0.94] });
            box(g, { c: [-(width + 0.2) / 2, Math.sin(a) * radius * 0.42, Math.cos(a) * radius * 0.42], s: [0.03, radius * 0.06, radius * 0.24], rot: [a, 0, 0], color: [0.9, 0.91, 0.94] });
        }
        cylinder(g, { r: radius * 0.14, h: width + 0.24, rot: [0, 0, Math.PI / 2], color: [0.75, 0.76, 0.8], seg: 8 });
        return g;
    }

    function pair(g, fn) { fn(g, 1); fn(g, -1); }

    // Плавні нормалі для loft: сума нормалей граней у вершині, напрям — назовні від осі перерізу
    function smoothNormals(g, from, cx) {
        var nv = g.pos.length / 3;
        var acc = new Array((nv - from) * 3).fill(0);
        for (var i = 0; i < g.idx.length; i += 3) {
            var a = g.idx[i], b = g.idx[i + 1], c = g.idx[i + 2];
            if (a < from) continue;
            var ux = g.pos[b * 3] - g.pos[a * 3], uy = g.pos[b * 3 + 1] - g.pos[a * 3 + 1], uz = g.pos[b * 3 + 2] - g.pos[a * 3 + 2];
            var vx = g.pos[c * 3] - g.pos[a * 3], vy = g.pos[c * 3 + 1] - g.pos[a * 3 + 1], vz = g.pos[c * 3 + 2] - g.pos[a * 3 + 2];
            var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            [a, b, c].forEach(function (v) { var k = (v - from) * 3; acc[k] += nx; acc[k + 1] += ny; acc[k + 2] += nz; });
        }
        for (var v = from; v < nv; v++) {
            var k = (v - from) * 3, x = acc[k], y = acc[k + 1], z = acc[k + 2];
            var l = Math.sqrt(x * x + y * y + z * z) || 1;
            g.nrm[v * 3] = x / l; g.nrm[v * 3 + 1] = y / l; g.nrm[v * 3 + 2] = z / l;
        }
        return nv;
    }

    // Кузов-«фюзеляж»: stations = [{ z, hw, y0, y1 }] від кормы до носа; переріз — супереліпс (n: 2 овал … 8 майже прямокутник).
    // Перший і останній переріз стягуються в точку, тож торці закруглені.
    function loft(g, stations, o) {
        var seg = o.seg || 24, n = o.n || 5, e = 2 / n;
        var base = g.pos.length / 3;
        var ymin = 1e9, ymax = -1e9, i, j;
        for (i = 0; i < stations.length; i++) { ymin = Math.min(ymin, stations[i].y0); ymax = Math.max(ymax, stations[i].y1); }
        function sp(v) { return sgn(v) * Math.pow(Math.abs(v), e); }
        for (i = 0; i < stations.length; i++) {
            var s = stations[i];
            var cy = (s.y0 + s.y1) / 2, hh = (s.y1 - s.y0) / 2;
            for (j = 0; j <= seg; j++) {
                var a = (j / seg) * Math.PI * 2;
                var px = s.hw * sp(Math.cos(a)), py = cy + hh * sp(Math.sin(a));
                g.pos.push(px, py, s.z);
                g.nrm.push(0, 1, 0);
                var col = o.grad ? mix(o.grad[0], o.grad[1], Math.max(0, Math.min(1, (py - ymin) / Math.max(0.001, ymax - ymin)))) : (o.color || WHITE);
                g.col.push(col[0], col[1], col[2]);
            }
        }
        for (i = 0; i < stations.length - 1; i++) {
            for (j = 0; j < seg; j++) {
                var i0 = base + i * (seg + 1) + j, i1 = i0 + 1, i2 = i0 + seg + 1, i3 = i2 + 1;
                g.idx.push(i0, i2, i1, i1, i2, i3);
            }
        }
        smoothNormals(g, base);
        // орієнтація нормалей назовні від осі перерізу + однакова нормаль на шві кільця
        for (i = 0; i < stations.length; i++) {
            var st = stations[i], cyy = (st.y0 + st.y1) / 2;
            for (j = 0; j <= seg; j++) {
                var v = base + i * (seg + 1) + j;
                var ox = g.pos[v * 3], oy = g.pos[v * 3 + 1] - cyy;
                if (g.nrm[v * 3] * ox + g.nrm[v * 3 + 1] * oy < 0) { g.nrm[v * 3] *= -1; g.nrm[v * 3 + 1] *= -1; g.nrm[v * 3 + 2] *= -1; }
            }
            var v0 = base + i * (seg + 1), v1 = v0 + seg;
            var mx = g.nrm[v0 * 3] + g.nrm[v1 * 3], my = g.nrm[v0 * 3 + 1] + g.nrm[v1 * 3 + 1], mz = g.nrm[v0 * 3 + 2] + g.nrm[v1 * 3 + 2];
            var ml = Math.sqrt(mx * mx + my * my + mz * mz) || 1;
            g.nrm[v0 * 3] = g.nrm[v1 * 3] = mx / ml; g.nrm[v0 * 3 + 1] = g.nrm[v1 * 3 + 1] = my / ml; g.nrm[v0 * 3 + 2] = g.nrm[v1 * 3 + 2] = mz / ml;
        }
        // торці кузова закриваємо віялом трикутників, щоб у кормі й носі не було «дірки»
        [0, stations.length - 1].forEach(function (si) {
            var stn = stations[si], dirZ = si === 0 ? -1 : 1;
            var c0 = g.pos.length / 3;
            g.pos.push(0, (stn.y0 + stn.y1) / 2, stn.z); g.nrm.push(0, 0, dirZ);
            var cc = o.grad ? mix(o.grad[0], o.grad[1], Math.max(0, Math.min(1, ((stn.y0 + stn.y1) / 2 - ymin) / Math.max(0.001, ymax - ymin)))) : (o.color || WHITE);
            g.col.push(cc[0], cc[1], cc[2]);
            for (var jj = 0; jj < seg; jj++) g.idx.push(c0, base + si * (seg + 1) + jj, base + si * (seg + 1) + jj + 1);
        });
    }

    // Півдиск колісної арки на боці кузова (темний): центр (x, y, z), радіус r, side = +1 | -1
    function arch(g, x, y, z, r, side, color) {
        var base = g.pos.length / 3, steps = 14;
        g.pos.push(x, y, z); g.nrm.push(side, 0, 0); g.col.push(color[0], color[1], color[2]);
        for (var i = 0; i <= steps; i++) {
            var t = (i / steps) * Math.PI;
            g.pos.push(x, y + Math.sin(t) * r, z + Math.cos(t) * r); g.nrm.push(side, 0, 0); g.col.push(color[0], color[1], color[2]);
        }
        for (var k = 0; k < steps; k++) g.idx.push(base, base + 1 + k, base + 2 + k);
    }

    function door(g, side, x, y, z0, z1, h) {      // тонка лінія дверного шва + ручка
        box(g, { c: [side * x, y, z0], s: [0.03, h, 0.03], color: SEAM });
        if (Math.abs(z1 - z0) > 0.05) {
            box(g, { c: [side * x, y + h, (z0 + z1) / 2], s: [0.03, 0.03, Math.abs(z1 - z0) / 2], color: SEAM });
            box(g, { c: [side * x, y - h, (z0 + z1) / 2], s: [0.03, 0.03, Math.abs(z1 - z0) / 2], color: SEAM });
        }
    }
    function handle(g, side, x, y, z) { box(g, { c: [side * x, y, z], s: [0.05, 0.06, 0.3], color: CHROME }); }

    function buildSedan() {
        var body = newGeo(), glass = newGeo();
        var G2 = [WHITE_LOW, WHITE];
        // підлога
        box(body, { c: [0, 0.95, 0], s: [2.2, 0.28, 5.1], color: DARK });
        // нижній кузов: корма -> багажник -> бокова лінія -> капот -> ніс
        loft(body, [
            { z: -5.72, hw: 0.4, y0: 1.5, y1: 1.9 },
            { z: -5.5, hw: 1.7, y0: 1.1, y1: 2.15 },
            { z: -4.8, hw: 2.3, y0: 0.9, y1: 2.55 },
            { z: -3.2, hw: 2.45, y0: 0.82, y1: 2.72 },
            { z: -0.5, hw: 2.5, y0: 0.8, y1: 2.78 },
            { z: 2.2, hw: 2.47, y0: 0.8, y1: 2.72 },
            { z: 3.9, hw: 2.4, y0: 0.82, y1: 2.5 },
            { z: 5.1, hw: 2.28, y0: 0.9, y1: 2.2 },
            { z: 5.55, hw: 1.9, y0: 1.0, y1: 1.95 },
            { z: 5.72, hw: 0.4, y0: 1.3, y1: 1.7 }
        ], { n: 6, seg: 26, grad: G2 });
        // салон: скло зі скошеними стійками + білий дах
        loft(glass, [
            { z: -3.3, hw: 0.5, y0: 2.6, y1: 3.0 },
            { z: -2.9, hw: 1.85, y0: 2.6, y1: 3.45 },
            { z: -1.6, hw: 2.1, y0: 2.6, y1: 3.88 },
            { z: 0.6, hw: 2.12, y0: 2.6, y1: 3.95 },
            { z: 1.9, hw: 2.05, y0: 2.6, y1: 3.8 },
            { z: 3.1, hw: 1.9, y0: 2.6, y1: 3.0 },
            { z: 3.3, hw: 0.8, y0: 2.6, y1: 2.8 }
        ], { n: 4, seg: 22, color: GLASS });
        loft(body, [
            { z: -2.9, hw: 1.5, y0: 3.7, y1: 3.86 },
            { z: -1.6, hw: 2.0, y0: 3.8, y1: 4.0 },
            { z: 0.6, hw: 2.02, y0: 3.86, y1: 4.06 },
            { z: 1.8, hw: 1.9, y0: 3.72, y1: 3.92 },
            { z: 2.3, hw: 1.3, y0: 3.55, y1: 3.7 }
        ], { n: 5, seg: 18, grad: G2 });
        pair(body, function (g, s) {
            box(g, { c: [s * 2.1, 3.3, -0.4], s: [0.07, 0.62, 0.11], color: WHITE_LOW });                          // B-стійка
            box(g, { c: [s * 1.95, 3.35, 2.45], s: [0.07, 0.72, 0.09], rot: [-0.95, 0, 0], color: WHITE_LOW });    // A-стійка
            box(g, { c: [s * 1.86, 3.3, -2.95], s: [0.07, 0.7, 0.09], rot: [0.95, 0, 0], color: WHITE_LOW });      // C-стійка
            door(g, s, 2.5, 1.75, 1.6, 1.6, 0.8); door(g, s, 2.5, 1.75, -0.4, -0.4, 0.8); door(g, s, 2.5, 1.75, -2.9, -2.9, 0.7);
            handle(g, s, 2.52, 2.5, 0.9); handle(g, s, 2.5, 2.5, -1.2);
            box(g, { c: [s * 2.4, 1.0, 0], s: [0.14, 0.12, 3.4], color: DARK });                                    // пороги
            arch(g, s * 2.52, 0.95, 3.3, 1.28, s, DARK); arch(g, s * 2.52, 0.95, -3.3, 1.28, s, DARK);              // колісні арки
            superEllipsoid(g, { c: [s * 1.7, 1.95, 5.5], s: [0.62, 0.2, 0.2], n: 2.4, color: HEAD, seg: [12, 6] });   // фари
            superEllipsoid(g, { c: [s * 1.9, 2.1, -5.55], s: [0.55, 0.22, 0.16], n: 2.4, color: TAIL, seg: [12, 6] });// ліхтарі
            box(g, { c: [s * 2.1, 1.35, 5.55], s: [0.22, 0.09, 0.08], color: AMBER });
            superEllipsoid(g, { c: [s * 2.58, 2.82, 1.95], s: [0.26, 0.2, 0.34], n: 2.4, color: WHITE_LOW, seg: [10, 6] }); // дзеркала
            box(g, { c: [s * 2.38, 2.76, 1.9], s: [0.2, 0.05, 0.08], color: DARK });
        });
        // бампери, решітка, номер
        superEllipsoid(body, { c: [0, 1.15, 5.52], s: [2.3, 0.4, 0.3], n: 4, color: DARK, seg: [14, 6] });
        superEllipsoid(body, { c: [0, 1.15, -5.52], s: [2.3, 0.4, 0.3], n: 4, color: DARK, seg: [14, 6] });
        box(body, { c: [0, 1.7, 5.72], s: [1.15, 0.26, 0.05], color: DARK });
        box(body, { c: [0, 1.7, 5.76], s: [1.0, 0.035, 0.03], color: CHROME });
        box(body, { c: [0, 1.15, -5.78], s: [0.72, 0.18, 0.03], color: [0.95, 0.95, 0.96] });
        box(body, { c: [0, 1.15, 5.84], s: [0.72, 0.18, 0.03], color: [0.95, 0.95, 0.96] });
        return { opaque: body, glass: glass };
    }

    function buildVan() {
        var body = newGeo(), glass = newGeo();
        var G2 = [WHITE_LOW, WHITE];
        box(body, { c: [0, 1.0, 0], s: [2.3, 0.28, 5.4], color: DARK });
        // фургон: вантажна частина (бокси з великим радіусом скруглення) і кабіна з капотом
        loft(body, [
            { z: -6.05, hw: 0.8, y0: 2.0, y1: 4.0 },
            { z: -5.9, hw: 2.2, y0: 1.1, y1: 5.1 },
            { z: -5.2, hw: 2.58, y0: 0.95, y1: 5.45 },
            { z: -1.0, hw: 2.62, y0: 0.9, y1: 5.5 },
            { z: 1.6, hw: 2.6, y0: 0.9, y1: 5.45 },
            { z: 2.5, hw: 2.58, y0: 0.9, y1: 4.9 },
            { z: 3.6, hw: 2.5, y0: 0.9, y1: 3.6 },
            { z: 4.9, hw: 2.4, y0: 0.9, y1: 2.9 },
            { z: 5.8, hw: 2.15, y0: 1.0, y1: 2.45 },
            { z: 6.05, hw: 0.9, y0: 1.4, y1: 2.0 }
        ], { n: 7, seg: 26, grad: G2 });
        // лобове скло й бокові вікна кабіни
        loft(glass, [
            { z: 2.35, hw: 1.8, y0: 3.55, y1: 4.75 },
            { z: 3.2, hw: 2.2, y0: 3.3, y1: 4.45 },
            { z: 4.2, hw: 2.25, y0: 3.05, y1: 3.55 },
            { z: 4.6, hw: 1.6, y0: 3.0, y1: 3.25 }
        ], { n: 4, seg: 16, color: GLASS });
        pair(glass, function (g, s) {
            box(g, { c: [s * 2.56, 3.85, 3.2], s: [0.04, 0.62, 1.0], color: GLASS });                                 // вікно дверей
            box(g, { c: [s * 2.64, 4.05, -2.8], s: [0.03, 0.55, 1.1], color: GLASS });                               // вікно вантажного відсіку
        });
        pair(body, function (g, s) {
            box(g, { c: [s * 2.66, 2.55, -1.2], s: [0.03, 0.26, 4.6], color: [0.1, 0.1, 0.13] });                   // чорна смуга по боку, як у відео
            door(g, s, 2.6, 3.25, 1.7, 1.7, 1.4); door(g, s, 2.66, 3.4, -0.9, -0.9, 1.9);
            handle(g, s, 2.62, 3.0, 2.5); handle(g, s, 2.67, 3.2, -0.5);
            box(g, { c: [s * 2.5, 1.12, 0], s: [0.14, 0.14, 4.6], color: DARK });
            arch(g, s * 2.62, 1.0, 3.6, 1.32, s, DARK); arch(g, s * 2.64, 1.0, -3.6, 1.32, s, DARK);
            superEllipsoid(g, { c: [s * 1.75, 2.05, 5.95], s: [0.56, 0.24, 0.16], n: 2.4, color: HEAD, seg: [10, 6] });
            superEllipsoid(g, { c: [s * 2.2, 2.2, -6.0], s: [0.3, 0.7, 0.14], n: 2.4, color: TAIL, seg: [10, 6] });
            superEllipsoid(g, { c: [s * 2.85, 3.55, 3.7], s: [0.2, 0.46, 0.22], n: 2.4, color: DARK, seg: [8, 6] });  // великі дзеркала
            box(g, { c: [s * 2.7, 3.55, 3.7], s: [0.18, 0.05, 0.08], color: DARK });
            box(g, { c: [s * 1.6, 5.62, -1.5], s: [0.07, 0.07, 3.4], color: CHROME });
        });
        superEllipsoid(body, { c: [0, 1.2, 6.0], s: [2.4, 0.4, 0.3], n: 4, color: DARK, seg: [14, 6] });
        superEllipsoid(body, { c: [0, 1.25, -6.0], s: [2.45, 0.42, 0.3], n: 4, color: DARK, seg: [14, 6] });
        box(body, { c: [0, 1.95, 6.04], s: [1.35, 0.4, 0.05], color: DARK });
        box(body, { c: [0, 1.95, 6.08], s: [1.2, 0.04, 0.03], color: CHROME });
        box(body, { c: [0, 3.2, -6.06], s: [0.04, 1.9, 0.03], color: SEAM });                                     // шов задніх дверей
        box(body, { c: [0, 1.2, 6.2], s: [0.7, 0.18, 0.03], color: [0.95, 0.95, 0.96] });
        box(body, { c: [0, 5.62, -3.0], s: [1.7, 0.06, 0.07], color: CHROME });
        box(body, { c: [0, 5.62, 0.2], s: [1.7, 0.06, 0.07], color: CHROME });
        return { opaque: body, glass: glass };
    }

    function buildTruck() {
        var body = newGeo(), glass = newGeo();
        var blue = [0.14, 0.38, 0.78], blueLow = [0.07, 0.2, 0.5], G2 = [WHITE_LOW, WHITE], GB = [blueLow, blue];
        // рама й ходова
        box(body, { c: [0, 1.75, -0.4], s: [1.9, 0.42, 7.4], color: DARK });
        // капотна кабіна: ніс, капот, кабіна з великим склом
        loft(body, [
            { z: 7.75, hw: 0.9, y0: 1.8, y1: 2.4 },
            { z: 7.55, hw: 2.1, y0: 1.4, y1: 3.6 },
            { z: 6.6, hw: 2.45, y0: 1.3, y1: 4.0 },
            { z: 5.4, hw: 2.55, y0: 1.3, y1: 4.1 },
            { z: 4.2, hw: 2.65, y0: 1.3, y1: 5.4 },
            { z: 2.9, hw: 2.65, y0: 1.3, y1: 5.7 },
            { z: 2.5, hw: 2.4, y0: 1.5, y1: 5.2 },
            { z: 2.4, hw: 1.2, y0: 2.2, y1: 4.2 }
        ], { n: 6, seg: 24, grad: GB });
        loft(glass, [
            { z: 4.3, hw: 2.0, y0: 4.05, y1: 5.15 },
            { z: 4.9, hw: 2.4, y0: 3.85, y1: 5.1 },
            { z: 5.6, hw: 2.4, y0: 3.7, y1: 4.05 },
            { z: 5.8, hw: 1.5, y0: 3.7, y1: 3.9 }
        ], { n: 4, seg: 14, color: GLASS });
        pair(glass, function (g, s) { box(g, { c: [s * 2.66, 4.55, 3.4], s: [0.04, 0.6, 0.95], color: GLASS }); });
        // вантажний кузов-фургон з рифленням, нижня рама, підніжка
        loft(body, [
            { z: -7.85, hw: 1.0, y0: 3.4, y1: 6.4 },
            { z: -7.7, hw: 2.4, y0: 2.4, y1: 7.0 },
            { z: -7.0, hw: 2.72, y0: 2.3, y1: 7.35 },
            { z: -1.0, hw: 2.74, y0: 2.3, y1: 7.4 },
            { z: 1.8, hw: 2.72, y0: 2.3, y1: 7.35 },
            { z: 2.1, hw: 2.4, y0: 2.5, y1: 7.0 },
            { z: 2.2, hw: 1.2, y0: 3.4, y1: 6.2 }
        ], { n: 10, seg: 24, grad: G2 });
        for (var i = 0; i < 8; i++) {
            var rz = -6.3 + i * 1.0;
            pair(body, function (g, s) { box(g, { c: [s * 2.76, 4.9, rz], s: [0.03, 2.35, 0.07], color: WHITE_LOW }); });
        }
        pair(body, function (g, s) {
            door(g, s, 2.67, 3.0, 3.3, 3.3, 1.2); door(g, s, 2.67, 3.0, 4.9, 4.9, 1.2);
            handle(g, s, 2.7, 3.6, 3.9);
            arch(g, s * 2.67, 1.15, 4.5, 1.6, s, DARK);
            arch(g, s * 2.76, 1.15, -3.2, 1.55, s, DARK); arch(g, s * 2.76, 1.15, -5.5, 1.55, s, DARK);
            superEllipsoid(g, { c: [s * 1.75, 2.9, 7.6], s: [0.56, 0.28, 0.14], n: 2.4, color: HEAD, seg: [10, 6] });
            superEllipsoid(g, { c: [s * 2.1, 2.9, -7.85], s: [0.4, 0.5, 0.1], n: 2.4, color: TAIL, seg: [10, 6] });
            superEllipsoid(g, { c: [s * 3.0, 4.3, 5.1], s: [0.22, 0.5, 0.24], n: 2.4, color: DARK, seg: [8, 6] });    // дзеркала
            box(g, { c: [s * 2.85, 4.3, 5.1], s: [0.2, 0.05, 0.08], color: DARK });
            cylinder(g, { c: [s * 2.35, 2.0, 0.8], r: 0.55, h: 2.2, rot: [Math.PI / 2, 0, 0], color: [0.52, 0.55, 0.6], seg: 12 });  // паливний бак
            box(g, { c: [s * 1.6, 1.0, 5.4], s: [0.5, 0.06, 0.28], color: DARK });
            box(g, { c: [s * 2.3, 1.05, 3.0], s: [0.45, 0.1, 0.5], color: CHROME });                                  // підніжка
        });
        // решітка радіатора, бампер, труба, задній бампер
        box(body, { c: [0, 2.7, 7.78], s: [1.55, 0.95, 0.06], color: CHROME });
        for (var q = -4; q <= 4; q++) box(body, { c: [q * 0.3, 2.7, 7.83], s: [0.03, 0.9, 0.03], color: DARK });
        superEllipsoid(body, { c: [0, 1.55, 7.55], s: [2.6, 0.38, 0.32], n: 4, color: CHROME, seg: [14, 6] });
        cylinder(body, { c: [2.3, 6.6, 2.85], r: 0.2, h: 3.6, color: CHROME, seg: 8 });
        superEllipsoid(body, { c: [0, 1.7, -7.85], s: [2.5, 0.32, 0.3], n: 4, color: DARK, seg: [12, 6] });
        box(body, { c: [0, 4.9, -7.9], s: [0.04, 2.3, 0.03], color: SEAM });
        box(body, { c: [0, 1.55, 7.9], s: [0.7, 0.18, 0.03], color: [0.95, 0.95, 0.96] });
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
    // Рельєф і розмітка. На карті НЕМАЄ дерев і каміння: buildProps повертає порожню геометрію (інтерфейс лишився).
    // =================================================================
    function buildProps(World) {
        return newGeo();
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

    // Розмітка лише на дорозі від майданчика до гірки: пунктир по осі й білі краї. Більше нічого (без хрестів і кілець).
    function buildDecals(World) {
        var g = newGeo();
        var C = World.CFG;
        var yellow = [0.96, 0.8, 0.16], white = [0.93, 0.93, 0.94];
        var x1 = C.rampX0 + 4;
        for (var x = C.platformR + 8; x < x1 - 6; x += 10) drapedStrip(g, line(x, 0, x + 5, 0, 1), 0.55, yellow, 0.07, World);
        drapedStrip(g, line(C.platformR + 2, C.roadHalf - 0.7, x1, C.roadHalf - 0.7, 1), 0.45, white, 0.07, World);
        drapedStrip(g, line(C.platformR + 2, -(C.roadHalf - 0.7), x1, -(C.roadHalf - 0.7), 1), 0.45, white, 0.07, World);
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
                        g.pos.push(x, y, z);
                        g.nrm.push(nx / nl, 1 / nl, nz / nl);
                        g.col.push(col[0], col[1], col[2]);
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
