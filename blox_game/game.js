// =====================================================================
// KishkaBlox — гра «Realistic cars»: 3D-світ на чистому WebGL (без сторонніх бібліотек).
// Завантажується у WebView застосунку Kishka з файлів, які KishkaBlox установив на телефон.
// Складається з файлів: world.js (рельєф), physics.js (персонаж і машини), camera.js (камера), i18n.js (переклади),
// models.js (моделі), game.js (цей файл: малювання, керування, зв'язок із сервером), game.html.
//
// Зв'язок із застосунком (Android) іде через window.Android (JavascriptInterface):
//   Android.ready()                    сторінка готова -> застосунок заходить у гру на сервері
//   Android.started()                  перший кадр світу намальовано -> сірий екран завантаження зникає
//   Android.sendState(json)            мій стан для інших: {x,y,z,ry,a,d,c?}; c — стан моєї машини {t,x,y,z,ry,s,st}
//   Android.carSpawn(type,x,y,z,ry)    створити мою машину (сервер відповість через KishkaGame.carResult)
//   Android.carRemove()                прибрати мою машину
//   Android.failReason(text)           webgl | script — причина, чому гру не запущено
//   Android.log(text)                  діагностика в Logcat
//   Android.state(x,y,z,ry,a)          (старий виклик, лишився для сумісності зі старим застосунком)
// Застосунок викликає в сторінці:
//   KishkaGame.config({lang, invertCamera})            мова написів, інверсія камери
//   KishkaGame.start(data) / resync(data)              відповідь сервера на вхід: {id,nick,x,y,z,ry,players:[],cars:[]}
//   KishkaGame.roster({players:[{id,nick}]})           хто зараз у грі
//   KishkaGame.tick([[id,x,y,z,ry,a,d],...])           стани гравців (10 разів на секунду)
//   KishkaGame.cars({cars:[{id,cid,type,x,y,z,ry}]})   повний список машин у кімнаті
//   KishkaGame.carTick([[id,cid,x,y,z,ry,speed,steer,kmh,qx,qy,qz,qw,dm],...])  рух машин (kmh — для спідометра, q — повний поворот у просторі, dm — маска відламаних деталей)
//   KishkaGame.carResult({ok,cid,code})                результат створення моєї машини
//
//   KishkaGame.respawn({x,y,z,ry})                    повернути мого персонажа на майданчик (меню Respawn)
//
// Керування, як у Roblox: джойстик зліва, кнопка стрибка справа, палець по екрану — камера (палець угору = камера вгору),
// два пальці — наближення/віддалення. У машині: газ і назад праворуч знизу, повороти ліворуч знизу.
// =====================================================================
(function () {
    'use strict';

    var World = window.KishkaWorld, Phys = window.KishkaPhysics, Cam = window.KishkaCamera;
    var Models = window.KishkaModels, I18 = window.KishkaI18n;
    var Nuke = window.KishkaNuke, Structures = window.KishkaStructures, Features = window.KishkaFeatures;
    var Feat = null;                      // нові можливості (features.js): чат, двері, HP, ядерна подія

    // ---------------------------------------------------------------- зв'язок із застосунком
    function nativeFn(name) {
        var a = window.Android;
        return a && a[name] !== undefined ? function () { return a[name].apply(a, arguments); } : null;
    }
    var standalone = !window.Android;       // відкрито в звичайному браузері (для перевірки): локальна гра без мережі
    var N = {
        ready: nativeFn('ready'), started: nativeFn('started'), fail: nativeFn('fail'), failReason: nativeFn('failReason'),
        log: nativeFn('log'), sendState: nativeFn('sendState'), oldState: nativeFn('state'),
        carSpawn: nativeFn('carSpawn'), carRemove: nativeFn('carRemove'), rpc: nativeFn('rpc')
    };
    function call(fn) {
        if (!fn) return;
        try { fn.apply(null, Array.prototype.slice.call(arguments, 1)); } catch (e) { /* застосунок закрив гру */ }
    }
    function nlog(text) {
        call(N.log, String(text).slice(0, 300));
        if (standalone && window.console) console.log('[game] ' + text);
    }
    function nfail(reason, text) {
        nlog('FAIL ' + reason + ': ' + text);
        if (N.failReason) call(N.failReason, reason + ': ' + String(text).slice(0, 200));
        else call(N.fail);
    }

    // ---------------------------------------------------------------- налаштування
    var SEND_EVERY_MS = 90;     // як часто надсилати свій стан (~11 разів на секунду)
    var INTERP_DELAY = 0.12;    // показуємо інших гравців із затримкою 120 мс: між пакетами рух плавний
    var CHAR_SEAT_SCALE = 0.8;  // у машині персонаж трохи менший, щоб голова не пробивала дах
    var CAR_NEAR = 12;          // з якої відстані можна сісти у свою машину
    var SPAWN_COOLDOWN_MS = 1500;
    var SHOW_NAMETAGS = true;
    var CAR_TYPES = Phys.CAR_TYPES;

    function $(id) { return document.getElementById(id); }
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function angDiff(a, b) { return Phys.angDiff(a, b); }
    function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

    // ---------------------------------------------------------------- якість графіки
    // Потужний телефон — більше деталей і різкість; слабкий — менше. Далі якість сама підлаштовується під FPS.
    function detectTier() {
        var cores = navigator.hardwareConcurrency || 4;
        var mem = navigator.deviceMemory || 3;
        var score = cores + mem * 1.5;
        if (score >= 15) return 2;
        if (score >= 9) return 1;
        return 0;
    }
    var TIER = detectTier();
    // lod — відстані (студи), на яких рельєф перемикається на грубіші сітки (4 / 8 / 16 / 32 студи); карта в 15 разів більша,
    // тож рельєф будується шматками «на льоту» (див. createTerrainStream).
    var TIER_CFG = [
        { cell: 8, dpr: 1.0, aa: false, far: 1100, fogFar: 900, lod: [230, 520, 860], keep: 220 },
        { cell: 6, dpr: 1.5, aa: true, far: 1400, fogFar: 1150, lod: [300, 640, 1040], keep: 300 },
        { cell: 4, dpr: 2.0, aa: true, far: 1700, fogFar: 1400, lod: [360, 760, 1240], keep: 400 }
    ][TIER];

    // ---------------------------------------------------------------- матриці (column-major, як у WebGL)
    var tmp16 = new Float32Array(16);
    var M = {
        ident: function (o) { for (var i = 0; i < 16; i++) o[i] = 0; o[0] = o[5] = o[10] = o[15] = 1; return o; },
        copy: function (o, a) { for (var i = 0; i < 16; i++) o[i] = a[i]; return o; },
        mul: function (o, a, b) {
            for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
                var s = 0;
                for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
                tmp16[c * 4 + r] = s;
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
        scale: function (m, sx, sy, sz) {
            for (var i = 0; i < 4; i++) { m[i] *= sx; m[4 + i] *= sy; m[8 + i] *= sz; }
        },
        rotateX: function (m, a) {
            var c = Math.cos(a), s = Math.sin(a);
            for (var i = 0; i < 4; i++) { var y = m[4 + i], z = m[8 + i]; m[4 + i] = y * c + z * s; m[8 + i] = z * c - y * s; }
        },
        rotateY: function (m, a) {
            var c = Math.cos(a), s = Math.sin(a);
            for (var i = 0; i < 4; i++) { var x = m[i], z = m[8 + i]; m[i] = x * c - z * s; m[8 + i] = x * s + z * c; }
        },
        rotateZ: function (m, a) {
            var c = Math.cos(a), s = Math.sin(a);
            for (var i = 0; i < 4; i++) { var x = m[i], y = m[4 + i]; m[i] = x * c + y * s; m[4 + i] = y * c - x * s; }
        },
        perspective: function (o, fovy, aspect, near, far) {
            var f = 1 / Math.tan(fovy / 2);
            for (var i = 0; i < 16; i++) o[i] = 0;
            o[0] = f / aspect; o[5] = f; o[10] = (far + near) / (near - far); o[11] = -1; o[14] = (2 * far * near) / (near - far);
            return o;
        },
        lookAt: function (o, ex, ey, ez, cx, cy, cz) {
            var zx = ex - cx, zy = ey - cy, zz = ez - cz;
            var zl = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1;
            zx /= zl; zy /= zl; zz /= zl;
            var xx = zz, xy = 0, xz = -zx;
            var xl = Math.sqrt(xx * xx + xz * xz) || 1;
            xx /= xl; xz /= xl;
            var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
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

    // ---------------------------------------------------------------- WebGL-малювальник (є два: головний і для попереднього перегляду машин)
    // Вершинний шейдер. uCrOn = 1 вмикає зминання кузова: uCr = (передок, задок, лівий борт, правий борт), uCr2 = (дах, піввдовжини,
    // піввширини, висота). Формула — копія Phys.crushPoint (physics.js): якщо міняєте там, міняйте й тут. Константи беруться з Phys.CRUSH.
    var CRK = Phys.CRUSH;
    function gf(v) { return v.toFixed(4); }
    var VS =
        'attribute vec3 aPos;\nattribute vec3 aNrm;\nattribute vec3 aCol;\n' +
        'uniform mat4 uVP;\nuniform mat4 uM;\nuniform mat3 uN;\nuniform vec4 uCr;\nuniform vec4 uCr2;\nuniform float uCrOn;\n' +
        'varying vec3 vN;\nvarying vec3 vW;\nvarying vec3 vC;\n' +
        'void main() {\n' +
        '  vec3 p = aPos; vec3 nr = aNrm; vec3 cl = aCol;\n' +
        '  if (uCrOn > 0.5) {\n' +
        '    float hl = uCr2.y, hw = uCr2.z, H = uCr2.w;\n' +
        '    float f = uCr.x, r = uCr.y, l = uCr.z, rt = uCr.w, rf = uCr2.x;\n' +
        '    float A = p.x * 2.9 + p.z * 1.3, B = p.y * 3.7 - p.z * 2.1, Cc = p.x * 6.3 + p.y * 5.1 + p.z * 3.7;\n' +
        '    float n0 = sin(A) * sin(B) + 0.5 * sin(Cc);\n' +
        '    float zf0 = hl * ' + gf(CRK.zf) + ', xs0 = hw * ' + gf(CRK.xs) + ';\n' +
        '    float wf = f * smoothstep(zf0, hl * 1.05, p.z), wr = r * smoothstep(zf0, hl * 1.05, -p.z);\n' +
        '    float wl = l * smoothstep(xs0, hw * 1.05, p.x), wt = rt * smoothstep(xs0, hw * 1.05, -p.x);\n' +
        '    float wroof = rf * smoothstep(H * 0.45, H, p.y);\n' +
        '    float yb = H * 0.52;\n' +
        '    float x = p.x, y = p.y, z = p.z;\n' +
        '    if (y > yb) y = yb + (y - yb) * (1.0 - ' + gf(CRK.roof) + ' * rf);\n' +
        '    if (z > zf0) z = zf0 + (z - zf0) * (1.0 - ' + gf(CRK.front) + ' * f); else if (z < -zf0) z = -zf0 + (z + zf0) * (1.0 - ' + gf(CRK.front) + ' * r);\n' +
        '    if (x > xs0) x = xs0 + (x - xs0) * (1.0 - ' + gf(CRK.side) + ' * l); else if (x < -xs0) x = -xs0 + (x + xs0) * (1.0 - ' + gf(CRK.side) + ' * rt);\n' +
        '    float wsum = wf + wr + wl + wt + wroof;\n' +
        '    y += wf * 0.3 + wr * 0.14 + wsum * ' + gf(CRK.noise) + ' * n0;\n' +
        '    x = x * (1.0 - 0.12 * (wf + wr)) * (1.0 + 0.06 * wroof) - (wl - wt) * 0.18 * (0.6 + 0.4 * n0);\n' +
        // нормаль: нахил за градієнтом шуму, щоб вм\'ятини ловили світло; колір: подряпаний метал і сажа
        '    vec3 g = vec3(2.9 * cos(A) * sin(B) + 3.15 * cos(Cc), 3.7 * sin(A) * cos(B) + 2.55 * cos(Cc), 1.3 * cos(A) * sin(B) - 2.1 * sin(A) * cos(B) + 1.85 * cos(Cc));\n' +
        '    nr = normalize(nr - (g - dot(g, nr) * nr) * ' + gf(CRK.noise) + ' * wsum * 1.4);\n' +
        '    float dmg = clamp(wsum, 0.0, 1.0);\n' +
        '    cl = mix(cl, vec3(0.36, 0.37, 0.4), dmg * 0.5) * (1.0 - 0.25 * dmg);\n' +
        '    p = vec3(x, y, z);\n' +
        '  }\n' +
        '  vec4 w = uM * vec4(p, 1.0);\n  vW = w.xyz;\n  vN = uN * nr;\n  vC = cl;\n  gl_Position = uVP * w;\n}\n';
    var FS =
        '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
        'varying vec3 vN;\nvarying vec3 vW;\nvarying vec3 vC;\n' +
        'uniform vec3 uTint;\nuniform vec3 uLight;\nuniform vec3 uCam;\nuniform vec3 uFog;\nuniform vec2 uFogR;\n' +
        'uniform float uAlpha;\nuniform float uSpec;\nuniform float uCheck;\nuniform float uTile;\nuniform float uWin;\nuniform float uWinY;\nuniform float uUnlit;\n' +
        'void main() {\n' +
        '  vec3 n = normalize(vN);\n' +
        '  vec3 L = normalize(uLight);\n' +
        '  float d = max(dot(n, L), 0.0);\n' +
        '  float hemi = 0.5 + 0.5 * n.y;\n' +
        '  vec3 c = vC * uTint;\n' +
        '  if (uCheck > 0.5) {\n' +
        '    float k = mod(floor(vW.x / uTile) + floor(vW.z / uTile), 2.0);\n' +
        '    float fd = 1.0 - smoothstep(120.0, 280.0, length(vW - uCam));\n' +
        '    c *= 1.0 + (k - 0.5) * 0.17 * fd;\n' +
        '  }\n' +
        '  if (uWin > 0.5 && abs(n.y) < 0.5 && vW.y > uWinY) {\n' +
        '    float hz = abs(n.x) > abs(n.z) ? vW.z : vW.x;\n' +
        '    vec2 cell = vec2(hz / 7.0, vW.y / 12.0);\n' +
        '    vec2 f = fract(cell);\n' +
        '    float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.78);\n' +
        '    float rnd = fract(sin(dot(floor(cell), vec2(12.9898, 78.233))) * 43758.5453);\n' +
        '    vec3 glass = mix(vec3(0.10, 0.17, 0.27), vec3(0.98, 0.84, 0.45), step(0.8, rnd));\n' +
        '    c = mix(c, glass, win * 0.92);\n' +
        '  }\n' +
        '  vec3 amb = mix(vec3(0.36, 0.34, 0.32), vec3(0.64, 0.72, 0.86), hemi) * 0.8;\n' +
        '  vec3 sun = vec3(1.0, 0.95, 0.86) * (0.72 * d);\n' +
        '  vec3 lit = c * (amb + sun);\n' +
        '  if (uUnlit > 0.5) lit = c;\n' +
        '  vec3 V = normalize(uCam - vW);\n' +
        '  vec3 H = normalize(L + V);\n' +
        '  lit += vec3(1.0, 0.97, 0.9) * pow(max(dot(n, H), 0.0), 48.0) * uSpec;\n' +
        '  float dist = length(vW - uCam);\n' +
        '  float fg = clamp((dist - uFogR.x) / (uFogR.y - uFogR.x), 0.0, 1.0);\n' +
        '  gl_FragColor = vec4(mix(min(lit, vec3(1.0)), uFog, fg), uAlpha);\n' +
        '}\n';
    var SKY_VS = 'attribute vec2 aP;\nvarying vec2 vP;\nvoid main() { vP = aP; gl_Position = vec4(aP, 0.9999, 1.0); }\n';
    var SKY_FS =
        '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
        'varying vec2 vP;\nuniform vec3 uHor;\nuniform vec3 uTop;\nuniform float uHorizon;\n' +
        'void main() {\n  float t = clamp((vP.y - uHorizon) * 0.7, 0.0, 1.0);\n  t = sqrt(t);\n  gl_FragColor = vec4(mix(uHor, uTop, t), 1.0);\n}\n';

    var FOG = [0.72, 0.84, 0.96];
    var SKY_TOP = [0.32, 0.58, 0.92];
    var FOG0 = FOG.slice(), SKY0 = SKY_TOP.slice(), FOG_ASH = [0.4, 0.34, 0.3], SKY_ASH = [0.22, 0.18, 0.17];
    // k = 0 — звичайне небо, k = 1 — небо й туман після ядерного вибуху
    function setBurn(k) { for (var i = 0; i < 3; i++) { FOG[i] = FOG0[i] + (FOG_ASH[i] - FOG0[i]) * k; SKY_TOP[i] = SKY0[i] + (SKY_ASH[i] - SKY0[i]) * k; } }
    var worldTint = null;                 // колір рельєфу й гірки (темніє після вибуху)
    var rendererSeq = 0;

    function createRenderer(canvas, o) {
        o = o || {};
        var gl = canvas.getContext('webgl', {
            antialias: !!o.aa, alpha: !!o.alpha, premultipliedAlpha: false,
            preserveDrawingBuffer: !!o.preserve, powerPreference: 'high-performance'
        }) || canvas.getContext('experimental-webgl');
        if (!gl) throw new Error('no webgl');
        var id = ++rendererSeq;

        function compile(type, src) {
            var s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
            return s;
        }
        function program(vs, fs, attribs) {
            var p = gl.createProgram();
            gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
            gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
            for (var i = 0; i < attribs.length; i++) gl.bindAttribLocation(p, i, attribs[i]);
            gl.linkProgram(p);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
            return p;
        }
        var prog = program(VS, FS, ['aPos', 'aNrm', 'aCol']);
        var loc = {};
        ['uVP', 'uM', 'uN', 'uTint', 'uLight', 'uCam', 'uFog', 'uFogR', 'uAlpha', 'uSpec', 'uCheck', 'uTile', 'uWin', 'uWinY', 'uUnlit', 'uCr', 'uCr2', 'uCrOn'].forEach(function (n) { loc[n] = gl.getUniformLocation(prog, n); });
        var skyProg = program(SKY_VS, SKY_FS, ['aP']);
        var skyLoc = { uHor: gl.getUniformLocation(skyProg, 'uHor'), uTop: gl.getUniformLocation(skyProg, 'uTop'), uHorizon: gl.getUniformLocation(skyProg, 'uHorizon') };
        var skyBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);

        // Геометрія -> буфери (кешується на самій геометрії окремо для кожного малювальника)
        function mesh(geo) {
            if (!geo.__gl) geo.__gl = {};
            if (geo.__gl[id]) return geo.__gl[id];
            var n = geo.pos.length / 3;
            var data = new Float32Array(n * 9);
            for (var i = 0; i < n; i++) {
                data[i * 9] = geo.pos[i * 3]; data[i * 9 + 1] = geo.pos[i * 3 + 1]; data[i * 9 + 2] = geo.pos[i * 3 + 2];
                data[i * 9 + 3] = geo.nrm[i * 3]; data[i * 9 + 4] = geo.nrm[i * 3 + 1]; data[i * 9 + 5] = geo.nrm[i * 3 + 2];
                data[i * 9 + 6] = geo.col[i * 3]; data[i * 9 + 7] = geo.col[i * 3 + 1]; data[i * 9 + 8] = geo.col[i * 3 + 2];
            }
            var vb = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vb);
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
            var ib = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(geo.idx), gl.STATIC_DRAW);
            var m = { vb: vb, ib: ib, count: geo.idx.length };
            geo.__gl[id] = m;
            return m;
        }

        var nm = new Float32Array(9);
        var cur = null;
        function bind(m) {
            if (cur === m) return;
            cur = m;
            gl.bindBuffer(gl.ARRAY_BUFFER, m.vb);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib);
            gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
            gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12);
            gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
        }

        function begin(vp, camPos, w, h, clear) {
            gl.viewport(0, 0, w, h);
            if (clear) gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
            else gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.useProgram(prog);
            gl.uniformMatrix4fv(loc.uVP, false, vp);
            gl.uniform3f(loc.uLight, 0.45, 0.85, 0.3);
            gl.uniform3f(loc.uCam, camPos[0], camPos[1], camPos[2]);
            gl.uniform3f(loc.uFog, FOG[0], FOG[1], FOG[2]);
            gl.uniform2f(loc.uFogR, o.fogNear || 160, o.fogFar || 420);
            cur = null;
            gl.uniform1f(loc.uCheck, 0);
            gl.uniform1f(loc.uWin, 0);
            gl.uniform1f(loc.uWinY, 0);
            gl.uniform1f(loc.uUnlit, 0);
            gl.uniform1f(loc.uTile, World.CFG.tile || 8);
            gl.disable(gl.BLEND);
            gl.depthMask(true);
        }

        // Шахова плитка: вмикається лише для рельєфу (трава й гірка — один матеріал)
        function checker(on, tile) {
            gl.uniform1f(loc.uCheck, on ? 1 : 0);
            if (on) gl.uniform1f(loc.uTile, tile || World.CFG.tile || 8);
        }
        // Вікна будинків малює шейдер на вертикальних гранях вище висоти y0
        function windows(on, y0) { gl.uniform1f(loc.uWin, on ? 1 : 0); gl.uniform1f(loc.uWinY, y0 || 0); }
        // Без освітлення (вогонь, спалах)
        function unlit(on) { gl.uniform1f(loc.uUnlit, on ? 1 : 0); }
        // Туман: (n, f) — свій діапазон; (0, 0) — повернути стандартний
        function fogRange(n, f) { if (!n && !f) gl.uniform2f(loc.uFogR, o.fogNear || 160, o.fogFar || 420); else gl.uniform2f(loc.uFogR, n, f); }
        // Звільняє GPU-буфери геометрії (для шматків рельєфу, які вже далеко)
        function release(geo) {
            var m = geo.__gl && geo.__gl[id];
            if (!m) return;
            gl.deleteBuffer(m.vb); gl.deleteBuffer(m.ib);
            delete geo.__gl[id];
        }

        function sky(horizonNdc) {
            gl.useProgram(skyProg);
            gl.disable(gl.DEPTH_TEST);
            gl.depthMask(false);
            gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
            gl.disableVertexAttribArray(1);
            gl.disableVertexAttribArray(2);
            gl.uniform3f(skyLoc.uHor, FOG[0], FOG[1], FOG[2]);
            gl.uniform3f(skyLoc.uTop, SKY_TOP[0], SKY_TOP[1], SKY_TOP[2]);
            gl.uniform1f(skyLoc.uHorizon, horizonNdc);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.enable(gl.DEPTH_TEST);
            gl.depthMask(true);
            gl.useProgram(prog);
            cur = null;
        }

        // Малює сітку з матрицею m. tint — множник кольору, alpha — прозорість, spec — блиск
        function draw(m, mat, tint, alpha, spec) {
            bind(m);
            nm[0] = mat[0]; nm[1] = mat[1]; nm[2] = mat[2];
            nm[3] = mat[4]; nm[4] = mat[5]; nm[5] = mat[6];
            nm[6] = mat[8]; nm[7] = mat[9]; nm[8] = mat[10];
            gl.uniformMatrix4fv(loc.uM, false, mat);
            gl.uniformMatrix3fv(loc.uN, false, nm);
            if (tint) gl.uniform3f(loc.uTint, tint[0], tint[1], tint[2]); else gl.uniform3f(loc.uTint, 1, 1, 1);
            gl.uniform1f(loc.uAlpha, alpha === undefined ? 1 : alpha);
            gl.uniform1f(loc.uSpec, spec || 0);
            gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
        }

        function blend(on) {
            if (on) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
            else { gl.disable(gl.BLEND); gl.depthMask(true); }
        }
        function offset(on) {
            if (on) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1.5, -1.5); }
            else gl.disable(gl.POLYGON_OFFSET_FILL);
        }

        // Зминання кузова для наступних draw(): cr — [передок, задок, лівий, правий, дах], def — розміри машини з Phys.CARS
        function crush(cr, def) {
            gl.uniform4f(loc.uCr, cr[0], cr[1], cr[2], cr[3]);
            gl.uniform4f(loc.uCr2, cr[4], def.len * 0.5, def.wid * 0.5, def.height);
            gl.uniform1f(loc.uCrOn, 1);
        }
        function crushOff() { gl.uniform1f(loc.uCrOn, 0); }

        return { gl: gl, id: id, mesh: mesh, begin: begin, sky: sky, draw: draw, blend: blend, offset: offset, checker: checker, windows: windows, unlit: unlit, fogRange: fogRange, release: release, crush: crush, crushOff: crushOff };
    }

    // ---------------------------------------------------------------- стан гри
    var canvas = $('c');
    var tagsCanvas = $('tags');
    var tagsCtx = null;
    var R = null;                         // головний малювальник
    var tstream = null, propsGeo = null, decalsGeo = null, discGeo = null, rampGeo = null;
    var charModel = null;
    var carModels = {};
    var W = 1, H = 1, DPR = 1, renderScale = 1;

    var started = false, firstFrameDone = false;
    var myId = -1, myNick = '';
    var walker = null;
    var driving = false;
    var myCar = null;                     // { type, cid, x,y,z, ry, pitch, roll, speed, steer, wheel, ... } або null
    var pendingSpawn = false;
    var lastSpawnAt = -1e9;
    var remotes = {};                     // id -> гравець
    var hiddenIds = {};                   // id гравців, яких я заблокував у меню: їх персонажі й ніки не малюються (лише в мене)
    var remoteCars = {};                  // id власника -> машина
    var myPose = null;
    var cam = Cam.create({ yaw: 0, pitch: 0.35, dist: 14 });
    var settings = { invertCamera: false };
    var lastDragAt = -1e9;

    var input = { sx: 0, sy: 0, jump: false, keys: {}, gas: false, rev: false, left: false, right: false, hand: false };
    var shake = 0;                        // тряска камери від сильних ударів

    var VP = new Float32Array(16), V = new Float32Array(16), P = new Float32Array(16);
    var eye = { x: 0, y: 0, z: 0, dist: 0 };
    var camTarget = { x: 0, y: 0, z: 0 };

    // ---------------------------------------------------------------- пози персонажа
    function newPose() { return { ph: 0, hL: 0, kL: 0, hR: 0, kR: 0, sL: 0, eL: 0, sR: 0, eR: 0, az: 0, bob: 0, lean: 0 }; }
    var T = { hL: 0, kL: 0, hR: 0, kR: 0, sL: 0, eL: 0, sR: 0, eR: 0, az: 0, bob: 0, lean: 0 };

    // mode: 0 стоїть, 1 іде, 2 у повітрі, 3 сидить у машині. Кути: додатній обертає кінцівку назад, від'ємний — уперед.
    function updatePose(p, mode, speed, dt, steer) {
        T.hL = T.kL = T.hR = T.kR = T.sL = T.eL = T.sR = T.eR = T.az = T.bob = T.lean = 0;
        if (mode === 3) {
            T.hL = T.hR = -1.5; T.kL = T.kR = 1.45;
            T.sL = T.sR = -1.15 - 0.1 * Math.abs(steer);
            T.eL = T.eR = -0.5;
            T.sL += steer * 0.18; T.sR -= steer * 0.18;
            T.lean = 0.04;
        } else if (mode === 2) {
            T.sL = T.sR = -2.55; T.az = 0.28;
            T.hL = -0.55; T.kL = 0.9; T.hR = 0.35; T.kR = 0.35;
            T.eL = T.eR = -0.2;
        } else if (mode === 1) {
            var f = clamp(speed / 16, 0.4, 1.15);
            p.ph += dt * (6.2 + 4 * f);
            var s = Math.sin(p.ph), c = Math.cos(p.ph), amp = 0.78 * f;
            T.hL = s * amp; T.hR = -s * amp;
            T.kL = 1.15 * amp * Math.max(0, -c); T.kR = 1.15 * amp * Math.max(0, c);
            T.sL = -s * amp * 0.95; T.sR = s * amp * 0.95;
            T.eL = -0.35 - 0.25 * Math.max(0, -T.sL); T.eR = -0.35 - 0.25 * Math.max(0, -T.sR);
            T.bob = Math.abs(s) * 0.11 * f;
            T.lean = 0.1 * f;
        } else {
            p.ph += dt * 1.8;
            var sw = Math.sin(p.ph);
            T.sL = sw * 0.05; T.sR = -sw * 0.05;
            T.eL = T.eR = -0.12;
            T.bob = (sw * 0.5 + 0.5) * 0.03;
        }
        var k = Math.min(1, dt * (mode === 3 ? 10 : 18));
        p.hL += (T.hL - p.hL) * k; p.kL += (T.kL - p.kL) * k;
        p.hR += (T.hR - p.hR) * k; p.kR += (T.kR - p.kR) * k;
        p.sL += (T.sL - p.sL) * k; p.eL += (T.eL - p.eL) * k;
        p.sR += (T.sR - p.sR) * k; p.eR += (T.eR - p.eR) * k;
        p.az += (T.az - p.az) * k; p.bob += (T.bob - p.bob) * k; p.lean += (T.lean - p.lean) * k;
    }

    // ---------------------------------------------------------------- малювання персонажа
    var stk = new Float32Array(16);
    var stackM = [];
    for (var si = 0; si < 10; si++) stackM.push(new Float32Array(16));
    var sp = 0;
    function push() { M.copy(stackM[sp++], stk); }
    function pop() { M.copy(stk, stackM[--sp]); }

    function drawChar(r, base, p, tint) {
        var C = charModel.dims, parts = charModel.meshes;
        M.copy(stk, base);
        push();
        M.translate(stk, 0, p.bob, 0);
        if (p.lean) {
            M.translate(stk, 0, C.hipY, 0); M.rotateX(stk, -p.lean); M.translate(stk, 0, -C.hipY, 0);
        }
        r.draw(parts.torso, stk, tint);
        r.draw(parts.head, stk, tint);
        // руки: плече -> лікоть
        [[1, p.sL, p.eL], [-1, p.sR, p.eR]].forEach(function (a) {
            push();
            M.translate(stk, a[0] * C.shoulderX, C.shoulderY, 0);
            M.rotateZ(stk, a[0] * p.az);
            M.rotateX(stk, a[1]);
            r.draw(parts.upperArm, stk, tint);
            M.translate(stk, 0, -C.upperArm, 0);
            M.rotateX(stk, a[2]);
            r.draw(parts.foreArm, stk, tint);
            pop();
        });
        pop();
        // ноги: стегно -> коліно (тулуб не нахиляємо разом із ногами)
        push();
        M.translate(stk, 0, p.bob, 0);
        [[1, p.hL, p.kL], [-1, p.hR, p.kR]].forEach(function (a) {
            push();
            M.translate(stk, a[0] * C.hipX, C.hipY, 0);
            M.rotateX(stk, a[1]);
            r.draw(parts.thigh, stk, tint);
            M.translate(stk, 0, -C.thigh, 0);
            M.rotateX(stk, a[2]);
            r.draw(parts.shin, stk, tint);
            pop();
        });
        pop();
    }

    // ---------------------------------------------------------------- малювання машини
    var carBase = new Float32Array(16);
    var seatBase = new Float32Array(16);
    var wheelM = new Float32Array(16);

    function carMatrix(out, c) {
        if (c.q) {
            // повний поворот у просторі (кватерніон): машина може злітати, крутитися й перекидатися
            var q = c.q, x = q[0], y = q[1], z = q[2], w = q[3];
            out[0] = 1 - 2 * (y * y + z * z); out[1] = 2 * (x * y + w * z); out[2] = 2 * (x * z - w * y); out[3] = 0;
            out[4] = 2 * (x * y - w * z); out[5] = 1 - 2 * (x * x + z * z); out[6] = 2 * (y * z + w * x); out[7] = 0;
            out[8] = 2 * (x * z + w * y); out[9] = 2 * (y * z - w * x); out[10] = 1 - 2 * (x * x + y * y); out[11] = 0;
            out[12] = c.x; out[13] = c.y; out[14] = c.z; out[15] = 1;
            return out;
        }
        M.ident(out);
        M.translate(out, c.x, c.y + (c.sy || 0), c.z);
        M.rotateY(out, c.ry);
        M.rotateX(out, -(c.pitch || 0));
        M.rotateZ(out, -(c.roll || 0));
        return out;
    }

    // Матриця відламуваної деталі: що більше її «зім'яло» (dent 0..1), то більше вона відхиляється від свого шарніра
    var partM = new Float32Array(16);
    function partMatrix(base, pt, dent) {
        M.copy(partM, base);
        if (dent > 0.03 && pt) {
            M.translate(partM, pt.shift[0] * dent, pt.shift[1] * dent, pt.shift[2] * dent);
            M.translate(partM, pt.hinge[0], pt.hinge[1], pt.hinge[2]);
            var ang = pt.maxAngle * dent;
            if (pt.axis[0]) M.rotateX(partM, ang); else if (pt.axis[1]) M.rotateY(partM, ang); else M.rotateZ(partM, ang);
            M.translate(partM, -pt.hinge[0], -pt.hinge[1], -pt.hinge[2]);
        }
        return partM;
    }
    var darkTint = [1, 1, 1], BURNT_TINT = [0.16, 0.14, 0.13];

    var wOff = [0, 0, 0];
    function drawCarOpaque(r, c, tint) {
        var mdl = carModels[c.type];
        if (!mdl) return;
        carMatrix(carBase, c);
        var dm = c.dm | 0, def = Phys.CARS[c.type];
        // зім'ята машина темнішає (подряпини й бруд)
        var dent = c.dent || 0;
        var tn = tint;
        if (dent > 0.04) { var k = 1 - 0.3 * Math.min(1, dent); darkTint[0] = k; darkTint[1] = k; darkTint[2] = k * 0.98; tn = darkTint; }
        if (c.burnt) tn = BURNT_TINT;                                // згоріла від ядерного вибуху: чорна
        var cr = c.cr, crOn = Phys.crushActive(cr);                 // деформація кузова: шейдер зминає кузов і всі прикріплені деталі однаково
        if (crOn) r.crush(cr, def);
        r.draw(mdl.opaqueMesh, carBase, tn, 1, 0.35);
        var pn, pm, bit, pdent;
        for (pn in mdl.partMeshes) {
            bit = Phys.PART_BITS[pn];
            if (dm & bit) continue;
            pm = mdl.partMeshes[pn];
            pdent = c.pd ? Math.min(1, c.pd[pn] || 0) : 0;
            r.draw(pm.mesh, partMatrix(carBase, pm, pdent), tn, 1, 0.35);
        }
        if (crOn) r.crushOff();
        var local = !!c.wh;
        for (var i = 0; i < mdl.wheelPos.length; i++) {
            if (dm & (1 << (Phys.WHEEL_BIT0 + i))) continue;
            var w = mdl.wheelPos[i];
            M.copy(wheelM, carBase);
            var wy = w.y, steerA, spin;
            if (local) {
                var ws = c.wh[i];
                wy = def.suspTop - ws.s;                         // справжнє положення колеса на підвісці
                steerA = -ws.steerAng; spin = ws.rot;
            } else {
                steerA = -(c.steer || 0) * 0.9; spin = c.wheel || 0;
            }
            if (crOn) { Phys.crushPoint(def, cr, w.x, wy, w.z, wOff); M.translate(wheelM, wOff[0], wOff[1], wOff[2]); }   // колесо їде разом із зім'ятим кузовом
            else M.translate(wheelM, w.x, wy, w.z);
            if (w.steer) M.rotateY(wheelM, steerA);
            M.rotateX(wheelM, spin);
            r.draw(mdl.wheelMesh, wheelM, null, 1, 0.15);
        }
    }

    // Відламані деталі: окремі тіла фізики, що лежать і котяться по землі
    var debM = new Float32Array(16);
    function drawDebris(r) {
        var list = Phys.debris;
        for (var i = 0; i < list.length; i++) {
            var d = list[i], mdl = carModels[d.car];
            if (!mdl) continue;
            var dx = d.p[0] - eye.x, dz = d.p[2] - eye.z;
            if (dx * dx + dz * dz > 640000) continue;
            var mesh, pivot = null;
            if (d.wheel) mesh = mdl.wheelMesh;
            else { var pm = mdl.partMeshes[d.part]; if (!pm) continue; mesh = pm.mesh; pivot = pm.pivot; }
            var q = d.q, x = q[0], y = q[1], z = q[2], w = q[3];
            debM[0] = 1 - 2 * (y * y + z * z); debM[1] = 2 * (x * y + w * z); debM[2] = 2 * (x * z - w * y); debM[3] = 0;
            debM[4] = 2 * (x * y - w * z); debM[5] = 1 - 2 * (x * x + z * z); debM[6] = 2 * (y * z + w * x); debM[7] = 0;
            debM[8] = 2 * (x * z + w * y); debM[9] = 2 * (y * z - w * x); debM[10] = 1 - 2 * (x * x + y * y); debM[11] = 0;
            debM[12] = d.p[0]; debM[13] = d.p[1]; debM[14] = d.p[2]; debM[15] = 1;
            var left = d.life - d.age;
            if (left < 2) { var sc = Math.max(0.01, left / 2); M.scale(debM, sc, sc, sc); }
            if (pivot) M.translate(debM, -pivot[0], -pivot[1], -pivot[2]);
            r.draw(mesh, debM, null, 1, 0.2);
        }
    }
    function drawCarGlass(r, c) {
        var mdl = carModels[c.type];
        if (!mdl) return;
        carMatrix(carBase, c);
        var cr = c.cr, crOn = Phys.crushActive(cr), al = 0.5;
        if (crOn) {
            r.crush(cr, Phys.CARS[c.type]);
            var mxc = Math.max(cr[0], cr[1], cr[2], cr[3], cr[4]);
            al = 0.5 * (1 - 0.8 * clamp(mxc * 1.25 - 0.2, 0, 1));      // сильний удар б'є скло: воно майже зникає
        }
        r.draw(mdl.glassMesh, carBase, null, al, 0.9);
        if (crOn) r.crushOff();
    }
    // Персонаж за кермом: матриця машини -> місце водія
    function drawSeated(r, c, pose, tint) {
        var mdl = carModels[c.type];
        if (!mdl) return;
        carMatrix(seatBase, c);
        M.translate(seatBase, mdl.seat[0], mdl.seat[1], mdl.seat[2]);
        M.scale(seatBase, CHAR_SEAT_SCALE, CHAR_SEAT_SCALE, CHAR_SEAT_SCALE);
        M.translate(seatBase, 0, -charModel.dims.hipY, 0);
        drawChar(r, seatBase, pose, tint);
    }

    // ---------------------------------------------------------------- побудова світу
    var shadowM = new Float32Array(16);
    function buildDisc() {
        var g = Models.newGeo(), seg = 20;
        g.pos.push(0, 0, 0); g.nrm.push(0, 1, 0); g.col.push(1, 1, 1);
        for (var i = 0; i < seg; i++) {
            var a = (i / seg) * Math.PI * 2;
            g.pos.push(Math.cos(a), 0, Math.sin(a)); g.nrm.push(0, 1, 0); g.col.push(1, 1, 1);
        }
        for (var j = 0; j < seg; j++) g.idx.push(0, 1 + j, 1 + ((j + 1) % seg));
        return g;
    }

    // ---------------------------------------------------------------- рельєф шматками
    // Світ у 15 разів більший за площею, тож вся сітка водночас не вміщується в пам'ять. Шматки 160×160 будуються за потреби
    // (не більше одного за кадр) з деталізацією за відстанню до камери й зберігаються в кеші; далекі видаляються.
    function createTerrainStream() {
        var CH = Models.TERRAIN.chunk;
        var cache = {}, count = 0, frameNo = 0, lastKey = '';
        var MAXC = 520;
        function key(ci, cj, lod) { return ci + '_' + cj + '_' + lod; }
        function lodFor(d) {
            var L = TIER_CFG.lod;
            return d < L[0] ? 0 : (d < L[1] ? 1 : (d < L[2] ? 2 : 3));
        }
        function find(ci, cj, lod) {
            var c = cache[key(ci, cj, lod)];
            if (c) { c.used = frameNo; return c; }
            return null;
        }
        function build(ci, cj, lod) {
            var c = Models.terrainChunk(World, ci, cj, lod);
            c.used = frameNo;
            cache[key(ci, cj, lod)] = c;
            count++;
            return c;
        }
        function evict() {
            if (count <= MAXC) return;
            var keys = Object.keys(cache);
            keys.sort(function (a, b) { return cache[a].used - cache[b].used; });
            var drop = count - Math.floor(MAXC * 0.8);
            for (var i = 0; i < drop && i < keys.length; i++) {
                var c = cache[keys[i]];
                if (frameNo - c.used < 60) break;
                if (R) R.release(c.geo);
                delete cache[keys[i]];
                count--;
            }
        }
        return {
            // Малює всі видимі шматки; повертає кількість намальованих
            draw: function (r, ex, ez, fx, fz, maxD) {
                frameNo++;
                var ci0 = Math.floor((ex - maxD) / CH), ci1 = Math.floor((ex + maxD) / CH);
                var cj0 = Math.floor((ez - maxD) / CH), cj1 = Math.floor((ez + maxD) / CH);
                var lim = Math.floor(World.CFG.meshHalf / CH);
                if (ci0 < -lim) ci0 = -lim; if (cj0 < -lim) cj0 = -lim;
                if (ci1 > lim - 1) ci1 = lim - 1; if (cj1 > lim - 1) cj1 = lim - 1;
                var bestMissing = null, bestD = 1e18, drawn = 0, mat = M.ident(stk);
                for (var ci = ci0; ci <= ci1; ci++) {
                    for (var cj = cj0; cj <= cj1; cj++) {
                        var cx = ci * CH + CH / 2, cz = cj * CH + CH / 2;
                        var dx = cx - ex, dz = cz - ez, d = Math.sqrt(dx * dx + dz * dz);
                        var rad = CH * 0.72 + 60;
                        if (d > maxD + rad) continue;
                        if (d > rad && (dx * fx + dz * fz) / d < -0.35 - rad / d) continue;
                        var lod = lodFor(d);
                        var c = find(ci, cj, lod);
                        if (!c) {
                            // нужного рівня ще немає: показуємо будь-який готовий (щоб не було дірок), а потрібний будуємо
                            for (var l2 = 0; l2 < 4 && !c; l2++) c = find(ci, cj, l2);
                            if (d < bestD) { bestD = d; bestMissing = [ci, cj, lod]; }
                            if (!c) continue;
                        }
                        r.draw(r.mesh(c.geo), mat, worldTint, 1, 0);
                        drawn++;
                    }
                }
                if (bestMissing) build(bestMissing[0], bestMissing[1], bestMissing[2]);
                evict();
                return drawn;
            },
            // Заздалегідь будує найближчі шматки (на екрані завантаження)
            preload: function (x, z) {
                var ci0 = Math.floor((x - 420) / CH), ci1 = Math.floor((x + 420) / CH);
                var cj0 = Math.floor((z - 420) / CH), cj1 = Math.floor((z + 420) / CH);
                for (var ci = ci0; ci <= ci1; ci++) for (var cj = cj0; cj <= cj1; cj++) {
                    var d = Math.sqrt(Math.pow(ci * CH + CH / 2 - x, 2) + Math.pow(cj * CH + CH / 2 - z, 2));
                    var lod = lodFor(d);
                    if (!find(ci, cj, lod)) build(ci, cj, lod);
                }
            },
            count: function () { return count; }
        };
    }

    function buildAssets() {
        var ch = Models.buildCharacter();
        charModel = { dims: ch.dims, meshes: {} };
        for (var k in ch.parts) charModel.meshes[k] = R.mesh(ch.parts[k]);
        CAR_TYPES.forEach(function (t) {
            var c = Models.buildCar(t);
            carModels[t] = {
                opaqueMesh: R.mesh(c.opaque), glassMesh: R.mesh(c.glass), wheelMesh: R.mesh(c.wheel),
                wheelPos: c.wheelPos, seat: c.seat, height: c.height, len: c.len, wid: c.wid, partMeshes: {}
            };
            for (var pn in c.parts) {
                var pt = c.parts[pn], dp = Phys.CARS[t].parts[pn];
                carModels[t].partMeshes[pn] = {
                    mesh: R.mesh(pt.geo), hinge: pt.hinge || [0, 0, 0], axis: pt.axis || [1, 0, 0], maxAngle: pt.maxAngle || 0,
                    shift: pt.shift || [0, 0, 0], pivot: dp ? dp.p : [0, 0, 0]
                };
            }
        });
        if (!tstream) {
            tstream = createTerrainStream();
            propsGeo = Models.buildProps(World);
            decalsGeo = Models.buildDecals(World);
            rampGeo = Models.buildRamp(World);
            discGeo = buildDisc();
        }
        R.propsMesh = R.mesh(propsGeo);
        R.decalsMesh = R.mesh(decalsGeo);
        R.discMesh = R.mesh(discGeo);
        R.rampTop = R.mesh(rampGeo.top);
        R.rampWalls = R.mesh(rampGeo.walls);
        if (Feat) Feat.buildMeshes(R);
        tstream.preload(0, 0);              // шматки рельєфу навколо майданчика готові ще до першого кадру
    }

    function drawShadow(r, x, z, rx, rz, ry, alpha) {
        var gy = World.heightAt(x, z) + 0.1;
        M.ident(shadowM);
        M.translate(shadowM, x, gy, z);
        M.rotateY(shadowM, ry);
        M.scale(shadowM, rx, 1, rz);
        r.draw(R.discMesh, shadowM, [0, 0, 0], alpha, 0);
    }

    // ---------------------------------------------------------------- інтерполяція отриманих станів
    function pushSnap(list, s) {
        s.t = nowMs() / 1000;
        list.push(s);
        if (list.length > 14) list.shift();
    }
    // Знімає стан у момент rt (секунди). Між двома пакетами — плавний перехід, після останнього — коротка екстраполяція
    function sampleSnaps(list, rt, out, isCar) {
        var n = list.length;
        if (n === 0) return false;
        var a, b, k;
        if (rt <= list[0].t) { a = b = list[0]; k = 0; }
        else if (rt >= list[n - 1].t) { a = b = list[n - 1]; k = 0; }
        else {
            for (var i = n - 1; i > 0; i--) {
                if (list[i - 1].t <= rt) { a = list[i - 1]; b = list[i]; break; }
            }
            k = (rt - a.t) / Math.max(1e-4, b.t - a.t);
        }
        out.x = a.x + (b.x - a.x) * k;
        out.y = a.y + (b.y - a.y) * k;
        out.z = a.z + (b.z - a.z) * k;
        out.ry = a.ry + angDiff(a.ry, b.ry) * k;
        out.a = b.a; out.d = b.d;
        if (isCar) {
            out.speed = a.speed + (b.speed - a.speed) * k;
            out.steer = a.steer + (b.steer - a.steer) * k;
            out.hasQ = false;
            if (a.q && b.q) {
                var dq = a.q[0] * b.q[0] + a.q[1] * b.q[1] + a.q[2] * b.q[2] + a.q[3] * b.q[3], sg = dq < 0 ? -1 : 1;
                var q0 = a.q[0] + (sg * b.q[0] - a.q[0]) * k, q1 = a.q[1] + (sg * b.q[1] - a.q[1]) * k;
                var q2 = a.q[2] + (sg * b.q[2] - a.q[2]) * k, q3 = a.q[3] + (sg * b.q[3] - a.q[3]) * k;
                var ql = Math.sqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3) || 1;
                out.q[0] = q0 / ql; out.q[1] = q1 / ql; out.q[2] = q2 / ql; out.q[3] = q3 / ql;
                out.hasQ = true;
            }
            if (rt > list[n - 1].t) {
                var ex = Math.min(rt - list[n - 1].t, 0.15);
                out.x += Math.sin(out.ry) * out.speed * ex;
                out.z += Math.cos(out.ry) * out.speed * ex;
            }
        }
        // старі пакети більше не потрібні
        while (list.length > 3 && list[1].t < rt - 0.4) list.shift();
        return true;
    }

    // ---------------------------------------------------------------- гравці й машини зі списків сервера
    function makeRemote(id, nick) {
        return { id: id, nick: nick || '', snaps: [], x: 0, y: 0, z: 0, ry: 0, a: 0, d: 0, speed: 0, has: false, pose: newPose(), px: 0, pz: 0 };
    }
    function addRemote(id, nick) {
        if (id === myId) return null;
        if (remotes[id]) { if (nick) remotes[id].nick = nick; return remotes[id]; }
        remotes[id] = makeRemote(id, nick);
        return remotes[id];
    }
    function applyRoster(list) {
        var seen = {};
        for (var i = 0; i < list.length; i++) {
            var p = list[i];
            if (!p || p.id === myId) continue;
            seen[p.id] = true;
            addRemote(p.id, p.nick);
        }
        for (var id in remotes) if (!seen[id]) delete remotes[id];
    }
    function remoteSnap(r, x, y, z, ry, a, d, first) {
        var s = { x: x, y: y, z: z, ry: ry, a: a, d: d };
        if (first) r.snaps.length = 0;
        pushSnap(r.snaps, s);
        if (first) { s.t -= 1; r.has = true; r.px = x; r.pz = z; }
        r.has = true;
    }

    function newRemoteCar(e) {
        return {
            id: e.id, cid: e.cid, type: e.type, snaps: [], x: e.x, y: e.y, z: e.z, ry: e.ry, pitch: 0, roll: 0, speed: 0, steer: 0, wheel: 0,
            q: [0, 0, 0, 1], vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, dm: (e.dm | 0) & 0x7fff, netDm: e.dm | 0, pd: {}, dent: 0, upY: 1,
            cr: Phys.decodeCrush(e.dm | 0), crT: Phys.decodeCrush(e.dm | 0)          // зминання зон кузова (стрибком із маски, далі плавно)
        };
    }
    function carSnap(rc, x, y, z, ry, speed, steer, first, q) {
        var s = { x: x, y: y, z: z, ry: ry, speed: speed || 0, steer: steer || 0, a: 0, d: 0, q: q || null };
        if (first) rc.snaps.length = 0;
        pushSnap(rc.snaps, s);
        if (first) s.t -= 1;
    }

    function removeMyCarLocal() {
        myCar = null;
        pendingSpawn = false;
        if (driving) setDriving(false, true);
    }

    // Повний список машин від сервера: створює нові, оновлює тип, прибирає зниклі
    function applyCars(list) {
        var seen = {};
        for (var i = 0; i < list.length; i++) {
            var e = list[i];
            if (!e || typeof e.id !== 'number' || CAR_TYPES.indexOf(e.type) < 0) continue;
            if (e.id === myId) {
                seen.me = true;
                if (pendingSpawn || (myCar && myCar.unreg)) continue;    // ще чекаємо відповідь на мій spawn
                if (!myCar || myCar.cid !== e.cid) {
                    // Сервер тримає іншу мою машину (повторне підключення, інший пристрій): беремо її
                    var wasDriving = driving;
                    myCar = Phys.createCar(e.type, +e.x, +e.z, +e.ry);
                    myCar.cid = e.cid;
                    myCar.dm = (e.dm | 0) & 0x7fff;
                    myCar.cr = Phys.decodeCrush(e.dm | 0); Phys.crushHull(myCar, Phys.CARS[e.type]);
                    if (wasDriving) setDriving(false, true);
                }
                continue;
            }
            seen[e.id] = true;
            var rc = remoteCars[e.id];
            if (!rc || rc.cid !== e.cid || rc.type !== e.type) {
                rc = remoteCars[e.id] = newRemoteCar(e);
                carSnap(rc, +e.x, +e.y, +e.z, +e.ry, 0, 0, true, null);
            }
        }
        for (var id in remoteCars) if (!seen[id]) delete remoteCars[id];
        if (myCar && !seen.me && !pendingSpawn && !myCar.unreg) removeMyCarLocal();      // сервер прибрав мою машину (але не ту, яку ще реєструємо через слабкий інтернет)
    }

    function begin(data, isResync) {
        myId = data.id;
        myNick = data.nick || '';
        var s = World.spawnPoint();
        var sx = isFinite(+data.x) ? +data.x : s.x, sz = isFinite(+data.z) ? +data.z : s.z;
        if (!walker || !isResync) {
            walker = Phys.createWalker(sx, sz);
            walker.ry = Math.PI / 2;
            myPose = newPose();
            driving = false;
            myCar = null;
            pendingSpawn = false;
            cam.yaw = walker.ry + Math.PI;
            document.body.classList.remove('driving');
        }
        remotes = {};
        remoteCars = {};
        var players = data.players || [];
        for (var i = 0; i < players.length; i++) {
            var p = players[i];
            if (!p || p.id === myId) continue;
            var r = addRemote(p.id, p.nick);
            remoteSnap(r, +p.x || 0, +p.y || 0, +p.z || 0, +p.ry || 0, p.a | 0, p.d | 0, true);
        }
        applyCars(data.cars || []);
        started = true;
        if (Feat) Feat.onJoin(data);
        updateCarAct();
    }

    // ---------------------------------------------------------------- водіння: сісти / вийти
    function setDriving(on, silent) {
        if (on && !myCar) return;
        driving = !!on;
        document.body.classList.toggle('driving', driving);
        releaseAll();
        if (driving) {
            closePanel();
            myCar.speed = myCar.speed || 0;
        } else if (myCar && walker && !silent) {
            // Вийти ліворуч від машини
            var def = Phys.CARS[myCar.type];
            var d = def.wid / 2 + 2.6;
            var nx = myCar.x + Math.cos(myCar.ry) * d, nz = myCar.z - Math.sin(myCar.ry) * d;
            var c = World.clampToWorld(nx, nz, 2);
            var o = World.resolveObstacles(c.x, c.z, 1);
            walker.x = o.x; walker.z = o.z; walker.y = World.heightAt(o.x, o.z) + 0.2;
            walker.vy = 0; walker.onGround = false; walker.ry = myCar.ry;
        }
        updateCarAct();
    }

    function carNearMe() {
        if (!myCar || !walker) return false;
        var dx = walker.x - myCar.x, dz = walker.z - myCar.z;
        return dx * dx + dz * dz < CAR_NEAR * CAR_NEAR;
    }

    function updateCarAct() {
        var b = $('carAct');
        if (driving) {
            b.textContent = I18.t('exit_car');
            b.classList.add('show');
        } else if (carNearMe()) {
            b.textContent = I18.t('enter_car');
            b.classList.add('show');
        } else {
            b.classList.remove('show');
        }
    }

    // ---------------------------------------------------------------- створення машини
    function spawnCar(type) {
        if (CAR_TYPES.indexOf(type) < 0 || !walker) return;
        var t = nowMs();
        if (t - lastSpawnAt < SPAWN_COOLDOWN_MS) { toast(I18.t('car_wait')); return; }
        lastSpawnAt = t;
        var hadCar = !!myCar;
        // Якщо сидимо в старій машині — місце беремо біля неї; стару прибираємо перед появою нової
        var px = driving && myCar ? myCar.x : walker.x, pz = driving && myCar ? myCar.z : walker.z;
        var py = driving && myCar ? myCar.ry : walker.ry;
        if (driving) setDriving(false, true);
        var spot = Phys.spawnSpot(px, pz, py, type);
        myCar = Phys.createCar(type, spot.x, spot.z, spot.ry);
        myCar.cid = -1;
        pendingSpawn = true;
        closePanel();
        if (N.carSpawn) call(N.carSpawn, type, spot.x, spot.y, spot.z, spot.ry);
        else if (standalone) setTimeout(function () { window.KishkaGame.carResult({ ok: true, cid: Math.floor(Math.random() * 1e6) }); }, 60);
        // Одразу сідаємо за кермо
        walker.x = myCar.x; walker.z = myCar.z; walker.y = myCar.y;
        setDriving(true);
        toast(I18.t(hadCar ? 'car_removed' : 'car_spawned'));
    }

    // ---------------------------------------------------------------- кадр: фізика й стан
    var sendTimer = 0, sinceBeat = 0, lastSent = '', lastCarSent = '', sinceCarBeat = 0;

    function currentMoveDir() {
        var sx = input.sx, sy = input.sy, k = input.keys;
        if (sx === 0 && sy === 0) {
            sx = (k.ArrowRight || k.KeyD ? 1 : 0) - (k.ArrowLeft || k.KeyA ? 1 : 0);
            sy = (k.ArrowUp || k.KeyW ? 1 : 0) - (k.ArrowDown || k.KeyS ? 1 : 0);
        }
        var mag = Math.sqrt(sx * sx + sy * sy);
        if (mag > 1) { sx /= mag; sy /= mag; mag = 1; }
        // вперед відносно камери: від камери до гравця
        var fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
        var rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
        return { mx: fx * sy + rx * sx, mz: fz * sy + rz * sx, mag: mag };
    }

    // Інші машини в кімнаті (для зіткнень): позиція, поворот, тип і швидкість із останнього знімка
    var otherCars = [];
    function collectOtherCars() {
        otherCars.length = 0;
        for (var id in remoteCars) {
            var rc = remoteCars[id];
            otherCars.push({ x: rc.x, y: rc.y, z: rc.z, ry: rc.ry, type: rc.type, speed: rc.speed || 0, q: rc.q, vx: rc.vx, vy: rc.vy, vz: rc.vz, cr: rc.cr });
        }
        return otherCars;
    }

    function stepLocal(dt) {
        var k = input.keys;
        collectOtherCars();
        if (driving && myCar) {
            var th = (input.gas || k.ArrowUp || k.KeyW ? 1 : 0) - (input.rev || k.ArrowDown || k.KeyS ? 1 : 0);
            var st = (input.right || k.ArrowRight || k.KeyD ? 1 : 0) - (input.left || k.ArrowLeft || k.KeyA ? 1 : 0);
            var hb = k.Space ? 1 : 0;                                   // пробіл — ручник (блокує задні колеса)
            var dr = (input.hand || k.KeyP) ? 1 : 0;                    // P (кнопка «P» або клавіша) — дріфт
            if (Feat && Feat.inputLocked()) { th = 0; st = 0; hb = 0; dr = 0; }       // анімація вибуху / падіння після смерті
            Phys.stepMany(dt, function (h) { Phys.stepCar(myCar, { throttle: th, steer: st, handbrake: hb, drift: dr }, h, otherCars); });
            walker.x = myCar.x; walker.y = myCar.y; walker.z = myCar.z; walker.ry = myCar.ry;
            walker.a = 0; walker.speed = 0;
            afterCarStep(dt);
            return;
        }
        var dir = currentMoveDir();
        var jump = input.jump || k.Space;
        if (Feat && Feat.inputLocked()) { dir = { mx: 0, mz: 0, mag: 0 }; jump = false; }
        Phys.stepMany(dt, function (h) {
            Phys.stepWalker(walker, { mx: dir.mx * dir.mag, mz: dir.mz * dir.mag, jump: jump }, h, walkCars());
        });
        // Припаркована машина докочується до зупинки
        if (myCar && (Math.abs(myCar.speed) > 0.05 || myCar.air || (myCar.nGround || 0) < 3 || myCar.hit)) {
            Phys.stepMany(dt, function (h) { Phys.stepCar(myCar, { throttle: 0, steer: 0 }, h, otherCars); });
        }
        afterCarStep(dt);
    }

    // Машини, крізь які персонаж не проходить: моя (якщо на землі, не в ній) і чужі
    var walkList = [];
    function walkCars() {
        walkList.length = 0;
        if (myCar && !driving) walkList.push(myCar);
        for (var i = 0; i < otherCars.length; i++) walkList.push(otherCars[i]);
        return walkList;
    }

    // Після кроку фізики: тряска камери від ударів, відламані деталі, кнопка «перевернути»
    function afterCarStep(dt) {
        Phys.stepDebris(dt);
        if (!myCar) return;
        var ev = myCar.events;
        if (Feat) Feat.onCarEvents(ev);
        for (var i = 0; i < ev.length; i++) {
            var e = ev[i];
            var dv = e.dv || e.v || 0;
            if (dv > 4) shake = Math.max(shake, Math.min(1.6, dv * 0.07));
        }
        ev.length = 0;
        var fb = $('flipBtn');
        if (fb) {
            var show = !!(myCar.flipped && driving);
            if (show !== fb.classList.contains('show')) {
                fb.classList.toggle('show', show);
                var ft = $('flipTxt');
                if (ft) ft.textContent = lt('flip'); else fb.textContent = lt('flip');
            }
        }
    }

    function sendState(dt) {
        sendTimer += dt * 1000;
        sinceBeat += dt * 1000;
        sinceCarBeat += dt * 1000;
        if (sendTimer < SEND_EVERY_MS) return;
        sendTimer = 0;
        if (Feat && Feat.isDead()) return;
        var r2 = function (v) { return Math.round(v * 100) / 100; };
        var o = { x: r2(walker.x), y: r2(walker.y), z: r2(walker.z), ry: r2(walker.ry), a: driving ? 0 : walker.a, d: driving ? 1 : 0 };
        var key = o.x + ',' + o.y + ',' + o.z + ',' + o.ry + ',' + o.a + ',' + o.d;
        var changed = key !== lastSent;
        var withCar = false;
        if (myCar && !pendingSpawn) {
            var r3 = function (v) { return Math.round(v * 1000) / 1000; };
            var c = {
                t: myCar.type, x: r2(myCar.x), y: r2(myCar.y), z: r2(myCar.z), ry: r2(myCar.ry), s: r2(myCar.speed), st: r2(myCar.steer),
                q: [r3(myCar.q[0]), r3(myCar.q[1]), r3(myCar.q[2]), r3(myCar.q[3])], dm: Phys.netMask(myCar)
            };
            var ck = c.x + ',' + c.y + ',' + c.z + ',' + c.ry + ',' + c.s + ',' + c.st + ',' + c.q.join(':') + ',' + c.dm;
            if (ck !== lastCarSent || sinceCarBeat > 1500) {
                o.c = c; withCar = true; lastCarSent = ck; sinceCarBeat = 0;
            }
        }
        if (!changed && !withCar && sinceBeat < 1000) return;
        sinceBeat = 0;
        lastSent = key;
        var json = JSON.stringify(o);
        if (N.sendState) call(N.sendState, json);
        else if (N.oldState) call(N.oldState, o.x, o.y, o.z, o.ry, o.a);
    }

    // ---------------------------------------------------------------- віддалені гравці й машини
    var snapOut = { x: 0, y: 0, z: 0, ry: 0, a: 0, d: 0, speed: 0, steer: 0, q: [0, 0, 0, 1], hasQ: false };

    function updateRemotes(dt) {
        var rt = nowMs() / 1000 - INTERP_DELAY;
        var id;
        for (id in remoteCars) {
            var rc = remoteCars[id];
            if (!sampleSnaps(rc.snaps, rt, snapOut, true)) continue;
            var def = Phys.CARS[rc.type];
            var ox0 = rc.x, oy0 = rc.y, oz0 = rc.z;
            rc.x = snapOut.x; rc.z = snapOut.z; rc.ry = snapOut.ry; rc.y = snapOut.y;
            if (snapOut.hasQ) { rc.q[0] = snapOut.q[0]; rc.q[1] = snapOut.q[1]; rc.q[2] = snapOut.q[2]; rc.q[3] = snapOut.q[3]; }
            else { var g = Phys.groundSample(def, rc); Phys.qFromEuler(rc.q, rc.ry, g.pitch, g.roll); rc.y = Math.max(rc.y, g.y - 0.5); }
            rc.speed = snapOut.speed; rc.steer = snapOut.steer;
            rc.wheel += (rc.speed * dt) / def.wheelR;
            Phys.easeCrush(rc, dt);
            // швидкість для зіткнень (вектор), згладжена
            if (dt > 0.0005) {
                var kk = Math.min(1, dt * 10);
                rc.vx += (clamp((rc.x - ox0) / dt, -250, 250) - rc.vx) * kk;
                rc.vy += (clamp((rc.y - oy0) / dt, -250, 250) - rc.vy) * kk;
                rc.vz += (clamp((rc.z - oz0) / dt, -250, 250) - rc.vz) * kk;
            }
        }
        for (id in remotes) {
            var r = remotes[id];
            if (!r.has || !sampleSnaps(r.snaps, rt, snapOut, false)) continue;
            var ox = r.x, oz = r.z;
            r.x = snapOut.x; r.y = snapOut.y; r.z = snapOut.z; r.ry = snapOut.ry; r.a = snapOut.a; r.d = snapOut.d;
            var sp = Math.sqrt((r.x - ox) * (r.x - ox) + (r.z - oz) * (r.z - oz)) / Math.max(dt, 0.001);
            if (sp > 80) sp = 0;                         // телепорт (повторний вхід) — не «біг»
            r.speed += (sp - r.speed) * Math.min(1, dt * 8);
            var inCar = r.d === 1 && remoteCars[id];
            var mode = inCar ? 3 : (r.a === 2 ? 2 : (r.speed > 1.5 || r.a === 1 ? 1 : 0));
            updatePose(r.pose, mode, r.speed > 1.5 ? r.speed : 16, dt, inCar ? remoteCars[id].steer : 0);
        }
    }

    // ---------------------------------------------------------------- камера
    function updateCamera(dt) {
        var tx, ty, tz;
        if (driving && myCar) { tx = myCar.x; ty = myCar.y + 2.8; tz = myCar.z; }
        else { tx = walker.x; ty = walker.y + 3.2; tz = walker.z; }
        camTarget.x = tx; camTarget.y = ty; camTarget.z = tz;
        // У машині камера сама м'яко повертається за нею, поки гравець не крутить її пальцем
        if (driving && myCar && Math.abs(myCar.speed) > 3 && nowMs() - lastDragAt > 1500) {
            Cam.followYaw(cam, myCar.ry + (myCar.speed >= 0 ? Math.PI : 0), dt, 1.3);
        }
        Cam.eye(cam, camTarget, World.heightAt, eye);
        var oc = Feat ? Feat.cameraOverride() : null;
        if (oc) {                                                    // кінематографічна камера ядерної анімації
            eye.x = oc.eye[0]; eye.y = oc.eye[1]; eye.z = oc.eye[2]; eye.dist = 999;
            camTarget.x = oc.at[0]; camTarget.y = oc.at[1]; camTarget.z = oc.at[2];
            tx = oc.at[0]; ty = oc.at[1]; tz = oc.at[2];
            shake = 0;
            M.lookAt(V, eye.x, eye.y, eye.z, tx, ty, tz);
            M.perspective(P, oc.fov, W / H, 0.4, oc.far);
            M.mul(VP, P, V);
            return;
        }
        if (shake > 0.01) {
            var t = nowMs() * 0.05;
            eye.x += Math.sin(t * 1.7) * shake * 0.5; eye.y += Math.cos(t * 2.3) * shake * 0.4; eye.z += Math.sin(t * 1.3) * shake * 0.5;
            shake *= Math.max(0, 1 - dt * 5);
        }
        M.lookAt(V, eye.x, eye.y, eye.z, tx, ty, tz);
        M.perspective(P, 70 * Math.PI / 180, W / H, 0.4, TIER_CFG.far);
        M.mul(VP, P, V);
    }

    // ---------------------------------------------------------------- малювання кадру
    function render() {
        // Горизонт на екрані: камера над землею й дивиться вниз -> горизонт вище центру
        var horizon = clamp(Math.tan(cam.pitch) / Math.tan(35 * Math.PI / 180), -3, 3);
        R.begin(VP, [eye.x, eye.y, eye.z], canvas.width, canvas.height);
        R.sky(horizon);

        var i, c;
        // Рельєф: потокові шматки з рівнями деталізації; гірка — окреме тіло з тією самою шаховою плиткою
        var fx = camTarget.x - eye.x, fy = camTarget.y - eye.y, fz = camTarget.z - eye.z;
        var fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
        fx /= fl; fz /= fl;
        R.checker(true, World.CFG.tile);
        tstream.draw(R, eye.x, eye.z, fx, fz, TIER_CFG.fogFar + 160);
        R.checker(true, World.CFG.rampTile);
        R.draw(R.rampTop, M.ident(stk), worldTint, 1, 0);
        R.checker(false);
        R.draw(R.rampWalls, M.ident(stk), worldTint, 1, 0);
        R.checker(false);
        R.offset(true);
        R.draw(R.decalsMesh, M.ident(stk), null, 1, 0);
        R.offset(false);
        if (propsGeo && propsGeo.idx.length > 0) R.draw(R.propsMesh, M.ident(stk), null, 1, 0);
        drawDebris(R);
        if (Feat) Feat.renderWorld(R, eye);

        // Машини й персонажі
        var hideMe = !driving && eye.dist < 1.8;
        var id;
        if (myCar) drawCarOpaque(R, myCar);
        for (id in remoteCars) drawCarOpaque(R, remoteCars[id]);
        if (driving && myCar) { if (eye.dist > 2.2) drawSeated(R, myCar, myPose); }
        else if (!hideMe) {
            M.ident(stk); M.translate(stk, walker.x, walker.y, walker.z); M.rotateY(stk, walker.ry);
            var dpose = Feat ? Feat.deadPose() : null;
            if (dpose) { M.translate(stk, 0, 0.55 * dpose.tilt, 0); M.rotateX(stk, -1.5 * dpose.tilt); }     // персонаж падає на спину
            drawChar(R, stk, myPose);
        }
        var drawnBase = new Float32Array(16);
        for (id in remotes) {
            var r = remotes[id];
            if (!r.has || hiddenIds[id]) continue;
            if (r.d === 1 && remoteCars[id]) { drawSeated(R, remoteCars[id], r.pose); continue; }
            M.ident(drawnBase); M.translate(drawnBase, r.x, r.y, r.z); M.rotateY(drawnBase, r.ry);
            drawChar(R, drawnBase, r.pose);
        }

        // М'які тіні й прозоре скло
        R.blend(true);
        R.offset(true);
        if (myCar) { var d0 = Phys.CARS[myCar.type]; drawShadow(R, myCar.x, myCar.z, d0.wid * 0.62, d0.len * 0.56, myCar.ry, 0.3); }
        for (id in remoteCars) { var rc = remoteCars[id], d1 = Phys.CARS[rc.type]; drawShadow(R, rc.x, rc.z, d1.wid * 0.62, d1.len * 0.56, rc.ry, 0.3); }
        if (!driving && !hideMe) {
            var h = Math.max(0, walker.y - World.heightAt(walker.x, walker.z));
            drawShadow(R, walker.x, walker.z, 1.5, 1.5, 0, clamp(0.32 - h * 0.012, 0.08, 0.32));
        }
        for (id in remotes) {
            var q = remotes[id];
            if (!q.has || (q.d === 1 && remoteCars[id])) continue;
            drawShadow(R, q.x, q.z, 1.5, 1.5, 0, clamp(0.32 - Math.max(0, q.y - World.heightAt(q.x, q.z)) * 0.012, 0.08, 0.32));
        }
        R.offset(false);
        if (myCar) drawCarGlass(R, myCar);
        for (id in remoteCars) drawCarGlass(R, remoteCars[id]);
        R.blend(false);
        if (Feat) Feat.renderFx(R);
    }

    function drawTags() {
        if (!tagsCtx) return;
        tagsCtx.clearRect(0, 0, tagsCanvas.width, tagsCanvas.height);
        if (!SHOW_NAMETAGS) return;
        tagsCtx.font = 'bold ' + Math.round(13 * DPR * renderScale) + 'px sans-serif';
        tagsCtx.textAlign = 'center';
        tagsCtx.textBaseline = 'bottom';
        tagsCtx.lineWidth = 3 * DPR * renderScale;
        tagsCtx.strokeStyle = 'rgba(0,0,0,0.65)';
        tagsCtx.fillStyle = '#ffffff';
        var list = [];
        if (myNick && (driving || eye.dist >= 1.8)) {
            var my = driving && myCar ? myCar.y + (carModels[myCar.type] ? carModels[myCar.type].height : 4) + 1.2 : walker.y + 5.9;
            list.push({ nick: myNick, x: driving && myCar ? myCar.x : walker.x, y: my, z: driving && myCar ? myCar.z : walker.z });
        }
        var id;
        for (id in remotes) {
            var r = remotes[id];
            if (!r.has || !r.nick || hiddenIds[id]) continue;
            var inCar = r.d === 1 && remoteCars[id];
            list.push({ nick: r.nick, x: r.x, y: inCar ? r.y + (carModels[remoteCars[id].type] ? carModels[remoteCars[id].type].height : 4) + 1.2 : r.y + 5.9, z: r.z });
        }
        for (var i = 0; i < list.length; i++) {
            var c = list[i];
            var dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z;
            if (Math.sqrt(dx * dx + dy * dy + dz * dz) > 150) continue;
            var cw = VP[3] * c.x + VP[7] * c.y + VP[11] * c.z + VP[15];
            if (cw <= 0.01) continue;
            var cx = (VP[0] * c.x + VP[4] * c.y + VP[8] * c.z + VP[12]) / cw;
            var cy = (VP[1] * c.x + VP[5] * c.y + VP[9] * c.z + VP[13]) / cw;
            if (cx < -1.1 || cx > 1.1 || cy < -1.1 || cy > 1.1) continue;
            var px = (cx * 0.5 + 0.5) * tagsCanvas.width;
            var py = (1 - (cy * 0.5 + 0.5)) * tagsCanvas.height;
            tagsCtx.strokeText(c.nick, px, py);
            tagsCtx.fillText(c.nick, px, py);
        }
    }

    // ---------------------------------------------------------------- розмір екрана й адаптивна якість
    function resize() {
        DPR = Math.min(window.devicePixelRatio || 1, TIER_CFG.dpr);
        var cssW = window.innerWidth || 1, cssH = window.innerHeight || 1;
        W = Math.max(1, Math.round(cssW * DPR * renderScale));
        H = Math.max(1, Math.round(cssH * DPR * renderScale));
        canvas.width = W; canvas.height = H;
        tagsCanvas.width = W; tagsCanvas.height = H;
    }

    var perf = { acc: 0, n: 0, goodFor: 0 };
    function adaptQuality(dt) {
        perf.acc += dt; perf.n++;
        if (perf.n < 45) return;
        var avg = perf.acc / perf.n;
        perf.acc = 0; perf.n = 0;
        if (avg > 0.033 && renderScale > 0.55) {
            renderScale = Math.max(0.55, renderScale - 0.12);
            perf.goodFor = 0;
            resize();
            nlog('швидкість ' + Math.round(1 / avg) + ' к/с: зменшую роздільну здатність до ' + renderScale.toFixed(2));
        } else if (avg < 0.019) {
            perf.goodFor++;
            if (perf.goodFor >= 4 && renderScale < 1) {
                renderScale = Math.min(1, renderScale + 0.08);
                perf.goodFor = 0;
                resize();
            }
        } else {
            perf.goodFor = 0;
        }
    }

    // Написи нових кнопок (мови uk / ru / en)
    var LT = { flip: { uk: 'Перевернути', ru: 'Перевернуть', en: 'Flip upright' } };
    function lt(key) { var d = LT[key]; return d ? (d[I18.lang] || d.en) : key; }

    // ---------------------------------------------------------------- спідометр
    // Показує справжню швидкість моєї машини: студи/с -> км/год (Phys.kmh), стрілка до 200 км/год, передача D1..Dn / N / R.
    var SPEEDO_MAX = 260;
    var SPEEDO_ARC = 367.57;                  // довжина дуги 270° для r = 78
    var speedoEls = null, speedoLast = { kmh: -1, gear: -99, lang: '' };
    function updateSpeedo() {
        if (!speedoEls) {
            speedoEls = { num: $('spdNum'), bar: $('spdBar'), gear: $('spdGear'), unit: $('spdUnit'), box: $('speedo') };
        }
        var v = driving && myCar ? Phys.kmh(myCar.speed) : 0;
        var gear = driving && myCar ? (Math.abs(myCar.speed) < 0.8 ? 0 : (myCar.gear < 0 ? -1 : (myCar.gear || 1))) : 0;
        var lang = I18.lang;
        if (v === speedoLast.kmh && gear === speedoLast.gear && lang === speedoLast.lang) return;
        speedoLast.kmh = v; speedoLast.gear = gear; speedoLast.lang = lang;
        var smax = driving && myCar && Phys.CARS[myCar.type] ? Phys.CARS[myCar.type].topKmh * 1.04 : SPEEDO_MAX;   // шкала під ліміт швидкості машини
        var p = clamp(v / smax, 0, 1);
        speedoEls.num.textContent = String(v);
        speedoEls.bar.setAttribute('stroke-dasharray', (p * SPEEDO_ARC).toFixed(1) + ' 490.09');
        speedoEls.bar.setAttribute('stroke', 'hsl(' + Math.round(130 - 130 * p) + ',78%,55%)');   // зелений -> жовтий -> червоний
        speedoEls.gear.textContent = gear < 0 ? 'R' : (gear === 0 ? 'N' : 'D' + gear);
        speedoEls.unit.textContent = I18.t('kmh');
        speedoEls.box.setAttribute('aria-label', I18.t('speedometer') + ': ' + v);
    }

    // ---------------------------------------------------------------- підказка зверху
    var toastTimer = 0;
    function toast(text) {
        var el = $('toast');
        el.textContent = text;
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
    }

    // ---------------------------------------------------------------- вікно вибору машин
    var selectedType = null;
    var previews = null;                      // type -> dataURL (або null, якщо не вдалося намалювати)

    var CAR_ICONS = {
        sedan: '<svg viewBox="0 0 48 30"><path d="M4 21v-5l4-9h26l6 9h4v5h-4a5 5 0 0 1-10 0H17a5 5 0 0 1-10 0H4z" fill="#ff6b6b"/><path d="M12 9h9v7h-13zM24 9h8l4 7H24z" fill="#cfe4ff"/><circle cx="12" cy="22" r="3.6" fill="#22283a"/><circle cx="35" cy="22" r="3.6" fill="#22283a"/></svg>',
        van: '<svg viewBox="0 0 48 30"><path d="M3 22V8l3-3h28l8 8v9h-3a5 5 0 0 1-10 0H15a5 5 0 0 1-10 0H3z" fill="#ffc83d"/><path d="M8 8h8v6H7zM19 8h8v6h-8zM30 8h4l5 6h-9z" fill="#cfe4ff"/><circle cx="11" cy="23" r="3.6" fill="#22283a"/><circle cx="35" cy="23" r="3.6" fill="#22283a"/></svg>',
        truck: '<svg viewBox="0 0 48 30"><path d="M2 6h24v16H2z" fill="#eef0f4"/><path d="M26 10h10l6 7v5H26z" fill="#3a7be0"/><path d="M29 12h6l4 5h-10z" fill="#cfe4ff"/><circle cx="10" cy="23" r="3.6" fill="#22283a"/><circle cx="20" cy="23" r="3.6" fill="#22283a"/><circle cx="36" cy="23" r="3.6" fill="#22283a"/></svg>'
    };

    // Малюємо кожну машину в маленькому окремому WebGL-вікні й показуємо як картинку
    function makePreviews() {
        previews = {};
        var pc = document.createElement('canvas');
        pc.width = 480; pc.height = 300;
        var pr = null;
        try {
            pr = createRenderer(pc, { alpha: true, aa: true, preserve: true, fogNear: 900, fogFar: 1000 });
            var vp = new Float32Array(16), pv = new Float32Array(16), pp = new Float32Array(16), pm = new Float32Array(16), sh = new Float32Array(16);
            var disc = Models.newGeo();
            var dsc = buildDisc();
            CAR_TYPES.forEach(function (t) {
                var mdl = Models.buildCar(t);
                var op = pr.mesh(mdl.opaque), gl = pr.mesh(mdl.glass), wh = pr.mesh(mdl.wheel);
                var pparts = [];
                for (var pn in mdl.parts) pparts.push(pr.mesh(mdl.parts[pn].geo));
                var dist = mdl.len * 1.45;
                var ex = dist * 0.62, ey = mdl.height * 0.95 + 2.4, ez = dist * 0.82;
                M.lookAt(pv, ex, ey, ez, 0, mdl.height * 0.42, 0);
                M.perspective(pp, 34 * Math.PI / 180, 480 / 300, 1, 400);
                M.mul(vp, pp, pv);
                pr.begin(vp, [ex, ey, ez], 480, 300, [0, 0, 0, 0]);
                M.ident(sh); M.scale(sh, mdl.wid * 0.75, 1, mdl.len * 0.62);
                M.translate(sh, 0, 0.05, 0);
                pr.blend(true);
                pr.draw(pr.mesh(dsc), sh, [0, 0, 0], 0.28, 0);
                pr.blend(false);
                M.ident(pm);
                pr.draw(op, pm, null, 1, 0.35);
                pparts.forEach(function (pg) { pr.draw(pg, pm, null, 1, 0.35); });
                mdl.wheelPos.forEach(function (w) {
                    M.ident(pm); M.translate(pm, w.x, w.y, w.z);
                    pr.draw(wh, pm, null, 1, 0.15);
                });
                M.ident(pm);
                pr.blend(true);
                pr.draw(gl, pm, null, 0.5, 0.9);
                pr.blend(false);
                previews[t] = pc.toDataURL('image/png');
            });
        } catch (e) {
            nlog('попередній перегляд машин не вдалося намалювати: ' + (e && e.message));
            CAR_TYPES.forEach(function (t) { if (!previews[t]) previews[t] = null; });
        }
        try {
            if (pr && pr.gl && pr.gl.getExtension('WEBGL_lose_context')) pr.gl.getExtension('WEBGL_lose_context').loseContext();
        } catch (e2) { /* ignore */ }
    }

    function renderCarsPanel() {
        $('carsTitle').textContent = I18.t('cars_title');
        $('carsClose').setAttribute('aria-label', I18.t('close'));
        var list = $('carsList');
        list.innerHTML = '';
        CAR_TYPES.forEach(function (t) {
            var card = document.createElement('div');
            card.className = 'card' + (selectedType === t ? ' sel' : '');
            card.setAttribute('data-type', t);
            var pv = previews && previews[t];
            var media = pv ? '<img class="pv" alt="" src="' + pv + '">' : '<div style="width:62%">' + CAR_ICONS[t] + '</div>';
            card.innerHTML = '<div class="pvw">' + media + '</div>' +
                '<div class="nm">' + CAR_ICONS[t] + '<span>' + I18.t(t) + '</span></div>' +
                '<div class="ht">' + I18.t(t + '_hint') + '</div>' +
                '<div class="st">' + (selectedType === t ? I18.t('selected') : '') + '</div>';
            card.addEventListener('click', function () { if (selectedType !== t) selectCar(t); });
            list.appendChild(card);
        });
        var sp = $('spawnBtn');
        sp.textContent = I18.t('spawn');
        sp.disabled = !selectedType;
    }

    function selectCar(t) { selectedType = t; renderCarsPanel(); }
    // Розмір вікна машин задаємо в пікселях: старі WebView не знають CSS min()/clamp(), і вікно ставало вузьким (кілька мм)
    function layoutPanel() {
        var pn = $('carsPanel');
        var vw = window.innerWidth || 800, vh = window.innerHeight || 400;
        var w = Math.max(Math.min(Math.round(vw * 0.84), 980), Math.min(vw - 16, 560));
        var h = Math.max(Math.min(Math.round(vh * 0.82), 620), Math.min(vh - 12, 300));
        pn.style.width = w + 'px';
        pn.style.height = h + 'px';
        pn.style.left = Math.max(0, Math.round((vw - w) / 2)) + 'px';
        pn.style.top = Math.max(0, Math.round((vh - h) / 2)) + 'px';
    }
    function openPanel() {
        if (driving) return;
        layoutPanel();
        if (!previews) makePreviews();
        if (!selectedType) selectedType = myCar ? myCar.type : CAR_TYPES[0];
        renderCarsPanel();
        $('carsPanel').classList.remove('hidden');
        releaseAll();
    }
    function closePanel() { $('carsPanel').classList.add('hidden'); }
    window.addEventListener('resize', function () { if (panelOpen()) layoutPanel(); });
    function panelOpen() { return !$('carsPanel').classList.contains('hidden'); }

    function applyLangToStaticUI() {
        $('carsBtnText').textContent = I18.t('cars');
        $('carsBtn').setAttribute('aria-label', I18.t('cars'));
        $('gas').setAttribute('aria-label', I18.t('gas'));
        $('rev').setAttribute('aria-label', I18.t('reverse'));
        $('left').setAttribute('aria-label', I18.t('left'));
        $('right').setAttribute('aria-label', I18.t('right'));
        speedoLast.lang = '';
        if (panelOpen()) renderCarsPanel();
        updateCarAct();
    }

    // ---------------------------------------------------------------- керування пальцями
    var holds = [];
    function bindHold(el, setter) {
        var ptr = null;
        el.addEventListener('pointerdown', function (e) {
            if (ptr !== null) return;
            ptr = e.pointerId;
            try { el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
            el.classList.add('down');
            setter(true);
            e.preventDefault();
        });
        function end(e) {
            if (ptr === null || e.pointerId !== ptr) return;
            ptr = null;
            el.classList.remove('down');
            setter(false);
        }
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);
        el.addEventListener('lostpointercapture', end);
        el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        holds.push(function () {
            if (ptr !== null) { ptr = null; el.classList.remove('down'); setter(false); }
        });
    }
    function releaseAll() {
        for (var i = 0; i < holds.length; i++) holds[i]();
        input.sx = 0; input.sy = 0; input.jump = false; input.hand = false; input.keys = {};
        var kn = $('knob');
        if (kn) kn.style.transform = 'translate(0px,0px)';
        stickPtr = null;
    }

    var stickEl = $('stick'), knobEl = $('knob');
    var stickPtr = null, stickCx = 0, stickCy = 0, stickR = 52;

    function updateStick(e) {
        var dx = e.clientX - stickCx, dy = e.clientY - stickCy;
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len > stickR) { dx = dx / len * stickR; dy = dy / len * stickR; }
        knobEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        input.sx = dx / stickR;
        input.sy = -dy / stickR;
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
        var rc = stickEl.getBoundingClientRect();
        stickCx = rc.left + rc.width / 2; stickCy = rc.top + rc.height / 2;
        stickR = rc.width * 0.42;
        updateStick(e);
        e.preventDefault();
    });
    stickEl.addEventListener('pointermove', function (e) { if (e.pointerId === stickPtr) updateStick(e); });
    stickEl.addEventListener('pointerup', endStick);
    stickEl.addEventListener('pointercancel', endStick);
    stickEl.addEventListener('lostpointercapture', endStick);

    bindHold($('jump'), function (on) { input.jump = on; });
    bindHold($('gas'), function (on) { input.gas = on; });
    bindHold($('rev'), function (on) { input.rev = on; });
    bindHold($('left'), function (on) { input.left = on; });
    bindHold($('right'), function (on) { input.right = on; });
    bindHold($('hand'), function (on) { input.hand = on; });
    function doFlip() {
        if (!myCar || !driving) return;
        Phys.flipCar(myCar);
        $('flipBtn').classList.remove('show');
    }
    $('flipBtn').addEventListener('click', doFlip);

    $('carsBtn').addEventListener('click', function () { if (panelOpen()) closePanel(); else openPanel(); });
    $('carsClose').addEventListener('click', closePanel);
    $('spawnBtn').addEventListener('click', function () {
        var btn = $('spawnBtn'), t = selectedType;
        if (!t) return;
        btn.classList.add('pressed');
        setTimeout(function () { btn.classList.remove('pressed'); }, 180);
        setTimeout(function () { spawnCar(t); }, 120);      // короткий «клік», потім машина з'являється
    });
    $('carAct').addEventListener('click', function () {
        if (driving) setDriving(false);
        else if (carNearMe()) setDriving(true);
        else toast(I18.t('car_far'));
    });
    ['carsPanel', 'carsBtn', 'carAct', 'speedo', 'flipBtn'].forEach(function (id) {
        $(id).addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    });

    // Камера: один палець — повертає, два пальці — наближення/віддалення
    var camPtrs = {}, camCount = 0, pinchLast = 0;
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
            if (pinchLast > 0 && d > 0) Cam.pinch(cam, pinchLast, d);
            pinchLast = d;
        } else {
            Cam.drag(cam, dx, dy);
            lastDragAt = nowMs();
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
    canvas.addEventListener('wheel', function (e) { Cam.wheel(cam, e.deltaY); e.preventDefault(); }, { passive: false });

    window.addEventListener('keydown', function (e) {
        var ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;       // друкуємо в чаті — персонаж не рухається
        input.keys[e.code] = true;
        if (e.code === 'KeyR' && myCar && myCar.flipped) doFlip();         // R — перевернути машину на колеса
    });
    window.addEventListener('keyup', function (e) { input.keys[e.code] = false; });
    canvas.addEventListener('pointerdown', function () { var ae = document.activeElement; if (ae && ae.tagName === 'INPUT') ae.blur(); });
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', function () { if (document.hidden) releaseAll(); });
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', function () { setTimeout(resize, 150); });

    // ---------------------------------------------------------------- головний цикл
    var lastT = 0;
    function frame(now) {
        window.requestAnimationFrame(frame);
        if (!started || !R) { lastT = now; return; }
        var dt = (now - lastT) / 1000;
        lastT = now;
        if (!(dt > 0)) return;
        dt = Math.min(dt, 0.1);

        stepLocal(dt);
        if (Feat) Feat.update(dt);
        retryRegister(dt);
        // поза мого персонажа
        var mode = driving ? 3 : (walker.a === 2 ? 2 : (walker.a === 1 ? 1 : 0));
        updatePose(myPose, mode, walker.speed || 16, dt, driving && myCar ? myCar.steer / 0.6 : 0);
        updateRemotes(dt);
        sendState(dt);
        updateSpeedo();
        updateCamera(dt);
        render();
        drawTags();
        adaptQuality(dt);
        if (!driving && (now | 0) % 6 === 0) updateCarAct();
        if (!firstFrameDone) {
            firstFrameDone = true;
            call(N.started);
        }
    }

    // ---------------------------------------------------------------- зв'язок із застосунком
    window.KishkaGame = {
        config: function (o) {
            if (!o) return;
            if (o.lang) I18.setLang(o.lang);
            if (o.invertCamera !== undefined) { settings.invertCamera = !!o.invertCamera; cam.invert = settings.invertCamera; }
            applyLangToStaticUI();
        },
        start: function (data) { begin(data, false); },
        resync: function (data) { begin(data, true); },
        roster: function (data) { if (data && data.players) applyRoster(data.players); },
        tick: function (arr) {
            if (!arr) return;
            for (var i = 0; i < arr.length; i++) {
                var t = arr[i], id = t[0];
                if (id === myId) continue;
                var r = remotes[id] || addRemote(id, '');
                if (!r) continue;
                remoteSnap(r, +t[1], +t[2], +t[3], +t[4], t[5] | 0, t[6] | 0, !r.has);
            }
        },
        cars: function (data) { if (data && data.cars) applyCars(data.cars); },
        carTick: function (arr) {
            if (!arr) return;
            for (var i = 0; i < arr.length; i++) {
                var t = arr[i], id = t[0];
                if (id === myId) continue;
                var rc = remoteCars[id];
                if (!rc || rc.cid !== t[1]) continue;
                var qq = t.length >= 13 ? [+t[9], +t[10], +t[11], +t[12]] : null;
                carSnap(rc, +t[2], +t[3], +t[4], +t[5], +t[6], +t[7], false, qq);
                var dmask = t.length >= 14 ? (t[13] | 0) : 0;
                if (dmask !== rc.netDm) {
                    rc.netDm = dmask;
                    if (qq) { rc.q[0] = qq[0]; rc.q[1] = qq[1]; rc.q[2] = qq[2]; rc.q[3] = qq[3]; }
                    rc.x = +t[2]; rc.y = +t[3]; rc.z = +t[4];
                    Phys.applyDamageMask(rc, dmask);                 // нові відламані деталі -> уламки біля машини
                }
            }
        },
        // Меню «лупа»: камера повертається до обраного гравця
        lookAt: function (id) {
            var r = remotes[id];
            if (!r || !r.has || !walker) return;
            var dx = r.x - walker.x, dz = r.z - walker.z;
            if (dx * dx + dz * dz < 0.01) return;
            cam.yaw = Math.atan2(-dx, -dz);
        },
        // Меню «заблокувати»: персонаж гравця більше не показується (лише мені)
        hidePlayer: function (id, hidden) {
            if (hidden) hiddenIds[id] = true; else delete hiddenIds[id];
        },
        // Меню «Respawn»: сервер підтвердив нове місце — виходимо з машини й ставимо персонажа на майданчик
        respawn: function (data) {
            if (!walker) return;
            if (Feat) { Feat.respawnByMenu(data); return; }        // HP -> 0, персонаж падає, потім з'являється на майданчику
            var s0 = World.spawnPoint();
            var x = data && isFinite(+data.x) ? +data.x : s0.x, z = data && isFinite(+data.z) ? +data.z : s0.z;
            if (driving) setDriving(false, true);
            walker.x = x; walker.z = z; walker.y = World.heightAt(x, z) + 0.3; walker.vy = 0; walker.onGround = false;
            walker.ry = data && isFinite(+data.ry) ? +data.ry : walker.ry;
            cam.yaw = walker.ry + Math.PI;
            lastSent = '';
            releaseAll();
            toast(I18.t('respawned'));
            updateCarAct();
        },
        carResult: function (res) {
            if (!pendingSpawn) return;
            pendingSpawn = false;
            if (res && res.ok) {
                if (myCar) { myCar.cid = res.cid; myCar.unreg = false; }
                lastCarSent = '';
            } else {
                var code = res && res.code;
                nlog('сервер не створив машину: ' + code);
                // Слабкий інтернет (тайм-аут, обрив, помилка): машину НЕ прибираємо й нічого не пишемо — вона вже стоїть у мене,
                // а реєстрацію на сервері тихо повторюємо, поки не вдасться (див. retryRegister).
                if (myCar && (code === 'timeout' || code === 'offline' || code === 'error' || code === 'rate' || code === 'too_far' || code === 'not_in_game' || !code)) {
                    myCar.unreg = true; myCar.regAt = nowMs() + (code === 'rate' ? 1600 : 2500); myCar.regTry = (myCar.regTry || 0) + 1;
                } else {
                    removeMyCarLocal();
                    toast(I18.t(code === 'rate' ? 'car_wait' : 'car_failed'));
                }
            }
        },
        // Події сервера для нових можливостей: чат, двері коробки, ядерна подія
        serverEvent: function (name, data) { if (Feat) Feat.onServerEvent(name, data); },
        // Відповідь на запит, надісланий через Android.rpc
        rpcResult: function (id, res) { if (Feat) Feat.rpcResult(id, res); }
    };

    // Тиха повторна реєстрація машини на сервері після невдалого spawn (слабкий інтернет)
    function retryRegister(dt) {
        if (!myCar || !myCar.unreg || pendingSpawn || !walker) return;
        if (nowMs() < (myCar.regAt || 0)) return;
        if (!N.carSpawn) { myCar.unreg = false; return; }
        myCar.regAt = nowMs() + 4000;
        pendingSpawn = true;
        call(N.carSpawn, myCar.type, myCar.x, myCar.y, myCar.z, myCar.ry);
    }

    // Для перевірки у браузері й автотестах
    window.KishkaGameDebug = {
        state: function () {
            return { started: started, driving: driving, car: myCar, walker: walker, cam: { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, eyeDist: cam.eyeDist }, tier: TIER, scale: renderScale, remotes: Object.keys(remotes).length, remoteCars: Object.keys(remoteCars).length };
        },
        spawn: spawnCar, drive: function (on) { setDriving(on); }, cam: cam, input: input
    };

    window.addEventListener('error', function (e) {
        nlog('помилка сторінки: ' + (e && e.message) + ' (' + (e && e.filename) + ':' + (e && e.lineno) + ')');
    });

    function boot() {
        try {
            if (Features && Nuke && Structures && !Feat) {
                Feat = Features.create({
                    World: World, Phys: Phys, Models: Models, Structures: Structures, Nuke: Nuke, M: M, I18: I18, $: $, stk: new Float32Array(16),
                    toast: toast, nowMs: nowMs, standalone: standalone,
                    me: function () { return { walker: walker, car: myCar, driving: driving }; },
                    myId: function () { return myId; }, myNick: function () { return myNick; }, remoteCars: function () { return remoteCars; },
                    setDriving: setDriving, releaseAll: releaseAll,
                    teleport: function (x, y, z, ry) {
                        if (!walker) return;
                        walker.x = x; walker.y = y; walker.z = z; walker.vx = 0; walker.vy = 0; walker.vz = 0; walker.onGround = false;
                        if (isFinite(ry)) { walker.ry = ry; cam.yaw = ry + Math.PI; }
                        lastSent = '';
                    },
                    nativeRpc: N.rpc, setBurn: setBurn, setTint: function (t) { worldTint = t; }, addShake: function (v) { shake = Math.max(shake, v); }
                });
                Feat.init();
            }
            resize();
            tagsCtx = tagsCanvas.getContext('2d');
            R = createRenderer(canvas, { aa: TIER_CFG.aa, fogNear: Math.round(TIER_CFG.fogFar * 0.38), fogFar: TIER_CFG.fogFar });
            buildAssets();
        } catch (e) {
            nfail('webgl', e && e.message ? e.message : String(e));
            return;
        }
        canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); started = false; nlog('WebGL-контекст втрачено'); }, false);
        canvas.addEventListener('webglcontextrestored', function () {
            try { R = createRenderer(canvas, { aa: TIER_CFG.aa, fogNear: Math.round(TIER_CFG.fogFar * 0.38), fogFar: TIER_CFG.fogFar }); buildAssets(); started = !!walker; nlog('WebGL-контекст відновлено'); }
            catch (e) { nfail('webgl', 'не вдалося відновити: ' + (e && e.message)); }
        }, false);
        applyLangToStaticUI();
        nlog('гра запущена, якість ' + TIER + ', кроки рельєфу ' + TIER_CFG.cell);
        window.requestAnimationFrame(frame);
        if (N.ready) call(N.ready);
        else if (standalone) {
            setTimeout(function () {
                window.KishkaGame.start({ id: 1, nick: 'Player', x: 0, y: 1, z: 0, players: [], cars: [] });
            }, 50);
        }
    }

    boot();
})();
