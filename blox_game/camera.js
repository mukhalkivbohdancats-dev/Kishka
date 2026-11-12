// =====================================================================
// KishkaBlox — керування камерою (чиста логіка, перевіряється тестами Node).
//
// Звичне керування «як у шутері/Roblox»: камера дивиться туди, куди рухається палець.
//   • палець угору  -> камера повертається вгору (погляд піднімається);
//   • палець униз   -> камера повертається вниз (погляд опускається);
//   • палець праворуч -> камера повертається праворуч; ліворуч -> ліворуч.
// Налаштування «Інверсія камери» міняє ЛИШЕ вертикаль (за замовчуванням вимкнено).
//
// pitch — висота камери над точкою погляду: > 0 камера вище й дивиться вниз, < 0 камера нижче й дивиться вгору.
// Камера крутиться навколо гравця (орбіта) на відстані dist; yaw — кут навколо вертикальної осі.
// Положення камери в світі: target + (sin(yaw)·cos(pitch), sin(pitch), cos(yaw)·cos(pitch)) · dist.
// =====================================================================
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.KishkaCamera = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var LIMITS = {
        pitchMin: -0.35,      // камера трохи нижче голови: погляд угору
        pitchMax: 1.3,        // майже зверху, але менше за PI/2 — камера не перевертається
        distMin: 0.5,
        distMax: 80,
        clearance: 0.8        // мінімальна висота камери над землею
    };
    var SENS = { yaw: 0.0055, pitch: 0.0045 };
    var MAX_JUMP_PX = 250;    // один «стрибок» пальця більший за це — збій сенсора, ігноруємо

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function isNum(v) { return typeof v === 'number' && isFinite(v); }

    function create(opts) {
        var o = opts || {};
        return {
            yaw: isNum(o.yaw) ? o.yaw : 0,
            pitch: clamp(isNum(o.pitch) ? o.pitch : 0.35, LIMITS.pitchMin, LIMITS.pitchMax),
            dist: clamp(isNum(o.dist) ? o.dist : 14, LIMITS.distMin, LIMITS.distMax),
            invert: !!o.invert,
            eyeDist: isNum(o.dist) ? o.dist : 14   // фактична відстань після перевірки землі
        };
    }

    // Рух пальця на (dx, dy) пікселів екрана (dy < 0 — палець пішов угору)
    function drag(cam, dx, dy) {
        if (!isNum(dx) || !isNum(dy)) return cam;
        if (Math.abs(dx) > MAX_JUMP_PX || Math.abs(dy) > MAX_JUMP_PX) return cam;
        // праворуч -> камера повертається праворуч (yaw зменшується)
        cam.yaw -= dx * SENS.yaw;
        // угору (dy < 0) -> погляд угору -> камера опускається (pitch зменшується); інверсія — навпаки
        var sign = cam.invert ? -1 : 1;
        cam.pitch = clamp(cam.pitch + sign * dy * SENS.pitch, LIMITS.pitchMin, LIMITS.pitchMax);
        // yaw тримаємо в межах -PI..PI, щоб число не росло безкінечно
        var TWO = Math.PI * 2;
        cam.yaw = cam.yaw - TWO * Math.round(cam.yaw / TWO);
        return cam;
    }

    // Щипок двома пальцями: prevDist/curDist — відстань між пальцями до й після руху
    function pinch(cam, prevDist, curDist) {
        if (!(prevDist > 0) || !(curDist > 0)) return cam;
        cam.dist = clamp(cam.dist * (prevDist / curDist), LIMITS.distMin, LIMITS.distMax);
        return cam;
    }

    function wheel(cam, deltaY) {
        if (!isNum(deltaY)) return cam;
        cam.dist = clamp(cam.dist * (1 + deltaY * 0.001), LIMITS.distMin, LIMITS.distMax);
        return cam;
    }

    // Плавно повертає камеру за машину (коли гравець рулить, а палець не на екрані)
    function followYaw(cam, targetYaw, dt, strength) {
        var d = (targetYaw - cam.yaw) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        cam.yaw += d * Math.min(1, dt * (strength || 1.6));
        return cam;
    }

    // Положення камери. target — {x,y,z} точка погляду; groundAt(x,z) — висота землі (або null).
    // Камера не заходить під землю й не провалюється в пагорб: уздовж променя до гравця відстань скорочується.
    function eye(cam, target, groundAt, out) {
        out = out || { x: 0, y: 0, z: 0, dist: 0 };
        var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
        var dx = Math.sin(cam.yaw) * cp, dy = sp, dz = Math.cos(cam.yaw) * cp;
        var dist = cam.dist;
        if (typeof groundAt === 'function') {
            // від гравця до бажаної позиції: шукаємо першу точку, де камера була б під землею
            var steps = 14;
            for (var i = 1; i <= steps; i++) {
                var t = (i / steps) * cam.dist;
                var gx = target.x + dx * t, gz = target.z + dz * t;
                var gy = target.y + dy * t;
                if (gy < groundAt(gx, gz) + LIMITS.clearance) {
                    dist = Math.max(LIMITS.distMin, ((i - 1) / steps) * cam.dist);
                    break;
                }
            }
        }
        // М'яке змінення відстані, щоб камера не смикалась на межі
        var k = dist < cam.eyeDist ? 0.5 : 0.12;
        cam.eyeDist += (dist - cam.eyeDist) * k;
        if (cam.eyeDist > cam.dist) cam.eyeDist = cam.dist;
        dist = cam.eyeDist;
        out.x = target.x + dx * dist;
        out.y = target.y + dy * dist;
        out.z = target.z + dz * dist;
        if (typeof groundAt === 'function') {
            var minY = groundAt(out.x, out.z) + LIMITS.clearance;
            if (out.y < minY) out.y = minY;   // остання страховка: ніколи під землею
        }
        out.dist = dist;
        return out;
    }

    return { LIMITS: LIMITS, SENS: SENS, create: create, drag: drag, pinch: pinch, wheel: wheel, followYaw: followYaw, eye: eye };
});
