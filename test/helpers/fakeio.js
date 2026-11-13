// Спільна імітація Socket.IO для тестів KishkaBlox (без мережі й бази).
const { createBloxGame } = require('../../blox_game_server.js');

const quiet = { log() {}, warn() {}, error() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class FakeSocket {
    constructor(io, id, email) {
        this.io = io;
        this.id = id;
        this.userEmail = email || null;
        this.handlers = {};
        this.rooms = new Set([id]);
        this.received = [];
        this.disconnected = false;
    }
    on(ev, fn) { this.handlers[ev] = fn; }
    join(room) { this.rooms.add(room); }
    leave(room) { this.rooms.delete(room); }
    // Клієнт надсилає подію серверу
    send(ev, data, ack) {
        const h = this.handlers[ev];
        if (h) h(data, ack);
    }
    call(ev, data) {
        return new Promise((resolve) => this.send(ev, data, resolve));
    }
    disconnect(reason) {
        this.disconnected = true;
        this.io.sockets.sockets.delete(this.id);
        const h = this.handlers.disconnect;
        if (h) h(reason || 'transport close');
    }
    events(name) { return this.received.filter((e) => e.ev === name).map((e) => e.payload); }
    last(name) { const a = this.events(name); return a[a.length - 1]; }
}

class FakeIO {
    constructor() {
        this.sockets = { sockets: new Map() };
        this.connectionHandlers = [];
        this.seq = 0;
    }
    on(ev, fn) { if (ev === 'connection') this.connectionHandlers.push(fn); }
    to(room) {
        const self = this;
        return {
            emit(ev, payload) {
                for (const s of self.sockets.sockets.values()) {
                    if (s.rooms.has(room)) s.received.push({ ev, payload: JSON.parse(JSON.stringify(payload)) });
                }
            }
        };
    }
    connect(email, noIdentify) {
        const s = new FakeSocket(this, 'sock' + (++this.seq), noIdentify ? null : email);
        this.sockets.sockets.set(s.id, s);
        this.connectionHandlers.forEach((h) => h(s));
        return s;
    }
}

// Усі акаунти, яких немає в списку відмов, вважаються «увійшли в KishkaBlox» і мають нік з пошти до '@'
function setup(extra) {
    const io = new FakeIO();
    const clock = { t: 1000000 };
    const logged = (extra && extra.logged) || null;
    const game = createBloxGame(Object.assign({
        io,
        logger: quiet,
        now: () => clock.t,
        tickMs: 10,
        graceMs: 200,
        motionCheck: false,
        getNick: async (email) => {
            if (logged && !logged.has(email)) return null;
            return email.split('@')[0];
        }
    }, (extra && extra.opts) || {}));
    // Підключення: кожен новий сокет отримує обробники гри
    io.on('connection', (s) => game.attach(s));
    return { io, game, clock };
}


const GAME = 'realistic_cars';
const join = (client, email, extra) => client.call('blox_game_join', Object.assign({ email, game: GAME }, extra || {}));

module.exports = { quiet, sleep, FakeSocket, FakeIO, setup, GAME, join };
