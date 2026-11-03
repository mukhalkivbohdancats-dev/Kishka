// =====================================================================
// ===== CHATGPT (OpenAI) для Kishka Messenger =====
// Окремий модуль: підключається з server.js одним викликом initChatGPT({...}).
//
// Environment (Render -> Environment):
//   CHATGPT_API_KEY        — ключ OpenAI (platform.openai.com -> API keys). ОБОВʼЯЗКОВО.
//   CHATGPT_MODEL          — модель за замовчуванням (необовʼязково, напр. gpt-5.5)
//   CHATGPT_EXTRA_MODELS   — додаткові моделі, через кому:  id|Назва|text   (type: text | image | audio)
//   CHATGPT_HIDE_MODELS    — id моделей, які треба сховати зі списку, через кому
//   CHATGPT_API_BASE       — необовʼязково, адреса API (за замовчуванням https://api.openai.com)
//   CHATGPT_TTS_VOICE      — голос озвучки (за замовчуванням alloy)
//
// Події сокета (так само, як у Gemini):
//   chatgpt_get_models, chatgpt_get_history, chatgpt_get_status, chatgpt_send, chatgpt_cancel, chatgpt_clear
//   Сервер надсилає: chatgpt_progress {kind, seconds, model}, chatgpt_done {success, reply | error}
//
// Список моделей береться НАЖИВО з GET /v1/models вашого ключа (тому там завжди ті самі моделі, що й на платформі),
// а для знайомих моделей додаються красиві назви й описи.
// Обмежень на нашому боці немає: при ліміті Google/OpenAI сервер чекає стільки, скільки просить сервіс, і повторює запит,
// доки відповідь не прийде або користувач не натисне «Стоп».
// =====================================================================
'use strict';

const https = require('https');
const http = require('http');
const crypto = require('crypto');

// Моделі, які було видно у списку платформи OpenAI. Якщо живий список недоступний — показуємо їх.
const STATIC_MODELS = [
    { id: 'gpt-6.1-sol',               label: 'GPT-6.1 Sol',                 note: 'Майже як Astra, дешевше' },
    { id: 'gpt-6-astra',               label: 'GPT-6 Astra',                 note: 'Найпотужніша модель для найскладніших завдань' },
    { id: 'gpt-6-sol',                 label: 'GPT-6 Sol',                   note: 'Складний код і агентні процеси' },
    { id: 'gpt-6-luna',                label: 'GPT-6 Luna',                  note: 'Найефективніша модель для масових завдань' },
    { id: 'gpt-5.6-sol',               label: 'GPT-5.6 Sol',                 note: '' },
    { id: 'gpt-5.5',                   label: 'GPT-5.5',                     note: 'Новий клас інтелекту для професійної роботи' },
    { id: 'gpt-5.5-pro',               label: 'GPT-5.5 Pro',                 note: '' },
    { id: 'gpt-5.5-2026-04-23',        label: 'GPT-5.5 (2026-04-23)',        note: '' },
    { id: 'gpt-5.4',                   label: 'GPT-5.4',                     note: 'Інтелект у масштабі для агентів і професійної роботи' },
    { id: 'gpt-5.4-pro',               label: 'GPT-5.4 Pro',                 note: '' },
    { id: 'gpt-5.4-pro-2026-03-05',    label: 'GPT-5.4 Pro (2026-03-05)',    note: '' },
    { id: 'gpt-5.4-nano-2026-03-17',   label: 'GPT-5.4 Nano (2026-03-17)',   note: '' },
    { id: 'gpt-5.3-codex',             label: 'GPT-5.3 Codex',               note: 'Код' },
    { id: 'gpt-5.2-pro',               label: 'GPT-5.2 Pro',                 note: '' },
    { id: 'gpt-5.2-pro-2025-12-11',    label: 'GPT-5.2 Pro (2025-12-11)',    note: '' },
    { id: 'gpt-5.2-2025-12-11',        label: 'GPT-5.2 (2025-12-11)',        note: '' },
    { id: 'gpt-5',                     label: 'GPT-5',                       note: '' },
    { id: 'gpt-5-2025-08-07',          label: 'GPT-5 (2025-08-07)',          note: '' },
    { id: 'gpt-5-mini',                label: 'GPT-5 mini',                  note: 'Менша й швидша версія GPT-5' },
    { id: 'gpt-5-mini-2025-08-07',     label: 'GPT-5 mini (2025-08-07)',     note: '' },
    { id: 'gpt-5-nano',                label: 'GPT-5 nano',                  note: 'Найшвидша й найекономніша' },
    { id: 'o3-2025-04-16',             label: 'o3 (2025-04-16)',             note: '' },
    { id: 'gpt-4o',                    label: 'GPT-4o',                      note: '' },
    { id: 'gpt-4o-mini',               label: 'GPT-4o mini',                 note: '' },
    { id: 'gpt-4o-2024-11-20',         label: 'GPT-4o (2024-11-20)',         note: '' },
    { id: 'gpt-4o-2024-08-06',         label: 'GPT-4o (2024-08-06)',         note: '' },
    { id: 'gpt-4o-mini-2024-07-18',    label: 'GPT-4o mini (2024-07-18)',    note: '' },
    { id: 'gpt-4o-search-preview',     label: 'GPT-4o Search Preview',       note: 'Швидкі відповіді з посиланнями з інтернету' },
    { id: 'gpt-4o-mini-search-preview', label: 'GPT-4o mini Search Preview', note: '' },
    { id: 'gpt-3.5-turbo-16k',         label: 'GPT-3.5 Turbo 16k',           note: '' },
    { id: 'gpt-image-1',               label: 'GPT Image 1',                 note: 'Створення зображень', type: 'image' },
    { id: 'tts-1',                     label: 'TTS 1',                       note: 'Озвучка тексту', type: 'audio' },
    { id: 'tts-1-hd',                  label: 'TTS 1 HD',                    note: 'Озвучка вищої якості', type: 'audio' }
];

// Порядок для моделей, яких немає в списку вище: нові покоління вище
const PREFERRED_DEFAULTS = ['gpt-6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5-mini', 'gpt-4o-mini', 'gpt-4o'];

const ERRORS = {
    stopped:     { uk: 'Запит зупинено', ru: 'Запрос остановлен', en: 'Request stopped' },
    no_key:      { uk: 'На сервері не налаштований CHATGPT_API_KEY (Render -> Environment)', ru: 'На сервере не настроен CHATGPT_API_KEY (Render -> Environment)', en: 'CHATGPT_API_KEY is not configured on the server (Render -> Environment)' },
    auth:        { uk: 'OpenAI не прийняв ключ CHATGPT_API_KEY. Створіть новий ключ на platform.openai.com/api-keys', ru: 'OpenAI не принял ключ CHATGPT_API_KEY. Создайте новый ключ на platform.openai.com/api-keys', en: 'OpenAI rejected CHATGPT_API_KEY. Create a new key at platform.openai.com/api-keys' },
    quota:       { uk: 'На рахунку OpenAI закінчились кошти. Поповніть баланс: platform.openai.com -> Billing -> Add credits', ru: 'На счёте OpenAI закончились средства. Пополните баланс: platform.openai.com -> Billing -> Add credits', en: 'The OpenAI account has no credits left. Add credits: platform.openai.com -> Billing -> Add credits' },
    forbidden:   { uk: 'Немає доступу до моделі %s з вашим ключем OpenAI (можливо, потрібна верифікація організації або платний тариф)', ru: 'Нет доступа к модели %s с вашим ключом OpenAI (возможно, нужна верификация организации или платный тариф)', en: 'No access to %s with your OpenAI key (organization verification or a paid plan may be required)' },
    not_found:   { uk: 'Модель %s недоступна для вашого ключа OpenAI', ru: 'Модель %s недоступна для вашего ключа OpenAI', en: 'Model %s is not available for your OpenAI key' },
    overloaded:  { uk: 'OpenAI зараз перевантажений. Спробуйте ще раз за хвилину', ru: 'OpenAI сейчас перегружен. Попробуйте ещё раз через минуту', en: 'OpenAI is overloaded right now. Try again in a minute' },
    empty:       { uk: 'ChatGPT не зміг відповісти на це повідомлення', ru: 'ChatGPT не смог ответить на это сообщение', en: 'ChatGPT could not answer this message' },
    empty_image: { uk: 'ChatGPT не повернув зображення (запит міг бути заблокований фільтром безпеки). Спробуйте інший опис', ru: 'ChatGPT не вернул изображение (запрос мог быть заблокирован фильтром безопасности). Попробуйте другое описание', en: 'ChatGPT returned no image (the request may have been blocked by a safety filter). Try another description' },
    attach_missing: { uk: 'Файл вкладення не знайдено на сервері. Надішліть його ще раз', ru: 'Файл вложения не найден на сервере. Отправьте его ещё раз', en: 'The attachment was not found on the server. Please send it again' },
    attach_unsupported: { uk: 'ChatGPT приймає лише фото. Для відео оберіть Gemini', ru: 'ChatGPT принимает только фото. Для видео выберите Gemini', en: 'ChatGPT accepts photos only. Choose Gemini for videos' },
    attach_model: { uk: 'Ця модель не приймає вкладення. Оберіть текстову модель', ru: 'Эта модель не принимает вложения. Выберите текстовую модель', en: 'This model does not accept attachments. Choose a text model' },
    busy:        { uk: 'ChatGPT ще відповідає на попереднє повідомлення', ru: 'ChatGPT ещё отвечает на предыдущее сообщение', en: 'ChatGPT is still answering the previous message' },
    empty_msg:   { uk: 'Порожнє повідомлення', ru: 'Пустое сообщение', en: 'Empty message' },
    too_long:    { uk: 'Повідомлення занадто довге', ru: 'Сообщение слишком длинное', en: 'The message is too long' },
    generic:     { uk: 'Помилка ChatGPT: %s', ru: 'Ошибка ChatGPT: %s', en: 'ChatGPT error: %s' },
    unknown:     { uk: 'невідома', ru: 'неизвестная', en: 'unknown' }
};

function t(key, lang, arg) {
    const entry = ERRORS[key] || ERRORS.generic;
    const text = entry[lang] || entry.uk;
    return arg === undefined ? text : text.replace('%s', arg);
}

function listFromEnv(raw) {
    return String(raw || '').split(/[,\n;]+/).map(s => s.trim()).filter(Boolean);
}

// ---------- Тип моделі за її id ----------
function modelType(id) {
    if (/^(gpt-image|dall-e|chatgpt-image)/i.test(id)) return 'image';
    if (/(^tts-|-tts($|-))/i.test(id)) return 'audio';
    return 'text';
}

// Службові моделі, які не підходять для чату
function isChatCapableId(id) {
    if (!/^(gpt-|o\d|chatgpt-|tts-|dall-e)/i.test(id)) return false;
    if (/embedding|moderation|whisper|transcribe|realtime|audio-preview|-audio|computer-use|sora|diarize|davinci|babbage|instruct$|-instruct-/i.test(id)) return false;
    return true;
}

// Моделі з міркуванням (приймають reasoning.effort)
function isReasoningModel(id) {
    return /^(gpt-5|gpt-6|o\d|codex)/i.test(id) && !/chat-latest/i.test(id);
}

// Verbosity підтримують моделі GPT-5 і новіші
function supportsVerbosity(id) {
    return /^(gpt-5|gpt-6)/i.test(id);
}

// Моделі, які працюють лише через Chat Completions (пошукові preview)
function chatCompletionsOnly(id) {
    return /search-preview/i.test(id);
}

function cleanSettings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const pick = (value, allowed, fallback) => (typeof value === 'string' && allowed.includes(value) ? value : fallback);
    const tools = r.tools && typeof r.tools === 'object' ? r.tools : {};
    return {
        serviceTier: pick(r.serviceTier, ['auto', 'default', 'flex', 'priority'], 'default'),
        websocket: r.websocket !== false,
        textFormat: pick(r.textFormat, ['text', 'json_object'], 'text'),
        reasoningMode: pick(r.reasoningMode, ['standard', 'pro'], 'standard'),
        effort: pick(r.effort, ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'], 'medium'),
        verbosity: pick(r.verbosity, ['low', 'medium', 'high'], 'medium'),
        summary: pick(r.summary, ['auto', 'concise', 'detailed', 'none'], 'auto'),
        store: r.store !== false,
        instructions: typeof r.instructions === 'string' ? r.instructions.slice(0, 4000) : '',
        tools: {
            web_search: !!tools.web_search,
            image_generation: !!tools.image_generation,
            code_interpreter: !!tools.code_interpreter
        }
    };
}

module.exports = function initChatGPT(ctx) {
    const { app, io, db, dbRun, dbAll, cleanEmail, langOf, stripEmoji, makeJob, cancelJob, checkCancelled, sleep, nowText, loadMedia } = ctx;

    const MAX_TEXT = 8000;
    const CONTEXT_LIMIT = 30;
    const HISTORY_LIMIT = 500;
    const jobs = new Map(); // email -> job

    // ---------- Таблиці ----------
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS chatgpt_messages (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            role TEXT NOT NULL,
            text TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            image_id TEXT,
            model TEXT,
            attach_url TEXT,
            attach_type TEXT,
            attach_thumb TEXT
        )`);
        db.run('CREATE INDEX IF NOT EXISTS idx_chatgpt_email_time ON chatgpt_messages (email, timestamp)', () => {});
        db.run(`CREATE TABLE IF NOT EXISTS chatgpt_images (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            mime TEXT NOT NULL,
            data BLOB NOT NULL,
            timestamp INTEGER NOT NULL
        )`);
    });

    // Згенеровані зображення та озвучка (id випадковий). Підтримується Range для плеєра.
    app.get('/chatgpt-media/:id', (req, res) => {
        const id = String(req.params.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
        db.get('SELECT mime, data FROM chatgpt_images WHERE id = ?', [id], (err, row) => {
            if (err || !row) return res.status(404).send('Not found');
            const allowed = /^(image\/(png|jpeg|webp|gif)|audio\/(mpeg|mp3|wav|x-wav|ogg|aac|flac))$/;
            const mime = allowed.test(row.mime) ? row.mime : 'image/png';
            const buf = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
            res.set('Content-Type', mime);
            res.set('Cache-Control', 'public, max-age=31536000, immutable');
            res.set('Accept-Ranges', 'bytes');
            const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
            if (range && (range[1] || range[2])) {
                let start = range[1] ? parseInt(range[1], 10) : buf.length - parseInt(range[2], 10);
                let end = range[1] && range[2] ? parseInt(range[2], 10) : buf.length - 1;
                if (isNaN(start) || start < 0) start = 0;
                if (isNaN(end) || end >= buf.length) end = buf.length - 1;
                if (start > end) { res.status(416).set('Content-Range', `bytes */${buf.length}`); return res.end(); }
                res.status(206);
                res.set('Content-Range', `bytes ${start}-${end}/${buf.length}`);
                res.set('Content-Length', String(end - start + 1));
                return res.end(buf.subarray(start, end + 1));
            }
            res.send(buf);
        });
    });

    // ---------- HTTP до OpenAI ----------
    function apiBase() {
        const raw = (process.env.CHATGPT_API_BASE || 'https://api.openai.com').replace(/\/+$/, '');
        try {
            const u = new URL(raw);
            return { proto: u.protocol === 'http:' ? http : https, hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), prefix: u.pathname.replace(/\/+$/, '') };
        } catch (e) {
            return { proto: https, hostname: 'api.openai.com', port: 443, prefix: '' };
        }
    }

    // Повертає { status, headers, json, raw } (для потокових відповідей див. openaiStream)
    function openaiRequest(method, path, bodyObj, job, opts) {
        const options = opts || {};
        return new Promise((resolve, reject) => {
            const key = process.env.CHATGPT_API_KEY;
            if (!key) return reject(new Error('NO_KEY'));
            if (job && job.cancelled) return reject(new Error('CANCELLED'));
            const base = apiBase();
            const body = bodyObj ? JSON.stringify(bodyObj) : null;
            const headers = { Authorization: 'Bearer ' + key };
            if (body) {
                headers['Content-Type'] = 'application/json';
                headers['Content-Length'] = Buffer.byteLength(body);
            }
            const req = base.proto.request({ hostname: base.hostname, port: base.port, path: base.prefix + path, method, headers }, (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    if (job) job.reqs.delete(req);
                    const buf = Buffer.concat(chunks);
                    if (options.binary && res.statusCode === 200) return resolve({ status: 200, headers: res.headers, buffer: buf });
                    const raw = buf.toString('utf8');
                    let json = null;
                    try { json = JSON.parse(raw); } catch (e) {}
                    resolve({ status: res.statusCode, headers: res.headers, json, raw });
                });
                res.on('error', (e) => { if (job) job.reqs.delete(req); reject(e); });
            });
            if (job) job.reqs.add(req);
            req.on('socket', (sock) => { try { sock.setKeepAlive(true, 15000); } catch (e) {} });
            if (options.timeoutMs) req.setTimeout(options.timeoutMs, () => req.destroy(new Error('TIMEOUT')));
            req.on('error', (e) => { if (job) job.reqs.delete(req); reject(e); });
            if (body) req.write(body);
            req.end();
        });
    }

    // Потокова відповідь Responses API (SSE). Зʼєднання не «мовчить», тому довгі міркування не обриваються.
    function openaiStream(path, bodyObj, job, handlers) {
        return new Promise((resolve, reject) => {
            const key = process.env.CHATGPT_API_KEY;
            if (!key) return reject(new Error('NO_KEY'));
            if (job && job.cancelled) return reject(new Error('CANCELLED'));
            const base = apiBase();
            const body = JSON.stringify(bodyObj);
            let settled = false;
            const done = (fn, v) => { if (settled) return; settled = true; fn(v); };

            const req = base.proto.request({
                hostname: base.hostname, port: base.port, path: base.prefix + path, method: 'POST',
                headers: {
                    Authorization: 'Bearer ' + key,
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream',
                    'Content-Length': Buffer.byteLength(body)
                }
            }, (res) => {
                const cleanup = () => { if (job) job.reqs.delete(req); };
                if (res.statusCode !== 200) {
                    const chunks = [];
                    res.on('data', (c) => chunks.push(c));
                    res.on('end', () => {
                        cleanup();
                        const raw = Buffer.concat(chunks).toString('utf8');
                        let json = null;
                        try { json = JSON.parse(raw); } catch (e) {}
                        done(resolve, { status: res.statusCode, headers: res.headers, json, raw });
                    });
                    res.on('error', (e) => { cleanup(); done(reject, e); });
                    return;
                }

                const state = { text: '', images: [], completed: null, error: null, incomplete: false };
                let buf = '';
                res.setEncoding('utf8');

                const handleBlock = (block) => {
                    let eventName = '';
                    const dataLines = [];
                    block.split(/\r?\n/).forEach((line) => {
                        if (line.startsWith('event:')) eventName = line.slice(6).trim();
                        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
                    });
                    const payload = dataLines.join('\n');
                    if (!payload || payload === '[DONE]') return;
                    let obj;
                    try { obj = JSON.parse(payload); } catch (e) { return; }
                    const type = obj.type || eventName;

                    if (type === 'response.output_text.delta' && typeof obj.delta === 'string') {
                        state.text += obj.delta;
                        if (handlers && handlers.onText) { try { handlers.onText(); } catch (e) {} }
                    } else if (/^response\.reasoning(_summary)?(_text)?\.delta$/.test(type) || type === 'response.reasoning_summary_text.delta') {
                        if (handlers && handlers.onThought) { try { handlers.onThought(); } catch (e) {} }
                    } else if (type === 'response.output_item.done' && obj.item && obj.item.type === 'image_generation_call' && obj.item.result) {
                        state.images.push({ mime: 'image/png', data: obj.item.result });
                    } else if (type === 'response.completed' && obj.response) {
                        state.completed = obj.response;
                    } else if (type === 'response.incomplete' && obj.response) {
                        state.incomplete = true;
                        state.completed = obj.response;
                    } else if (type === 'response.failed' && obj.response && obj.response.error) {
                        state.error = obj.response.error;
                    } else if (type === 'error') {
                        state.error = obj.error || obj;
                    }
                };

                res.on('data', (chunk) => {
                    buf += chunk;
                    let m;
                    while ((m = buf.match(/\r?\n\r?\n/))) {
                        handleBlock(buf.slice(0, m.index));
                        buf = buf.slice(m.index + m[0].length);
                    }
                });
                res.on('end', () => {
                    cleanup();
                    if (buf.trim()) handleBlock(buf);
                    if (state.error) {
                        const code = state.error.code || state.error.type || '';
                        const status = /rate_limit/i.test(code) ? 429 : (/insufficient_quota/i.test(code) ? 429 : (/server_error|overloaded/i.test(code) ? 503 : 400));
                        return done(resolve, { status, headers: res.headers, json: { error: state.error }, raw: '' });
                    }
                    // Текст із фінального обʼєкта, якщо дельт не було
                    if (!state.text && state.completed && Array.isArray(state.completed.output)) {
                        state.completed.output.forEach((item) => {
                            if (item && item.type === 'message' && Array.isArray(item.content)) {
                                item.content.forEach((c) => { if (c && c.type === 'output_text' && typeof c.text === 'string') state.text += c.text; });
                            }
                            if (item && item.type === 'image_generation_call' && item.result && !state.images.length) {
                                state.images.push({ mime: 'image/png', data: item.result });
                            }
                        });
                    }
                    done(resolve, { status: 200, headers: res.headers, state });
                });
                res.on('error', (e) => { cleanup(); done(reject, e); });
                res.on('close', () => { if (!res.complete) { cleanup(); done(reject, new Error('ECONNRESET')); } });
            });

            if (job) job.reqs.add(req);
            req.on('socket', (sock) => { try { sock.setKeepAlive(true, 15000); } catch (e) {} });
            req.on('error', (e) => { if (job) job.reqs.delete(req); done(reject, e); });
            req.write(body);
            req.end();
        });
    }

    // ---------- Розбір помилок ----------
    function apiError(res) {
        const e = res.json && res.json.error;
        const message = (e && e.message) || (res.raw && String(res.raw).slice(0, 200)) || ('HTTP ' + res.status);
        const err = new Error(message);
        err.status = res.status;
        err.code = (e && (e.code || e.type)) || '';
        err.param = (e && e.param) || '';
        const retryAfter = res.headers && res.headers['retry-after'];
        if (retryAfter && !isNaN(parseFloat(retryAfter))) err.retryMs = Math.ceil(parseFloat(retryAfter) * 1000);
        if (!err.retryMs) {
            const m = message.match(/try again in ([\d.]+)\s*(ms|s|m)?/i);
            if (m) {
                const n = parseFloat(m[1]);
                err.retryMs = Math.ceil(m[2] === 'ms' ? n : (m[2] === 'm' ? n * 60000 : n * 1000));
            }
        }
        if (res.status === 429 && /insufficient_quota|exceeded your current quota|billing/i.test(err.code + ' ' + message)) err.noCredits = true;
        return err;
    }

    function isTransient(err) {
        const s = err && err.status;
        if (s === 500 || s === 502 || s === 503 || s === 504 || s === 408 || s === 409) return true;
        const m = err && err.message ? err.message : '';
        return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|aborted|TIMEOUT/i.test(m);
    }

    function errorText(err, model, lang) {
        lang = langOf(lang);
        const m = err && err.message ? err.message : '';
        const s = err && err.status;
        const name = model ? (model.label || model.id) : '';
        if (m === 'CANCELLED') return t('stopped', lang);
        if (m === 'NO_KEY') return t('no_key', lang);
        if (m === 'ATTACH_MISSING') return t('attach_missing', lang);
        if (m === 'ATTACH_UNSUPPORTED') return t('attach_unsupported', lang);
        if (m === 'ATTACH_MODEL') return t('attach_model', lang);
        if (m === 'EMPTY') return t('empty', lang);
        if (m === 'EMPTY_IMAGE') return t('empty_image', lang);
        if (err && err.noCredits) return t('quota', lang);
        if (s === 401) return t('auth', lang);
        if (s === 403) return t('forbidden', lang, name);
        if (s === 404) return t('not_found', lang, name);
        if (s === 500 || s === 502 || s === 503 || s === 504) return t('overloaded', lang);
        return t('generic', lang, m || t('unknown', lang));
    }

    // ---------- Список моделей ----------
    let catalogCache = { at: 0, ttl: 0, models: null };

    function staticCatalog() {
        return STATIC_MODELS.map((m) => ({ id: m.id, label: m.label, type: m.type || modelType(m.id), note: m.note || '' }));
    }

    function extraModels() {
        const out = [];
        listFromEnv(process.env.CHATGPT_EXTRA_MODELS).forEach((entry) => {
            const [id, label, type] = entry.split('|').map(x => (x || '').trim());
            if (!id || !/^[A-Za-z0-9._:-]+$/.test(id)) return;
            const lower = (type || '').toLowerCase();
            out.push({ id, label: label || id, type: ['text', 'image', 'audio'].includes(lower) ? lower : modelType(id), note: 'Додано через Environment' });
        });
        return out;
    }

    async function getCatalog() {
        const now = Date.now();
        if (catalogCache.models && now - catalogCache.at < catalogCache.ttl) return catalogCache.models;

        const known = new Map(staticCatalog().map(m => [m.id, m]));
        let models = null;
        let live = false;
        try {
            const res = await openaiRequest('GET', '/v1/models', null, null, { timeoutMs: 15000 });
            if (res.status === 200 && res.json && Array.isArray(res.json.data)) {
                live = true;
                const ids = res.json.data.map(x => String(x.id || '')).filter(isChatCapableId);
                const order = STATIC_MODELS.map(m => m.id);
                ids.sort((a, b) => {
                    const ia = order.indexOf(a);
                    const ib = order.indexOf(b);
                    if (ia !== -1 && ib !== -1) return ia - ib;
                    if (ia !== -1) return -1;
                    if (ib !== -1) return 1;
                    return b.localeCompare(a);
                });
                models = ids.map((id) => known.get(id) || { id, label: id, type: modelType(id), note: '' });
            } else {
                console.error('ChatGPT ListModels:', res.status, res.json && res.json.error && res.json.error.message);
            }
        } catch (e) {
            if (e.message !== 'NO_KEY') console.error('ChatGPT ListModels:', e.message);
        }
        if (!models || models.length === 0) models = staticCatalog();

        extraModels().forEach((extra) => {
            const idx = models.findIndex(m => m.id === extra.id);
            if (idx >= 0) models[idx] = extra; else models.push(extra);
        });
        const hidden = new Set(listFromEnv(process.env.CHATGPT_HIDE_MODELS));
        const result = models.filter(m => !hidden.has(m.id));
        catalogCache = { at: now, ttl: live ? 3600000 : 120000, models: result };
        return result;
    }

    function defaultModel(catalog) {
        const wanted = (process.env.CHATGPT_MODEL || '').trim();
        const texts = catalog.filter(m => m.type === 'text');
        if (wanted) {
            const found = catalog.find(m => m.id === wanted);
            if (found) return found;
            return { id: wanted, label: wanted, type: modelType(wanted), note: '' };
        }
        for (const id of PREFERRED_DEFAULTS) {
            const f = texts.find(m => m.id === id);
            if (f) return f;
        }
        return texts[0] || catalog[0] || { id: 'gpt-5-mini', label: 'GPT-5 mini', type: 'text', note: '' };
    }

    function pickModel(catalog, requestedId) {
        const wanted = typeof requestedId === 'string' ? requestedId.trim() : '';
        if (!wanted) return defaultModel(catalog);
        const lower = wanted.toLowerCase();
        const found = catalog.find(m => m.id.toLowerCase() === lower);
        if (found) return found;
        if (/^[A-Za-z0-9._:-]{2,80}$/.test(wanted)) return { id: wanted, label: wanted, type: modelType(wanted), note: '', adhoc: true };
        return defaultModel(catalog);
    }

    // ---------- Побудова запиту ----------
    function systemText(lang, name, settings) {
        return (settings && settings.instructions ? settings.instructions + '\n\n' : '') +
            'You are ChatGPT, an AI assistant inside the Kishka messenger. Reply in the language the user writes in. ' +
            'Be clear, friendly and to the point. Do not use emoji. ' +
            `Current date and time: ${nowText(lang)}.` +
            (name ? ` The user is called ${name}.` : '');
    }

    // Прибирає з тіла запиту параметр, який модель не підтримує (напр. "reasoning.summary"), щоб повторити запит
    function stripParam(body, param) {
        if (!param) return false;
        const parts = String(param).split('.');
        let node = body;
        for (let i = 0; i < parts.length - 1; i++) {
            node = node && node[parts[i]];
            if (!node || typeof node !== 'object') return false;
        }
        const last = parts[parts.length - 1];
        if (!(last in node)) return false;
        delete node[last];
        if (parts.length > 1) {
            const parent = parts.slice(0, -1).reduce((n, k) => n[k], body);
            if (parent && typeof parent === 'object' && !Array.isArray(parent) && Object.keys(parent).length === 0) {
                const gp = parts.slice(0, -2).reduce((n, k) => n[k], body);
                delete gp[parts[parts.length - 2]];
            }
        }
        return true;
    }

    function buildResponsesBody(model, input, lang, name, settings, stream) {
        const body = { model: model.id, input, stream: !!stream, store: !!settings.store };
        body.instructions = systemText(lang, name, settings);
        if (isReasoningModel(model.id)) {
            body.reasoning = { effort: settings.effort };
            if (settings.summary !== 'none') body.reasoning.summary = settings.summary;
            if (settings.reasoningMode === 'pro') body.reasoning.mode = 'pro';
        }
        const text = {};
        if (supportsVerbosity(model.id)) text.verbosity = settings.verbosity;
        if (settings.textFormat === 'json_object') text.format = { type: 'json_object' };
        if (Object.keys(text).length) body.text = text;
        if (settings.serviceTier && settings.serviceTier !== 'default') body.service_tier = settings.serviceTier;
        const tools = [];
        if (settings.tools.web_search) tools.push({ type: 'web_search' });
        if (settings.tools.image_generation) tools.push({ type: 'image_generation' });
        if (settings.tools.code_interpreter) tools.push({ type: 'code_interpreter', container: { type: 'auto' } });
        if (tools.length) body.tools = tools;
        return body;
    }

    // Один виклик моделі з повтором: 429 / 5xx / обрив мережі — чекаємо і повторюємо без обмеження кількості спроб
    async function callWithRetry(job, modelLabel, doCall) {
        let attempt = 0;
        let stripped = 0;
        for (;;) {
            checkCancelled(job);
            try {
                return await doCall(() => { stripped++; });
            } catch (err) {
                const m = err && err.message;
                if (m === 'CANCELLED' || m === 'NO_KEY') throw err;
                attempt++;
                if (err.status === 429 && !err.noCredits) {
                    const wait = Math.min(Math.max(err.retryMs || 0, 3000 * Math.min(attempt, 10)), 70000) + 300;
                    await waitWithNote(job, wait, 'wait', modelLabel);
                    continue;
                }
                if (isTransient(err)) {
                    await waitWithNote(job, Math.min(30000, 2000 * attempt), 'busy', modelLabel);
                    continue;
                }
                throw err;
            }
        }
    }

    function note(job, n) {
        if (!job) return;
        job.note = n;
        if (typeof job.onNote === 'function') { try { job.onNote(n); } catch (e) {} }
    }

    async function waitWithNote(job, ms, kind, modelLabel) {
        const until = Date.now() + ms;
        while (Date.now() < until) {
            checkCancelled(job);
            note(job, { kind, seconds: Math.max(1, Math.ceil((until - Date.now()) / 1000)), model: modelLabel || '' });
            await sleep(Math.min(2000, Math.max(200, until - Date.now())));
        }
        checkCancelled(job);
    }

    // Текст/зображення через Responses API
    async function callResponses(model, input, lang, name, settings, job) {
        const body = buildResponsesBody(model, input, lang, name, settings, true);
        let strips = 0;
        for (;;) {
            const res = await callWithRetry(job, model.label, async () => {
                const r = await openaiStream('/v1/responses', body, job, {
                    onThought: () => { if (!job.note || job.note.kind !== 'thinking') note(job, { kind: 'thinking', seconds: 0, model: model.label }); }
                });
                if (r.status !== 200) throw apiError(r);
                return r;
            }).catch((err) => {
                // Параметр не підтримується цією моделлю — прибираємо його й повторюємо (модель лишається та сама)
                if (err.status === 400 && strips < 6) {
                    if (err.param && stripParam(body, err.param)) { strips++; return { retry: true }; }
                    const pm = /(?:unsupported|unknown) (?:parameter|value)[^'"`]*['"`]([\w.]+)['"`]/i.exec(err.message || '');
                    if (pm && stripParam(body, pm[1])) { strips++; return { retry: true }; }
                }
                // Ця модель працює лише через Chat Completions
                if ((err.status === 404 || err.status === 400) && /chat\/completions|v1\/chat|not supported in the v1\/responses/i.test(err.message || '')) {
                    return { fallback: true };
                }
                throw err;
            });
            if (res.retry) continue;
            if (res.fallback) return callChatCompletions(model, input, lang, name, settings, job);
            const st = res.state;
            if (!st.text.trim() && st.images.length === 0) throw Object.assign(new Error('EMPTY'), {});
            return { text: st.text, images: st.images };
        }
    }

    // Запасний шлях: Chat Completions (пошукові preview-моделі тощо)
    async function callChatCompletions(model, input, lang, name, settings, job) {
        const messages = [{ role: 'system', content: systemText(lang, name, settings) }];
        input.forEach((m) => {
            const parts = Array.isArray(m.content) ? m.content : [{ type: 'input_text', text: String(m.content || '') }];
            const textPart = parts.filter(p => p.text).map(p => p.text).join('\n');
            messages.push({ role: m.role, content: textPart || '.' });
        });
        const body = { model: model.id, messages };
        if (/search-preview/i.test(model.id)) body.web_search_options = {};
        const res = await callWithRetry(job, model.label, async () => {
            const r = await openaiRequest('POST', '/v1/chat/completions', body, job);
            if (r.status !== 200) throw apiError(r);
            return r;
        });
        const content = res.json && res.json.choices && res.json.choices[0] && res.json.choices[0].message && res.json.choices[0].message.content;
        const text = typeof content === 'string' ? content : '';
        if (!text.trim()) throw new Error('EMPTY');
        return { text, images: [] };
    }

    async function callImage(model, prompt, job) {
        const body = { model: model.id, prompt, n: 1 };
        if (/^dall-e/i.test(model.id)) body.response_format = 'b64_json';
        const res = await callWithRetry(job, model.label, async () => {
            const r = await openaiRequest('POST', '/v1/images/generations', body, job);
            if (r.status !== 200) throw apiError(r);
            return r;
        });
        const item = res.json && res.json.data && res.json.data[0];
        if (!item || !item.b64_json) throw new Error('EMPTY_IMAGE');
        return { mime: 'image/png', data: item.b64_json, text: item.revised_prompt || '' };
    }

    async function callSpeech(model, text, job) {
        const body = { model: model.id, input: text.slice(0, 4096), voice: process.env.CHATGPT_TTS_VOICE || 'alloy', response_format: 'mp3' };
        const res = await callWithRetry(job, model.label, async () => {
            const r = await openaiRequest('POST', '/v1/audio/speech', body, job, { binary: true });
            if (r.status !== 200) throw apiError(r);
            return r;
        });
        if (!res.buffer || res.buffer.length < 100) throw new Error('EMPTY');
        return { mime: 'audio/mpeg', data: res.buffer };
    }

    // ---------- Збереження ----------
    const newId = () => `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    async function saveMedia(email, mime, buffer) {
        const id = crypto.randomBytes(16).toString('hex');
        await dbRun('INSERT INTO chatgpt_images (id, email, mime, data, timestamp) VALUES (?, ?, ?, ?, ?)', [id, email, mime, buffer, Date.now()]);
        return id;
    }

    // ---------- Подія: відповісти один раз (для @chatgpt у чатах) ----------
    async function answerOnce(opts) {
        const lang = langOf(opts.lang);
        const catalog = await getCatalog();
        const model = pickModel(catalog, opts.model);
        if (model.type !== 'text') throw Object.assign(new Error('ATTACH_MODEL'), {});
        const settings = cleanSettings({ store: false, effort: 'low', summary: 'none', verbosity: 'low' });
        const job = makeJob();
        const input = [{ role: 'user', content: [{ type: 'input_text', text: opts.text }] }];
        const out = await callResponses(model, input, lang, opts.name || '', settings, job);
        return { text: stripEmoji(out.text), model };
    }

    // ---------- Події сокета ----------
    io.on('connection', (socket) => {
        socket.on('chatgpt_get_models', async (arg1, arg2) => {
            const cb = typeof arg1 === 'function' ? arg1 : (typeof arg2 === 'function' ? arg2 : () => {});
            try {
                const catalog = await getCatalog();
                cb({ success: true, defaultModel: defaultModel(catalog).id, models: catalog.map(m => ({ id: m.id, label: m.label, type: m.type, paid: false, note: m.note || '' })) });
            } catch (e) {
                console.error('ChatGPT models error:', e.message);
                cb({ success: false, models: [] });
            }
        });

        socket.on('chatgpt_get_history', async (email, callback) => {
            const cb = typeof callback === 'function' ? callback : () => {};
            const clean = cleanEmail(email);
            if (!clean) return cb({ success: false, messages: [] });
            try {
                const rows = await dbAll(
                    `SELECT id, role, text, timestamp, "imageId", model, "attachUrl", "attachType", "attachThumb" FROM (
                        SELECT id, role, text, timestamp, image_id AS "imageId", model,
                               attach_url AS "attachUrl", attach_type AS "attachType", attach_thumb AS "attachThumb"
                        FROM chatgpt_messages WHERE email = ? ORDER BY timestamp DESC LIMIT ?
                     ) AS recent ORDER BY timestamp ASC`,
                    [clean, HISTORY_LIMIT]
                );
                cb({
                    success: true,
                    messages: rows.map(r => ({
                        id: r.id, role: r.role, text: r.text, timestamp: r.timestamp, model: r.model || null,
                        imageUrl: r.imageId ? '/chatgpt-media/' + r.imageId : (r.attachUrl || null),
                        fileType: r.attachType || null, thumbUrl: r.attachThumb || null
                    }))
                });
            } catch (e) {
                console.error('ChatGPT history error:', e.message);
                cb({ success: false, messages: [] });
            }
        });

        socket.on('chatgpt_get_status', (email, callback) => {
            const cb = typeof callback === 'function' ? callback : () => {};
            const clean = cleanEmail(email);
            if (clean) socket.join(clean);
            const job = clean ? jobs.get(clean) : null;
            cb({ success: true, busy: !!job, startedAt: job ? job.startedAt : 0, note: job && job.note ? job.note : null });
        });

        socket.on('chatgpt_send', async (data, callback) => {
            const ackCb = typeof callback === 'function' ? callback : () => {};
            const { email, name, text, model: modelId, attachment, lang: rawLang, settings: rawSettings } = data || {};
            const lang = langOf(rawLang);
            const clean = cleanEmail(email);
            const cleanText = (typeof text === 'string' ? text : '').trim();
            const settings = cleanSettings(rawSettings);
            const attachUrl = attachment && typeof attachment.url === 'string' ? attachment.url : null;
            const attachType = attachment && attachment.type === 'video' ? 'video' : (attachUrl ? 'image' : null);
            const attachThumb = attachment && typeof attachment.thumbUrl === 'string' && /^\/media\/[a-zA-Z0-9_-]+$/.test(attachment.thumbUrl) ? attachment.thumbUrl : null;

            if (!clean || (!cleanText && !attachUrl)) return ackCb({ success: false, error: t('empty_msg', lang) });
            if (cleanText.length > MAX_TEXT) return ackCb({ success: false, error: t('too_long', lang) });
            if (jobs.has(clean)) return ackCb({ success: false, error: t('busy', lang) });

            socket.join(clean);
            const job = makeJob();
            job.onNote = (n) => io.to(clean).emit('chatgpt_progress', n || { kind: 'clear' });
            jobs.set(clean, job);

            const finish = (payload) => {
                ackCb(payload);
                io.to(clean).emit('chatgpt_done', payload);
            };

            const userMsgId = newId();
            let picked = null;
            try {
                if (!process.env.CHATGPT_API_KEY) throw new Error('NO_KEY');
                const catalog = await getCatalog();
                picked = pickModel(catalog, typeof modelId === 'string' ? modelId : '');

                if (attachUrl && picked.type !== 'text') throw new Error('ATTACH_MODEL');
                if (attachUrl && attachType === 'video') throw new Error('ATTACH_UNSUPPORTED');

                await dbRun(
                    "INSERT INTO chatgpt_messages (id, email, role, text, timestamp, attach_url, attach_type, attach_thumb) VALUES (?, ?, 'user', ?, ?, ?, ?, ?)",
                    [userMsgId, clean, cleanText, Date.now(), attachUrl, attachType, attachThumb]
                );

                let reply;
                if (picked.type === 'image') {
                    const img = await callImage(picked, cleanText, job);
                    checkCancelled(job);
                    const imageId = await saveMedia(clean, img.mime, Buffer.from(img.data, 'base64'));
                    reply = { id: newId(), role: 'model', text: img.text || '', timestamp: Date.now(), model: picked.id, imageId, fileType: null };
                } else if (picked.type === 'audio') {
                    const audio = await callSpeech(picked, cleanText, job);
                    checkCancelled(job);
                    const mediaId = await saveMedia(clean, audio.mime, audio.data);
                    reply = { id: newId(), role: 'model', text: '', timestamp: Date.now(), model: picked.id, imageId: mediaId, fileType: 'video' };
                } else {
                    const rows = await dbAll(
                        `SELECT role, text, image_id AS "imageId", attach_url AS "attachUrl", attach_type AS "attachType"
                         FROM chatgpt_messages WHERE email = ? ORDER BY timestamp DESC, id DESC LIMIT ?`,
                        [clean, CONTEXT_LIMIT]
                    );
                    rows.reverse();
                    while (rows.length > 0 && rows[0].role !== 'user') rows.shift();

                    let included = 0;
                    for (let i = rows.length - 1; i >= 0 && included < 2; i--) {
                        if (rows[i].attachUrl && rows[i].role === 'user' && rows[i].attachType === 'image') { rows[i].include = true; included++; }
                    }

                    const input = [];
                    for (const r of rows) {
                        const isUser = r.role === 'user';
                        const parts = [];
                        if (r.include && isUser) {
                            const media = await loadMedia(r.attachUrl);
                            if (media && /^image\//.test(media.mime)) {
                                parts.push({ type: 'input_image', image_url: `data:${media.mime};base64,${media.data.toString('base64')}` });
                            } else if (r.attachUrl === attachUrl) {
                                throw new Error('ATTACH_MISSING');
                            }
                        }
                        let tx = (r.text || '');
                        if (r.imageId) tx += ' [згенероване зображення або аудіо]';
                        if (r.attachUrl && !r.include) tx += r.attachType === 'video' ? ' [користувач надіслав відео]' : ' [користувач надіслав фото]';
                        tx = tx.trim();
                        if (!tx && parts.length === 0) tx = '[порожнє повідомлення]';
                        if (!tx && parts.length > 0) tx = 'Проаналізуй це фото.';
                        parts.push({ type: isUser ? 'input_text' : 'output_text', text: tx });
                        input.push({ role: isUser ? 'user' : 'assistant', content: parts });
                    }

                    const safeName = (typeof name === 'string' ? name : '').trim().slice(0, 60);
                    const out = await callResponses(picked, input, lang, safeName, settings, job);
                    checkCancelled(job);
                    let imageId = null;
                    if (out.images && out.images.length) imageId = await saveMedia(clean, out.images[0].mime, Buffer.from(out.images[0].data, 'base64'));
                    reply = { id: newId(), role: 'model', text: stripEmoji(out.text || ''), timestamp: Date.now(), model: picked.id, imageId, fileType: null };
                }

                await dbRun(
                    "INSERT INTO chatgpt_messages (id, email, role, text, timestamp, image_id, model, attach_type) VALUES (?, ?, 'model', ?, ?, ?, ?, ?)",
                    [reply.id, clean, reply.text, reply.timestamp, reply.imageId, reply.model, reply.fileType]
                );

                finish({
                    success: true,
                    reply: {
                        id: reply.id, role: 'model', text: reply.text, timestamp: reply.timestamp, model: reply.model,
                        imageUrl: reply.imageId ? '/chatgpt-media/' + reply.imageId : null, fileType: reply.fileType
                    }
                });
            } catch (err) {
                const cancelled = err && err.message === 'CANCELLED';
                if (!cancelled) console.error('ChatGPT send error:', err && err.message);
                try { await dbRun('DELETE FROM chatgpt_messages WHERE id = ?', [userMsgId]); } catch (e) {}
                if (cancelled) ackCb({ success: false, cancelled: true, error: errorText(err, picked, lang) });
                else finish({ success: false, cancelled: false, error: errorText(err, picked, lang) });
            } finally {
                if (jobs.get(clean) === job) jobs.delete(clean);
                io.to(clean).emit('chatgpt_progress', { kind: 'clear' });
            }
        });

        socket.on('chatgpt_cancel', (email, callback) => {
            const cb = typeof callback === 'function' ? callback : () => {};
            const clean = cleanEmail(email);
            const job = jobs.get(clean);
            if (job) { cancelJob(job); jobs.delete(clean); }
            cb({ success: true });
        });

        socket.on('chatgpt_clear', async (email, callback) => {
            const cb = typeof callback === 'function' ? callback : () => {};
            const clean = cleanEmail(email);
            if (!clean) return cb({ success: false });
            try {
                await dbRun('DELETE FROM chatgpt_messages WHERE email = ?', [clean]);
                await dbRun('DELETE FROM chatgpt_images WHERE email = ?', [clean]);
                cb({ success: true });
            } catch (e) {
                console.error('ChatGPT clear error:', e.message);
                cb({ success: false });
            }
        });
    });

    return { answerOnce, getCatalog, pickModel, errorText };
};

// Для тестів
module.exports._internal = { cleanSettings, modelType, isChatCapableId, isReasoningModel, stripParam: null };
