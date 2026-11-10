// Перевірки установки KishkaBlox: node --test   (або npm test)
// Не потребують ні бази, ні інтернету. Express потрібен лише для одного додаткового тесту (пропускається, якщо його немає).
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBloxFiles, isSafeBloxName } = require('../kishkablox.js');

const quiet = { log() {}, warn() {}, error() {} };
const ROOT = path.join(__dirname, '..');

// Піднімає тимчасовий HTTP-сервер, що працює так само, як app.use('/blox', handle): відрізає '/blox' від req.url
function startServer(blox) {
    const server = http.createServer((req, res) => {
        if (req.url === '/blox' || req.url.startsWith('/blox/') || req.url.startsWith('/blox?')) {
            req.url = req.url.slice('/blox'.length) || '/';
            return blox.handle(req, res);
        }
        res.statusCode = 404;
        res.end('other');
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Сирий запит без нормалізації шляху (щоб '../' дійшло до сервера як є)
function rawGet(server, rawPath, method) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: server.address().port, path: rawPath, method: method || 'GET' }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        req.end();
    });
}

function tmpGame(files) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'blox-'));
    const game = path.join(base, 'blox_game');
    fs.mkdirSync(game);
    for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(game, name), data);
    return { base, game };
}

// ---------- Справжні файли репозиторію ----------
test('/blox/manifest.json: 200 і формат, який очікує Android (fetchManifest)', async () => {
    const blox = createBloxFiles({ logger: quiet });
    const server = await startServer(blox);
    try {
        const r = await rawGet(server, '/blox/manifest.json');
        assert.strictEqual(r.status, 200);
        assert.match(r.headers['content-type'], /application\/json/);
        const json = JSON.parse(r.body.toString('utf8'));
        assert.strictEqual(typeof json.version, 'string');
        assert.ok(json.version.length > 0);
        assert.ok(Array.isArray(json.files) && json.files.length > 0);
        for (const f of json.files) {
            assert.strictEqual(typeof f.name, 'string');
            assert.ok(Number.isInteger(f.size) && f.size > 0, 'size має бути цілим додатним: ' + f.name);
        }
        const names = json.files.map((f) => f.name);
        for (const need of ['game.html', 'game.js', 'kishkablox.png', 'realistic_cars.jpg']) {
            assert.ok(names.includes(need), 'у маніфесті немає ' + need);
        }
    } finally { server.close(); }
});

test('кожен файл із маніфесту віддається, size і sha256 збігаються з відданими байтами та з файлом на диску', async () => {
    const blox = createBloxFiles({ logger: quiet });
    const server = await startServer(blox);
    try {
        const m = JSON.parse((await rawGet(server, '/blox/manifest.json')).body.toString('utf8'));
        for (const f of m.files) {
            const r = await rawGet(server, '/blox/files/' + encodeURIComponent(f.name));
            assert.strictEqual(r.status, 200, f.name);
            assert.strictEqual(r.body.length, f.size, 'розмір відданого файла ' + f.name);
            assert.strictEqual(Number(r.headers['content-length']), f.size, 'Content-Length ' + f.name);
            assert.strictEqual(require('crypto').createHash('sha256').update(r.body).digest('hex'), f.sha256, f.name);
            const entry = blox.scan().entries.get(f.name);
            assert.strictEqual(fs.statSync(entry.abs).size, f.size, 'розмір на диску ' + f.name);
            assert.ok(!/text\/html/.test(String(r.headers['content-type'])) || f.name.endsWith('.html'), 'не HTML-сторінка помилки замість ' + f.name);
        }
    } finally { server.close(); }
});

test('усі файли, на які посилається game.html, є в маніфесті', async () => {
    const blox = createBloxFiles({ logger: quiet });
    const names = blox.buildManifest().manifest.files.map((f) => f.name);
    const html = fs.readFileSync(path.join(ROOT, 'blox_game', 'game.html'), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]).filter((u) => !/^(https?:|data:|#)/.test(u));
    assert.ok(refs.length > 0);
    for (const ref of refs) assert.ok(names.includes(ref), 'game.html посилається на ' + ref + ', якого немає в маніфесті');
});

test('HEAD віддає ті самі заголовки без тіла', async () => {
    const server = await startServer(createBloxFiles({ logger: quiet }));
    try {
        const g = await rawGet(server, '/blox/files/game.js');
        const h = await rawGet(server, '/blox/files/game.js', 'HEAD');
        assert.strictEqual(h.status, 200);
        assert.strictEqual(h.body.length, 0);
        assert.strictEqual(Number(h.headers['content-length']), g.body.length);
    } finally { server.close(); }
});

// ---------- Захист від виходу за межі папки ----------
test('небезпечні імена не читають файли поза папкою гри', async () => {
    const secret = 'TOP-SECRET-' + Date.now();
    const { base, game } = tmpGame({ 'game.html': '<html></html>', 'game.js': 'x=1' });
    fs.writeFileSync(path.join(base, 'secret.txt'), secret);
    fs.writeFileSync(path.join(base, 'server.js'), secret);
    const blox = createBloxFiles({ gameDir: game, assetsDir: path.join(base, 'none'), logger: quiet });
    const server = await startServer(blox);
    const attacks = [
        '/blox/files/../secret.txt',
        '/blox/files/../server.js',
        '/blox/files/..%2fsecret.txt',
        '/blox/files/..%2Fsecret.txt',
        '/blox/files/%2e%2e%2fsecret.txt',
        '/blox/files/%2e%2e/secret.txt',
        '/blox/files/..%5csecret.txt',
        '/blox/files/..\\secret.txt',
        '/blox/files/....//secret.txt',
        '/blox/files/%2Fetc%2Fpasswd',
        '/blox/files//etc/passwd',
        '/blox/files/' + encodeURIComponent(path.join(base, 'secret.txt')),
        '/blox/files/game.html%00.png',
        '/blox/files/game.html%00',
        '/blox/files/%00',
        '/blox/files/%',
        '/blox/files/%E0%A4%A',
        '/blox/files/..',
        '/blox/files/.',
        '/blox/files/',
        '/blox/files',
        '/blox/files/__proto__',
        '/blox/files/constructor',
        '/blox/files/toString',
        '/blox/files/GAME.HTML',
        '/blox/files/secret.txt',
        '/blox/files/.env',
        '/blox/../secret.txt',
        '/blox/manifest.json/../../secret.txt'
    ];
    try {
        for (const a of attacks) {
            const r = await rawGet(server, a);
            assert.ok(!r.body.toString('utf8').includes(secret), 'ВИТІК через ' + a);
            assert.ok(r.status >= 400 && r.status < 500, a + ' -> ' + r.status);
            if (a.startsWith('/blox/')) assert.match(String(r.headers['content-type']), /application\/json/, a);
        }
    } finally { server.close(); }
});

test('symlink на файл поза папкою гри не потрапляє ні в маніфест, ні в роздачу', async (t) => {
    const secret = 'SYMLINK-SECRET';
    const { base, game } = tmpGame({ 'game.html': '<html></html>', 'game.js': 'x=1' });
    fs.writeFileSync(path.join(base, 'outside.js'), secret);
    try { fs.symlinkSync(path.join(base, 'outside.js'), path.join(game, 'evil.js')); } catch (e) { return t.skip('symlink недоступні'); }
    const blox = createBloxFiles({ gameDir: game, assetsDir: path.join(base, 'none'), logger: quiet });
    const server = await startServer(blox);
    try {
        const m = JSON.parse((await rawGet(server, '/blox/manifest.json')).body.toString('utf8'));
        assert.ok(!m.files.some((f) => f.name === 'evil.js'));
        const r = await rawGet(server, '/blox/files/evil.js');
        assert.strictEqual(r.status, 404);
        assert.ok(!r.body.toString().includes(secret));
    } finally { server.close(); }
});

test('isSafeBloxName', () => {
    for (const ok of ['game.html', 'game.js', 'kishkablox.png', 'a_b-c.1.js']) assert.ok(isSafeBloxName(ok), ok);
    for (const bad of ['', '.', '..', '../a', 'a/b', 'a\\b', '/etc/passwd', 'a\0b', '.env', 'ім’я.js', 'a b.js', 'x'.repeat(200), null, undefined, 5]) assert.ok(!isSafeBloxName(bad), String(bad));
});

// ---------- Помилки ----------
test('немає папки гри -> 503 JSON, не HTML, і запис у лог', async () => {
    const lines = [];
    const logger = { log() {}, warn() {}, error: (m) => lines.push(m) };
    const blox = createBloxFiles({ gameDir: path.join(os.tmpdir(), 'blox-no-such-dir-' + Date.now()), assetsDir: ROOT + '/Assets', logger });
    const server = await startServer(blox);
    try {
        const r = await rawGet(server, '/blox/manifest.json');
        assert.strictEqual(r.status, 503);
        assert.match(r.headers['content-type'], /application\/json/);
        assert.strictEqual(JSON.parse(r.body.toString()).ok, false);
        assert.ok(lines.some((l) => l.includes('Папки гри немає')), 'у лозі немає пояснення: ' + lines.join('|'));
        const f = await rawGet(server, '/blox/files/game.js');
        assert.strictEqual(f.status, 503);
    } finally { server.close(); }
});

test('немає game.js -> маніфест 503 (а не неповний список)', async () => {
    const { base, game } = tmpGame({ 'game.html': '<html></html>' });
    const lines = [];
    const server = await startServer(createBloxFiles({ gameDir: game, assetsDir: path.join(base, 'none'), logger: { log() {}, warn() {}, error: (m) => lines.push(m) } }));
    try {
        const r = await rawGet(server, '/blox/manifest.json');
        assert.strictEqual(r.status, 503);
        assert.ok(lines.some((l) => l.includes('game.js')));
    } finally { server.close(); }
});

test('файл зник після маніфесту -> 404 JSON і запис у лог', async () => {
    const { base, game } = tmpGame({ 'game.html': '<html></html>', 'game.js': 'x=1' });
    const lines = [];
    const server = await startServer(createBloxFiles({ gameDir: game, assetsDir: path.join(base, 'none'), logger: { log() {}, warn() {}, error: (m) => lines.push(m) } }));
    try {
        assert.strictEqual((await rawGet(server, '/blox/manifest.json')).status, 200);
        fs.unlinkSync(path.join(game, 'game.js'));
        const r = await rawGet(server, '/blox/files/game.js');
        assert.strictEqual(r.status, 404);
        assert.match(r.headers['content-type'], /application\/json/);
        assert.ok(lines.length > 0);
    } finally { server.close(); }
});

test('зміна файла змінює size, sha256 і version', async () => {
    const { base, game } = tmpGame({ 'game.html': '<html></html>', 'game.js': 'x=1' });
    const blox = createBloxFiles({ gameDir: game, assetsDir: path.join(base, 'none'), logger: quiet });
    const a = blox.buildManifest().manifest;
    fs.writeFileSync(path.join(game, 'game.js'), 'x=12345;');
    const b = blox.buildManifest().manifest;
    assert.notStrictEqual(a.version, b.version);
    assert.strictEqual(b.files.find((f) => f.name === 'game.js').size, 8);
});

test('невідомий маршрут і не-GET -> JSON, не HTML', async () => {
    const server = await startServer(createBloxFiles({ logger: quiet }));
    try {
        const a = await rawGet(server, '/blox/nothing');
        assert.strictEqual(a.status, 404);
        assert.match(a.headers['content-type'], /application\/json/);
        const b = await rawGet(server, '/blox/manifest.json', 'POST');
        assert.strictEqual(b.status, 405);
        assert.match(b.headers['content-type'], /application\/json/);
    } finally { server.close(); }
});

// ---------- Справжній Express (якщо встановлено: npm install) ----------
test('через справжній Express: app.use("/blox") віддає маніфест і файли', async (t) => {
    let express;
    try { express = require('express'); } catch (e) { return t.skip('express не встановлено (npm install)'); }
    const app = express();
    createBloxFiles({ logger: quiet }).register(app);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
        const m = await rawGet(server, '/blox/manifest.json');
        assert.strictEqual(m.status, 200);
        const json = JSON.parse(m.body.toString());
        for (const f of json.files) {
            const r = await rawGet(server, '/blox/files/' + f.name);
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.body.length, f.size);
        }
        const bad = await rawGet(server, '/blox/files/../server.js');
        assert.ok(bad.status >= 400);
        assert.match(String(bad.headers['content-type']), /application\/json/);
    } finally { server.close(); }
});
