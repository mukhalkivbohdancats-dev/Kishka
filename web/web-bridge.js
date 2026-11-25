// KishkaBlox — веб-міст. Підключається до game.html (сайт на GitHub Pages) ПЕРЕД game.js і замінює застосунок Android:
// дає грі той самий об'єкт window.Android (ready, started, sendState, carSpawn, carRemove, failReason, log, state),
// сам входить на сервер (Socket.IO) і викликає KishkaGame.start / roster / tick / cars / carTick / carResult / respawn.
// Код гри (game.js, physics.js, models.js ...) однаковий для застосунку й сайту — мову програмування не змінено.
//
// Потрібно на сторінці до цього файла: web-config.js (адреса сервера) і socket.io-client (глобальна io).
// Особа береться з sessionStorage (її записала сторінка входу index.html): токен, нік, email. Пароль ніде не зберігається.
(function () {
    'use strict';

    var CFG = window.KISHKA_WEB || {};
    var SERVER = String(CFG.server || '').replace(/\/+$/, '');
    var GAME_ID = CFG.game || 'realistic_cars';
    var HOME = CFG.home || 'index.html';
    var SESSION_KEY = 'kishkablox.web.session';
    var LANG_KEY = 'kishkablox.web.lang';
    var INVERT_KEY = 'kishkablox.web.invertCamera';
    var JOIN_TIMEOUT_MS = 12000;
    var JOIN_ATTEMPTS = 4;
    var AVATAR = CFG.avatar || 'Assets/Kishkablox.png';
    var MENU_ICON = CFG.menuIcon || 'Assets/logo_watermark.png';       // значок кнопки меню — логотип Kishka (а не «три смуги»)
    var RPC_EVENTS = { blox_chat: 1, blox_door_code: 1, blox_nuke_launch: 1, blox_game_respawn: 1 };      // що гра може просити в сервера

    // ------------------------------------------------------------------ мова й написи (uk / ru / en)
    function pickLang() {
        var saved = null;
        try { saved = window.localStorage.getItem(LANG_KEY); } catch (e) { /* сховище недоступне */ }
        if (saved === 'uk' || saved === 'ru' || saved === 'en') return saved;
        var n = String((window.navigator && (window.navigator.language || window.navigator.userLanguage)) || 'en').toLowerCase();
        if (n.indexOf('uk') === 0) return 'uk';
        if (n.indexOf('ru') === 0) return 'ru';
        return 'en';
    }
    var LANG = pickLang();
    // Інверсія камери (рух миші/пальця вгору-вниз навпаки): зберігається в браузері, як і в застосунку
    function readInvert() {
        try { return window.localStorage.getItem(INVERT_KEY) === '1'; } catch (e) { return false; }
    }
    function saveInvert(on) {
        try { window.localStorage.setItem(INVERT_KEY, on ? '1' : '0'); } catch (e) { /* сховище недоступне */ }
    }
    var invertCamera = readInvert();
    var TR = {
        uk: {
            title: 'Realistic cars', joining: 'Вхід у гру…', waking: 'Сервер прокидається, це може тривати до хвилини…', menu: 'Меню',
            players: 'Гравці', invert: 'Інверсія камери', respawn: 'Відродитися', leave: 'Вийти з гри', resume: 'Продовжити', sure: 'Ви впевнені?', yes: 'Так', no: 'Ні',
            back: 'Назад', ok: 'Гаразд', you: 'ви', reconnecting: 'З’єднання втрачено, підключаємося…',
            e_session: 'Сесія закінчилась. Увійдіть знову.', e_kick_other: 'Ви зайшли в гру з іншого пристрою.', e_kick_timeout: 'З’єднання з грою втрачено (вкладка була неактивною). Зайдіть знову.',
            e_join: 'Не вдалося увійти в гру. Спробуйте ще раз.', e_webgl: 'Ваш браузер не підтримує WebGL, тож гра не запуститься.', e_lib: 'Не завантажилась бібліотека зв’язку з сервером. Перевірте інтернет і оновіть сторінку.',
            e_unknown_game: 'Такої гри на сервері немає.', e_not_logged_in: 'Акаунт KishkaBlox не ввійшов. Увійдіть знову.'
        },
        ru: {
            title: 'Realistic cars', joining: 'Вход в игру…', waking: 'Сервер просыпается, это может занять до минуты…', menu: 'Меню',
            players: 'Игроки', invert: 'Инверсия камеры', respawn: 'Возродиться', leave: 'Выйти из игры', resume: 'Продолжить', sure: 'Вы уверены?', yes: 'Да', no: 'Нет',
            back: 'Назад', ok: 'Хорошо', you: 'вы', reconnecting: 'Соединение потеряно, подключаемся…',
            e_session: 'Сессия закончилась. Войдите снова.', e_kick_other: 'Вы зашли в игру с другого устройства.', e_kick_timeout: 'Связь с игрой потеряна (вкладка была неактивной). Зайдите снова.',
            e_join: 'Не удалось войти в игру. Попробуйте ещё раз.', e_webgl: 'Ваш браузер не поддерживает WebGL, поэтому игра не запустится.', e_lib: 'Не загрузилась библиотека связи с сервером. Проверьте интернет и обновите страницу.',
            e_unknown_game: 'Такой игры на сервере нет.', e_not_logged_in: 'Аккаунт KishkaBlox не вошёл. Войдите снова.'
        },
        en: {
            title: 'Realistic cars', joining: 'Joining the game…', waking: 'The server is waking up, this can take up to a minute…', menu: 'Menu',
            players: 'Players', invert: 'Invert camera', respawn: 'Respawn', leave: 'Leave game', resume: 'Resume', sure: 'Are you sure?', yes: 'Yes', no: 'No',
            back: 'Back', ok: 'OK', you: 'you', reconnecting: 'Connection lost, reconnecting…',
            e_session: 'Your session has expired. Please sign in again.', e_kick_other: 'You joined the game from another device.', e_kick_timeout: 'The connection to the game was lost (the tab was inactive). Please join again.',
            e_join: 'Could not join the game. Please try again.', e_webgl: 'Your browser does not support WebGL, so the game cannot start.', e_lib: 'The server connection library failed to load. Check your internet and reload the page.',
            e_unknown_game: 'This game does not exist on the server.', e_not_logged_in: 'The KishkaBlox account is not signed in. Please sign in again.'
        }
    };
    function t(key) { var d = TR[LANG] || TR.en; return d[key] !== undefined ? d[key] : (TR.en[key] || key); }

    // ------------------------------------------------------------------ сесія
    function readSession() {
        try {
            var raw = window.sessionStorage.getItem(SESSION_KEY);
            if (!raw) return null;
            var s = JSON.parse(raw);
            if (s && typeof s.token === 'string' && typeof s.nick === 'string') return s;
        } catch (e) { /* зіпсований запис */ }
        return null;
    }
    function clearSession() { try { window.sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } }
    function goHome() { window.location.href = HOME; }

    var session = readSession();
    if (!session && !CFG.noRedirect) { goHome(); return; }       // без входу на сторінку гри не пускаємо

    // ------------------------------------------------------------------ стан
    var socket = null;
    var joinedOnce = false, joined = false, identified = false, readyCalled = false, leaving = false, failedHard = false;
    var joinToken = 0, joinAttempts = 0;
    var myId = -1;
    var players = {};                      // id -> нік
    var lastPos = { x: 0, y: 0, z: 0, ry: 0 };
    var spawnToken = 0;
    var ui = null;

    function game() { return window.KishkaGame || null; }
    function toGame(name, arg, arg2) {
        var g = game();
        if (!g || typeof g[name] !== 'function') return;
        try { g[name](arg, arg2); } catch (e) { if (window.console) console.error('[bridge] ' + name + ': ' + (e && e.message)); }
    }
    function dbg(text) { if (CFG.debug && window.console) console.log('[bridge] ' + text); }

    // ------------------------------------------------------------------ вікна (завантаження, меню, помилка)
    function el(tag, css, text) {
        var e = document.createElement(tag);
        if (css) e.style.cssText = css;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    var FONT = 'font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;';

    function buildUi() {
        if (ui) return ui;
        var u = { menuOpen: false };
        var root = el('div', 'position:fixed;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:50;' + FONT);

        // сірий екран завантаження: аватар по центру, назва над ним, знизу — що відбувається
        var load = el('div', 'position:fixed;left:0;top:0;right:0;bottom:0;background:#3b3e46;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:auto;z-index:60;color:#fff;');
        var img = el('img', 'width:132px;height:132px;border-radius:26px;object-fit:cover;background:#2b2d33;box-shadow:0 6px 24px rgba(0,0,0,.45);');
        img.src = AVATAR; img.alt = '';
        img.onerror = function () { img.style.display = 'none'; };
        var ttl = el('div', 'font-size:26px;font-weight:800;margin-top:18px;letter-spacing:.3px;', t('title'));
        var msg = el('div', 'position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 26px);text-align:center;font-size:16px;opacity:.9;padding:0 20px;', t('joining'));
        load.appendChild(img); load.appendChild(ttl); load.appendChild(msg);
        root.appendChild(load);

        // кругла кнопка меню з логотипом: зліва вгорі
        var btn = el('button', 'position:fixed;left:calc(env(safe-area-inset-left,0px) + 12px);top:calc(env(safe-area-inset-top,0px) + 10px);width:46px;height:46px;border-radius:50%;border:2px solid rgba(255,255,255,.75);background:rgba(20,22,28,.85) center/72% no-repeat;cursor:pointer;pointer-events:auto;z-index:55;padding:0;display:none;');
        btn.style.backgroundImage = 'url("' + MENU_ICON + '")';
        if (document.documentElement && document.documentElement.style && document.documentElement.style.setProperty) {
            document.documentElement.style.setProperty('--topbtn', '46px');      // чат і кнопка машин у game.html стають поруч із цією кнопкою
        }
        btn.setAttribute('aria-label', t('menu'));
        root.appendChild(btn);

        // меню: напівпрозора панель зліва, список гравців і кнопки внизу
        var panel = el('div', 'position:fixed;left:calc(env(safe-area-inset-left,0px) + 12px);top:calc(env(safe-area-inset-top,0px) + 66px);bottom:calc(env(safe-area-inset-bottom,0px) + 12px);width:300px;max-width:calc(100% - 24px);background:rgba(18,20,26,.82);border-radius:14px;color:#fff;display:none;flex-direction:column;pointer-events:auto;z-index:56;box-shadow:0 8px 28px rgba(0,0,0,.45);overflow:hidden;');
        var head = el('div', 'padding:14px 16px 8px;font-size:17px;font-weight:800;', t('players'));
        var list = el('div', 'flex:1;overflow-y:auto;padding:0 8px 8px;');
        // перемикач «Інверсія камери»
        var optRow = el('div', 'padding:12px 16px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid rgba(255,255,255,.12);font-size:16px;');
        var optLabel = el('span', '', t('invert'));
        var sw = el('button', 'width:52px;height:30px;border-radius:15px;border:0;position:relative;cursor:pointer;padding:0;flex:none;margin-left:12px;');
        var knob = el('span', 'position:absolute;top:3px;width:24px;height:24px;border-radius:50%;background:#fff;transition:left .15s;');
        sw.appendChild(knob);
        sw.setAttribute('role', 'switch');
        sw.setAttribute('aria-label', t('invert'));
        optRow.appendChild(optLabel); optRow.appendChild(sw);
        var foot = el('div', 'padding:10px;display:flex;flex-direction:column;gap:8px;border-top:1px solid rgba(255,255,255,.12);');
        function mkBtn(label, bg) {
            return el('button', 'height:44px;border-radius:10px;border:0;background:' + bg + ';color:#fff;font-size:16px;font-weight:700;cursor:pointer;', label);
        }
        var bResume = mkBtn(t('resume'), '#3a7bd5'), bRespawn = mkBtn(t('respawn'), '#4a4f5c'), bLeave = mkBtn(t('leave'), '#d4474c');
        foot.appendChild(bResume); foot.appendChild(bRespawn); foot.appendChild(bLeave);
        panel.appendChild(head); panel.appendChild(list); panel.appendChild(optRow); panel.appendChild(foot);
        root.appendChild(panel);

        // діалог (підтвердження виходу / помилка)
        var dlgWrap = el('div', 'position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;pointer-events:auto;z-index:70;');
        var dlg = el('div', 'background:#23262e;color:#fff;border-radius:16px;padding:22px 22px 16px;max-width:360px;width:calc(100% - 40px);box-shadow:0 10px 36px rgba(0,0,0,.55);text-align:center;');
        var dText = el('div', 'font-size:17px;line-height:1.4;margin-bottom:16px;');
        var dRow = el('div', 'display:flex;gap:10px;justify-content:center;');
        dlg.appendChild(dText); dlg.appendChild(dRow); dlgWrap.appendChild(dlg); root.appendChild(dlgWrap);

        // тонка стрічка стану (втрата зв'язку)
        var bar = el('div', 'position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 10px);background:rgba(212,71,76,.92);color:#fff;padding:8px 16px;border-radius:18px;font-size:14px;font-weight:700;display:none;pointer-events:none;z-index:58;');
        root.appendChild(bar);

        document.body.appendChild(root);
        u.root = root; u.load = load; u.loadMsg = msg; u.btn = btn; u.panel = panel; u.list = list; u.head = head;
        u.dlgWrap = dlgWrap; u.dText = dText; u.dRow = dRow; u.bar = bar; u.sw = sw; u.knob = knob;
        u.paintSwitch = function () {
            sw.style.background = invertCamera ? '#3a7bd5' : '#4a4f5c';
            knob.style.left = invertCamera ? '25px' : '3px';
            sw.setAttribute('aria-checked', invertCamera ? 'true' : 'false');
        };
        u.paintSwitch();
        sw.addEventListener('click', function () { setInvert(!invertCamera); });

        function mkDlgBtn(label, bg, fn) {
            var b = mkBtn(label, bg); b.style.minWidth = '110px'; b.style.padding = '0 16px';
            b.addEventListener('click', fn); return b;
        }
        u.dialog = function (text, buttons) {
            u.dText.textContent = text;
            while (u.dRow.firstChild) u.dRow.removeChild(u.dRow.firstChild);
            for (var i = 0; i < buttons.length; i++) u.dRow.appendChild(mkDlgBtn(buttons[i].label, buttons[i].bg || '#4a4f5c', buttons[i].fn));
            u.dlgWrap.style.display = 'flex';
        };
        u.closeDialog = function () { u.dlgWrap.style.display = 'none'; };
        u.setMenu = function (open) {
            u.menuOpen = !!open;
            u.panel.style.display = open ? 'flex' : 'none';
            if (open) renderPlayers();
        };
        btn.addEventListener('click', function () { u.setMenu(!u.menuOpen); });
        bResume.addEventListener('click', function () { u.setMenu(false); });
        bRespawn.addEventListener('click', function () { respawn(); u.setMenu(false); });
        bLeave.addEventListener('click', function () {
            u.dialog(t('sure'), [
                { label: t('no'), bg: '#4a4f5c', fn: function () { u.closeDialog(); } },
                { label: t('yes'), bg: '#d4474c', fn: function () { u.closeDialog(); leave(); } }
            ]);
        });
        document.addEventListener('keydown', function (e) {
            if (e.code === 'Escape' && !failedHard) u.setMenu(!u.menuOpen);
        });
        ui = u;
        return u;
    }

    function renderPlayers() {
        if (!ui) return;
        var ids = Object.keys(players).map(Number).sort(function (a, b) { return a - b; });
        ui.head.textContent = t('players') + ' (' + ids.length + ')';
        while (ui.list.firstChild) ui.list.removeChild(ui.list.firstChild);
        for (var i = 0; i < ids.length; i++) {
            var me = ids[i] === myId;
            var row = el('div', 'padding:9px 10px;border-radius:8px;font-size:16px;display:flex;justify-content:space-between;' + (me ? 'background:rgba(255,255,255,.09);' : ''));
            row.appendChild(el('span', 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', players[ids[i]] || ('#' + ids[i])));
            if (me) row.appendChild(el('span', 'opacity:.6;font-size:13px;margin-left:8px;', t('you')));
            ui.list.appendChild(row);
        }
    }

    function showError(text, toHome) {
        failedHard = true;
        var u = buildUi();
        u.load.style.display = 'none';
        u.setMenu(false);
        u.btn.style.display = 'none';
        u.dialog(text, [{ label: t('back'), bg: '#3a7bd5', fn: function () { if (toHome === 'login') clearSession(); goHome(); } }]);
    }

    function setBar(text) {
        if (!ui) return;
        if (text) { ui.bar.textContent = text; ui.bar.style.display = 'block'; } else ui.bar.style.display = 'none';
    }

    // ------------------------------------------------------------------ дії меню
    function setInvert(on) {
        invertCamera = !!on;
        saveInvert(invertCamera);
        toGame('config', { invertCamera: invertCamera });          // гра застосовує одразу, без перезапуску
        if (ui) ui.paintSwitch();
    }
    function respawn() {
        if (!socket || !joined) return;
        socket.emit('blox_game_respawn', function (res) {
            if (res && res.success) toGame('respawn', { x: res.x, y: res.y, z: res.z, ry: res.ry });
        });
    }
    function leave() {
        leaving = true;
        try { if (socket) socket.emit('blox_game_leave'); } catch (e) { /* ignore */ }
        setTimeout(goHome, 150);
    }

    // ------------------------------------------------------------------ сервер
    function resume(cb) {
        socket.emit('blox_web_resume', { token: session.token }, function (res) {
            if (res && res.success) {
                session.email = res.email || session.email;
                session.nick = res.nick || session.nick;
                cb(true, res);
            } else cb(false, res);
        });
    }

    function join(first) {
        if (!socket || !socket.connected || leaving) return;
        var token = ++joinToken;
        var payload = { email: session.email, game: GAME_ID };
        if (!first) { payload.x = lastPos.x; payload.y = lastPos.y; payload.z = lastPos.z; payload.ry = lastPos.ry; }
        socket.emit('blox_game_join', payload, function (res) { if (token === joinToken) onJoinResult(res, first); });
        setTimeout(function () {
            if (token !== joinToken || joined || leaving) return;
            joinAttempts++;
            if (first && !joinedOnce && joinAttempts >= JOIN_ATTEMPTS) { showError(t('e_join')); return; }
            join(first);
        }, JOIN_TIMEOUT_MS);
    }

    function onJoinResult(res, first) {
        joinToken++;
        if (!res || !res.success) {
            var code = res && res.code;
            dbg('join відхилено: ' + code);
            if ((code === 'not_identified' || code === 'error') && joinAttempts < JOIN_ATTEMPTS) {
                joinAttempts++;
                resume(function (ok) { if (ok) setTimeout(function () { join(first); }, 600); else showError(t('e_session'), 'login'); });
                return;
            }
            if (code === 'not_logged_in') { showError(t('e_not_logged_in'), 'login'); return; }
            if (code === 'unknown_game') { showError(t('e_unknown_game')); return; }
            showError(t('e_join'));
            return;
        }
        joined = true; joinedOnce = true; joinAttempts = 0;
        myId = res.id | 0;
        players = {}; players[myId] = res.nick || session.nick;
        var others = res.players || [];
        for (var i = 0; i < others.length; i++) if (others[i] && typeof others[i].id === 'number') players[others[i].id] = others[i].nick || '';
        toGame('config', { lang: LANG, invertCamera: invertCamera });
        toGame(first ? 'start' : 'resync', res);
        setBar('');
        if (ui) { ui.btn.style.display = 'block'; if (ui.menuOpen) renderPlayers(); }
        dbg('у грі: id=' + myId + ', гравців ' + Object.keys(players).length);
    }

    function wireSocket() {
        socket.on('connect', function () {
            dbg('socket connect');
            resume(function (ok, res) {
                if (!ok) {
                    var code = res && res.code;
                    showError(code === 'expired' || code === 'not_logged_in' ? t('e_session') : t('e_join'), 'login');
                    return;
                }
                identified = true;                       // сокет «назвався» (blox_web_resume): тепер можна входити в гру
                if (readyCalled) { joined = false; join(!joinedOnce); }
            });
        });
        socket.on('disconnect', function () {
            joined = false; identified = false;
            if (!leaving && !failedHard) setBar(t('reconnecting'));
        });
        socket.on('connect_error', function () {
            if (ui && ui.load.style.display !== 'none') ui.loadMsg.textContent = t('waking');
        });
        socket.on('blox_game_roster', function (data) {
            if (!data) return;
            var list = data.players || [];
            var next = {};
            for (var i = 0; i < list.length; i++) if (list[i] && typeof list[i].id === 'number') next[list[i].id] = list[i].nick || '';
            if (joined) { players = next; if (ui && ui.menuOpen) renderPlayers(); }
            toGame('roster', data);
        });
        socket.on('blox_game_tick', function (arr) { toGame('tick', arr); });
        socket.on('blox_game_cars', function (data) { toGame('cars', data); });
        socket.on('blox_car_tick', function (arr) { toGame('carTick', arr); });
        // нові події гри: чат, двері коробки на вершині, ядерна подія
        ['blox_chat_msg', 'blox_door', 'blox_nuke'].forEach(function (ev) { socket.on(ev, function (data) { toGame('serverEvent', ev, data); }); });
        socket.on('blox_game_kicked', function (data) {
            if (leaving) return;
            joined = false;
            var reason = data && data.reason;
            showError(reason === 'other_device' ? t('e_kick_other') : t('e_kick_timeout'));
        });
    }

    // ------------------------------------------------------------------ те, що гра бачить як «застосунок»
    window.Android = {
        ready: function () {
            readyCalled = true;
            buildUi();
            if (identified && !joined) join(!joinedOnce);
        },
        started: function () { if (ui) ui.load.style.display = 'none'; },
        fail: function () { showError(t('e_webgl')); },
        failReason: function (text) {
            var s = String(text || '');
            showError(s.indexOf('webgl') === 0 ? t('e_webgl') : t('e_join'));
        },
        log: function (text) { dbg(String(text)); },
        sendState: function (json) {
            if (!socket || !joined) return;
            var o;
            try { o = JSON.parse(json); } catch (e) { return; }
            if (!o || typeof o !== 'object') return;
            if (typeof o.x === 'number') { lastPos.x = o.x; lastPos.y = o.y; lastPos.z = o.z; lastPos.ry = o.ry; }
            socket.emit('blox_game_state', o);
        },
        state: function (x, y, z, ry, a) {
            if (!socket || !joined) return;
            lastPos.x = x; lastPos.y = y; lastPos.z = z; lastPos.ry = ry;
            socket.emit('blox_game_state', { x: x, y: y, z: z, ry: ry, a: a });
        },
        carSpawn: function (type, x, y, z, ry) {
            if (!socket || !joined) { toGame('carResult', { ok: false, code: 'offline' }); return; }
            var token = ++spawnToken, answered = false;
            socket.emit('blox_car_spawn', { type: type, x: x, y: y, z: z, ry: ry }, function (res) {
                if (answered) return;
                answered = true;
                var ok = !!(res && res.success);
                toGame('carResult', { ok: ok, cid: (res && res.cid) | 0, code: (res && res.code) || '' });
            });
            setTimeout(function () {
                if (token === spawnToken && !answered) { answered = true; toGame('carResult', { ok: false, code: 'timeout' }); }
            }, 5000);
        },
        carRemove: function () {
            if (socket && joined) socket.emit('blox_car_remove');
        },
        // Запит до сервера від гри (чат, код дверей, запуск, відродження): відповідь повертається в KishkaGame.rpcResult(id, res)
        rpc: function (event, json, id) {
            var done = false;
            function finish(res) { if (done) return; done = true; toGame('rpcResult', id, res); }
            if (!RPC_EVENTS[event] || !socket || !joined) { finish({ success: false, code: 'offline' }); return; }
            var payload;
            try { payload = JSON.parse(json); } catch (e) { payload = {}; }
            if (event === 'blox_game_respawn') socket.emit(event, function (res) { finish(res); });
            else socket.emit(event, payload, function (res) { finish(res); });
            setTimeout(function () { finish({ success: false, code: 'timeout' }); }, 7000);
        }
    };

    function start() {
        if (typeof window.io !== 'function') {
            document.addEventListener('DOMContentLoaded', function () { showError(t('e_lib')); });
            if (document.readyState !== 'loading') showError(t('e_lib'));
            return;
        }
        socket = window.io(SERVER, { transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000, timeout: 20000 });
        wireSocket();
        window.addEventListener('beforeunload', function () { try { if (socket && joined) socket.emit('blox_game_leave'); } catch (e) { /* ignore */ } });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { buildUi(); });
    else buildUi();

    // Для тестів і діагностики з консолі браузера
    window.KishkaWebBridge = {
        setInvert: setInvert,
        state: function () { return { invertCamera: invertCamera, identified: identified, joined: joined, joinedOnce: joinedOnce, myId: myId, players: players, lang: LANG, session: session ? { nick: session.nick } : null }; },
        respawn: respawn, leave: leave
    };
    start();
})();
