// =====================================================================
// KishkaBlox — 3D-моделі гри, зібрані кодом (без зовнішніх файлів і без інтернету):
//   • персонаж у стилі Roblox-«бекон»: світле обличчя, коричневе волосся, чорна куртка, синя майка, темні штани;
//   • три машини: sedan, van, truck — суцільні плавні кузови (поверхня «витягнута» з перерізів, як у ігрових авто):
//     склепіння даху, скло зі стійками, колісні арки, фари/ліхтарі/решітка — це фарба й заглиблення на самому кузові,
//     а не окремі деталі, що стирчать. Окремими тілами лишаються лише те, що справді може відвалитися від удару:
//     бампери, капот, багажник/задні двері, двері, дзеркала, спойлер/рейка/труба й колеса;
//   • велика гірка (як на відео-орієнтирі), дорожня розмітка й потокові шматки об'ємного рельєфу з кількома рівнями деталізації.
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
        superEllipsoid(g, { c: [0, 3.98, -0.02], s: [0.52, 0.14, 0.34], n: 2.4, color: JACKET_HI, seg: [12, 6] });       // комір
        superEllipsoid(g, { c: [0, 2.82, 0], s: [0.99, 0.09, 0.59], n: 3, color: [0.2, 0.2, 0.24], seg: [14, 4] });      // ремінь
        box(g, { c: [0, 2.82, 0.6], s: [0.16, 0.08, 0.03], color: [0.78, 0.8, 0.84] });
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
        sphere(g, [0.18, -CHAR.foreArm - 0.1, 0.22], 0.12, SKIN);                                                         // великий палець
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
        superEllipsoid(g, { c: [0, -CHAR.shin - 0.05, 0.28], s: [0.5, 0.09, 0.86], n: 3, color: [0.5, 0.5, 0.56], seg: [12, 4] });   // підошва
        parts.shin = g;

        return { parts: parts, dims: CHAR };
    }

    // =================================================================
    // Кузов: поверхня «витягується» вздовж осі Z зі щільного ряду перерізів. Кожен переріз описують параметри
    // (низ, бічна лінія, лінія скла, дах, коефіцієнт «салону»), між ключовими перерізами — сплайн Катмулла-Рома.
    // Перерізи ділять на смуги з окремими нормалями (підлога, борти, верх): так між днищем, бортом і дахом є чіткий злам,
    // а всередині смуги — плавне освітлення. Фарба (фари, решітка, шви, арки) наноситься на вершини, тож нічого не стирчить.
    // =================================================================
    function catmull(a, b, c, d, t) {
        return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    }
    var KEYF = ['y0', 'w0', 'w1', 'yb', 'hc', 'c', 'yr', 'wr'];
    function resampleStations(keys, dz) {
        var last = keys.length - 1, zmin = keys[0].z, zmax = keys[last].z;
        var n = Math.max(2, Math.ceil((zmax - zmin) / dz));
        var out = [];
        for (var i = 0; i <= n; i++) {
            var z = zmin + (zmax - zmin) * i / n;
            var s = 0;
            while (s < last - 1 && z > keys[s + 1].z) s++;
            var k1 = keys[s], k2 = keys[s + 1], k0 = keys[Math.max(0, s - 1)], k3 = keys[Math.min(last, s + 2)];
            var t = (z - k1.z) / ((k2.z - k1.z) || 1);
            var st = { z: z };
            for (var f = 0; f < KEYF.length; f++) {
                var name = KEYF[f];
                st[name] = catmull(k0[name], k1[name], k2[name], k3[name], clamp01(t));
            }
            st.c = clamp01(st.c);
            out.push(st);
        }
        return out;
    }
    function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
    function sstep(t) { t = clamp01(t); return t * t * (3 - 2 * t); }

    var K_SIDE = 19, J_TOP = 10;
    // Права половина перерізу: борт знизу вгору й верх від лінії скла до центру даху
    function halfSection(s) {
        var side = [], top = [], k, j;
        for (k = 0; k < K_SIDE; k++) {
            var t = k / (K_SIDE - 1);
            var x;
            if (t < 0.16) x = s.w0 + (s.w1 - s.w0) * Math.sin(t / 0.16 * Math.PI / 2);
            else x = s.w1 * (1 - 0.014 * Math.pow((t - 0.16) / 0.84, 2));
            side.push([x, s.y0 + t * (s.yb - s.y0)]);
        }
        var xe = side[K_SIDE - 1][0];
        var cs = sstep(s.c);
        var xr = s.wr;
        for (j = 0; j <= J_TOP; j++) {
            var u = j / J_TOP;
            // капот/багажник: плавний купол
            var dx = xe * (1 - u), dy = s.yb + s.hc * (1 - Math.pow(1 - u, 2.4));
            // салон: скло з легким схилом усередину, далі заокруглений дах
            var cx, cy;
            if (u <= 0.5) {
                var q = u / 0.5;
                cx = xe - (xe - xr) * (0.55 * q + 0.45 * q * q);
                cy = s.yb + (s.yr - 0.14 - s.yb) * Math.pow(q, 0.92);
            } else {
                var q2 = (u - 0.5) / 0.5;
                cx = xr * (1 - q2);
                cy = s.yr - 0.14 + 0.18 * Math.sin(q2 * Math.PI / 2);
            }
            top.push([dx + (cx - dx) * cs, dy + (cy - dy) * cs]);
        }
        return { side: side, top: top };
    }

    // Будує всі вершини кузова. Повертає { pos, nrm, col, quads:[{v:[a,b,c,d], strip, i, k, ...}], stations }.
    function buildShellMesh(spec) {
        var st = resampleStations(spec.keys, spec.dz || 0.2);
        var N = st.length;
        var strips = { under: [], right: [], top: [], left: [] };
        var info = [];                                 // для кожної станції — половинні перерізи
        var i, k, j;
        for (i = 0; i < N; i++) info.push(halfSection(st[i]));

        var pos = [], col = [], nrmAcc = [];
        var cellRows = {};                             // strip -> [row][k] -> індекс вершини
        function addVert(x, y, z, meta) {
            pos.push(x, y, z);
            meta.idx = pos.length / 3 - 1;
            return meta;
        }
        var meta = [];                                 // метадані кожної вершини
        var names = ['under', 'right', 'top', 'left'];
        names.forEach(function (nm) { cellRows[nm] = []; });
        for (i = 0; i < N; i++) {
            var s = st[i], h = info[i];
            var rowU = [], rowR = [], rowT = [], rowL = [];
            var wu = s.w0;
            [-1, -0.5, 0, 0.5, 1].forEach(function (f) { rowU.push(addVert(wu * f, s.y0, s.z, { strip: 'under', i: i, k: rowU.length, x: wu * f, y: s.y0, z: s.z })); });
            for (k = 0; k < K_SIDE; k++) rowR.push(addVert(h.side[k][0], h.side[k][1], s.z, { strip: 'right', i: i, k: k, x: h.side[k][0], y: h.side[k][1], z: s.z }));
            // верх: від лівого краю через центр до правого
            for (j = 0; j <= J_TOP; j++) rowT.push(addVert(-h.top[j][0], h.top[j][1], s.z, { strip: 'top', i: i, k: rowT.length, j: j, side: 1, x: -h.top[j][0], y: h.top[j][1], z: s.z }));
            for (j = J_TOP - 1; j >= 0; j--) rowT.push(addVert(h.top[j][0], h.top[j][1], s.z, { strip: 'top', i: i, k: rowT.length, j: j, side: -1, x: h.top[j][0], y: h.top[j][1], z: s.z }));
            // лівий борт: від лінії скла вниз
            for (k = K_SIDE - 1; k >= 0; k--) rowL.push(addVert(-h.side[k][0], h.side[k][1], s.z, { strip: 'left', i: i, k: k, x: -h.side[k][0], y: h.side[k][1], z: s.z }));
            cellRows.under.push(rowU); cellRows.right.push(rowR); cellRows.top.push(rowT); cellRows.left.push(rowL);
            [rowU, rowR, rowT, rowL].forEach(function (r) { r.forEach(function (m) { meta.push(m); }); });
        }
        // колісні арки: заглиблення й темне забарвлення борту навколо коліс
        (spec.wheels || []).forEach(function (w) {
            var Ra = spec.archR;
            meta.forEach(function (m) {
                if (m.strip !== 'right' && m.strip !== 'left') return;
                var sgn = m.strip === 'right' ? 1 : -1;
                if (sgn * w.x < 0) return;
                var d = Math.sqrt((m.z - w.z) * (m.z - w.z) + (m.y - w.y) * (m.y - w.y));
                var edge = Ra + 0.1;
                if (d < edge) {
                    var inset = (spec.archDepth || 0.42) * sstep((edge - d) / 0.14);
                    var ax = Math.abs(pos[m.idx * 3]);
                    var nx = Math.max(ax - inset, Math.abs(w.x) - (spec.wheelW || 0.85) / 2 - 0.12);
                    pos[m.idx * 3] = (pos[m.idx * 3] < 0 ? -1 : 1) * nx;
                    m.well = Math.max(m.well || 0, sstep((Ra - 0.04 - d) / 0.05));
                }
            });
        });
        // трикутники (за смугами) з виправленням орієнтації назовні
        var tris = [];
        names.forEach(function (nm) {
            var rows = cellRows[nm];
            for (i = 0; i < N - 1; i++) {
                var rA = rows[i], rB = rows[i + 1];
                for (k = 0; k < rA.length - 1; k++) {
                    var a = rA[k], b = rA[k + 1], c = rB[k], d = rB[k + 1];
                    tris.push({ v: [a.idx, c.idx, b.idx], q: { strip: nm, i: i, k: k, m: [a, b, c, d] } });
                    tris.push({ v: [b.idx, c.idx, d.idx], q: { strip: nm, i: i, k: k, m: [a, b, c, d] } });
                }
            }
        });
        var nrm = new Array(pos.length).fill(0);
        tris.forEach(function (t) {
            var a = t.v[0], b = t.v[1], c = t.v[2];
            var ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
            var vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
            var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            // орієнтація: від осі перерізу (x = 0, висота центру) назовні
            var cx = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3, cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3;
            var zi = t.q.i, sc = st[zi], midY = (sc.y0 + sc.yr) / 2 - 0.4;
            var out = nx * cx + ny * (cy - midY);
            if (out < 0) { var tmp = t.v[1]; t.v[1] = t.v[2]; t.v[2] = tmp; nx = -nx; ny = -ny; nz = -nz; }
            t.n = [nx, ny, nz];
            [a, b, c].forEach(function (v) { nrm[v * 3] += nx; nrm[v * 3 + 1] += ny; nrm[v * 3 + 2] += nz; });
        });
        for (i = 0; i < nrm.length; i += 3) {
            var l = Math.sqrt(nrm[i] * nrm[i] + nrm[i + 1] * nrm[i + 1] + nrm[i + 2] * nrm[i + 2]) || 1;
            nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
        }
        // фарба
        var colArr = new Array(pos.length);
        meta.forEach(function (m) {
            var s = st[m.i];
            var c = spec.paint({ x: m.x, ax: Math.abs(m.x), y: m.y, z: m.z, strip: m.strip, j: m.j, k: m.k, c: s.c, well: m.well || 0, st: s });
            colArr[m.idx * 3] = c[0]; colArr[m.idx * 3 + 1] = c[1]; colArr[m.idx * 3 + 2] = c[2];
        });
        return { pos: pos, nrm: nrm, col: colArr, tris: tris, st: st, meta: meta };
    }

    // Розкладає трикутники кузова по «відрах» (тіло, скло, деталі, що відвалюються). Кожне відро — окрема геометрія.
    function bucketize(mesh, spec, innerLining) {
        var buckets = {};
        var maps = {};
        function geoFor(name) {
            if (!buckets[name]) { buckets[name] = newGeo(); maps[name] = {}; }
            return buckets[name];
        }
        function mapVert(name, vi) {
            var g = geoFor(name), mp = maps[name];
            if (mp[vi] !== undefined) return mp[vi];
            var n = g.pos.length / 3;
            g.pos.push(mesh.pos[vi * 3], mesh.pos[vi * 3 + 1], mesh.pos[vi * 3 + 2]);
            g.nrm.push(mesh.nrm[vi * 3], mesh.nrm[vi * 3 + 1], mesh.nrm[vi * 3 + 2]);
            g.col.push(mesh.col[vi * 3], mesh.col[vi * 3 + 1], mesh.col[vi * 3 + 2]);
            mp[vi] = n;
            return n;
        }
        mesh.tris.forEach(function (t, ti) {
            var m = t.q.m;
            var cx = 0, cy = 0, cz = 0;
            for (var q = 0; q < 4; q++) { cx += mesh.pos[m[q].idx * 3]; cy += mesh.pos[m[q].idx * 3 + 1]; cz += mesh.pos[m[q].idx * 3 + 2]; }
            cx /= 4; cy /= 4; cz /= 4;
            var cAvg = (mesh.st[t.q.i].c + mesh.st[Math.min(mesh.st.length - 1, t.q.i + 1)].c) / 2;
            var jmin = 99;
            if (t.q.strip === 'top') jmin = Math.min(m[0].j, m[1].j, m[2].j, m[3].j);
            var name = spec.classify({ x: cx, ax: Math.abs(cx), y: cy, z: cz, strip: t.q.strip, k: t.q.k, j: jmin, c: cAvg, side: cx >= 0 ? -1 : 1 });
            var ia = mapVert(name, t.v[0]), ib = mapVert(name, t.v[1]), ic = mapVert(name, t.v[2]);
            geoFor(name).idx.push(ia, ib, ic);
            // дзеркальна підкладка для скла: темний салон за склом
            if (name === 'glass' && innerLining) {
                var g = geoFor('body'), mp = maps.body;
                var lin = [];
                for (var e = 0; e < 3; e++) {
                    var vi = t.v[e];
                    var n = g.pos.length / 3;
                    var nx = mesh.nrm[vi * 3], ny = mesh.nrm[vi * 3 + 1], nz = mesh.nrm[vi * 3 + 2];
                    g.pos.push(mesh.pos[vi * 3] - nx * 0.16, mesh.pos[vi * 3 + 1] - ny * 0.16, mesh.pos[vi * 3 + 2] - nz * 0.16);
                    g.nrm.push(-nx, -ny, -nz);
                    g.col.push(innerLining[0], innerLining[1], innerLining[2]);
                    lin.push(n);
                }
                g.idx.push(lin[0], lin[2], lin[1]);
            }
        });
        return buckets;
    }

    function appendGeo(dst, src) {
        var base = dst.pos.length / 3;
        for (var i = 0; i < src.pos.length; i++) { dst.pos.push(src.pos[i]); dst.nrm.push(src.nrm[i]); dst.col.push(src.col[i]); }
        for (var k = 0; k < src.idx.length; k++) dst.idx.push(src.idx[k] + base);
        return dst;
    }

    // =================================================================
    // Колесо: шина з рифленням і округлим плечем, литий диск зі спицями, гальмівний диск і маточина. Вісь — X, центр у (0,0,0).
    // Обидва боки однакові, тож праве колесо — те саме, що ліве.
    // =================================================================
    var TIRE = [0.05, 0.05, 0.055], TIRE_HI = [0.11, 0.11, 0.12], RIM = [0.82, 0.84, 0.88], RIM_DARK = [0.34, 0.35, 0.4], BRAKE = [0.42, 0.42, 0.45];
    function wheelGeo(radius, width, spokes) {
        var g = newGeo(), R = radius, W = width, hw = W / 2, k;
        // шина: профіль (радіус, положення по осі). Кілька виступів — протектор.
        var prof = [[R * 0.56, -hw * 0.98], [R * 0.78, -hw], [R * 0.93, -hw * 0.9], [R * 0.985, -hw * 0.62]];
        var tread = 5;
        for (k = 0; k < tread; k++) {
            var tz = -hw * 0.5 + (hw) * k / (tread - 1) * 1.0;
            prof.push([R * 0.985, tz - hw * 0.1], [R * 1.0, tz - hw * 0.07], [R * 1.0, tz + hw * 0.07], [R * 0.985, tz + hw * 0.1]);
        }
        prof.push([R * 0.985, hw * 0.62], [R * 0.93, hw * 0.9], [R * 0.78, hw], [R * 0.56, hw * 0.98]);
        var lp = [];
        prof.forEach(function (p) { lp.push([p[0], p[1]]); });
        // lathe навколо осі Y, потім повертаємо вісь на X
        lathe(g, { profile: lp.map(function (p) { return [p[0], p[1]]; }), seg: 40, rot: [0, 0, Math.PI / 2], color: TIRE });
        // бічні стінки світліші біля диска
        lathe(g, { profile: [[R * 0.6, -hw * 0.985], [R * 0.74, -hw * 1.005], [R * 0.74, hw * 1.005], [R * 0.6, hw * 0.985]], seg: 22, rot: [0, 0, Math.PI / 2], color: TIRE_HI });
        // диск: вигнутий (дальній від центру борт глибше), спиці з обох боків
        var rr = R * 0.6;
        cylinder(g, { r: rr, h: W * 0.5, rot: [0, 0, Math.PI / 2], color: RIM_DARK, seg: 22 });
        [-1, 1].forEach(function (sd) {
            cylinder(g, { c: [sd * hw * 0.96, 0, 0], r: rr * 0.96, r2: rr * 0.9, h: 0.05, rot: [0, 0, Math.PI / 2], color: RIM, seg: 24 });
            for (k = 0; k < (spokes || 5); k++) {
                var a = (k / (spokes || 5)) * Math.PI * 2;
                var ca = Math.cos(a), sa = Math.sin(a);
                box(g, { c: [sd * (hw * 0.97), sa * rr * 0.5, ca * rr * 0.5], s: [0.035, rr * 0.075, rr * 0.4], rot: [a, 0, 0], color: [0.93, 0.94, 0.97] });
            }
            cylinder(g, { c: [sd * hw * 1.0, 0, 0], r: R * 0.17, h: 0.08, rot: [0, 0, Math.PI / 2], color: [0.55, 0.56, 0.62], seg: 12 });
            for (k = 0; k < 5; k++) {                                     // болти кріплення колеса
                var la = (k / 5) * Math.PI * 2 + 0.3;
                sphere(g, [sd * hw * 1.02, Math.sin(la) * R * 0.27, Math.cos(la) * R * 0.27], R * 0.04, [0.78, 0.8, 0.85], { seg: [6, 4] });
            }
            cylinder(g, { c: [sd * hw * 0.99, 0, 0], r: rr * 1.0, r2: rr * 1.0, h: 0.03, rot: [0, 0, Math.PI / 2], color: CHROME, seg: 24 });   // хромова окантовка диска
            // видимий гальмівний диск і супорт за спицями
            cylinder(g, { c: [sd * hw * 0.55, 0, 0], r: R * 0.5, h: 0.05, rot: [0, 0, Math.PI / 2], color: BRAKE, seg: 20 });
        });
        box(g, { c: [hw * 0.55, R * 0.3, R * 0.3], s: [0.14, R * 0.16, R * 0.2], color: [0.75, 0.12, 0.1] });
        box(g, { c: [-hw * 0.55, R * 0.3, R * 0.3], s: [0.14, R * 0.16, R * 0.2], color: [0.75, 0.12, 0.1] });
        return g;
    }

    var DARK = [0.06, 0.06, 0.075], GLASS = [0.14, 0.22, 0.32], HEAD = [1, 0.97, 0.82], TAIL = [0.88, 0.07, 0.1], AMBER = [1, 0.62, 0.12], CHROME = [0.82, 0.84, 0.88];
    var WHITE = [0.95, 0.955, 0.97], WHITE_LOW = [0.7, 0.72, 0.78], SEAM = [0.34, 0.35, 0.4], INTERIOR = [0.1, 0.105, 0.125], SEAT = [0.16, 0.17, 0.2];

    function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
    function gradPaint(low, high, y0, y1, y) { return mixc(low, high, clamp01((y - y0) / (y1 - y0))); }

    // Однакові для всіх машин: заготовка вершинної фарби кузова
    function bodyColor(spec, v) {
        if (v.strip === 'under') return DARK;
        var base = gradPaint(spec.paintLow, spec.paintHigh, spec.paintY[0], spec.paintY[1], v.y);
        if (v.strip !== 'top' && v.k <= 1) base = mixc(base, DARK, 0.75 - 0.35 * v.k);          // пороги
        if (v.well > 0) base = mixc(base, [0.05, 0.05, 0.06], v.well);                             // колісні арки
        return base;
    }

    // Збирає готову модель із опису
    function assembleCar(spec) {
        var mesh = buildShellMesh(spec);
        var bk = bucketize(mesh, spec, INTERIOR);
        var body = bk.body || newGeo(), glass = bk.glass || newGeo();
        var parts = {};
        ['fbump', 'rbump', 'hood', 'trunk', 'doorL', 'doorR'].forEach(function (n) {
            parts[n] = { geo: bk[n] || newGeo() };
            var inf = spec.partInfo[n] || {};
            for (var q in inf) parts[n][q] = inf[q];
        });
        (spec.extraShells || []).forEach(function (es) {
            var m2 = buildShellMesh(es);
            var b2 = bucketize(m2, es, null);
            if (b2.body) appendGeo(body, b2.body);
            if (b2.glass) appendGeo(glass, b2.glass);
        });
        spec.build(body, glass, parts);
        return { opaque: body, glass: glass, parts: parts, meshStats: { verts: body.pos.length / 3 } };
    }

    // =================================================================
    // Седан (задній привід): низький купе-подібний кузов, скошені стійки, спойлер на багажнику
    // =================================================================
    var SEDAN_WHEELS = [[2.15, 3.3, true], [-2.15, 3.3, true], [2.15, -3.3, false], [-2.15, -3.3, false]];
    function sedanSpec(colorLow, colorHigh) {
        var low = colorLow || WHITE_LOW, high = colorHigh || WHITE;
        var spec = {
            dz: 0.13, archR: 1.25, archDepth: 0.32, wheelW: 0.85,
            paintLow: low, paintHigh: high, paintY: [0.8, 4.0],
            wheels: SEDAN_WHEELS.map(function (w) { return { x: w[0], z: w[1], y: 0.95 }; }),
            keys: [
                { z: -5.86, y0: 1.15, w0: 0.3, w1: 0.45, yb: 1.75, hc: 0.08, c: 0, yr: 2.2, wr: 0.2 },
                { z: -5.68, y0: 0.82, w0: 1.2, w1: 1.55, yb: 2.0, hc: 0.12, c: 0, yr: 2.4, wr: 0.5 },
                { z: -5.4, y0: 0.66, w0: 1.9, w1: 2.12, yb: 2.3, hc: 0.15, c: 0, yr: 3.0, wr: 1.0 },
                { z: -4.7, y0: 0.62, w0: 2.1, w1: 2.34, yb: 2.5, hc: 0.15, c: 0, yr: 3.0, wr: 1.4 },
                { z: -3.9, y0: 0.6, w0: 2.15, w1: 2.4, yb: 2.58, hc: 0.12, c: 0, yr: 3.4, wr: 1.55 },
                { z: -2.8, y0: 0.6, w0: 2.2, w1: 2.44, yb: 2.62, hc: 0.08, c: 0.78, yr: 3.74, wr: 1.72 },
                { z: -1.8, y0: 0.6, w0: 2.2, w1: 2.45, yb: 2.64, hc: 0.05, c: 1, yr: 3.92, wr: 1.82 },
                { z: 0.4, y0: 0.6, w0: 2.2, w1: 2.46, yb: 2.66, hc: 0.05, c: 1, yr: 4.0, wr: 1.84 },
                { z: 1.5, y0: 0.6, w0: 2.2, w1: 2.46, yb: 2.66, hc: 0.05, c: 1, yr: 3.92, wr: 1.8 },
                { z: 2.5, y0: 0.6, w0: 2.18, w1: 2.44, yb: 2.62, hc: 0.1, c: 0.5, yr: 3.55, wr: 1.7 },
                { z: 3.7, y0: 0.6, w0: 2.12, w1: 2.4, yb: 2.5, hc: 0.12, c: 0, yr: 3.2, wr: 1.6 },
                { z: 4.7, y0: 0.62, w0: 2.02, w1: 2.28, yb: 2.25, hc: 0.12, c: 0, yr: 3.0, wr: 1.5 },
                { z: 5.3, y0: 0.68, w0: 1.9, w1: 2.14, yb: 1.98, hc: 0.12, c: 0, yr: 3.0, wr: 1.4 },
                { z: 5.62, y0: 0.82, w0: 1.5, w1: 1.85, yb: 1.78, hc: 0.1, c: 0, yr: 3.0, wr: 1.2 },
                { z: 5.78, y0: 1.1, w0: 0.9, w1: 1.3, yb: 1.62, hc: 0.08, c: 0, yr: 3.0, wr: 0.8 },
                { z: 5.86, y0: 1.3, w0: 0.3, w1: 0.5, yb: 1.5, hc: 0.04, c: 0, yr: 3.0, wr: 0.2 }
            ],
            paint: function (v) {
                var c = bodyColor(spec, v);
                var ax = v.ax, z = v.z, y = v.y;
                if (v.strip !== 'under') {
                    // фари: зверху по краях носа; ліхтарі: ззаду
                    if (z > 5.0 && ax > 0.95 && ax < 2.15 && y > 1.5 && y < 2.0 && v.strip !== 'top') c = HEAD;
                    if (z > 5.1 && ax < 0.9 && y > 0.95 && y < 1.7) c = DARK;                             // решітка
                    if (z > 5.3 && y < 1.25) c = DARK;                                                       // нижня вставка бампера
                    if (z < -5.1 && ax > 0.8 && y > 1.6 && y < 2.3) c = TAIL;                                // стоп-сигнали
                    if (z < -5.3 && y < 1.3) c = DARK;
                    if (z > 5.4 && ax > 1.9 && y > 1.2 && y < 1.5) c = AMBER;                               // повторювачі
                }
                return c;
            },
            classify: function (q) {
                var z = q.z, y = q.y;
                if (z > 4.9 && y < 1.5 && q.strip !== 'top') return 'fbump';
                if (z < -4.9 && y < 1.55 && q.strip !== 'top') return 'rbump';
                if (q.strip === 'under') return 'body';
                if (q.strip === 'right' || q.strip === 'left') {
                    if (z > -2.0 && z < 2.2 && q.k >= 3 && q.k < K_SIDE - 1) return q.strip === 'right' ? 'doorL' : 'doorR';
                    return 'body';
                }
                // верх
                if (q.j <= (J_TOP / 2 - 1) && q.c > 0.42 && z > -3.6 && z < 3.6) {
                    var transitionFront = z > 1.5, transitionRear = z < -1.9;
                    if ((transitionFront || transitionRear) && q.c < 0.96 && q.j <= 1) return 'body';        // A- та C-стійки
                    if (z > -0.6 && z < -0.15) return 'body';                                                // B-стійка
                    return 'glass';
                }
                if (q.c < 0.3 && q.j >= 1 && z > 3.0 && z < 5.2) return 'hood';
                if (q.c < 0.3 && q.j >= 1 && z < -3.6 && z > -5.2) return 'trunk';
                return 'body';
            },
            partInfo: {
                fbump: { hinge: [0, 1.2, 5.3], axis: [1, 0, 0], maxAngle: 0.18, shift: [0, -0.05, -0.55] },
                rbump: { hinge: [0, 1.2, -5.3], axis: [1, 0, 0], maxAngle: -0.18, shift: [0, -0.05, 0.55] },
                hood: { hinge: [0, 2.6, 3.1], axis: [1, 0, 0], maxAngle: -0.4, shift: [0, 0.05, -0.35] },
                trunk: { hinge: [0, 2.55, -3.7], axis: [1, 0, 0], maxAngle: 0.35, shift: [0, 0.05, 0.3] },
                doorL: { hinge: [2.45, 2.0, 1.9], axis: [0, 1, 0], maxAngle: 0.5, shift: [0.1, 0, 0] },
                doorR: { hinge: [-2.45, 2.0, 1.9], axis: [0, 1, 0], maxAngle: -0.5, shift: [-0.1, 0, 0] }
            },
            build: function (body, glass, parts) {
                // підкапотний простір і багажник: темні порожнини та двигун (видно, коли капот відлетів)
                box(body, { c: [0, 1.7, 4.1], s: [1.9, 0.1, 1.15], color: [0.09, 0.09, 0.11] });
                box(body, { c: [0, 1.95, 4.1], s: [0.85, 0.25, 0.8], color: [0.3, 0.31, 0.35] });
                box(body, { c: [0, 2.2, 4.1], s: [0.55, 0.06, 0.55], color: [0.12, 0.12, 0.14] });
                box(body, { c: [0, 2.0, -4.2], s: [1.8, 0.1, 1.0], color: [0.12, 0.12, 0.15] });
                // каркас під бамперами (щоб без бампера не було «дірки»)
                box(body, { c: [0, 1.25, 5.0], s: [1.9, 0.3, 0.12], color: [0.1, 0.1, 0.12] });
                box(body, { c: [0, 1.25, -5.0], s: [1.9, 0.3, 0.12], color: [0.1, 0.1, 0.12] });
                // салон: підлога, сидіння, спинки, панель і кермо
                box(body, { c: [0, 1.0, 0], s: [2.0, 0.08, 3.4], color: INTERIOR });
                [-1, 1].forEach(function (s) {
                    box(body, { c: [s * 1.0, 1.45, -0.5], s: [0.62, 0.28, 0.62], color: SEAT });
                    superEllipsoid(body, { c: [s * 1.0, 2.25, -1.15], s: [0.6, 0.85, 0.2], n: 3, color: SEAT, seg: [10, 8] });
                    box(body, { c: [s * 1.0, 1.45, -2.4], s: [0.62, 0.26, 0.55], color: SEAT });
                });
                box(body, { c: [0, 2.2, 2.35], s: [1.95, 0.45, 0.4], color: [0.12, 0.125, 0.15] });
                box(body, { c: [0, 1.75, 1.2], s: [0.35, 0.8, 0.55], color: [0.1, 0.1, 0.13] });
                // гальмівні ліхтарі як невелика вставка між стопами
                box(body, { c: [0, 2.1, -5.52], s: [0.9, 0.05, 0.04], color: [0.7, 0.05, 0.08] });
                // вихлопні труби
                [-1, 1].forEach(function (s) { cylinder(body, { c: [s * 1.5, 0.95, -5.8], r: 0.2, h: 0.3, rot: [Math.PI / 2, 0, 0], color: CHROME, seg: 10 }); });
                // номерні знаки врівень із бампером
                box(parts.fbump.geo, { c: [0, 1.0, 5.74], s: [0.72, 0.17, 0.03], color: [0.96, 0.96, 0.97] });
                box(parts.rbump.geo, { c: [0, 1.15, -5.76], s: [0.72, 0.17, 0.03], color: [0.96, 0.96, 0.97] });
                // ручки дверей (на дверях — відлітають разом із ними)
                box(parts.doorL.geo, { c: [2.47, 2.3, 0.75], s: [0.04, 0.05, 0.28], color: CHROME });
                box(parts.doorL.geo, { c: [2.47, 2.3, -1.2], s: [0.04, 0.05, 0.28], color: CHROME });
                box(parts.doorR.geo, { c: [-2.47, 2.3, 0.75], s: [0.04, 0.05, 0.28], color: CHROME });
                box(parts.doorR.geo, { c: [-2.47, 2.3, -1.2], s: [0.04, 0.05, 0.28], color: CHROME });
                // дзеркала: корпус на короткій ніжці, яка входить у двері
                [1, -1].forEach(function (s) {
                    var g = newGeo();
                    superEllipsoid(g, { c: [s * 2.78, 2.95, 2.0], s: [0.3, 0.2, 0.34], n: 2.6, color: mixc(this_low(spec), this_high(spec), 0.5), seg: [12, 8] });
                    box(g, { c: [s * 2.55, 2.82, 2.0], s: [0.24, 0.05, 0.1], color: DARK });
                    parts[s > 0 ? 'mirL' : 'mirR'] = { geo: g, hinge: [s * 2.55, 2.9, 2.0], axis: [0, 1, 0], maxAngle: s * 0.8, shift: [0, 0, 0] };
                });
                // спойлер на багажнику
                var sp = newGeo();
                box(sp, { c: [0, 3.0, -5.1], s: [1.95, 0.08, 0.38], color: DARK, rot: [0.06, 0, 0] });
                box(sp, { c: [1.3, 2.8, -4.95], s: [0.08, 0.22, 0.14], color: DARK });
                box(sp, { c: [-1.3, 2.8, -4.95], s: [0.08, 0.22, 0.14], color: DARK });
                parts.extra = { geo: sp, hinge: [0, 2.9, -5.0], axis: [1, 0, 0], maxAngle: 0.3, shift: [0, 0, 0] };
            }
        };
        return spec;
    }
    function this_low(spec) { return spec.paintLow; }
    function this_high(spec) { return spec.paintHigh; }

    // =================================================================
    // Фургон (компактний, один об'єм): висока кабіна-фургон, скло лише спереду й по боках кабіни, задні двері
    // =================================================================
    var VAN_WHEELS = [[2.35, 3.6, true], [-2.35, 3.6, true], [2.35, -3.6, false], [-2.35, -3.6, false]];
    function vanSpec(colorLow, colorHigh) {
        var spec = {
            dz: 0.15, archR: 1.4, archDepth: 0.34, wheelW: 0.9,
            paintLow: colorLow || WHITE_LOW, paintHigh: colorHigh || WHITE, paintY: [0.8, 5.2],
            wheels: VAN_WHEELS.map(function (w) { return { x: w[0], z: w[1], y: 1.0 }; }),
            keys: [
                { z: -6.26, y0: 1.5, w0: 0.5, w1: 0.8, yb: 3.2, hc: 0.1, c: 1, yr: 4.2, wr: 0.5 },
                { z: -6.1, y0: 0.95, w0: 1.6, w1: 2.1, yb: 3.0, hc: 0.1, c: 1, yr: 4.85, wr: 1.5 },
                { z: -5.7, y0: 0.82, w0: 2.25, w1: 2.52, yb: 2.95, hc: 0.1, c: 1, yr: 5.08, wr: 2.0 },
                { z: -3.0, y0: 0.82, w0: 2.3, w1: 2.6, yb: 2.95, hc: 0.1, c: 1, yr: 5.12, wr: 2.1 },
                { z: 1.5, y0: 0.82, w0: 2.3, w1: 2.6, yb: 2.95, hc: 0.1, c: 1, yr: 5.1, wr: 2.1 },
                { z: 2.7, y0: 0.82, w0: 2.28, w1: 2.58, yb: 2.92, hc: 0.1, c: 0.92, yr: 4.95, wr: 2.0 },
                { z: 4.3, y0: 0.82, w0: 2.22, w1: 2.52, yb: 2.62, hc: 0.12, c: 0.02, yr: 3.6, wr: 1.8 },
                { z: 5.2, y0: 0.84, w0: 2.14, w1: 2.42, yb: 2.4, hc: 0.12, c: 0, yr: 3.2, wr: 1.6 },
                { z: 5.8, y0: 0.95, w0: 1.8, w1: 2.1, yb: 2.15, hc: 0.1, c: 0, yr: 3.2, wr: 1.4 },
                { z: 6.1, y0: 1.2, w0: 1.2, w1: 1.6, yb: 1.98, hc: 0.08, c: 0, yr: 3.2, wr: 1.0 },
                { z: 6.24, y0: 1.5, w0: 0.5, w1: 0.8, yb: 1.82, hc: 0.04, c: 0, yr: 3.2, wr: 0.4 }
            ],
            paint: function (v) {
                var c = bodyColor(spec, v);
                var ax = v.ax, z = v.z, y = v.y;
                if (v.strip !== 'under') {
                    if (z > 5.6 && ax > 1.0 && ax < 2.2 && y > 1.7 && y < 2.15 && v.strip !== 'top') c = HEAD;
                    if (z > 5.8 && ax < 1.0 && y > 1.2 && y < 1.9) c = DARK;
                    if (z > 6.0 && y < 1.5) c = DARK;
                    if (z < -5.9 && ax > 1.5 && y > 1.5 && y < 3.4) c = TAIL;
                    if (z < -6.0 && y < 1.6) c = DARK;
                    if (v.strip !== 'top' && z < 1.6 && z > -5.3 && y > 2.35 && y < 2.55) c = DARK;           // чорна смуга по боку, як у відео
                }
                return c;
            },
            classify: function (q) {
                var z = q.z, y = q.y;
                if (z > 5.65 && y < 1.7 && q.strip !== 'top') return 'fbump';
                if (z < -5.65 && y < 1.55 && q.strip !== 'top') return 'rbump';
                if (q.strip === 'under') return 'body';
                if (z < -5.85 && y > 1.6) return 'trunk';                                                     // задні двері
                if (q.strip === 'right' || q.strip === 'left') {
                    if (z > 2.2 && z < 4.9 && q.k >= 3 && q.k < K_SIDE - 1) return q.strip === 'right' ? 'doorL' : 'doorR';
                    return 'body';
                }
                if (q.j <= (J_TOP / 2 - 1) && q.c > 0.4 && z > 2.0 && z < 4.9) {
                    if (q.c < 0.96 && q.j <= 1) return 'body';
                    return 'glass';
                }
                if (q.c < 0.3 && q.j >= 1 && z > 4.3 && z < 5.9) return 'hood';
                return 'body';
            },
            partInfo: {
                fbump: { hinge: [0, 1.3, 5.8], axis: [1, 0, 0], maxAngle: 0.18, shift: [0, -0.05, -0.6] },
                rbump: { hinge: [0, 1.3, -5.8], axis: [1, 0, 0], maxAngle: -0.18, shift: [0, -0.05, 0.6] },
                hood: { hinge: [0, 2.6, 4.2], axis: [1, 0, 0], maxAngle: -0.4, shift: [0, 0.05, -0.3] },
                trunk: { hinge: [2.3, 3.2, -6.0], axis: [0, 1, 0], maxAngle: 0.6, shift: [0, 0, 0.25] },
                doorL: { hinge: [2.55, 2.4, 4.8], axis: [0, 1, 0], maxAngle: 0.5, shift: [0.1, 0, 0] },
                doorR: { hinge: [-2.55, 2.4, 4.8], axis: [0, 1, 0], maxAngle: -0.5, shift: [-0.1, 0, 0] }
            },
            build: function (body, glass, parts) {
                box(body, { c: [0, 1.55, 5.0], s: [1.9, 0.1, 1.0], color: [0.09, 0.09, 0.11] });
                box(body, { c: [0, 1.75, 5.0], s: [0.85, 0.2, 0.7], color: [0.3, 0.31, 0.35] });
                box(body, { c: [0, 1.3, 5.75], s: [1.9, 0.3, 0.12], color: [0.1, 0.1, 0.12] });
                box(body, { c: [0, 1.3, -5.75], s: [1.9, 0.3, 0.12], color: [0.1, 0.1, 0.12] });
                box(body, { c: [0, 1.2, -1.0], s: [2.1, 0.08, 4.8], color: INTERIOR });                       // підлога вантажного відсіку
                box(body, { c: [0, 3.6, -5.95], s: [2.0, 1.2, 0.05], color: [0.1, 0.1, 0.12] });
                [-1, 1].forEach(function (s) {
                    box(body, { c: [s * 1.15, 1.7, 3.4], s: [0.65, 0.3, 0.65], color: SEAT });
                    superEllipsoid(body, { c: [s * 1.15, 2.6, 2.6], s: [0.62, 0.95, 0.2], n: 3, color: SEAT, seg: [10, 8] });
                });
                box(body, { c: [0, 2.6, 4.7], s: [2.15, 0.45, 0.4], color: [0.12, 0.125, 0.15] });
                box(parts.fbump.geo, { c: [0, 1.05, 6.18], s: [0.75, 0.17, 0.03], color: [0.96, 0.96, 0.97] });
                box(parts.rbump.geo, { c: [0, 1.15, -6.2], s: [0.75, 0.17, 0.03], color: [0.96, 0.96, 0.97] });
                box(parts.trunk.geo, { c: [0, 3.4, -6.28], s: [0.04, 1.7, 0.03], color: SEAM });
                box(parts.trunk.geo, { c: [0.9, 3.1, -6.27], s: [0.06, 0.05, 0.05], color: CHROME });
                [1, -1].forEach(function (s) {
                    box(parts[s > 0 ? 'doorL' : 'doorR'].geo, { c: [s * 2.62, 2.75, 3.7], s: [0.04, 0.05, 0.3], color: CHROME });
                    var g = newGeo();
                    superEllipsoid(g, { c: [s * 3.0, 3.2, 4.3], s: [0.2, 0.42, 0.2], n: 2.6, color: DARK, seg: [10, 8] });
                    box(g, { c: [s * 2.7, 3.0, 4.3], s: [0.28, 0.04, 0.08], color: DARK });
                    parts[s > 0 ? 'mirL' : 'mirR'] = { geo: g, hinge: [s * 2.7, 3.0, 4.3], axis: [0, 1, 0], maxAngle: s * 0.8, shift: [0, 0, 0] };
                });
                var rk = newGeo();
                [-3.0, 0.2].forEach(function (rz) { box(rk, { c: [0, 5.3, rz], s: [1.8, 0.06, 0.07], color: CHROME }); });
                [-1, 1].forEach(function (s) { box(rk, { c: [s * 1.6, 5.3, -1.4], s: [0.07, 0.06, 1.7], color: CHROME }); });
                parts.extra = { geo: rk, hinge: [0, 5.2, -1.2], axis: [1, 0, 0], maxAngle: 0.3, shift: [0, 0, 0] };
            }
        };
        return spec;
    }

    // =================================================================
    // Вантажівка (синя капотна кабіна й білий фургон-кузов), 6 коліс
    // =================================================================
    var TRUCK_WHEELS = [[2.4, 4.5, true], [-2.4, 4.5, true], [2.4, -3.2, false], [-2.4, -3.2, false], [2.4, -5.5, false], [-2.4, -5.5, false]];
    var BLUE = [0.14, 0.38, 0.78], BLUE_LOW = [0.07, 0.2, 0.5];
    function truckSpec() {
        var spec = {
            dz: 0.18, archR: 1.62, archDepth: 0.36, wheelW: 0.95,
            paintLow: BLUE_LOW, paintHigh: BLUE, paintY: [1.3, 5.9],
            wheels: [{ x: 2.4, z: 4.5, y: 1.15 }, { x: -2.4, z: 4.5, y: 1.15 }],
            keys: [
                { z: 2.34, y0: 2.4, w0: 1.2, w1: 1.5, yb: 3.9, hc: 0.1, c: 1, yr: 5.0, wr: 1.1 },
                { z: 2.5, y0: 1.5, w0: 2.2, w1: 2.5, yb: 4.0, hc: 0.1, c: 1, yr: 5.6, wr: 1.9 },
                { z: 3.0, y0: 1.3, w0: 2.4, w1: 2.74, yb: 4.15, hc: 0.1, c: 1, yr: 5.85, wr: 2.2 },
                { z: 4.4, y0: 1.3, w0: 2.4, w1: 2.74, yb: 4.15, hc: 0.1, c: 1, yr: 5.8, wr: 2.1 },
                { z: 5.0, y0: 1.3, w0: 2.4, w1: 2.72, yb: 4.15, hc: 0.2, c: 0.5, yr: 5.2, wr: 2.0 },
                { z: 5.5, y0: 1.3, w0: 2.4, w1: 2.7, yb: 4.1, hc: 0.3, c: 0, yr: 4.6, wr: 1.9 },
                { z: 6.3, y0: 1.3, w0: 2.35, w1: 2.65, yb: 4.0, hc: 0.3, c: 0, yr: 4.4, wr: 1.9 },
                { z: 7.3, y0: 1.35, w0: 2.2, w1: 2.5, yb: 3.7, hc: 0.25, c: 0, yr: 4.2, wr: 1.8 },
                { z: 7.72, y0: 1.5, w0: 1.5, w1: 2.0, yb: 3.1, hc: 0.15, c: 0, yr: 4.0, wr: 1.0 },
                { z: 7.9, y0: 1.9, w0: 0.5, w1: 0.9, yb: 2.4, hc: 0.05, c: 0, yr: 3.5, wr: 0.4 }
            ],
            extraShells: [{
                dz: 0.3, archR: 0, wheels: [], wheelW: 0.9, paintLow: [0.72, 0.74, 0.8], paintHigh: WHITE, paintY: [2.3, 7.4],
                keys: [
                    { z: -7.95, y0: 3.3, w0: 1.0, w1: 1.2, yb: 6.2, hc: 0.1, c: 1, yr: 6.5, wr: 0.8 },
                    { z: -7.8, y0: 2.4, w0: 2.3, w1: 2.5, yb: 6.6, hc: 0.1, c: 1, yr: 7.2, wr: 2.0 },
                    { z: -7.1, y0: 2.3, w0: 2.68, w1: 2.74, yb: 6.9, hc: 0.1, c: 1, yr: 7.4, wr: 2.55 },
                    { z: -1.0, y0: 2.3, w0: 2.7, w1: 2.76, yb: 6.9, hc: 0.1, c: 1, yr: 7.42, wr: 2.55 },
                    { z: 1.5, y0: 2.3, w0: 2.68, w1: 2.74, yb: 6.9, hc: 0.1, c: 1, yr: 7.4, wr: 2.55 },
                    { z: 2.05, y0: 2.4, w0: 2.3, w1: 2.5, yb: 6.6, hc: 0.1, c: 1, yr: 7.2, wr: 2.0 },
                    { z: 2.18, y0: 3.3, w0: 1.0, w1: 1.2, yb: 6.2, hc: 0.1, c: 1, yr: 6.5, wr: 0.8 }
                ],
                paint: function (v) {
                    if (v.strip === 'under') return DARK;
                    var c = gradPaint([0.72, 0.74, 0.8], WHITE, 2.3, 7.4, v.y);
                    if (v.z < -7.6 && v.ax > 1.6 && v.y < 4.2) c = TAIL;
                    return c;
                },
                classify: function () { return 'body'; }
            }],
            paint: function (v) {
                var c = bodyColor(spec, v);
                var ax = v.ax, z = v.z, y = v.y;
                if (v.strip !== 'under') {
                    if (z > 7.2 && ax > 1.1 && ax < 2.2 && y > 2.6 && y < 3.3 && v.strip !== 'top') c = HEAD;
                    if (z > 7.4 && ax < 1.1 && y > 1.8 && y < 3.4) c = CHROME;                                 // решітка радіатора
                    if (z > 7.5 && y < 2.0) c = DARK;
                }
                return c;
            },
            classify: function (q) {
                var z = q.z, y = q.y;
                if (z > 7.3 && y < 2.15 && q.strip !== 'top') return 'fbump';
                if (q.strip === 'under') return 'body';
                if (q.strip === 'right' || q.strip === 'left') {
                    if (z > 2.9 && z < 4.9 && q.k >= 5 && q.k < K_SIDE - 1) return q.strip === 'right' ? 'doorL' : 'doorR';
                    return 'body';
                }
                if (q.j <= (J_TOP / 2 - 1) && q.c > 0.42 && z > 2.8 && z < 5.3) {
                    if (q.c < 0.96 && q.j <= 1) return 'body';
                    return 'glass';
                }
                if (q.c < 0.3 && q.j >= 1 && z > 5.5 && z < 7.5) return 'hood';
                return 'body';
            },
            partInfo: {
                fbump: { hinge: [0, 1.7, 7.4], axis: [1, 0, 0], maxAngle: 0.18, shift: [0, -0.05, -0.7] },
                rbump: { hinge: [0, 1.7, -7.7], axis: [1, 0, 0], maxAngle: -0.18, shift: [0, -0.05, 0.7] },
                hood: { hinge: [0, 3.9, 5.2], axis: [1, 0, 0], maxAngle: -0.4, shift: [0, 0.05, -0.4] },
                trunk: { hinge: [2.5, 4.9, -7.85], axis: [0, 1, 0], maxAngle: 0.6, shift: [0, 0, 0.3] },
                doorL: { hinge: [2.75, 4.0, 4.9], axis: [0, 1, 0], maxAngle: 0.5, shift: [0.1, 0, 0] },
                doorR: { hinge: [-2.75, 4.0, 4.9], axis: [0, 1, 0], maxAngle: -0.5, shift: [-0.1, 0, 0] }
            },
            build: function (body, glass, parts) {
                // рама, баки, задні крила й підніжки; підкапотний двигун
                box(body, { c: [0, 1.75, -2.6], s: [1.9, 0.42, 5.3], color: DARK });
                box(body, { c: [0, 1.7, 5.0], s: [1.9, 0.12, 1.1], color: [0.09, 0.09, 0.11] });
                box(body, { c: [0, 2.2, 5.9], s: [1.0, 0.5, 0.9], color: [0.3, 0.31, 0.35] });
                [-1, 1].forEach(function (s) {
                    cylinder(body, { c: [s * 2.35, 1.9, 0.8], r: 0.55, h: 2.2, rot: [Math.PI / 2, 0, 0], color: [0.52, 0.55, 0.6], seg: 12 });
                    box(body, { c: [s * 2.3, 1.1, 3.0], s: [0.45, 0.1, 0.5], color: CHROME });
                    [-3.2, -5.5].forEach(function (wz) { box(body, { c: [s * 2.45, 2.42, wz - 0.1], s: [0.55, 0.06, 1.5], color: DARK }); });  // крила над колесами
                });
                box(body, { c: [0, 3.6, 2.45], s: [2.0, 0.9, 0.06], color: [0.1, 0.1, 0.12] });
                box(body, { c: [0, 1.7, -7.7], s: [2.3, 0.3, 0.3], color: DARK });                              // задній відбійник
                [-1, 1].forEach(function (s) {
                    box(body, { c: [s * 1.3, 3.1, 4.2], s: [0.7, 0.28, 0.7], color: SEAT });
                    superEllipsoid(body, { c: [s * 1.3, 4.2, 3.4], s: [0.65, 0.9, 0.2], n: 3, color: SEAT, seg: [10, 8] });
                });
                for (var r = 0; r < 8; r++) {
                    var rz = -6.3 + r * 1.0;
                    [-1, 1].forEach(function (s) { box(body, { c: [s * 2.78, 4.7, rz], s: [0.03, 1.9, 0.07], color: WHITE_LOW }); });     // ребра кузова
                }
                box(body, { c: [0, 4.7, -7.99], s: [0.04, 1.8, 0.03], color: SEAM });
                box(parts.fbump.geo, { c: [0, 1.55, 7.55], s: [2.6, 0.38, 0.28], color: CHROME });
                box(parts.fbump.geo, { c: [0, 1.7, 7.9], s: [0.7, 0.18, 0.03], color: [0.95, 0.95, 0.96] });
                parts.rbump = { geo: newGeo(), hinge: [0, 1.7, -7.7], axis: [1, 0, 0], maxAngle: -0.18, shift: [0, -0.05, 0.7] };
                box(parts.rbump.geo, { c: [0, 1.7, -7.95], s: [2.5, 0.28, 0.2], color: DARK });
                box(parts.trunk.geo, { c: [0, 4.9, -8.0], s: [2.2, 1.9, 0.06], color: WHITE });
                box(parts.trunk.geo, { c: [0, 4.9, -8.03], s: [0.03, 1.8, 0.02], color: SEAM });
                [1, -1].forEach(function (s) {
                    box(parts[s > 0 ? 'doorL' : 'doorR'].geo, { c: [s * 2.78, 4.4, 4.2], s: [0.04, 0.05, 0.3], color: CHROME });
                    var g = newGeo();
                    superEllipsoid(g, { c: [s * 3.08, 4.5, 4.75], s: [0.22, 0.5, 0.24], n: 2.6, color: DARK, seg: [10, 8] });
                    box(g, { c: [s * 2.82, 4.3, 4.75], s: [0.3, 0.04, 0.09], color: DARK });
                    parts[s > 0 ? 'mirL' : 'mirR'] = { geo: g, hinge: [s * 2.82, 4.3, 4.75], axis: [0, 1, 0], maxAngle: s * 0.8, shift: [0, 0, 0] };
                });
                var ex = newGeo();
                cylinder(ex, { c: [2.3, 6.6, 2.85], r: 0.2, h: 3.6, color: CHROME, seg: 8 });
                parts.extra = { geo: ex, hinge: [2.3, 5.0, 2.85], axis: [0, 0, 1], maxAngle: 0.4, shift: [0, 0, 0] };
            }
        };
        return spec;
    }

    // =================================================================
    // Збирання машини для гри
    // =================================================================
    var CAR_DEFS = {
        sedan: { spec: sedanSpec, wheelR: 0.95, wheelW: 0.85, wheels: SEDAN_WHEELS, seat: [1.0, 1.2, -0.5], height: 3.95, len: 11, wid: 5.0 },
        van: { spec: vanSpec, wheelR: 1.0, wheelW: 0.9, wheels: VAN_WHEELS, seat: [1.15, 2.0, 2.0], height: 5.1, len: 12, wid: 5.2 },
        truck: { spec: truckSpec, wheelR: 1.15, wheelW: 0.95, wheels: TRUCK_WHEELS, seat: [1.25, 2.6, 4.1], height: 7.5, len: 16, wid: 5.6 }
    };
    var CAR_TYPES = Object.keys(CAR_DEFS);

    // Результат: opaque (кузов без відламуваних деталей), glass (скло), parts { fbump, rbump, hood, trunk, doorL, doorR, mirL, mirR, extra }
    // — окремі геометрії з точкою кріплення (hinge), віссю й кутом для «зім'ятості»; wheel — одне колесо (праве/ліве однакові).
    // =================================================================
    // Додаткова деталізація кузовів (листопад 2026): решітки з ламелями, бічні забірники, протитуманки в хромових кільцях,
    // пороги, дифузор, лампи заднього ходу, замки й петлі, бокові габарити, бризковики, паливні баки, ребра даху.
    // Дрібні елементи на бамперах, дверях, капоті й кришці багажника прикріплені до цих деталей і відлітають разом із ними.
    // =================================================================
    var SLAT = [0.27, 0.28, 0.33], BLACK = [0.02, 0.02, 0.03], REFLECT = [0.75, 0.08, 0.08], LAMP_W = [0.95, 0.95, 0.9];
    function slats(g, cx, cy, cz, hw, n, gap, color, tz) {
        for (var k = 0; k < n; k++) box(g, { c: [cx, cy + k * gap, cz], s: [hw, 0.012, tz || 0.02], color: color || SLAT });
    }
    // хромове кільце навколо кругової лампи, що дивиться вздовж ±Z
    function lampRing(g, c, r, color, dir) {
        cylinder(g, { c: c, r: r * 1.28, h: 0.03, rot: [Math.PI / 2, 0, 0], color: CHROME, seg: 14 });
        cylinder(g, { c: [c[0], c[1], c[2] + 0.02 * dir], r: r, h: 0.03, rot: [Math.PI / 2, 0, 0], color: color, seg: 14 });
    }

    function addSedanDetails(m) {
        var fb = m.parts.fbump.geo, rb = m.parts.rbump.geo, dl = m.parts.doorL.geo, dr = m.parts.doorR.geo, body = m.opaque, k;
        // перед: решітка-ламелі над номером, бічні забірники з ламелями, протитуманки, спліттер, буксирне вушко
        box(fb, { c: [0, 1.36, 5.72], s: [1.15, 0.13, 0.04], color: BLACK });
        slats(fb, 0, 1.27, 5.76, 1.1, 5, 0.045);
        [-1, 1].forEach(function (sx) {
            box(fb, { c: [sx * 1.88, 0.82, 5.64], s: [0.32, 0.15, 0.04], color: BLACK });
            slats(fb, sx * 1.88, 0.74, 5.68, 0.29, 4, 0.045);
            lampRing(fb, [sx * 1.45, 0.82, 5.76], 0.12, [1, 0.96, 0.8], 1);
        });
        box(fb, { c: [0, 0.6, 5.74], s: [2.05, 0.03, 0.15], color: BLACK });
        box(fb, { c: [0.0, 0.7, 5.8], s: [0.12, 0.05, 0.03], color: REFLECT });
        // зад: дифузор із ребрами, лампи заднього ходу, відбивачі, внутрішні порожнини вихлопів
        box(rb, { c: [0, 0.66, -5.75], s: [1.7, 0.04, 0.15], color: BLACK });
        for (k = -3; k <= 3; k++) box(rb, { c: [k * 0.4, 0.8, -5.84], s: [0.018, 0.12, 0.05], color: BLACK });
        [-1, 1].forEach(function (sx) {
            box(rb, { c: [sx * 1.15, 1.45, -5.8], s: [0.28, 0.07, 0.03], color: LAMP_W });
            box(rb, { c: [sx * 2.05, 0.95, -5.7], s: [0.2, 0.05, 0.03], color: REFLECT });
            cylinder(body, { c: [sx * 1.5, 0.95, -5.96], r: 0.13, h: 0.04, rot: [Math.PI / 2, 0, 0], color: BLACK, seg: 10 });
        });
        // боки: пороги, шви дверей, ручки-вставки, паливний лючок, молдинги
        [-1, 1].forEach(function (sx) {
            var door = sx > 0 ? dl : dr;
            box(body, { c: [sx * 2.4, 0.92, -0.1], s: [0.07, 0.1, 2.75], color: BLACK });
            [1.92, -0.12, -2.0].forEach(function (z) { box(door, { c: [sx * 2.475, 2.1, z], s: [0.012, 0.85, 0.012], color: SEAM }); });
            box(door, { c: [sx * 2.475, 1.3, 0.0], s: [0.012, 0.012, 1.9], color: SEAM });
            box(door, { c: [sx * 2.475, 2.72, 0.0], s: [0.014, 0.025, 1.9], color: CHROME });
        });
        cylinder(body, { c: [2.45, 2.4, -3.1], r: 0.2, h: 0.04, rot: [0, 0, Math.PI / 2], color: DARK, seg: 12 });
        cylinder(body, { c: [2.47, 2.4, -3.1], r: 0.1, h: 0.03, rot: [0, 0, Math.PI / 2], color: CHROME, seg: 10 });
        // дах: антена-«акулячий плавник»
        superEllipsoid(body, { c: [0, 3.98, -1.9], s: [0.1, 0.1, 0.3], n: 2.4, color: BLACK, seg: [10, 6] });
        // індикатори поворотів на дзеркалах
        ['mirL', 'mirR'].forEach(function (n, i) {
            var sx = i === 0 ? 1 : -1;
            if (m.parts[n]) box(m.parts[n].geo, { c: [sx * 2.8, 2.95, 2.3], s: [0.1, 0.04, 0.03], color: AMBER });
        });
    }

    function addVanDetails(m) {
        var fb = m.parts.fbump.geo, rb = m.parts.rbump.geo, tr = m.parts.trunk.geo, body = m.opaque, k;
        // перед: решітка з ламелями, нижні забірники, протитуманки, буксирне вушко
        box(fb, { c: [0, 1.0, 6.04], s: [1.35, 0.13, 0.04], color: BLACK });
        slats(fb, 0, 0.92, 6.08, 1.3, 4, 0.055);
        [-1, 1].forEach(function (sx) {
            box(fb, { c: [sx * 2.0, 0.95, 6.0], s: [0.3, 0.15, 0.04], color: BLACK });
            slats(fb, sx * 2.0, 0.87, 6.04, 0.27, 4, 0.05);
            lampRing(fb, [sx * 1.55, 1.4, 6.08], 0.13, [1, 0.96, 0.8], 1);
        });
        box(fb, { c: [0, 0.68, 6.08], s: [2.1, 0.03, 0.12], color: BLACK });
        // зад: східці-бампер із рифленням, лампи заднього ходу, відбивачі, петлі й засув дверей
        box(rb, { c: [0, 1.45, -6.12], s: [2.2, 0.05, 0.12], color: [0.12, 0.12, 0.14] });
        for (k = -5; k <= 5; k++) box(rb, { c: [k * 0.4, 1.5, -6.14], s: [0.02, 0.025, 0.1], color: [0.3, 0.3, 0.34] });
        [-1, 1].forEach(function (sx) {
            box(rb, { c: [sx * 1.2, 1.1, -6.2], s: [0.28, 0.07, 0.03], color: LAMP_W });
            box(rb, { c: [sx * 2.2, 0.92, -6.1], s: [0.2, 0.05, 0.03], color: REFLECT });
            box(tr, { c: [sx * 2.45, 4.4, -6.2], s: [0.07, 0.18, 0.05], color: CHROME });
            box(tr, { c: [sx * 2.45, 2.6, -6.2], s: [0.07, 0.18, 0.05], color: CHROME });
        });
        box(tr, { c: [-0.15, 3.1, -6.27], s: [0.04, 0.35, 0.04], color: CHROME });
        // боки: бічні двері вантажного відсіку (шви + ручка + напрямна), габаритні ліхтарі, паливний лючок, бризковики
        [-1, 1].forEach(function (sx) {
            [1.4, -3.3].forEach(function (z) { box(body, { c: [sx * 2.62, 3.2, z], s: [0.012, 1.35, 0.012], color: SEAM }); });
            box(body, { c: [sx * 2.62, 4.55, -0.95], s: [0.012, 0.012, 2.35], color: SEAM });
            box(body, { c: [sx * 2.63, 3.3, 0.9], s: [0.025, 0.05, 0.3], color: CHROME });
            [-5.5, 5.3].forEach(function (z) { box(body, { c: [sx * 2.62, 2.0, z], s: [0.02, 0.06, 0.16], color: AMBER }); });
            box(body, { c: [sx * 2.58, 0.9, -4.85], s: [0.02, 0.42, 0.34], color: BLACK });          // бризковик за заднім колесом
        });
        cylinder(body, { c: [-2.6, 3.0, -2.6], r: 0.22, h: 0.04, rot: [0, 0, Math.PI / 2], color: DARK, seg: 12 });
        // дах: вентиляційний люк і антена
        box(body, { c: [0.0, 5.17, 1.4], s: [0.7, 0.03, 0.55], color: [0.82, 0.84, 0.88] });
        box(body, { c: [0.0, 5.2, 1.4], s: [0.5, 0.01, 0.35], color: SEAM });
        superEllipsoid(body, { c: [-1.0, 5.2, 3.0], s: [0.09, 0.09, 0.25], n: 2.4, color: BLACK, seg: [10, 6] });
        // індикатори поворотів на дзеркалах
        ['mirL', 'mirR'].forEach(function (n, i) {
            var sx = i === 0 ? 1 : -1;
            if (m.parts[n]) box(m.parts[n].geo, { c: [sx * 3.02, 3.0, 4.6], s: [0.05, 0.12, 0.03], color: AMBER });
        });
    }

    function addTruckDetails(m) {
        var fb = m.parts.fbump.geo, rb = m.parts.rbump.geo, tr = m.parts.trunk.geo, body = m.opaque, k;
        // кабіна: решітка з хромовими планками, зубчаста нижня решітка, фара-«вії», буксирні петлі
        for (k = 0; k < 5; k++) box(fb, { c: [0, 2.0 + k * 0.2, 8.0], s: [0.85, 0.035, 0.03], color: CHROME });
        box(fb, { c: [0, 1.55, 8.02], s: [1.05, 0.12, 0.03], color: BLACK });
        [-1, 1].forEach(function (sx) {
            box(fb, { c: [sx * 1.65, 1.6, 7.98], s: [0.12, 0.08, 0.05], color: [0.8, 0.1, 0.1] });    // тягові петлі
            lampRing(fb, [sx * 1.9, 2.95, 7.7], 0.3, HEAD, 1);                                           // великі круглі фари
        });
        // кабіна: габаритні вогні на даху, повітряний сигнал
        for (k = -2; k <= 2; k++) sphere(body, [k * 0.5, 5.95, 3.7], 0.11, AMBER);
        cylinder(body, { c: [1.2, 6.1, 2.85], r: 0.09, h: 0.5, color: CHROME, seg: 8 });
        cylinder(body, { c: [-1.2, 6.1, 2.85], r: 0.09, h: 0.5, color: CHROME, seg: 8 });
        // рама: паливні баки, трансмісія, ресори
        [-1, 1].forEach(function (sx) {
            cylinder(body, { c: [sx * 2.2, 1.62, 0.8], r: 0.55, h: 2.4, rot: [Math.PI / 2, 0, 0], color: [0.7, 0.72, 0.78], seg: 14 });
            [-0.2, 1.8].forEach(function (z) { box(body, { c: [sx * 2.2, 1.62, z], s: [0.12, 0.6, 0.05], color: DARK }); });
            box(body, { c: [sx * 2.55, 1.35, -4.3], s: [0.05, 0.08, 1.9], color: [0.3, 0.3, 0.34] });  // ресори заднього візка
        });
        cylinder(body, { c: [0, 1.45, -1.5], r: 0.12, h: 4.0, rot: [Math.PI / 2, 0, 0], color: [0.35, 0.36, 0.4], seg: 8 });
        // кузов-фургон: ребра даху, бокові габарити (янтарні спереду й червоні ззаду), бризковики, засуви й петлі задніх дверей
        for (k = 0; k < 9; k++) box(body, { c: [0, 7.46, -7.2 + k * 1.05], s: [2.4, 0.03, 0.05], color: [0.8, 0.82, 0.86] });
        [-1, 1].forEach(function (sx) {
            [-6.5, -3.2, 0.0, 1.6].forEach(function (z, i) { box(body, { c: [sx * 2.76, 2.55, z], s: [0.02, 0.07, 0.18], color: i === 3 ? AMBER : REFLECT }); });
            box(body, { c: [sx * 2.72, 1.3, -6.9], s: [0.02, 0.55, 0.45], color: BLACK });          // бризковик за заднім візком
            box(body, { c: [sx * 2.72, 1.5, 3.2], s: [0.02, 0.4, 0.3], color: BLACK });             // бризковик за кабіною-колесом
            box(tr, { c: [sx * 2.55, 6.2, -8.05], s: [0.07, 0.2, 0.05], color: CHROME });
            box(tr, { c: [sx * 2.55, 3.4, -8.05], s: [0.07, 0.2, 0.05], color: CHROME });
            box(tr, { c: [sx * 1.2, 4.9, -8.08], s: [0.04, 1.3, 0.03], color: CHROME });            // вертикальні засуви
            box(tr, { c: [sx * 1.2, 4.5, -8.12], s: [0.1, 0.05, 0.03], color: CHROME });
        });
        box(rb, { c: [0, 1.9, -8.0], s: [2.5, 0.12, 0.1], color: BLACK });
        for (k = -2; k <= 2; k++) box(rb, { c: [k * 0.9, 2.05, -8.08], s: [0.04, 0.05, 0.03], color: REFLECT });
    }
    var CAR_DETAILS = { sedan: addSedanDetails, van: addVanDetails, truck: addTruckDetails };

    // ---------------------------------------------------------------- друга хвиля деталізації (листопад 2026), однакова для всіх машин:
    // номерні знаки з цифрами на обох бамперах (відлітають разом із бампером), кермо з обідом, спицями й хабом на колонці, приладова
    // панель із двома шкалами, центральна консоль із важелем, дзеркало салону, омивач і «дворники» під лобовим склом.
    var PLATE_GLYPHS = {
        K: ['101', '101', '110', '101', '101'], I: ['111', '010', '010', '010', '111'], S: ['111', '100', '111', '001', '111'],
        H: ['101', '101', '111', '101', '101'], A: ['010', '101', '111', '101', '101'], '1': ['010', '110', '010', '010', '111'],
        '2': ['111', '001', '111', '100', '111'], '6': ['111', '100', '111', '101', '111'], '0': ['111', '101', '101', '101', '111']
    };
    function plateOn(g, cx, cy, z, dir, w) {
        // dir = +1 — табличка дивиться на +Z (передня), -1 — на -Z (задня); w — ширина. Текст читається зліва направо з боку глядача.
        var h = w * 0.22, d = 0.035 * dir, sg = dir > 0 ? 1 : -1;
        box(g, { c: [cx, cy, z + d * 0.5], s: [w / 2, h / 2, 0.02], color: [0.96, 0.96, 0.9] });
        box(g, { c: [cx + sg * (-w / 2 + w * 0.045), cy, z + d], s: [w * 0.04, h / 2, 0.012], color: [0.1, 0.25, 0.75] });     // синя смуга зліва
        var text = 'KISHKA'.split(''), ps = w * 0.0225;
        for (var i = 0; i < text.length; i++) {
            var gl = PLATE_GLYPHS[text[i]];
            for (var gy = 0; gy < 5; gy++) for (var gx = 0; gx < 3; gx++) {
                if (gl[gy].charAt(gx) !== '1') continue;
                box(g, { c: [cx + sg * (-w * 0.36 + i * (w * 0.135) + gx * ps * 1.5), cy + (2 - gy) * ps * 1.5, z + d * 1.6], s: [ps * 0.7, ps * 0.7, 0.006], color: [0.06, 0.06, 0.08] });
            }
        }
    }
    function geoExtent(g, axis) {
        var lo = 1e9, hi = -1e9;
        for (var i = axis; i < g.pos.length; i += 3) { if (g.pos[i] < lo) lo = g.pos[i]; if (g.pos[i] > hi) hi = g.pos[i]; }
        return [lo, hi];
    }
    function addCommonDetails(m, def) {
        var k, sx = def.seat[0], sy = def.seat[1], sz = def.seat[2], body = m.opaque;
        // номерні знаки: по межах геометрії бамперів (де саме бампер — береться з самої моделі)
        var fb = m.parts.fbump && m.parts.fbump.geo, rb = m.parts.rbump && m.parts.rbump.geo;
        if (fb && fb.pos.length) {
            var zf = geoExtent(fb, 2)[1], yf = geoExtent(fb, 1);
            plateOn(fb, 0, yf[0] + (yf[1] - yf[0]) * 0.34, zf, 1, Math.min(1.9, def.wid * 0.36));
        }
        if (rb && rb.pos.length) {
            var zr = geoExtent(rb, 2)[0], yr = geoExtent(rb, 1);
            plateOn(rb, 0, yr[0] + (yr[1] - yr[0]) * 0.5, zr, -1, Math.min(1.9, def.wid * 0.36));
        }
        // кермо: обід із 16 сегментів, три спиці, хаб, колонка
        var wx = sx, wy = sy + 0.95, wz = sz + 1.3, R = 0.46, tilt = 1.1;
        var ct = Math.cos(tilt), st = Math.sin(tilt);        // «вгору» площини керма в координатах моделі = (0, st, ct)
        for (k = 0; k < 16; k++) {
            var a = k / 16 * Math.PI * 2, px = Math.cos(a) * R, pv = Math.sin(a) * R;
            // площина керма нахилена до водія: локальне «вгору» керма = (0, st, ct) у координатах моделі
            box(body, { c: [wx + px, wy + pv * st, wz + pv * ct], s: [0.075, 0.075, 0.075], rot: [tilt, 0, a], color: [0.07, 0.07, 0.09] });
        }
        for (k = 0; k < 3; k++) {
            var sa = k * (Math.PI * 2 / 3) + Math.PI / 2, sr = R * 0.5;
            box(body, { c: [wx + Math.cos(sa) * sr, wy + Math.sin(sa) * sr * st, wz + Math.sin(sa) * sr * ct], s: [0.04, R * 0.5, 0.04], rot: [tilt, 0, sa + Math.PI / 2], color: [0.13, 0.13, 0.16] });
        }
        cylinder(body, { c: [wx, wy, wz], r: 0.15, h: 0.1, rot: [tilt, 0, 0], color: [0.2, 0.2, 0.25], seg: 12 });
        cylinder(body, { c: [wx, wy - 0.18, wz - 0.28], r: 0.07, h: 0.55, rot: [tilt, 0, 0], color: [0.12, 0.12, 0.15], seg: 8 });       // колонка керма
        // приладова панель перед водієм і пасажиром, дві шкали, центральна консоль, важіль, дзеркало салону
        var dz = sz + 1.7, dy = sy + 0.78, half = Math.min(def.wid / 2 - 0.55, 2.0);
        box(body, { c: [0, dy, dz], s: [half, 0.22, 0.28], color: [0.09, 0.095, 0.115] });
        box(body, { c: [0, dy + 0.26, dz - 0.05], s: [half * 0.96, 0.05, 0.22], color: [0.05, 0.05, 0.065] });
        cylinder(body, { c: [wx - 0.28, dy + 0.12, dz - 0.3], r: 0.2, h: 0.03, rot: [Math.PI / 2, 0, 0], color: [0.1, 0.55, 0.75], seg: 14 });
        cylinder(body, { c: [wx + 0.28, dy + 0.12, dz - 0.3], r: 0.2, h: 0.03, rot: [Math.PI / 2, 0, 0], color: [0.85, 0.35, 0.15], seg: 14 });
        box(body, { c: [0, sy + 0.45, sz + 0.2], s: [0.3, 0.3, 1.1], color: [0.08, 0.085, 0.1] });
        cylinder(body, { c: [0, sy + 0.95, sz + 0.5], r: 0.05, h: 0.5, color: [0.7, 0.72, 0.76], seg: 8 });
        sphere(body, [0, sy + 1.22, sz + 0.5], 0.1, [0.12, 0.12, 0.14], { seg: [8, 6] });
        box(body, { c: [0, dy + 1.05, dz - 0.15], s: [0.32, 0.1, 0.05], color: [0.08, 0.08, 0.1] });
        // «дворники» й омивач: дві чорні планки біля основи лобового скла
        for (k = -1; k <= 1; k += 2) box(body, { c: [k * 0.9, dy + 0.34, dz + 0.12], s: [0.7, 0.012, 0.025], rot: [0, k * 0.08, 0], color: [0.04, 0.04, 0.05] });
    }


    function buildCar(type) {
        var def = CAR_DEFS[type];
        if (!def) throw new Error('unknown car type: ' + type);
        var m = assembleCar(def.spec());
        if (CAR_DETAILS[type]) CAR_DETAILS[type](m);
        addCommonDetails(m, def);
        var wheelPos = def.wheels.map(function (w) {
            return { x: w[0], y: def.wheelR, z: w[1], steer: !!w[2], flip: w[0] < 0 };
        });
        return {
            type: type, opaque: m.opaque, glass: m.glass, parts: m.parts,
            wheel: wheelGeo(def.wheelR, def.wheelW, 10), wheelPos: wheelPos, wheelR: def.wheelR,
            seat: def.seat, height: def.height, len: def.len, wid: def.wid
        };
    }

    // Окремий уламок для віддаленої/відламаної деталі: геометрія за назвою (fbump, hood, …, wheel)
    function partGeometry(car, name) {
        if (name === 'wheel' || /^wheel\d$/.test(name)) return car.wheel;
        return car.parts[name] ? car.parts[name].geo : null;
    }

    // =================================================================
    // Гірка: суцільне тіло з плоскою верхівкою, рівним підйомом і вертикальними бічними стінами (як на відео-орієнтирі).
    // Верх малюється «шаховою» плиткою розміру CFG.rampTile; стіни — темніші, суцільного кольору.
    // =================================================================
    var RAMP_TOP = [0.64, 0.65, 0.69], RAMP_TOP2 = [0.58, 0.59, 0.63], RAMP_WALL = [0.3, 0.33, 0.45], RAMP_WALL_LO = [0.22, 0.24, 0.34];
    function buildRamp(World) {
        var RP = World.RAMP, top = newGeo(), walls = newGeo();
        var xs = [];
        var x = RP.xs;
        while (x < RP.xEnd) {
            xs.push(x);
            var inFillet = (x > RP.x0 - RP.e - 2 && x < RP.x0 + RP.e + 2) || (x > RP.x0 + RP.lenRamp - RP.e - 2 && x < RP.x0 + RP.lenRamp + RP.e + 2);
            x += inFillet ? 2 : 10;
        }
        xs.push(RP.xEnd);
        var zs = [-RP.hw, -RP.hw / 2, 0, RP.hw / 2, RP.hw];
        var prof = { h: 0, d: 0 };
        var rows = [];
        xs.forEach(function (px) {
            World.rampProfile(px, prof);
            var h = prof.h + 0.02, nl = Math.sqrt(prof.d * prof.d + 1);
            var row = [];
            zs.forEach(function (pz) {
                var n = top.pos.length / 3;
                top.pos.push(px, h, pz); top.nrm.push(-prof.d / nl, 1 / nl, 0); top.col.push(RAMP_TOP[0], RAMP_TOP[1], RAMP_TOP[2]);
                row.push(n);
            });
            rows.push(row);
        });
        for (var i = 0; i < rows.length - 1; i++) {
            for (var k = 0; k < zs.length - 1; k++) {
                var a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k], d = rows[i + 1][k + 1];
                top.idx.push(a, b, c, b, d, c);
            }
        }
        // бічні стіни (від верху профілю до землі), різкий край у кінці
        [-1, 1].forEach(function (sg) {
            var base = walls.pos.length / 3;
            xs.forEach(function (px) {
                World.rampProfile(px, prof);
                walls.pos.push(px, prof.h + 0.02, sg * RP.hw); walls.nrm.push(0, 0, sg); walls.col.push(RAMP_WALL[0], RAMP_WALL[1], RAMP_WALL[2]);
                walls.pos.push(px, -2.5, sg * RP.hw); walls.nrm.push(0, 0, sg); walls.col.push(RAMP_WALL_LO[0], RAMP_WALL_LO[1], RAMP_WALL_LO[2]);
            });
            for (var q = 0; q < xs.length - 1; q++) {
                var i0 = base + q * 2;
                if (sg > 0) walls.idx.push(i0, i0 + 1, i0 + 2, i0 + 2, i0 + 1, i0 + 3);
                else walls.idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3);
            }
        });
        var e0 = walls.pos.length / 3;
        [[-RP.hw, RP.h + 0.02], [RP.hw, RP.h + 0.02], [-RP.hw, -2.5], [RP.hw, -2.5]].forEach(function (p, idx) {
            walls.pos.push(RP.xEnd, p[1], p[0]); walls.nrm.push(1, 0, 0);
            var cc = idx < 2 ? RAMP_WALL : RAMP_WALL_LO;
            walls.col.push(cc[0], cc[1], cc[2]);
        });
        walls.idx.push(e0, e0 + 2, e0 + 1, e0 + 1, e0 + 2, e0 + 3);
        return { top: top, walls: walls };
    }

    // =================================================================
    // Рельєф шматками (потокове завантаження). Світ розбито на квадрати 160×160; кожен будують із потрібною
    // деталізацією: чим далі від камери — тим крупніша сітка (4 / 8 / 16 / 32 студи). Біля країв — «спідниці» проти щілин між рівнями.
    // =================================================================
    var TERRAIN = { chunk: 160, cells: [4, 8, 16, 32] };
    function terrainChunk(World, ci, cj, lod) {
        var CH = TERRAIN.chunk, cell = TERRAIN.cells[lod], n = CH / cell, N = n + 3;
        var x0 = ci * CH, z0 = cj * CH;
        var hs = new Float32Array(N * N), i, j;
        for (i = 0; i < N; i++) for (j = 0; j < N; j++) hs[i * N + j] = World.groundHeight(x0 + (j - 1) * cell, z0 + (i - 1) * cell);
        var g = newGeo(), col = [0, 0, 0];
        var minY = 1e9, maxY = -1e9, ao = Math.min(1, 9 / cell);
        for (i = 0; i <= n; i++) {
            for (j = 0; j <= n; j++) {
                var hi = i + 1, hj = j + 1;
                var h = hs[hi * N + hj];
                var nx = (hs[hi * N + hj - 1] - hs[hi * N + hj + 1]) / (2 * cell);
                var nz = (hs[(hi - 1) * N + hj] - hs[(hi + 1) * N + hj]) / (2 * cell);
                var nl = Math.sqrt(nx * nx + 1 + nz * nz);
                var mean = (hs[hi * N + hj - 1] + hs[hi * N + hj + 1] + hs[(hi - 1) * N + hj] + hs[(hi + 1) * N + hj]) / 4;
                var x = x0 + j * cell, z = z0 + i * cell;
                World.colorFast(x, z, h, 1 / nl, h - (h - mean) * ao, col);
                g.pos.push(x, h, z); g.nrm.push(nx / nl, 1 / nl, nz / nl); g.col.push(col[0], col[1], col[2]);
                if (h < minY) minY = h;
                if (h > maxY) maxY = h;
            }
        }
        var w = n + 1;
        for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
            var i0 = i * w + j, i1 = i0 + 1, i2 = i0 + w, i3 = i2 + 1;
            g.idx.push(i0, i2, i1, i1, i2, i3);
        }
        // спідниці по чотирьох краях: дубль крайніх вершин, опущений вниз
        var drop = Math.max(6, cell * 1.3);
        var edges = [];
        for (j = 0; j <= n; j++) edges.push([j]);              // z = z0
        function skirt(list) {
            var base = g.pos.length / 3;
            for (var q = 0; q < list.length; q++) {
                var v = list[q];
                g.pos.push(g.pos[v * 3], g.pos[v * 3 + 1] - drop, g.pos[v * 3 + 2]);
                g.nrm.push(g.nrm[v * 3], g.nrm[v * 3 + 1], g.nrm[v * 3 + 2]);
                g.col.push(g.col[v * 3], g.col[v * 3 + 1], g.col[v * 3 + 2]);
            }
            for (var s = 0; s < list.length - 1; s++) {
                g.idx.push(list[s], base + s, list[s + 1], list[s + 1], base + s, base + s + 1);
                g.idx.push(list[s], list[s + 1], base + s, list[s + 1], base + s + 1, base + s);     // з обох боків: зовні не видно, але без дірок
            }
        }
        var e1 = [], e2 = [], e3 = [], e4 = [];
        for (j = 0; j <= n; j++) { e1.push(j); e2.push(n * w + j); }
        for (i = 0; i <= n; i++) { e3.push(i * w); e4.push(i * w + n); }
        skirt(e1); skirt(e2); skirt(e3); skirt(e4);
        return {
            geo: g, ci: ci, cj: cj, lod: lod,
            cx: x0 + CH / 2, cz: z0 + CH / 2, cy: (minY + maxY) / 2,
            radius: Math.sqrt(2) * CH / 2 + (maxY - minY) / 2 + drop
        };
    }

    // На карті немає дерев і каміння: buildProps повертає порожню геометрію (інтерфейс лишився)
    function buildProps(World) { return newGeo(); }

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
                g.pos.push(q[0], World.groundHeight(q[0], q[1]) + lift, q[1]);
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

    // Розмітка лише на дорозі від майданчика до гірки: пунктир по осі й білі краї
    function buildDecals(World) {
        var g = newGeo();
        var C = World.CFG;
        var yellow = [0.96, 0.8, 0.16], white = [0.93, 0.93, 0.94];
        var x1 = World.RAMP.xs + 4;
        for (var x = C.platformR + 8; x < x1 - 6; x += 10) drapedStrip(g, line(x, 0, x + 5, 0, 1), 0.55, yellow, 0.07, World);
        drapedStrip(g, line(C.platformR + 2, C.roadHalf - 0.7, x1, C.roadHalf - 0.7, 1), 0.45, white, 0.07, World);
        drapedStrip(g, line(C.platformR + 2, -(C.roadHalf - 0.7), x1, -(C.roadHalf - 0.7), 1), 0.45, white, 0.07, World);
        return g;
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
        buildCharacter: buildCharacter, buildCar: buildCar, partGeometry: partGeometry, buildRamp: buildRamp, terrainChunk: terrainChunk,
        buildProps: buildProps, buildDecals: buildDecals, appendGeo: appendGeo,
        sedanSpec: sedanSpec, vanSpec: vanSpec, truckSpec: truckSpec, assembleCar: assembleCar, wheelGeo: wheelGeo,
        checkGeo: checkGeo, CAR_TYPES: CAR_TYPES, CAR_DEFS: CAR_DEFS, CHAR: CHAR, TERRAIN: TERRAIN, PART_NAMES: ['fbump', 'rbump', 'hood', 'trunk', 'doorL', 'doorR', 'mirL', 'mirR', 'extra']
    };
});
