#!/usr/bin/env node
// KishkaBlox — збирання сайту для GitHub Pages.
//   node web/build-site.js [--src <корінь репозиторію>] [--out <папка>]
// Бере ТОЙ САМИЙ код гри, що й застосунок (blox_game/*), додає сторінку входу й веб-міст з папки web/ та картинки з Assets/,
// і вставляє веб-міст у game.html. Нічого не переписується іншою мовою: game.js, physics.js, models.js лишаються як є.
// Змінна середовища KISHKA_SERVER (необов'язково) підміняє адресу сервера в web-config.js.
//
// Той самий збирач робить і сайт ПОСИЛАНЬ Kishka Messenger (web/messenger/): сторінка .../ID/153663 показує ім'я й аватарку та відкриває застосунок.
//   --layout blox       (за замовчуванням) корінь = KishkaBlox, посилання профілів: <сайт>/messenger/ID/<число>
//   --layout messenger  корінь = Kishka Messenger, посилання профілів: <сайт>/ID/<число>, а KishkaBlox лежить у <сайт>/blox/
// Змінні середовища: KISHKA_SERVER (сервер повідомлень), KISHKA_APK_URL (куди веде «Завантажити застосунок»).
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SOCKET_IO_CDN = 'https://cdn.jsdelivr.net/npm/socket.io-client@4.7.5/dist/socket.io.min.js';
const WEB_FILES = ['index.html', 'lobby.js', 'web-bridge.js', 'web-config.js', 'web.css'];
const ASSETS = ['Kishkablox.png', 'Realistic_cars.jpg'];
// Логотип застосунку (значок кнопки меню й сторінки посилань) лежить у ресурсах Android-проєкту
const LOGO_SRC = path.join('app', 'src', 'main', 'res', 'drawable-nodpi', 'logo_watermark.png');
const MESSENGER_FILES = ['index.html', 'link.js', 'link.css'];

function arg(name, def) {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function patchGameHtml(html) {
    const marker = '<script src="world.js"></script>';
    if (html.split(marker).length !== 2) throw new Error('у game.html має бути рівно один тег ' + marker);
    const inject = [
        '<script src="web-config.js"></script>',
        '<script src="' + SOCKET_IO_CDN + '"></script>',
        '<script src="web-bridge.js"></script>'
    ].join('\n') + '\n';
    return html.replace(marker, inject + marker);
}

// Сайт KishkaBlox (гра + вхід + міст) у папку dir
function buildBlox(srcRoot, dir, opts) {
    const gameDir = path.join(srcRoot, 'blox_game');
    const webDir = path.join(srcRoot, 'web');
    if (!fs.existsSync(path.join(gameDir, 'game.html'))) throw new Error('не знайдено ' + path.join(gameDir, 'game.html'));
    fs.mkdirSync(path.join(dir, 'Assets'), { recursive: true });

    // 1) гра: усі файли blox_game, game.html — з вставленим мостом
    for (const name of fs.readdirSync(gameDir)) {
        const from = path.join(gameDir, name);
        if (!fs.statSync(from).isFile() || name.startsWith('.')) continue;
        if (name === 'game.html') fs.writeFileSync(path.join(dir, name), patchGameHtml(fs.readFileSync(from, 'utf8')));
        else fs.copyFileSync(from, path.join(dir, name));
    }
    // 2) сайт: вхід і міст
    for (const name of WEB_FILES) {
        const from = path.join(webDir, name);
        if (!fs.existsSync(from)) throw new Error('немає файла web/' + name);
        let data = fs.readFileSync(from);
        if (name === 'web-config.js' && opts && opts.server) {
            data = Buffer.from(data.toString('utf8').replace(/server:\s*'[^']*'/, "server: '" + opts.server.replace(/'/g, '') + "'"));
        }
        fs.writeFileSync(path.join(dir, name), data);
    }
    // 3) картинки
    for (const name of ASSETS) {
        const from = path.join(srcRoot, 'Assets', name);
        if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, 'Assets', name));
        else console.warn('УВАГА: немає Assets/' + name + ' — на сайті не буде цієї картинки');
    }
    const logo = path.join(srcRoot, LOGO_SRC);
    if (fs.existsSync(logo)) fs.copyFileSync(logo, path.join(dir, 'Assets', 'logo_watermark.png'));
    else console.warn('УВАГА: немає ' + LOGO_SRC + ' — значок меню на сайті буде порожній');
}

// Сайт посилань Kishka Messenger у папку dir; base — де ця папка лежить відносно кореня сайту ('/messenger/' або '/')
function buildMessenger(srcRoot, dir, base, opts) {
    const msgDir = path.join(srcRoot, 'web', 'messenger');
    fs.mkdirSync(dir, { recursive: true });
    const cfg = [];
    if (opts && opts.server) cfg.push("server: '" + opts.server.replace(/'/g, '') + "'");
    if (opts && opts.apk) cfg.push("apk: '" + opts.apk.replace(/'/g, '') + "'");
    const inject = (html) => cfg.length ? html.replace('window.KishkaMessengerSite = {', 'window.KishkaMessengerSite = { ' + cfg.join(', ') + ',') : html;
    for (const name of MESSENGER_FILES) {
        const from = path.join(msgDir, name);
        if (!fs.existsSync(from)) throw new Error('немає файла web/messenger/' + name);
        const data = fs.readFileSync(from);
        fs.writeFileSync(path.join(dir, name), name.endsWith('.html') ? inject(data.toString('utf8')) : data);
    }
    const logo = path.join(srcRoot, LOGO_SRC);
    if (fs.existsSync(logo)) fs.copyFileSync(logo, path.join(dir, 'logo_watermark.png'));
    // 404.html у КОРЕНІ сайту: GitHub Pages віддає її для будь-якої неіснуючої адреси, зокрема .../ID/153663 (не існує жодного файла за цим шляхом)
    return inject(fs.readFileSync(path.join(msgDir, '404.template.html'), 'utf8')).replace(/\{\{MSG_BASE\}\}/g, base).replace(/\{\{HOME\}\}/g, base);
}

function build(srcRoot, outDir, opts) {
    opts = opts || {};
    const layout = opts.layout === 'messenger' ? 'messenger' : 'blox';
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    let notFound;
    if (layout === 'blox') {
        buildBlox(srcRoot, outDir, opts);
        notFound = buildMessenger(srcRoot, path.join(outDir, 'messenger'), '/messenger/', opts);
    } else {
        buildBlox(srcRoot, path.join(outDir, 'blox'), opts);
        notFound = buildMessenger(srcRoot, outDir, '/', opts);
    }
    fs.writeFileSync(path.join(outDir, '404.html'), notFound);
    // Jekyll не потрібен: файли віддаються як є
    fs.writeFileSync(path.join(outDir, '.nojekyll'), '');
    return fs.readdirSync(outDir);
}

module.exports = { build, buildBlox, buildMessenger, patchGameHtml, SOCKET_IO_CDN, WEB_FILES, ASSETS, MESSENGER_FILES };

if (require.main === module) {
    const src = path.resolve(arg('--src', path.join(__dirname, '..')));
    const out = path.resolve(arg('--out', path.join(src, '_site')));
    const files = build(src, out, {
        server: process.env.KISHKA_SERVER || '',
        apk: process.env.KISHKA_APK_URL || '',
        layout: arg('--layout', process.env.KISHKA_LAYOUT || 'blox')
    });
    console.log('Сайт зібрано в ' + out + ': ' + files.join(', '));
}
