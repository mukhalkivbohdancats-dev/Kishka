// Мінімальна імітація браузера й WebGL для «димового» запуску game.js в Node (без графіки).
// Перевіряє, що гра запускається, малює кадри й реагує на кнопки без помилок JavaScript. Реальну графіку НЕ перевіряє.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function makeGl() {
    const store = {};
    return new Proxy({}, {
        get(t, k) {
            if (k in store) return store[k];
            if (typeof k === 'symbol') return undefined;
            if (/^[A-Z0-9_]+$/.test(k)) return 1;
            if (k === 'getShaderParameter' || k === 'getProgramParameter') return () => true;
            if (k === 'getShaderInfoLog' || k === 'getProgramInfoLog') return () => '';
            if (k === 'getAttribLocation') return () => 0;
            if (k === 'getUniformLocation') return () => ({});
            if (k === 'getExtension') return () => null;
            if (k === 'getContextAttributes') return () => ({});
            if (k === 'isContextLost') return () => false;
            if (k === 'canvas') return store.canvas;
            return () => ({});
        },
        set(t, k, v) { store[k] = v; return true; }
    });
}

function makeEl(id, doc) {
    const listeners = {};
    const el = {
        id, style: {}, dataset: {}, children: [], _listeners: listeners, _html: '', textContent: '',
        get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; this.children = []; }, width: 800, height: 400,
        classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); }, toggle(c, f) { if (f === undefined ? !this._s.has(c) : f) this._s.add(c); else this._s.delete(c); } },
        attrs: {},
        setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
        addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
        removeEventListener() {}, appendChild(c) { this.children.push(c); return c; }, removeChild() {}, remove() {},
        getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400 }; },
        setPointerCapture() {}, releasePointerCapture() {}, focus() {}, blur() {},
        querySelector() { return makeEl('q', doc); }, querySelectorAll() { return []; },
        getContext(kind) {
            if (kind === '2d') return new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : (typeof k === 'string' ? () => {} : undefined)), set: () => true });
            const gl = makeGl(); gl.canvas = el; return gl;
        },
        toDataURL() { return 'data:image/png;base64,AAAA'; },
        click() { (listeners.click || []).forEach((f) => f({ preventDefault() {}, stopPropagation() {} })); }
    };
    return el;
}

// Запускає файли гри в одному «вікні». Повертає { win, el(id), frame(ms), calls }
function loadGame(opts) {
    const dir = path.join(__dirname, '..', '..', 'blox_game');
    const els = {};
    const doc = {
        getElementById: (id) => (els[id] = els[id] || makeEl(id, doc)),
        createElement: (tag) => makeEl(tag, doc),
        body: null, documentElement: makeEl('html'), addEventListener() {}, hidden: false,
        querySelector: () => makeEl('q'), querySelectorAll: () => []
    };
    doc.body = makeEl('body', doc);
    ['carsPanel', 'carAct'].forEach((id) => doc.getElementById(id).classList.add('hidden'));   // як у game.html
    const calls = [];
    const rafs = [];
    const android = opts && opts.noAndroid ? undefined : new Proxy({}, { get: (t, k) => (typeof k === 'string' ? (...a) => { calls.push([k, ...a]); } : undefined) });
    const win = {
        document: doc, Android: android, devicePixelRatio: 1, innerWidth: 800, innerHeight: 400,
        addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, setInterval, clearInterval,
        requestAnimationFrame: (fn) => { rafs.push(fn); return rafs.length; }, cancelAnimationFrame() {},
        navigator: { userAgent: 'node-smoke', maxTouchPoints: 1 }, performance: { now: () => Date.now() },
        console: { log() {}, warn() {}, error() {} }, Math, JSON, Date, Float32Array, Uint16Array, Uint32Array, Array, Object, Number, String, Set, Map,
        Image: function () {}, Float64Array, Int32Array, Uint8Array, isFinite, isNaN, parseFloat, parseInt
    };
    win.window = win; win.self = win; win.globalThis = win;
    const ctx = vm.createContext(win);
    for (const f of ['world.js', 'physics.js', 'camera.js', 'i18n.js', 'models.js', 'game.js']) {
        vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
    }
    let t = 1000;
    function frame(n) {
        for (let i = 0; i < (n || 1); i++) {
            t += 16.7;
            const list = rafs.splice(0, rafs.length);
            list.forEach((fn) => fn(t));
        }
    }
    return { win, el: (id) => doc.getElementById(id), frame, calls, doc };
}

module.exports = { loadGame };
