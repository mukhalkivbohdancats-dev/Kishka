// Kishka-call — окремий сервіс голосових дзвінків Kishka Messenger.
// Лише ретранслює кадри голосу між двома співрозмовниками по WebSocket (сирі бінарні кадри, без JSON і без Socket.IO),
// нічого не зберігає й не пише в журнал адреси пошти. Повідомлення, сигналізація дзвінка й відео лишаються на основному сервері.
// Запуск: node server.js   (Render: Start Command = node server.js, Build Command = npm install)
'use strict';
const http = require('http');
const { WebSocketServer } = require('ws');
const { createRelay, MAX_FRAME } = require('./relay.js');

const PORT = Number(process.env.PORT) || 10000;
const relay = createRelay();
const started = Date.now();

const server = http.createServer((req, res) => {
    // Перевірка здоров'я для Render (Health Check Path: /healthz) і «будильник» для безкоштовного плану
    if (req.url === '/' || req.url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('Kishka-call ok');
    } else if (req.url === '/stats') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ uptimeSec: Math.round((Date.now() - started) / 1000), sessions: relay.peers.size, frames: relay.stats.frames, dropped: relay.stats.dropped }));
    } else {
        res.writeHead(404); res.end();
    }
});

const wss = new WebSocketServer({ server, perMessageDeflate: false, maxPayload: Math.max(MAX_FRAME, 8192) });

wss.on('connection', (ws, req) => {
    try { req.socket.setNoDelay(true); } catch (e) { /* ігноруємо */ }       // без затримки Нейгла: кожен кадр іде одразу
    let rec = null;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data, isBinary) => {
        if (isBinary) relay.onFrame(rec, data);
        else rec = relay.onText(ws, rec, data.toString());
    });
    ws.on('close', () => relay.onClose(ws, rec));
    ws.on('error', () => { /* розрив мережі — не падаємо */ });
});

// Серцебиття: кожні 5 с перевіряємо, чи клієнт ще тут; мертві з'єднання (зник інтернет) закриваємо
setInterval(() => {
    for (const ws of wss.clients) {
        if (ws.isAlive === false) { ws.terminate(); continue; }
        ws.isAlive = false;
        try { ws.ping(); } catch (e) { /* ігноруємо */ }
    }
    relay.sweep(30000);
}, 5000).unref();

server.listen(PORT, () => console.log('Kishka-call слухає порт ' + PORT));
process.on('SIGTERM', () => { wss.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
