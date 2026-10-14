const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const physics = require('./physics');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const BALLS_PER_GAME = 3;

// Maskinene finnes som mapper i public/machines/<id>/ med machine.json (navn, farger …)
// og theme.js (utseende og lyd). Fysikken er lik for alle. Bare ett brett: maskinen bytter
// til den som har tur sin maskin.
const MACHINES_DIR = path.join(__dirname, 'public', 'machines');
const machines = loadMachines();
const DEFAULT_MACHINE = machines[0].id;

function loadMachines() {
    const list = [];
    for (const id of fs.readdirSync(MACHINES_DIR)) {
        if (!/^[a-z0-9-]+$/.test(id)) continue;
        try {
            const info = JSON.parse(fs.readFileSync(path.join(MACHINES_DIR, id, 'machine.json'), 'utf8'));
            list.push({ id, name: info.name || id, tagline: info.tagline || '', icon: info.icon || '🎰',
                order: info.order || 99, colors: info.colors || {} });
        } catch (e) {
            console.error(`Hopper over maskin "${id}":`, e.message);
        }
    }
    if (!list.length) throw new Error('Fant ingen maskiner i ' + MACHINES_DIR);
    return list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

function validMachine(id) {
    return machines.some(m => m.id === id) ? id : null;
}
const LAUNCH_TIMEOUT_MS = 30000;   // så lenge ballen kan ligge klar før turen går videre
const RECONNECT_GRACE_MS = 30000;  // så lenge en frakoblet spiller beholder plassen sin

// Spillere identifiseres med en fast klient-id fra mobilens localStorage, så de beholder
// plass og poeng om skjermen låses eller nettet faller ut et øyeblikk. Klient-id-en fungerer
// som innloggingsnøkkel og sendes aldri ut; andre klienter ser bare den offentlige id-en.
let players = {};    // klient-id -> { id (offentlig), name, machine, socketId, disconnectedAt }
let scores = {};     // offentlig id -> poeng i nåværende spill
let queue = [];      // klient-id-er i turrekkefølge; queue[0] har tur
let game = { playerId: null, ballsLeft: BALLS_PER_GAME, machine: DEFAULT_MACHINE }; // playerId er klient-id
let lastGame = null; // { name, score, machine } – vises som "game over" på skjermen
let plungerPullStart = null; // når fjæra begynte å trekkes (ms), eller null
let readySince = null;       // når ballen ble lagt klar for spilleren som har tur (ms), eller null
let soundEvents = [];        // lydhendelser som sendes med neste state

// Topplistene (én per maskin) lagres i en JSON-fil så de overlever omstart av serveren:
//   { "<maskin-id>": [{ name, score }, …], … }
// På Render må HIGHSCORE_FILE peke til en persistent disk, ellers nullstilles den ved ny deploy.
const HIGHSCORE_FILE = process.env.HIGHSCORE_FILE || path.join(__dirname, 'highscores.json');
let highScores = loadHighScores();

function loadHighScores() {
    const valid = (list) => Array.isArray(list)
        ? list.filter(h => h && typeof h.name === 'string' && Number.isFinite(h.score)).slice(0, 10) : [];
    let data = {};
    try {
        data = JSON.parse(fs.readFileSync(HIGHSCORE_FILE, 'utf8'));
    } catch (e) { /* ingen fil ennå */ }
    // Gammelt format (én liste) var fra før det fantes flere maskiner – den hører til gården
    if (Array.isArray(data)) data = { gard: data };
    const result = {};
    for (const m of machines) result[m.id] = valid(data && data[m.id]);
    return result;
}

function saveHighScores() {
    fs.writeFile(HIGHSCORE_FILE, JSON.stringify(highScores, null, 2), (err) => {
        if (err) console.error('Kunne ikke lagre topplista:', err.message);
    });
}

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
    const list = highScores[game.machine];
    list.push({ name: p.name, score });
    list.sort((a, b) => b.score - a.score);
    highScores[game.machine] = list.slice(0, 10);
    saveHighScores();
    io.emit('machines', machineList());
}

// Maskinoversikt til hovedsiden og poengtavla: navn, farger og topp 5
function machineList() {
    return machines.map(m => ({ ...m, highScores: highScores[m.id].slice(0, 5) }));
}

function startTurn(cid) {
    game.playerId = cid || null;
    game.ballsLeft = BALLS_PER_GAME;
    if (cid) {
        scores[players[cid].id] = 0;
        game.machine = players[cid].machine;
    }
    physics.setFlipper('left', false);
    physics.setFlipper('right', false);
    physics.resetBall();
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

    socket.on('flip-left', (pressed) => { if (canControl(socket)) physics.setFlipper('left', pressed); });
    socket.on('flip-right', (pressed) => { if (canControl(socket)) physics.setFlipper('right', pressed); });

    // Hold inne for å trekke fjæra; slipp (ball-launch) for å skyte. Uten trekk velges tilfeldig styrke.
    socket.on('plunger-pull', () => {
        if (canControl(socket) && physics.ball.ready && plungerPullStart === null) plungerPullStart = Date.now();
    });

    socket.on('ball-launch', () => {
        if (!canControl(socket)) return;
        const power = plungerPullStart === null ? undefined : plungerPower();
        plungerPullStart = null;
        if (physics.launch(power)) soundEvents.push({ type: 'launch', power: power === undefined ? 0.7 : power });
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
    const events = physics.step();

    const addScore = (points) => {
        if (game.playerId) {
            const id = players[game.playerId].id;
            scores[id] = (scores[id] || 0) + points;
        }
    };
    for (const i of events.hits) {
        addScore(physics.bumpers[i].score);
        soundEvents.push({ type: 'bumper', i, points: physics.bumpers[i].score });
    }
    for (const i of events.slings) {
        addScore(physics.SLING_SCORE);
        soundEvents.push({ type: 'sling', i, points: physics.SLING_SCORE });
    }

    if (events.drained) {
        soundEvents.push({ type: 'drain' });
        if (game.playerId) {
            game.ballsLeft -= 1;
            if (game.ballsLeft <= 0) endGame();
        }
    }

    // Starter nedtellingen hver gang ballen blir liggende klar for spilleren som har tur
    if (game.playerId && physics.ball.ready) {
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
        scores,
        currentPlayer: current ? current.id : null,
        ballsLeft: game.ballsLeft,
        ballsPerGame: BALLS_PER_GAME,
        // Sekunder igjen før turen går videre hvis ballen ikke skytes ut (null = ingen nedtelling)
        launchCountdown: readySince === null ? null : Math.max(0, Math.ceil((LAUNCH_TIMEOUT_MS - (Date.now() - readySince)) / 1000)),
        // "Game over" vises noen sekunder etter at et spill er ferdig
        gameOver: lastGame && Date.now() - lastGame.at < 4000 ? { name: lastGame.name, score: lastGame.score, machine: lastGame.machine } : null,
        ball: { x: physics.ball.x, y: physics.ball.y, r: physics.ball.r, ready: physics.ball.ready },
        flippers: {
            left: { angle: f.left.angle, pressed: f.left.pressed },
            right: { angle: f.right.angle, pressed: f.right.pressed },
        },
        bumpers: physics.bumpers.map(b => ({ x: b.x, y: b.y, r: b.r, score: b.score, color: b.color, hitFlash: b.hitFlash })),
        slingFlash: physics.slingshots.map(s => s.flash),
        plunger: plungerPower(),
        events: soundEvents,
    };
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`🎰 Pinball server kjører på port ${PORT}`);
});
