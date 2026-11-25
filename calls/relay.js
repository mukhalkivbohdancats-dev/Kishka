// Kishka-call — логіка ретрансляції голосу (без мережі: сокети передаються ззовні, тому її можна перевірити тестами).
//
// Протокол (WebSocket):
//   клієнт -> сервер, ТЕКСТ  {"t":"hi","me":"a@x.com","peer":"b@x.com"}   «я — a, говорю з b»; у відповідь {"t":"hi","ok":true}
//   клієнт -> сервер, ТЕКСТ  "p"                                          пінг застосунку; у відповідь "q"
//   сервер -> клієнт, ТЕКСТ  {"t":"peer","on":true|false}                   співрозмовник на лінії (так) чи ще ні/вже вийшов; поки «ні», клієнт
//                                                                         шле голос запасним шляхом (основним сервером), щоб слова не губились
//   клієнт -> сервер, БІНАРНИЙ кадр голосу (пакет ADPCM, 7 байт заголовка + ~320 байт звуку) -> пересилається співрозмовнику БЕЗ змін
//   сервер -> клієнт, БІНАРНИЙ кадр — голос від співрозмовника
// Кадр пересилається лише тоді, коли співрозмовник теж «зайшов» і вказав у peer адресу відправника (взаємність).
'use strict';

const OPEN = 1;                       // значення WebSocket.OPEN
const MAX_FRAME = 4096;               // найбільший дозволений кадр (звичайний ~330 байт)
const MAX_FPS = 120;                  // не більше 120 кадрів за секунду від одного клієнта (звичайно 25)
const MAX_BUFFERED = 32 * 1024;       // якщо співрозмовник «не встигає» (затримка росте), старі кадри відкидаємо — краще пропуск, ніж відставання

function cleanEmail(v) {
    if (typeof v !== 'string') return '';
    const e = v.trim().toLowerCase();
    return e.length >= 3 && e.length <= 120 && e.includes('@') && !/[\s"'<>\\]/.test(e) ? e : '';
}

function createRelay(opts) {
    const now = (opts && opts.now) || Date.now;
    const peers = new Map();          // email -> { ws, email, peer, lastSeen, stamps: [] }
    const stats = { frames: 0, dropped: 0, joins: 0 };

    // ws — об'єкт з методами send(data, opts), close(code, reason), полями readyState і bufferedAmount
    function hello(ws, msg) {
        const me = cleanEmail(msg.me), peer = cleanEmail(msg.peer);
        if (!me || !peer || me === peer) { safeSend(ws, JSON.stringify({ t: 'hi', ok: false, code: 'bad_hello' })); return null; }
        const old = peers.get(me);
        // Переоформлення (змінилась мережа, стара сесія ще «висить»): виграє найновіший
        if (old && old.ws !== ws) { try { old.ws.close(4000, 'replaced'); } catch (e) { /* ігноруємо */ } }
        const rec = { ws, email: me, peer, lastSeen: now(), stamps: [] };
        peers.set(me, rec);
        stats.joins++;
        safeSend(ws, JSON.stringify({ t: 'hi', ok: true }));
        const other = mutual(rec);
        safeSend(ws, JSON.stringify({ t: 'peer', on: !!other }));
        if (other) safeSend(other.ws, JSON.stringify({ t: 'peer', on: true }));       // співрозмовник теж дізнається, що ми тут
        return rec;
    }

    // Співрозмовник rec, якщо він на лінії й теж очікує rec (взаємність), інакше null
    function mutual(rec) {
        const t = peers.get(rec.peer);
        return t && t.peer === rec.email && t.ws.readyState === OPEN ? t : null;
    }

    function safeSend(ws, data, binary) {
        try { if (ws.readyState === OPEN) ws.send(data, binary ? { binary: true } : undefined); return true; } catch (e) { return false; }
    }

    // Текстове повідомлення від клієнта; повертає запис клієнта після «hi»
    function onText(ws, rec, text) {
        if (text === 'p') { if (rec) rec.lastSeen = now(); safeSend(ws, 'q'); return rec; }
        let msg = null;
        try { msg = JSON.parse(text); } catch (e) { return rec; }
        if (msg && msg.t === 'hi') return hello(ws, msg);
        return rec;
    }

    // Кадр голосу від клієнта rec
    function onFrame(rec, data) {
        if (!rec) return false;
        const t = now();
        rec.lastSeen = t;
        const size = data.length !== undefined ? data.length : data.byteLength;
        if (!(size > 0) || size > MAX_FRAME) return false;
        rec.stamps = rec.stamps.filter((s) => t - s < 1000);
        if (rec.stamps.length >= MAX_FPS) { stats.dropped++; return false; }
        rec.stamps.push(t);
        const target = mutual(rec);
        if (!target) { stats.dropped++; return false; }
        if ((target.ws.bufferedAmount || 0) > MAX_BUFFERED) { stats.dropped++; return false; }
        stats.frames++;
        return safeSend(target.ws, data, true);
    }

    function leave(rec) {
        const other = peers.get(rec.peer);
        peers.delete(rec.email);
        if (other && other.peer === rec.email) safeSend(other.ws, JSON.stringify({ t: 'peer', on: false }));
    }

    function onClose(ws, rec) {
        if (rec && peers.get(rec.email) && peers.get(rec.email).ws === ws) leave(rec);
    }

    // Прибирає сесії, від яких довго нічого немає (клієнт зник без закриття)
    function sweep(idleMs) {
        const t = now();
        for (const [email, rec] of peers) {
            if (t - rec.lastSeen > idleMs) {
                try { rec.ws.close(4001, 'idle'); } catch (e) { /* ігноруємо */ }
                leave(rec);
            }
        }
    }

    return { hello, onText, onFrame, onClose, sweep, peers, stats, cleanEmail, MAX_FRAME };
}

module.exports = { createRelay, cleanEmail, MAX_FRAME, MAX_FPS, MAX_BUFFERED };
