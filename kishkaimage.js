'use strict';

// =====================================================================
// KISHKA-IMAGE — власний генератор зображень месенджера Kishka.
// Працює повністю на сервері, БЕЗ інтернету, БЕЗ чужих ШІ і БЕЗ зовнішніх бібліотек:
// розуміє опис (укр / рос / англ), складає сцену з примітивів (небо, сонце, місяць, зорі, хмари, гори,
// море, ліс, місто, пустеля, космос, будинок, дерева, квіти, човен, ракета, кішка, веселка, дощ, сніг, туман)
// і кодує готовий PNG стандартним zlib.
// Це стилізована процедурна ілюстрація, а не фотографія і не нейромережа.
// =====================================================================

const zlib = require('zlib');

// ---------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgb) {
    // rgb: Uint8Array довжиною width*height*3
    const stride = width * 3;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0;
        Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;   // біт на канал
    ihdr[9] = 2;   // truecolor RGB
    ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
        pngChunk('IEND', Buffer.alloc(0))
    ]);
}

// ---------------------------------------------------------------------
// Допоміжне: випадковість, шум, кольори
// ---------------------------------------------------------------------
function hashString(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

function makeRng(seed) {
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (lo, hi) => lo + (hi - lo) * next();
    next.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * next());
    next.pick = (arr) => arr[Math.floor(next() * arr.length) % arr.length];
    return next;
}

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
const mix = (a, b, t) => a + (b - a) * t;
const mixC = (c1, c2, t) => [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];
const smooth = (t) => t * t * (3 - 2 * t);

function lattice(ix, iy, seed) {
    let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function vnoise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth(x - ix), fy = smooth(y - iy);
    const a = lattice(ix, iy, seed), b = lattice(ix + 1, iy, seed);
    const c = lattice(ix, iy + 1, seed), d = lattice(ix + 1, iy + 1, seed);
    return mix(mix(a, b, fx), mix(c, d, fx), fy);
}

function fbm(x, y, seed, octaves) {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < (octaves || 4); o++) {
        sum += amp * vnoise(x * freq, y * freq, seed + o * 31);
        norm += amp;
        amp *= 0.5;
        freq *= 2;
    }
    return sum / norm;
}

// ---------------------------------------------------------------------
// Полотно
// ---------------------------------------------------------------------
class Canvas {
    constructor(w, h) {
        this.w = w;
        this.h = h;
        this.d = new Float32Array(w * h * 3);
    }

    px(x, y, c, a) {
        if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
        const i = (y * this.w + x) * 3;
        const d = this.d;
        if (a >= 1) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; return; }
        d[i] += (c[0] - d[i]) * a;
        d[i + 1] += (c[1] - d[i + 1]) * a;
        d[i + 2] += (c[2] - d[i + 2]) * a;
    }

    gradV(stops) {
        // stops: [[t, [r,g,b]], ...] за зростанням t (0 — верх, 1 — низ)
        for (let y = 0; y < this.h; y++) {
            const t = y / (this.h - 1);
            let c = stops[stops.length - 1][1];
            for (let k = 0; k < stops.length - 1; k++) {
                if (t >= stops[k][0] && t <= stops[k + 1][0]) {
                    c = mixC(stops[k][1], stops[k + 1][1], (t - stops[k][0]) / Math.max(1e-6, stops[k + 1][0] - stops[k][0]));
                    break;
                }
            }
            for (let x = 0; x < this.w; x++) this.px(x, y, c, 1);
        }
    }

    glow(cx, cy, r, c, alpha) {
        const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.w - 1, Math.ceil(cx + r));
        const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.h - 1, Math.ceil(cy + r));
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const dd = Math.hypot(x - cx, y - cy) / r;
                if (dd >= 1) continue;
                const f = (1 - dd) * (1 - dd);
                this.px(x, y, c, f * alpha);
            }
        }
    }

    circle(cx, cy, r, c, a) {
        a = a === undefined ? 1 : a;
        const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(this.w - 1, Math.ceil(cx + r + 1));
        const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(this.h - 1, Math.ceil(cy + r + 1));
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const cov = clamp(r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + 0.5, 0, 1);
                if (cov > 0) this.px(x, y, c, cov * a);
            }
        }
    }

    ring(cx, cy, r, width, c, a) {
        a = a === undefined ? 1 : a;
        const R = r + width;
        const x0 = Math.max(0, Math.floor(cx - R - 1)), x1 = Math.min(this.w - 1, Math.ceil(cx + R + 1));
        const y0 = Math.max(0, Math.floor(cy - R - 1)), y1 = Math.min(this.h - 1, Math.ceil(cy + R + 1));
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const d = Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r);
                const cov = clamp(width / 2 - d + 0.5, 0, 1);
                if (cov > 0) this.px(x, y, c, cov * a);
            }
        }
    }

    ellipse(cx, cy, rx, ry, c, a, rot) {
        a = a === undefined ? 1 : a;
        const cs = Math.cos(rot || 0), sn = Math.sin(rot || 0);
        const R = Math.max(rx, ry) + 2;
        const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(this.w - 1, Math.ceil(cx + R));
        const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(this.h - 1, Math.ceil(cy + R));
        const m = Math.min(rx, ry);
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
                const ux = dx * cs + dy * sn, uy = -dx * sn + dy * cs;
                const q = Math.hypot(ux / rx, uy / ry);
                const cov = clamp((1 - q) * m + 0.5, 0, 1);
                if (cov > 0) this.px(x, y, c, cov * a);
            }
        }
    }

    rect(x, y, w, h, c, a) {
        a = a === undefined ? 1 : a;
        const x0 = Math.max(0, Math.floor(x)), x1 = Math.min(this.w - 1, Math.ceil(x + w) - 1);
        const y0 = Math.max(0, Math.floor(y)), y1 = Math.min(this.h - 1, Math.ceil(y + h) - 1);
        for (let yy = y0; yy <= y1; yy++) {
            const cy = clamp(Math.min(yy + 1, y + h) - Math.max(yy, y), 0, 1);
            for (let xx = x0; xx <= x1; xx++) {
                const cx = clamp(Math.min(xx + 1, x + w) - Math.max(xx, x), 0, 1);
                this.px(xx, yy, c, cx * cy * a);
            }
        }
    }

    line(x1, y1, x2, y2, wd, c, a) {
        a = a === undefined ? 1 : a;
        const r = wd / 2;
        const bx0 = Math.max(0, Math.floor(Math.min(x1, x2) - r - 1)), bx1 = Math.min(this.w - 1, Math.ceil(Math.max(x1, x2) + r + 1));
        const by0 = Math.max(0, Math.floor(Math.min(y1, y2) - r - 1)), by1 = Math.min(this.h - 1, Math.ceil(Math.max(y1, y2) + r + 1));
        const vx = x2 - x1, vy = y2 - y1;
        const len2 = vx * vx + vy * vy || 1e-9;
        for (let y = by0; y <= by1; y++) {
            for (let x = bx0; x <= bx1; x++) {
                const t = clamp(((x + 0.5 - x1) * vx + (y + 0.5 - y1) * vy) / len2, 0, 1);
                const d = Math.hypot(x + 0.5 - (x1 + vx * t), y + 0.5 - (y1 + vy * t));
                const cov = clamp(r - d + 0.5, 0, 1);
                if (cov > 0) this.px(x, y, c, cov * a);
            }
        }
    }

    poly(pts, c, a) {
        a = a === undefined ? 1 : a;
        let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
        pts.forEach((p) => { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); });
        const x0 = Math.max(0, Math.floor(minX - 1)), x1 = Math.min(this.w - 1, Math.ceil(maxX + 1));
        const y0 = Math.max(0, Math.floor(minY - 1)), y1 = Math.min(this.h - 1, Math.ceil(maxY + 1));
        const n = pts.length;
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const px = x + 0.5, py = y + 0.5;
                let inside = false;
                let dmin = 1e9;
                for (let i = 0, j = n - 1; i < n; j = i++) {
                    const ax = pts[j][0], ay = pts[j][1], bx = pts[i][0], by = pts[i][1];
                    if (((ay > py) !== (by > py)) && (px < (bx - ax) * (py - ay) / (by - ay) + ax)) inside = !inside;
                    const vx = bx - ax, vy = by - ay;
                    const l2 = vx * vx + vy * vy || 1e-9;
                    const t = clamp(((px - ax) * vx + (py - ay) * vy) / l2, 0, 1);
                    const d = Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
                    if (d < dmin) dmin = d;
                }
                const sd = inside ? -dmin : dmin;
                const cov = clamp(0.5 - sd, 0, 1);
                if (cov > 0) this.px(x, y, c, cov * a);
            }
        }
    }

    // Заповнює все під лінією y = fn(x). opts.bottom — колір унизу (градієнт), opts.cap — колір «шапки» (сніг), capDepth — її товщина.
    fillBelow(fn, c, opts) {
        const o = opts || {};
        for (let x = 0; x < this.w; x++) {
            const top = fn(x);
            const yStart = Math.max(0, Math.floor(top));
            for (let y = yStart; y < this.h; y++) {
                const cov = y === yStart ? clamp(yStart + 1 - top, 0, 1) : 1;
                let col = c;
                if (o.bottom) col = mixC(c, o.bottom, clamp((y - top) / Math.max(1, this.h - top), 0, 1));
                if (o.cap && y - top < (o.capDepth || 0) * (0.6 + 0.8 * (o.capNoise ? o.capNoise(x) : 0.5))) col = o.cap;
                this.px(x, y, col, cov * (o.alpha === undefined ? 1 : o.alpha));
            }
        }
    }

    // ----- післяобробка -----
    vignette(strength) {
        const cx = this.w / 2, cy = this.h / 2, maxD = Math.hypot(cx, cy);
        for (let y = 0; y < this.h; y++) {
            for (let x = 0; x < this.w; x++) {
                const d = Math.hypot(x - cx, y - cy) / maxD;
                const f = 1 - strength * d * d;
                const i = (y * this.w + x) * 3;
                this.d[i] *= f; this.d[i + 1] *= f; this.d[i + 2] *= f;
            }
        }
    }

    grain(amount, rng) {
        for (let i = 0; i < this.d.length; i += 3) {
            const n = (rng() - 0.5) * amount;
            this.d[i] += n; this.d[i + 1] += n; this.d[i + 2] += n;
        }
    }

    posterize(levels) {
        const step = 255 / (levels - 1);
        for (let i = 0; i < this.d.length; i++) this.d[i] = Math.round(this.d[i] / step) * step;
    }

    saturate(k) {
        for (let i = 0; i < this.d.length; i += 3) {
            const g = (this.d[i] + this.d[i + 1] + this.d[i + 2]) / 3;
            for (let j = 0; j < 3; j++) this.d[i + j] = g + (this.d[i + j] - g) * k;
        }
    }

    pixelate(block, levels) {
        const bw = Math.max(1, block);
        for (let by = 0; by < this.h; by += bw) {
            for (let bx = 0; bx < this.w; bx += bw) {
                let r = 0, g = 0, b = 0, n = 0;
                for (let y = by; y < Math.min(this.h, by + bw); y++) {
                    for (let x = bx; x < Math.min(this.w, bx + bw); x++) {
                        const i = (y * this.w + x) * 3;
                        r += this.d[i]; g += this.d[i + 1]; b += this.d[i + 2]; n++;
                    }
                }
                const step = 255 / (levels - 1);
                const col = [Math.round(r / n / step) * step, Math.round(g / n / step) * step, Math.round(b / n / step) * step];
                for (let y = by; y < Math.min(this.h, by + bw); y++) {
                    for (let x = bx; x < Math.min(this.w, bx + bw); x++) this.px(x, y, col, 1);
                }
            }
        }
    }

    toRGB() {
        const out = new Uint8Array(this.w * this.h * 3);
        for (let i = 0; i < out.length; i++) out[i] = clamp(Math.round(this.d[i]), 0, 255);
        return out;
    }
}

// ---------------------------------------------------------------------
// Розбір опису
// ---------------------------------------------------------------------
const WORDS = {
    night: /(ніч|ноч|night|темн|dark|місяч|луна|лунн|moon|зір|звезд|star|нічн|ночн)/,
    sunset: /(захід|заході|заходу|закат|sunset|вечір|вечер|evening|dusk|сутінк|сумерк)/,
    sunrise: /(світанок|світанк|рассвет|sunrise|dawn|ранок|ранк|утро|morning)/,
    day: /((?<![а-яіїєґ])день(?![а-яіїєґ])|\bday\b|денн|sunny|сонячн|солнечн|літо|лето|summer|ясн)/,
    snow: /(сніг|снег|snow|зима|зимов|winter|мороз)/,
    rain: /(дощ|дождь|rain|злив|ливень|гроз|storm|буря|thunder)/,
    fog: /(туман|fog|mist|димк)/,
    mountains: /(гор[аиуы]|гір|горн|mountain|скел|alps|альп|карпат|вершин|peak)/,
    sea: /(мор[еяюі]|ocean|океан|\bsea\b|хвил|волн|wave|пляж|beach|острів|остров|island|берег|shore|coast)/,
    lake: /(озер|\blake\b|ріка|річк|река|речк|river|ставок|пруд|pond)/,
    forest: /(ліс|лес|forest|woods|ялин|ёл|ель(?![а-яіїєґ])|елк|pine|сосн|jungle|джунгл)/,
    tree: /(дерев|tree|дуб|oak|береза|берёз|birch|клен|клён|maple)/,
    city: /(місто|города?\b|город|city|skyline|будівл|здани|небодряп|skyscraper|urban|кібер|cyber|неон|neon|вулиц|улиц|street)/,
    space: /(космос|space|галактик|galaxy|планет|planet|всесвіт|вселен|universe|nebula|туманніст|туманност|зоряне|звёздное|ракет|rocket|астронавт|astronaut|cosmic|орбіт|орбит)/,
    desert: /(пустел|desert|дюн|dune|пісок|песок|sahara|сахар|кактус|cactus)/,
    cat: /(кіт|кішк|кот(?![а-яіїєґ])|коти|кота|коту|котик|кошк|cat\b|cats\b|kitten|kitty|кошен|кошач|котенок|котёнок|мурч)/,
    house: /(будинк|будиноч|(?<![а-яіїєґ])дім(?![а-яіїєґ])|(?<![а-яіїєґ])дому(?![а-яіїєґ])|хата|хатин|(?<![а-яіїєґ])дом(?![а-яіїєґ])|(?<![а-яіїєґ])дома(?![а-яіїєґ])|домик|house|cottage|cabin|\bhome\b)/,
    flower: /(квіт|цвет|flower|троянд|(?<![а-яіїєґ])роз[аыу]\b|rose|тюльпан|tulip|ромашк|daisy|sakura|сакур|lotus|лотос|соняшн|подсолн|sunflower)/,
    rainbow: /(веселк|радуг|rainbow)/,
    boat: /(човен|лодк|\bboat\b|ship|корабл|яхт|yacht|парус|sail)/,
    rocket: /(ракет|rocket|shuttle|шатл)/,
    sunWord: /(сонц|солнц|\bsun\b|sunny)/,
    moonWord: /(місяц|луна|лунн|moon)/,
    starsWord: /(зір|звезд|star|галактик|galaxy)/,
    cloudWord: /(хмар|облак|cloud)/,
    abstract: /(абстракц|abstract|візерунок|узор|pattern|градієнт|градиент|gradient|фрактал|fractal|хвилі|волны)/
};

const COLORS = {
    red: { re: /(червон|красн|\bred\b|багрян|crimson)/, c: [215, 50, 60] },
    orange: { re: /(помаранч|оранжев|\borange\b|руд|рыж|ginger)/, c: [240, 140, 50] },
    yellow: { re: /(жовт|желт|жёлт|\byellow\b|золот|gold)/, c: [245, 205, 70] },
    green: { re: /(зелен|\bgreen\b|смарагд|изумруд|emerald)/, c: [70, 170, 90] },
    cyan: { re: /(блакитн|голуб|бірюз|бирюз|cyan|turquoise|teal)/, c: [70, 190, 205] },
    blue: { re: /(синій|синя|синє|сині|синий|синяя|синее|синие|\bblue\b|navy)/, c: [55, 100, 220] },
    purple: { re: /(фіолет|фиолет|purple|violet|ліловий|лиловый|bузл)/, c: [135, 80, 205] },
    pink: { re: /(рожев|розов|\bpink\b|magenta|малинов)/, c: [235, 110, 170] },
    white: { re: /(білий|біла|біле|білі|белый|белая|белое|белые|\bwhite\b)/, c: [245, 245, 250] },
    black: { re: /(чорн|черн|\bblack\b)/, c: [22, 22, 28] },
    gray: { re: /(сірий|сіра|сіре|сірі|серый|серая|серое|серые|\bgr[ae]y\b|silver|срібн|серебр)/, c: [130, 134, 144] },
    brown: { re: /(коричнев|\bbrown\b|карамел)/, c: [125, 85, 55] }
};

function parseScene(text) {
    const s = String(text || '').toLowerCase();
    const f = {};
    Object.keys(WORDS).forEach((k) => { f[k] = WORDS[k].test(s); });
    f.colors = [];
    Object.keys(COLORS).forEach((k) => { if (COLORS[k].re.test(s)) f.colors.push(k); });
    return f;
}

// ---------------------------------------------------------------------
// Палітри неба
// ---------------------------------------------------------------------
const SKY = {
    day: [[0, [62, 132, 224]], [0.55, [140, 200, 245]], [1, [208, 234, 252]]],
    sunset: [[0, [52, 38, 108]], [0.35, [168, 76, 120]], [0.7, [248, 128, 84]], [1, [255, 204, 120]]],
    sunrise: [[0, [92, 116, 196]], [0.45, [214, 160, 190]], [0.8, [255, 196, 150]], [1, [255, 224, 176]]],
    night: [[0, [6, 8, 30]], [0.6, [22, 30, 80]], [1, [52, 66, 128]]],
    space: [[0, [3, 3, 14]], [0.5, [10, 8, 34]], [1, [22, 12, 52]]]
};

function tintStops(stops, colorName, amount) {
    if (!colorName) return stops;
    const tint = COLORS[colorName].c;
    return stops.map(([t, c]) => [t, mixC(c, tint, amount)]);
}

// ---------------------------------------------------------------------
// Складові сцени
// ---------------------------------------------------------------------
function drawStars(cv, rng, count, maxY) {
    for (let i = 0; i < count; i++) {
        const x = rng() * cv.w, y = rng() * maxY;
        const r = rng() < 0.08 ? rng.range(1.3, 2.2) : rng.range(0.5, 1.2);
        const a = rng.range(0.45, 1);
        cv.circle(x, y, r, [255, 250, 235], a);
        if (r > 1.6) cv.glow(x, y, r * 5, [255, 245, 220], 0.35);
    }
}

function drawMoon(cv, cx, cy, r) {
    cv.glow(cx, cy, r * 4.2, [200, 215, 255], 0.5);
    cv.circle(cx, cy, r, [244, 241, 226], 1);
    cv.circle(cx - r * 0.3, cy - r * 0.15, r * 0.2, [222, 218, 200], 0.8);
    cv.circle(cx + r * 0.28, cy + r * 0.25, r * 0.26, [226, 222, 204], 0.8);
    cv.circle(cx + r * 0.1, cy - r * 0.45, r * 0.12, [226, 222, 204], 0.8);
}

function drawSun(cv, cx, cy, r, warm) {
    const glowC = warm ? [255, 190, 110] : [255, 240, 190];
    cv.glow(cx, cy, r * 6, glowC, 0.55);
    cv.glow(cx, cy, r * 2.6, [255, 235, 170], 0.55);
    cv.circle(cx, cy, r, warm ? [255, 226, 150] : [255, 248, 210], 1);
}

function drawClouds(cv, rng, count, yMin, yMax, color, alpha) {
    for (let i = 0; i < count; i++) {
        const cx = rng() * cv.w, cy = rng.range(yMin, yMax);
        const sz = rng.range(cv.w * 0.04, cv.w * 0.09);
        const puffs = rng.int(5, 8);
        for (let p = 0; p < puffs; p++) {
            const px = cx + (p - puffs / 2) * sz * 0.8 + rng.range(-sz * 0.2, sz * 0.2);
            const py = cy + rng.range(-sz * 0.3, sz * 0.25);
            const pr = sz * rng.range(0.55, 1);
            cv.circle(px, py, pr, color, alpha);
        }
        cv.ellipse(cx, cy + sz * 0.35, sz * puffs * 0.45, sz * 0.4, color, alpha);
    }
}

function drawRainbow(cv, cx, cy, r) {
    const bands = [[235, 70, 70], [245, 150, 60], [245, 220, 80], [90, 200, 110], [70, 140, 235], [130, 90, 210]];
    const bw = r * 0.045;
    bands.forEach((c, i) => cv.ring(cx, cy, r - i * bw, bw + 0.6, c, 0.55));
}

function ridgeFn(w, baseY, amp, freq, seed, rough) {
    return (x) => baseY - amp * (fbm(x / w * freq, seed * 0.37, seed, rough || 4) - 0.35);
}

function drawMountains(cv, rng, horizon, palette, snow) {
    const layers = 3;
    for (let l = 0; l < layers; l++) {
        const t = l / (layers - 1);
        const base = horizon - cv.h * (0.1 - t * 0.02) + t * cv.h * 0.12;
        const amp = cv.h * (0.5 - t * 0.17);
        const seed = rng.int(1, 9999);
        const fn = ridgeFn(cv.w, base, amp, 2.6 + t, seed, 5);
        const far = palette.far, near = palette.near;
        const col = mixC(far, near, t);
        cv.fillBelow(fn, col, {
            bottom: mixC(col, palette.haze, 0.45),
            cap: snow || palette.snowCap ? [236, 240, 250] : null,
            capDepth: cv.h * 0.055 * (1 - t * 0.5),
            capNoise: (x) => vnoise(x * 0.04, seed, seed)
        });
    }
}

function drawHills(cv, rng, horizon, colors) {
    colors.forEach((c, i) => {
        const base = horizon + i * cv.h * 0.07;
        const seed = rng.int(1, 9999);
        cv.fillBelow(ridgeFn(cv.w, base, cv.h * 0.13, 1.6 + i * 0.4, seed, 3), c, { bottom: mixC(c, [0, 0, 0], 0.25) });
    });
}

function drawPine(cv, x, baseY, h, col, snow) {
    const w = h * 0.5;
    const trunk = [70, 48, 36];
    cv.rect(x - w * 0.07, baseY - h * 0.16, w * 0.14, h * 0.18, trunk, 1);
    for (let k = 0; k < 3; k++) {
        const top = baseY - h * (0.95 - k * 0.0);
        const yTop = baseY - h * 0.16 - (h * 0.84) * ((k + 1) / 3);
        const yBot = baseY - h * 0.16 - (h * 0.84) * (k / 3) * 0.78;
        const half = w * (0.38 + k * 0.17) * 0.9;
        const c = mixC(col, [0, 0, 0], 0.1 * (2 - k) * 0.5);
        cv.poly([[x, yTop - h * 0.06], [x - half, yBot], [x + half, yBot]], c, 1);
        if (snow) cv.poly([[x, yTop - h * 0.06], [x - half * 0.55, yTop + (yBot - yTop) * 0.45], [x + half * 0.55, yTop + (yBot - yTop) * 0.45]], [244, 246, 252], 0.9);
        void top;
    }
}

function drawLeafTree(cv, rng, x, baseY, h, col) {
    cv.rect(x - h * 0.05, baseY - h * 0.5, h * 0.1, h * 0.52, [92, 62, 42], 1);
    const cr = h * 0.3;
    const centers = [[0, -0.62], [-0.22, -0.5], [0.22, -0.5], [-0.12, -0.8], [0.14, -0.78]];
    centers.forEach((p, i) => {
        cv.circle(x + p[0] * h, baseY + p[1] * h, cr * (0.85 + (i % 2) * 0.15), mixC(col, [0, 0, 0], 0.12 * (i % 3)), 1);
    });
    cv.circle(x - cr * 0.25, baseY - h * 0.85, cr * 0.4, mixC(col, [255, 255, 255], 0.2), 0.7);
}

function drawHouse(cv, x, baseY, u, lit) {
    const w = u * 2.6, h = u * 1.7;
    cv.rect(x - w / 2, baseY - h, w, h, [208, 160, 118], 1);
    cv.rect(x - w / 2, baseY - h * 0.22, w, h * 0.22, [176, 130, 94], 0.7);
    cv.poly([[x - w * 0.62, baseY - h], [x, baseY - h - u * 1.15], [x + w * 0.62, baseY - h]], [150, 58, 52], 1);
    cv.rect(x + w * 0.22, baseY - h - u * 1.05, u * 0.3, u * 0.7, [120, 80, 70], 1);
    cv.rect(x - u * 0.28, baseY - h * 0.62, u * 0.56, h * 0.62, [96, 64, 46], 1);
    cv.circle(x + u * 0.16, baseY - h * 0.3, u * 0.035, [240, 200, 90], 1);
    const win = lit ? [255, 222, 120] : [170, 210, 240];
    if (lit) cv.glow(x - w * 0.3, baseY - h * 0.62, u * 1.4, [255, 200, 90], 0.5);
    cv.rect(x - w * 0.43, baseY - h * 0.78, u * 0.5, u * 0.5, win, 1);
    cv.rect(x + w * 0.2, baseY - h * 0.78, u * 0.5, u * 0.5, win, 1);
    cv.rect(x - w * 0.43 + u * 0.24, baseY - h * 0.78, u * 0.03, u * 0.5, [90, 60, 44], 0.8);
    cv.rect(x + w * 0.2 + u * 0.24, baseY - h * 0.78, u * 0.03, u * 0.5, [90, 60, 44], 0.8);
    if (lit) {
        [0, 1, 2].forEach((i) => cv.circle(x + w * 0.3 + i * u * 0.22, baseY - h - u * (1.35 + i * 0.35), u * (0.22 + i * 0.1), [225, 225, 232], 0.4 - i * 0.08));
    }
}

function drawFlower(cv, rng, x, baseY, h, petal) {
    cv.line(x, baseY, x + rng.range(-h * 0.1, h * 0.1), baseY - h, Math.max(1.5, h * 0.06), [66, 150, 84], 1);
    const cy = baseY - h;
    for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3;
        cv.circle(x + Math.cos(a) * h * 0.2, cy + Math.sin(a) * h * 0.2, h * 0.17, petal, 1);
    }
    cv.circle(x, cy, h * 0.14, [250, 205, 70], 1);
}

function drawBoat(cv, x, y, u, hullCol) {
    cv.poly([[x - u * 1.3, y - u * 0.3], [x + u * 1.3, y - u * 0.3], [x + u * 0.9, y + u * 0.2], [x - u * 0.9, y + u * 0.2]], hullCol, 1);
    cv.rect(x - u * 0.03, y - u * 2.2, u * 0.06, u * 1.95, [90, 70, 60], 1);
    cv.poly([[x + u * 0.08, y - u * 2.1], [x + u * 0.08, y - u * 0.5], [x + u * 1.0, y - u * 0.5]], [246, 246, 250], 1);
    cv.poly([[x - u * 0.08, y - u * 1.8], [x - u * 0.08, y - u * 0.5], [x - u * 0.8, y - u * 0.5]], [232, 90, 80], 1);
}

function drawRocket(cv, x, y, u, rotation) {
    const rot = rotation || -0.5;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const T = (px, py) => [x + px * cs - py * sn, y + px * sn + py * cs];
    const P = (pts) => pts.map((p) => T(p[0] * u, p[1] * u));
    cv.poly(P([[-0.3, 1.2], [0, 2.3], [0.3, 1.2]]), [255, 150, 50], 0.95);
    cv.poly(P([[-0.15, 1.2], [0, 1.9], [0.15, 1.2]]), [255, 230, 120], 0.95);
    cv.poly(P([[-0.55, 0.3], [-0.55, 1.15], [-0.28, 0.9]]), [210, 60, 60], 1);
    cv.poly(P([[0.55, 0.3], [0.55, 1.15], [0.28, 0.9]]), [210, 60, 60], 1);
    cv.poly(P([[-0.34, 1.2], [-0.34, -0.3], [-0.22, -1.0], [0, -1.6], [0.22, -1.0], [0.34, -0.3], [0.34, 1.2]]), [238, 240, 246], 1);
    cv.poly(P([[-0.22, -1.0], [0, -1.6], [0.22, -1.0]]), [210, 60, 60], 1);
    const w = T(0, -0.2);
    cv.circle(w[0], w[1], u * 0.2, [60, 120, 200], 1);
    cv.circle(w[0] - u * 0.05, w[1] - u * 0.05, u * 0.07, [180, 220, 255], 0.9);
}

function drawPlanet(cv, cx, cy, r, base, ring) {
    if (ring) cv.ellipse(cx, cy, r * 1.9, r * 0.42, [230, 210, 170], 0.35, -0.35);
    cv.circle(cx, cy, r, base, 1);
    cv.circle(cx - r * 0.25, cy - r * 0.25, r * 0.85, mixC(base, [255, 255, 255], 0.25), 0.35);
    cv.circle(cx + r * 0.45, cy + r * 0.4, r * 0.95, [0, 0, 20], 0.35);
    cv.ellipse(cx, cy + r * 0.1, r, r * 0.12, mixC(base, [0, 0, 0], 0.25), 0.35, -0.2);
    cv.ellipse(cx, cy - r * 0.3, r * 0.9, r * 0.09, mixC(base, [255, 255, 255], 0.35), 0.25, -0.2);
    if (ring) {
        // передня частина кільця
        for (let a = 0; a < Math.PI; a += 0.04) {
            const ex = Math.cos(a + Math.PI) * r * 1.9, ey = Math.sin(a + Math.PI) * r * 0.42;
            const cs = Math.cos(-0.35), sn = Math.sin(-0.35);
            cv.circle(cx + ex * cs - ey * sn, cy + ex * sn + ey * cs + 0.0, Math.max(1, r * 0.03), [236, 216, 176], 0.32);
        }
    }
}

// Кішка, що сидить (вид спереду). u — одиниця розміру (радіус голови ≈ 0.8u)
function drawCat(cv, rng, cx, baseY, u, fur, eyeCol, rim) {
    const dark = mixC(fur, [0, 0, 0], 0.3);
    const light = mixC(fur, [255, 255, 255], 0.22);
    const bodyY = baseY - u * 1.0;
    const headY = baseY - u * 2.45;

    // хвіст: плавна крива, що звужується до кінчика
    const t0 = [cx + u * 0.7, baseY - u * 0.22], t1 = [cx + u * 2.05, baseY - u * 0.35], t2 = [cx + u * 1.55, baseY - u * 1.9];
    let prev = null;
    for (let i = 0; i <= 14; i++) {
        const t = i / 14, q = 1 - t;
        const px = q * q * t0[0] + 2 * q * t * t1[0] + t * t * t2[0];
        const py = q * q * t0[1] + 2 * q * t * t1[1] + t * t * t2[1];
        const wd = u * (0.36 - 0.14 * t);
        if (prev) cv.line(prev[0], prev[1], px, py, wd, fur, 1);
        cv.circle(px, py, wd / 2, fur, 1);
        prev = [px, py];
    }

    // контурне світло: трохи зсунута кольорова копія під силуетом
    if (rim) {
        cv.ellipse(cx - u * 0.045, bodyY, u * 0.97, u * 1.11, rim, 0.7);
        cv.circle(cx - u * 0.04, headY, u * 0.86, rim, 0.7);
    }

    // тіло, лапи
    cv.ellipse(cx, bodyY, u * 0.95, u * 1.1, fur, 1);
    cv.ellipse(cx - u * 0.62, baseY - u * 0.28, u * 0.5, u * 0.3, fur, 1);
    cv.ellipse(cx + u * 0.62, baseY - u * 0.28, u * 0.5, u * 0.3, fur, 1);
    cv.ellipse(cx - u * 0.28, baseY - u * 0.3, u * 0.24, u * 0.42, light, 0.35);
    cv.ellipse(cx + u * 0.28, baseY - u * 0.3, u * 0.24, u * 0.42, light, 0.35);
    cv.line(cx - u * 0.28, baseY - u * 0.02, cx - u * 0.28, baseY - u * 0.4, u * 0.03, dark, 0.5);
    cv.line(cx + u * 0.28, baseY - u * 0.02, cx + u * 0.28, baseY - u * 0.4, u * 0.03, dark, 0.5);

    // вуха
    const earL = [[cx - u * 0.82, headY - u * 0.15], [cx - u * 0.66, headY - u * 1.2], [cx - u * 0.1, headY - u * 0.72]];
    const earR = [[cx + u * 0.82, headY - u * 0.15], [cx + u * 0.66, headY - u * 1.2], [cx + u * 0.1, headY - u * 0.72]];
    cv.poly(earL, fur, 1);
    cv.poly(earR, fur, 1);
    cv.poly([[cx - u * 0.7, headY - u * 0.3], [cx - u * 0.62, headY - u * 0.95], [cx - u * 0.25, headY - u * 0.65]], [226, 140, 150], 0.85);
    cv.poly([[cx + u * 0.7, headY - u * 0.3], [cx + u * 0.62, headY - u * 0.95], [cx + u * 0.25, headY - u * 0.65]], [226, 140, 150], 0.85);

    // голова
    cv.circle(cx, headY, u * 0.84, fur, 1);
    cv.ellipse(cx, headY + u * 0.28, u * 0.45, u * 0.34, light, 0.3);

    // смужки на лобі
    if (fur[0] > 170 && fur[2] < 110) {
        [-0.22, 0, 0.22].forEach((o) => cv.line(cx + o * u, headY - u * 0.78, cx + o * u * 0.8, headY - u * 0.4, u * 0.07, dark, 0.85));
    }

    // очі
    [-1, 1].forEach((sgn) => {
        const ex = cx + sgn * u * 0.33, ey = headY - u * 0.04;
        cv.glow(ex, ey, u * 0.55, eyeCol, 0.25);
        cv.ellipse(ex, ey, u * 0.19, u * 0.22, eyeCol, 1);
        cv.ellipse(ex, ey, u * 0.055, u * 0.19, [12, 12, 16], 1);
        cv.circle(ex - u * 0.06, ey - u * 0.08, u * 0.04, [255, 255, 255], 0.9);
    });

    // ніс, рот, вуса
    cv.poly([[cx - u * 0.07, headY + u * 0.16], [cx + u * 0.07, headY + u * 0.16], [cx, headY + u * 0.25]], [230, 130, 150], 1);
    cv.line(cx, headY + u * 0.25, cx - u * 0.12, headY + u * 0.37, u * 0.03, dark, 0.8);
    cv.line(cx, headY + u * 0.25, cx + u * 0.12, headY + u * 0.37, u * 0.03, dark, 0.8);
    [-1, 1].forEach((sgn) => {
        [-0.07, 0.04, 0.15].forEach((dy, i) => {
            cv.line(cx + sgn * u * 0.32, headY + u * (0.24 + dy * 0.6), cx + sgn * u * (1.0 + i * 0.06), headY + u * (0.1 + dy * 1.6), Math.max(1, u * 0.018), [240, 240, 244], 0.8);
        });
    });
}

// ---------------------------------------------------------------------
// Головна сцена
// ---------------------------------------------------------------------
function composeScene(cv, f, rng) {
    const W = cv.w, H = cv.h, U = Math.min(W, H);
    const furColors = ['white', 'black', 'gray', 'brown', 'orange'];
    const tintCandidates = f.colors.filter((c) => !['white', 'black', 'gray', 'brown'].includes(c) && !(f.cat && furColors.includes(c)));
    const tint = tintCandidates[0] || null;

    // ---- час доби ----
    let tod;
    if (f.space) tod = 'space';
    else if (f.sunset) tod = 'sunset';
    else if (f.sunrise) tod = 'sunrise';
    else if (f.night || f.moonWord || f.starsWord) tod = 'night';
    else if (f.day) tod = 'day';
    else tod = rng.pick(['day', 'sunset', 'night', 'day']);
    if (f.cat && !f.night && !f.sunset && !f.sunrise && !f.day && !f.space && !f.house && !f.mountains && !f.sea && !f.forest && !f.city && !f.desert) {
        tod = 'night';
    }
    const night = tod === 'night' || tod === 'space';

    const horizon = H * (f.sea ? 0.6 : (f.cat && !(f.mountains || f.sea || f.forest || f.city || f.desert || f.house) ? 0.74 : 0.66));

    // ---- небо ----
    let stops = SKY[tod];
    if (f.rain || f.fog) stops = stops.map(([t, c]) => [t, mixC(c, [120, 128, 140], 0.55)]);
    stops = tintStops(stops, tint, tod === 'space' ? 0.35 : 0.4);
    cv.gradV(stops);

    // туманність у космосі
    if (tod === 'space') {
        const seed = rng.int(1, 9999);
        const c1 = tint ? COLORS[tint].c : rng.pick([[120, 60, 200], [40, 110, 210], [200, 70, 140]]);
        const c2 = rng.pick([[40, 140, 220], [230, 120, 70], [90, 200, 190]]);
        for (let y = 0; y < H; y += 1) {
            for (let x = 0; x < W; x += 1) {
                const n = fbm(x / W * 3.2, y / H * 3.2, seed, 5);
                const k = clamp((n - 0.45) * 2.6, 0, 1);
                if (k > 0.01) cv.px(x, y, mixC(c1, c2, vnoise(x / W * 2, y / H * 2, seed + 7)), k * 0.55);
            }
        }
    }

    if (night) drawStars(cv, rng, tod === 'space' ? 520 : 260, tod === 'space' ? H : horizon * 0.95);
    if (!night) {
        const sunX = W * rng.range(0.2, 0.8);
        const sunY = tod === 'day' ? H * rng.range(0.14, 0.26) : horizon - H * (tod === 'sunset' ? 0.04 : 0.07);
        if (f.sunWord || tod !== 'night') drawSun(cv, sunX, sunY, U * (tod === 'day' ? 0.06 : 0.085), tod !== 'day');
        cv._sun = [sunX, sunY];
    }
    if (tod === 'night' && (f.moonWord || !f.cat || rng() < 0.7)) {
        const mx = W * rng.range(0.55, 0.85), my = H * rng.range(0.14, 0.28);
        drawMoon(cv, mx, my, U * 0.085);
        cv._moon = [mx, my];
    }
    if (f.cloudWord || f.rain || (!night && rng() < 0.8) || f.fog) {
        const cc = night ? [70, 78, 120] : (f.rain ? [150, 156, 168] : [255, 255, 255]);
        drawClouds(cv, rng, f.rain ? 9 : rng.int(3, 6), H * 0.06, horizon * 0.62, cc, night ? 0.35 : (f.rain ? 0.7 : 0.85));
    }
    if (f.rainbow) drawRainbow(cv, W * 0.5, horizon + U * 0.12, U * 0.62);

    // ---- космос ----
    if (tod === 'space') {
        const pr = U * rng.range(0.12, 0.2);
        drawPlanet(cv, W * rng.range(0.22, 0.42), H * rng.range(0.25, 0.42), pr, rng.pick([[220, 130, 80], [90, 150, 215], [200, 90, 140], [110, 190, 150]]), true);
        drawPlanet(cv, W * rng.range(0.7, 0.88), H * rng.range(0.6, 0.78), pr * 0.5, rng.pick([[200, 190, 170], [110, 90, 200], [230, 200, 90]]), false);
        if (f.rocket || !f.cat) drawRocket(cv, W * 0.62, H * 0.4, U * 0.1, -0.6);
        if (f.cat) drawCat(cv, rng, W * 0.5, H * 0.92, U * 0.17, [40, 40, 52], [240, 220, 80], [150, 170, 255]);
        return;
    }

    // ---- ґрунт ----
    const snowy = f.snow;
    const dayTint = night ? 0.45 : (tod === 'day' ? 1 : 0.8);
    const shade = (c) => mixC([6, 8, 24], c, dayTint);
    const warm = tod === 'sunset' || tod === 'sunrise';
    const hazeC = night ? [40, 50, 100] : (warm ? [255, 190, 140] : [200, 220, 240]);
    let groundTop = horizon;
    let waterLine = null;

    if (f.city) {
        const layers = [{ c: night ? [22, 26, 56] : [120, 130, 160], hmin: 0.2, hmax: 0.45 }, { c: night ? [12, 14, 34] : [70, 78, 104], hmin: 0.15, hmax: 0.36 }];
        layers.forEach((layer, li) => {
            let x = -10;
            while (x < W) {
                const bw = rng.range(U * 0.05, U * 0.12);
                const bh = H * rng.range(layer.hmin, layer.hmax) * (0.7 + 0.5 * rng());
                const by = horizon + H * 0.03 * li - bh + H * 0.05;
                const bc = mixC(layer.c, [0, 0, 0], 0.08 * rng());
                cv.rect(x, by, bw, bh + H * 0.2, bc, 1);
                if (rng() < 0.35) cv.rect(x + bw * 0.45, by - bh * 0.12, bw * 0.1, bh * 0.12, bc, 1);
                const cols = Math.max(2, Math.floor(bw / (U * 0.018)));
                const rows = Math.floor(bh / (U * 0.03));
                const neon = tint ? COLORS[tint].c : rng.pick([[255, 214, 110], [120, 220, 255], [255, 120, 200]]);
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        if (rng() < (night ? 0.55 : 0.18)) {
                            cv.rect(x + bw * 0.12 + c * (bw * 0.76 / cols), by + U * 0.012 + r * U * 0.03, bw * 0.76 / cols * 0.6, U * 0.016, night ? mixC([255, 226, 140], neon, rng() * 0.6) : [190, 214, 240], night ? 0.95 : 0.8);
                        }
                    }
                }
                x += bw + rng.range(0, U * 0.01);
            }
        });
        cv.fillBelow(() => horizon + H * 0.2, night ? [18, 20, 36] : [64, 68, 82], { bottom: night ? [8, 8, 18] : [30, 32, 42] });
        // калюжі/відблиски на дорозі
        for (let i = 0; i < 24; i++) cv.ellipse(rng() * W, rng.range(horizon + H * 0.24, H), rng.range(U * 0.03, U * 0.11), U * 0.006, night ? [255, 220, 150] : [230, 236, 245], 0.2);
        groundTop = horizon + H * 0.2;
    } else if (f.desert) {
        const sandA = warm ? [226, 140, 84] : [236, 192, 120];
        for (let i = 0; i < 3; i++) {
            const base = horizon - H * 0.02 + i * H * 0.1;
            const seed = rng.int(1, 9999);
            cv.fillBelow((x) => base - H * 0.07 * Math.sin(x / W * (3 + i) + seed) - H * 0.03 * fbm(x / W * 4, i, seed, 3), shade(mixC(sandA, [150, 90, 60], i * 0.22)), { bottom: shade(mixC(sandA, [120, 70, 50], 0.5)) });
        }
        const cx = W * rng.range(0.2, 0.8);
        const cy = H * 0.85;
        const g = shade([60, 130, 80]);
        cv.rect(cx - U * 0.015, cy - U * 0.18, U * 0.03, U * 0.18, g, 1);
        cv.rect(cx - U * 0.06, cy - U * 0.12, U * 0.045, U * 0.02, g, 1);
        cv.rect(cx - U * 0.06, cy - U * 0.15, U * 0.02, U * 0.05, g, 1);
        cv.rect(cx + U * 0.015, cy - U * 0.09, U * 0.05, U * 0.02, g, 1);
        cv.rect(cx + U * 0.045, cy - U * 0.13, U * 0.02, U * 0.06, g, 1);
        groundTop = horizon + H * 0.1;
    } else if (f.sea) {
        if (f.mountains) drawMountains(cv, rng, horizon, { far: shade([120, 140, 175]), near: shade([70, 90, 120]), haze: hazeC }, snowy);
        const top = night ? [14, 30, 80] : (warm ? [226, 120, 100] : [48, 130, 200]);
        const bot = night ? [6, 12, 40] : (warm ? [90, 50, 100] : [14, 70, 140]);
        const wTop = tint ? mixC(top, COLORS[tint].c, 0.3) : top;
        for (let y = Math.floor(horizon); y < H; y++) {
            const t = (y - horizon) / (H - horizon);
            const c = mixC(wTop, bot, Math.pow(t, 0.8));
            for (let x = 0; x < W; x++) cv.px(x, y, c, 1);
        }
        // відблиск світила на воді
        const src = cv._sun || cv._moon;
        if (src) {
            const col = night ? [235, 240, 255] : [255, 235, 170];
            for (let i = 0; i < 46; i++) {
                const y = horizon + 6 + i * (H - horizon) / 48;
                const wdt = (6 + i * 1.6) * (U / 600) * (0.6 + rng());
                cv.ellipse(src[0] + rng.range(-1, 1) * (4 + i * 0.7), y, wdt, Math.max(1.2, U * 0.0035), col, 0.5 - i * 0.008);
            }
        }
        // хвилі
        for (let i = 0; i < 90; i++) {
            const y = rng.range(horizon + 6, H);
            const t = (y - horizon) / (H - horizon);
            cv.ellipse(rng() * W, y, rng.range(U * 0.02, U * 0.07) * (0.5 + t), Math.max(1, U * 0.003 * (0.6 + t)), night ? [120, 150, 220] : [230, 245, 255], 0.22);
        }
        cv.rect(0, horizon - 1.5, W, 3, hazeC, 0.55);
        waterLine = horizon;
        if (f.boat || (!f.cat && rng() < 0.5)) drawBoat(cv, W * rng.range(0.25, 0.7), horizon + H * 0.14, U * 0.06, shade([150, 70, 60]));
        groundTop = H;
    } else if (f.mountains) {
        drawMountains(cv, rng, horizon, { far: shade([120, 138, 176]), near: shade([58, 78, 104]), haze: hazeC }, snowy || tod === 'day' && rng() < 0.6);
        if (f.lake) {
            const ly = horizon + H * 0.12;
            for (let y = Math.floor(ly); y < H; y++) {
                const t = (y - ly) / (H - ly);
                const c = mixC(night ? [20, 36, 84] : [96, 156, 206], night ? [8, 14, 40] : [32, 90, 150], t);
                for (let x = 0; x < W; x++) cv.px(x, y, c, 1);
            }
            groundTop = ly;
        } else {
            drawHills(cv, rng, horizon + H * 0.1, [shade(snowy ? [226, 232, 244] : [70, 130, 82]), shade(snowy ? [244, 247, 252] : [48, 108, 70])]);
            groundTop = horizon + H * 0.1;
        }
    } else if (f.forest || f.tree) {
        drawHills(cv, rng, horizon, [shade(snowy ? [226, 232, 244] : [74, 140, 84]), shade(snowy ? [240, 244, 252] : [52, 112, 72])]);
        groundTop = horizon;
    } else {
        drawHills(cv, rng, horizon, [shade(snowy ? [226, 232, 244] : [96, 164, 92]), shade(snowy ? [244, 247, 252] : [62, 130, 78]), shade(snowy ? [250, 252, 255] : [46, 104, 64])]);
        groundTop = horizon;
    }

    // ---- ліс / дерева ----
    if (f.forest) {
        const count = Math.floor(W / (U * 0.055));
        for (let i = 0; i < count; i++) {
            const x = rng() * W;
            const depth = rng();
            const baseY = horizon + H * 0.05 + depth * (H - horizon) * 0.55;
            const h = U * (0.1 + depth * 0.26);
            drawPine(cv, x, baseY, h, shade(mixC([30, 90, 62], [60, 130, 80], rng())), snowy);
        }
    } else if (f.tree) {
        const n = rng.int(2, 4);
        for (let i = 0; i < n; i++) {
            const x = W * (0.12 + 0.76 * (i + rng() * 0.5) / n);
            const baseY = H * rng.range(0.76, 0.92);
            drawLeafTree(cv, rng, x, baseY, U * rng.range(0.28, 0.42), shade(snowy ? [190, 205, 215] : [64, 150, 80]));
        }
    }

    // ---- будинок ----
    let houseX = null, houseBase = null;
    if (f.house) {
        houseX = W * rng.range(0.28, 0.5);
        houseBase = Math.min(H * 0.9, Math.max(groundTop + H * 0.1, H * 0.78));
        drawHouse(cv, houseX, houseBase, U * 0.1, night || warm);
    }

    // ---- квіти ----
    if (f.flower) {
        const petal = tint ? COLORS[tint].c : rng.pick([[235, 90, 120], [250, 240, 245], [255, 190, 60], [170, 110, 220]]);
        const n = Math.floor(W / (U * 0.07));
        for (let i = 0; i < n; i++) {
            drawFlower(cv, rng, rng() * W, H * rng.range(0.8, 1.0), U * rng.range(0.07, 0.16), mixC(petal, [rng() * 255, rng() * 255, rng() * 255], 0.12));
        }
    }

    // ---- кішка ----
    if (f.cat) {
        const furName = f.colors.find((c) => ['black', 'white', 'orange', 'gray', 'brown'].includes(c));
        const fur = furName === 'white' ? [236, 236, 242] : furName === 'orange' || (!furName && !night) ? [222, 128, 52]
            : furName === 'gray' ? [128, 132, 142] : furName === 'brown' ? [120, 82, 54] : [26, 26, 34];
        const eye = fur[0] < 60 ? [235, 215, 70] : [90, 190, 120];
        const rim = night ? [120, 150, 255] : (warm ? [255, 190, 120] : null);
        const alone = !(f.mountains || f.sea || f.forest || f.city || f.desert || f.house || f.tree);
        const u = U * (alone ? 0.2 : 0.11);
        let cx = W * (alone ? 0.5 : rng.range(0.5, 0.82));
        let base = alone ? H * 0.95 : Math.min(H * 0.94, groundTop + H * 0.2);
        if (f.house && houseX !== null) { cx = houseX + U * 0.36; base = houseBase + U * 0.015; }
        if (alone && (cv._moon || cv._sun)) {
            const src = cv._moon || cv._sun;
            cx = clamp(src[0] + rng.range(-U * 0.1, U * 0.1), W * 0.36, W * 0.58);
        }
        drawCat(cv, rng, cx, base, u, fur, eye, rim);
    }

    // ---- дощ ----
    if (f.rain) {
        const n = Math.floor(W * H / 1800);
        for (let i = 0; i < n; i++) {
            const x = rng() * W, y = rng() * H, len = rng.range(U * 0.02, U * 0.045);
            cv.line(x, y, x - len * 0.25, y + len, Math.max(1, U * 0.0018), [200, 214, 235], 0.4);
        }
        cv.rect(0, 0, W, H, [30, 40, 70], night ? 0.05 : 0.12);
    }
    // ---- сніг ----
    if (f.snow) {
        const n = Math.floor(W * H / 2400);
        for (let i = 0; i < n; i++) cv.circle(rng() * W, rng() * H, rng.range(1, U * 0.006), [255, 255, 255], rng.range(0.6, 0.95));
    }
    // ---- туман ----
    if (f.fog) {
        for (let k = 0; k < 4; k++) {
            const y = H * (0.45 + k * 0.12);
            for (let yy = -40; yy <= 40; yy++) {
                const a = (1 - Math.abs(yy) / 40) * 0.22;
                cv.rect(0, y + yy, W, 1, [226, 230, 238], a);
            }
        }
    }
    void waterLine;
}

// Абстрактна композиція (коли в описі немає впізнаваних предметів)
function composeAbstract(cv, f, rng, text) {
    const W = cv.w, H = cv.h, U = Math.min(W, H);
    const base = f.colors.length ? f.colors.map((n) => COLORS[n].c) : [];
    const hue = () => {
        const h = rng() * 6, k = h % 1, q = 1 - k;
        const [r, g, b] = [[1, k, 0], [q, 1, 0], [0, 1, k], [0, q, 1], [k, 0, 1], [1, 0, q]][Math.floor(h) % 6];
        return [90 + r * 150, 90 + g * 150, 90 + b * 150];
    };
    const palette = [];
    for (let i = 0; i < 5; i++) palette.push(base.length ? mixC(base[i % base.length], [rng() * 255, rng() * 255, rng() * 255], 0.25) : hue());
    cv.gradV([[0, mixC(palette[0], [0, 0, 0], 0.55)], [0.55, mixC(palette[1], [0, 0, 0], 0.25)], [1, mixC(palette[2], [255, 255, 255], 0.1)]]);
    for (let i = 0; i < 9; i++) cv.glow(rng() * W, rng() * H, U * rng.range(0.3, 0.7), palette[i % palette.length], 0.5);
    for (let i = 0; i < 16; i++) cv.circle(rng() * W, rng() * H, U * rng.range(0.03, 0.2), palette[(i + 1) % palette.length], rng.range(0.12, 0.35));
    for (let k = 0; k < 6; k++) {
        const y0 = H * rng.range(0.25, 0.85), amp = H * rng.range(0.03, 0.12), fr = rng.range(1.5, 5), ph = rng() * 6.28;
        const col = mixC(palette[k % palette.length], [255, 255, 255], 0.2);
        cv.fillBelow((x) => y0 + amp * Math.sin(x / W * fr * 6.28 + ph) + amp * 0.5 * Math.sin(x / W * fr * 15 + ph), col, { bottom: mixC(col, [0, 0, 0], 0.4), alpha: 0.38 });
    }
    for (let i = 0; i < 4; i++) cv.ring(W * rng.range(0.2, 0.8), H * rng.range(0.2, 0.8), U * rng.range(0.08, 0.3), U * 0.006, [255, 255, 255], 0.35);
    drawStars(cv, rng, 90, H);
    void text;
}

// ---------------------------------------------------------------------
// Публічний API
// ---------------------------------------------------------------------
function sizeFor(text, sizeSetting) {
    const s = String(text || '').toLowerCase();
    let mode = sizeSetting;
    if (!mode || mode === 'auto') {
        if (/(горизонталь|landscape|16:9|широк|панорам|wallpaper|обої на комп|обои на комп)/.test(s)) mode = 'landscape';
        else if (/(вертикаль|portrait|9:16|для телефон|сторіс|stories|обої на телефон|обои на телефон)/.test(s)) mode = 'portrait';
        else mode = 'square';
    }
    if (mode === 'landscape') return { w: 1024, h: 576 };
    if (mode === 'portrait') return { w: 576, h: 1024 };
    return { w: 768, h: 768 };
}

function render(promptText, options) {
    const opts = options || {};
    const text = String(promptText || '');
    const size = sizeFor(text, opts.size);
    const seed = (hashString(text) ^ (opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 4294967295))) >>> 0;
    const rng = makeRng(seed);
    const cv = new Canvas(size.w, size.h);
    const f = parseScene(text);

    const scene = f.cat || f.space || f.city || f.desert || f.sea || f.mountains || f.forest || f.tree || f.house || f.flower
        || f.rainbow || f.boat || f.rocket || f.lake || f.snow || f.rain || f.fog || f.night || f.sunset || f.sunrise || f.day
        || f.sunWord || f.moonWord || f.starsWord || f.cloudWord;
    if (scene && !f.abstract) composeScene(cv, f, rng); else composeAbstract(cv, f, rng, text);

    // стиль
    const style = opts.style || 'auto';
    if (style === 'pixel') cv.pixelate(Math.max(4, Math.round(Math.min(size.w, size.h) / 110)), 7);
    else if (style === 'anime') { cv.saturate(1.25); cv.posterize(16); }
    else if (style === 'art') { cv.saturate(1.1); cv.grain(16, rng); cv.vignette(0.18); }
    else if (style === 'render3d') { cv.saturate(1.12); cv.vignette(0.35); }
    else if (style === 'realistic') { cv.grain(9, rng); cv.vignette(0.3); }
    else { cv.vignette(0.22); }

    return { mime: 'image/png', data: encodePNG(size.w, size.h, cv.toRGB()), width: size.w, height: size.h };
}

module.exports = { render, parseScene, encodePNG };
