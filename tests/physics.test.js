// Fysikktester for brettene. Kjør med: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const physics = require('../physics');

const MACHINES = path.join(__dirname, '..', 'public', 'machines');
const boards = fs.readdirSync(MACHINES)
    .filter(id => fs.existsSync(path.join(MACHINES, id, 'board.json')))
    .map(id => ({ id, board: JSON.parse(fs.readFileSync(path.join(MACHINES, id, 'board.json'), 'utf8')) }));

const ball = physics.ball;

// Fast "tilfeldig" tallrekke, så testene gir samme resultat hver gang
function seeded(seed) {
    return () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    };
}

function place(x, y, vx, vy) {
    ball.ready = false;
    Object.assign(ball, { x, y, vx, vy });
}

// Kjører til en hendelse dukker opp (eller maks antall ticks); returnerer alle hendelser samlet
function runUntil(check, maxTicks = 120) {
    for (let t = 0; t < maxTicks; t++) {
        const ev = physics.step();
        if (check(ev)) return ev;
    }
    return null;
}

// Plasserer ballen foran midten av et linjestykke, på siden som vender mot midten av brettet,
// og skyter den rett mot det
function shootAtSegment(s, speed = 8) {
    const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    let nx = -(s.y2 - s.y1) / len, ny = (s.x2 - s.x1) / len;
    if (nx * (350 - mx) + ny * (700 - my) < 0) { nx = -nx; ny = -ny; }
    place(mx + nx * 30, my + ny * 30, -nx * speed, -ny * speed);
}

for (const { id, board } of boards) {
    test(`${id}: ballen kommer inn på brettet ved svak, middels og full oppskyting`, () => {
        for (const power of [0, 0.5, 1]) {
            physics.loadBoard(board);
            physics.launch(power);
            const ok = runUntil(() => ball.x < 600 && ball.y < 600, 240);
            assert.ok(ok, `kraft ${power}: ballen kom seg ikke ut av kanalen`);
        }
    });

    test(`${id}: enveisporten slipper ballen ut av kanalen, men ikke inn igjen`, () => {
        physics.loadBoard(board);
        place(600, 190, 7, -1);                       // fra spillefeltet mot kanalen
        runUntil(() => false, 40);
        assert.ok(ball.x < 620, 'ballen kom seg inn i kanalen fra spillefeltet');
        place(640, 160, -7, -1);                      // fra kanalen ut mot spillefeltet
        assert.ok(runUntil(() => ball.x < 590, 40), 'ballen slapp ikke ut av kanalen');
    });

    test(`${id}: alle drop targets kan treffes, og en full rad tenner kickback`, () => {
        physics.loadBoard(board);
        physics.dropBanks.forEach((bank, bi) => {
            bank.targets.forEach((t, ti) => {
                shootAtSegment(t);
                const ev = runUntil(e => e.drops.length > 0, 30);
                assert.ok(ev, `drop target ${bi}/${ti} ble ikke slått ned`);
                assert.deepStrictEqual(ev.drops[0], { bank: bi, target: ti });
                if (ti === bank.targets.length - 1) assert.deepStrictEqual(ev.dropsComplete, [bi]);
            });
        });
        if (physics.dropBanks.length && physics.layout.kickbacks.length) {
            assert.ok(physics.tableState().kickbacks.every(Boolean), 'kickback ble ikke tent');
        }
    });

    test(`${id}: drop targets spretter opp igjen etter en stund`, () => {
        physics.loadBoard(board);
        physics.dropBanks[0].targets.forEach(t => { shootAtSegment(t); runUntil(e => e.drops.length > 0, 30); });
        place(350, 150, 0, 0); // ballen langt unna
        runUntil(() => false, 100);
        assert.ok(physics.tableState().drops[0].every(Boolean));
    });

    test(`${id}: standup targets gir treff`, () => {
        physics.loadBoard(board);
        physics.standups.forEach((s, i) => {
            shootAtSegment(s);
            const ev = runUntil(e => e.standups.length > 0, 30);
            assert.ok(ev && ev.standups[0] === i, `standup ${i} ga ikke treff`);
        });
    });

    test(`${id}: rollovers tennes, og alle tent gir "complete"`, () => {
        physics.loadBoard(board);
        const n = physics.rollovers.length;
        assert.ok(n > 0);
        let complete = false;
        physics.rollovers.forEach((r, i) => {
            place(r.x, r.y - 40, 0, 2);
            const ev = runUntil(e => e.rollovers.length > 0, 60);
            assert.ok(ev && ev.rollovers[0] === i, `rollover ${i} reagerte ikke`);
            complete = complete || ev.rolloversComplete;
        });
        assert.ok(complete, 'alle rollovers tent ga ikke "complete"');
    });

    test(`${id}: lane change flytter de tente lysene`, () => {
        physics.loadBoard(board);
        physics.rollovers[0].lit = true;
        physics.rotateRollovers(1);
        assert.deepStrictEqual(physics.tableState().rollovers, [false, true, false]);
        physics.rotateRollovers(-1);
        assert.deepStrictEqual(physics.tableState().rollovers, [true, false, false]);
    });

    test(`${id}: kickback redder ballen i outlanen bare når den er tent`, () => {
        physics.loadBoard(board);
        for (const k of physics.layout.kickbacks) {
            const x = k.side === 'left' ? 100 : 600;
            // Ikke tent: ballen går i avløpet
            physics.resetTable();
            place(x, 980, 0, 3);
            assert.ok(runUntil(e => e.drained, 300), 'ballen drainet ikke uten kickback');
            // Tent: ballen slås opp igjen
            physics.dropBanks.forEach(b => b.targets.forEach(t => { shootAtSegment(t); runUntil(e => e.drops.length > 0, 30); }));
            place(x, 980, 0, 3);
            const ev = runUntil(e => e.kickback || e.drained, 300);
            assert.ok(ev && ev.kickback, `kickback (${k.side}) slo ikke ballen opp`);
            assert.ok(ball.vy < 0);
        }
    });

    test(`${id}: ballen blir ikke sittende fast (30 min simulert spill)`, () => {
        physics.loadBoard(board);
        const rnd = seeded(id.length * 7919);
        let still = 0, drains = 0, events = 0;
        let nextLeft = 0, nextRight = 0;
        for (let t = 0; t < 60 * 60 * 30; t++) {
            if (ball.ready) physics.launch(rnd());
            // Flipperne trykkes når ballen er nær dem, med litt tilfeldig timing
            const near = ball.y > 1000 && ball.y < 1110;
            if (t >= nextLeft) { physics.setFlipper('left', near && ball.x < 350 && rnd() < 0.5); nextLeft = t + 6 + Math.floor(rnd() * 10); }
            if (t >= nextRight) { physics.setFlipper('right', near && ball.x >= 350 && rnd() < 0.5); nextRight = t + 6 + Math.floor(rnd() * 10); }
            const ev = physics.step();
            drains += ev.drained;
            events += ev.hits.length + ev.drops.length + ev.standups.length + ev.rollovers.length;
            // "Fast": nesten stillestående i 5 sekunder et sted som ikke er kanalen eller flipperne
            const speed = Math.hypot(ball.vx, ball.vy);
            if (!ball.ready && speed < 0.15 && ball.y < 1040) still++; else still = 0;
            assert.ok(still < 300, `ballen står fast ved (${ball.x.toFixed(0)}, ${ball.y.toFixed(0)}) etter ${(t / 60).toFixed(0)} s`);
        }
        assert.ok(drains > 20, `for få drains (${drains}) – noe holder ballen igjen`);
        assert.ok(events > 200, `for få treff (${events})`);
    });
}
