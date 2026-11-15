// Перевірки клієнтської частини KishkaBlox (камера, світ, фізика, моделі, переклади, маніфест оновлення): node --test
// Це перевірки логіки в Node; вони НЕ замінюють перевірку на реальному телефоні/планшеті.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const GAME_DIR = path.join(__dirname, '..', 'blox_game');
const World = require('../blox_game/world.js');
const Phys = require('../blox_game/physics.js');
const Cam = require('../blox_game/camera.js');
const Models = require('../blox_game/models.js');
const I18 = require('../blox_game/i18n.js');
const { createBloxFiles } = require('../kishkablox.js');
const { CAR_TYPES } = require('../blox_game_server.js');

// ------------------------------------------------------------------ камера
test('камера: палець угору — камера піднімається, палець униз — опускається', () => {
    const cam = Cam.create({ pitch: 0.4 });
    const target = { x: 0, y: 3, z: 0 };
    const flat = () => 0;
    const eyeY = () => Cam.eye(Object.assign({}, cam, { eyeDist: cam.dist }), target, flat).y;
    const y0 = eyeY();
    Cam.drag(cam, 0, -60);                                  // палець угору (dy < 0)
    assert.ok(cam.pitch > 0.4, 'pitch зріс');
    const yUp = eyeY();
    assert.ok(yUp > y0, 'камера піднялась');
    Cam.drag(cam, 0, 160);                                  // палець униз (dy > 0)
    assert.ok(eyeY() < yUp, 'камера опустилась');
});

test('камера: інверсія міняє лише вертикаль і вимкнена за замовчуванням', () => {
    assert.strictEqual(Cam.create().invert, false);
    const a = Cam.create({ pitch: 0.4, invert: true });
    Cam.drag(a, 0, -60);
    assert.ok(a.pitch < 0.4, 'з інверсією палець угору опускає камеру');
    const b = Cam.create({ yaw: 0 }), c = Cam.create({ yaw: 0, invert: true });
    Cam.drag(b, 50, 0); Cam.drag(c, 50, 0);
    assert.strictEqual(b.yaw, c.yaw, 'горизонталь не залежить від інверсії');
});

test('камера: горизонталь — палець праворуч повертає камеру праворуч', () => {
    const cam = Cam.create({ yaw: 0 });
    Cam.drag(cam, 100, 0);
    assert.ok(cam.yaw < 0);
    Cam.drag(cam, -200, 0);
    assert.ok(cam.yaw > 0);
});

test('камера: межі кута, стрибки пальця, масштаб і ніколи не під землею', () => {
    const cam = Cam.create({ pitch: 0 });
    for (let i = 0; i < 100; i++) Cam.drag(cam, 0, 200);        // палець униз — камера опускається до межі
    assert.strictEqual(cam.pitch, Cam.LIMITS.pitchMin);
    for (let i = 0; i < 100; i++) Cam.drag(cam, 0, -200);       // палець угору — камера піднімається до межі
    assert.strictEqual(cam.pitch, Cam.LIMITS.pitchMax);
    assert.ok(cam.pitch < Math.PI / 2, 'камера не перевертається');
    const before = cam.pitch;
    Cam.drag(cam, 0, 5000); Cam.drag(cam, NaN, 3); Cam.drag(cam, 0, Infinity);
    assert.strictEqual(cam.pitch, before, 'збій сенсора ігнорується');
    // масштаб двома пальцями: розвели — ближче, звели — далі; межі
    const z = Cam.create({ dist: 14 });
    Cam.pinch(z, 100, 200);
    assert.ok(z.dist < 14);
    for (let i = 0; i < 50; i++) Cam.pinch(z, 100, 400);
    assert.strictEqual(z.dist, Cam.LIMITS.distMin);
    for (let i = 0; i < 80; i++) Cam.pinch(z, 400, 100);
    assert.strictEqual(z.dist, Cam.LIMITS.distMax);
    Cam.pinch(z, 0, 100); Cam.pinch(z, 100, NaN);
    assert.strictEqual(z.dist, Cam.LIMITS.distMax);
    // камера не провалюється під рельєф: перевіряємо в різних місцях карти й під різними кутами
    const out = { x: 0, y: 0, z: 0, dist: 0 };
    for (const [x, z2] of [[0, 0], [100, 0], [140, 10], [200, 30], [-120, 90], [60, 200]]) {
        for (const pitch of [Cam.LIMITS.pitchMin, 0, 0.6, Cam.LIMITS.pitchMax]) {
            const c = Cam.create({ yaw: 1, pitch, dist: 30 });
            const t = { x, y: World.heightAt(x, z2) + 3.2, z: z2 };
            for (let k = 0; k < 6; k++) Cam.eye(c, t, World.heightAt, out);
            assert.ok(out.y >= World.heightAt(out.x, out.z) + Cam.LIMITS.clearance - 1e-6, `камера під землею в ${x},${z2} pitch ${pitch}`);
        }
    }
});

// ------------------------------------------------------------------ світ і фізика
test('персонаж: ходить по пандусу вгору й не виходить за межі світу', () => {
    const w = Phys.createWalker(30, 0);
    for (let t = 0; t < 14; t += 1 / 60) Phys.stepWalker(w, { mx: 1, mz: 0, jump: false }, 1 / 60);
    assert.ok(w.x > 150 && Math.abs(w.y - World.heightAt(w.x, w.z)) < 0.01, 'піднявся на гірку і стоїть на землі');
    const edge = Phys.createWalker(100, 100);
    for (let t = 0; t < 120; t += 1 / 60) Phys.stepWalker(edge, { mx: 1, mz: 1, jump: false }, 1 / 60);
    assert.ok(Math.hypot(edge.x, edge.z) <= World.CFG.limitR + 1e-6, 'межа карти');
});

test('персонаж: стрибок піднімає й повертає на землю; падіння за карту повертає на майданчик', () => {
    const w = Phys.createWalker(0, 0);
    let maxY = w.y;
    Phys.stepWalker(w, { mx: 0, mz: 0, jump: true }, 1 / 60);
    for (let t = 0; t < 2; t += 1 / 60) { Phys.stepWalker(w, { mx: 0, mz: 0, jump: false }, 1 / 60); maxY = Math.max(maxY, w.y); }
    assert.ok(maxY > 4, 'стрибнув');
    assert.ok(w.onGround && Math.abs(w.y - World.heightAt(w.x, w.z)) < 1e-6, 'приземлився');
    w.y = -500;
    Phys.stepWalker(w, { mx: 0, mz: 0, jump: false }, 1 / 60);
    assert.ok(w.y > -10, 'повернуто з прірви');
});

test('нова машина з\'являється перед гравцем і не всередині перешкоди', () => {
    const spot = Phys.spawnSpot(0, 0, 0, 'truck');
    assert.ok(spot.z > 5);
    for (const o of World.obstacles.slice(0, 40)) {   // перешкод на карті немає — цикл порожній, але перевірка лишається для майбутніх карт
        const s = Phys.spawnSpot(o.x - 10, o.z, Math.PI / 2, 'van');
        assert.ok(Math.hypot(s.x - o.x, s.z - o.z) >= o.r + 1, 'машина не всередині перешкоди');
    }
});

test('типи машин збігаються на сервері, у фізиці й у моделях', () => {
    assert.deepStrictEqual(Phys.CAR_TYPES.slice().sort(), CAR_TYPES.slice().sort());
    assert.deepStrictEqual(Models.CAR_TYPES.slice().sort(), CAR_TYPES.slice().sort());
});

// ------------------------------------------------------------------ моделі
test('переклади в грі: однакові ключі й непорожні тексти в uk, ru, en', () => {
    const keys = (l) => Object.keys(I18.DICT[l]).sort();
    assert.deepStrictEqual(keys('ru'), keys('uk'));
    assert.deepStrictEqual(keys('en'), keys('uk'));
    for (const l of ['uk', 'ru', 'en']) for (const k of keys(l)) assert.ok(I18.DICT[l][k].trim().length > 0, l + '.' + k);
    I18.setLang('ru'); assert.strictEqual(I18.t('spawn'), 'Создать');
    I18.setLang('xx'); assert.strictEqual(I18.lang, 'en');
    assert.strictEqual(I18.t('nope'), 'nope');
    I18.setLang('uk');
});

test('переклади в застосунку (Kotlin): нові написи є в uk, ru і en', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app/src/main/java/com/kishka/messenger/Kishkabloxtab.kt'), 'utf8');
    const maps = src.split(/"uk" to mapOf\(|"ru" to mapOf\(|"en" to mapOf\(/).slice(1);
    assert.strictEqual(maps.length, 3);
    const keysOf = (t) => new Set([...t.matchAll(/^\s+"([a-z_]+)" to "/gm)].map((m) => m[1]));
    const [uk, ru, en] = maps.map(keysOf);
    const need = ['menu', 'close', 'players', 'players_count', 'you', 'invert_camera', 'leave', 'update_available', 'update_btn', 'update_hint',
        'update_downloading', 'update_verifying', 'update_installing', 'update_done', 'update_failed', 'update_err_net', 'update_err_server',
        'update_err_manifest', 'update_err_file', 'update_err_hash', 'update_err_disk', 'update_err_busy', 'update_err_unknown', 'retry',
        'err_game_files', 'err_game_join', 'join_not_logged_in', 'join_not_identified', 'join_game_full', 'join_unknown_game', 'join_bad_payload',
        'join_error', 'join_timeout', 'err_server_down', 'err_webgl', 'err_script', 'kicked_other', 'kicked_timeout'];
    for (const k of need) for (const [n, set] of [['uk', uk], ['ru', ru], ['en', en]]) assert.ok(set.has(k), `немає перекладу ${n}.${k}`);
    for (const k of uk) { assert.ok(ru.has(k), 'ru без ' + k); assert.ok(en.has(k), 'en без ' + k); }
});

// ------------------------------------------------------------------ маніфест і оновлення
function tmpGame(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blox-'));
    const gameDir = path.join(root, 'game'), assetsDir = path.join(root, 'assets');
    fs.mkdirSync(gameDir); fs.mkdirSync(assetsDir);
    for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(gameDir, n), c);
    return { root, gameDir, assetsDir };
}
const quietLog = { log() {}, warn() {}, error() {} };
const allFiles = () => Object.fromEntries(createBloxFiles({ gameDir: GAME_DIR, assetsDir: GAME_DIR, logger: quietLog }).required.map((n) => [n, 'x' + n]));

test('маніфест: усі файли гри (світ, фізика, камера, переклади, моделі машин і персонажа) є в списку з sha256', () => {
    const real = createBloxFiles({ gameDir: GAME_DIR, assetsDir: GAME_DIR, logger: quietLog });
    const m = real.buildManifest();
    assert.ok(m.manifest && m.manifest.files.length >= 7);
    const names = m.manifest.files.map((f) => f.name);
    for (const n of ['game.html', 'game.js', 'world.js', 'physics.js', 'camera.js', 'i18n.js', 'models.js']) assert.ok(names.includes(n), 'у маніфесті немає ' + n);
    for (const f of m.manifest.files) {
        const data = fs.readFileSync(path.join(GAME_DIR, f.name));
        assert.strictEqual(f.size, data.length);
        assert.strictEqual(f.sha256, crypto.createHash('sha256').update(data).digest('hex'), f.name);
    }
    // game.html підключає саме ці скрипти
    const html = fs.readFileSync(path.join(GAME_DIR, 'game.html'), 'utf8');
    for (const n of names.filter((x) => x.endsWith('.js'))) assert.ok(html.includes(`src="${n}"`), 'game.html не підключає ' + n);
    // три машини й ресурси персонажа в моделях, які входять у маніфест
    const modelsSrc = fs.readFileSync(path.join(GAME_DIR, 'models.js'), 'utf8');
    for (const t of CAR_TYPES) assert.ok(modelsSrc.includes(t + ':'), 'немає моделі ' + t);
});

test('маніфест: зміна файла міняє sha256 і версію; відсутній обов\'язковий файл — помилка, а не неповний список', () => {
    const { gameDir, assetsDir } = tmpGame(allFiles());
    const f = createBloxFiles({ gameDir, assetsDir, logger: quietLog });
    const m1 = f.buildManifest();
    assert.ok(m1.manifest.version);
    fs.writeFileSync(path.join(gameDir, 'models.js'), 'змінено');
    const m2 = f.buildManifest();
    assert.notStrictEqual(m2.manifest.version, m1.manifest.version);
    const a = m1.manifest.files.find((x) => x.name === 'models.js'), b = m2.manifest.files.find((x) => x.name === 'models.js');
    assert.notStrictEqual(a.sha256, b.sha256);
    fs.unlinkSync(path.join(gameDir, 'world.js'));
    assert.throws(() => f.buildManifest(), (e) => e.code === 'required_missing' && e.missing.includes('world.js'), 'помилка називає відсутній файл');
});

test('маніфест: небезпечні імена не потрапляють у список і не віддаються', () => {
    const { gameDir, assetsDir } = tmpGame(Object.assign(allFiles(), { '.hidden': 'x', 'a b.js': 'x' }));
    const f = createBloxFiles({ gameDir, assetsDir, logger: quietLog });
    const names = f.buildManifest().manifest.files.map((x) => x.name);
    assert.ok(!names.includes('.hidden') && !names.includes('a b.js'));
    assert.ok(!require('../kishkablox.js').isSafeBloxName('../server.js'));
    assert.ok(!require('../kishkablox.js').isSafeBloxName('..'));
});

test('Android: оновлення завантажує в окрему папку, перевіряє sha256 і лишає стару версію при помилці', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app/src/main/java/com/kishka/messenger/Bloxinstall.kt'), 'utf8');
    // перевіряємо, що в коді є всі запобіжники (повну перевірку виконує збірка й ручний тест на пристрої)
    for (const part of ['DIR_NEW', 'DIR_OLD', 'sha256Of', 'needsUpdate', 'recoverInterrupted', 'UpdateState.ERROR', 'NAME_RE', 'SHA_RE', 'fun startUpdate', 'fun checkForUpdate', 'fun verifyForPlay', 'staging.deleteRecursively()', 'backup.renameTo(live)']) {
        assert.ok(src.includes(part), 'у Bloxinstall.kt немає ' + part);
    }
    assert.ok(src.indexOf('live.renameTo(backup)') > src.indexOf('sha256Of(file) != f.sha256'), 'заміна папок лише ПІСЛЯ перевірки файлів');
    // сервер недоступний -> стан оновлення не змінюється на AVAILABLE
    assert.ok(/ok == false: сервер недоступний/.test(src));
    const game = fs.readFileSync(path.join(__dirname, '..', 'app/src/main/java/com/kishka/messenger/Bloxgame.kt'), 'utf8');
    for (const part of ['blox_game_cars', 'blox_car_tick', 'blox_car_spawn', 'blox_car_remove', 'fun sendState', 'err_webgl', 'err_server_down', 'err_game_files', 'verifyForPlay']) {
        assert.ok(game.includes(part), 'у Bloxgame.kt немає ' + part);
    }
});
