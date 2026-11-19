// KishkaBlox — сторінка входу (index.html): нік і пароль акаунта KishkaBlox -> кнопка «Грати» відкриває game.html.
// Пароль нікуди не зберігається: сервер після перевірки видає тимчасовий токен, він лежить у sessionStorage цієї вкладки.
(function () {
    'use strict';
    var CFG = window.KISHKA_WEB || {};
    var SERVER = String(CFG.server || '').replace(/\/+$/, '');
    var SESSION_KEY = 'kishkablox.web.session';
    var LANG_KEY = 'kishkablox.web.lang';
    var GAME_PAGE = 'game.html';

    var TX = {
        uk: {
            login: 'Вхід у KishkaBlox', sub: 'Введіть нік і пароль свого акаунта KishkaBlox. Акаунт створюється в застосунку Kishka, вкладка KishkaBlox.',
            nick: 'Нікнейм', pass: 'Пароль', show: 'Показати пароль', enter: 'Увійти', logout: 'Вийти з акаунта', play: 'Грати', hello: 'Привіт',
            connecting: 'З’єднуємося з сервером…', waking: 'Сервер прокидається, це може тривати до хвилини…', ready: 'Сервер на зв’язку.',
            e_empty: 'Введіть нік і пароль.', e_wrong: 'Невірний нік або пароль.', e_many: 'Забагато невдалих спроб. Зачекайте кілька хвилин.',
            e_bound: 'Цей акаунт ще не відкривали в застосунку Kishka. Увійдіть у нього там один раз (вкладка KishkaBlox).',
            e_server: 'Помилка сервера. Спробуйте ще раз.', e_timeout: 'Сервер не відповів. Спробуйте ще раз.', e_lib: 'Не завантажилась бібліотека зв’язку. Перевірте інтернет і оновіть сторінку.',
            help: '<b>Керування на комп’ютері</b><br><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> або стрілки — рух і кермо · <kbd>Пробіл</kbd> — стрибок / ручник · <kbd>P</kbd> — дріфт (натисніть P і одразу поверніть кермо) · <kbd>R</kbd> — перевернути машину · <kbd>Esc</kbd> — меню · перетягування мишею — камера, колесо миші — масштаб.<br>На телефоні керування екранними кнопками (краще в горизонтальному положенні).'
        },
        ru: {
            login: 'Вход в KishkaBlox', sub: 'Введите ник и пароль своего аккаунта KishkaBlox. Аккаунт создаётся в приложении Kishka, вкладка KishkaBlox.',
            nick: 'Никнейм', pass: 'Пароль', show: 'Показать пароль', enter: 'Войти', logout: 'Выйти из аккаунта', play: 'Играть', hello: 'Привет',
            connecting: 'Соединяемся с сервером…', waking: 'Сервер просыпается, это может занять до минуты…', ready: 'Сервер на связи.',
            e_empty: 'Введите ник и пароль.', e_wrong: 'Неверный ник или пароль.', e_many: 'Слишком много неудачных попыток. Подождите несколько минут.',
            e_bound: 'Этот аккаунт ещё не открывали в приложении Kishka. Войдите в него там один раз (вкладка KishkaBlox).',
            e_server: 'Ошибка сервера. Попробуйте ещё раз.', e_timeout: 'Сервер не ответил. Попробуйте ещё раз.', e_lib: 'Не загрузилась библиотека связи. Проверьте интернет и обновите страницу.',
            help: '<b>Управление на компьютере</b><br><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> или стрелки — движение и руль · <kbd>Пробел</kbd> — прыжок / ручник · <kbd>P</kbd> — дрифт (нажмите P и сразу поверните руль) · <kbd>R</kbd> — перевернуть машину · <kbd>Esc</kbd> — меню · перетаскивание мышью — камера, колесо мыши — масштаб.<br>На телефоне управление экранными кнопками (лучше в горизонтальном положении).'
        },
        en: {
            login: 'Sign in to KishkaBlox', sub: 'Enter the nickname and password of your KishkaBlox account. The account is created in the Kishka app, KishkaBlox tab.',
            nick: 'Nickname', pass: 'Password', show: 'Show password', enter: 'Sign in', logout: 'Sign out', play: 'Play', hello: 'Hello',
            connecting: 'Connecting to the server…', waking: 'The server is waking up, this can take up to a minute…', ready: 'Server is online.',
            e_empty: 'Enter your nickname and password.', e_wrong: 'Wrong nickname or password.', e_many: 'Too many failed attempts. Please wait a few minutes.',
            e_bound: 'This account has not been opened in the Kishka app yet. Sign in to it there once (KishkaBlox tab).',
            e_server: 'Server error. Please try again.', e_timeout: 'The server did not respond. Please try again.', e_lib: 'The connection library failed to load. Check your internet and reload the page.',
            help: '<b>Keyboard controls</b><br><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or arrows — move and steer · <kbd>Space</kbd> — jump / handbrake · <kbd>P</kbd> — drift (press P and turn the wheel at once) · <kbd>R</kbd> — flip the car upright · <kbd>Esc</kbd> — menu · mouse drag — camera, mouse wheel — zoom.<br>On a phone use the on-screen buttons (landscape works best).'
        }
    };

    function $(id) { return document.getElementById(id); }
    function pickLang() {
        var saved = null;
        try { saved = window.localStorage.getItem(LANG_KEY); } catch (e) { /* ignore */ }
        if (saved === 'uk' || saved === 'ru' || saved === 'en') return saved;
        var n = String((navigator && navigator.language) || 'en').toLowerCase();
        return n.indexOf('uk') === 0 ? 'uk' : (n.indexOf('ru') === 0 ? 'ru' : 'en');
    }
    var lang = pickLang();
    function T(k) { return (TX[lang] && TX[lang][k]) || TX.en[k] || k; }

    function readSession() {
        try {
            var s = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || 'null');
            if (s && typeof s.token === 'string' && typeof s.nick === 'string') return s;
        } catch (e) { /* ignore */ }
        return null;
    }
    function writeSession(s) { try { window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
    function clearSession() { try { window.sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } }

    var socket = null, online = false, busy = false;

    function setMsg(text, info) { var m = $('loginMsg'); m.textContent = text || ''; m.className = 'msg' + (info ? ' info' : ''); }

    function applyTexts() {
        document.documentElement.lang = lang;
        $('tLogin').textContent = T('login'); $('tLoginSub').textContent = T('sub');
        $('tNick').textContent = T('nick'); $('tPass').textContent = T('pass'); $('tShow').textContent = T('show');
        $('loginBtn').textContent = T('enter'); $('logoutBtn').textContent = T('logout'); $('playBtn').textContent = T('play');
        $('help').innerHTML = T('help');
        var s = readSession();
        if (s) { $('helloNick').textContent = T('hello') + ', ' + s.nick; $('avatar').textContent = (s.nick || '?').charAt(0).toUpperCase(); }
        var bs = document.querySelectorAll('.langs button');
        for (var i = 0; i < bs.length; i++) bs[i].className = bs[i].getAttribute('data-lang') === lang ? 'on' : '';
        if (!online && $('loginView') && !$('loginView').classList.contains('hidden')) setMsg(T('connecting'), true);
    }

    function show(homeOn) {
        $('loginView').classList.toggle('hidden', homeOn);
        $('homeView').classList.toggle('hidden', !homeOn);
        applyTexts();
    }

    function connect() {
        if (typeof window.io !== 'function') { setMsg(T('e_lib')); return; }
        var wakeTimer = setTimeout(function () { if (!online) setMsg(T('waking'), true); }, 3500);
        socket = window.io(SERVER, { transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000, timeout: 20000 });
        socket.on('connect', function () { online = true; clearTimeout(wakeTimer); if (!readSession()) setMsg(T('ready'), true); });
        socket.on('disconnect', function () { online = false; });
        socket.on('connect_error', function () { if (!online) setMsg(T('waking'), true); });
    }

    function doLogin() {
        if (busy) return;
        var nick = $('nick').value.replace(/^\s+|\s+$/g, '');
        var pass = $('pass').value;
        if (!nick || !pass) { setMsg(T('e_empty')); return; }
        if (!socket || !online) { setMsg(T('waking'), true); return; }
        busy = true; $('loginBtn').disabled = true; setMsg('');
        var answered = false;
        var timer = setTimeout(function () { if (!answered) { answered = true; busy = false; $('loginBtn').disabled = false; setMsg(T('e_timeout')); } }, 20000);
        socket.emit('blox_web_login', { nick: nick, password: pass }, function (res) {
            if (answered) return;
            answered = true; clearTimeout(timer); busy = false; $('loginBtn').disabled = false;
            if (res && res.success && res.token) {
                writeSession({ token: res.token, nick: res.nick, email: res.email });
                $('pass').value = '';
                show(true);
                return;
            }
            var code = res && res.code;
            setMsg(code === 'too_many' ? T('e_many') : (code === 'not_bound' ? T('e_bound') : (code === 'wrong_password' ? T('e_wrong') : T('e_server'))));
        });
    }

    function doLogout() {
        var s = readSession();
        if (s && socket && online) socket.emit('blox_web_logout', { token: s.token });
        clearSession();
        show(false);
        setMsg(online ? T('ready') : T('connecting'), true);
    }

    function init() {
        var bs = document.querySelectorAll('.langs button');
        for (var i = 0; i < bs.length; i++) {
            bs[i].addEventListener('click', function (e) {
                lang = e.currentTarget.getAttribute('data-lang');
                try { window.localStorage.setItem(LANG_KEY, lang); } catch (x) { /* ignore */ }
                applyTexts();
            });
        }
        $('loginBtn').addEventListener('click', doLogin);
        $('pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
        $('nick').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('pass').focus(); });
        $('showPass').addEventListener('change', function () { $('pass').type = $('showPass').checked ? 'text' : 'password'; });
        $('logoutBtn').addEventListener('click', doLogout);
        $('playBtn').addEventListener('click', function () { window.location.href = GAME_PAGE; });
        $('tileCars').addEventListener('click', function () { window.location.href = GAME_PAGE; });
        show(!!readSession());
        connect();                               // з'єднання одразу будить сервер Render, поки людина вводить пароль
    }
    init();
})();
