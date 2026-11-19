#!/usr/bin/env node
// KishkaBlox — збирання сайту для GitHub Pages.
//   node web/build-site.js [--src <корінь репозиторію>] [--out <папка>]
// Бере ТОЙ САМИЙ код гри, що й застосунок (blox_game/*), додає сторінку входу й веб-міст з папки web/ та картинки з Assets/,
// і вставляє веб-міст у game.html. Нічого не переписується іншою мовою: game.js, physics.js, models.js лишаються як є.
// Змінна середовища KISHKA_SERVER (необов'язково) підміняє адресу сервера в web-config.js.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SOCKET_IO_CDN = 'https://cdn.jsdelivr.net/npm/socket.io-client@4.7.5/dist/socket.io.min.js';
const WEB_FILES = ['index.html', 'lobby.js', 'web-bridge.js', 'web-config.js', 'web.css'];
const ASSETS = ['Kishkablox.png', 'Realistic_cars.jpg'];

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

function build(srcRoot, outDir, opts) {
    const gameDir = path.join(srcRoot, 'blox_game');
    const webDir = path.join(srcRoot, 'web');
    if (!fs.existsSync(path.join(gameDir, 'game.html'))) throw new Error('не знайдено ' + path.join(gameDir, 'game.html'));
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(outDir, 'Assets'), { recursive: true });

    // 1) гра: усі файли blox_game, game.html — з вставленим мостом
    for (const name of fs.readdirSync(gameDir)) {
        const from = path.join(gameDir, name);
        if (!fs.statSync(from).isFile() || name.startsWith('.')) continue;
        if (name === 'game.html') fs.writeFileSync(path.join(outDir, name), patchGameHtml(fs.readFileSync(from, 'utf8')));
        else fs.copyFileSync(from, path.join(outDir, name));
    }
    // 2) сайт: вхід і міст
    for (const name of WEB_FILES) {
        const from = path.join(webDir, name);
        if (!fs.existsSync(from)) throw new Error('немає файла web/' + name);
        let data = fs.readFileSync(from);
        if (name === 'web-config.js' && opts && opts.server) {
            data = Buffer.from(data.toString('utf8').replace(/server:\s*'[^']*'/, "server: '" + opts.server.replace(/'/g, '') + "'"));
        }
        fs.writeFileSync(path.join(outDir, name), data);
    }
    // 3) картинки
    for (const name of ASSETS) {
        const from = path.join(srcRoot, 'Assets', name);
        if (fs.existsSync(from)) fs.copyFileSync(from, path.join(outDir, 'Assets', name));
        else console.warn('УВАГА: немає Assets/' + name + ' — на сайті не буде цієї картинки');
    }
    // 4) Jekyll не потрібен: файли віддаються як є
    fs.writeFileSync(path.join(outDir, '.nojekyll'), '');
    return fs.readdirSync(outDir);
}

module.exports = { build, patchGameHtml, SOCKET_IO_CDN, WEB_FILES, ASSETS };

if (require.main === module) {
    const src = path.resolve(arg('--src', path.join(__dirname, '..')));
    const out = path.resolve(arg('--out', path.join(src, '_site')));
    const files = build(src, out, { server: process.env.KISHKA_SERVER || '' });
    console.log('Сайт зібрано в ' + out + ': ' + files.join(', '));
}
