// =====================================================================
// KishkaBlox — нові ігрові можливості (клієнт): чат, кодові двері й червона кнопка, HP і смерть, ядерна подія зі сиренами й вибухом.
// Підключається з game.js: KishkaFeatures.create(ctx) -> api. Усе, що потребує змінних game.js, приходить через ctx.
//
// ctx: { World, Phys, Models, Structures, Nuke, M, I18, $, toast, nowMs, standalone,
//        me(): { walker, car, driving }, setDriving(on, silent), releaseAll(), teleport(x, y, z, ry),
//        nativeRpc(event, json, id) | null, setBurn(k), setTint(arr|null), addShake(v), stk }
// =====================================================================
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.KishkaFeatures = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function create(ctx) {
        var World = ctx.World, Phys = ctx.Phys, Nuke = ctx.Nuke, M = ctx.M, $ = ctx.$, T = function (k) { return ctx.I18.t(k); };
        var NT = Nuke.T;
        var S = World.SUMMIT, BK = World.BUNKER;
        var meshes = null, R = null;
        var stk = ctx.stk;

        function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
        function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
        function wallNow() { return Date.now(); }

        // ------------------------------------------------------------ RPC до сервера (через застосунок або браузерний міст)
        var rpcSeq = 0, rpcPending = {};
        function rpc(event, payload, cb) {
            if (!ctx.nativeRpc) { if (cb) cb(null); return false; }
            var id = ++rpcSeq;
            rpcPending[id] = { cb: cb, at: wallNow() };
            try { ctx.nativeRpc(event, JSON.stringify(payload || {}), id); } catch (e) { delete rpcPending[id]; if (cb) cb(null); return false; }
            return true;
        }
        function rpcResult(id, res) {
            var p = rpcPending[id];
            if (!p) return;
            delete rpcPending[id];
            if (p.cb) p.cb(res || null);
        }
        function rpcSweep() {                                   // відповіді, що не прийшли за 8 с, — це збій мережі
            var t = wallNow();
            for (var k in rpcPending) if (t - rpcPending[k].at > 8000) { var cb = rpcPending[k].cb; delete rpcPending[k]; if (cb) cb({ success: false, code: 'timeout' }); }
        }

        // ------------------------------------------------------------ час сервера
        var serverOffset = 0;                                  // серверний час = Date.now() + serverOffset
        function syncClock(serverNow) { if (isFinite(+serverNow) && +serverNow > 0) serverOffset = +serverNow - wallNow(); }
        function serverNowMs() { return wallNow() + serverOffset; }

        // ============================================================ ЧАТ
        var chat = { open: true, el: null, list: null, input: null, count: 0, myNick: '' };
        function nickColor(nick) {
            var h = 0;
            for (var i = 0; i < nick.length; i++) h = (h * 31 + nick.charCodeAt(i)) >>> 0;
            return 'hsl(' + (h % 360) + ',78%,68%)';
        }
        function chatAdd(nick, text) {
            if (!chat.list) return;
            var row = document.createElement('div');
            row.className = 'cm';
            var n = document.createElement('b');
            n.textContent = nick + ': ';
            n.style.color = nickColor(String(nick));
            var t = document.createElement('span');
            t.textContent = text;
            row.appendChild(n); row.appendChild(t);
            chat.list.appendChild(row);
            chat.count++;
            while (chat.list.childNodes.length > 60) chat.list.removeChild(chat.list.firstChild);
            chat.list.scrollTop = chat.list.scrollHeight;
        }
        function chatSend() {
            var v = (chat.input.value || '').replace(/\s+/g, ' ').trim();
            if (!v) return;
            chat.input.value = '';
            if (!ctx.nativeRpc) { chatAdd(chat.myNick || 'Player', v); return; }      // у браузері без сервера — лише локально
            rpc('blox_chat', { text: v }, function (res) {
                if (res && res.success) return;
                var code = res && res.code;
                ctx.toast(T(code === 'rate' ? 'chat_rate' : 'chat_fail'));
            });
        }
        function chatToggle(force) {
            chat.open = force === undefined ? !chat.open : !!force;
            chat.el.classList.toggle('hidden', !chat.open);
            $('chatBtn').classList.toggle('on', chat.open);
            if (!chat.open && chat.input) chat.input.blur();
            if (chat.open) chat.list.scrollTop = chat.list.scrollHeight;
        }
        function initChat() {
            chat.el = $('chatPanel'); chat.list = $('chatList'); chat.input = $('chatInput');
            chat.input.setAttribute('placeholder', T('chat_ph'));
            $('chatBtn').setAttribute('aria-label', T('chat_label'));
            $('chatBtn').addEventListener('click', function () { chatToggle(); });
            chat.input.addEventListener('keydown', function (e) {
                e.stopPropagation();
                if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); chatSend(); chat.input.blur(); }
            });
            chat.input.addEventListener('keyup', function (e) { e.stopPropagation(); });
            ['chatPanel', 'chatBtn'].forEach(function (id) { $(id).addEventListener('pointerdown', function (e) { e.stopPropagation(); }); });
            chat.el.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
            chatToggle(true);
        }

        // ============================================================ КОДОВІ ДВЕРІ НА ВЕРШИНІ
        var door = { start: -1e9, until: -1e9 };               // за годинником пристрою
        var DOOR_ANIM = 900;
        function codeDoorFrac() {
            var t = wallNow();
            if (t < door.start) return 0;
            var up = smooth((t - door.start) / DOOR_ANIM);
            if (t < door.until) return up;
            return up * (1 - smooth((t - door.until) / DOOR_ANIM));
        }
        function onDoor(data) {
            var lag = isFinite(+data.now) ? clamp(serverNowMs() - +data.now, 0, 2500) : 0;
            door.start = wallNow() - lag;
            door.until = door.start + (+data.openMs || 5000);
        }

        var kp = { el: null, code: '', msg: null, disp: null, busy: false, open: false };
        // Лише для автономного режиму (браузер без сервера): код не лежить у відкритому вигляді. Справжній код перевіряє СЕРВЕР (blox_door_code).
        var DJB = 2085877344;
        function djb(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; }
        function kpRender() {
            kp.disp.textContent = kp.code.length ? kp.code.split('').join(' ') : '';
            kp.disp.classList.toggle('empty', !kp.code.length);
        }
        function kpMsg(text, kind) { kp.msg.textContent = text || ''; kp.msg.className = 'kpmsg' + (kind ? ' ' + kind : ''); }
        function kpOpen() {
            if (kp.open) return;
            kp.open = true; kp.code = ''; kpRender(); kpMsg('');
            kp.el.classList.remove('hidden');
            ctx.releaseAll();
        }
        function kpClose() { kp.open = false; kp.el.classList.add('hidden'); kp.busy = false; }
        function kpPress(k) {
            if (kp.busy) return;
            if (k === 'x') { kp.code = kp.code.slice(0, -1); kpRender(); kpMsg(''); return; }         // хрестик — стерти
            if (k === 'v') {                                                                            // галочка — ввести
                if (!kp.code.length) return;
                submitCode();
                return;
            }
            if (kp.code.length >= 8) return;
            kp.code += k; kpRender(); kpMsg('');
        }
        function submitCode() {
            var code = kp.code;
            kp.busy = true;
            var done = function (ok, why) {
                kp.busy = false;
                if (ok) { kpClose(); ctx.toast(T('kp_ok')); return; }
                kp.code = ''; kpRender();
                kpMsg(T(why === 'rate' ? 'kp_locked' : (why === 'timeout' || why === 'net' ? 'chat_fail' : 'kp_wrong')), 'bad');
            };
            if (!ctx.nativeRpc) {                                                  // автономний режим (браузер без сервера): перевірка «на місці»
                var ok = djb(code) === DJB;
                if (ok) { door.start = wallNow(); door.until = door.start + 5000; }
                done(ok, 'bad');
                return;
            }
            rpc('blox_door_code', { code: code }, function (res) {
                if (res && res.success) {
                    if (!(door.until > wallNow())) { door.start = wallNow(); door.until = door.start + (res.openMs || 5000); }   // якщо подія blox_door запізнюється
                    done(true);
                } else done(false, res && res.code === 'rate' ? 'rate' : (res && res.code === 'bad_code' ? 'bad' : (res ? res.code : 'net')));
            });
        }
        function initKeypad() {
            kp.el = $('kpModal'); kp.msg = $('kpMsg'); kp.disp = $('kpDisp');
            $('kpTitle').textContent = T('kp_title');
            $('kpClose').addEventListener('click', kpClose);
            var keys = kp.el.querySelectorAll('[data-k]');
            for (var i = 0; i < keys.length; i++) {
                (function (b) {
                    b.addEventListener('click', function () { kpPress(b.getAttribute('data-k')); });
                })(keys[i]);
            }
            kp.el.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
            window.addEventListener('keydown', function (e) {
                if (!kp.open) return;
                if (e.key >= '0' && e.key <= '9') kpPress(e.key);
                else if (e.key === 'Backspace') kpPress('x');
                else if (e.key === 'Enter') kpPress('v');
                else if (e.key === 'Escape') kpClose();
            });
        }

        // Кнопка дії поруч: «Ввести код» біля панелі, «Запуск» біля червоної кнопки
        var useCtx = null;
        function distXZ(x1, z1, x2, z2) { var dx = x1 - x2, dz = z1 - z2; return Math.sqrt(dx * dx + dz * dz); }
        function nearButton(w) { var b = S.button; return World.inChamber(w.x, w.y, w.z) && distXZ(w.x, w.z, b.x, b.z) < 9; }
        function nearKeypad(w) {
            var k = S.keypad;
            return w.y > S.top - 6 && w.y < S.top + 20 && distXZ(w.x, w.z, k.x - 4, k.z) < 15 && w.x < S.x0 + 2;
        }
        function launch() {
            if (nuke.t0 !== null) return;
            var done = function (res) {
                if (res && res.success) return;
                var code = res && res.code;
                ctx.toast(T(code === 'door_closed' ? 'nuke_door' : (code === 'too_far' ? 'nuke_far' : (code === 'busy' ? 'nuke_busy' : 'nuke_fail'))));
            };
            if (!ctx.nativeRpc) { startNuke(wallNow(), wallNow()); return; }       // автономний режим: запускаємо локально
            rpc('blox_nuke_launch', {}, done);
        }
        function initUse() {
            var b = $('useBtn');
            b.addEventListener('click', function () {
                if (useCtx === 'launch') launch();
                else if (useCtx === 'keypad') kpOpen();
            });
            b.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        }
        function updateUse() {
            var me = ctx.me(), w = me.walker, b = $('useBtn'), want = null;
            if (w && !me.driving && !dead && !inputLocked() && nuke.t0 === null) {
                if (nearButton(w)) want = 'launch';
                else if (nearKeypad(w)) want = 'keypad';
            }
            if (want !== useCtx) {
                useCtx = want;
                b.classList.toggle('show', !!want);
                b.classList.toggle('red', want === 'launch');
                if (want) $('useTxt').textContent = T(want === 'launch' ? 'use_launch' : 'use_code');
            }
            if (kp.open && (!w || me.driving || distXZ(w.x, w.z, S.keypad.x, S.keypad.z) > 30)) kpClose();
        }

        // ============================================================ HP, СМЕРТЬ, ВІДРОДЖЕННЯ
        var hp = 100, lastHit = -1e9, lastCrashAt = -1e9, dead = false, deathT = 0, respawnData = null, respawnAsked = false, hpShown = -1;
        var hpEl = null, hpFill = null, hurtEl = null;
        function initHp() {
            hpEl = $('hp'); hpFill = $('hpFill'); hurtEl = $('hurt');
            hpEl.setAttribute('aria-label', T('hp_label'));
        }
        function renderHp() {
            var v = Math.round(hp);
            if (v === hpShown) return;
            hpShown = v;
            hpFill.style.width = clamp(hp, 0, 100) + '%';
            // чим менше HP — тим червоніший залишок, чим більше — тим зеленіший (0 -> червоний 0°, 100 -> зелений 120°)
            hpFill.style.background = 'hsl(' + Math.round(clamp(hp, 0, 100) * 1.2) + ',82%,46%)';
        }
        // Удар: dv — різниця швидкості в м/с. До 7 м/с (~25 км/год) — без шкоди; сильніший удар знімає більше HP; від ~31 м/с (110 км/год) — смерть
        function crashDamage(dv) { return dv < 7 ? 0 : Math.min(100, (dv - 7) * 4.2); }
        function damage(a, why) {
            if (dead || !(a > 0)) return;
            hp = Math.max(0, hp - a);
            lastHit = wallNow();
            hurtEl.style.opacity = String(clamp(a / 60, 0.15, 0.7));
            setTimeout(function () { hurtEl.style.opacity = '0'; }, 120);
            if (hp <= 0) die(why || 'crash', null);
        }
        function onCarEvents(events) {
            var me = ctx.me();
            if (!me.driving || dead) return;
            var worst = 0;
            for (var i = 0; i < events.length; i++) {
                var e = events[i];
                if (e.t === 'detach' || e.t === 'crush') continue;
                var dv = e.dv || e.v || 0;
                if (dv > worst) worst = dv;
            }
            if (worst > 0) {
                var t = wallNow();
                if (t - lastCrashAt > 300) {
                    var d = crashDamage(worst);
                    if (d > 0) { lastCrashAt = t; damage(d, 'crash'); }
                }
            }
        }
        function die(why, data) {
            if (dead) return;
            dead = true; deathT = 0; hp = 0; respawnData = data || null; respawnAsked = !!data;
            var me = ctx.me();
            if (me.driving) ctx.setDriving(false, true);
            ctx.releaseAll();
            kpClose();
            if (!respawnAsked) {                                                        // сервер має схвалити нове місце, інакше він відкине «телепорт»
                respawnAsked = true;
                rpc('blox_game_respawn', {}, function (res) { if (res && res.success) respawnData = res; });
            }
        }
        function finishRespawn() {
            var s0 = World.spawnPoint();
            var d = respawnData, x = d && isFinite(+d.x) ? +d.x : s0.x, z = d && isFinite(+d.z) ? +d.z : s0.z;
            var y = World.heightAt(x, z) + 0.3;
            ctx.teleport(x, y, z, d && isFinite(+d.ry) ? +d.ry : Math.PI / 2);
            dead = false; hp = 100; hpShown = -1; deathT = 0; respawnData = null; respawnAsked = false;
            ctx.toast(T('respawned'));
        }
        // Меню «Respawn»: HP стає 0, персонаж падає, потім з'являється на майданчику
        function respawnByMenu(data) { if (dead) { if (data) respawnData = data; return; } hp = 0; hpShown = -1; die('respawn', data || {}); respawnAsked = true; }
        function deadPose() {
            if (!dead) return null;
            return { tilt: smooth(deathT / 0.55) };
        }
        function isDead() { return dead; }

        // ============================================================ ЯДЕРНА ПОДІЯ
        var nuke = { t0: null, impacted: false, burn: 0, fx: false, joinedLate: false };
        var summitCine = false;
        function startNuke(t0Server, nowServer) {
            if (isFinite(+nowServer)) syncClock(nowServer);
            nuke = { t0: +t0Server, impacted: false, burn: 0, fx: false, joinedLate: (serverNowMs() - +t0Server) > NT.impact };
            if (nuke.joinedLate) nuke.impacted = true;
            kpClose();
        }
        function endNuke() {
            nuke = { t0: null, impacted: false, burn: 0, fx: false, joinedLate: false };
            World.setLid(0); World.setDoor('summit', codeDoorFrac()); World.setDoor('bunker', 1);
            burnTint = null; ctx.setBurn(0); ctx.setTint(null);
            World.setBombSolid(true);
            sirenStop(true);
            burntCars = {};
            hideBanner();
            document.body.classList.remove('cine');
            flashEl.style.opacity = '0';
        }
        function nukeMs() { return nuke.t0 === null ? -1 : serverNowMs() - nuke.t0; }
        function inputLocked() {
            if (dead) return true;
            if (nuke.t0 === null) return false;
            var ms = nukeMs();
            return ms < NT.cinemaEnd || (ms >= NT.countEnd && ms < NT.impact + 2500);
        }

        var bannerEl = null, bnText = null, bnCount = null, flashEl = null, bannerOn = false, lastCount = -1;
        function initNukeHud() {
            bannerEl = $('nukeBanner'); bnText = $('nbText'); bnCount = $('nbCount'); flashEl = $('flashOv');
        }
        function showBanner(n) {
            if (!bannerOn) { bannerOn = true; bannerEl.classList.add('show'); bnText.textContent = T('nuke_banner'); }
            if (n !== lastCount) { lastCount = n; bnCount.textContent = n + T('nuke_sec'); bnCount.classList.toggle('low', n <= 10); }
        }
        function hideBanner() { if (bannerOn) { bannerOn = false; lastCount = -1; bannerEl.classList.remove('show'); } }

        // Машини, що згоріли (клієнтський прапорець для чорного кольору); мої й чужі
        var burntCars = {};
        function isBurnt(c) { return !!(c && c.burnt); }

        function onImpact() {
            nuke.impacted = true;
            ctx.addShake(3.2);
            boom();
            var me = ctx.me(), w = me.walker, car = me.car;
            if (car && !Nuke.safe(car.x, car.y, car.z) && !car.burnt) throwCar(car);
            if (w && !Nuke.safe(w.x, w.y, w.z) && !dead) { hp = 0; hpShown = -1; die('nuke', null); }
            var rc = ctx.remoteCars();
            for (var id in rc) if (!Nuke.safe(rc[id].x, rc[id].y, rc[id].z)) rc[id].burnt = true;
        }
        // Вибух машини: відлітає на 1-50 студів, кузов зім'ятий, деталі відламані, дальше не їде
        function throwCar(car) {
            var def = Phys.CARS[car.type];
            var th = Nuke.carThrow((car.cid | 0) + ctx.myId() * 7, car.x, car.z), air = 1.1;
            car.burnt = true;
            car.vx = th.dx / air; car.vz = th.dz / air; car.vy = 15;
            car.wx = (Math.random() - 0.5) * 6; car.wy = (Math.random() - 0.5) * 4; car.wz = (Math.random() - 0.5) * 6;
            car.cr = [0.9, 0.85, 0.75, 0.75, 0.7];
            try { Phys.crushHull(car, def); } catch (e) { /* ігноруємо */ }
            var list = def.partList || [];
            for (var i = 0; i < list.length; i++) { try { Phys.detachPart(car, def, list[i], null, 16); } catch (e2) { /* ігноруємо */ } }
        }

        // Усе, що кадр робить з ядерною подією: камера, двері, сирени, HUD
        var lastSnap = null;
        function updateNuke(dt) {
            if (nuke.t0 === null) {
                World.setDoor('summit', codeDoorFrac());
                if (sirenState.on) sirenStop(false);
                return;
            }
            var ms = nukeMs();
            if (ms >= NT.total) { endNuke(); return; }
            var snap = Nuke.snapshot(ms);
            lastSnap = snap;
            World.setLid(snap.lid);
            World.setBombSolid(ms < NT.shotB);
            World.setDoor('summit', Math.max(snap.summitDoor, codeDoorFrac()));
            World.setDoor('bunker', snap.bunkerDoor);
            if (snap.countdown !== null) showBanner(snap.countdown); else hideBanner();
            if (!nuke.impacted && ms >= NT.impact) onImpact();
            // згорілий світ: плавно темнішає за 2 с після вибуху й так само світлішає в кінці
            var burnK = ms < NT.impact ? 0 : Math.min(smooth((ms - NT.impact) / 2000), 1 - smooth((ms - (NT.total - 4000)) / 4000));
            nuke.burn = burnK;
            ctx.setBurn(burnK);
            burnTint = burnK > 0.01 ? [1 - 0.68 * burnK, 1 - 0.72 * burnK, 1 - 0.74 * burnK] : null;
            ctx.setTint(burnTint);
            // сирени: з першої секунди до кінця анімації прильоту, потім затихають
            if (snap.sirens) sirenRun(ms, dt); else if (sirenState.on) sirenStop(false);
            var cine = Nuke.cinemaCamera(ms) || Nuke.inboundCamera(ms);
            document.body.classList.toggle('cine', !!cine);
        }

        // Камера анімації (або null — тоді звичайна)
        var camOut = { eye: [0, 0, 0], at: [0, 0, 0], fov: 1.2, far: 9000 };
        function cameraOverride() {
            if (nuke.t0 === null) return null;
            var ms = nukeMs();
            var c = Nuke.cinemaCamera(ms) || Nuke.inboundCamera(ms);
            if (!c) return null;
            camOut.eye = c.eye; camOut.at = c.at; camOut.fov = c.fov || 1.1;
            // короткий струс при вибуху в кадрі прильоту
            if (ms >= NT.impact && ms < NT.impact + 2500) {
                var k = 1 - (ms - NT.impact) / 2500, t = wallNow() * 0.05;
                camOut.eye = [c.eye[0] + Math.sin(t * 1.7) * 3 * k, c.eye[1] + Math.cos(t * 2.1) * 2.4 * k, c.eye[2] + Math.sin(t * 1.3) * 3 * k];
            }
            return camOut;
        }

        // ============================================================ ЗВУК: сирени й вибух (WebAudio, без файлів)
        var audio = { ac: null, master: null };
        var sirenState = { on: false, o1: null, o2: null, g: null, lp: null, stopAt: 0 };
        function ensureAudio() {
            if (audio.ac) return audio.ac;
            try {
                var AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return null;
                audio.ac = new AC();
                audio.master = audio.ac.createGain();
                audio.master.gain.value = 0.9;
                audio.master.connect(audio.ac.destination);
            } catch (e) { audio.ac = null; }
            return audio.ac;
        }
        function resumeAudio() { var ac = audio.ac; if (ac && ac.state === 'suspended') { try { ac.resume(); } catch (e) { /* ignore */ } } }
        function unlockAudio() { ensureAudio(); resumeAudio(); }
        window.addEventListener('pointerdown', unlockAudio, { passive: true });
        window.addEventListener('keydown', unlockAudio, { passive: true });

        function sirenStart() {
            var ac = ensureAudio();
            if (!ac || sirenState.on) return;
            resumeAudio();
            var o1 = ac.createOscillator(), o2 = ac.createOscillator(), mix = ac.createGain(), g2 = ac.createGain(), lp = ac.createBiquadFilter(), g = ac.createGain();
            var dl = ac.createDelay(1.0), fb = ac.createGain(), wet = ac.createGain();
            o1.type = 'sawtooth'; o2.type = 'square';
            g2.gain.value = 0.35; mix.gain.value = 0.5;
            lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.8;
            g.gain.value = 0.0001;
            dl.delayTime.value = 0.32; fb.gain.value = 0.38; wet.gain.value = 0.3;      // луна: сирена гуляє між будинками
            o1.connect(mix); o2.connect(g2); g2.connect(mix); mix.connect(lp); lp.connect(g);
            g.connect(audio.master);
            g.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(audio.master);
            o1.frequency.value = 300; o2.frequency.value = 301;
            o1.start(); o2.start();
            sirenState = { on: true, o1: o1, o2: o2, g: g, lp: lp, stopAt: 0 };
        }
        // Звук протяжний, «у-у-у-у-у-у-м»: висота повільно росте й спадає (цикл 12 с). Гучність і глухість залежать від положення слухача
        function sirenRun(ms, dt) {
            if (!ctx.nativeRpc && !ctx.standalone) { /* усе одно граємо */ }
            if (!sirenState.on) sirenStart();
            var s = sirenState;
            if (!s.on || !audio.ac) return;
            var ac = audio.ac, now = ac.currentTime;
            var u = ((ms / 12000) % 1 + 1) % 1;
            var f = 300 + 290 * (0.5 - 0.5 * Math.cos(u * Math.PI * 2));
            s.o1.frequency.setTargetAtTime(f, now, 0.08);
            s.o2.frequency.setTargetAtTime(f * 1.004, now, 0.08);
            var me = ctx.me(), w = me.walker, d = w ? Math.sqrt(w.x * w.x + w.z * w.z) : 0;
            var inBunkerClosed = w && Nuke.safe(w.x, w.y, w.z) && World.getDoor('bunker') < 0.5;
            var vol = 0.3 * (1 - 0.65 * smooth((d - 300) / 5000));
            if (inBunkerClosed) vol *= 0.45;
            if (ms > NT.impact) vol *= clamp(1 - (ms - NT.impact) / NT.sirenFade, 0, 1);
            s.g.gain.setTargetAtTime(Math.max(0.0001, vol), now, 0.25);
            s.lp.frequency.setTargetAtTime(inBunkerClosed ? 480 : 1500, now, 0.3);
        }
        function sirenStop(hard) {
            var s = sirenState;
            if (!s.on) return;
            sirenState = { on: false, o1: null, o2: null, g: null, lp: null, stopAt: 0 };
            var ac = audio.ac;
            try {
                var now = ac.currentTime;
                s.g.gain.cancelScheduledValues(now);
                s.g.gain.setTargetAtTime(0.0001, now, hard ? 0.05 : 0.6);
                var end = now + (hard ? 0.4 : 3.5);
                s.o1.stop(end); s.o2.stop(end);
            } catch (e) { /* ігноруємо */ }
        }
        function boom() {
            var ac = ensureAudio();
            if (!ac) return;
            resumeAudio();
            var now = ac.currentTime, len = Math.floor(ac.sampleRate * 3.2);
            var buf = ac.createBuffer(1, len, ac.sampleRate), data = buf.getChannelData(0), seed = 1;
            for (var i = 0; i < len; i++) {
                seed = (seed * 16807) % 2147483647;
                var env = Math.pow(1 - i / len, 2.2);
                data[i] = ((seed / 2147483647) * 2 - 1) * env;
            }
            var src = ac.createBufferSource(); src.buffer = buf;
            var lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2400, now); lp.frequency.exponentialRampToValueAtTime(120, now + 2.8);
            var g = ac.createGain(); g.gain.value = 1.0;
            src.connect(lp); lp.connect(g); g.connect(audio.master);
            var th = ac.createOscillator(), tg = ac.createGain();
            th.type = 'sine'; th.frequency.setValueAtTime(70, now); th.frequency.exponentialRampToValueAtTime(28, now + 2.5);
            tg.gain.setValueAtTime(0.9, now); tg.gain.exponentialRampToValueAtTime(0.001, now + 3);
            th.connect(tg); tg.connect(audio.master);
            src.start(now); th.start(now); th.stop(now + 3.2);
        }

        // ============================================================ МАЛЮВАННЯ
        var sphereMesh = null;
        function sphereGeo() {
            var g = ctx.Models.newGeo();
            ctx.Models.superEllipsoid(g, { n: 2, s: [1, 1, 1], c: [0, 0, 0], color: [1, 1, 1], seg: [18, 12] });
            return g;
        }
        function buildMeshes(renderer) {
            R = renderer;
            var St = ctx.Structures, sm = St.buildSummit(), bk = St.buildBunker(), city = St.buildCity();
            meshes = {
                summit: R.mesh(sm.shell), lidF: R.mesh(sm.lidFront), lidB: R.mesh(sm.lidBack), sdoor: R.mesh(sm.door), button: R.mesh(sm.button), bomb: R.mesh(sm.bomb),
                bunker: R.mesh(bk.shell), bdoor: R.mesh(bk.door), siren: R.mesh(St.buildSiren()),
                cityF: R.mesh(city.facade), cityD: R.mesh(city.detail), sphere: R.mesh(sphereGeo())
            };
            sphereMesh = meshes.sphere;
        }

        var burnTint = null;
        var mat = new Float32Array(16);
        function I() { return M.ident(mat); }

        function drawSphere(x, y, z, r, color, alpha, unlit) {
            M.ident(mat); M.translate(mat, x, y, z); M.scale(mat, r, r, r);
            if (unlit) R.unlit(true);
            R.draw(meshes.sphere, mat, color, alpha, 0);
            if (unlit) R.unlit(false);
        }

        // Бомба: pivotCenter — крутиться навколо центру (політ до майданчика), інакше навколо низу (на вершині)
        function drawBomb(p, pivotCenter, withFlame, ms) {
            M.ident(mat); M.translate(mat, p.x, p.y, p.z); M.rotateY(mat, p.yaw); M.rotateX(mat, p.pitch);
            if (pivotCenter) M.translate(mat, 0, -11, 0);
            R.draw(meshes.bomb, mat, null, 1, 0.5);
            if (!withFlame) return;
            // факел двигуна під хвостом і шлейф диму позаду
            var fl = 0.8 + 0.4 * Math.sin(wallNow() * 0.04);
            var dx = Math.sin(p.pitch) * Math.sin(p.yaw), dy = Math.cos(p.pitch), dz = Math.sin(p.pitch) * Math.cos(p.yaw);   // «вгору» бомби
            var base = pivotCenter ? 11 : 0;
            var tx = p.x - dx * base, ty = p.y - dy * base, tz = p.z - dz * base;
            R.blend(true);
            drawSphere(tx - dx * 4, ty - dy * 4, tz - dz * 4, 4.2 * fl, [3.0, 1.5, 0.35], 0.9, true);
            drawSphere(tx - dx * 8, ty - dy * 8, tz - dz * 8, 3 * fl, [3.0, 2.2, 0.8], 0.75, true);
            for (var k = 1; k <= 12; k++) {
                var q = pivotCenter ? Nuke.inboundPose(ms - k * 160) : Nuke.bombPose(ms - k * 160);
                if (!q.visible || (!pivotCenter && ms - k * 160 < NT.shotB)) break;
                var rr = 3 + k * 1.3;
                drawSphere(q.x - (pivotCenter ? 0 : 0), q.y - 4, q.z, rr, [0.55, 0.55, 0.58], clamp(0.55 - k * 0.04, 0.05, 0.55), false);
            }
            R.blend(false);
        }

        function renderWorld(renderer, eye) {
            if (!meshes) return;
            R = renderer;
            var i, ms = nukeMs(), snap = lastSnap;
            R.checker(false);
            var summitNear = Math.abs(eye.x - S.x0) < 2600 && Math.abs(eye.y - S.top) < 600;
            if (summitNear) {
                R.draw(meshes.summit, I(), burnTint, 1, 0);
                var ang = smooth(World.SUMMIT.lid) * 1.95;
                M.ident(mat); M.translate(mat, S.ch.x0, S.top + S.h, 0); M.rotateZ(mat, ang);
                R.draw(meshes.lidF, mat, burnTint, 1, 0);
                M.ident(mat); M.translate(mat, S.ch.x1, S.top + S.h, 0); M.rotateZ(mat, -ang);
                R.draw(meshes.lidB, mat, burnTint, 1, 0);
                M.ident(mat); M.translate(mat, 0, S.open * S.door.h, 0);
                R.draw(meshes.sdoor, mat, burnTint, 1, 0.3);
                var pushed = 0;
                M.ident(mat); M.translate(mat, S.button.x, S.top + S.button.h + 0.15 - pushed, S.button.z);
                R.draw(meshes.button, mat, [1.25, 1.1, 1.1], 1, 0.6);
                var bp = (ms >= 0 && ms < NT.cinemaEnd) ? Nuke.bombPose(ms) : (ms >= 0 ? { visible: false } : Nuke.bombPose(0));
                if (nuke.t0 === null) bp = Nuke.bombPose(0);
                if (bp.visible) drawBomb(bp, false, ms >= NT.shotB && ms < NT.cinemaEnd, ms);
            }
            // бункер і сирени — навколо майданчика
            if (Math.abs(eye.x) < 3000 && Math.abs(eye.z) < 3000 && eye.y < 700) {
                R.draw(meshes.bunker, I(), burnTint, 1, 0);
                M.ident(mat); M.translate(mat, 0, -BK.doorH * (1 - BK.open), 0);
                R.draw(meshes.bdoor, mat, burnTint, 1, 0.3);
                var burned = nuke.t0 !== null && ms >= NT.impact;
                for (i = 0; i < World.SIRENS.length; i++) {
                    var s = World.SIRENS[i], gy = World.groundHeight(s.x, s.z);
                    M.ident(mat); M.translate(mat, s.x, gy, s.z);
                    if (burned) {                                                             // сирени впали від ударної хвилі
                        var a = Math.atan2(s.z, s.x), k = smooth((ms - NT.impact) / 700);
                        M.rotateY(mat, -a); M.rotateZ(mat, -1.52 * k); M.translate(mat, 0, 0, 0);
                    }
                    R.draw(meshes.siren, mat, burnTint, 1, 0.1);
                }
            }
            // місто: вікна малює шейдер
            var C = World.CITY;
            if (Math.abs(eye.x - C.cx) < 1900 && Math.abs(eye.z - C.cz) < 1900) {
                R.windows(true, C.lobby + 2);
                R.draw(meshes.cityF, I(), burnTint, 1, 0.15);
                R.windows(false);
                R.draw(meshes.cityD, I(), burnTint, 1, 0.1);
            }
            // бомба, що летить до майданчика, — без туману, щоб її було видно здалеку
            if (nuke.t0 !== null && ms >= NT.countEnd && ms < NT.impact) {
                var ip = Nuke.inboundPose(ms);
                R.fogRange(1e7, 2e7);
                drawBomb(ip, true, true, ms);
                R.fogRange(0, 0);
            }
        }

        // Вогняна куля, ударна хвиля, стовп диму — поверх усього
        function renderFx(renderer) {
            if (!meshes || nuke.t0 === null) return;
            R = renderer;
            var ms = nukeMs(), after = ms - NT.impact;
            if (after < 0 || after > 40000) return;
            var fb = Nuke.fireball(after);
            R.blend(true);
            if (fb.a > 0.01) {
                R.fogRange(1e7, 2e7);
                drawSphere(0, 24 + fb.r * 0.35, 0, fb.r, [3.2, 1.35 * (0.5 + fb.a * 0.5), 0.25], fb.a * 0.9, true);
                drawSphere(0, 24 + fb.r * 0.4, 0, fb.r * 0.62, [3.4, 2.4, 0.9], fb.a, true);
                R.fogRange(0, 0);
            }
            var t = after / 1000;
            // стовп диму, що росте й темніє, з «капелюхом» зверху
            for (var k = 0; k < 11; k++) {
                var h = 20 + k * 24 * Math.pow(Math.min(t, 18) / 18, 0.6), r2 = (16 + k * 4) * (0.6 + 0.4 * Math.min(t / 6, 1)) + Math.min(t, 30) * 0.5;
                var al = clamp(0.8 - t / 60, 0.15, 0.8);
                drawSphere(Math.sin(k * 2.1) * 6, h, Math.cos(k * 1.7) * 6, r2, [0.22 + k * 0.01, 0.2, 0.2], al, false);
            }
            var capH = 20 + 11 * 24 * Math.pow(Math.min(t, 18) / 18, 0.6);
            drawSphere(0, capH + 18, 0, 46 + Math.min(t, 18) * 4, [0.3, 0.26, 0.24], clamp(0.85 - t / 60, 0.2, 0.85), false);
            // ударна хвиля по землі
            if (fb.ringA > 0.01) {
                M.ident(mat); M.translate(mat, 0, World.heightAt(0, 0) + 0.4, 0); M.scale(mat, fb.ring, 1, fb.ring);
                R.unlit(true);
                R.draw(R.discMesh, mat, [2.6, 1.6, 0.6], fb.ringA * 0.35, 0);
                R.unlit(false);
            }
            R.blend(false);
            flashEl.style.opacity = String(Nuke.flash(after));
        }

        // ============================================================ ПОДІЇ ВІД СЕРВЕРА
        function onServerEvent(name, d) {
            if (!d) return;
            if (name === 'blox_chat_msg') { chatAdd(String(d.nick || '?'), String(d.text || '')); }
            else if (name === 'blox_door') { if (isFinite(+d.now)) syncClock(d.now); onDoor(d); }
            else if (name === 'blox_nuke') {
                if (d.state === 'launch') startNuke(d.t0, d.now);
                else if (d.state === 'reset') endNuke();
            }
        }
        function onJoin(res) {
            if (!res) return;
            if (isFinite(+res.serverNow)) syncClock(res.serverNow);
            if (res.chat && res.chat.length && chat.list && !chat.list.childNodes.length) {
                for (var i = 0; i < res.chat.length; i++) chatAdd(String(res.chat[i].nick || '?'), String(res.chat[i].text || ''));
            }
            if (res.door && res.door.openMs > 0) onDoor({ openMs: res.door.openMs, now: res.serverNow });
            if (res.nuke && isFinite(+res.nuke.t0)) startNuke(res.nuke.t0, res.serverNow);
        }

        // ============================================================ КАДР
        var ejectCooldown = 0;
        function update(dt) {
            if (!chat.el) return;
            var me = ctx.me(), w = me.walker;
            chat.myNick = ctx.myNick();
            rpcSweep();
            updateNuke(dt);
            if (dead) {
                deathT += dt;
                if (deathT >= 2.2 && (respawnData || deathT > 4.5)) finishRespawn();
            } else if (hp < 100 && wallNow() - lastHit > 5000) {
                hp = Math.min(100, hp + dt * 2);          // повільне відновлення, як у Roblox
            }
            renderHp();
            updateUse();
            // двері зачинились, а хтось лишився в камері: виштовхуємо назовні (інакше він застряг би без коду)
            ejectCooldown -= dt;
            if (ejectCooldown <= 0 && nuke.t0 === null && World.getDoor('summit') < 0.05) {
                if (w && World.inChamber(w.x, w.y, w.z) && !me.driving) {
                    var ex = World.summitExit();
                    ctx.teleport(ex.x, ex.y, ex.z, -Math.PI / 2);
                    ejectCooldown = 1;
                }
                var car = me.car;
                if (car && World.inChamber(car.x, car.y, car.z)) {
                    var ex2 = World.summitExit();
                    car.x = ex2.x - 12; car.z = 0; car.y = ex2.y + 1; car.vx = car.vy = car.vz = 0; car.wx = car.wy = car.wz = 0;
                    if (Phys.syncCOM) Phys.syncCOM(car, Phys.CARS[car.type]);
                    ejectCooldown = 1;
                }
            }
        }

        function init() {
            initChat(); initKeypad(); initUse(); initHp(); initNukeHud();
            renderHp();
        }

        return {
            init: init, buildMeshes: buildMeshes, update: update, renderWorld: renderWorld, renderFx: renderFx, cameraOverride: cameraOverride,
            inputLocked: inputLocked, deadPose: deadPose, isDead: isDead, onCarEvents: onCarEvents, respawnByMenu: respawnByMenu,
            onServerEvent: onServerEvent, onJoin: onJoin, rpcResult: rpcResult, isBurnt: isBurnt, chatToggle: chatToggle,
            // для тестів
            _hp: function () { return hp; }, _damage: damage, _crashDamage: crashDamage, _kpPress: kpPress, _state: function () { return { dead: dead, nuke: nuke, hp: hp }; }
        };
    }

    return { create: create };
});
