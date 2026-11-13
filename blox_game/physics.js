// =====================================================================
// KishkaBlox — фізика персонажа й машин (чиста логіка без WebGL; працює в грі та в тестах Node).
// Залежить від world.js (KishkaWorld). Усі розрахунки йдуть кроками не більше 1/60 с — так персонаж і машина
// не «пролітають» крізь землю навіть на слабкому телефоні з низьким FPS.
//
// Напрямок «уперед» для персонажа й машини при ry: (sin ry, 0, cos ry). Модель дивиться в бік +Z, коли ry = 0.
// Рух рульового: steer > 0 — праворуч (кут ry зменшується), steer < 0 — ліворуч.
// =====================================================================
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./world.js'));
    else root.KishkaPhysics = factory(root.KishkaWorld);
})(typeof self !== 'undefined' ? self : this, function (World) {
    'use strict';

    var WALK = {
        speed: 16,
        jump: 50,
        gravity: 196.2,
        radius: 0.9,
        height: 5,
        maxSlope: 1.35,     // найкрутіший схил, на який можна ступити (~54 градуси)
        snapDown: 1.4       // скільки можна «спуститися» по схилу, не перейшовши в падіння
    };

    // Характеристики машин. Довжина вздовж Z, ширина вздовж X. Ті самі типи дозволені на сервері (blox_game_server.js).
    // Швидкості в студах/с; на спідометрі студ = 1.008 км/год (STUD_TO_KMH), тож 150 студів/с ≈ 151 км/год.
    var CARS = {
        sedan: { len: 11, wid: 5.0, wheelbase: 6.6, track: 4.2, maxFwd: 150, maxRev: 26, accel: 62, accelRev: 28, brake: 110, steerMax: 0.62, wheelR: 0.95, seat: [1.0, 1.2, -0.5], mass: 1.0, gears: 6 },
        van:   { len: 12, wid: 5.2, wheelbase: 7.2, track: 4.4, maxFwd: 118, maxRev: 22, accel: 48, accelRev: 24, brake: 95,  steerMax: 0.55, wheelR: 1.0,  seat: [1.15, 2.0, 2.0], mass: 1.5, gears: 5 },
        truck: { len: 15, wid: 5.6, wheelbase: 9.0, track: 4.6, maxFwd: 96,  maxRev: 18, accel: 36, accelRev: 18, brake: 82,  steerMax: 0.46, wheelR: 1.15, seat: [1.25, 2.6, 4.1], mass: 2.4, gears: 6 }
    };
    var CAR_TYPES = Object.keys(CARS);

    var STUD_TO_KMH = 1.008;   // 1 студ = 0.28 м -> 1 студ/с = 1.008 км/год

    var CAR = {
        gravity: 196.2,
        slopeGravity: 0.25,   // яку частку сили тяжіння відчуває машина на схилі (аркадна модель)
        rolling: 12,          // природне гальмування без газу, студів/с²
        drag: 0.0005,         // опір повітря ~ v²
        maxTilt: 0.6,         // межа нахилу машини (рад) — машина не перевертається
        fallY: -40            // нижче цього — машину повертаємо на землю
    };

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function isNum(v) { return typeof v === 'number' && isFinite(v); }
    function angDiff(from, to) {
        var d = (to - from) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        return d;
    }

    // ------------------------------------------------------------ персонаж
    function createWalker(x, z) {
        var s = World.spawnPoint();
        var px = isNum(x) ? x : s.x, pz = isNum(z) ? z : s.z;
        return { x: px, y: World.heightAt(px, pz), z: pz, ry: 0, vy: 0, onGround: true, speed: 0, a: 0 };
    }

    // input: { mx, mz } — напрямок руху у світі (довжина 0..1), jump — чи тримають стрибок
    function stepWalker(w, input, dt) {
        var mx = input.mx || 0, mz = input.mz || 0;
        var mag = Math.sqrt(mx * mx + mz * mz);
        if (mag > 1) { mx /= mag; mz /= mag; mag = 1; }
        var moving = mag > 0.12;
        var dx = 0, dz = 0;
        if (moving) {
            dx = (mx / mag) * WALK.speed * dt;
            dz = (mz / mag) * WALK.speed * dt;
            var want = Math.atan2(mx, mz);
            w.ry += angDiff(w.ry, want) * Math.min(1, dt * 14);
        }
        var startX = w.x, startZ = w.z;

        if (moving) {
            var tryMove = function (ax, az) {
                var nx = w.x + ax, nz = w.z + az;
                var len = Math.sqrt(ax * ax + az * az) || 1;
                if (w.onGround) {
                    var rise = World.heightAt(nx, nz) - World.heightAt(w.x, w.z);
                    if (rise / len > WALK.maxSlope) return false;
                } else {
                    // У повітрі: не входимо в землю збоку
                    if (World.heightAt(nx, nz) > w.y + 1.6) return false;
                }
                w.x = nx; w.z = nz;
                return true;
            };
            if (!tryMove(dx, dz)) {
                // ковзаємо вздовж схилу: пробуємо кожну вісь окремо
                if (!tryMove(dx, 0)) tryMove(0, dz);
            }
            var c = World.clampToWorld(w.x, w.z, WALK.radius);
            w.x = c.x; w.z = c.z;
            var o = World.resolveObstacles(w.x, w.z, WALK.radius);
            w.x = o.x; w.z = o.z;
        }

        // Стрибок (поки кнопку тримають — стрибає знову, як у Roblox)
        if (input.jump && w.onGround) {
            w.vy = WALK.jump;
            w.onGround = false;
        }

        var ground = World.heightAt(w.x, w.z);
        if (w.onGround) {
            if (w.y - ground <= WALK.snapDown && w.vy <= 0) {
                w.y = ground; // іде по землі або сходить схилом
            } else {
                w.onGround = false;
            }
        }
        if (!w.onGround) {
            w.vy -= WALK.gravity * dt;
            w.y += w.vy * dt;
            if (w.y <= ground && w.vy <= 0) {
                w.y = ground;
                w.vy = 0;
                w.onGround = true;
            }
        }

        // Падіння за межі: повертаємо на майданчик
        if (w.y < -80 || !isNum(w.x) || !isNum(w.y) || !isNum(w.z)) {
            var s = World.spawnPoint();
            w.x = s.x; w.y = s.y + 2; w.z = s.z; w.vy = 0; w.onGround = false;
        }

        var moved = Math.sqrt((w.x - startX) * (w.x - startX) + (w.z - startZ) * (w.z - startZ)) / Math.max(dt, 1e-4);
        w.speed = moving ? Math.min(WALK.speed, moved) : 0;
        w.a = !w.onGround ? 2 : (w.speed > 1 ? 1 : 0);
        return w;
    }

    // ------------------------------------------------------------ машина
    function createCar(type, x, z, ry) {
        var def = CARS[type] || CARS.sedan;
        var px = isNum(x) ? x : 0, pz = isNum(z) ? z : 0;
        var c = {
            type: CARS[type] ? type : 'sedan',
            x: px, y: 0, z: pz, ry: isNum(ry) ? ry : 0,
            pitch: 0, roll: 0, speed: 0, steer: 0, vy: 0, vyG: 0, air: false, wheel: 0, hit: false,
            sy: 0, svy: 0,          // просідання підвіски (пружина): після приземлення кузов «пружинить»
            bump: 0                 // сила останнього зіткнення з іншою машиною (для звуку/діагностики)
        };
        var g = groundSample(def, c);
        c.y = g.y; c.pitch = g.pitch; c.roll = g.roll;
        return c;
    }

    // Висота землі під чотирма колесами й бамперами: середня висота, нахил уперед/назад і вбік.
    // Кузов не опускається нижче землі під бамперами — ніс не «зариється» у початок гірки.
    function groundSample(def, c) {
        var s = Math.sin(c.ry), co = Math.cos(c.ry);
        var hl = def.wheelbase / 2, ht = def.track / 2;
        // перед (fx,fz), задок, праворуч (rx,rz) = (-cos, sin)
        var fx = s * hl, fz = co * hl;
        var rx = -co * ht, rz = s * ht;
        var hFL = World.heightAt(c.x + fx - rx, c.z + fz - rz);
        var hFR = World.heightAt(c.x + fx + rx, c.z + fz + rz);
        var hRL = World.heightAt(c.x - fx - rx, c.z - fz - rz);
        var hRR = World.heightAt(c.x - fx + rx, c.z - fz + rz);
        var front = (hFL + hFR) / 2, rear = (hRL + hRR) / 2;
        var right = (hFR + hRR) / 2, left = (hFL + hRL) / 2;
        var bl = def.len / 2;
        var hFB = World.heightAt(c.x + s * bl, c.z + co * bl);
        var hRB = World.heightAt(c.x - s * bl, c.z - co * bl);
        var y = Math.max((front + rear) / 2, Math.max(hFL, hFR, hRL, hRR) - 0.35, hFB - 1.1, hRB - 1.1);
        return {
            y: y,
            pitch: Math.atan2(front - rear, def.wheelbase),
            roll: Math.atan2(right - left, def.track),
            slope: (front - rear) / def.wheelbase
        };
    }

    // Швидкість для спідометра (км/год) з уздовжньої швидкості машини (студи/с)
    function kmh(speed) {
        return isNum(speed) ? Math.round(Math.abs(speed) * STUD_TO_KMH) : 0;
    }

    // Передача для спідометра: -1 = R (задній хід), 0 = N (стоїть), 1..gears = D1..Dn
    function gearOf(type, speed) {
        var def = CARS[type] || CARS.sedan;
        if (!isNum(speed)) return 0;
        if (speed < -0.8) return -1;
        if (speed < 0.8) return 0;
        var ratio = clamp(speed / def.maxFwd, 0, 1);
        return Math.min(def.gears, 1 + Math.floor(ratio * def.gears * 0.999));
    }

    // Чи перетинаються два орієнтовані прямокутники (кузови машин). Повертає null або { nx, nz, depth }:
    // одиничний напрямок «від іншої машини до першої» і глибина проникнення (метод розділових осей).
    function overlapCars(a, defA, b, defB) {
        var ha = [defA.len * 0.5 * 0.94, defA.wid * 0.5 * 0.94];
        var hb = [defB.len * 0.5 * 0.94, defB.wid * 0.5 * 0.94];
        var axes = [
            [Math.sin(a.ry), Math.cos(a.ry)], [Math.cos(a.ry), -Math.sin(a.ry)],
            [Math.sin(b.ry), Math.cos(b.ry)], [Math.cos(b.ry), -Math.sin(b.ry)]
        ];
        var dx = a.x - b.x, dz = a.z - b.z;
        var best = Infinity, bnx = 0, bnz = 0;
        for (var i = 0; i < 4; i++) {
            var ax = axes[i][0], az = axes[i][1];
            var ra = ha[0] * Math.abs(ax * Math.sin(a.ry) + az * Math.cos(a.ry)) + ha[1] * Math.abs(ax * Math.cos(a.ry) - az * Math.sin(a.ry));
            var rb = hb[0] * Math.abs(ax * Math.sin(b.ry) + az * Math.cos(b.ry)) + hb[1] * Math.abs(ax * Math.cos(b.ry) - az * Math.sin(b.ry));
            var dist = dx * ax + dz * az;
            var overlap = ra + rb - Math.abs(dist);
            if (overlap <= 0) return null;                   // є вісь, що розділяє машини
            if (overlap < best) {
                best = overlap;
                var sg = dist >= 0 ? 1 : -1;
                bnx = ax * sg; bnz = az * sg;
            }
        }
        return { nx: bnx, nz: bnz, depth: best };
    }

    // Зіткнення моєї машини c з іншими машинами (others: [{x,y,z,ry,type,speed}]). Інші машини не рухаємо —
    // вони керуються своїми власниками; кожен відштовхує лише свою. Машини «доторкаються»: відскок за масою,
    // удар гасить швидкість, а позаосьовий удар злегка розвертає.
    function collideCars(c, others) {
        var hit = false;
        if (!others || !others.length) return hit;
        var def = CARS[c.type] || CARS.sedan;
        for (var i = 0; i < others.length; i++) {
            var o = others[i];
            if (!o || !isNum(o.x) || !isNum(o.z) || !isNum(o.ry)) continue;
            var dx0 = o.x - c.x, dz0 = o.z - c.z;
            var far = (def.len + 16);
            if (dx0 * dx0 + dz0 * dz0 > far * far) continue;
            if (isNum(o.y) && Math.abs(o.y - c.y) > 4.5) continue;       // одна над іншою (стрибок) — не стикаються
            var od = CARS[o.type] || CARS.sedan;
            var ov = overlapCars(c, def, o, od);
            if (!ov) continue;
            c.x += ov.nx * (ov.depth + 0.02);
            c.z += ov.nz * (ov.depth + 0.02);
            // швидкості вздовж нормалі
            var vax = Math.sin(c.ry) * c.speed, vaz = Math.cos(c.ry) * c.speed;
            var os = isNum(o.speed) ? o.speed : 0;
            var vbx = Math.sin(o.ry) * os, vbz = Math.cos(o.ry) * os;
            var vrel = (vax - vbx) * ov.nx + (vaz - vbz) * ov.nz;
            if (vrel < 0) {
                var share = od.mass / (def.mass + od.mass);
                var dv = -(1 + 0.25) * vrel * share;
                var nvx = vax + ov.nx * dv, nvz = vaz + ov.nz * dv;
                c.speed = clamp(nvx * Math.sin(c.ry) + nvz * Math.cos(c.ry), -def.maxRev, def.maxFwd);
                var cr = (-dx0) * ov.nz - (-dz0) * ov.nx;                    // де прийшовся удар відносно центру
                c.ry = angDiff(0, c.ry + clamp(cr * Math.abs(vrel) * 0.0011 / Math.max(1, Math.abs(cr) > 0 ? Math.sqrt(dx0 * dx0 + dz0 * dz0) : 1), -0.07, 0.07));
                c.bump = Math.max(c.bump || 0, -vrel);
            }
            hit = true;
        }
        if (hit) c.hit = true;
        return hit;
    }

    // input: { throttle: -1..1 (вперед +), steer: -1..1 (праворуч +) }; others — інші машини для зіткнень
    function stepCar(c, input, dt, others) {
        var def = CARS[c.type] || CARS.sedan;
        var th = clamp(isNum(input.throttle) ? input.throttle : 0, -1, 1);
        var st = clamp(isNum(input.steer) ? input.steer : 0, -1, 1);
        var g = groundSample(def, c);
        var G = CAR.gravity;

        // --- уздовжня швидкість (у польоті двигун і гальма не діють — лише опір повітря)
        var a = 0;
        if (!c.air) {
            if (th > 0.05) {
                if (c.speed >= 0) a = def.accel * th * clamp(1 - c.speed / def.maxFwd, 0, 1);
                else a = def.brake * th;                 // їхали назад — спершу гальмуємо
            } else if (th < -0.05) {
                if (c.speed <= 0) a = -def.accelRev * (-th) * clamp(1 + c.speed / def.maxRev, 0, 1);
                else a = -def.brake * (-th);
            } else {
                var roll = CAR.rolling * dt;
                if (Math.abs(c.speed) <= roll) c.speed = 0;
                else c.speed -= Math.sign(c.speed) * roll;
            }
            // схил: вгору важче, вниз легше
            a -= G * CAR.slopeGravity * g.slope / Math.sqrt(1 + g.slope * g.slope);
        }
        a -= Math.sign(c.speed) * CAR.drag * c.speed * c.speed;
        c.speed = clamp(c.speed + a * dt, -def.maxRev, def.maxFwd * 1.25);

        // --- поворот: чим швидше, тим менший кут керма; на місці не повертає; у польоті майже не керується
        var steerTarget = st * def.steerMax * (1 - 0.65 * Math.min(1, Math.abs(c.speed) / def.maxFwd));
        if (c.air) steerTarget *= 0.15;
        c.steer += (steerTarget - c.steer) * Math.min(1, dt * 9);
        c.ry -= (c.speed / def.wheelbase) * Math.tan(c.steer) * dt;
        c.ry = angDiff(0, c.ry);

        // --- рух по землі
        var ox = c.x, oz = c.z;
        c.x += Math.sin(c.ry) * c.speed * dt;
        c.z += Math.cos(c.ry) * c.speed * dt;

        // --- межі світу, перешкоди й інші машини
        c.hit = false;
        var cl = World.clampToWorld(c.x, c.z, def.len / 2);
        if (cl.hit) { c.x = cl.x; c.z = cl.z; c.speed *= 0.5; c.hit = true; }
        var rad = def.wid * 0.5;
        var offs = [-def.len / 3, 0, def.len / 3];
        for (var i = 0; i < offs.length; i++) {
            var cx = c.x + Math.sin(c.ry) * offs[i], cz = c.z + Math.cos(c.ry) * offs[i];
            var r = World.resolveObstacles(cx, cz, rad);
            if (r.hit) {
                c.x += r.x - cx; c.z += r.z - cz;
                c.speed *= 0.35;
                c.hit = true;
            }
        }
        collideCars(c, others);
        if (c.hit && Math.abs(c.speed) < 1) c.speed = 0;
        // Занадто крутий схил (стіна): не пускаємо
        var g2 = groundSample(def, c);
        if (Math.abs(g2.slope) > 1.0 && Math.abs(g2.slope) > Math.abs(g.slope) && !c.air) {
            c.x = ox; c.z = oz; c.speed = 0; c.hit = true;
            g2 = groundSample(def, c);
        }

        // --- вертикаль: їде по землі; якщо земля йде вниз швидше, ніж тягне гравітація, — відривається (політ)
        var targetY = g2.y;
        var prevY = c.y;
        if (!c.air) {
            var yBal = prevY + c.vyG * dt - 0.5 * G * dt * dt;          // де була б машина, якби летіла за інерцією
            if (yBal > targetY + 0.15 && Math.abs(c.speed) > 6) {
                c.air = true;
                c.vy = c.vyG - G * dt;
                c.y = prevY + c.vy * dt;
                if (c.y <= targetY) { c.y = targetY; c.vy = 0; c.air = false; }
            } else {
                c.y = targetY;
            }
        } else {
            c.vy -= G * dt;
            c.y += c.vy * dt;
            if (c.y <= targetY) {
                var impact = -c.vy;
                c.y = targetY;
                c.vy = 0;
                c.air = false;
                if (impact > 20) {                                      // приземлення: кузов просідає на підвісці й пружинить
                    c.sy = -Math.min(0.9, impact * 0.012);
                    c.svy = 0;
                }
            }
        }
        if (!c.air) {
            var vg = clamp((c.y - prevY) / Math.max(dt, 1e-4), -250, 250);
            c.vyG += (vg - c.vyG) * 0.6;
        } else {
            c.vyG = c.vy;
        }
        // підвіска: пружина з демпфером
        c.svy += (-90 * c.sy - 14 * c.svy) * dt;
        c.sy += c.svy * dt;
        if (c.sy > 0.4) c.sy = 0.4;
        if (c.sy < -1) c.sy = -1;

        // нахил кузова: по землі — за землею; у польоті — за траєкторією (ніс піднятий на підйомі, опущений на спуску)
        var k = Math.min(1, dt * 10);
        var pitchT = g2.pitch, rollT = g2.roll;
        if (c.air) {
            pitchT = Math.atan2(c.vy, Math.max(12, Math.abs(c.speed))) * (c.speed >= 0 ? 1 : -1);
            rollT = 0;
            k = Math.min(1, dt * 4);
        }
        c.pitch += (clamp(pitchT, -CAR.maxTilt, CAR.maxTilt) - c.pitch) * k;
        c.roll += (clamp(rollT, -CAR.maxTilt, CAR.maxTilt) - c.roll) * k;
        c.wheel += (c.speed * dt) / def.wheelR;
        if (c.bump > 0) c.bump = Math.max(0, c.bump - dt * 60);

        // --- повернення в коректний стан
        if (c.y < CAR.fallY || !isNum(c.x) || !isNum(c.y) || !isNum(c.z) || !isNum(c.ry)) resetCar(c);
        return c;
    }

    // Ставить машину на землю біля майданчика, нульова швидкість
    function resetCar(c) {
        var s = World.spawnPoint();
        c.x = s.x + 14; c.z = s.z; c.ry = Math.PI / 2;
        c.speed = 0; c.steer = 0; c.vy = 0; c.vyG = 0; c.air = false; c.sy = 0; c.svy = 0; c.bump = 0;
        var g = groundSample(CARS[c.type] || CARS.sedan, c);
        c.y = g.y; c.pitch = 0; c.roll = 0;
        return c;
    }

    // Кадр з кроками не більше 1/60 с
    function stepMany(dt, fn) {
        var d = Math.min(dt, 0.1);
        var steps = Math.max(1, Math.ceil(d / (1 / 60)));
        var h = d / steps;
        for (var i = 0; i < steps; i++) fn(h);
    }

    // Місце для нової машини перед гравцем (не всередині перешкоди)
    function spawnSpot(px, pz, ry, type) {
        var def = CARS[type] || CARS.sedan;
        var dist = def.len / 2 + 4;
        var x = px + Math.sin(ry) * dist, z = pz + Math.cos(ry) * dist;
        var cl = World.clampToWorld(x, z, def.len / 2 + 2);
        x = cl.x; z = cl.z;
        for (var i = 0; i < 6; i++) {
            var r = World.resolveObstacles(x, z, def.len / 2);
            if (!r.hit) break;
            x = r.x; z = r.z;
        }
        var g = groundSample(def, { x: x, z: z, ry: ry });
        return { x: x, y: g.y, z: z, ry: ry };
    }

    return {
        WALK: WALK, CARS: CARS, CAR_TYPES: CAR_TYPES, CAR: CAR,
        createWalker: createWalker, stepWalker: stepWalker,
        createCar: createCar, stepCar: stepCar, resetCar: resetCar, groundSample: groundSample,
        collideCars: collideCars, overlapCars: overlapCars, kmh: kmh, gearOf: gearOf, STUD_TO_KMH: STUD_TO_KMH,
        spawnSpot: spawnSpot, stepMany: stepMany, angDiff: angDiff
    };
});
