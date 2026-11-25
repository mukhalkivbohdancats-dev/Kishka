// Перевірки ретранслятора дзвінків (без мережі): node --test
const test = require('node:test');
const assert = require('node:assert');
const { createRelay, MAX_FPS, MAX_BUFFERED } = require('../relay.js');

function fakeWs() {
    return { readyState: 1, bufferedAmount: 0, sent: [], closed: null, send(d, o) { this.sent.push({ d, binary: !!(o && o.binary) }); }, close(c, r) { this.closed = [c, r]; this.readyState = 3; } };
}
function join(relay, ws, me, peer) { return relay.onText(ws, null, JSON.stringify({ t: 'hi', me, peer })); }
const frame = (n) => Buffer.alloc(n || 330, 7);

test('двоє співрозмовників: кадр доходить без змін лише при взаємному «hi»', () => {
    const r = createRelay();
    const a = fakeWs(), b = fakeWs();
    const ra = join(r, a, 'A@x.com', 'b@x.com');
    assert.ok(ra && JSON.parse(a.sent[0].d).ok === true, 'відповідь на hi');
    const f = frame();
    assert.strictEqual(r.onFrame(ra, f), false, 'співрозмовник ще не зайшов — кадр не йде');
    const rb = join(r, b, 'b@x.com', 'a@x.com');
    assert.strictEqual(r.onFrame(ra, f), true);
    assert.strictEqual(b.sent.filter((x) => x.binary).length, 1, 'b отримав один кадр голосу');
    const last = b.sent[b.sent.length - 1];
    assert.ok(last.binary && last.d === f, 'кадр пересланий без змін як бінарний');
    assert.strictEqual(r.onFrame(rb, frame(100)), true);
    assert.ok(a.sent[a.sent.length - 1].binary);
});

test('присутність співрозмовника: клієнти дізнаються, коли він на лінії, а коли вийшов (щоб голос не губився)', () => {
    const r = createRelay();
    const a = fakeWs(), b = fakeWs();
    const peerMsgs = (w) => w.sent.filter((x) => !x.binary && x.d.startsWith('{"t":"peer"')).map((x) => JSON.parse(x.d).on);
    const ra = join(r, a, 'a@x.com', 'b@x.com');
    assert.deepStrictEqual(peerMsgs(a), [false], 'b ще не зайшов');
    const rb = join(r, b, 'b@x.com', 'a@x.com');
    assert.deepStrictEqual(peerMsgs(b), [true], 'b одразу бачить, що a на лінії');
    assert.deepStrictEqual(peerMsgs(a), [false, true], 'a дізнався, що b зайшов');
    r.onClose(b, rb);
    assert.deepStrictEqual(peerMsgs(a), [false, true, false], 'a дізнався, що b вийшов');
    void ra;
});

test('чужий не підслухає: кадр іде лише тому, хто вказав відправника як співрозмовника', () => {
    const r = createRelay();
    const a = fakeWs(), b = fakeWs(), c = fakeWs();
    const ra = join(r, a, 'a@x.com', 'b@x.com');
    join(r, b, 'b@x.com', 'zzz@x.com');            // b говорить НЕ з a
    assert.strictEqual(r.onFrame(ra, frame()), false, 'b не очікує a');
    const rc = join(r, c, 'c@x.com', 'a@x.com');
    assert.strictEqual(r.onFrame(rc, frame()), false, 'a говорить з b, а не з c');
    assert.strictEqual(a.sent.filter((s) => s.binary).length, 0);
});

test('некоректні дані: погане привітання, завеликий і порожній кадр, самому собі', () => {
    const r = createRelay();
    const a = fakeWs();
    assert.strictEqual(join(r, a, 'not-an-email', 'b@x.com'), null);
    assert.strictEqual(JSON.parse(a.sent[0].d).ok, false);
    assert.strictEqual(join(r, fakeWs(), 'a@x.com', 'a@x.com'), null, 'сам із собою не можна');
    const b = fakeWs(), c = fakeWs();
    const rb = join(r, b, 'b@x.com', 'c@x.com'); join(r, c, 'c@x.com', 'b@x.com');
    assert.strictEqual(r.onFrame(rb, Buffer.alloc(0)), false);
    assert.strictEqual(r.onFrame(rb, Buffer.alloc(5000)), false);
    assert.strictEqual(r.onFrame(null, frame()), false, 'без hi кадри ігноруються');
    assert.strictEqual(r.onText(b, rb, 'це не json'), rb, 'сміття не ламає');
});

test('ліміт частоти: понад 120 кадрів за секунду відкидаються, а потім знову дозволені', () => {
    let t = 1000;
    const r = createRelay({ now: () => t });
    const a = fakeWs(), b = fakeWs();
    const ra = join(r, a, 'a@x.com', 'b@x.com'); join(r, b, 'b@x.com', 'a@x.com');
    let ok = 0;
    for (let i = 0; i < MAX_FPS + 30; i++) if (r.onFrame(ra, frame())) ok++;
    assert.strictEqual(ok, MAX_FPS);
    t += 1100;
    assert.strictEqual(r.onFrame(ra, frame()), true);
});

test('співрозмовник «не встигає»: старі кадри відкидаються замість зростання затримки', () => {
    const r = createRelay();
    const a = fakeWs(), b = fakeWs();
    const ra = join(r, a, 'a@x.com', 'b@x.com'); join(r, b, 'b@x.com', 'a@x.com');
    b.bufferedAmount = MAX_BUFFERED + 1;
    assert.strictEqual(r.onFrame(ra, frame()), false);
    assert.ok(r.stats.dropped >= 1);
    b.bufferedAmount = 0;
    assert.strictEqual(r.onFrame(ra, frame()), true);
});

test('перепідключення: нова сесія замінює стару, а закриття старої не зачіпає нову', () => {
    const r = createRelay();
    const a1 = fakeWs(), a2 = fakeWs(), b = fakeWs();
    const ra1 = join(r, a1, 'a@x.com', 'b@x.com'); join(r, b, 'b@x.com', 'a@x.com');
    const ra2 = join(r, a2, 'a@x.com', 'b@x.com');
    assert.deepStrictEqual(a1.closed, [4000, 'replaced'], 'стара сесія закрита');
    r.onClose(a1, ra1);
    assert.strictEqual(r.peers.get('a@x.com').ws, a2, 'нова лишилась');
    assert.strictEqual(r.onFrame(ra2, frame()), true);
});

test('пінг застосунку «p» -> «q»; сесії без активності прибираються', () => {
    let t = 1000;
    const r = createRelay({ now: () => t });
    const a = fakeWs();
    const ra = join(r, a, 'a@x.com', 'b@x.com');
    r.onText(a, ra, 'p');
    assert.strictEqual(a.sent[a.sent.length - 1].d, 'q');
    t += 40000;
    r.sweep(30000);
    assert.strictEqual(r.peers.size, 0);
    assert.deepStrictEqual(a.closed, [4001, 'idle']);
});
