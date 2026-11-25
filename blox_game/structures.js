// =====================================================================
// KishkaBlox — 3D-геометрія споруд: коробка на вершині гірки (двері, код-панель, камера з бомбою й червоною кнопкою),
// бункер, сирени й місто. Лише побудова сіток (без WebGL), тому працює і в грі, і в тестах Node.
// Координати й розміри беруться з world.js (SUMMIT, BUNKER, SIRENS, CITY) — тож вигляд завжди збігається з твердими тілами для фізики.
//
// Формат сітки — той самий, що в models.js: { pos:[], nrm:[], col:[], idx:[] }. Одна сітка — не більше 65000 вершин.
// =====================================================================
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./world.js'), require('./models.js'));
    else root.KishkaStructures = factory(root.KishkaWorld, root.KishkaModels);
})(typeof self !== 'undefined' ? self : this, function (World, Models) {
    'use strict';

    var newGeo = Models.newGeo, boxG = Models.box, cylG = Models.cylinder, latheG = Models.lathe, appendGeo = Models.appendGeo;

    // Палітра: бетон коробки той самий, що й верх гірки (RAMP_TOP у models.js)
    var CONC = [0.64, 0.65, 0.69], CONC_D = [0.5, 0.51, 0.56], CONC_DD = [0.36, 0.37, 0.42];
    var METAL = [0.56, 0.59, 0.65], METAL_D = [0.3, 0.32, 0.37], METAL_L = [0.74, 0.77, 0.82];
    var YELLOW = [0.96, 0.78, 0.1], BLACK = [0.07, 0.07, 0.09], RED = [0.92, 0.08, 0.08], RED_D = [0.5, 0.04, 0.05];
    var LAMP = [1.0, 0.96, 0.78], GREEN = [0.1, 0.8, 0.3], DISPLAY = [0.1, 0.32, 0.18];
    var OLIVE = [0.47, 0.52, 0.25], OLIVE_D = [0.33, 0.38, 0.17], BRASS = [0.74, 0.52, 0.14];

    // Коробка за межами: x0..x1, y0..y1, z0..z1
    function B(g, x0, x1, y0, y1, z0, z1, color) {
        boxG(g, { c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], s: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2], color: color });
    }

    // Пікселі цифр 3×5 і значків 5×5 для кнопок код-панелі
    var FONT = {
        '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'], '2': ['111', '001', '111', '100', '111'],
        '3': ['111', '001', '111', '001', '111'], '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
        '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '001', '001', '001'], '8': ['111', '101', '111', '101', '111'],
        '9': ['111', '101', '111', '001', '111'],
        'x': ['10001', '01010', '00100', '01010', '10001'], 'v': ['00001', '00011', '10110', '01100', '00100']
    };

    // =================================================================
    // КОРОБКА НА ВЕРХУ ГІРКИ
    // Повертає: shell (нерухоме), lidFront / lidBack (стулки даху; початок координат — на шарнірі), door (у закритому положенні; під час
    // відчинення зсувається вгору на door.h), bomb (початок — низ бомби), button (червона кнопка), keypad (світиться, коли поруч).
    // =================================================================
    function buildSummit() {
        var S = World.SUMMIT, top = S.top, c = S.ch, d = S.door, x0 = S.x0;
        var shell = newGeo(), i;

        // 1) корпус: ті самі тверді коробки, що й у фізиці (без дверей і даху камери)
        for (i = 0; i < S.list.length; i++) {
            var b = S.list[i];
            if (b === S.doorSolid || b === S.lidSolid || b === S.bombSolid || b === S.buttonSolid) continue;     // їх малюють окремо (двері, стулки даху, бомба, кнопка)
            B(shell, b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, CONC);
        }
        // карниз і рамка навколо дверей (жовто-чорні смуги знизу)
        B(shell, x0 - 0.5, x0 + 0.1, top + d.h, top + d.h + 1.2, -d.hz - 1.2, d.hz + 1.2, CONC_D);
        B(shell, x0 - 0.5, x0 + 0.1, top, top + d.h, -d.hz - 1.2, -d.hz, CONC_D);
        B(shell, x0 - 0.5, x0 + 0.1, top, top + d.h, d.hz, d.hz + 1.2, CONC_D);
        for (i = 0; i < 12; i++) {
            var zz = -d.hz - 1.2 + i * ((2 * d.hz + 2.4) / 12);
            B(shell, x0 - 0.7, x0 - 0.1, top + d.h + 0.2, top + d.h + 1.0, zz, zz + (2 * d.hz + 2.4) / 24, i % 2 ? BLACK : YELLOW);
        }
        // лампа над дверима (червона: двері зачинені)
        B(shell, x0 - 0.9, x0 - 0.1, top + d.h + 2.2, top + d.h + 3.4, -1.0, 1.0, RED_D);
        B(shell, x0 - 1.0, x0 - 0.8, top + d.h + 2.4, top + d.h + 3.2, -0.7, 0.7, RED);
        // напис-табличка (смуга) над дверима
        B(shell, x0 - 0.35, x0 + 0.05, top + d.h + 5.0, top + d.h + 7.4, -12, 12, CONC_DD);
        for (i = 0; i < 6; i++) B(shell, x0 - 0.45, x0 - 0.3, top + d.h + 5.4, top + d.h + 7.0, -11 + i * 3.7, -11 + i * 3.7 + 1.8, YELLOW);
        // ребра жорсткості на торці, щоб величезна стіна не була пласкою
        for (i = -3; i <= 3; i++) if (Math.abs(i) * 14 > d.hz + 4) B(shell, x0 - 0.25, x0, top, top + S.h, i * 14 - 0.5, i * 14 + 0.5, CONC_D);
        // дах: рамка по краю камери і поручні по периметру верху коробки
        B(shell, x0, S.x1, top + S.h, top + S.h + 1.4, -S.hw, -S.hw + 0.8, CONC_D);
        B(shell, x0, S.x1, top + S.h, top + S.h + 1.4, S.hw - 0.8, S.hw, CONC_D);
        B(shell, S.x1 - 0.8, S.x1, top + S.h, top + S.h + 1.4, -S.hw, S.hw, CONC_D);
        B(shell, x0, x0 + 0.8, top + S.h, top + S.h + 1.4, -S.hw, S.hw, CONC_D);

        // 2) код-панель праворуч від дверей (+Z), на лицьовій стіні
        var kp = S.keypad, px = x0 - 0.05;
        B(shell, px - 0.7, px, kp.y - 5.2, kp.y + 5.2, kp.z - 4.2, kp.z + 4.2, METAL_D);            // корпус панелі
        B(shell, px - 0.8, px - 0.65, kp.y - 4.9, kp.y + 4.9, kp.z - 3.9, kp.z + 3.9, BLACK);
        B(shell, px - 0.95, px - 0.8, kp.y + 3.35, kp.y + 4.55, kp.z - 3.4, kp.z + 3.4, DISPLAY);   // екранчик
        var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'x', '0', 'v'];
        var pitch = 2.0, ks = 1.55, ps = 0.2;
        for (i = 0; i < 12; i++) {
            var col = i % 3, row = Math.floor(i / 3);
            var kz = kp.z + (col - 1) * pitch, ky = kp.y + 1.6 - row * 2.0 - 0.9;
            var kc = keys[i] === 'x' ? RED_D : (keys[i] === 'v' ? [0.08, 0.5, 0.2] : [0.62, 0.64, 0.7]);
            B(shell, px - 1.25, px - 0.8, ky - ks / 2, ky + ks / 2, kz - ks / 2, kz + ks / 2, kc);
            var glyph = FONT[keys[i]], gw = glyph[0].length;
            var glyphCol = (keys[i] === 'x' || keys[i] === 'v') ? [1, 1, 1] : [0.08, 0.08, 0.1];
            for (var gy = 0; gy < glyph.length; gy++) for (var gx = 0; gx < gw; gx++) {
                if (glyph[gy].charAt(gx) !== '1') continue;
                var gz = kz + (gx - (gw - 1) / 2) * ps, gyy = ky + (2 - gy) * ps;
                B(shell, px - 1.4, px - 1.25, gyy - ps / 2, gyy + ps / 2, gz - ps / 2, gz + ps / 2, glyphCol);
            }
        }

        // 3) усередині камери: підлога, лінії, лампи на стелі, постамент бомби, постамент кнопки
        B(shell, c.x0, c.x1, top, top + 0.25, -c.hz, c.hz, CONC_DD);
        for (i = 0; i < 6; i++) B(shell, c.x0 + 1 + i * 6, c.x0 + 4 + i * 6, top + 0.26, top + 0.3, -c.hz, c.hz, i % 2 ? BLACK : YELLOW);       // смуги на підлозі
        B(shell, c.x0, c.x1, top + c.h - 0.4, top + c.h, -c.hz, c.hz, CONC_D);                                                                  // стеля камери (під дахом)
        for (i = 0; i < 4; i++) B(shell, c.x0 + 4 + i * 9, c.x0 + 7 + i * 9, top + c.h - 0.6, top + c.h - 0.4, -8, 8, LAMP);                   // лампи
        var bb = S.bomb;
        cylG(shell, { c: [bb.x, top + 0.8, bb.z], r: 7.4, r2: 6.6, h: 1.1, color: METAL_D, seg: 24 });                                           // постамент бомби
        cylG(shell, { c: [bb.x, top + 1.5, bb.z], r: 6.2, h: 0.3, color: YELLOW, seg: 24 });
        var bt = S.button;
        cylG(shell, { c: [bt.x, top + bt.h / 2, bt.z], r: 2.6, r2: 2.2, h: bt.h, color: METAL, seg: 16 });                                       // постамент кнопки
        cylG(shell, { c: [bt.x, top + bt.h + 0.15, bt.z], r: 2.3, h: 0.3, color: YELLOW, seg: 16 });
        // попереджувальна смуга на торцях колони перед кнопкою
        B(shell, bt.x - 3, bt.x + 3, top + 0.26, top + 0.32, -3.4, 3.4, YELLOW);

        // 4) стулки даху: початок координат на шарнірі (на верхньому краї камери), вздовж X: передня тягнеться на +X, задня — на -X
        function lid(sign) {
            var g = newGeo(), len = (c.x1 - c.x0) / 2, y0 = -(S.h - c.h) , y1 = 0;       // шарнір на рівні верху коробки
            var xa = sign > 0 ? 0 : -len, xb = sign > 0 ? len : 0;
            B(g, xa, xb, y0, y1, -c.hz - 0.4, c.hz + 0.4, CONC);
            B(g, xa, xb, y1 - 0.01, y1 + 0.5, -c.hz - 0.4, -c.hz + 0.8, CONC_D);
            B(g, xa, xb, y1 - 0.01, y1 + 0.5, c.hz - 0.8, c.hz + 0.4, CONC_D);
            B(g, xa, xb, y0 - 0.3, y0, -c.hz + 1, c.hz - 1, METAL_D);                      // нижня сторона стулки
            return g;
        }
        var lidFront = lid(1), lidBack = lid(-1);

        // 5) двері (закрите положення). Металеві, з ребрами; у відчиненому положенні заховані в перемичку
        var door = newGeo();
        B(door, d.x0, d.x1, top, top + d.h, -d.hz, d.hz, METAL);
        for (i = 0; i < 5; i++) B(door, d.x0 - 0.18, d.x0, top + 1.0 + i * 2.9, top + 1.7 + i * 2.9, -d.hz + 0.5, d.hz - 0.5, METAL_L);
        B(door, d.x0 - 0.2, d.x0, top, top + 0.9, -d.hz, d.hz, BLACK);
        for (i = 0; i < 10; i++) B(door, d.x0 - 0.22, d.x0 - 0.0, top + 0.05, top + 0.85, -d.hz + i * 1.4, -d.hz + i * 1.4 + 0.7, YELLOW);
        B(door, d.x0 - 0.3, d.x0, top + 6.5, top + 8.0, -1.2, 1.2, METAL_D);               // замок
        B(door, d.x0 - 0.4, d.x0 - 0.3, top + 6.9, top + 7.6, -0.5, 0.5, RED);

        // 6) червона кнопка (куполом над постаментом)
        var button = newGeo();
        cylG(button, { c: [0, 0.35, 0], r: 1.7, r2: 1.35, h: 0.7, color: RED, seg: 18 });
        cylG(button, { c: [0, 0.8, 0], r: 1.35, r2: 0.9, h: 0.3, color: [1, 0.35, 0.3], seg: 18 });

        // 7) бомба: початок координат у центрі низу, вісь вгору (довжина 22)
        var bomb = buildBomb();
        return { shell: shell, lidFront: lidFront, lidBack: lidBack, door: door, button: button, bomb: bomb, buttonPos: [bt.x, top + bt.h + 0.15, bt.z] };
    }

    // Бомба в стилі «Fat Man» зі зображення: оливкове яйце, світліші пояси зі скобами, коробчатий хвіст латунного кольору
    function buildBomb() {
        var g = newGeo(), i;
        // тіло: профіль (радіус, висота) від хвоста до носа
        var prof = [[0, 6.0], [1.7, 6.2], [3.2, 7.0], [4.3, 8.5], [4.9, 10.5], [5.0, 13.0], [4.85, 15.4], [4.3, 17.8], [3.3, 19.7], [1.9, 21.2], [0, 22.0]];
        latheG(g, { profile: prof, seg: 24, color: OLIVE, grad: [OLIVE_D, OLIVE] });
        // пояси (кільця) і скоби по колу
        [10.6, 13.0, 16.6].forEach(function (yy, k) {
            var r = k === 1 ? 5.1 : (k === 0 ? 4.95 : 4.45);
            cylG(g, { c: [0, yy, 0], r: r + 0.12, h: 0.45, color: [0.5, 0.55, 0.28], seg: 24 });
        });
        for (i = 0; i < 6; i++) {
            var a = i * Math.PI / 3;
            B(g, Math.cos(a) * 5.0 - 0.3, Math.cos(a) * 5.0 + 0.3, 12.2, 14.2, Math.sin(a) * 5.0 - 0.3, Math.sin(a) * 5.0 + 0.3, [0.55, 0.6, 0.3]);
        }
        // носик
        cylG(g, { c: [0, 21.2, 0], r: 1.3, r2: 0.7, h: 1.2, color: [0.2, 0.23, 0.1], seg: 12 });
        // хвіст: коробка зі стінок (4 пластини) + внутрішній конус і стабілізатор
        var Wd = 4.6, Hh = 6.0;
        B(g, -Wd, Wd, 0, Hh, Wd - 0.3, Wd, BRASS); B(g, -Wd, Wd, 0, Hh, -Wd, -Wd + 0.3, BRASS);
        B(g, Wd - 0.3, Wd, 0, Hh, -Wd, Wd, BRASS); B(g, -Wd, -Wd + 0.3, 0, Hh, -Wd, Wd, BRASS);
        B(g, -Wd, Wd, Hh - 0.4, Hh, -Wd, Wd, [0.5, 0.36, 0.1]);                                // верхня рамка
        cylG(g, { c: [0, 3.0, 0], r: 2.6, r2: 1.4, h: 6.0, color: [0.28, 0.3, 0.16], seg: 14 });  // конус двигуна
        B(g, -Wd + 0.3, Wd - 0.3, 2.5, 3.0, -0.25, 0.25, [0.6, 0.43, 0.12]);                       // внутрішні перегородки
        B(g, -0.25, 0.25, 2.5, 3.0, -Wd + 0.3, Wd - 0.3, [0.6, 0.43, 0.12]);
        return g;
    }

    // =================================================================
    // БУНКЕР
    // =================================================================
    function buildBunker() {
        var Bk = World.BUNKER, shell = newGeo(), i;
        for (i = 0; i < Bk.list.length; i++) {
            var b = Bk.list[i];
            if (b === Bk.doorSolid) continue;
            B(shell, b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, CONC_D);
        }
        var xf = Bk.x1, dh = Bk.doorH, dz = Bk.doorHz, inn = Bk.inner;
        // рамка входу: жовто-чорні смуги й великий знак
        B(shell, xf - 0.1, xf + 0.6, 0, dh, -dz - 1.4, -dz, YELLOW);
        B(shell, xf - 0.1, xf + 0.6, 0, dh, dz, dz + 1.4, YELLOW);
        for (i = 0; i < 10; i++) B(shell, xf - 0.1, xf + 0.7, 0.5 + i * 1.45, 1.4 + i * 1.45, -dz - 1.4, -dz, BLACK);
        for (i = 0; i < 10; i++) B(shell, xf - 0.1, xf + 0.7, 0.5 + i * 1.45, 1.4 + i * 1.45, dz, dz + 1.4, BLACK);
        B(shell, xf - 0.1, xf + 0.6, dh, dh + 1.6, -dz - 1.4, dz + 1.4, YELLOW);
        for (i = 0; i < 16; i++) B(shell, xf - 0.1, xf + 0.7, dh + 0.1, dh + 1.5, -dz - 1.4 + i * (2 * dz + 2.8) / 16, -dz - 1.4 + i * (2 * dz + 2.8) / 16 + (2 * dz + 2.8) / 32, BLACK);
        // табличка «стрілка» над входом — зелена
        B(shell, xf - 0.1, xf + 0.5, dh + 3.2, dh + 8.6, -9, 9, [0.05, 0.4, 0.2]);
        B(shell, xf + 0.4, xf + 0.6, dh + 4.4, dh + 7.4, -1.2, 7.2, [0.9, 0.95, 0.9]);          // стрілка вхід
        B(shell, xf + 0.4, xf + 0.6, dh + 3.8, dh + 8.0, 5.2, 6.4, [0.9, 0.95, 0.9]);
        // земляний насип навколо (щоб бункер виглядав вкопаним): схил на даху
        B(shell, Bk.x0 + 2, xf - 8, Bk.h, Bk.h + 3.0, -Bk.hw + 3, Bk.hw - 3, [0.42, 0.4, 0.34]);
        // усередині: підлога, лампи, колони
        B(shell, inn.x0, inn.x1, 0, 0.25, -inn.hz, inn.hz, CONC_DD);
        for (i = 0; i < 7; i++) B(shell, inn.x1 - 8 - i * 14, inn.x1 - 5 - i * 14, inn.h - 0.5, inn.h, -6, 6, LAMP);
        for (i = 0; i < 6; i++) {
            B(shell, inn.x1 - 12 - i * 14, inn.x1 - 10 - i * 14, 0, inn.h, -inn.hz, -inn.hz + 1.6, CONC_D);
            B(shell, inn.x1 - 12 - i * 14, inn.x1 - 10 - i * 14, 0, inn.h, inn.hz - 1.6, inn.hz, CONC_D);
        }
        for (i = 0; i < 8; i++) B(shell, inn.x0 + 4, inn.x0 + 5, 0.26, 0.3, -inn.hz + i * 7.5, -inn.hz + i * 7.5 + 3, i % 2 ? BLACK : YELLOW);
        // двері: стулка, що їде вниз із перемички
        var door = newGeo(), x0 = Bk.x1 - Bk.wall + 0.8, x1 = Bk.x1 - 0.8;
        B(door, x0, x1, dh, 2 * dh, -dz, dz, METAL);
        for (i = 0; i < 5; i++) B(door, x1, x1 + 0.2, dh + 1 + i * 2.8, dh + 1.8 + i * 2.8, -dz + 0.6, dz - 0.6, METAL_L);
        for (i = 0; i < 16; i++) B(door, x1, x1 + 0.22, 2 * dh - 1.2, 2 * dh - 0.2, -dz + i * 1.9, -dz + i * 1.9 + 0.95, i % 2 ? BLACK : YELLOW);
        return { shell: shell, door: door };
    }

    // =================================================================
    // СИРЕНА: стовп із чотирма рупорами (початок координат — підніжжя). Згорілу малюють у нахиленому положенні.
    // =================================================================
    function buildSiren() {
        var g = newGeo(), h = World.SIRENS.length ? World.SIRENS[0].h : 24, i;
        cylG(g, { c: [0, 0.6, 0], r: 1.6, h: 1.2, color: METAL_D, seg: 12 });
        cylG(g, { c: [0, h / 2, 0], r: 0.55, r2: 0.45, h: h, color: [0.62, 0.64, 0.7], seg: 10 });
        cylG(g, { c: [0, h * 0.2, 0], r: 0.7, h: 1.4, color: RED, seg: 10 });
        cylG(g, { c: [0, h + 0.3, 0], r: 1.2, h: 1.2, color: METAL_D, seg: 12 });
        for (i = 0; i < 4; i++) {
            var a = i * Math.PI / 2 + Math.PI / 4;
            var o = { c: [Math.cos(a) * 3.0, h + 0.4, Math.sin(a) * 3.0], r: 1.1, r2: 2.6, h: 4.6, color: [0.85, 0.86, 0.9], seg: 12, rot: [0, 0, 0] };
            // рупор лежить горизонтально й дивиться назовні
            o.rot = [Math.PI / 2 * Math.sin(a), 0, -Math.PI / 2 * Math.cos(a)];
            cylG(g, o);
            B(g, Math.cos(a) * 1.2 - 0.25, Math.cos(a) * 1.2 + 0.25, h - 0.2, h + 1.0, Math.sin(a) * 1.2 - 0.25, Math.sin(a) * 1.2 + 0.25, METAL_D);
        }
        return g;
    }

    // =================================================================
    // МІСТО. facade — стіни (на них шейдер малює вікна); detail — дахи, стелі вестибюлів, лампи, вивіски, антени.
    // =================================================================
    var HOUSE_COL = [[0.86, 0.74, 0.55], [0.78, 0.45, 0.36], [0.82, 0.82, 0.76], [0.6, 0.66, 0.52]];
    var MID_COL = [[0.55, 0.6, 0.68], [0.68, 0.64, 0.58], [0.5, 0.56, 0.52], [0.7, 0.7, 0.74]];
    var TOWER_COL = [[0.26, 0.4, 0.55], [0.3, 0.46, 0.5], [0.34, 0.36, 0.42], [0.22, 0.3, 0.42]];

    function buildCity() {
        var C = World.CITY, facade = newGeo(), detail = newGeo(), bi, i;
        for (bi = 0; bi < C.buildings.length; bi++) {
            var b = C.buildings[bi];
            var pal = b.kind === 'house' ? HOUSE_COL : (b.kind === 'mid' ? MID_COL : TOWER_COL);
            var col = pal[Math.min(pal.length - 1, Math.floor(b.tone * pal.length))];
            for (i = 0; i < b.list.length; i++) {
                var s = b.list[i];
                B(facade, s.x0, s.x1, s.y0, s.y1, s.z0, s.z1, col);
            }
            // дах: парапет по периметру, технічні надбудови, антена на висотці
            var t = b.h, w = C.wall;
            B(detail, b.x0, b.x1, t, t + 1.4, b.z0, b.z0 + 1.2, CONC_D); B(detail, b.x0, b.x1, t, t + 1.4, b.z1 - 1.2, b.z1, CONC_D);
            B(detail, b.x0, b.x0 + 1.2, t, t + 1.4, b.z0, b.z1, CONC_D); B(detail, b.x1 - 1.2, b.x1, t, t + 1.4, b.z0, b.z1, CONC_D);
            B(detail, b.cx - 12, b.cx + 12, t, t + 7, b.cz - 10, b.cz + 10, METAL_D);
            B(detail, b.cx + 20, b.cx + 34, t, t + 4, b.cz + 14, b.cz + 28, CONC_D);
            if (b.kind === 'tower') {
                cylG(detail, { c: [b.cx - 30, t + 22, b.cz - 30], r: 0.7, r2: 0.3, h: 44, color: METAL_L, seg: 6 });
                B(detail, b.cx - 31, b.cx - 29, t + 43, t + 45, b.cz - 31, b.cz - 29, RED);
            }
            // вестибюль: підлога, лампи на стелі, смуга над входом
            B(detail, b.x0 + w, b.x1 - w, 0.02, 0.3, b.z0 + w, b.z1 - w, [0.55, 0.52, 0.5]);
            for (var li = 0; li < 3; li++) for (var lj = 0; lj < 3; lj++) {
                var lx = b.x0 + w + (b.x1 - b.x0 - 2 * w) * (0.2 + 0.3 * li), lz = b.z0 + w + (b.z1 - b.z0 - 2 * w) * (0.2 + 0.3 * lj);
                B(detail, lx - 4, lx + 4, C.lobby - 0.4, C.lobby - 0.1, lz - 4, lz + 4, LAMP);
            }
            // вивіска над дверима (з боку входу)
            var sx0, sx1, sz0, sz1;
            if (b.side === 0) { sx0 = b.x0 - 0.8; sx1 = b.x0; sz0 = b.cz - 9; sz1 = b.cz + 9; }
            else if (b.side === 1) { sx0 = b.x1; sx1 = b.x1 + 0.8; sz0 = b.cz - 9; sz1 = b.cz + 9; }
            else if (b.side === 2) { sx0 = b.cx - 9; sx1 = b.cx + 9; sz0 = b.z0 - 0.8; sz1 = b.z0; }
            else { sx0 = b.cx - 9; sx1 = b.cx + 9; sz0 = b.z1; sz1 = b.z1 + 0.8; }
            B(detail, sx0, sx1, C.doorH + 0.8, C.doorH + 3.4, sz0, sz1, b.kind === 'house' ? [0.7, 0.2, 0.15] : [0.1, 0.35, 0.6]);
        }
        return { facade: facade, detail: detail };
    }

    return { buildSummit: buildSummit, buildBomb: buildBomb, buildBunker: buildBunker, buildSiren: buildSiren, buildCity: buildCity };
});
