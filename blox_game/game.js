// =====================================================================
// KishkaBlox — гра "Realistic cars": 3D-світ на чистому WebGL (без сторонніх бібліотек).
// Завантажується у WebView застосунку Kishka з файлу, який КишкаBlox установив на телефон.
//
// Зв'язок із застосунком (Android) іде через об'єкт window.Android (JavascriptInterface):
//   Android.ready()                       сторінка готова -> застосунок заходить у гру на сервері
//   Android.started()                     перший кадр світу намальовано -> сірий екран завантаження зникає
//   Android.state(x, y, z, ry, a)         мій стан для інших гравців (a: 0 стоїть, 1 іде, 2 у повітрі)
//   Android.fail()                        WebGL недоступний
// Застосунок викликає в сторінці:
//   KishkaGame.start({id, nick, x, y, z, players:[{id, nick, x, y, z, ry, a}]})
//   KishkaGame.resync({...})              те саме після повторного підключення
//   KishkaGame.roster({players:[{id, nick}]})   хто зараз у грі
//   KishkaGame.tick([[id, x, y, z, ry, a], ...]) стани інших гравців (10 разів на секунду)
//
// Керування, як у Roblox: джойстик зліва, кнопка стрибка справа, перетягування пальцем по екрану — камера,
// щипок двома пальцями — наближення/віддалення.
// =====================================================================
(function () {
    'use strict';

    // ---------------------------------------------------------------- налаштування
    var WALK_SPEED = 16;        // студів на секунду (як у Roblox)
    var JUMP_VELOCITY = 50;     // початкова швидкість стрибка
    var GRAVITY = 196.2;        // гравітація Roblox
    var HALF_W = 0.9;           // половина ширини персонажа
    var HEIGHT = 5.0;           // висота персонажа (R6: ноги 2 + торс 2 + голова 1)
    var WORLD_LIMIT = 250;      // межа світу
    var SEND_EVERY_MS = 90;     // як часто надсилати свій стан
    var SHOW_NAMETAGS = true;   // нікнейми над гравцями (як у Roblox)
    var CAM_MIN = 0.5;
    var CAM_MAX = 100;
    var FIRST_PERSON_DIST = 1.5;
    var GRAY = [0.64, 0.65, 0.67];
    var FACE = [0.1, 0.1, 0.12];

    var Native = window.Android || {
        // Запуск у звичайному браузері (для перевірки): локальна гра без мережі
        ready: function () {
            setTimeout(function () {
                window.KishkaGame.start({ id: 1, nick: 'Player', x: 0, y: 4, z: 30, players: [] });
            }, 50);
        },
        started: function () {},
        state: function () {},
        fail: function () {}
    };

    function $(id) { return document.getElementById(id); }

    // ---------------------------------------------------------------- матриці (column-major, як у WebGL)
    var tmp16 = new Float32Array(16);
    var M = {
        ident: function (o) {
            for (var i = 0; i < 16; i++) o[i] = 0;
            o[0] = o[5] = o[10] = o[15] = 1;
            return o;
        },
        copy: function (o, a) {
            for (var i = 0; i < 16; i++) o[i] = a[i];
            return o;
        },
        mul: function (o, a, b) {
            for (var c = 0; c < 4; c++) {
                for (var r = 0; r < 4; r++) {
                    var s = 0;
                    for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
                    tmp16[c * 4 + r] = s;
                }
            }
            for (var i = 0; i < 16; i++) o[i] = tmp16[i];
            return o;
        },
        translate: function (m, x, y, z) {
            m[12] += m[0] * x + m[4] * y + m[8] * z;
            m[13] += m[1] * x + m[5] * y + m[9] * z;
            m[14] += m[2] * x + m[6] * y + m[10] * z;
            m[15] += m[3] * x + m[7] * y + m[11] * z;
        },
        rotateX: function (m, a) {
            var c = Math.cos(a), s = Math.sin(a);
            for (var i = 0; i < 4; i++) {
                var y = m[4 + i], z = m[8 + i];
                m[4 + i] = y * c + z * s;
                m[8 + i] = z * c - y * s;
            }
        },
        rotateY: function (m, a) {
            var c = Math.cos(a), s = Math.sin(a);
            for (var i = 0; i < 4; i++) {
                var x = m[i], z = m[8 + i];
                m[i] = x * c - z * s;
                m[8 + i] = x * s + z * c;
            }
        },
        rotateZ: function (m, a) {
            var c = Math.cos(a), s = Math.sin(a);
            for (var i = 0; i < 4; i++) {
                var x = m[i], y = m[4 + i];
                m[i] = x * c + y * s;
                m[4 + i] = y * c - x * s;
            }
        },
        perspective: function (o, fovy, aspect, near, far) {
            var f = 1 / Math.tan(fovy / 2);
            for (var i = 0; i < 16; i++) o[i] = 0;
            o[0] = f / aspect;
            o[5] = f;
            o[10] = (far + near) / (near - far);
            o[11] = -1;
            o[14] = (2 * far * near) / (near - far);
            return o;
        },
        lookAt: function (o, ex, ey, ez, cx, cy, cz) {
            var zx = ex - cx, zy = ey - cy, zz = ez - cz;
            var zl = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1;
            zx /= zl; zy /= zl; zz /= zl;
            // x = cross(up(0,1,0), z)
            var xx = zz, xy = 0, xz = -zx;
            var xl = Math.sqrt(xx * xx + xz * xz) || 1;
            xx /= xl; xz /= xl;
            // y = cross(z, x)
            var yx = zy * xz - zz * xy;
            var yy = zz * xx - zx * xz;
            var yz = zx * xy - zy * xx;
            o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
            o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
            o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
            o[12] = -(xx * ex + xy * ey + xz * ez);
            o[13] = -(yx * ex + yy * ey + yz * ez);
            o[14] = -(zx * ex + zy * ey + zz * ez);
            o[15] = 1;
            return o;
        }
    };

    function angDiff(from, to) {
        var d = (to - from) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        return d;
    }
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    // ---------------------------------------------------------------- світ: коробки й зіткнення
    var scene = [];       // що малювати: {x,y,z,sx,sy,sz,c:[r,g,b], grid}
    var colliders = [];   // з чим стикаємось: {x0,x1,y0,y1,z0,z1}

    function addBox(x, y, z, sx, sy, sz, color, collide, grid) {
        scene.push({ x: x, y: y, z: z, sx: sx, sy: sy, sz: sz, c: color, grid: !!grid });
        if (collide) {
            colliders.push({
                x0: x - sx / 2, x1: x + sx / 2,
                y0: y - sy / 2, y1: y + sy / 2,
                z0: z - sz / 2, z1: z + sz / 2
            });
        }
    }

    function rot90(lx, lz, r) {
        switch (r & 3) {
            case 1: return [lz, -lx];
            case 2: return [-lx, -lz];
            case 3: return [-lz, lx];
            default: return [lx, lz];
        }
    }

    // Машина з коробок: довжина вздовж X (перед — +X). r = 0..3 (повороти по 90 градусів)
    function addCar(cx, cz, r, color) {
        var glass = [0.12, 0.17, 0.24];
        var dark = [0.07, 0.07, 0.08];
        var parts = [
            [0, 1.35, 0, 9.0, 1.5, 4.0, color],
            [-0.6, 2.75, 0, 4.6, 1.3, 3.5, color],
            [-0.6, 2.9, 0, 4.7, 0.85, 3.56, glass],
            [-0.6, 3.5, 0, 4.7, 0.2, 3.6, color],
            [4.55, 0.85, 0, 0.2, 0.55, 3.7, dark],
            [-4.55, 0.85, 0, 0.2, 0.55, 3.7, dark],
            [4.52, 1.55, 1.3, 0.1, 0.45, 0.9, [1.0, 0.96, 0.72]],
            [4.52, 1.55, -1.3, 0.1, 0.45, 0.9, [1.0, 0.96, 0.72]],
            [-4.52, 1.55, 1.3, 0.1, 0.45, 0.9, [0.85, 0.1, 0.1]],
            [-4.52, 1.55, -1.3, 0.1, 0.45, 0.9, [0.85, 0.1, 0.1]],
            [2.9, 0.8, 1.9, 1.7, 1.6, 0.8, dark],
            [2.9, 0.8, -1.9, 1.7, 1.6, 0.8, dark],
            [-2.9, 0.8, 1.9, 1.7, 1.6, 0.8, dark],
            [-2.9, 0.8, -1.9, 1.7, 1.6, 0.8, dark]
        ];
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i];
            var pos = rot90(p[0], p[2], r);
            var odd = (r & 1) === 1;
            addBox(cx + pos[0], p[1], cz + pos[1], odd ? p[5] : p[3], p[4], odd ? p[3] : p[5], p[6], false);
        }
        // Одна коробка зіткнення на всю машину: на неї можна й вистрибнути
        var odd2 = (r & 1) === 1;
        var hx = (odd2 ? 4.0 : 9.0) / 2;
        var hz = (odd2 ? 9.0 : 4.0) / 2;
        colliders.push({ x0: cx - hx, x1: cx + hx, y0: 0, y1: 3.6, z0: cz - hz, z1: cz + hz });
    }

    function buildWorld() {
        var asphalt = [0.17, 0.17, 0.19];
        var lot = [0.24, 0.24, 0.26];
        var white = [0.92, 0.92, 0.92];
        var yellow = [0.95, 0.78, 0.15];

        // Земля: велика плита з клітинками (сітка малюється шейдером)
        addBox(0, -0.5, 0, 560, 1, 560, [0.56, 0.58, 0.6], false, true);

        // Дороги: одна вздовж X, одна вздовж Z
        addBox(0, 0.05, 0, 520, 0.1, 28, asphalt, false);
        addBox(0, 0.05, 0, 28, 0.1, 520, asphalt, false);
        var i;
        for (i = -240; i <= 240; i += 20) {
            if (Math.abs(i) < 18) continue;
            addBox(i, 0.11, 0, 8, 0.02, 0.5, yellow, false);
            addBox(0, 0.11, i, 0.5, 0.02, 8, yellow, false);
        }
        // Пішохідний перехід
        for (i = -10; i <= 10; i += 2.5) {
            addBox(i, 0.11, 17, 1.2, 0.02, 4, white, false);
            addBox(i, 0.11, -17, 1.2, 0.02, 4, white, false);
        }

        // Парковка A (праворуч-ближче) і парковка B (ліворуч-далі)
        addBox(75, 0.06, 40, 112, 0.1, 42, lot, false);
        addBox(-75, 0.06, -40, 112, 0.1, 42, lot, false);
        var colors = [
            [0.78, 0.12, 0.12], [0.13, 0.25, 0.7], [0.92, 0.92, 0.94], [0.1, 0.1, 0.12],
            [0.62, 0.64, 0.68], [0.9, 0.7, 0.1], [0.12, 0.5, 0.25], [0.9, 0.42, 0.1]
        ];
        var n = 0;
        for (i = 0; i < 15; i++) {
            var xa = 25 + i * 7;
            addBox(xa - 3.5, 0.12, 40, 0.3, 0.02, 11, white, false);
            if (i % 5 !== 3) addCar(xa, 40, 1, colors[n++ % colors.length]);
            var xb = -125 + i * 7;
            addBox(xb - 3.5, 0.12, -40, 0.3, 0.02, 11, white, false);
            if (i % 4 !== 2) addCar(xb, -40, 3, colors[n++ % colors.length]);
        }
        addBox(25 + 15 * 7 - 3.5, 0.12, 40, 0.3, 0.02, 11, white, false);
        addBox(-125 + 15 * 7 - 3.5, 0.12, -40, 0.3, 0.02, 11, white, false);

        // Машини на дорозі
        addCar(-70, -7, 0, colors[0]);
        addCar(48, 7, 2, colors[3]);
        addCar(-130, 7, 2, colors[1]);
        addCar(110, -7, 0, colors[5]);
        addCar(7, 90, 1, colors[2]);
        addCar(-7, -100, 3, colors[6]);

        // Ліхтарі
        var lamps = [[22, 22], [128, 22], [22, 58], [128, 58], [-22, -22], [-128, -22], [-22, -58], [-128, -58]];
        for (i = 0; i < lamps.length; i++) {
            addBox(lamps[i][0], 6, lamps[i][1], 0.5, 12, 0.5, [0.25, 0.26, 0.3], true);
            addBox(lamps[i][0], 12.3, lamps[i][1], 2.2, 0.5, 1.2, [1.0, 0.95, 0.75], false);
        }

        // Будинки по краях (щоб було на що дивитись)
        var bl = [
            [-90, 40, -170, 48, 30, [0.62, 0.64, 0.7]], [-30, 55, -190, 36, 34, [0.75, 0.72, 0.66]],
            [60, 36, -175, 44, 32, [0.58, 0.62, 0.66]], [150, 60, -165, 40, 40, [0.7, 0.66, 0.62]],
            [-170, 46, 120, 40, 40, [0.64, 0.66, 0.72]], [-80, 34, 160, 50, 36, [0.72, 0.7, 0.64]],
            [40, 52, 170, 36, 36, [0.6, 0.64, 0.68]], [150, 40, 150, 46, 34, [0.68, 0.66, 0.7]]
        ];
        for (i = 0; i < bl.length; i++) {
            var b = bl[i];
            addBox(b[0], b[1] / 2, b[2], b[3], b[1], b[4], b[5], true);
        }
    }

    function groundHeightAt(x, z, y) {
        var h = 0;
        for (var i = 0; i < colliders.length; i++) {
            var b = colliders[i];
            if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && b.y1 <= y + 0.6 && b.y1 > h) h = b.y1;
        }
        return h;
    }

    // ---------------------------------------------------------------- WebGL
    var canvas = $('c');
    var tagsCanvas = $('tags');
    var tagsCtx = null;
    var gl = null;
    var prog = null, loc = {};
    var cubeMesh = null, discMesh = null;
    var W = 1, H = 1, DPR = 1;

    var VS =
        'attribute vec3 aPos;\n' +
        'attribute vec3 aNrm;\n' +
        'uniform mat4 uVP;\n' +
        'uniform mat4 uM;\n' +
        'uniform mat3 uN;\n' +
        'varying vec3 vN;\n' +
        'varying vec3 vW;\n' +
        'void main() {\n' +
        '  vec4 w = uM * vec4(aPos, 1.0);\n' +
        '  vW = w.xyz;\n' +
        '  vN = uN * aNrm;\n' +
        '  gl_Position = uVP * w;\n' +
        '}\n';

    var FS =
        '#ifdef GL_FRAGMENT_PRECISION_HIGH\n' +
        'precision highp float;\n' +
        '#else\n' +
        'precision mediump float;\n' +
        '#endif\n' +
        'varying vec3 vN;\n' +
        'varying vec3 vW;\n' +
        'uniform vec3 uColor;\n' +
        'uniform vec3 uLight;\n' +
        'uniform vec3 uCam;\n' +
        'uniform vec3 uFog;\n' +
        'uniform float uAlpha;\n' +
        'uniform float uGrid;\n' +
        'void main() {\n' +
        '  vec3 n = normalize(vN);\n' +
        '  float d = max(dot(n, normalize(uLight)), 0.0);\n' +
        '  float hemi = 0.5 + 0.5 * n.y;\n' +
        '  vec3 c = uColor;\n' +
        '  if (uGrid > 0.5) {\n' +
        '    vec2 g = vW.xz / 8.0;\n' +
        '    float k = mod(floor(g.x) + floor(g.y), 2.0);\n' +
        '    c = c * (1.0 - 0.1 * k);\n' +
        '    vec2 f = abs(fract(g) - 0.5);\n' +
        '    float line = step(0.488, max(f.x, f.y));\n' +
        '    c = c * (1.0 - 0.22 * line);\n' +
        '  }\n' +
        '  vec3 amb = mix(vec3(0.34, 0.33, 0.32), vec3(0.62, 0.70, 0.84), hemi) * 0.78;\n' +
        '  vec3 sun = vec3(1.0, 0.95, 0.86) * (0.62 * d);\n' +
        '  vec3 lit = min(c * (amb + sun), vec3(1.0));\n' +
        '  float dist = length(vW - uCam);\n' +
        '  float fg = clamp((dist - 160.0) / 360.0, 0.0, 1.0);\n' +
        '  gl_FragColor = vec4(mix(lit, uFog, fg), uAlpha);\n' +
        '}\n';

    function compile(type, src) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            throw new Error('shader: ' + gl.getShaderInfoLog(s));
        }
        return s;
    }

    function makeMesh(vertices, indices) {
        var vb = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vb);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        var ib = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
        return { vb: vb, ib: ib, count: indices.length };
    }

    function buildCube() {
        var v = [], idx = [];
        var faces = [
            // нормаль, чотири кути
            [[0, 0, 1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
            [[0, 0, -1], [1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
            [[1, 0, 0], [1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]],
            [[-1, 0, 0], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
            [[0, 1, 0], [-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]],
            [[0, -1, 0], [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]
        ];
        for (var f = 0; f < faces.length; f++) {
            var face = faces[f], n = face[0], base = f * 4;
            for (var k = 1; k <= 4; k++) {
                var p = face[k];
                v.push(p[0] * 0.5, p[1] * 0.5, p[2] * 0.5, n[0], n[1], n[2]);
            }
            idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
        return makeMesh(v, idx);
    }

    function buildDisc() {
        var v = [0, 0, 0, 0, 1, 0], idx = [], seg = 20;
        for (var i = 0; i < seg; i++) {
            var a = (i / seg) * Math.PI * 2;
            v.push(Math.cos(a), 0, Math.sin(a), 0, 1, 0);
        }
        for (var j = 0; j < seg; j++) {
            idx.push(0, 1 + j, 1 + ((j + 1) % seg));
        }
        return makeMesh(v, idx);
    }

    function initGL() {
        gl = canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' }) ||
            canvas.getContext('experimental-webgl');
        if (!gl) throw new Error('no webgl');
        var vs = compile(gl.VERTEX_SHADER, VS);
        var fs = compile(gl.FRAGMENT_SHADER, FS);
        prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.bindAttribLocation(prog, 0, 'aPos');
        gl.bindAttribLocation(prog, 1, 'aNrm');
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            throw new Error('link: ' + gl.getProgramInfoLog(prog));
        }
        var names = ['uVP', 'uM', 'uN', 'uColor', 'uLight', 'uCam', 'uFog', 'uAlpha', 'uGrid'];
        for (var i = 0; i < names.length; i++) loc[names[i]] = gl.getUniformLocation(prog, names[i]);
        cubeMesh = buildCube();
        discMesh = buildDisc();
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.clearColor(0.56, 0.76, 0.96, 1);
    }

    function bindMesh(mesh) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vb);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ib);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    }

    var normalM = new Float32Array(9);
    var modelM = new Float32Array(16);

    // Малює коробку sx*sy*sz у системі координат m (m — лише поворот і зсув)
    function drawBox(m, sx, sy, sz, color, alpha, grid) {
        M.copy(modelM, m);
        modelM[0] *= sx; modelM[1] *= sx; modelM[2] *= sx;
        modelM[4] *= sy; modelM[5] *= sy; modelM[6] *= sy;
        modelM[8] *= sz; modelM[9] *= sz; modelM[10] *= sz;
        normalM[0] = m[0]; normalM[1] = m[1]; normalM[2] = m[2];
        normalM[3] = m[4]; normalM[4] = m[5]; normalM[5] = m[6];
        normalM[6] = m[8]; normalM[7] = m[9]; normalM[8] = m[10];
        gl.uniformMatrix4fv(loc.uM, false, modelM);
        gl.uniformMatrix3fv(loc.uN, false, normalM);
        gl.uniform3f(loc.uColor, color[0], color[1], color[2]);
        gl.uniform1f(loc.uAlpha, alpha === undefined ? 1 : alpha);
        gl.uniform1f(loc.uGrid, grid ? 1 : 0);
        gl.drawElements(gl.TRIANGLES, cubeMesh.count, gl.UNSIGNED_SHORT, 0);
    }

    var identM = M.ident(new Float32Array(16));
    var discBase = new Float32Array(16);

    function drawShadow(x, y, z, r, alpha) {
        M.ident(discBase);
        M.translate(discBase, x, y, z);
        M.copy(modelM, discBase);
        modelM[0] = r; modelM[10] = r;
        normalM[0] = 1; normalM[1] = 0; normalM[2] = 0;
        normalM[3] = 0; normalM[4] = 1; normalM[5] = 0;
        normalM[6] = 0; normalM[7] = 0; normalM[8] = 1;
        gl.uniformMatrix4fv(loc.uM, false, modelM);
        gl.uniformMatrix3fv(loc.uN, false, normalM);
        gl.uniform3f(loc.uColor, 0, 0, 0);
        gl.uniform1f(loc.uAlpha, alpha);
        gl.uniform1f(loc.uGrid, 0);
        gl.drawElements(gl.TRIANGLES, discMesh.count, gl.UNSIGNED_SHORT, 0);
    }

    // ---------------------------------------------------------------- персонаж R6 (весь сірий) з анімаціями
    var stk = new Float32Array(16);
    var stack = [];
    for (var si = 0; si < 8; si++) stack.push(new Float32Array(16));
    var sp = 0;
    function push() { M.copy(stack[sp++], stk); }
    function pop() { M.copy(stk, stack[--sp]); }

    function makeChar(id, nick) {
        return {
            id: id, nick: nick || '',
            x: 0, y: 0, z: 0, ry: 0,
            tx: 0, ty: 0, tz: 0, try_: 0,
            a: 0, phase: 0, speed: 0,
            armL: 0, armR: 0, legL: 0, legR: 0, armLz: 0, armRz: 0,
            hasPos: false
        };
    }

    // Рахує кути кінцівок: ходьба, стрибок/падіння, спокій
    function animate(c, dt, mode, speed) {
        var tArmL = 0, tArmR = 0, tLegL = 0, tLegR = 0, tArmLz = 0, tArmRz = 0;
        if (mode === 2) {
            // У повітрі: руки вгору й трохи в сторони, ноги злегка розведені
            tArmL = -2.7; tArmR = -2.7; tArmLz = -0.25; tArmRz = 0.25;
            tLegL = 0.3; tLegR = -0.3;
        } else if (mode === 1) {
            c.phase += dt * (6 + 3.5 * clamp(speed / WALK_SPEED, 0, 1.2));
            var s = Math.sin(c.phase);
            var amp = 0.95 * clamp(speed / WALK_SPEED, 0.35, 1.1);
            tLegL = s * amp; tLegR = -s * amp;
            tArmL = -s * amp * 0.9; tArmR = s * amp * 0.9;
        } else {
            c.phase += dt * 1.6;
            var sw = Math.sin(c.phase) * 0.05;
            tArmL = sw; tArmR = -sw;
        }
        var k = Math.min(1, dt * 18);
        c.armL += (tArmL - c.armL) * k;
        c.armR += (tArmR - c.armR) * k;
        c.legL += (tLegL - c.legL) * k;
        c.legR += (tLegR - c.legR) * k;
        c.armLz += (tArmLz - c.armLz) * k;
        c.armRz += (tArmRz - c.armRz) * k;
    }

    function drawChar(c) {
        M.ident(stk);
        M.translate(stk, c.x, c.y, c.z);
        M.rotateY(stk, c.ry);
        // торс
        push(); M.translate(stk, 0, 3, 0); drawBox(stk, 2, 2, 1, GRAY); pop();
        // голова
        push(); M.translate(stk, 0, 4.5, 0); drawBox(stk, 1.25, 1.0, 1.25, GRAY); pop();
        // обличчя на передній стороні голови (перед персонажа дивиться в бік +Z): очі й усмішка
        push(); M.translate(stk, -0.3, 4.6, 0.64); drawBox(stk, 0.18, 0.22, 0.04, FACE); pop();
        push(); M.translate(stk, 0.3, 4.6, 0.64); drawBox(stk, 0.18, 0.22, 0.04, FACE); pop();
        push(); M.translate(stk, 0, 4.22, 0.64); drawBox(stk, 0.5, 0.1, 0.04, FACE); pop();
        // руки (шарнір на плечі)
        push();
        M.translate(stk, -1.5, 4, 0); M.rotateZ(stk, c.armLz); M.rotateX(stk, c.armL);
        M.translate(stk, 0, -1, 0); drawBox(stk, 1, 2, 1, GRAY);
        pop();
        push();
        M.translate(stk, 1.5, 4, 0); M.rotateZ(stk, c.armRz); M.rotateX(stk, c.armR);
        M.translate(stk, 0, -1, 0); drawBox(stk, 1, 2, 1, GRAY);
        pop();
        // ноги (шарнір на стегні)
        push();
        M.translate(stk, -0.5, 2, 0); M.rotateX(stk, c.legL);
        M.translate(stk, 0, -1, 0); drawBox(stk, 1, 2, 1, GRAY);
        pop();
        push();
        M.translate(stk, 0.5, 2, 0); M.rotateX(stk, c.legR);
        M.translate(stk, 0, -1, 0); drawBox(stk, 1, 2, 1, GRAY);
        pop();
    }

    // ---------------------------------------------------------------- стан гри
    var me = null;               // мій персонаж (з фізикою)
    var myId = -1;
    var myNick = '';
    var remotes = {};            // id -> персонаж іншого гравця
    var started = false;
    var firstFrameDone = false;
    var vy = 0, onGround = false;
    var camYaw = 0, camPitch = 0.35, camDist = 12.5;
    var VP = new Float32Array(16);
    var V = new Float32Array(16);
    var P = new Float32Array(16);
    var camX = 0, camY = 0, camZ = 0;
    var sendTimer = 0, lastSent = null, sinceHeartbeat = 0;

    var input = { sx: 0, sy: 0, jump: false, keys: {} };

    function addRemote(id, nick) {
        if (id === myId || remotes[id]) {
            if (remotes[id] && nick) remotes[id].nick = nick;
            return;
        }
        remotes[id] = makeChar(id, nick);
    }

    function applyRoster(list) {
        var seen = {};
        for (var i = 0; i < list.length; i++) {
            var p = list[i];
            if (p.id === myId) continue;
            seen[p.id] = true;
            addRemote(p.id, p.nick);
        }
        for (var id in remotes) {
            if (!seen[id]) delete remotes[id];
        }
    }

    function setRemoteState(r, x, y, z, ry, a, snap) {
        r.tx = x; r.ty = y; r.tz = z; r.try_ = ry; r.a = a;
        if (!r.hasPos || snap) {
            r.x = x; r.y = y; r.z = z; r.ry = ry;
            r.hasPos = true;
        }
    }

    function begin(data, isResync) {
        myId = data.id;
        myNick = data.nick || '';
        if (!me || !isResync) {
            me = makeChar(myId, myNick);
            me.x = +data.x || 0;
            me.y = +data.y || 4;
            me.z = +data.z || 0;
            vy = 0;
            onGround = false;
            camYaw = 0;
        }
        remotes = {};
        var players = data.players || [];
        for (var i = 0; i < players.length; i++) {
            var p = players[i];
            if (p.id === myId) continue;
            addRemote(p.id, p.nick);
            setRemoteState(remotes[p.id], +p.x || 0, +p.y || 0, +p.z || 0, +p.ry || 0, p.a | 0, true);
        }
        started = true;
    }

    // ---------------------------------------------------------------- фізика
    function overlaps(x, y, z, b) {
        return x + HALF_W > b.x0 && x - HALF_W < b.x1 &&
            z + HALF_W > b.z0 && z - HALF_W < b.z1 &&
            y + HEIGHT > b.y0 && y < b.y1;
    }

    function stepPlayer(dt) {
        // Куди йти: джойстик (або клавіатура) відносно напрямку камери
        var sx = input.sx, sy = input.sy;
        var k = input.keys;
        if (sx === 0 && sy === 0) {
            sx = (k.ArrowRight || k.KeyD ? 1 : 0) - (k.ArrowLeft || k.KeyA ? 1 : 0);
            sy = (k.ArrowUp || k.KeyW ? 1 : 0) - (k.ArrowDown || k.KeyS ? 1 : 0);
        }
        var mag = Math.sqrt(sx * sx + sy * sy);
        if (mag > 1) { sx /= mag; sy /= mag; mag = 1; }
        var fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);   // вперед відносно камери
        var rx = Math.cos(camYaw), rz = -Math.sin(camYaw);    // вправо відносно камери
        var mx = fx * sy + rx * sx;
        var mz = fz * sy + rz * sx;
        var speed = mag > 0.12 ? WALK_SPEED : 0;
        var dx = 0, dz = 0;
        if (speed > 0) {
            var ml = Math.sqrt(mx * mx + mz * mz) || 1;
            dx = (mx / ml) * speed * dt;
            dz = (mz / ml) * speed * dt;
            var want = Math.atan2(mx, mz);
            me.ry += angDiff(me.ry, want) * Math.min(1, dt * 14);
        }

        // X
        me.x = clamp(me.x + dx, -WORLD_LIMIT, WORLD_LIMIT);
        var i, b;
        for (i = 0; dx !== 0 && i < colliders.length; i++) {
            b = colliders[i];
            if (!overlaps(me.x, me.y, me.z, b)) continue;
            if (b.y1 - me.y <= 1.0 && b.y1 - me.y > 0 && vy <= 0) { me.y = b.y1; continue; }
            me.x = dx > 0 ? b.x0 - HALF_W : b.x1 + HALF_W;
        }
        // Z
        me.z = clamp(me.z + dz, -WORLD_LIMIT, WORLD_LIMIT);
        for (i = 0; dz !== 0 && i < colliders.length; i++) {
            b = colliders[i];
            if (!overlaps(me.x, me.y, me.z, b)) continue;
            if (b.y1 - me.y <= 1.0 && b.y1 - me.y > 0 && vy <= 0) { me.y = b.y1; continue; }
            me.z = dz > 0 ? b.z0 - HALF_W : b.z1 + HALF_W;
        }

        // Стрибок (поки кнопка тримається — стрибає знову, як у Roblox)
        var wantJump = input.jump || k.Space;
        if (wantJump && onGround) {
            vy = JUMP_VELOCITY;
            onGround = false;
        }

        // Y
        vy -= GRAVITY * dt;
        var ny = me.y + vy * dt;
        onGround = false;
        if (ny <= 0) {
            ny = 0; vy = 0; onGround = true;
        }
        me.y = ny;
        for (i = 0; i < colliders.length; i++) {
            b = colliders[i];
            if (!overlaps(me.x, me.y, me.z, b)) continue;
            if (vy <= 0) {
                me.y = b.y1; vy = 0; onGround = true;
            } else {
                me.y = b.y0 - HEIGHT; vy = 0;
            }
        }
        // Стоїмо на машині/будинку
        if (!onGround && vy <= 0) {
            for (i = 0; i < colliders.length; i++) {
                b = colliders[i];
                if (me.x + HALF_W > b.x0 && me.x - HALF_W < b.x1 && me.z + HALF_W > b.z0 && me.z - HALF_W < b.z1 &&
                    Math.abs(me.y - b.y1) < 0.02) { onGround = true; vy = 0; }
            }
        }
        if (me.y < -80) { me.y = 6; me.x = 0; me.z = 0; vy = 0; }

        var horiz = speed > 0 ? WALK_SPEED : 0;
        me.speed = horiz;
        var mode = !onGround ? 2 : (horiz > 0.5 ? 1 : 0);
        me.a = mode;
        animate(me, dt, mode, horiz);
    }

    function updateRemotes(dt) {
        for (var id in remotes) {
            var r = remotes[id];
            if (!r.hasPos) continue;
            var ox = r.x, oz = r.z;
            var k = Math.min(1, dt * 12);
            r.x += (r.tx - r.x) * k;
            r.y += (r.ty - r.y) * k;
            r.z += (r.tz - r.z) * k;
            r.ry += angDiff(r.ry, r.try_) * k;
            var sp = Math.sqrt((r.x - ox) * (r.x - ox) + (r.z - oz) * (r.z - oz)) / Math.max(dt, 0.001);
            r.speed += (sp - r.speed) * Math.min(1, dt * 8);
            var mode = r.a === 2 ? 2 : (r.speed > 1.5 || r.a === 1 ? 1 : 0);
            animate(r, dt, mode, r.speed > 1.5 ? r.speed : WALK_SPEED);
        }
    }

    function sendState(dt) {
        sendTimer += dt * 1000;
        sinceHeartbeat += dt * 1000;
        if (sendTimer < SEND_EVERY_MS) return;
        sendTimer = 0;
        var cur = [Math.round(me.x * 100) / 100, Math.round(me.y * 100) / 100, Math.round(me.z * 100) / 100,
            Math.round(me.ry * 100) / 100, me.a];
        var changed = !lastSent;
        if (lastSent) {
            for (var i = 0; i < 5; i++) if (cur[i] !== lastSent[i]) { changed = true; break; }
        }
        if (changed || sinceHeartbeat > 1000) {
            sinceHeartbeat = 0;
            lastSent = cur;
            try { Native.state(cur[0], cur[1], cur[2], cur[3], cur[4]); } catch (e) { /* застосунок закрив гру */ }
        }
    }

    // ---------------------------------------------------------------- камера
    function updateCamera() {
        var fy = me.y + 3.2;
        var cp = Math.cos(camPitch);
        var ex = me.x + Math.sin(camYaw) * cp * camDist;
        var ey = fy + Math.sin(camPitch) * camDist;
        var ez = me.z + Math.cos(camYaw) * cp * camDist;
        if (ey < 0.8) ey = 0.8;
        camX = ex; camY = ey; camZ = ez;
        M.lookAt(V, ex, ey, ez, me.x, fy, me.z);
        M.perspective(P, 70 * Math.PI / 180, W / H, 0.4, 900);
        M.mul(VP, P, V);
    }

    // ---------------------------------------------------------------- малювання
    function render() {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(prog);
        gl.uniformMatrix4fv(loc.uVP, false, VP);
        gl.uniform3f(loc.uLight, 0.45, 0.85, 0.3);
        gl.uniform3f(loc.uCam, camX, camY, camZ);
        gl.uniform3f(loc.uFog, 0.56, 0.76, 0.96);
        bindMesh(cubeMesh);
        gl.disable(gl.BLEND);
        gl.depthMask(true);

        var i, s;
        for (i = 0; i < scene.length; i++) {
            s = scene[i];
            M.ident(stk);
            M.translate(stk, s.x, s.y, s.z);
            drawBox(stk, s.sx, s.sy, s.sz, s.c, 1, s.grid);
        }

        var hideMe = camDist < FIRST_PERSON_DIST;
        if (!hideMe) drawChar(me);
        for (var id in remotes) {
            if (remotes[id].hasPos) drawChar(remotes[id]);
        }

        // М'які тіні під персонажами
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        bindMesh(discMesh);
        var chars = [];
        if (!hideMe) chars.push(me);
        for (var rid in remotes) if (remotes[rid].hasPos) chars.push(remotes[rid]);
        for (i = 0; i < chars.length; i++) {
            var c = chars[i];
            var gy = groundHeightAt(c.x, c.z, c.y);
            var h = Math.max(0, c.y - gy);
            drawShadow(c.x, gy + 0.08, c.z, 1.5, clamp(0.32 - h * 0.012, 0.08, 0.32));
        }
        gl.depthMask(true);
        gl.disable(gl.BLEND);
    }

    function drawTags() {
        if (!tagsCtx) return;
        tagsCtx.clearRect(0, 0, tagsCanvas.width, tagsCanvas.height);
        if (!SHOW_NAMETAGS) return;
        tagsCtx.font = 'bold ' + Math.round(13 * DPR) + 'px sans-serif';
        tagsCtx.textAlign = 'center';
        tagsCtx.textBaseline = 'bottom';
        tagsCtx.lineWidth = 3 * DPR;
        tagsCtx.strokeStyle = 'rgba(0,0,0,0.65)';
        tagsCtx.fillStyle = '#ffffff';
        var list = [];
        if (camDist >= FIRST_PERSON_DIST && me) list.push(me);
        for (var id in remotes) if (remotes[id].hasPos) list.push(remotes[id]);
        for (var i = 0; i < list.length; i++) {
            var c = list[i];
            if (!c.nick) continue;
            var dx = c.x - camX, dy = c.y + 6 - camY, dz = c.z - camZ;
            if (Math.sqrt(dx * dx + dy * dy + dz * dz) > 150) continue;
            var x = c.x, y = c.y + 5.8, z = c.z;
            var cw = VP[3] * x + VP[7] * y + VP[11] * z + VP[15];
            if (cw <= 0.01) continue;
            var cx = (VP[0] * x + VP[4] * y + VP[8] * z + VP[12]) / cw;
            var cy = (VP[1] * x + VP[5] * y + VP[9] * z + VP[13]) / cw;
            if (cx < -1.1 || cx > 1.1 || cy < -1.1 || cy > 1.1) continue;
            var px = (cx * 0.5 + 0.5) * tagsCanvas.width;
            var py = (1 - (cy * 0.5 + 0.5)) * tagsCanvas.height;
            tagsCtx.strokeText(c.nick, px, py);
            tagsCtx.fillText(c.nick, px, py);
        }
    }

    // ---------------------------------------------------------------- розмір екрана
    function resize() {
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        var cssW = window.innerWidth || 1, cssH = window.innerHeight || 1;
        W = Math.max(1, Math.round(cssW * DPR));
        H = Math.max(1, Math.round(cssH * DPR));
        canvas.width = W; canvas.height = H;
        tagsCanvas.width = W; tagsCanvas.height = H;
    }

    // ---------------------------------------------------------------- керування
    var stickEl = $('stick'), knobEl = $('knob'), jumpEl = $('jump');
    var STICK_R = 52;
    var stickPtr = null, stickCx = 0, stickCy = 0;

    function updateStick(e) {
        var dx = e.clientX - stickCx, dy = e.clientY - stickCy;
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len > STICK_R) { dx = dx / len * STICK_R; dy = dy / len * STICK_R; }
        knobEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        input.sx = dx / STICK_R;
        input.sy = -dy / STICK_R;
    }
    function endStick(e) {
        if (stickPtr === null || e.pointerId !== stickPtr) return;
        stickPtr = null;
        input.sx = 0; input.sy = 0;
        knobEl.style.transform = 'translate(0px,0px)';
    }
    stickEl.addEventListener('pointerdown', function (e) {
        if (stickPtr !== null) return;
        stickPtr = e.pointerId;
        try { stickEl.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
        var r = stickEl.getBoundingClientRect();
        stickCx = r.left + r.width / 2;
        stickCy = r.top + r.height / 2;
        updateStick(e);
        e.preventDefault();
    });
    stickEl.addEventListener('pointermove', function (e) { if (e.pointerId === stickPtr) updateStick(e); });
    stickEl.addEventListener('pointerup', endStick);
    stickEl.addEventListener('pointercancel', endStick);
    stickEl.addEventListener('lostpointercapture', endStick);

    var jumpPtr = null;
    jumpEl.addEventListener('pointerdown', function (e) {
        jumpPtr = e.pointerId;
        input.jump = true;
        jumpEl.className = 'down';
        try { jumpEl.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
        e.preventDefault();
    });
    function endJump(e) {
        if (e.pointerId !== jumpPtr) return;
        jumpPtr = null;
        input.jump = false;
        jumpEl.className = '';
    }
    jumpEl.addEventListener('pointerup', endJump);
    jumpEl.addEventListener('pointercancel', endJump);
    jumpEl.addEventListener('lostpointercapture', endJump);

    // Камера: один палець — повертає, два пальці — наближення/віддалення
    var camPtrs = {};
    var camCount = 0;
    var pinchLast = 0;

    function pinchDistance() {
        var ids = Object.keys(camPtrs);
        if (ids.length < 2) return 0;
        var a = camPtrs[ids[0]], b = camPtrs[ids[1]];
        var dx = a.x - b.x, dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    canvas.addEventListener('pointerdown', function (e) {
        camPtrs[e.pointerId] = { x: e.clientX, y: e.clientY };
        camCount = Object.keys(camPtrs).length;
        if (camCount === 2) pinchLast = pinchDistance();
        try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
        e.preventDefault();
    });
    canvas.addEventListener('pointermove', function (e) {
        var p = camPtrs[e.pointerId];
        if (!p) return;
        var dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        if (camCount >= 2) {
            var d = pinchDistance();
            if (pinchLast > 0 && d > 0) camDist = clamp(camDist * (pinchLast / d), CAM_MIN, CAM_MAX);
            pinchLast = d;
        } else {
            camYaw += dx * 0.0055;
            camPitch = clamp(camPitch - dy * 0.0045, -0.25, 1.4);
        }
    });
    function endCam(e) {
        if (!camPtrs[e.pointerId]) return;
        delete camPtrs[e.pointerId];
        camCount = Object.keys(camPtrs).length;
        pinchLast = camCount === 2 ? pinchDistance() : 0;
    }
    canvas.addEventListener('pointerup', endCam);
    canvas.addEventListener('pointercancel', endCam);
    canvas.addEventListener('lostpointercapture', endCam);
    canvas.addEventListener('wheel', function (e) {
        camDist = clamp(camDist * (1 + e.deltaY * 0.001), CAM_MIN, CAM_MAX);
        e.preventDefault();
    }, { passive: false });

    window.addEventListener('keydown', function (e) { input.keys[e.code] = true; });
    window.addEventListener('keyup', function (e) { input.keys[e.code] = false; });
    window.addEventListener('blur', function () { input.keys = {}; });
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', function () { setTimeout(resize, 150); });

    // ---------------------------------------------------------------- головний цикл
    var lastT = 0;
    function frame(now) {
        window.requestAnimationFrame(frame);
        if (!started || !gl) { lastT = now; return; }
        var dt = (now - lastT) / 1000;
        lastT = now;
        if (!(dt > 0)) return;
        dt = Math.min(dt, 0.1);
        // Фізика кроками до 1/60 с: персонаж не пролітає крізь стіни
        var steps = Math.max(1, Math.ceil(dt / (1 / 60)));
        var h = dt / steps;
        for (var i = 0; i < steps; i++) stepPlayer(h);
        updateRemotes(dt);
        sendState(dt);
        updateCamera();
        render();
        drawTags();
        if (!firstFrameDone) {
            firstFrameDone = true;
            try { Native.started(); } catch (e) { /* ignore */ }
        }
    }

    // ---------------------------------------------------------------- зв'язок із застосунком
    window.KishkaGame = {
        start: function (data) {
            begin(data, false);
        },
        resync: function (data) {
            begin(data, true);
        },
        roster: function (data) {
            if (data && data.players) applyRoster(data.players);
        },
        tick: function (arr) {
            if (!arr) return;
            for (var i = 0; i < arr.length; i++) {
                var t = arr[i];
                var id = t[0];
                if (id === myId) continue;
                if (!remotes[id]) addRemote(id, '');
                setRemoteState(remotes[id], +t[1], +t[2], +t[3], +t[4], t[5] | 0, false);
            }
        }
    };

    function boot() {
        try {
            resize();
            tagsCtx = tagsCanvas.getContext('2d');
            initGL();
            buildWorld();
        } catch (e) {
            try { Native.fail(); } catch (x) { /* ignore */ }
            return;
        }
        canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); started = false; }, false);
        canvas.addEventListener('webglcontextrestored', function () {
            try { initGL(); started = true; } catch (e) { try { Native.fail(); } catch (x) { /* ignore */ } }
        }, false);
        window.requestAnimationFrame(frame);
        Native.ready();
    }

    boot();
})();
