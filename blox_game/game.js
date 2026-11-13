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
//   KishkaGame.carTick([[id,cid,x,y,z,ry,speed,steer,kmh],...])  рух машин (kmh — швидкість для спідометра, рахує сервер)
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

    // ---------------------------------------------------------------- зв'язок із застосунком
    function nativeFn(name) {
        var a = window.Android;
        return a && a[name] !== undefined ? function () { return a[name].apply(a, arguments); } : null;
    }
    var standalone = !window.Android;       // відкрито в звичайному браузері (для перевірки): локальна гра без мережі
    var N = {
        ready: nativeFn('ready'), started: nativeFn('started'), fail: nativeFn('fail'), failReason: nativeFn('failReason'),
        log: nativeFn('log'), sendState: nativeFn('sendState'), oldState: nativeFn('state'),
        carSpawn: nativeFn('carSpawn'), carRemove: nativeFn('carRemove')
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
    var TIER_CFG = [
        { cell: 5, dpr: 1.0, aa: false, far: 560, fogFar: 440 },
        { cell: 4, dpr: 1.5, aa: true, far: 720, fogFar: 540 },
        { cell: 3, dpr: 2.0, aa: true, far: 820, fogFar: 620 }
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
    var VS =
        'attribute vec3 aPos;\nattribute vec3 aNrm;\nattribute vec3 aCol;\n' +
        'uniform mat4 uVP;\nuniform mat4 uM;\nuniform mat3 uN;\n' +
        'varying vec3 vN;\nvarying vec3 vW;\nvarying vec3 vC;\n' +
        'void main() {\n  vec4 w = uM * vec4(aPos, 1.0);\n  vW = w.xyz;\n  vN = uN * aNrm;\n  vC = aCol;\n  gl_Position = uVP * w;\n}\n';
    var FS =
        '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
        'varying vec3 vN;\nvarying vec3 vW;\nvarying vec3 vC;\n' +
        'uniform vec3 uTint;\nuniform vec3 uLight;\nuniform vec3 uCam;\nuniform vec3 uFog;\nuniform vec2 uFogR;\n' +
        'uniform float uAlpha;\nuniform float uSpec;\nuniform float uCheck;\nuniform float uTile;\n' +
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
        '  vec3 amb = mix(vec3(0.36, 0.34, 0.32), vec3(0.64, 0.72, 0.86), hemi) * 0.8;\n' +
        '  vec3 sun = vec3(1.0, 0.95, 0.86) * (0.72 * d);\n' +
        '  vec3 lit = c * (amb + sun);\n' +
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
        ['uVP', 'uM', 'uN', 'uTint', 'uLight', 'uCam', 'uFog', 'uFogR', 'uAlpha', 'uSpec', 'uCheck', 'uTile'].forEach(function (n) { loc[n] = gl.getUniformLocation(prog, n); });
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
            gl.uniform1f(loc.uTile, World.CFG.tile || 8);
            gl.disable(gl.BLEND);
            gl.depthMask(true);
        }

        // Шахова плитка: вмикається лише для рельєфу (трава й гірка — один матеріал)
        function checker(on) { gl.uniform1f(loc.uCheck, on ? 1 : 0); }

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

        return { gl: gl, id: id, mesh: mesh, begin: begin, sky: sky, draw: draw, blend: blend, offset: offset, checker: checker };
    }

    // ---------------------------------------------------------------- стан гри
    var canvas = $('c');
    var tagsCanvas = $('tags');
    var tagsCtx = null;
    var R = null;                         // головний малювальник
    var terrain = [], propsGeo = null, decalsGeo = null, discGeo = null;
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

    var input = { sx: 0, sy: 0, jump: false, keys: {}, gas: false, rev: false, left: false, right: false };

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
        M.ident(out);
        M.translate(out, c.x, c.y + (c.sy || 0), c.z);
        M.rotateY(out, c.ry);
        M.rotateX(out, -(c.pitch || 0));
        M.rotateZ(out, -(c.roll || 0));
        return out;
    }

    function drawCarOpaque(r, c, tint) {
        var mdl = carModels[c.type];
        if (!mdl) return;
        carMatrix(carBase, c);
        r.draw(mdl.opaqueMesh, carBase, tint, 1, 0.35);
        var steerAng = -(c.steer || 0) * 0.9;
        for (var i = 0; i < mdl.wheelPos.length; i++) {
            var w = mdl.wheelPos[i];
            M.copy(wheelM, carBase);
            M.translate(wheelM, w.x, w.y, w.z);
            if (w.steer) M.rotateY(wheelM, steerAng);
            M.rotateX(wheelM, c.wheel || 0);
            r.draw(mdl.wheelMesh, wheelM, null, 1, 0.15);
        }
    }
    function drawCarGlass(r, c) {
        var mdl = carModels[c.type];
        if (!mdl) return;
        carMatrix(carBase, c);
        r.draw(mdl.glassMesh, carBase, null, 0.5, 0.9);
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

    function buildAssets() {
        var ch = Models.buildCharacter();
        charModel = { dims: ch.dims, meshes: {} };
        for (var k in ch.parts) charModel.meshes[k] = R.mesh(ch.parts[k]);
        CAR_TYPES.forEach(function (t) {
            var c = Models.buildCar(t);
            carModels[t] = {
                opaqueMesh: R.mesh(c.opaque), glassMesh: R.mesh(c.glass), wheelMesh: R.mesh(c.wheel),
                wheelPos: c.wheelPos, seat: c.seat, height: c.height, len: c.len, wid: c.wid
            };
        });
        if (terrain.length === 0) {
            terrain = Models.buildTerrain(World, TIER_CFG.cell, 32);
            propsGeo = Models.buildProps(World);
            decalsGeo = Models.buildDecals(World);
            discGeo = buildDisc();
        }
        terrain.forEach(function (c) { c.mesh = R.mesh(c.geo); });
        R.propsMesh = R.mesh(propsGeo);
        R.decalsMesh = R.mesh(decalsGeo);
        R.discMesh = R.mesh(discGeo);
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
        return { id: e.id, cid: e.cid, type: e.type, snaps: [], x: e.x, y: e.y, z: e.z, ry: e.ry, pitch: 0, roll: 0, speed: 0, steer: 0, wheel: 0 };
    }
    function carSnap(rc, x, y, z, ry, speed, steer, first) {
        var s = { x: x, y: y, z: z, ry: ry, speed: speed || 0, steer: steer || 0, a: 0, d: 0 };
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
                if (pendingSpawn) continue;                              // ще чекаємо відповідь на мій spawn
                if (!myCar || myCar.cid !== e.cid) {
                    // Сервер тримає іншу мою машину (повторне підключення, інший пристрій): беремо її
                    var wasDriving = driving;
                    myCar = Phys.createCar(e.type, +e.x, +e.z, +e.ry);
                    myCar.cid = e.cid;
                    if (wasDriving) setDriving(false, true);
                }
                continue;
            }
            seen[e.id] = true;
            var rc = remoteCars[e.id];
            if (!rc || rc.cid !== e.cid || rc.type !== e.type) {
                rc = remoteCars[e.id] = newRemoteCar(e);
                carSnap(rc, +e.x, +e.y, +e.z, +e.ry, 0, 0, true);
            }
        }
        for (var id in remoteCars) if (!seen[id]) delete remoteCars[id];
        if (myCar && !seen.me && !pendingSpawn) removeMyCarLocal();      // сервер прибрав мою машину
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
            otherCars.push({ x: rc.x, y: rc.y, z: rc.z, ry: rc.ry, type: rc.type, speed: rc.speed || 0 });
        }
        return otherCars;
    }

    function stepLocal(dt) {
        var k = input.keys;
        collectOtherCars();
        if (driving && myCar) {
            var th = (input.gas || k.ArrowUp || k.KeyW ? 1 : 0) - (input.rev || k.ArrowDown || k.KeyS ? 1 : 0);
            var st = (input.right || k.ArrowRight || k.KeyD ? 1 : 0) - (input.left || k.ArrowLeft || k.KeyA ? 1 : 0);
            Phys.stepMany(dt, function (h) { Phys.stepCar(myCar, { throttle: th, steer: st }, h, otherCars); });
            walker.x = myCar.x; walker.y = myCar.y; walker.z = myCar.z; walker.ry = myCar.ry;
            walker.a = 0; walker.speed = 0;
            return;
        }
        var dir = currentMoveDir();
        var jump = input.jump || k.Space;
        Phys.stepMany(dt, function (h) {
            Phys.stepWalker(walker, { mx: dir.mx * dir.mag, mz: dir.mz * dir.mag, jump: jump }, h);
        });
        // Припаркована машина докочується до зупинки
        if (myCar && (Math.abs(myCar.speed) > 0.05 || myCar.air)) {
            Phys.stepMany(dt, function (h) { Phys.stepCar(myCar, { throttle: 0, steer: 0 }, h, otherCars); });
        }
    }

    function sendState(dt) {
        sendTimer += dt * 1000;
        sinceBeat += dt * 1000;
        sinceCarBeat += dt * 1000;
        if (sendTimer < SEND_EVERY_MS) return;
        sendTimer = 0;
        var r2 = function (v) { return Math.round(v * 100) / 100; };
        var o = { x: r2(walker.x), y: r2(walker.y), z: r2(walker.z), ry: r2(walker.ry), a: driving ? 0 : walker.a, d: driving ? 1 : 0 };
        var key = o.x + ',' + o.y + ',' + o.z + ',' + o.ry + ',' + o.a + ',' + o.d;
        var changed = key !== lastSent;
        var withCar = false;
        if (myCar && !pendingSpawn) {
            var c = { t: myCar.type, x: r2(myCar.x), y: r2(myCar.y), z: r2(myCar.z), ry: r2(myCar.ry), s: r2(myCar.speed), st: r2(myCar.steer) };
            var ck = c.x + ',' + c.y + ',' + c.z + ',' + c.ry + ',' + c.s + ',' + c.st;
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
    var snapOut = { x: 0, y: 0, z: 0, ry: 0, a: 0, d: 0, speed: 0, steer: 0 };

    function updateRemotes(dt) {
        var rt = nowMs() / 1000 - INTERP_DELAY;
        var id;
        for (id in remoteCars) {
            var rc = remoteCars[id];
            if (!sampleSnaps(rc.snaps, rt, snapOut, true)) continue;
            var def = Phys.CARS[rc.type];
            var g = Phys.groundSample(def, { x: snapOut.x, z: snapOut.z, ry: snapOut.ry });
            rc.x = snapOut.x; rc.z = snapOut.z; rc.ry = snapOut.ry; rc.y = Math.max(snapOut.y, g.y - 0.5);
            rc.pitch = g.pitch; rc.roll = g.roll; rc.speed = snapOut.speed; rc.steer = snapOut.steer;
            rc.wheel += (rc.speed * dt) / def.wheelR;
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
        // Рельєф: показуємо лише шматки, що можуть бути перед камерою
        var fx = camTarget.x - eye.x, fy = camTarget.y - eye.y, fz = camTarget.z - eye.z;
        var fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
        fx /= fl; fz /= fl;
        var maxD = TIER_CFG.fogFar + 120;
        for (i = 0; i < terrain.length; i++) {
            c = terrain[i];
            var dx = c.cx - eye.x, dz = c.cz - eye.z;
            var d = Math.sqrt(dx * dx + dz * dz);
            if (d > maxD + c.radius) continue;
            if (d > c.radius && (dx * fx + dz * fz) / d < -0.35 - c.radius / d) continue;
            R.checker(true);
            R.draw(c.mesh, M.ident(stk), null, 1, 0);
        }
        R.checker(false);
        R.offset(true);
        R.draw(R.decalsMesh, M.ident(stk), null, 1, 0);
        R.offset(false);
        if (propsGeo && propsGeo.idx.length > 0) R.draw(R.propsMesh, M.ident(stk), null, 1, 0);

        // Машини й персонажі
        var hideMe = !driving && eye.dist < 1.8;
        var id;
        if (myCar) drawCarOpaque(R, myCar);
        for (id in remoteCars) drawCarOpaque(R, remoteCars[id]);
        if (driving && myCar) { if (eye.dist > 2.2) drawSeated(R, myCar, myPose); }
        else if (!hideMe) {
            M.ident(stk); M.translate(stk, walker.x, walker.y, walker.z); M.rotateY(stk, walker.ry);
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

    // ---------------------------------------------------------------- спідометр
    // Показує справжню швидкість моєї машини: студи/с -> км/год (Phys.kmh), стрілка до 200 км/год, передача D1..Dn / N / R.
    var SPEEDO_MAX = 200;
    var SPEEDO_ARC = 367.57;                  // довжина дуги 270° для r = 78
    var speedoEls = null, speedoLast = { kmh: -1, gear: -99, lang: '' };
    function updateSpeedo() {
        if (!speedoEls) {
            speedoEls = { num: $('spdNum'), bar: $('spdBar'), gear: $('spdGear'), unit: $('spdUnit'), box: $('speedo') };
        }
        var v = driving && myCar ? Phys.kmh(myCar.speed) : 0;
        var gear = driving && myCar ? Phys.gearOf(myCar.type, myCar.speed) : 0;
        var lang = I18.lang;
        if (v === speedoLast.kmh && gear === speedoLast.gear && lang === speedoLast.lang) return;
        speedoLast.kmh = v; speedoLast.gear = gear; speedoLast.lang = lang;
        var p = clamp(v / SPEEDO_MAX, 0, 1);
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
    function openPanel() {
        if (driving) return;
        if (!previews) makePreviews();
        if (!selectedType) selectedType = myCar ? myCar.type : CAR_TYPES[0];
        renderCarsPanel();
        $('carsPanel').classList.remove('hidden');
        releaseAll();
    }
    function closePanel() { $('carsPanel').classList.add('hidden'); }
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
        input.sx = 0; input.sy = 0; input.jump = false; input.keys = {};
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
    ['carsPanel', 'carsBtn', 'carAct', 'speedo'].forEach(function (id) {
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

    window.addEventListener('keydown', function (e) { input.keys[e.code] = true; });
    window.addEventListener('keyup', function (e) { input.keys[e.code] = false; });
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
                carSnap(rc, +t[2], +t[3], +t[4], +t[5], +t[6], +t[7], false);
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
                if (myCar) myCar.cid = res.cid;
                lastCarSent = '';
            } else {
                nlog('сервер не створив машину: ' + (res && res.code));
                removeMyCarLocal();
                toast(I18.t(res && res.code === 'rate' ? 'car_wait' : 'car_failed'));
            }
        }
    };

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
            resize();
            tagsCtx = tagsCanvas.getContext('2d');
            R = createRenderer(canvas, { aa: TIER_CFG.aa, fogNear: 150, fogFar: TIER_CFG.fogFar });
            buildAssets();
        } catch (e) {
            nfail('webgl', e && e.message ? e.message : String(e));
            return;
        }
        canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); started = false; nlog('WebGL-контекст втрачено'); }, false);
        canvas.addEventListener('webglcontextrestored', function () {
            try { R = createRenderer(canvas, { aa: TIER_CFG.aa, fogNear: 150, fogFar: TIER_CFG.fogFar }); buildAssets(); started = !!walker; nlog('WebGL-контекст відновлено'); }
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
