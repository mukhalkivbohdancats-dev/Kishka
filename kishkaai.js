'use strict';

// =====================================================================
// KISHKA AI (Кішка ШІ) — власний штучний інтелект месенджера Kishka.
// НЕ використовує жодних чужих ШІ, мовних моделей чи сервісів: ні Gemini, ні Pollinations, ні OpenAI.
// Усе написано в самому Kishka і працює на сервері без зовнішніх запитів.
//
// Дві моделі (як вибір моделей у Gemini):
//   kishka-1      — текстова: розмова, памʼять фактів, навчання («Навчу тебе: питання = відповідь»), калькулятор,
//                   конвертер одиниць, дата й час, списки й нотатки, пароль, випадковості, країни й столиці,
//                   невелика база знань, жарти, факти, поради.
//   kishka-image  — генерація зображень власним алгоритмом (файл kishkaimage.js).
//
// Чесно: власний рушій Kishka-1 — це не велика нейромережа, тому на «будь-яке» питання і «будь-яке» зображення він сам
// відповісти не може. Щоб Кішка ШІ відповідала на ВСЕ й малювала ВСЕ, сервер (server.js) підключає загальний ШІ-бекенд
// через ctx.generalAnswer / ctx.generalImage: коли власний рушій не знає відповіді, питання йде туди, а відповідь
// подається від імені Кішки ШІ. Вимкнути це можна змінною KISHKA_AI_BACKEND=off (тоді Кішка ШІ знову працює лише сама).
//
// Події сокета: kai_get_models, kai_get_history, kai_get_status, kai_get_facts, kai_clear_facts, kai_send,
//               kai_cancel, kai_clear.
// =====================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Сусідні файли шукаємо без урахування регістру (на Linux/Render Kishkaimage.js і kishkaimage.js — різні файли)
function requireSibling(name) {
    const found = fs.readdirSync(__dirname).find((f) => f.toLowerCase() === name.toLowerCase());
    if (!found) throw new Error('Не знайдено файл ' + name + ' поруч із server.js');
    return require(path.join(__dirname, found));
}

const KB = requireSibling('kishkaknowledge.js');
let imageEngine = null;
try {
    imageEngine = requireSibling('kishkaimage.js');
} catch (e) {
    console.error('Kishka-image вимкнено:', e.message);
}

const MODELS = [
    { id: 'kishka-1', label: 'Kishka-1', type: 'text' },
    { id: 'kishka-image', label: 'Kishka-image', type: 'image' }
];

const MAX_TEXT = 6000;
const HISTORY_LIMIT = 300;
const FACT_LIMIT = 60;
const RULE_LIMIT = 100;
const NOTE_LIMIT = 100;

// ---------------------------------------------------------------------
// Тексти (3 мови)
// ---------------------------------------------------------------------
const T = {
    stopped: { uk: 'Запит зупинено', ru: 'Запрос остановлен', en: 'Request stopped' },
    empty: { uk: 'Порожнє повідомлення', ru: 'Пустое сообщение', en: 'Empty message' },
    too_long: { uk: 'Повідомлення занадто довге', ru: 'Сообщение слишком длинное', en: 'The message is too long' },
    busy: { uk: 'Кішка ШІ ще відповідає на попереднє повідомлення', ru: 'Кішка ИИ ещё отвечает на предыдущее сообщение', en: 'Kishka AI is still answering the previous message' },
    image_failed: { uk: 'Не вдалося створити зображення. Спробуйте інший опис', ru: 'Не удалось создать изображение. Попробуйте другое описание', en: 'Could not create the image. Try another description' },
    image_off: { uk: 'Генератор зображень Kishka-image зараз недоступний на сервері', ru: 'Генератор изображений Kishka-image сейчас недоступен на сервере', en: 'The Kishka-image generator is not available on the server right now' },
    error: { uk: 'Сталася помилка. Спробуйте ще раз', ru: 'Произошла ошибка. Попробуйте ещё раз', en: 'Something went wrong. Please try again' },
    draw_hint: {
        uk: 'Щоб я намалювала зображення, оберіть модель Kishka-image (кнопка моделі зліва від поля вводу) і опишіть, що намалювати.',
        ru: 'Чтобы я нарисовала изображение, выберите модель Kishka-image (кнопка модели слева от поля ввода) и опишите, что нарисовать.',
        en: 'To make me draw an image, choose the Kishka-image model (the model button left of the input field) and describe what to draw.'
    },
    remembered: { uk: 'Запамʼятала: ', ru: 'Запомнила: ', en: 'Remembered: ' },
    name_remembered: { uk: 'Приємно познайомитись, %s! Запамʼятала ваше імʼя.', ru: 'Приятно познакомиться, %s! Запомнила ваше имя.', en: 'Nice to meet you, %s! I will remember your name.' },
    your_name: { uk: 'Вас звати %s.', ru: 'Вас зовут %s.', en: 'Your name is %s.' },
    no_name: { uk: 'Я ще не знаю вашого імені. Напишіть: «Мене звати ...».', ru: 'Я ещё не знаю вашего имени. Напишите: «Меня зовут ...».', en: 'I do not know your name yet. Write: “My name is ...”.' },
    facts_none: { uk: 'Я поки нічого не запамʼятала про вас. Напишіть: «Запамʼятай, що ...».', ru: 'Я пока ничего не запомнила о вас. Напишите: «Запомни, что ...».', en: 'I have not remembered anything about you yet. Write: “Remember that ...”.' },
    facts_head: { uk: 'Ось що я про вас памʼятаю:', ru: 'Вот что я о вас помню:', en: 'Here is what I remember about you:' },
    facts_cleared: { uk: 'Готово, я забула всі збережені факти про вас.', ru: 'Готово, я забыла все сохранённые факты о вас.', en: 'Done, I forgot all the saved facts about you.' },
    memory_off: { uk: 'Памʼять вимкнена в налаштуваннях ШІ (Акаунт). Увімкніть її, щоб я могла щось запамʼятовувати.', ru: 'Память выключена в настройках ИИ (Аккаунт). Включите её, чтобы я могла что-то запоминать.', en: 'Memory is turned off in the AI settings (Account). Turn it on so I can remember things.' },
    taught: { uk: 'Дякую, навчилась! Тепер на «%s» я відповідатиму: %s', ru: 'Спасибо, выучила! Теперь на «%s» я буду отвечать: %s', en: 'Thanks, I learned it! Now to “%s” I will answer: %s' },
    rules_none: { uk: 'Ви ще нічого мене не навчили. Напишіть: «Навчу тебе: питання = відповідь».', ru: 'Вы ещё ничему меня не научили. Напишите: «Научу тебя: вопрос = ответ».', en: 'You have not taught me anything yet. Write: “Teach you: question = answer”.' },
    rules_head: { uk: 'Ось чого ви мене навчили:', ru: 'Вот чему вы меня научили:', en: 'Here is what you taught me:' },
    rules_cleared: { uk: 'Готово, я забула все, чого ви мене навчили.', ru: 'Готово, я забыла всё, чему вы меня научили.', en: 'Done, I forgot everything you taught me.' },
    coin_heads: { uk: 'Випав орел.', ru: 'Выпал орёл.', en: 'Heads.' },
    coin_tails: { uk: 'Випала решка.', ru: 'Выпала решка.', en: 'Tails.' },
    dice: { uk: 'На кубику випало: %s.', ru: 'На кубике выпало: %s.', en: 'The dice shows: %s.' },
    random: { uk: 'Випадкове число: %s.', ru: 'Случайное число: %s.', en: 'Random number: %s.' },
    now: { uk: 'Зараз %s.', ru: 'Сейчас %s.', en: 'It is %s now.' },
    now_city: { uk: 'У місті %s зараз %s.', ru: 'В городе %s сейчас %s.', en: 'In %s it is %s now.' },
    weekday: { uk: '%s — це %s.', ru: '%s — это %s.', en: '%s is a %s.' },
    days_until: { uk: 'До %s залишилось днів: %s.', ru: 'До %s осталось дней: %s.', en: 'Days until %s: %s.' },
    days_since: { uk: 'З %s минуло днів: %s.', ru: 'С %s прошло дней: %s.', en: 'Days since %s: %s.' },
    date_is: { uk: 'Це буде %s', ru: 'Это будет %s', en: 'That will be %s' },
    date_was: { uk: 'Це було %s', ru: 'Это было %s', en: 'That was %s' },
    new_year: { uk: 'Нового року', ru: 'Нового года', en: 'New Year' },
    capital: { uk: 'Столиця країни «%s» — %s.', ru: 'Столица страны «%s» — %s.', en: 'The capital of %s is %s.' },
    convert: { uk: '%s = %s', ru: '%s = %s', en: '%s = %s' },
    password: { uk: 'Ваш новий пароль: %s\nНікому його не показуйте й не використовуйте на кількох сайтах.', ru: 'Ваш новый пароль: %s\nНикому его не показывайте и не используйте на нескольких сайтах.', en: 'Your new password: %s\nDo not show it to anyone and do not reuse it on several sites.' },
    chosen: { uk: 'Я обираю: %s.', ru: 'Я выбираю: %s.', en: 'I choose: %s.' },
    factorial: { uk: '%s! = %s', ru: '%s! = %s', en: '%s! = %s' },
    prime_yes: { uk: '%s — просте число.', ru: '%s — простое число.', en: '%s is a prime number.' },
    prime_no: { uk: '%s — не просте число (ділиться на %s).', ru: '%s — не простое число (делится на %s).', en: '%s is not prime (divisible by %s).' },
    gcd: { uk: 'НСД(%s) = %s', ru: 'НОД(%s) = %s', en: 'GCD(%s) = %s' },
    lcm: { uk: 'НСК(%s) = %s', ru: 'НОК(%s) = %s', en: 'LCM(%s) = %s' },
    fib: { uk: 'Число Фібоначчі №%s = %s', ru: 'Число Фибоначчи №%s = %s', en: 'Fibonacci number #%s = %s' },
    roman: { uk: '%s у римських цифрах: %s', ru: '%s римскими цифрами: %s', en: '%s in Roman numerals: %s' },
    count_chars: { uk: 'У тексті символів: %s (без пробілів: %s), слів: %s.', ru: 'В тексте символов: %s (без пробелов: %s), слов: %s.', en: 'The text has %s characters (%s without spaces) and %s words.' },
    note_added: { uk: 'Додала до списку: %s. Позицій у списку: %s.', ru: 'Добавила в список: %s. Позиций в списке: %s.', en: 'Added to the list: %s. Items in the list: %s.' },
    note_removed: { uk: 'Видалила зі списку: %s.', ru: 'Удалила из списка: %s.', en: 'Removed from the list: %s.' },
    note_missing: { uk: 'У списку немає такої позиції.', ru: 'В списке нет такой позиции.', en: 'There is no such item in the list.' },
    list_empty: { uk: 'Ваш список порожній. Напишіть: «Додай молоко до списку».', ru: 'Ваш список пуст. Напишите: «Добавь молоко в список».', en: 'Your list is empty. Write: “Add milk to the list”.' },
    list_head: { uk: 'Ваш список:', ru: 'Ваш список:', en: 'Your list:' },
    list_cleared: { uk: 'Список очищено.', ru: 'Список очищен.', en: 'The list was cleared.' },
    unknown: {
        uk: 'Я поки не знаю відповіді на це. Я Kishka-1 — власна невелика модель без чужих ШІ, тому знаю лише те, що вмію й чого мене навчили. Можу: порахувати, перевести одиниці, назвати дату й час, столицю країни, скласти список, згенерувати пароль, розповісти жарт чи факт. Ви можете навчити мене: «Навчу тебе: ваше питання = відповідь». Для складних питань і пошуку в інтернеті відкрийте вкладку Gemini.',
        ru: 'Я пока не знаю ответа на это. Я Kishka-1 — собственная небольшая модель без чужих ИИ, поэтому знаю только то, что умею и чему меня научили. Могу: посчитать, перевести единицы, назвать дату и время, столицу страны, составить список, сгенерировать пароль, рассказать шутку или факт. Вы можете научить меня: «Научу тебя: ваш вопрос = ответ». Для сложных вопросов и поиска в интернете откройте вкладку Gemini.',
        en: 'I do not know the answer to that yet. I am Kishka-1 — a small model of my own without any third-party AI, so I only know what I can do and what I was taught. I can calculate, convert units, tell the date and time, name a country\'s capital, keep a list, generate a password, tell a joke or a fact. You can teach me: “Teach you: your question = answer”. For hard questions and web search open the Gemini tab.'
    },
    related: { uk: 'Можливо, вас цікавить:', ru: 'Возможно, вас интересует:', en: 'Maybe you are interested in:' }
};

function t(key, lang, ...args) {
    const entry = T[key] || T.error || T.unknown;
    let text = entry[lang] || entry.uk;
    args.forEach((a) => { text = text.replace('%s', () => a); });
    return text;
}
T.error = { uk: 'Сталася помилка. Спробуйте ще раз', ru: 'Произошла ошибка. Попробуйте ещё раз', en: 'Something went wrong. Please try again' };

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

// ---------------------------------------------------------------------
// Нормалізація й порівняння тексту
// ---------------------------------------------------------------------
function norm(text) {
    return String(text || '').toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[\u02BC'’`]/g, '')
        .replace(/[^a-zа-яіїєґ0-9\s.+\-*/^%()=,:]/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

function tokens(text) {
    return String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/[\u02BC'’`]/g, '')
        .split(/[^a-zа-яіїєґ0-9]+/).filter((w) => w.length >= 2);
}

const STOP = new Set(['що', 'це', 'такий', 'така', 'таке', 'такі', 'хто', 'як', 'яка', 'який', 'яке', 'які', 'чому', 'коли', 'де', 'мені', 'про', 'розкажи', 'поясни',
    'скажи', 'мне', 'что', 'это', 'такое', 'кто', 'как', 'какая', 'какой', 'какое', 'какие', 'почему', 'когда', 'где', 'расскажи', 'объясни', 'the', 'is', 'are',
    'what', 'who', 'how', 'why', 'when', 'where', 'tell', 'me', 'about', 'explain', 'does', 'do', 'an', 'of', 'to', 'in', 'on', 'ви', 'ти', 'ты', 'вы', 'you']);

function stem(w) { return w.length > 5 ? w.slice(0, 5) : w; }
function stemSet(text) { return new Set(tokens(text).filter((w) => !STOP.has(w)).map(stem)); }

function jaccard(a, b) {
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    a.forEach((x) => { if (b.has(x)) inter++; });
    return inter / (a.size + b.size - inter);
}

function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ---------------------------------------------------------------------
// Калькулятор (рекурсивний спуск, без eval)
// ---------------------------------------------------------------------
function tokenizeMath(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === ' ') { i++; continue; }
        if (/[0-9.,]/.test(c)) {
            let j = i;
            while (j < src.length && /[0-9.,]/.test(src[j])) j++;
            const num = parseFloat(src.slice(i, j).replace(',', '.'));
            if (!isFinite(num)) return null;
            out.push({ t: 'n', v: num });
            i = j;
            continue;
        }
        if (/[+\-*/^%()]/.test(c)) { out.push({ t: c }); i++; continue; }
        if (/[a-z]/i.test(c)) {
            let j = i;
            while (j < src.length && /[a-z]/i.test(src[j])) j++;
            const word = src.slice(i, j).toLowerCase();
            if (['sqrt', 'abs', 'pi'].includes(word)) out.push({ t: 'f', v: word });
            else return null;
            i = j;
            continue;
        }
        return null;
    }
    return out;
}

function evalMath(src) {
    const toks = tokenizeMath(src);
    if (!toks || toks.length === 0) return null;
    let pos = 0;
    const peek = () => toks[pos];
    const next = () => toks[pos++];

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
        if (peek() && peek().t === '^') { next(); return Math.pow(base, parsePower()); }
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
            if (peek() && peek().t === '%' && !(toks[pos + 1] && (toks[pos + 1].t === 'n' || toks[pos + 1].t === '(' || toks[pos + 1].t === 'f'))) {
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
        if (pos !== toks.length || !isFinite(value)) return null;
        return value;
    } catch (e) {
        return null;
    }
}

function formatNumber(n) {
    if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
    return String(parseFloat(n.toPrecision(12)));
}

function mathExpression(text) {
    let s = String(text || '').toLowerCase().trim();
    s = s.replace(/^(скільки|сколько|what is|what's|calculate|порахуй|посчитай|обчисли|вычисли|реши|розв'яжи|розвʼяжи|розв’яжи)\s*(буде|будет|is|equals)?\s*/i, '');
    s = s.replace(/[=?]+$/g, '').trim();
    s = s.replace(/×/g, '*').replace(/÷/g, '/').replace(/[хx](?=\s*\d)/g, '*');
    s = s.replace(/(\d)\s*у\s*ступені\s*(\d)/g, '$1^$2').replace(/\*\*/g, '^');
    s = s.replace(/корінь\s*з\s*(\d+(?:[.,]\d+)?)/g, 'sqrt($1)').replace(/корень\s*из\s*(\d+(?:[.,]\d+)?)/g, 'sqrt($1)').replace(/square root of\s*(\d+(?:[.,]\d+)?)/g, 'sqrt($1)');
    s = s.replace(/(\d+(?:[.,]\d+)?)\s*%\s*(?:від|от|of)\s*(\d+(?:[.,]\d+)?)/g, '($1/100)*$2');
    s = s.replace(/(\d+(?:[.,]\d+)?)\s*(?:відсотків|процентов|процентів|percent)\s*(?:від числа|від|от|of)\s*(\d+(?:[.,]\d+)?)/g, '($1/100)*$2');
    s = s.replace(/(\d+(?:[.,]\d+)?)\s*(?:плюс|plus)\s*(?=\d)/g, '$1+').replace(/(\d+(?:[.,]\d+)?)\s*(?:мінус|минус|minus)\s*(?=\d)/g, '$1-')
        .replace(/(\d+(?:[.,]\d+)?)\s*(?:помножити на|умножить на|times|multiplied by)\s*(?=\d)/g, '$1*')
        .replace(/(\d+(?:[.,]\d+)?)\s*(?:поділити на|розділити на|разделить на|divided by)\s*(?=\d)/g, '$1/');
    return s;
}

function skillMath(text, lang, state) {
    const s = mathExpression(text);
    if (!/[0-9]/.test(s)) return null;
    if (/\d[-.\/]\d{1,4}[-.\/]\d/.test(s) && !/\s/.test(s)) return null;
    if (!/[+\-*/^%]|sqrt|abs/.test(s)) return null;
    if (!/^[0-9a-z+\-*/^%().,\s]+$/.test(s)) return null;
    if (/[a-z]/.test(s.replace(/sqrt|abs|pi/g, ''))) return null;
    const value = evalMath(s);
    if (value === null) return null;
    if (state) state.lastResult = value;
    return t('convert', lang, s.replace(/\s+/g, ' ').trim(), formatNumber(value));
}

// Продовження: «а ще помнож на 3», «+ 5», «× 2» — застосовується до останнього результату
function skillMathFollowUp(text, lang, state) {
    if (!state || state.lastResult === undefined || state.lastResult === null) return null;
    let s = norm(text).replace(/^(а\s+|ще\s+|и\s+|and\s+|then\s+)+/, '');
    s = s.replace(/^(помнож|помножи|умнож|multiply)[a-zа-яіїєґ]*\s+(?:його\s+|его\s+|it\s+)?(?:на|by)\s+/, '* ')
        .replace(/^(подели|поділи|раздели|divide)[a-zа-яіїєґ]*\s+(?:його\s+|его\s+|it\s+)?(?:на|by)\s+/, '/ ')
        .replace(/^(додай|добавь|add)\s+/, '+ ').replace(/^(відніми|вычти|subtract)\s+/, '- ');
    if (!/^[+\-*/^]\s*\d/.test(s)) return null;
    const expr = formatNumber(state.lastResult) + ' ' + s;
    const value = evalMath(expr);
    if (value === null) return null;
    state.lastResult = value;
    return t('convert', lang, expr.replace(/\s+/g, ' '), formatNumber(value));
}

// ---------------------------------------------------------------------
// Дата й час
// ---------------------------------------------------------------------
const MONTH_STEMS = [['січ', 'янв', 'jan'], ['лют', 'фев', 'feb'], ['бер', 'мар', 'mar'], ['кві', 'апр', 'apr'], ['тра', 'май', 'may'], ['чер', 'июн', 'jun'], ['лип', 'июл', 'jul'], ['сер', 'авг', 'aug'], ['вер', 'сен', 'sep'], ['жов', 'окт', 'oct'], ['лис', 'ноя', 'nov'], ['гру', 'дек', 'dec']];
const WEEKDAYS = {
    uk: ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота'],
    ru: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
    en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
};

const CITY_ZONES = [
    [['київ', 'киев', 'kyiv', 'kiev'], 'Europe/Kyiv', ['Київ', 'Киев', 'Kyiv']],
    [['лондон', 'london'], 'Europe/London', ['Лондон', 'Лондон', 'London']],
    [['париж', 'paris'], 'Europe/Paris', ['Париж', 'Париж', 'Paris']],
    [['берлін', 'берлин', 'berlin'], 'Europe/Berlin', ['Берлін', 'Берлин', 'Berlin']],
    [['варшав', 'warsaw'], 'Europe/Warsaw', ['Варшава', 'Варшава', 'Warsaw']],
    [['мадрид', 'madrid'], 'Europe/Madrid', ['Мадрид', 'Мадрид', 'Madrid']],
    [['римі', 'риме', 'rome'], 'Europe/Rome', ['Рим', 'Рим', 'Rome']],
    [['стамбул', 'istanbul'], 'Europe/Istanbul', ['Стамбул', 'Стамбул', 'Istanbul']],
    [['москв', 'moscow'], 'Europe/Moscow', ['Москва', 'Москва', 'Moscow']],
    [['нью-йорк', 'нью йорк', 'new york'], 'America/New_York', ['Нью-Йорк', 'Нью-Йорк', 'New York']],
    [['лос-анджелес', 'лос анджелес', 'los angeles'], 'America/Los_Angeles', ['Лос-Анджелес', 'Лос-Анджелес', 'Los Angeles']],
    [['токіо', 'токио', 'tokyo'], 'Asia/Tokyo', ['Токіо', 'Токио', 'Tokyo']],
    [['пекін', 'пекин', 'beijing'], 'Asia/Shanghai', ['Пекін', 'Пекин', 'Beijing']],
    [['дубай', 'dubai'], 'Asia/Dubai', ['Дубай', 'Дубай', 'Dubai']],
    [['делі', 'дели', 'delhi'], 'Asia/Kolkata', ['Делі', 'Дели', 'Delhi']],
    [['сідней', 'сидней', 'sydney'], 'Australia/Sydney', ['Сідней', 'Сидней', 'Sydney']]
];

function langIndex(lang) { return lang === 'ru' ? 1 : (lang === 'en' ? 2 : 0); }
function localeOf(lang) { return lang === 'en' ? 'en-GB' : (lang === 'ru' ? 'ru-RU' : 'uk-UA'); }

// Сьогоднішня дата в потрібному часовому поясі як UTC-опівдні (різниця в днях не залежить від літнього часу)
function todayUtc(tz) {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
        return Date.UTC(parts[0], parts[1] - 1, parts[2], 12);
    } catch (e) {
        const d = new Date();
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12);
    }
}

function fmtDateUtc(ms, lang, noWeekday) {
    const opts = noWeekday ? { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' } : { timeZone: 'UTC', dateStyle: 'full' };
    return new Date(ms).toLocaleDateString(localeOf(lang), opts);
}

function weekdayOf(ms, lang) { return WEEKDAYS[lang][new Date(ms).getUTCDay()]; }

function validDate(y, mo, d, rollForward, today) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    let ms = Date.UTC(y, mo - 1, d, 12);
    if (new Date(ms).getUTCMonth() !== mo - 1) return null;
    if (rollForward && today && ms < today) ms = Date.UTC(y + 1, mo - 1, d, 12);
    return { ms };
}

function parseDateText(textRaw, tz) {
    const s = norm(textRaw);
    const today = todayUtc(tz);
    const day = 86400000;
    if (/(післязавтра|послезавтра|day after tomorrow)/.test(s)) return { ms: today + 2 * day };
    if (/(позавчора|позавчера)/.test(s)) return { ms: today - 2 * day };
    if (/(завтра|tomorrow)/.test(s)) return { ms: today + day };
    if (/(вчора|вчера|yesterday)/.test(s)) return { ms: today - day };
    if (/(сьогодні|сегодня|today)/.test(s)) return { ms: today };
    let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return validDate(+m[1], +m[2], +m[3]);
    m = s.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
    if (m) return validDate(+m[3], +m[2], +m[1]);
    m = s.match(/(\d{1,2})[.\/](\d{1,2})(?![.\/\d])/);
    if (m) return validDate(new Date(today).getUTCFullYear(), +m[2], +m[1], true, today);
    m = s.match(/(\d{1,2})\s+([a-zа-яіїє]{3,})\s*(\d{4})?/);
    if (m) {
        const idx = MONTH_STEMS.findIndex((st) => st.some((x) => m[2].startsWith(x)));
        if (idx >= 0) return validDate(m[3] ? +m[3] : new Date(today).getUTCFullYear(), idx + 1, +m[1], !m[3], today);
    }
    return null;
}

function newYearUtc(tz) {
    const y = new Date(todayUtc(tz)).getUTCFullYear();
    return Date.UTC(y + 1, 0, 1, 12);
}

function skillTime(text, lang, ctx) {
    const s = norm(text);
    const tz = ctx.tz;
    const idx = langIndex(lang);

    const asksClock = /(котра\s+(зараз\s+)?годин|скільки\s+(зараз\s+)?часу|який\s+(зараз\s+)?час|который\s+(сейчас\s+)?час|сколько\s+(сейчас\s+)?времени|what\s+time|current\s+time|time\s+in)/.test(s);
    if (asksClock) {
        const city = CITY_ZONES.find((c) => c[0].some((n) => s.includes(n)));
        try {
            const zone = city ? city[1] : tz;
            const out = new Date().toLocaleTimeString(localeOf(lang), { timeZone: zone, hour: '2-digit', minute: '2-digit' });
            return city ? t('now_city', lang, city[2][idx], out) : t('now', lang, out);
        } catch (e) { /* нижче */ }
    }

    if (/(який день тижня|какой день недели|what day of the week|день тижня|день недели)/.test(s)) {
        const d = parseDateText(s, tz);
        if (d) return t('weekday', lang, fmtDateUtc(d.ms, lang, true), weekdayOf(d.ms, lang));
    }

    const ny = /(нов(ого|ий|ый) (року|рік|год|года)|new year)/;
    const until = s.match(/(скільки|сколько|how many).*(днів|дней|дні|days).*(до|until|before)\s+(.+)$/);
    if (until) {
        const isNy = ny.test(until[4]);
        const target = isNy ? newYearUtc(tz) : (parseDateText(until[4], tz) || {}).ms;
        if (target) {
            const days = Math.round((target - todayUtc(tz)) / 86400000);
            if (days >= 0) return t('days_until', lang, isNy ? t('new_year', lang) : fmtDateUtc(target, lang), String(days));
        }
    }
    const since = s.match(/(скільки|сколько|how many).*(днів|дней|дні|days).*(з|із|с|since|from)\s+(.+)$/);
    if (since) {
        const d = parseDateText(since[4], tz);
        if (d) {
            const days = Math.round((todayUtc(tz) - d.ms) / 86400000);
            if (days >= 0) return t('days_since', lang, fmtDateUtc(d.ms, lang), String(days));
        }
    }

    const shift = s.match(/(?:через|in)\s+(\d{1,4})\s*(день|дні|днів|дня|дней|тиж[a-zа-яіїєґ]*|недел[a-zа-яіїєґ]*|місяц[a-zа-яіїєґ]*|месяц[a-zа-яіїєґ]*|days?|weeks?|months?)/)
        || s.match(/(\d{1,4})\s*(день|дні|днів|дня|дней|тиж[a-zа-яіїєґ]*|недел[a-zа-яіїєґ]*|місяц[a-zа-яіїєґ]*|месяц[a-zа-яіїєґ]*|days?|weeks?|months?)\s*(тому|назад|ago)/);
    if (shift && /(дат|число|date|яка буде|какая будет|what)/.test(s)) {
        const n = parseInt(shift[1], 10);
        const unit = shift[2];
        const past = /(тому|назад|ago)/.test(s);
        const base = new Date(todayUtc(tz));
        const sign = past ? -1 : 1;
        if (/^(тиж|недел|week)/.test(unit)) base.setUTCDate(base.getUTCDate() + sign * 7 * n);
        else if (/^(міс|мес|month)/.test(unit)) base.setUTCMonth(base.getUTCMonth() + sign * n);
        else base.setUTCDate(base.getUTCDate() + sign * n);
        return t(past ? 'date_was' : 'date_is', lang, fmtDateUtc(base.getTime(), lang));
    }

    const asksDate = /(яка\s+(сьогодні\s+)?дата|який\s+(сьогодні\s+)?день|яке\s+(сьогодні\s+)?число|какая\s+(сегодня\s+)?дата|какой\s+(сегодня\s+)?день|какое\s+(сегодня\s+)?число|what\s+(is\s+)?(the\s+)?date|what\s+day|today'?s\s+date)/.test(s);
    if (asksDate) return t('now', lang, new Date().toLocaleString(localeOf(lang), { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).replace(/\.$/, ''));
    return null;
}

// ---------------------------------------------------------------------
// Одиниці виміру
// ---------------------------------------------------------------------
const UNITS = [
    ['len', 0.001, ['мм', 'mm', 'міліметр', 'миллиметр', 'millimeter', 'millimetre']],
    ['len', 0.01, ['см', 'cm', 'сантиметр', 'centimeter', 'centimetre']],
    ['len', 1, ['м', 'm', 'метр', 'meter', 'metre']],
    ['len', 1000, ['км', 'km', 'кілометр', 'километр', 'kilometer', 'kilometre']],
    ['len', 0.0254, ['дюйм', 'inch', 'in']],
    ['len', 0.3048, ['фут', 'ft', 'foot', 'feet']],
    ['len', 0.9144, ['ярд', 'yd', 'yard']],
    ['len', 1609.344, ['миля', 'мілі', 'милі', 'милях', 'миль', 'мили', 'mile', 'miles', 'mi']],
    ['mass', 0.001, ['г', 'гр', 'грам', 'грамм', 'g', 'gram']],
    ['mass', 1, ['кг', 'kg', 'кілограм', 'килограмм', 'kilogram']],
    ['mass', 1000, ['т', 'тонна', 'тонн', 'ton', 'tonne']],
    ['mass', 0.45359237, ['фунт', 'lb', 'lbs', 'pound']],
    ['mass', 0.0283495, ['унція', 'унцій', 'унция', 'унций', 'oz', 'ounce']],
    ['vol', 0.001, ['мл', 'ml', 'мілілітр', 'миллилитр', 'milliliter', 'millilitre']],
    ['vol', 1, ['л', 'l', 'літр', 'литр', 'liter', 'litre']],
    ['vol', 3.785411784, ['галон', 'gallon', 'gal']],
    ['time', 1, ['с', 'сек', 'секунда', 'секунд', 'секунди', 'секунды', 'sec', 'second']],
    ['time', 60, ['хв', 'хвилина', 'хвилин', 'хвилини', 'мин', 'минута', 'минут', 'минуты', 'min', 'minute']],
    ['time', 3600, ['год', 'година', 'годин', 'години', 'час', 'часа', 'часов', 'h', 'hour']],
    ['time', 86400, ['доба', 'діб', 'доби', 'день', 'дні', 'днів', 'дней', 'дня', 'сутки', 'суток', 'day']],
    ['time', 604800, ['тиждень', 'тижні', 'тижнів', 'неделя', 'недели', 'недель', 'week']],
    ['speed', 1, ['м/с', 'mps', 'm/s']],
    ['speed', 0.277777778, ['км/год', 'км/ч', 'kmh', 'km/h', 'kph']],
    ['speed', 0.44704, ['миль/год', 'миль/ч', 'mph']],
    ['data', 1, ['байт', 'байти', 'байтів', 'байта', 'byte', 'bytes', 'b']],
    ['data', 1024, ['кб', 'kb', 'кбайт', 'кілобайт', 'килобайт', 'kilobyte']],
    ['data', 1048576, ['мб', 'mb', 'мбайт', 'мегабайт', 'megabyte']],
    ['data', 1073741824, ['гб', 'gb', 'гбайт', 'гігабайт', 'гигабайт', 'gigabyte']],
    ['data', 1099511627776, ['тб', 'tb', 'тбайт', 'терабайт', 'terabyte']]
];
const TEMPS = {
    c: ['c', '°c', 'цельсій', 'цельсия', 'цельсию', 'цельсіях', 'celsius'],
    f: ['f', '°f', 'фаренгейт', 'фаренгейта', 'фаренгейтах', 'fahrenheit'],
    k: ['k', 'кельвін', 'кельвин', 'кельвіни', 'kelvin']
};

function findUnit(word) {
    const w = word.toLowerCase().replace(/[.,]$/, '');
    return UNITS.find((u) => u[2].includes(w))
        || UNITS.find((u) => u[2].some((a) => a.length >= 5 && w.length >= 5 && w.startsWith(a.slice(0, a.length - 1))))
        || null;
}
function findTemp(word) {
    const w = word.toLowerCase().replace(/[.,]$/, '');
    for (const k of Object.keys(TEMPS)) if (TEMPS[k].includes(w)) return k;
    return null;
}

function skillUnits(text, lang) {
    const s = norm(text).replace(/(градус(ів|а|и)?|degrees?)\s+(цельсія|цельсия|цельсий|celsius|фаренгейта|фаренгейт|fahrenheit)/g, (m0, a, b, c) => (/^ц|^c/.test(c) ? '°c' : '°f'));
    const m = s.match(/(-?\d+(?:[.,]\d+)?)\s*(°?[a-zа-яіїє/]+)\s+(?:в|у|на|to|in|into|=)\s+(°?[a-zа-яіїє/]+)/);
    if (!m) return null;
    const value = parseFloat(m[1].replace(',', '.'));
    const tf = findTemp(m[2]), tt = findTemp(m[3]);
    if (tf && tt) {
        const c = tf === 'c' ? value : (tf === 'f' ? (value - 32) * 5 / 9 : value - 273.15);
        const out = tt === 'c' ? c : (tt === 'f' ? c * 9 / 5 + 32 : c + 273.15);
        const sym = { c: '°C', f: '°F', k: 'K' };
        return t('convert', lang, `${formatNumber(value)} ${sym[tf]}`, `${formatNumber(parseFloat(out.toFixed(4)))} ${sym[tt]}`);
    }
    const uf = findUnit(m[2]), ut = findUnit(m[3]);
    if (uf && ut && uf[0] === ut[0]) {
        const out = value * uf[1] / ut[1];
        return t('convert', lang, `${formatNumber(value)} ${m[2]}`, `${formatNumber(parseFloat(out.toPrecision(10)))} ${m[3]}`);
    }
    return null;
}

// ---------------------------------------------------------------------
// Числа, текст, випадковість
// ---------------------------------------------------------------------
function toRoman(n) {
    if (n < 1 || n > 3999) return null;
    const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    map.forEach(([v, sym]) => { while (n >= v) { out += sym; n -= v; } });
    return out;
}
function fromRoman(str) {
    const v = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    let total = 0;
    for (let i = 0; i < str.length; i++) {
        const cur = v[str[i]], nxt = v[str[i + 1]];
        total += nxt && nxt > cur ? -cur : cur;
    }
    return total > 0 && toRoman(total) === str ? total : null;
}
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; }

const BASES = '(двійков[a-zа-яіїєґ]*|двоичн[a-zа-яіїєґ]*|binary|шістнадцятков[a-zа-яіїєґ]*|шестнадцатерич[a-zа-яіїєґ]*|hex[a-zа-яіїєґ]*|вісімков[a-zа-яіїєґ]*|восьмерич[a-zа-яіїєґ]*|octal)';
function baseOf(word) { return /двійк|двоичн|binary/.test(word) ? 2 : (/шістнадц|шестнадц|hex/.test(word) ? 16 : 8); }

function skillNumbers(text, lang) {
    const s = norm(text).replace(/[?!.]+$/g, '');
    let m = s.match(/^(?:факторіал|факториал|factorial)\s+(?:числа\s+|of\s+)?(\d{1,3})$/) || s.match(/^(\d{1,3})\s*!$/);
    if (m) {
        const n = parseInt(m[1], 10);
        if (n > 170) return null;
        let r = 1n;
        for (let i = 2n; i <= BigInt(n); i++) r *= i;
        const str = r.toString();
        return t('factorial', lang, String(n), str.length > 60 ? str.slice(0, 20) + '… (' + str.length + ')' : str);
    }
    m = s.match(/^(?:чи\s+)?(?:є\s+)?(?:число\s+)?(\d{1,12})\s+(?:просте|простим|простое|простым)(?:\s+число)?$/)
        || s.match(/^(?:чи\s+просте|простое\s+ли|is)\s+(?:число\s+)?(\d{1,12})(?:\s+prime)?(?:\s+число)?$/);
    if (m) {
        const n = parseInt(m[1], 10);
        if (n < 2) return t('prime_no', lang, String(n), '1');
        for (let d = 2; d * d <= n; d++) if (n % d === 0) return t('prime_no', lang, String(n), String(d));
        return t('prime_yes', lang, String(n));
    }
    m = s.match(/^(?:нсд|нод|gcd)\s*(?:чисел\s+|of\s+)?(\d+(?:\s*(?:,|і|и|та|and)?\s*\d+)+)$/);
    if (m) {
        const nums = m[1].split(/[^0-9]+/).filter(Boolean).map(Number).slice(0, 10);
        return t('gcd', lang, nums.join(', '), String(nums.reduce((a, b) => gcd(a, b))));
    }
    m = s.match(/^(?:нск|нок|lcm)\s*(?:чисел\s+|of\s+)?(\d+(?:\s*(?:,|і|и|та|and)?\s*\d+)+)$/);
    if (m) {
        const nums = m[1].split(/[^0-9]+/).filter(Boolean).map(Number).slice(0, 10);
        return t('lcm', lang, nums.join(', '), String(nums.reduce((a, b) => (a / gcd(a, b)) * b)));
    }
    m = s.match(/^(?:число\s+)?(?:фібоначчі|фибоначчи|fibonacci)\s*(?:номер|№|#|number)?\s*(\d{1,4})$/);
    if (m) {
        const n = parseInt(m[1], 10);
        if (n > 1000) return null;
        let a = 0n, b = 1n;
        for (let i = 0; i < n; i++) { [a, b] = [b, a + b]; }
        const str = a.toString();
        return t('fib', lang, String(n), str.length > 60 ? str.slice(0, 20) + '…' : str);
    }
    m = s.match(/^(\d{1,4})\s+(?:в|у|to|in)\s+(?:римськ[a-zа-яіїєґ]*|римск[a-zа-яіїєґ]*|roman)(?:\s+цифр[a-zа-яіїєґ]*|\s+numerals?)?$/)
        || s.match(/^(?:римськ[a-zа-яіїєґ]*|римск[a-zа-яіїєґ]*|roman)\s+(?:цифр[a-zа-яіїєґ]*\s+|numerals?\s+)?(?:числа\s+|для\s+|of\s+|for\s+)?(\d{1,4})$/);
    if (m) {
        const n = parseInt(m[1], 10);
        const r = toRoman(n);
        if (r) return t('roman', lang, String(n), r);
    }
    m = String(text).trim().match(/^(?:з римських|из римских|from roman)\s+([IVXLCDMivxlcdm]+)$/);
    if (m) {
        const r = m[1].toUpperCase();
        const n = fromRoman(r);
        if (n) return t('convert', lang, r, String(n));
    }
    m = s.match(new RegExp('^(\\d{1,15})\\s+(?:в|у|to|in)\\s+' + BASES + '(?:\\s+(?:систему|систему счисления|system))?$'));
    if (m) {
        const n = parseInt(m[1], 10);
        const base = baseOf(m[2]);
        return t('convert', lang, `${n}`, `${n.toString(base).toUpperCase()} (${base})`);
    }
    m = s.match(new RegExp('^([0-9a-f]{1,15})\\s+(?:з|із|из|from)\\s+' + BASES + '(?:\\s+(?:системи|системы|system))?\\s+(?:в|у|to|in)\\s+(?:десятков[a-zа-яіїєґ]*|десятичн[a-zа-яіїєґ]*|decimal)$'));
    if (m) {
        const base = baseOf(m[2]);
        const n = parseInt(m[1], base);
        if (!isNaN(n)) return t('convert', lang, `${m[1]} (${base})`, String(n));
    }
    return null;
}

function skillText(text, lang) {
    const raw = String(text || '').trim();
    let m = raw.match(/^(?:скільки|сколько|how many)\s+(?:символів|символов|літер|букв|слів|слов|characters|letters|words)\s+(?:у|в|in)\s*(?:тексті|тексте|text)?\s*[:：]\s*([\s\S]+)$/i)
        || raw.match(/^(?:порахуй|посчитай|count)\s+(?:символи|символы|слова|слів|слов|characters|words)(?:\s+(?:у|в|in)\s*(?:тексті|тексте|text)?)?\s*[:：]\s*([\s\S]+)$/i);
    if (m) {
        const body = m[1].trim();
        const words = body.split(/\s+/).filter(Boolean).length;
        return t('count_chars', lang, String(body.length), String(body.replace(/\s/g, '').length), String(words));
    }
    m = raw.match(/^(?:переверни|розверни|разверни|reverse)(?:\s+(?:текст|text))?\s*[:：]\s*([\s\S]+)$/i);
    if (m) return Array.from(m[1].trim()).reverse().join('');
    m = raw.match(/^(?:великими літерами|большими буквами|uppercase|upper case)\s*[:：]\s*([\s\S]+)$/i);
    if (m) return m[1].trim().toUpperCase();
    m = raw.match(/^(?:маленькими літерами|малими літерами|маленькими буквами|lowercase|lower case)\s*[:：]\s*([\s\S]+)$/i);
    if (m) return m[1].trim().toLowerCase();
    return null;
}

function skillRandom(text, lang) {
    const s = norm(text);
    if (/(підкинь|подкинь|кинь|кидай|flip)\s*(мою\s+)?(монет|coin)/.test(s) || /орел\s+чи\s+решка|орел\s+или\s+решка|heads\s+or\s+tails/.test(s)) {
        return crypto.randomInt(0, 2) === 0 ? t('coin_heads', lang) : t('coin_tails', lang);
    }
    if (/(кинь|кидай|підкинь|брось|подкинь|roll)\s*(гральн[а-яіїєґ]*\s+)?(кубик|кость|dice|die)/.test(s)) return t('dice', lang, String(crypto.randomInt(1, 7)));
    const range = s.match(/(випадков[а-яіїєґ]+|случайн[а-яіїєґ]+|random)\s+(число|number)?\s*(від|от|from|between)?\s*(-?\d+)\s*(до|до числа|по|to|and|-)\s*(-?\d+)/);
    if (range) {
        let a = parseInt(range[4], 10), b = parseInt(range[6], 10);
        if (a > b) { const tmp = a; a = b; b = tmp; }
        if (b - a < 1e9) return t('random', lang, String(crypto.randomInt(a, b + 1)));
    }
    const pw = s.match(/^(?:згенеруй|створи|придумай|сгенерируй|создай|generate|create|make)\s+(?:мені\s+|мне\s+|me\s+)?(?:надійний\s+|надежный\s+|strong\s+|a\s+)?(?:пароль|password)(?:\s+(?:довжиною|довжини|длиной|длины|length|of)?\s*(\d{1,2}))?/);
    if (pw) {
        const len = clampInt(pw[1] ? parseInt(pw[1], 10) : 14, 8, 64);
        const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*?';
        let out = '';
        for (let i = 0; i < len; i++) out += chars[crypto.randomInt(0, chars.length)];
        return t('password', lang, out);
    }
    const choose = String(text).match(/^(?:вибери|обери|выбери|choose|pick)\s*(?:між|между|between|з|из|from|:)?\s*(.+)$/i);
    if (choose) {
        const options = choose[1].split(/\s*(?:,|;|\sабо\s|\sили\s|\sor\s|\sчи\s)\s*/i).map((x) => x.trim()).filter(Boolean);
        if (options.length >= 2) return t('chosen', lang, options[crypto.randomInt(0, options.length)]);
    }
    return null;
}

// ---------------------------------------------------------------------
// Знання: столиці, глосарій, жарти, факти, поради
// ---------------------------------------------------------------------
function escapeRe(x) { return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function skillCountry(text, lang) {
    const s = norm(text);
    if (!/(столиц|capital)/.test(s)) return null;
    let best = null;
    KB.COUNTRIES.forEach((c) => {
        c[0].split('|').forEach((n) => {
            const base = /[а-яіїєґ]/.test(n) && n.length >= 6 ? n.slice(0, -1) : n;
            const re = new RegExp('(^|[^a-zа-яіїєґ])' + escapeRe(base) + '([а-яіїєґa-z]{0,4})?([^a-zа-яіїєґ]|$)');
            if (re.test(s) && (!best || n.length > best.n.length)) best = { c, n };
        });
    });
    if (!best) return null;
    const i = langIndex(lang);
    return t('capital', lang, best.c[4 + i], best.c[1 + i]);
}

function pickVariant(list, level) {
    if (!list || list.length === 0) return '';
    if (level === 'low') return list[0];
    if (level === 'mid') return list[crypto.randomInt(0, Math.min(2, list.length))];
    return list[crypto.randomInt(0, list.length)];
}

function skillFun(text, lang) {
    const s = norm(text).replace(/[?!.]+$/g, '');
    const pickRandom = (list) => list[crypto.randomInt(0, list.length)];
    if (/^(розкажи |розкажіть |скажи |давай )?(жарт|анекдот|смішне)( ще)?$|^(расскажи |давай )?(шутку|анекдот|шутка)( еще)?$|^(tell me |tell )?(a )?joke( again)?$|^ще жарт$|^еще шутку$|^another joke$/.test(s)) {
        return pickRandom(KB.JOKES[lang] || KB.JOKES.uk);
    }
    if (/^(розкажи |скажи |давай )?(цікавий факт|факт|щось цікаве)( ще)?$|^(расскажи |скажи |давай )?(интересный факт|факт|что-нибудь интересное)( еще)?$|^(tell me |tell )?(an? )?(interesting |fun )?fact( again)?$|^ще факт$|^еще факт$/.test(s)) {
        return pickRandom(KB.FACTS[lang] || KB.FACTS.uk);
    }
    if (/^(дай |скажи |порадь )?(пораду|порада|мотивацію|мотивація|мотивуй мене)$|^(дай |скажи )?(совет|мотивацию|мотивируй меня)$|^(give me |tell me )?(a )?(tip|advice|motivation)$/.test(s)) {
        return pickRandom(KB.TIPS[lang] || KB.TIPS.uk);
    }
    return null;
}

function skillSmallTalk(text, lang, level) {
    const s = norm(text).replace(/[?!.,]+$/g, '');
    for (const rule of KB.SMALLTALK) {
        if (rule.re.test(s)) return pickVariant(rule.a[lang] || rule.a.uk, level);
    }
    return null;
}

// Пошук по глосарію: збіг основ слів, вага — рідкісність слова в базі
const IDF = (() => {
    const df = new Map();
    KB.GLOSSARY.forEach((e) => new Set(e.k.map((k) => stem(norm(k).replace(/\s+/g, '')))).forEach((k) => df.set(k, (df.get(k) || 0) + 1)));
    return df;
})();

function glossarySearch(text, lang) {
    const qTokens = tokens(text).filter((w) => !STOP.has(w));
    if (qTokens.length === 0) return [];
    const joined = norm(text);
    const qStems = new Set(qTokens.map(stem));
    return KB.GLOSSARY.map((e) => {
        let score = 0;
        e.k.forEach((k) => {
            const kn = norm(k);
            const compact = stem(kn.replace(/\s+/g, ''));
            if (kn.includes(' ') || kn.includes('-')) {
                if (joined.includes(kn.trim())) score += 2.5;
            } else if (qStems.has(compact) || qTokens.some((w) => w === kn)) {
                score += 1.5 + 1 / (IDF.get(compact) || 1);
            }
        });
        return { text: e.a[lang] || e.a.uk, score };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
}

function skillKnowledge(text, lang, settings) {
    const s = norm(text);
    const isQuestion = /(\?|^(що|хто|як|чому|де|коли|скільки|яка|який|яке|які|навіщо|розкажи|поясни|что|кто|как|почему|где|когда|сколько|какая|какой|какое|какие|зачем|расскажи|объясни|what|who|how|why|where|when|which|explain|tell me|define))/.test(s);
    const results = glossarySearch(text, lang);
    if (results.length === 0) return null;
    const best = results[0];
    const wordCount = tokens(text).length;
    if (!(best.score >= 2.4 || (isQuestion && best.score >= 1.5) || (wordCount <= 3 && best.score >= 1.5))) return null;
    let answer = best.text;
    if (settings.style === 'short') {
        const first = answer.split(/(?<=[.!?])\s+/)[0];
        if (first) answer = first;
    }
    if (settings.style === 'detailed' && results[1] && results[1].score >= 1.5 && results[1].text !== best.text) {
        answer += '\n\n' + t('related', lang) + ' ' + results[1].text;
    }
    return answer;
}

// ---------------------------------------------------------------------
// Навчання, памʼять фактів, списки
// ---------------------------------------------------------------------
const TEACH_RE = [
    /^(?:навчу тебе|навчи тебе|вивчи|запам['’ʼ]?ятай відповідь|научу тебя|выучи|запомни ответ|teach you|learn this|learn)\s*[:\-]?\s*([\s\S]+?)\s*(?:=>|->|=|—|–)\s*([\s\S]+)$/i,
    /^(?:коли я (?:напишу|спитаю|скажу)|когда я (?:напишу|спрошу|скажу)|when i (?:write|ask|say))\s*[:«"“]?\s*([\s\S]+?)[»"”]?\s*[,:\-–—]\s*(?:відповідай|відповісти|ответь|отвечай|answer|reply)\s*[:«"“]?\s*([\s\S]+?)[»"”]?$/i
];

function parseTeach(text) {
    for (const re of TEACH_RE) {
        const m = String(text || '').trim().match(re);
        if (m) {
            const pattern = m[1].trim().replace(/^[«"“]|[»"”]$/g, '').slice(0, 120);
            const answer = m[2].trim().replace(/^[«"“]|[»"”]$/g, '').slice(0, 400);
            if (pattern.length >= 2 && answer.length >= 1) return { pattern, answer };
        }
    }
    return null;
}

function matchRule(rules, text) {
    const n = norm(text).replace(/[?!.,]+$/g, '');
    const qs = stemSet(text);
    let best = null;
    rules.forEach((r) => {
        const rn = norm(r.pattern).replace(/[?!.,]+$/g, '');
        if (rn === n) { best = { r, score: 2 }; return; }
        if (best && best.score >= 2) return;
        const score = jaccard(qs, stemSet(r.pattern));
        if (score >= 0.8 && qs.size >= 2 && (!best || score > best.score)) best = { r, score };
    });
    return best ? best.r : null;
}

async function skillLearning(store, email, text, lang, settings) {
    const raw = String(text || '').trim();
    const s = norm(raw).replace(/[?!.]+$/g, '');

    if (/^(забудь все чому я тебе навчив(ла)?|забудь правила|очисти правила|забудь все чему я тебя учил(а)?|forget (the )?rules|forget what i taught you)$/.test(s)) {
        await store.clearRules(email);
        return t('rules_cleared', lang);
    }
    if (/^(чого я тебе навчив(ла)?|які правила|мої правила|чему я тебя учил(а)?|какие правила|мои правила|what did i teach you|my rules)$/.test(s)) {
        const rules = await store.listRules(email);
        if (rules.length === 0) return t('rules_none', lang);
        return t('rules_head', lang) + '\n' + rules.map((r, i) => `${i + 1}. ${r.pattern} → ${r.answer}`).join('\n');
    }

    const teach = parseTeach(raw);
    if (teach) {
        if (!settings.memory) return t('memory_off', lang);
        await store.addRule(email, teach.pattern, teach.answer);
        return t('taught', lang, teach.pattern, teach.answer);
    }

    const rules = await store.listRules(email);
    if (rules.length) {
        const hit = matchRule(rules, raw);
        if (hit) return hit.answer;
    }
    return null;
}

async function skillMemory(store, email, text, lang, settings) {
    const raw = String(text || '').trim();
    const s = raw.toLowerCase().replace(/[?!.]+$/g, '').trim();

    if (/^(забудь все|забудь усе|забудь всё|забудь все про мене|забудь все обо мне|очисти памʼять фактів|forget everything|forget all)/.test(s)) {
        await store.clearFacts(email);
        return t('facts_cleared', lang);
    }
    if (/^(що ти (про мене )?знаєш|що ти памʼятаєш|що ти пам'ятаєш про мене|что ты (обо мне )?знаешь|что ты помнишь обо мне|what do you (know|remember) about me|мої факти)/.test(s)) {
        const facts = await store.listFacts(email);
        if (facts.length === 0) return t('facts_none', lang);
        return t('facts_head', lang) + '\n' + facts.map((f, i) => `${i + 1}. ${f.fact}`).join('\n');
    }
    if (/^(як мене звати|как меня зовут|what'?s my name|what is my name)$/.test(s)) {
        const facts = await store.listFacts(email);
        const nameFact = facts.find((f) => /^(імʼя|імя|имя|name):/i.test(f.fact));
        if (!nameFact) return t('no_name', lang);
        return t('your_name', lang, nameFact.fact.replace(/^[^:]+:\s*/, ''));
    }
    const nameMatch = raw.match(/^(?:мене звати|мене кличуть|меня зовут|my name is|call me)\s+([A-Za-zА-Яа-яІіЇїЄєҐґЁё'ʼ-]{2,30})/i);
    if (nameMatch) {
        if (!settings.memory) return t('memory_off', lang);
        const name = nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1);
        await store.setName(email, (lang === 'en' ? 'Name: ' : (lang === 'ru' ? 'Имя: ' : 'Імʼя: ')) + name);
        return t('name_remembered', lang, name);
    }
    const rem = raw.match(/^(?:запам['’ʼ]?ятай|запомни|remember)(?:\s*,)?\s*(?:що|что|that)?\s*[:\-]?\s*(.{2,240})$/i);
    if (rem && !parseTeach(raw)) {
        if (!settings.memory) return t('memory_off', lang);
        await store.addFact(email, rem[1]);
        return t('remembered', lang) + rem[1].trim();
    }
    return null;
}

async function skillLists(store, email, text, lang) {
    const raw = String(text || '').trim().replace(/[.!]+$/g, '');
    const s = norm(raw);
    const LIST = '(?:мого\\s+|мій\\s+|моего\\s+|мой\\s+|my\\s+)?(?:списку|список|списка|list)(?:\\s+покупок|\\s+покупки)?';
    let m = raw.match(new RegExp('^(?:додай|додати|добавь|добавить|запиши|add)\\s+([\\s\\S]+?)\\s+(?:до|в|у|на|to|in|into)\\s+' + LIST + '$', 'i'))
        || raw.match(/^(?:нотатка|заметка|note)\s*[:：]\s*([\s\S]+)$/i);
    if (m) {
        const item = m[1].trim().slice(0, 200);
        const count = await store.addNote(email, item);
        return t('note_added', lang, item, String(count));
    }
    if (new RegExp('^(?:покажи|показати|покажіть|покажите|покажи мені|show|що в|что в|what\'?s in)\\s*' + LIST + '$', 'i').test(raw) || /^(мій список|мой список|my list|список|мої нотатки|мои заметки)$/.test(s)) {
        const notes = await store.listNotes(email);
        if (notes.length === 0) return t('list_empty', lang);
        return t('list_head', lang) + '\n' + notes.map((n, i) => `${i + 1}. ${n.item}`).join('\n');
    }
    m = raw.match(new RegExp('^(?:видали|видалити|удали|удалить|прибери|remove|delete)\\s+([\\s\\S]+?)\\s+(?:зі|із|з|из|с|from)\\s+' + LIST + '$', 'i'));
    if (m) {
        const notes = await store.listNotes(email);
        const needle = m[1].trim().toLowerCase();
        const byNumber = /^\d{1,3}$/.test(needle) ? notes[parseInt(needle, 10) - 1] : null;
        const hit = byNumber || notes.find((n) => n.item.toLowerCase() === needle) || notes.find((n) => n.item.toLowerCase().includes(needle));
        if (!hit) return t('note_missing', lang);
        await store.removeNote(email, hit.id);
        return t('note_removed', lang, hit.item);
    }
    if (new RegExp('^(?:очисти|очистити|очисть|очистить|clear)\\s*' + LIST + '$', 'i').test(raw)) {
        await store.clearNotes(email);
        return t('list_cleared', lang);
    }
    return null;
}

// ---------------------------------------------------------------------
// Головний конвеєр відповіді Kishka-1
// ---------------------------------------------------------------------
const IMAGE_INTENT = new RegExp(
    '(намал[юі]|нарису[йй]|згенеру[йї]\\s+(зображенн|картинк|малюн|фото)|сгенери[рр]у[йй]\\s+(изображени|картинк|рисун|фото)|створи[^.!?\\n]{0,20}(зображенн|картинк|малюн|ілюстрац|постер|обої)|' +
    'создай[^.!?\\n]{0,20}(изображени|картинк|рисун|иллюстрац|постер|обои)|зроби[^.!?\\n]{0,20}(зображенн|картинк|малюн|ілюстрац|постер)|сделай[^.!?\\n]{0,20}(изображени|картинк|рисун|иллюстрац|постер)|' +
    '\\bdraw\\b|\\bpaint\\b|(generate|create|make)[^.!?\\n]{0,25}(image|picture|drawing|illustration|wallpaper|poster))', 'i');

async function answer(store, email, text, lang, settings, ctx) {
    const state = await store.getState(email);
    const level = settings.creativity;

    const learned = await skillLearning(store, email, text, lang, settings);
    if (learned) return { text: learned, skill: 'learning' };

    const mem = await skillMemory(store, email, text, lang, settings);
    if (mem) return { text: mem, skill: 'memory' };

    const lists = await skillLists(store, email, text, lang);
    if (lists) return { text: lists, skill: 'lists' };

    const fun = skillFun(text, lang);
    if (fun) return { text: fun, skill: 'fun' };

    const time = skillTime(text, lang, ctx);
    if (time) return { text: time, skill: 'time' };

    const rnd = skillRandom(text, lang);
    if (rnd) return { text: rnd, skill: 'random' };

    const txt = skillText(text, lang);
    if (txt) return { text: txt, skill: 'text' };

    const num = skillNumbers(text, lang);
    if (num) return { text: num, skill: 'numbers' };

    const units = skillUnits(text, lang);
    if (units) return { text: units, skill: 'units' };

    const calcState = { lastResult: state.lastResult };
    const math = skillMath(text, lang, calcState) || skillMathFollowUp(text, lang, calcState);
    if (math) {
        if (calcState.lastResult !== state.lastResult) await store.setState(email, { lastResult: calcState.lastResult });
        return { text: math, skill: 'math' };
    }

    const country = skillCountry(text, lang);
    if (country) return { text: country, skill: 'knowledge' };

    const talk = skillSmallTalk(text, lang, level);
    if (talk) return { text: talk, skill: 'talk' };

    const kb = skillKnowledge(text, lang, settings);
    if (kb) return { text: kb, skill: 'knowledge' };

    if (IMAGE_INTENT.test(String(text || ''))) return { text: t('draw_hint', lang), skill: 'hint' };

    return { text: t('unknown', lang), skill: 'unknown' };
}

// Стиль відповіді (налаштування «Стиль»)
function applyStyle(result, lang, settings) {
    let out = result.text;
    if (settings.style === 'friendly' && ['knowledge', 'fun'].includes(result.skill)) {
        const warm = { uk: ['Звісно! ', 'З радістю! ', 'Із задоволенням! '], ru: ['Конечно! ', 'С радостью! ', 'С удовольствием! '], en: ['Sure! ', 'Happy to help! ', 'Gladly! '] };
        out = pickVariant(warm[lang] || warm.uk, settings.creativity) + out;
    }
    return out;
}

// ---------------------------------------------------------------------
// Сховище (база даних)
// ---------------------------------------------------------------------
function makeDbStore(dbRun, dbAll) {
    const newId = (p) => p + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
    return {
        async listFacts(email) { return dbAll('SELECT id, fact FROM kai_facts WHERE email = ? ORDER BY timestamp ASC', [email]); },
        async addFact(email, fact) {
            const clean = String(fact || '').trim().replace(/\s+/g, ' ').slice(0, 240);
            if (clean.length < 2) return false;
            const existing = await this.listFacts(email);
            if (existing.some((f) => String(f.fact).toLowerCase() === clean.toLowerCase())) return true;
            if (existing.length >= FACT_LIMIT) await dbRun('DELETE FROM kai_facts WHERE id = ?', [existing[0].id]);
            await dbRun('INSERT INTO kai_facts (id, email, fact, timestamp) VALUES (?, ?, ?, ?)', [newId('f_'), email, clean, Date.now()]);
            return true;
        },
        async setName(email, fact) {
            await dbRun("DELETE FROM kai_facts WHERE email = ? AND (fact LIKE 'Імʼя:%' OR fact LIKE 'Имя:%' OR fact LIKE 'Name:%')", [email]);
            await this.addFact(email, fact);
        },
        async clearFacts(email) { await dbRun('DELETE FROM kai_facts WHERE email = ?', [email]); },

        async listRules(email) { return dbAll('SELECT id, pattern, answer FROM kai_rules WHERE email = ? ORDER BY timestamp ASC', [email]); },
        async addRule(email, pattern, ans) {
            const rules = await this.listRules(email);
            const same = rules.find((r) => norm(r.pattern) === norm(pattern));
            if (same) await dbRun('DELETE FROM kai_rules WHERE id = ?', [same.id]);
            else if (rules.length >= RULE_LIMIT) await dbRun('DELETE FROM kai_rules WHERE id = ?', [rules[0].id]);
            await dbRun('INSERT INTO kai_rules (id, email, pattern, answer, timestamp) VALUES (?, ?, ?, ?, ?)', [newId('r_'), email, pattern, ans, Date.now()]);
        },
        async clearRules(email) { await dbRun('DELETE FROM kai_rules WHERE email = ?', [email]); },

        async listNotes(email) { return dbAll('SELECT id, item FROM kai_notes WHERE email = ? ORDER BY timestamp ASC', [email]); },
        async addNote(email, item) {
            const notes = await this.listNotes(email);
            if (notes.length >= NOTE_LIMIT) await dbRun('DELETE FROM kai_notes WHERE id = ?', [notes[0].id]);
            await dbRun('INSERT INTO kai_notes (id, email, item, timestamp) VALUES (?, ?, ?, ?)', [newId('n_'), email, item, Date.now()]);
            return Math.min(notes.length + 1, NOTE_LIMIT);
        },
        async removeNote(email, noteId) { await dbRun('DELETE FROM kai_notes WHERE id = ? AND email = ?', [noteId, email]); },
        async clearNotes(email) { await dbRun('DELETE FROM kai_notes WHERE email = ?', [email]); },

        async getState(email) {
            const rows = await dbAll('SELECT last_result FROM kai_state WHERE email = ?', [email]);
            const v = rows[0] && rows[0].last_result !== null && rows[0].last_result !== undefined ? parseFloat(rows[0].last_result) : undefined;
            return { lastResult: v !== undefined && isFinite(v) ? v : undefined };
        },
        async setState(email, patch) {
            if (patch.lastResult !== undefined) {
                await dbRun('INSERT INTO kai_state (email, last_result, updated) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET last_result = excluded.last_result, updated = excluded.updated',
                    [email, String(patch.lastResult), Date.now()]);
            }
        }
    };
}

// Сховище в памʼяті — лише для перевірок без бази
function makeMemoryStore() {
    const d = { facts: new Map(), rules: new Map(), notes: new Map(), state: new Map() };
    const arr = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };
    let n = 0;
    return {
        async listFacts(e) { return arr(d.facts, e).slice(); },
        async addFact(e, f) { arr(d.facts, e).push({ id: ++n, fact: f }); return true; },
        async setName(e, f) { d.facts.set(e, arr(d.facts, e).filter((x) => !/^(імʼя|имя|name):/i.test(x.fact))); await this.addFact(e, f); },
        async clearFacts(e) { d.facts.set(e, []); },
        async listRules(e) { return arr(d.rules, e).slice(); },
        async addRule(e, p, a) { const l = arr(d.rules, e).filter((r) => norm(r.pattern) !== norm(p)); l.push({ id: ++n, pattern: p, answer: a }); d.rules.set(e, l); },
        async clearRules(e) { d.rules.set(e, []); },
        async listNotes(e) { return arr(d.notes, e).slice(); },
        async addNote(e, i) { arr(d.notes, e).push({ id: ++n, item: i }); return arr(d.notes, e).length; },
        async removeNote(e, id) { d.notes.set(e, arr(d.notes, e).filter((x) => x.id !== id)); },
        async clearNotes(e) { d.notes.set(e, []); },
        async getState(e) { return Object.assign({}, d.state.get(e) || {}); },
        async setState(e, p) { d.state.set(e, Object.assign(d.state.get(e) || {}, p)); }
    };
}

// ---------------------------------------------------------------------
// Підключення до сервера
// ---------------------------------------------------------------------
function initKishkaAI(ctx) {
    const { io, db, dbRun, dbAll, cleanEmail, langOf, makeJob, cancelJob, checkCancelled, tz } = ctx;
    const generalAnswer = typeof ctx.generalAnswer === 'function' ? ctx.generalAnswer : null;
    const generalImage = typeof ctx.generalImage === 'function' ? ctx.generalImage : null;

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
        db.run(`CREATE TABLE IF NOT EXISTS kai_rules (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            pattern TEXT NOT NULL,
            answer TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        )`);
        db.run('CREATE INDEX IF NOT EXISTS idx_kai_rules_email ON kai_rules (email, timestamp)', () => {});
        db.run(`CREATE TABLE IF NOT EXISTS kai_notes (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            item TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        )`);
        db.run('CREATE INDEX IF NOT EXISTS idx_kai_notes_email ON kai_notes (email, timestamp)', () => {});
        db.run(`CREATE TABLE IF NOT EXISTS kai_state (
            email TEXT PRIMARY KEY,
            last_result TEXT,
            updated INTEGER NOT NULL
        )`);
    });

    const store = makeDbStore(dbRun, dbAll);
    const jobs = new Map(); // email -> job

    io.on('connection', (socket) => {

        socket.on('kai_get_models', (arg1, arg2) => {
            const cb = typeof arg1 === 'function' ? arg1 : (typeof arg2 === 'function' ? arg2 : () => {});
            cb({ success: true, defaultModel: 'kishka-1', models: MODELS.filter((m) => m.type !== 'image' || imageEngine) });
        });

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
                const facts = await store.listFacts(clean);
                const rules = await store.listRules(clean);
                cb({ success: true, facts: facts.map((f) => f.fact), rules: rules.length });
            } catch (err) {
                cb({ success: false, facts: [] });
            }
        });

        // Забути факти про користувача і все, чого він навчив Kishka-1
        socket.on('kai_clear_facts', async (email, callback) => {
            const cb = typeof callback === 'function' ? callback : () => {};
            const clean = cleanEmail(email);
            if (!clean) return cb({ success: false });
            try {
                await store.clearFacts(clean);
                await store.clearRules(clean);
                cb({ success: true });
            } catch (err) {
                cb({ success: false });
            }
        });

        socket.on('kai_send', async (data, callback) => {
            const ackCb = typeof callback === 'function' ? callback : () => {};
            const { email, text, model, mode, lang: rawLang, settings: rawSettings } = data || {};
            const uiLang = langOf(rawLang);
            const clean = cleanEmail(email);
            const cleanText = (typeof text === 'string' ? text : '').trim();
            const settings = cleanSettings(rawSettings);

            if (!clean || !cleanText) return ackCb({ success: false, error: t('empty', uiLang) });
            if (cleanText.length > MAX_TEXT) return ackCb({ success: false, error: t('too_long', uiLang) });
            if (jobs.has(clean)) return ackCb({ success: false, error: t('busy', uiLang) });

            // Яка модель: kishka-image малює, kishka-1 відповідає текстом. Старі версії застосунку передають mode = "image".
            // Якщо підключено загальний бекенд, Кішка малює і тоді, коли її просять намалювати текстом (модель kishka-1)
            const drawing = model === 'kishka-image' || (!model && mode === 'image')
                || (!!generalImage && IMAGE_INTENT.test(cleanText));
            if (drawing && !imageEngine && !generalImage) return ackCb({ success: false, error: t('image_off', uiLang) });

            socket.join(clean);
            const job = makeJob();
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
                    await new Promise((resolve) => setImmediate(resolve));
                    checkCancelled(job);
                    let img = null;
                    if (generalImage) {
                        // Будь-яке зображення за описом
                        try {
                            img = await generalImage(cleanText, job);
                        } catch (e) {
                            if (e && e.message === 'CANCELLED') throw e;
                            console.error('Kishka AI: загальна генерація зображень не вдалася:', e && e.message);
                        }
                    }
                    checkCancelled(job);
                    // Запасний варіант — власний малювальник Kishka-image
                    if (!img && imageEngine) img = imageEngine.render(cleanText, { style: settings.imageStyle, size: settings.imageSize });
                    if (!img) throw new Error('NO_IMAGE');
                    checkCancelled(job);
                    const imageId = crypto.randomBytes(16).toString('hex');
                    await dbRun('INSERT INTO gemini_images (id, email, mime, data, timestamp) VALUES (?, ?, ?, ?, ?)',
                        [imageId, clean, img.mime, img.data, Date.now()]);
                    reply = { text: '', model: 'kishka-image', imageId };
                } else {
                    const result = await answer(store, clean, cleanText, lang, settings, { tz });
                    checkCancelled(job);
                    let replyText = null;
                    // Власний рушій не знає відповіді — питання йде в загальний бекенд (відповідь від імені Кішки ШІ)
                    if (generalAnswer && (result.skill === 'unknown' || result.skill === 'hint')) {
                        try {
                            const rows = await dbAll(
                                `SELECT role, text FROM (
                                    SELECT role, text, timestamp FROM kai_messages
                                    WHERE email = ? AND text <> '' ORDER BY timestamp DESC LIMIT 14
                                 ) AS recent ORDER BY timestamp ASC`,
                                [clean]
                            );
                            replyText = await generalAnswer({ question: cleanText, lang, history: rows, job });
                        } catch (e) {
                            if (e && e.message === 'CANCELLED') throw e;
                            console.error('Kishka AI: загальна відповідь не вдалася:', e && e.message);
                        }
                    }
                    checkCancelled(job);
                    reply = { text: replyText ? replyText : applyStyle(result, lang, settings), model: 'kishka-1', imageId: null };
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
                if (cancelled) ackCb({ success: false, cancelled: true, error: t('stopped', uiLang) });
                else finish({ success: false, cancelled: false, error: t(drawing ? 'image_failed' : 'error', uiLang) });
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

    return { answer, store };
}

module.exports = initKishkaAI;
// Для перевірок без сервера
module.exports.__test = { answer, makeMemoryStore, cleanSettings, evalMath, detectLang, cleanSettingsDefault: cleanSettings({}) };
