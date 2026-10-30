'use strict';

// =====================================================================
// KISHKA AI — власний штучний інтелект месенджера Kishka (Кішка ШІ).
// Повністю окремий від Gemini: свій модуль, свої таблиці, свої події сокета (kai_*), своя памʼять.
//
// З чого складається:
//   1) Ядро Kishka (написане з нуля, працює без інтернету і без ключів):
//      калькулятор, дата і час, кубик/монетка/випадкове число, памʼять фактів про користувача, відповіді "хто ти".
//   2) Мовний модуль: надсилає розмову вільним мовним моделям (OpenAI-сумісний API). За замовчуванням — безкоштовні
//      Pollinations; за бажанням можна підключити свій безкоштовний ключ (Groq, OpenRouter, Cerebras тощо) через Environment.
//   3) Генерація зображень (Pollinations, безкоштовно). Логотип-водяний знак накладає застосунок.
//   Пошуку в інтернеті тут НЕМАЄ — гуглити вміє тільки вкладка Gemini.
//
// Environment (необовʼязково):
//   KISHKA_AI_URL    — адреса OpenAI-сумісного endpoint (…/v1/chat/completions); якщо задано, перевіряється першою
//   KISHKA_AI_KEY    — ключ для цього endpoint
//   KISHKA_AI_MODEL  — модель для цього endpoint
//   POLLINATIONS_KEY — ключ Pollinations (якщо їхній сервіс вимагає ключ)
//   KISHKA_AI_IMAGE_URL — свій шаблон URL зображення, напр. https://host/p/{prompt}?w={width}&h={height}&seed={seed}
// =====================================================================

module.exports = function initKishkaAI(ctx) {
    const { io, db, dbRun, dbAll, cleanEmail, langOf, stripEmoji, makeJob, cancelJob, checkCancelled, sleep, nowText, tz } = ctx;
    const https = require('https');
    const http = require('http');
    const crypto = require('crypto');

    const MAX_TEXT = 6000;
    const CONTEXT_LIMIT = 30;
    const HISTORY_LIMIT = 300;
    const FACT_LIMIT = 60;

    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS kai_messages (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            role TEXT NOT NULL,
            text TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            image_id TEXT,
            model TEXT
        )`);
        db.run('CREATE INDEX IF NOT EXISTS idx_kai_email_time ON kai_messages (email, timestamp)', () => {});
        db.run(`CREATE TABLE IF NOT EXISTS kai_facts (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            fact TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        )`);
        db.run('CREATE INDEX IF NOT EXISTS idx_kai_facts_email ON kai_facts (email, timestamp)', () => {});
    });

    // ------------------------------------------------------------------
    // Тексти (3 мови)
    // ------------------------------------------------------------------
    const T = {
        stopped: { uk: 'Запит зупинено', ru: 'Запрос остановлен', en: 'Request stopped' },
        empty: { uk: 'Порожнє повідомлення', ru: 'Пустое сообщение', en: 'Empty message' },
        too_long: { uk: 'Повідомлення занадто довге', ru: 'Сообщение слишком длинное', en: 'The message is too long' },
        busy: { uk: 'Кішка ШІ ще відповідає на попереднє повідомлення', ru: 'Кішка ИИ ещё отвечает на предыдущее сообщение', en: 'Kishka AI is still answering the previous message' },
        image_failed: {
            uk: 'Не вдалося створити зображення: безкоштовний сервіс зараз зайнятий. Спробуйте ще раз за хвилину',
            ru: 'Не удалось создать изображение: бесплатный сервис сейчас занят. Попробуйте ещё раз через минуту',
            en: 'Could not create the image: the free service is busy right now. Try again in a minute'
        },
        brain_down: {
            uk: 'Мій мовний модуль зараз недоступний, тому я можу відповісти лише на прості запити: порахувати приклад, сказати дату і час, підкинути монетку чи кубик, запамʼятати факт про вас. Спробуйте поставити запитання ще раз за хвилину.',
            ru: 'Мой языковой модуль сейчас недоступен, поэтому я могу ответить только на простые запросы: посчитать пример, назвать дату и время, подбросить монетку или кубик, запомнить факт о вас. Попробуйте задать вопрос ещё раз через минуту.',
            en: 'My language module is unavailable right now, so I can only answer simple requests: do a calculation, tell the date and time, flip a coin or roll a dice, remember a fact about you. Please try again in a minute.'
        },
        who: {
            uk: 'Я Кішка ШІ (Kishka) — власний штучний інтелект месенджера Kishka. Я памʼятаю нашу розмову і факти, які ви просите запамʼятати, вмію рахувати, називати дату й час, створювати зображення (напишіть «намалюй ...» або увімкніть кнопку малювання). Пошук в інтернеті доступний у вкладці Gemini.',
            ru: 'Я Кішка ИИ (Kishka) — собственный искусственный интеллект мессенджера Kishka. Я помню наш разговор и факты, которые вы просите запомнить, умею считать, называть дату и время, создавать изображения (напишите «нарисуй ...» или включите кнопку рисования). Поиск в интернете доступен во вкладке Gemini.',
            en: 'I am Kishka AI — the built-in artificial intelligence of the Kishka messenger. I remember our conversation and the facts you ask me to remember, can calculate, tell the date and time, and create images (write “draw ...” or turn on the draw button). Web search is available in the Gemini tab.'
        },
        hello: { uk: 'Привіт! Чим можу допомогти?', ru: 'Привет! Чем могу помочь?', en: 'Hi! How can I help?' },
        thanks: { uk: 'Будь ласка!', ru: 'Пожалуйста!', en: 'You are welcome!' },
        fine: { uk: 'Все добре, дякую! А як ви?', ru: 'Всё хорошо, спасибо! А вы как?', en: 'I am doing well, thank you! And you?' },
        remembered: { uk: 'Запамʼятала: ', ru: 'Запомнила: ', en: 'Remembered: ' },
        name_remembered: { uk: 'Приємно познайомитись, %s! Запамʼятала ваше імʼя.', ru: 'Приятно познакомиться, %s! Запомнила ваше имя.', en: 'Nice to meet you, %s! I will remember your name.' },
        your_name: { uk: 'Вас звати %s.', ru: 'Вас зовут %s.', en: 'Your name is %s.' },
        no_name: { uk: 'Я ще не знаю вашого імені. Напишіть: «Мене звати ...».', ru: 'Я ещё не знаю вашего имени. Напишите: «Меня зовут ...».', en: 'I do not know your name yet. Write: “My name is ...”.' },
        facts_none: { uk: 'Я поки нічого не запамʼятала про вас. Напишіть: «Запамʼятай, що ...».', ru: 'Я пока ничего не запомнила о вас. Напишите: «Запомни, что ...».', en: 'I have not remembered anything about you yet. Write: “Remember that ...”.' },
        facts_head: { uk: 'Ось що я про вас памʼятаю:', ru: 'Вот что я о вас помню:', en: 'Here is what I remember about you:' },
        facts_cleared: { uk: 'Готово, я забула всі збережені факти про вас.', ru: 'Готово, я забыла все сохранённые факты о вас.', en: 'Done, I forgot all the saved facts about you.' },
        memory_off: { uk: 'Памʼять фактів вимкнена в налаштуваннях ШІ (Акаунт). Увімкніть її, щоб я могла щось запамʼятовувати.', ru: 'Память фактов выключена в настройках ИИ (Аккаунт). Включите её, чтобы я могла что-то запоминать.', en: 'Fact memory is turned off in the AI settings (Account). Turn it on so I can remember things.' },
        math_err: { uk: 'Не вдалося обчислити цей вираз.', ru: 'Не удалось вычислить это выражение.', en: 'I could not evaluate this expression.' },
        coin_heads: { uk: 'Випав орел.', ru: 'Выпал орёл.', en: 'Heads.' },
        coin_tails: { uk: 'Випала решка.', ru: 'Выпала решка.', en: 'Tails.' },
        dice: { uk: 'На кубику випало: %s.', ru: 'На кубике выпало: %s.', en: 'The dice shows: %s.' },
        random: { uk: 'Випадкове число: %s.', ru: 'Случайное число: %s.', en: 'Random number: %s.' },
        now: { uk: 'Зараз %s.', ru: 'Сейчас %s.', en: 'It is %s now.' },
        calc: { uk: '%s = %s', ru: '%s = %s', en: '%s = %s' }
    };

    function t(key, lang, arg, arg2) {
        const entry = T[key] || T.empty;
        let text = entry[lang] || entry.uk;
        if (arg !== undefined) text = text.replace('%s', arg);
        if (arg2 !== undefined) text = text.replace('%s', arg2);
        return text;
    }

    // Мова відповіді: за текстом користувача, інакше — за мовою інтерфейсу
    function detectLang(text, uiLang) {
        const s = String(text || '');
        const letters = (s.match(/[A-Za-zА-Яа-яІіЇїЄєҐґЁё]/g) || []).length;
        if (letters < 3) return uiLang;
        const cyr = (s.match(/[А-Яа-яІіЇїЄєҐґЁё]/g) || []).length;
        if (cyr / letters < 0.5) return 'en';
        if (/[іїєґІЇЄҐ]/.test(s)) return 'uk';
        if (/[ыэёъЫЭЁЪ]/.test(s)) return 'ru';
        return uiLang === 'en' ? 'uk' : uiLang;
    }

    // ------------------------------------------------------------------
    // Налаштування від застосунку
    // ------------------------------------------------------------------
    function cleanSettings(raw) {
        const s = raw && typeof raw === 'object' ? raw : {};
        const pick = (v, allowed, def) => (allowed.includes(v) ? v : def);
        return {
            style: pick(s.style, ['balanced', 'short', 'detailed', 'friendly'], 'balanced'),
            creativity: pick(s.creativity, ['low', 'mid', 'high'], 'mid'),
            memory: s.memory !== false,
            imageStyle: pick(s.imageStyle, ['auto', 'realistic', 'anime', 'art', 'render3d', 'pixel'], 'auto'),
            imageSize: pick(s.imageSize, ['auto', 'square', 'landscape', 'portrait'], 'auto')
        };
    }

    // ------------------------------------------------------------------
    // ЯДРО: калькулятор (рекурсивний спуск, без eval)
    // ------------------------------------------------------------------
    function tokenizeMath(src) {
        const tokens = [];
        let i = 0;
        while (i < src.length) {
            const c = src[i];
            if (c === ' ') { i++; continue; }
            if (/[0-9.,]/.test(c)) {
                let j = i;
                while (j < src.length && /[0-9.,]/.test(src[j])) j++;
                const num = parseFloat(src.slice(i, j).replace(',', '.'));
                if (!isFinite(num)) return null;
                tokens.push({ t: 'n', v: num });
                i = j;
                continue;
            }
            if (/[+\-*/^%()]/.test(c)) { tokens.push({ t: c }); i++; continue; }
            if (/[a-z]/i.test(c)) {
                let j = i;
                while (j < src.length && /[a-z]/i.test(src[j])) j++;
                const word = src.slice(i, j).toLowerCase();
                if (['sqrt', 'abs', 'pi'].includes(word)) tokens.push({ t: 'f', v: word });
                else return null;
                i = j;
                continue;
            }
            return null;
        }
        return tokens;
    }

    function evalMath(src) {
        const tokens = tokenizeMath(src);
        if (!tokens || tokens.length === 0) return null;
        let pos = 0;
        const peek = () => tokens[pos];
        const next = () => tokens[pos++];

        function parseExpr() {
            let left = parseTerm();
            while (peek() && (peek().t === '+' || peek().t === '-')) {
                const op = next().t;
                const right = parseTerm();
                left = op === '+' ? left + right : left - right;
            }
            return left;
        }
        function parseTerm() {
            let left = parsePower();
            while (peek() && (peek().t === '*' || peek().t === '/' || peek().t === '%')) {
                const op = next().t;
                const right = parsePower();
                if (op === '*') left *= right;
                else if (op === '/') { if (right === 0) throw new Error('DIV0'); left /= right; }
                else left %= right;
            }
            return left;
        }
        function parsePower() {
            const base = parseUnary();
            if (peek() && peek().t === '^') {
                next();
                const exp = parsePower();
                return Math.pow(base, exp);
            }
            return base;
        }
        function parseUnary() {
            if (peek() && peek().t === '-') { next(); return -parseUnary(); }
            if (peek() && peek().t === '+') { next(); return parseUnary(); }
            return parsePrimary();
        }
        function parsePrimary() {
            const tok = next();
            if (!tok) throw new Error('SYNTAX');
            if (tok.t === 'n') {
                if (peek() && peek().t === '%' && !(tokens[pos + 1] && (tokens[pos + 1].t === 'n' || tokens[pos + 1].t === '(' || tokens[pos + 1].t === 'f'))) {
                    next();
                    return tok.v / 100;
                }
                return tok.v;
            }
            if (tok.t === '(') {
                const v = parseExpr();
                if (!peek() || next().t !== ')') throw new Error('SYNTAX');
                return v;
            }
            if (tok.t === 'f') {
                if (tok.v === 'pi') return Math.PI;
                if (!peek() || next().t !== '(') throw new Error('SYNTAX');
                const v = parseExpr();
                if (!peek() || next().t !== ')') throw new Error('SYNTAX');
                return tok.v === 'sqrt' ? Math.sqrt(v) : Math.abs(v);
            }
            throw new Error('SYNTAX');
        }

        try {
            const value = parseExpr();
            if (pos !== tokens.length) return null;
            if (!isFinite(value)) return null;
            return value;
        } catch (e) {
            return null;
        }
    }

    function formatNumber(n) {
        if (Number.isInteger(n)) return String(n);
        return String(parseFloat(n.toPrecision(12)));
    }

    function skillMath(text, lang) {
        let s = String(text || '').toLowerCase().trim();
        s = s.replace(/^(скільки|сколько|what is|what's|calculate|порахуй|посчитай|обчисли|вычисли|реши|розв'яжи|розвʼяжи)\s*(буде|будет|is|equals)?\s*/i, '');
        s = s.replace(/[=?]+$/g, '').trim();
        s = s.replace(/×/g, '*').replace(/÷/g, '/').replace(/[хx](?=\s*\d)/g, '*');
        s = s.replace(/(\d)\s*у\s*ступені\s*(\d)/g, '$1^$2').replace(/\*\*/g, '^');
        s = s.replace(/корінь\s*з\s*(\d+(?:[.,]\d+)?)/g, 'sqrt($1)').replace(/корень\s*из\s*(\d+(?:[.,]\d+)?)/g, 'sqrt($1)');
        s = s.replace(/(\d+(?:[.,]\d+)?)\s*%\s*(?:від|от|of)\s*(\d+(?:[.,]\d+)?)/g, '($1/100)*$2');
        s = s.replace(/(\d+(?:[.,]\d+)?)\s*(?:відсотків|процентов|процентів|percent)\s*(?:від|від числа|от|of)\s*(\d+(?:[.,]\d+)?)/g, '($1/100)*$2');
        if (!/[0-9]/.test(s)) return null;
        if (/\d[-.\/]\d{1,4}[-.\/]\d/.test(s) && !/\s/.test(s)) return null; // дата або телефон, а не приклад
        if (!/[+\-*/^%]|sqrt|abs/.test(s)) return null;
        if (!/^[0-9a-z+\-*/^%().,\s]+$/.test(s)) return null;
        if (/[a-z]/.test(s.replace(/sqrt|abs|pi/g, ''))) return null;
        const value = evalMath(s);
        if (value === null) return null;
        return t('calc', lang, s.replace(/\s+/g, ' ').trim(), formatNumber(value));
    }

    // ------------------------------------------------------------------
    // ЯДРО: дата, час, випадковість, "хто ти"
    // ------------------------------------------------------------------
    function skillTime(text, lang) {
        const s = String(text || '').toLowerCase();
        const asksTime = /(котра\s+(зараз\s+)?годин|скільки\s+(зараз\s+)?часу|який\s+(зараз\s+)?час|который\s+(сейчас\s+)?час|сколько\s+(сейчас\s+)?времени|what\s+time|current\s+time)/.test(s);
        const asksDate = /(яка\s+(сьогодні\s+)?дата|який\s+(сьогодні\s+)?день|яке\s+(сьогодні\s+)?число|какая\s+(сегодня\s+)?дата|какой\s+(сегодня\s+)?день|какое\s+(сегодня\s+)?число|what\s+(is\s+)?(the\s+)?date|what\s+day|today'?s\s+date)/.test(s);
        if (!asksTime && !asksDate) return null;
        const locale = lang === 'en' ? 'en-GB' : (lang === 'ru' ? 'ru-RU' : 'uk-UA');
        try {
            const d = new Date();
            const opts = { timeZone: tz };
            let out;
            if (asksTime && !asksDate) out = d.toLocaleTimeString(locale, Object.assign({ hour: '2-digit', minute: '2-digit' }, opts));
            else if (asksDate && !asksTime) out = d.toLocaleDateString(locale, Object.assign({ dateStyle: 'full' }, opts));
            else out = d.toLocaleString(locale, Object.assign({ dateStyle: 'full', timeStyle: 'short' }, opts));
            return t('now', lang, String(out).replace(/\.$/, ''));
        } catch (e) {
            return null;
        }
    }

    function skillRandom(text, lang) {
        const s = String(text || '').toLowerCase();
        if (/(підкинь|подкинь|кинь|кидай|flip)\s*(мою\s+)?(монет|coin)/.test(s) || /орел\s+чи\s+решка|орёл\s+или\s+решка|heads\s+or\s+tails/.test(s)) {
            return crypto.randomInt(0, 2) === 0 ? t('coin_heads', lang) : t('coin_tails', lang);
        }
        if (/(кинь|кидай|підкинь|брось|подкинь|roll)\s*(гральн[а-яіїєґё]*\s+)?(кубик|кость|dice|die)/.test(s)) {
            return t('dice', lang, String(crypto.randomInt(1, 7)));
        }
        const range = s.match(/(випадков[а-яіїєґё]+|случайн[а-яіїєґё]+|random)\s+(число|number)?\s*(від|от|from|between)?\s*(-?\d+)\s*(до|до числа|по|to|and|-)\s*(-?\d+)/);
        if (range) {
            let a = parseInt(range[4], 10);
            let b = parseInt(range[6], 10);
            if (a > b) { const tmp = a; a = b; b = tmp; }
            if (b - a < 1e9) return t('random', lang, String(crypto.randomInt(a, b + 1)));
        }
        return null;
    }

    function skillIdentity(text, lang) {
        const s = String(text || '').toLowerCase().trim().replace(/[?!.]+$/g, '');
        if (/^(хто ти|ти хто|хто ти така|хто ти такий|як тебе звати|що ти вмієш|що ти вмієш робити|кто ты|ты кто|как тебя зовут|что ты умеешь|who are you|what are you|what can you do|what's your name)$/.test(s)) {
            return t('who', lang);
        }
        return null;
    }

    // ------------------------------------------------------------------
    // ЯДРО: памʼять фактів
    // ------------------------------------------------------------------
    async function listFacts(email) {
        return dbAll('SELECT id, fact FROM kai_facts WHERE email = ? ORDER BY timestamp ASC', [email]);
    }

    async function addFact(email, fact) {
        const clean = String(fact || '').trim().replace(/\s+/g, ' ').slice(0, 240);
        if (clean.length < 2) return false;
        const existing = await listFacts(email);
        if (existing.some((f) => String(f.fact).toLowerCase() === clean.toLowerCase())) return true;
        if (existing.length >= FACT_LIMIT) await dbRun('DELETE FROM kai_facts WHERE id = ?', [existing[0].id]);
        await dbRun('INSERT INTO kai_facts (id, email, fact, timestamp) VALUES (?, ?, ?, ?)',
            ['f_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'), email, clean, Date.now()]);
        return true;
    }

    async function skillMemory(email, text, lang, settings) {
        const raw = String(text || '').trim();
        const s = raw.toLowerCase().replace(/[?!.]+$/g, '').trim();

        if (/^(забудь все|забудь усе|забудь всё|забудь все про мене|забудь все обо мне|очисти памʼять фактів|forget everything|forget all)/.test(s)) {
            await dbRun('DELETE FROM kai_facts WHERE email = ?', [email]);
            return t('facts_cleared', lang);
        }

        if (/^(що ти (про мене )?знаєш|що ти памʼятаєш|що ти пам'ятаєш про мене|что ты (обо мне )?знаешь|что ты помнишь обо мне|what do you (know|remember) about me|мої факти)/.test(s)) {
            const facts = await listFacts(email);
            if (facts.length === 0) return t('facts_none', lang);
            return t('facts_head', lang) + '\n' + facts.map((f, i) => `${i + 1}. ${f.fact}`).join('\n');
        }

        if (/^(як мене звати|как меня зовут|what'?s my name|what is my name)$/.test(s)) {
            const facts = await listFacts(email);
            const nameFact = facts.find((f) => /^(імʼя|імя|имя|name):/i.test(f.fact));
            if (!nameFact) return t('no_name', lang);
            return t('your_name', lang, nameFact.fact.replace(/^[^:]+:\s*/, ''));
        }

        const nameMatch = raw.match(/^(?:мене звати|мене кличуть|меня зовут|my name is|call me)\s+([A-Za-zА-Яа-яІіЇїЄєҐґЁё'ʼ-]{2,30})/i);
        if (nameMatch) {
            if (!settings.memory) return t('memory_off', lang);
            const name = nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1);
            await dbRun("DELETE FROM kai_facts WHERE email = ? AND (fact LIKE 'Імʼя:%' OR fact LIKE 'Имя:%' OR fact LIKE 'Name:%')", [email]);
            await addFact(email, (lang === 'en' ? 'Name: ' : (lang === 'ru' ? 'Имя: ' : 'Імʼя: ')) + name);
            return t('name_remembered', lang, name);
        }

        const rem = raw.match(/^(?:запам['’ʼ]?ятай|запомни|remember)(?:\s*,)?\s*(?:що|что|that)?\s*[:\-]?\s*(.{2,240})$/i);
        if (rem) {
            if (!settings.memory) return t('memory_off', lang);
            await addFact(email, rem[1]);
            return t('remembered', lang) + rem[1].trim();
        }
        return null;
    }

    // Невеликі репліки — лише як запасний варіант, коли мовний модуль недоступний
    function skillSmallTalk(text, lang) {
        const s = String(text || '').toLowerCase().trim().replace(/[?!.,]+$/g, '');
        if (/^(привіт|вітаю|добрий день|добрий вечір|доброго ранку|привет|здравствуйте|добрый день|добрый вечер|hi|hello|hey|good (morning|evening))$/.test(s)) return t('hello', lang);
        if (/^(дякую|дякую тобі|спасибі|спасибо|благодарю|thanks|thank you)$/.test(s)) return t('thanks', lang);
        if (/^(як справи|як ти|как дела|как ты|how are you)$/.test(s)) return t('fine', lang);
        return null;
    }

    async function coreAnswer(email, text, lang, settings) {
        const mem = await skillMemory(email, text, lang, settings);
        if (mem) return { text: mem, skill: 'memory' };
        const id = skillIdentity(text, lang);
        if (id) return { text: id, skill: 'identity' };
        const time = skillTime(text, lang);
        if (time) return { text: time, skill: 'time' };
        const rnd = skillRandom(text, lang);
        if (rnd) return { text: rnd, skill: 'random' };
        const math = skillMath(text, lang);
        if (math) return { text: math, skill: 'math' };
        return null;
    }

    // ------------------------------------------------------------------
    // Мовний модуль: OpenAI-сумісні провайдери
    // ------------------------------------------------------------------
    function providers() {
        const list = [];
        if (process.env.KISHKA_AI_URL) {
            list.push({
                name: 'custom',
                url: process.env.KISHKA_AI_URL,
                key: process.env.KISHKA_AI_KEY || '',
                model: process.env.KISHKA_AI_MODEL || 'default'
            });
        }
        const pollKey = process.env.POLLINATIONS_KEY || '';
        list.push({ name: 'pollinations-fast', url: 'https://text.pollinations.ai/openai', key: pollKey, model: 'openai-fast' });
        list.push({ name: 'pollinations-mistral', url: 'https://text.pollinations.ai/openai', key: pollKey, model: 'mistral' });
        list.push({ name: 'pollinations-gen', url: 'https://gen.pollinations.ai/v1/chat/completions', key: pollKey, model: 'openai-fast' });
        return list;
    }

    function postJson(urlStr, body, headers, job) {
        return new Promise((resolve, reject) => {
            if (job && job.cancelled) return reject(new Error('CANCELLED'));
            let u;
            try { u = new URL(urlStr); } catch (e) { return reject(e); }
            const lib = u.protocol === 'http:' ? http : https;
            const payload = JSON.stringify(body);
            const req = lib.request({
                hostname: u.hostname,
                port: u.port || undefined,
                path: u.pathname + u.search,
                method: 'POST',
                headers: Object.assign({
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    'User-Agent': 'KishkaMessenger/3.1'
                }, headers || {})
            }, (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    if (job) job.reqs.delete(req);
                    const raw = Buffer.concat(chunks).toString('utf8');
                    let json = null;
                    try { json = JSON.parse(raw); } catch (e) {}
                    resolve({ status: res.statusCode, json, raw, headers: res.headers });
                });
                res.on('error', (e) => { if (job) job.reqs.delete(req); reject(e); });
            });
            if (job) job.reqs.add(req);
            req.setTimeout(120000, () => req.destroy(new Error('PROVIDER_TIMEOUT')));
            req.on('error', (e) => { if (job) job.reqs.delete(req); reject(e); });
            req.write(payload);
            req.end();
        });
    }

    function extractChatText(res) {
        const j = res.json;
        if (j && Array.isArray(j.choices) && j.choices[0]) {
            const m = j.choices[0].message;
            if (m && typeof m.content === 'string') return m.content;
            if (typeof j.choices[0].text === 'string') return j.choices[0].text;
        }
        if (res.status === 200 && typeof res.raw === 'string' && res.raw.trim() && !j) return res.raw;
        return '';
    }

    const TEMPERATURE = { low: 0.3, mid: 0.7, high: 1.0 };

    // Кілька кіл по всіх провайдерах; 429 — чекаємо і пробуємо знову; якщо ніхто не відповів — повертаємо null
    async function askBrain(messages, settings, job, opts) {
        const options = opts || {};
        const list = providers();
        for (let round = 0; round < 3; round++) {
            for (const p of list) {
                checkCancelled(job);
                try {
                    const headers = {};
                    if (p.key) headers.Authorization = 'Bearer ' + p.key;
                    const body = {
                        model: p.model,
                        messages,
                        temperature: options.temperature !== undefined ? options.temperature : (TEMPERATURE[settings.creativity] || 0.7),
                        stream: false
                    };
                    const res = await postJson(p.url, body, headers, job);
                    if (res.status === 200) {
                        const text = extractChatText(res).trim();
                        if (text) return { text, provider: p.name };
                    } else if (res.status === 429) {
                        const retry = parseInt(res.headers && res.headers['retry-after'], 10);
                        await sleep(Math.min((isFinite(retry) && retry > 0 ? retry : 4) * 1000, 20000));
                    } else {
                        console.error(`Kishka AI ${p.name}: HTTP ${res.status}`);
                    }
                } catch (e) {
                    if (e && e.message === 'CANCELLED') throw e;
                    console.error(`Kishka AI ${p.name}:`, e && e.message);
                }
            }
            await sleep(1500 * (round + 1));
        }
        return null;
    }

    const STYLE_TEXT = {
        balanced: { uk: 'Відповідай чітко і по суті, середньої довжини.', ru: 'Отвечай чётко и по существу, средней длины.', en: 'Answer clearly and to the point, with medium length.' },
        short: { uk: 'Відповідай максимально коротко: 1-3 речення, якщо користувач не просить більше.', ru: 'Отвечай максимально коротко: 1-3 предложения, если пользователь не просит больше.', en: 'Answer as briefly as possible: 1-3 sentences unless asked for more.' },
        detailed: { uk: 'Відповідай докладно, з поясненнями, прикладами та кроками.', ru: 'Отвечай подробно, с объяснениями, примерами и шагами.', en: 'Answer in detail, with explanations, examples and steps.' },
        friendly: { uk: 'Говори тепло, по-дружньому, неформально, але по суті.', ru: 'Говори тепло, по-дружески, неформально, но по делу.', en: 'Speak warmly, in a friendly informal tone, but stay on point.' }
    };

    async function buildSystem(email, userName, lang, settings) {
        const facts = settings.memory ? await listFacts(email) : [];
        const styleLine = (STYLE_TEXT[settings.style] || STYLE_TEXT.balanced)[lang];
        const langName = lang === 'en' ? 'English' : (lang === 'ru' ? 'Russian' : 'Ukrainian');
        let sys =
            'You are Kishka AI (Ukrainian: «Кішка ШІ», Russian: «Кішка ИИ»), the built-in artificial intelligence of the Kishka messenger. ' +
            'You are not Gemini, not ChatGPT and not any other named assistant: if asked, you are Kishka AI. ' +
            `Always reply in ${langName} unless the user clearly writes in another language. ${styleLine} ` +
            `Current date and time: ${nowText(lang)}. ` +
            'You remember this conversation. You can calculate, tell the date and time, and create images when the user asks to draw something. ' +
            'You cannot browse the internet: for fresh news, prices or events say that web search is available in the Gemini tab of this app. ' +
            'Never use emoji or smileys. Never invent facts: if you do not know, say so.';
        if (userName) sys += ` The user is called ${userName}.`;
        if (facts.length > 0) {
            sys += ' Facts the user asked you to remember: ' + facts.map((f) => f.fact).join('; ') + '.';
        }
        return sys;
    }

    // ------------------------------------------------------------------
    // Зображення
    // ------------------------------------------------------------------
    const IMAGE_INTENT = new RegExp(
        '(намал[юі]|нарису[йй]|згенеру[йї]|сгенери[рр]у[йй]|створи[^.!?\\n]{0,20}(зображенн|картинк|малюн|фото|ілюстрац|постер|логотип|обої)|' +
        'создай[^.!?\\n]{0,20}(изображени|картинк|рисун|фото|иллюстрац|постер|логотип|обои)|' +
        'зроби[^.!?\\n]{0,20}(зображенн|картинк|малюн|ілюстрац|постер|логотип|обої)|' +
        'сделай[^.!?\\n]{0,20}(изображени|картинк|рисун|иллюстрац|постер|логотип|обои)|' +
        '\\bdraw\\b|\\bpaint\\b|\\billustrate\\b|' +
        '(generate|create|make|render)[^.!?\\n]{0,25}(image|picture|photo|drawing|illustration|logo|wallpaper|poster|avatar|art))',
        'i'
    );

    function wantsImage(text, mode) {
        if (mode === 'image') return true;
        if (mode === 'chat') return false;
        return IMAGE_INTENT.test(String(text || ''));
    }

    function imageSize(text, setting) {
        if (setting === 'square') return { w: 1024, h: 1024 };
        if (setting === 'landscape') return { w: 1344, h: 768 };
        if (setting === 'portrait') return { w: 768, h: 1344 };
        const s = String(text || '').toLowerCase();
        if (/(горизонталь|landscape|16:9|широк|панорам)/.test(s)) return { w: 1344, h: 768 };
        if (/(вертикаль|portrait|9:16|для телефон|сторіс|stories|обои на телефон|обої на телефон)/.test(s)) return { w: 768, h: 1344 };
        return { w: 1024, h: 1024 };
    }

    const IMAGE_STYLE = {
        auto: '',
        realistic: ', photorealistic, natural lighting, high detail, sharp focus',
        anime: ', anime style, vibrant colors, clean line art',
        art: ', digital painting, artistic, rich colors, detailed brush strokes',
        render3d: ', 3D render, soft studio lighting, smooth materials, high detail',
        pixel: ', pixel art, retro game style, limited color palette'
    };

    function httpGetBinary(urlStr, job, headers, redirects) {
        redirects = redirects || 0;
        return new Promise((resolve, reject) => {
            if (job && job.cancelled) return reject(new Error('CANCELLED'));
            let u;
            try { u = new URL(urlStr); } catch (e) { return reject(e); }
            const lib = u.protocol === 'http:' ? http : https;
            const req = lib.get({
                hostname: u.hostname,
                port: u.port || undefined,
                path: u.pathname + u.search,
                headers: Object.assign({ 'User-Agent': 'KishkaMessenger/3.1', Accept: 'image/*,*/*;q=0.5' }, headers || {})
            }, (res) => {
                if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 3) {
                    res.resume();
                    if (job) job.reqs.delete(req);
                    let next;
                    try { next = new URL(res.headers.location, urlStr).toString(); } catch (e) { return reject(e); }
                    return resolve(httpGetBinary(next, job, headers, redirects + 1));
                }
                const chunks = [];
                let total = 0;
                res.on('data', (c) => {
                    total += c.length;
                    if (total > 20 * 1024 * 1024) { req.destroy(new Error('TOO_BIG')); return; }
                    chunks.push(c);
                });
                res.on('end', () => {
                    if (job) job.reqs.delete(req);
                    resolve({
                        status: res.statusCode,
                        mime: String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase(),
                        data: Buffer.concat(chunks)
                    });
                });
                res.on('error', (e) => { if (job) job.reqs.delete(req); reject(e); });
            });
            if (job) job.reqs.add(req);
            req.setTimeout(240000, () => req.destroy(new Error('IMAGE_TIMEOUT')));
            req.on('error', (e) => { if (job) job.reqs.delete(req); reject(e); });
        });
    }

    function imageUrls(prompt, size) {
        const seed = Math.floor(Math.random() * 1000000000);
        const enc = encodeURIComponent(prompt.slice(0, 900));
        const urls = [];
        if (process.env.KISHKA_AI_IMAGE_URL) {
            urls.push({
                url: process.env.KISHKA_AI_IMAGE_URL
                    .replace('{prompt}', enc).replace('{width}', String(size.w)).replace('{height}', String(size.h)).replace('{seed}', String(seed)),
                headers: {}
            });
        }
        const auth = process.env.POLLINATIONS_KEY ? { Authorization: 'Bearer ' + process.env.POLLINATIONS_KEY } : {};
        urls.push({ url: `https://image.pollinations.ai/prompt/${enc}?model=flux&width=${size.w}&height=${size.h}&seed=${seed}&nologo=true&private=true`, headers: auth });
        urls.push({ url: `https://image.pollinations.ai/prompt/${enc}?model=turbo&width=${size.w}&height=${size.h}&seed=${seed + 1}&nologo=true&private=true`, headers: auth });
        urls.push({ url: `https://gen.pollinations.ai/image/${enc}?model=flux&width=${size.w}&height=${size.h}&seed=${seed + 2}&nologo=true`, headers: auth });
        return urls;
    }

    async function generateImage(userText, settings, job) {
        const size = imageSize(userText, settings.imageSize);

        // Опис для моделі зображень: просимо мовний модуль зробити детальний англійський промпт; якщо він недоступний — беремо текст як є
        let prompt = userText.replace(/^(будь ласка,?\s*|пожалуйста,?\s*|please,?\s*)/i, '').trim();
        try {
            const rewritten = await askBrainOnce([
                { role: 'system', content: 'Rewrite the user request into ONE detailed English prompt for a text-to-image model. Describe subject, setting, lighting, colors and composition. Do not add any text, letters or watermarks to the image. Output ONLY the prompt, without quotes or explanations.' },
                { role: 'user', content: userText }
            ], job);
            if (rewritten && rewritten.length >= 5) prompt = rewritten.replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 800);
        } catch (e) {
            if (e && e.message === 'CANCELLED') throw e;
        }
        prompt += IMAGE_STYLE[settings.imageStyle] || '';

        let lastErr = null;
        for (let round = 0; round < 3; round++) {
            for (const item of imageUrls(prompt, size)) {
                checkCancelled(job);
                try {
                    const r = await httpGetBinary(item.url, job, item.headers);
                    if (r.status === 200 && /^image\//.test(r.mime) && r.data.length > 1000) {
                        return { mime: r.mime === 'image/jpg' ? 'image/jpeg' : r.mime, data: r.data };
                    }
                    lastErr = new Error('HTTP ' + r.status);
                } catch (e) {
                    if (e && e.message === 'CANCELLED') throw e;
                    lastErr = e;
                }
            }
            await sleep(2500 * (round + 1));
        }
        console.error('Kishka AI image:', lastErr && lastErr.message);
        throw new Error('IMAGE_FAILED');
    }

    // Один швидкий запит до мовного модуля (для службових завдань); null, якщо недоступний
    async function askBrainOnce(messages, job) {
        const list = providers();
        for (const p of list) {
            checkCancelled(job);
            try {
                const headers = {};
                if (p.key) headers.Authorization = 'Bearer ' + p.key;
                const res = await postJson(p.url, { model: p.model, messages, temperature: 0.7, stream: false }, headers, job);
                if (res.status === 200) {
                    const text = extractChatText(res).trim();
                    if (text) return text;
                }
            } catch (e) {
                if (e && e.message === 'CANCELLED') throw e;
            }
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Події сокета
    // ------------------------------------------------------------------
    const jobs = new Map(); // email -> job

    io.on('connection', (socket) => {

        socket.on('kai_get_history', async (email, callback) => {
            const cb = typeof callback === 'function' ? callback : () => {};
            const clean = cleanEmail(email);
            if (!clean) return cb({ success: false, messages: [] });
            try {
                const rows = await dbAll(
                    `SELECT id, role, text, timestamp, "imageId", model FROM (
                        SELECT id, role, text, timestamp, image_id AS "imageId", model
                        FROM kai_messages WHERE email = ? ORDER BY timestamp DESC LIMIT ?
                     ) AS recent ORDER BY timestamp ASC`,
                    [clean, HISTORY_LIMIT]
                );
                cb({
                    success: true,
                    messages: rows.map((r) => ({
                        id: r.id, role: r.role, text: r.text, timestamp: r.timestamp, model: r.model || null,
                        imageUrl: r.imageId ? '/gemini-image/' + r.imageId : null
                    }))
                });
            } catch (err) {
                console.error('Kishka AI history error:', err.message);
                cb({ success: false, messages: [] });
            }
        });

        socket.on('kai_get_status', (email, callback) => {
            const cb = typeof callback === 'function' ? callback : () => {};
            const clean = cleanEmail(email);
            if (clean) socket.join(clean);
            const job = clean ? jobs.get(clean) : null;
            cb({ success: true, busy: !!job, startedAt: job ? job.startedAt : 0, image: !!(job && job.isImage) });
        });

        socket.on('kai_get_facts', async (email, callback) => {
            const cb = typeof callback === 'function' ? callback : () => {};
            const clean = cleanEmail(email);
            if (!clean) return cb({ success: false, facts: [] });
            try {
                const facts = await listFacts(clean);
                cb({ success: true, facts: facts.map((f) => f.fact) });
            } catch (err) {
                cb({ success: false, facts: [] });
            }
        });

        socket.on('kai_clear_facts', async (email, callback) => {
            const cb = typeof callback === 'function' ? callback : () => {};
            const clean = cleanEmail(email);
            if (!clean) return cb({ success: false });
            try {
                await dbRun('DELETE FROM kai_facts WHERE email = ?', [clean]);
                cb({ success: true });
            } catch (err) {
                cb({ success: false });
            }
        });

        socket.on('kai_send', async (data, callback) => {
            const ackCb = typeof callback === 'function' ? callback : () => {};
            const { email, name, text, mode, lang: rawLang, settings: rawSettings } = data || {};
            const uiLang = langOf(rawLang);
            const clean = cleanEmail(email);
            const cleanText = (typeof text === 'string' ? text : '').trim();
            const settings = cleanSettings(rawSettings);

            if (!clean || !cleanText) return ackCb({ success: false, error: t('empty', uiLang) });
            if (cleanText.length > MAX_TEXT) return ackCb({ success: false, error: t('too_long', uiLang) });
            if (jobs.has(clean)) return ackCb({ success: false, error: t('busy', uiLang) });

            socket.join(clean);
            const job = makeJob();
            const drawing = wantsImage(cleanText, mode);
            job.isImage = drawing;
            jobs.set(clean, job);

            const finish = (payload) => {
                ackCb(payload);
                io.to(clean).emit('kai_done', payload);
            };

            const now = Date.now();
            const userMsgId = `k_${now}_${Math.random().toString(36).slice(2, 8)}`;

            try {
                await dbRun('INSERT INTO kai_messages (id, email, role, text, timestamp) VALUES (?, ?, ?, ?, ?)',
                    [userMsgId, clean, 'user', cleanText, now]);

                const lang = detectLang(cleanText, uiLang);
                let reply;

                if (drawing) {
                    const img = await generateImage(cleanText, settings, job);
                    checkCancelled(job);
                    const imageId = crypto.randomBytes(16).toString('hex');
                    await dbRun('INSERT INTO gemini_images (id, email, mime, data, timestamp) VALUES (?, ?, ?, ?, ?)',
                        [imageId, clean, img.mime, img.data, Date.now()]);
                    reply = { text: '', model: 'kishka-ai', imageId };
                } else {
                    const core = await coreAnswer(clean, cleanText, lang, settings);
                    if (core) {
                        reply = { text: core.text, model: 'kishka-core', imageId: null };
                    } else {
                        const rows = await dbAll(
                            'SELECT role, text, image_id AS "imageId" FROM kai_messages WHERE email = ? ORDER BY timestamp DESC, id DESC LIMIT ?',
                            [clean, CONTEXT_LIMIT]
                        );
                        rows.reverse();
                        while (rows.length > 0 && rows[0].role !== 'user') rows.shift();
                        const system = await buildSystem(clean, (typeof name === 'string' ? name : '').trim().slice(0, 60), lang, settings);
                        const messages = [{ role: 'system', content: system }].concat(rows.map((r) => ({
                            role: r.role === 'model' ? 'assistant' : 'user',
                            content: (r.text && r.text.trim()) ? r.text : (r.imageId ? '[generated image]' : '[empty]')
                        })));

                        const answer = await askBrain(messages, settings, job);
                        checkCancelled(job);
                        if (answer) {
                            reply = { text: stripEmoji(answer.text), model: 'kishka-ai', imageId: null };
                        } else {
                            reply = { text: skillSmallTalk(cleanText, lang) || t('brain_down', lang), model: 'kishka-core', imageId: null };
                        }
                    }
                }

                const replyId = `k_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const replyTime = Date.now();
                await dbRun('INSERT INTO kai_messages (id, email, role, text, timestamp, image_id, model) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [replyId, clean, 'model', reply.text, replyTime, reply.imageId, reply.model]);

                finish({
                    success: true,
                    reply: {
                        id: replyId, role: 'model', text: reply.text, timestamp: replyTime, model: reply.model,
                        imageUrl: reply.imageId ? '/gemini-image/' + reply.imageId : null
                    }
                });
            } catch (err) {
                const cancelled = err && err.message === 'CANCELLED';
                if (!cancelled) console.error('Kishka AI send error:', err && err.message);
                try { await dbRun('DELETE FROM kai_messages WHERE id = ?', [userMsgId]); } catch (e) {}
                if (cancelled) {
                    ackCb({ success: false, cancelled: true, error: t('stopped', uiLang) });
                } else {
                    const msg = err && err.message === 'IMAGE_FAILED' ? t('image_failed', uiLang) : t('brain_down', uiLang);
                    finish({ success: false, cancelled: false, error: msg });
                }
            } finally {
                if (jobs.get(clean) === job) jobs.delete(clean);
            }
        });

        socket.on('kai_cancel', (email, callback) => {
            const cb = typeof callback === 'function' ? callback : () => {};
            const clean = cleanEmail(email);
            const job = jobs.get(clean);
            if (job) {
                cancelJob(job);
                jobs.delete(clean);
            }
            cb({ success: true });
        });

        socket.on('kai_clear', async (email, callback) => {
            const cb = typeof callback === 'function' ? callback : () => {};
            const clean = cleanEmail(email);
            if (!clean) return cb({ success: false });
            try {
                await dbRun('DELETE FROM kai_messages WHERE email = ?', [clean]);
                cb({ success: true });
            } catch (err) {
                console.error('Kishka AI clear error:', err.message);
                cb({ success: false });
            }
        });
    });

    // Для перевірок без сервера (тести ядра)
    return { evalMath, skillMath, skillTime, skillRandom, skillIdentity, detectLang, cleanSettings };
};
