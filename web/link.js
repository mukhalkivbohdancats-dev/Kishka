// Kishka Messenger — сторінка посилання на профіль: .../ID/153663
// Показує ім'я й аватарку користувача (з сервера, без пошти) і сама відкриває застосунок Android через kishka://user/<ID>.
// Якщо застосунку нема — пропонує завантажити його. Працює і як 404.html (GitHub Pages віддає її для будь-якого .../ID/<число>).
(function () {
    'use strict';
    var CFG = window.KishkaMessengerSite || {};
    var SERVER = (CFG.server || 'https://kishka.onrender.com').replace(/\/+$/, '');
    var APK = CFG.apk || 'https://github.com/mukhalkivbohdancats-dev/Kishka/raw/main/apk/KishkaMessenger_V6.5.apk';
    var PACKAGE = 'com.kishka.messenger';

    var T = {
        uk: {
            title: 'Kishka Messenger', loading: 'Завантажуємо профіль…', open: 'Відкрити в застосунку', download: 'Завантажити застосунок для Android',
            opening: 'Відкриваємо Kishka Messenger…', noapp: 'Не відкрилося? Застосунку може не бути на цьому пристрої.',
            notfound: 'Такого користувача не знайдено', neterr: 'Не вдалося завантажити профіль. Спробуйте ще раз', id: 'ID',
            hint: 'Відкрийте це посилання на телефоні з Android, де встановлено Kishka Messenger.', home: 'На головну', nf404: 'Сторінку не знайдено',
            invite: 'запрошує вас у Kishka Messenger', copy: 'Копіювати посилання', copied: 'Скопійовано'
        },
        ru: {
            title: 'Kishka Messenger', loading: 'Загружаем профиль…', open: 'Открыть в приложении', download: 'Скачать приложение для Android',
            opening: 'Открываем Kishka Messenger…', noapp: 'Не открылось? Возможно, приложения нет на этом устройстве.',
            notfound: 'Такого пользователя не найдено', neterr: 'Не удалось загрузить профиль. Попробуйте ещё раз', id: 'ID',
            hint: 'Откройте эту ссылку на телефоне с Android, где установлен Kishka Messenger.', home: 'На главную', nf404: 'Страница не найдена',
            invite: 'приглашает вас в Kishka Messenger', copy: 'Копировать ссылку', copied: 'Скопировано'
        },
        en: {
            title: 'Kishka Messenger', loading: 'Loading profile…', open: 'Open in the app', download: 'Download the Android app',
            opening: 'Opening Kishka Messenger…', noapp: "Didn't open? The app may not be installed on this device.",
            notfound: 'This user was not found', neterr: 'Could not load the profile. Please try again', id: 'ID',
            hint: 'Open this link on an Android phone with Kishka Messenger installed.', home: 'Home', nf404: 'Page not found',
            invite: 'invites you to Kishka Messenger', copy: 'Copy link', copied: 'Copied'
        }
    };
    var lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
    if (!T[lang]) lang = 'en';
    var L = T[lang];
    document.documentElement.lang = lang;

    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    var app = document.getElementById('app');

    // ID з адреси: .../ID/153663 (або ?id=153663)
    function parseId() {
        var m = /\/ID\/(\d{1,12})(?:\/|$)/i.exec(location.pathname);
        if (m) return m[1];
        var q = /[?&]id=(\d{1,12})(?:&|$)/i.exec(location.search);
        return q ? q[1] : null;
    }
    var id = parseId();
    var isAndroid = /Android/i.test(navigator.userAgent);

    function home(base) {
        var a = el('a', 'btn ghost', L.home);
        a.href = base || (CFG.home || '/');
        return a;
    }

    if (!id) {                                    // не посилання на профіль: головна або справжня 404
        var box0 = el('div', 'card');
        box0.appendChild(el('div', 'logo'));
        box0.appendChild(el('h1', null, CFG.is404 ? L.nf404 : L.title));
        var d = el('a', 'btn primary', L.download); d.href = APK; box0.appendChild(d);
        if (CFG.is404) box0.appendChild(home());
        app.appendChild(box0);
        return;
    }

    var card = el('div', 'card');
    var logo = el('div', 'logo');
    var avatar = el('img', 'avatar'); avatar.alt = ''; avatar.style.display = 'none';
    var name = el('h1', null, L.loading);
    var idLine = el('div', 'idline', L.id + ': ' + id);
    var status = el('div', 'status', '');
    var btnOpen = el('a', 'btn primary', L.open);
    var btnDl = el('a', 'btn ghost', L.download); btnDl.href = APK;
    var hint = el('div', 'hint', isAndroid ? '' : L.hint);
    card.appendChild(logo); card.appendChild(avatar); card.appendChild(name); card.appendChild(idLine);
    card.appendChild(status); card.appendChild(btnOpen); card.appendChild(btnDl); card.appendChild(hint);
    app.appendChild(card);

    // Посилання, що відкриває застосунок: на Android через intent (Chrome сам відкриє застосунок), інакше через схему kishka://
    var schemeUrl = 'kishka://user/' + id;
    var intentUrl = 'intent://user/' + id + '#Intent;scheme=kishka;package=' + PACKAGE + ';end';
    btnOpen.href = isAndroid ? intentUrl : schemeUrl;
    if (!isAndroid) btnOpen.style.display = 'none';

    // Профіль: ім'я й аватарка (пошта не віддається)
    fetch(SERVER + '/api/user/' + id, { mode: 'cors' }).then(function (r) {
        if (r.status === 404) throw new Error('notfound');
        if (!r.ok) throw new Error('net');
        return r.json();
    }).then(function (p) {
        name.textContent = p.name || ('ID ' + id);
        document.title = (p.name ? p.name + ' — ' : '') + L.title;
        if (p.avatarUrl) { avatar.src = p.avatarUrl; avatar.style.display = ''; avatar.onerror = function () { avatar.style.display = 'none'; }; }
    }).catch(function (e) {
        name.textContent = (e && e.message === 'notfound') ? L.notfound : L.neterr;
    });

    // Відкриваємо застосунок самі; якщо за ~2 с сторінка досі перед очима — показуємо підказку «Не відкрилося?»
    if (isAndroid) {
        status.textContent = L.opening;
        setTimeout(function () { window.location.href = intentUrl; }, 350);
        setTimeout(function () { if (!document.hidden) status.textContent = L.noapp; }, 2600);
    }
})();
