try { require('dotenv').config(); } catch (err) { /* dotenv ikke installert – OK */ }
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const physics = require('./physics');
const { createHighScores } = require('./highscores');
const { createRules } = require('./rules');
const { createBoardStore, cleanBoard } = require('./boards');
const { createMachineStore, makeMachineId } = require('./custommachines');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// physics.js og rules.js brukes også i nettleseren (redigering.html: "Prøv brettet"),
// pakket inn så de virker uten Node: window.PinballPhysics / window.PinballRules
for (const [file, name] of [['physics.js', 'PinballPhysics'], ['rules.js', 'PinballRules']]) {
    app.get('/engine/' + file, (req, res) => {
        const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
        res.type('application/javascript').send(`(function () {\nvar module = { exports: {} };\n${code}\nwindow.${name} = module.exports;\n})();\n`);
    });
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '200kb' }));

const BALLS_PER_GAME = 3;

// Maskinene finnes som mapper i public/machines/<id>/ med machine.json (navn, farger …)
// theme.js (utseende og lyd) og board.json (hindre, poenggivere og regler). Flippere, kanal og
// yttervegger er like for alle. Bare ett fysisk brett: det bytter til maskinen til den som har tur.
const MACHINES_DIR = path.join(__dirname, 'public', 'machines');
const machines = loadMachines();
const DEFAULT_MACHINE = machines[0].id;

function loadMachines() {
    const list = [];
    for (const id of fs.readdirSync(MACHINES_DIR)) {
        if (!/^[a-z0-9-]+$/.test(id)) continue;
        try {
            const dir = path.join(MACHINES_DIR, id);
            const info = JSON.parse(fs.readFileSync(path.join(dir, 'machine.json'), 'utf8'));
            const boardFile = path.join(dir, 'board.json');
            const board = fs.existsSync(boardFile) ? JSON.parse(fs.readFileSync(boardFile, 'utf8')) : {};
            list.push({ id, name: info.name || id, tagline: info.tagline || '', icon: info.icon || '🎰',
                order: info.order || 99, colors: info.colors || {}, board, theme: id, custom: false, published: true });
        } catch (e) {
            console.error(`Hopper over maskin "${id}":`, e.message);
        }
    }
    if (!list.length) throw new Error('Fant ingen maskiner i ' + MACHINES_DIR);
    return list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

// Bare publiserte maskiner kan velges av spillerne (egne maskiner er utkast til de publiseres)
function validMachine(id) {
    return machines.some(m => m.id === id && m.published) ? id : null;
}

// Egne maskiner fra redigeringen legges til etter de innebygde
const machineStore = createMachineStore({
    file: process.env.CUSTOM_MACHINES_FILE || path.join(__dirname, 'custom-machines.json'),
});
function addCustomMachine(c, i) {
    machines.push({ id: c.id, name: c.name, tagline: c.tagline || '', icon: c.icon || '🎰', order: 100 + i,
        colors: c.colors || {}, board: c.board || {}, theme: c.theme, custom: true, published: !!c.published });
}

const rules = createRules(physics);
let boardMachine = null; // maskinen hvis brett er lastet inn i fysikken

// Brett lagret fra redigeringen overstyrer standardbrettet (board.json)
const boardStore = createBoardStore({
    machineIds: machines.map(m => m.id),
    file: process.env.BOARDS_FILE || path.join(__dirname, 'saved-boards.json'),
});

function effectiveBoard(id) {
    const saved = boardStore.get(id);
    if (saved && !saved.board._standard) return saved.board;
    return machines.find(m => m.id === id).board;
}

// Laster maskinens brett inn i fysikken (når det er en annen maskin enn sist, eller force)
function useBoard(id, force) {
    if (id === boardMachine && !force) return;
    const board = effectiveBoard(id);
    physics.loadBoard(board);
    rules.setBoardRules(board.rules);
    boardMachine = id;
    io.emit('layout', physics.layout);
}

// Et nylig lagret brett tas i bruk med en gang hvis ingen spiller, ellers ved neste tur
function applySavedBoard(id) {
    if (id === game.machine && !game.playerId) useBoard(id, true);
}

/* ── API for redigeringen ── */
const machineOr404 = (req, res) => {
    const m = machines.find(x => x.id === req.params.id);
    if (!m) res.status(404).json({ error: 'Ukjent maskin' });
    return m;
};
async function boardInfo(id) {
    const saved = boardStore.get(id);
    return {
        board: effectiveBoard(id),
        standard: machines.find(m => m.id === id).board,
        saved: !!(saved && !saved.board._standard),
        savedAt: saved ? saved.savedAt : null,
        versions: await boardStore.count(id),
    };
}
app.get('/api/maskiner', (req, res) => {
    res.json(machines.map(m => ({ id: m.id, name: m.name, icon: m.icon, tagline: m.tagline, colors: m.colors,
        theme: m.theme, custom: m.custom, published: m.published })));
});

const cleanText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const cleanColor = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null);

// Ny maskin: { name, icon, tagline, theme (innebygd maskin-id), copyFrom (maskin-id eller tom) }
app.post('/api/maskiner', async (req, res) => {
    const b = req.body || {};
    const name = cleanText(b.name, 24);
    if (!name) return res.status(400).json({ error: 'Maskinen må ha et navn' });
    if (machines.filter(m => m.custom).length >= 30) return res.status(400).json({ error: 'Maks 30 egne maskiner' });
    const base = machines.find(m => m.id === b.theme && !m.custom);
    if (!base) return res.status(400).json({ error: 'Ukjent utseende' });
    const from = machines.find(m => m.id === b.copyFrom);
    const board = from ? JSON.parse(JSON.stringify(effectiveBoard(from.id)))
        : { slingshots: base.board.slingshots || [], walls: (base.board.walls || []).filter(w => /toppkile/.test(w._info || '')) };
    const c = {
        id: makeMachineId(name, machines.map(m => m.id)),
        name, icon: cleanText(b.icon, 8) || base.icon, tagline: cleanText(b.tagline, 60),
        theme: base.id, colors: { ...base.colors }, board: cleanBoard(board), published: false,
    };
    try {
        await machineStore.add(c);
        addCustomMachine(c, machines.filter(m => m.custom).length);
        await highScores.ensure(c.id);
        await boardStore.ensure(c.id);
        res.json({ id: c.id });
    } catch (err) {
        res.status(500).json({ error: 'Kunne ikke lagre maskinen: ' + err.message });
    }
});

// Endre egen maskin: navn, ikon, slagord, farger, publisert
app.post('/api/maskiner/:id', async (req, res) => {
    const m = machines.find(x => x.id === req.params.id);
    if (!m) return res.status(404).json({ error: 'Ukjent maskin' });
    if (!m.custom) return res.status(400).json({ error: 'De innebygde maskinene endres i koden' });
    const b = req.body || {}, changes = {};
    if (b.name !== undefined) { changes.name = cleanText(b.name, 24); if (!changes.name) return res.status(400).json({ error: 'Maskinen må ha et navn' }); }
    if (b.icon !== undefined) changes.icon = cleanText(b.icon, 8) || m.icon;
    if (b.tagline !== undefined) changes.tagline = cleanText(b.tagline, 60);
    if (b.colors && typeof b.colors === 'object') {
        changes.colors = { ...m.colors };
        for (const k of ['bg', 'bg2', 'accent', 'text']) if (cleanColor(b.colors[k])) changes.colors[k] = b.colors[k];
    }
    if (b.published !== undefined) {
        changes.published = !!b.published;
        if (!changes.published && (game.machine === m.id && game.playerId)) return res.status(409).json({ error: 'Maskinen er i bruk akkurat nå' });
    }
    try {
        await machineStore.update(m.id, changes);
        Object.assign(m, changes);
        // Skjult maskin: spillere i kø for den flyttes til standardmaskinen
        if (!m.published) for (const p of Object.values(players)) if (p.machine === m.id) p.machine = DEFAULT_MACHINE;
        io.emit('machines', machineList());
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/maskiner/:id', async (req, res) => {
    const m = machines.find(x => x.id === req.params.id);
    if (!m) return res.status(404).json({ error: 'Ukjent maskin' });
    if (!m.custom) return res.status(400).json({ error: 'De innebygde maskinene kan ikke slettes' });
    if (game.machine === m.id && game.playerId) return res.status(409).json({ error: 'Maskinen er i bruk akkurat nå' });
    try {
        await machineStore.remove(m.id);
        await boardStore.removeAll(m.id);
        machines.splice(machines.indexOf(m), 1);
        for (const p of Object.values(players)) if (p.machine === m.id) p.machine = DEFAULT_MACHINE;
        if (game.machine === m.id) { game.machine = DEFAULT_MACHINE; useBoard(DEFAULT_MACHINE, true); }
        io.emit('machines', machineList());
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/brett/:id', async (req, res) => {
    if (!machineOr404(req, res)) return;
    res.json(await boardInfo(req.params.id));
});
app.post('/api/brett/:id', async (req, res) => {
    if (!machineOr404(req, res)) return;
    let board;
    try {
        board = cleanBoard(req.body);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    try {
        await boardStore.save(req.params.id, board);
        applySavedBoard(req.params.id);
        res.json(await boardInfo(req.params.id));
    } catch (err) {
        res.status(500).json({ error: 'Kunne ikke lagre: ' + err.message });
    }
});
for (const [route, action] of [['angre', 'undo'], ['standard', 'reset']]) {
    app.post(`/api/brett/:id/${route}`, async (req, res) => {
        if (!machineOr404(req, res)) return;
        try {
            await boardStore[action](req.params.id);
            applySavedBoard(req.params.id);
            res.json(await boardInfo(req.params.id));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
}
const LAUNCH_TIMEOUT_MS = 30000;   // så lenge ballen kan ligge klar før turen går videre
const RECONNECT_GRACE_MS = 30000;  // så lenge en frakoblet spiller beholder plassen sin

// Spillere identifiseres med en fast klient-id fra mobilens localStorage, så de beholder
// plass og poeng om skjermen låses eller nettet faller ut et øyeblikk. Klient-id-en fungerer
// som innloggingsnøkkel og sendes aldri ut; andre klienter ser bare den offentlige id-en.
let players = {};    // klient-id -> { id (offentlig), name, machine, socketId, disconnectedAt }
let scores = {};     // offentlig id -> poeng i nåværende spill
let queue = [];      // klient-id-er i turrekkefølge; queue[0] har tur
let game = { playerId: null, ballsLeft: BALLS_PER_GAME, extraBalls: 0, machine: DEFAULT_MACHINE }; // playerId er klient-id
let lastGame = null; // { name, score, machine } – vises som "game over" på skjermen
let plungerPullStart = null; // når fjæra begynte å trekkes (ms), eller null
let readySince = null;       // når ballen ble lagt klar for spilleren som har tur (ms), eller null
let soundEvents = [];        // lydhendelser som sendes med neste state

// Topplistene (én per maskin, de 10 beste) – se highscores.js. Turso hvis satt opp, ellers JSON-fil.
// På Render uten Turso må HIGHSCORE_FILE peke til en persistent disk, ellers nullstilles den ved deploy.
const highScores = createHighScores({
    machineIds: machines.map(m => m.id),
    file: process.env.HIGHSCORE_FILE || path.join(__dirname, 'highscores.json'),
});

function cleanName(name) {
    if (typeof name !== 'string') return '';
    return name.trim().slice(0, 20);
}

function validClientId(id) {
    return typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);
}

function addHighScore(cid) {
    const p = players[cid];
    const score = p ? scores[p.id] || 0 : 0;
    if (score <= 0) return;
    highScores.add(game.machine, p.name, score);
    io.emit('machines', machineList());
}

// Maskinoversikt til hovedsiden og poengtavla: navn, farger og topp 10
// Bare publiserte maskiner vises for spillerne
function machineList() {
    return machines.filter(m => m.published).map(({ board, ...m }) => ({ ...m, highScores: highScores.top(m.id) }));
}

function startTurn(cid) {
    game.playerId = cid || null;
    game.ballsLeft = BALLS_PER_GAME;
    game.extraBalls = 0;
    if (cid) {
        scores[players[cid].id] = 0;
        game.machine = players[cid].machine;
    }
    useBoard(game.machine, true);
    physics.setFlipper('left', false);
    physics.setFlipper('right', false);
    physics.resetBall();
    rules.newGame();
    plungerPullStart = null;
    readySince = null;
}

// Hvor langt fjæra er trukket (0–1). Full styrke etter 1,2 sekunder.
function plungerPower() {
    if (plungerPullStart === null) return 0;
    return Math.min(1, (Date.now() - plungerPullStart) / 1200);
}

// Avslutter spillet for den som har tur. Spilleren går ut av køen og må melde seg på igjen
// for å spille mer. Neste i køen får tur.
function endGame() {
    const cid = game.playerId;
    if (cid && players[cid]) {
        addHighScore(cid);
        lastGame = { name: players[cid].name, score: scores[players[cid].id] || 0, machine: game.machine, at: Date.now() };
        soundEvents.push({ type: 'gameover' });
    }
    queue = queue.filter(q => q !== cid);
    startTurn(queue[0]);
}

// Fjerner en spiller helt (frakoblet for lenge). Har spilleren tur, avsluttes spillet først.
function removePlayer(cid) {
    if (game.playerId === cid) endGame();
    queue = queue.filter(q => q !== cid);
    if (players[cid]) delete scores[players[cid].id];
    delete players[cid];
}

// Bare den som har tur kan styre. Er køen tom, er det fritt spill for alle (også storskjermen).
function canControl(socket) {
    if (!game.playerId) return true;
    return socket.data.clientId === game.playerId;
}

io.on('connection', (socket) => {
    socket.emit('layout', physics.layout);
    socket.emit('machines', machineList());

    // Mobilen presenterer seg med sin faste klient-id. Er spilleren kjent fra før, er dette
    // en gjenoppkobling, og spilleren beholder plassen i køen. Navnet kan mangle her –
    // det skrives inn når spilleren stiller seg i kø.
    socket.on('hello', (data) => {
        const cid = data && data.clientId;
        const name = cleanName(data && data.name);
        if (!validClientId(cid)) return;

        let p = players[cid];
        if (p) {
            // Samme spiller i to faner/enheter: den gamle tilkoblingen mister styringen
            if (p.socketId && p.socketId !== socket.id) {
                const old = io.sockets.sockets.get(p.socketId);
                if (old) old.data.clientId = null;
            }
            p.socketId = socket.id;
            p.disconnectedAt = null;
            if (name && game.playerId !== cid) p.name = name;
        } else {
            p = players[cid] = { id: crypto.randomUUID(), name, machine: DEFAULT_MACHINE, socketId: socket.id, disconnectedAt: null };
        }
        socket.data.clientId = cid;
        socket.emit('you', { id: p.id });
    });

    // Still meg i kø for en maskin, med navnet som havner på topplista. Står spilleren
    // allerede i kø (og venter), byttes bare maskin/navn. Uten navn kommer man ikke i kø.
    socket.on('join-queue', (data) => {
        const cid = socket.data.clientId;
        const p = cid && players[cid];
        if (!p) return;
        const machine = validMachine(data && data.machine);
        const name = cleanName(data && data.name);
        if (game.playerId !== cid) {
            if (machine) p.machine = machine;
            if (name) p.name = name;
        }
        if (!p.name || queue.includes(cid)) return;
        queue.push(cid);
        if (!game.playerId) startTurn(cid);
    });

    socket.on('leave-queue', () => {
        const cid = socket.data.clientId;
        if (!cid || !queue.includes(cid)) return;
        if (game.playerId === cid) endGame();
        else queue = queue.filter(q => q !== cid);
    });

    // Et nytt trykk på en flipper flytter også de tente rollover-lysene ("lane change")
    const flip = (side, pressed) => {
        if (!canControl(socket)) return;
        if (pressed && !physics.flippers[side].pressed) physics.rotateRollovers(side === 'left' ? -1 : 1);
        physics.setFlipper(side, pressed);
    };
    socket.on('flip-left', (pressed) => flip('left', pressed));
    socket.on('flip-right', (pressed) => flip('right', pressed));

    // Hold inne for å trekke fjæra; slipp (ball-launch) for å skyte. Uten trekk velges tilfeldig styrke.
    socket.on('plunger-pull', () => {
        if (canControl(socket) && physics.ball.ready && plungerPullStart === null) plungerPullStart = Date.now();
    });

    socket.on('ball-launch', () => {
        if (!canControl(socket)) return;
        const power = plungerPullStart === null ? undefined : plungerPower();
        plungerPullStart = null;
        if (physics.launch(power)) {
            rules.onLaunch(Date.now());
            soundEvents.push({ type: 'launch', power: power === undefined ? 0.7 : power });
        }
    });

    socket.on('disconnect', () => {
        const cid = socket.data.clientId;
        const p = cid && players[cid];
        if (!p || p.socketId !== socket.id) return;
        p.socketId = null;
        if (!queue.includes(cid)) {
            delete scores[p.id];
            delete players[cid];
            return;
        }
        // Står i kø eller spiller: hold av plassen en stund i tilfelle spilleren kommer tilbake
        p.disconnectedAt = Date.now();
        if (game.playerId === cid) {
            physics.setFlipper('left', false);
            physics.setFlipper('right', false);
            plungerPullStart = null;
        }
    });
});

// Rydder i køen: spillere som har vært borte for lenge, og spilleren som har tur men ikke
// skyter ut ballen, mister plassen.
setInterval(() => {
    const now = Date.now();
    for (const cid of Object.keys(players)) {
        const p = players[cid];
        if (p.disconnectedAt && now - p.disconnectedAt > RECONNECT_GRACE_MS) removePlayer(cid);
    }
    if (game.playerId && readySince !== null && plungerPullStart === null &&
        now - readySince > LAUNCH_TIMEOUT_MS) {
        endGame();
    }
}, 1000);

setInterval(() => {
    const result = rules.handle(physics.step(), Date.now());
    soundEvents.push(...result.events);
    if (game.playerId && result.points) {
        const id = players[game.playerId].id;
        scores[id] = (scores[id] || 0) + result.points;
    }
    if (result.extraBall && game.playerId) {
        game.ballsLeft += 1;
        game.extraBalls += 1;
    }
    if (result.ballLost && game.playerId) {
        game.ballsLeft -= 1;
        if (game.ballsLeft <= 0) endGame();
    }

    // Starter nedtellingen hver gang ballen blir liggende klar for spilleren som har tur
    if (game.playerId && physics.ball.ready && physics.balls.length === 1) {
        if (readySince === null) readySince = Date.now();
    } else {
        readySince = null;
    }

    io.emit('state', buildGameState());
    soundEvents = [];
}, 1000 / 60);

function buildGameState() {
    const f = physics.flippers;
    const current = game.playerId ? players[game.playerId] : null;
    return {
        players: queue.map(cid => ({ id: players[cid].id, name: players[cid].name, machine: players[cid].machine, away: !!players[cid].disconnectedAt })),
        machine: game.machine,
        // Utseendet (theme.js) og tittelen på brettet – egne maskiner låner utseendet til en innebygd
        theme: (machines.find(m => m.id === game.machine) || {}).theme || game.machine,
        title: ((machines.find(m => m.id === game.machine) || {}).name || '').toUpperCase(),
        scores,
        currentPlayer: current ? current.id : null,
        ballsLeft: game.ballsLeft,
        ballsPerGame: BALLS_PER_GAME + game.extraBalls,
        // Sekunder igjen før turen går videre hvis ballen ikke skytes ut (null = ingen nedtelling)
        launchCountdown: readySince === null ? null : Math.max(0, Math.ceil((LAUNCH_TIMEOUT_MS - (Date.now() - readySince)) / 1000)),
        // "Game over" vises noen sekunder etter at et spill er ferdig
        gameOver: lastGame && Date.now() - lastGame.at < 4000 ? { name: lastGame.name, score: lastGame.score, machine: lastGame.machine } : null,
        ball: { x: physics.ball.x, y: physics.ball.y, r: physics.ball.r, ready: physics.ball.ready },
        balls: physics.balls.map(b => ({ x: b.x, y: b.y, r: b.r, ready: b.ready, held: b.held, onRamp: !!b.ramp })),
        flippers: {
            left: { angle: f.left.angle, pressed: f.left.pressed },
            right: { angle: f.right.angle, pressed: f.right.pressed },
        },
        bumpers: physics.bumpers.map(b => ({ x: b.x, y: b.y, r: b.r, score: b.score, type: b.type, color: b.color, icon: b.icon, hitFlash: b.hitFlash })),
        slingFlash: physics.slingshots.map(s => s.flash),
        table: physics.tableState(),
        ...rules.state(Date.now()),
        plunger: plungerPower(),
        events: soundEvents,
    };
}

useBoard(game.machine);
// Databaser og egne maskiner lastes i bakgrunnen ved oppstart
Promise.all([highScores.init(), boardStore.init(), machineStore.init()]).then(async () => {
    machineStore.list().forEach((c, i) => addCustomMachine(c, i));
    for (const m of machines.filter(x => x.custom)) {
        await highScores.ensure(m.id);
        await boardStore.ensure(m.id);
    }
    useBoard(game.machine, true);
    io.emit('machines', machineList());
}).catch(err => console.error('Feil ved oppstart:', err.message));

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`🎰 Pinball server kjører på port ${PORT}`);
});
