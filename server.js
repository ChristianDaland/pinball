const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const physics = require('./physics');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const BALLS_PER_GAME = 3;

let players = {};    // socket.id -> { name }
let scores = {};     // socket.id -> poeng i siste/nåværende spill
let queue = [];      // rekkefølgen spillerne får tur i
let game = { playerId: null, ballsLeft: BALLS_PER_GAME };
let lastGame = null; // { name, score } – vises som "game over" på skjermen
let plungerPullStart = null; // når fjæra begynte å trekkes (ms), eller null
let soundEvents = [];        // lydhendelser som sendes med neste state

// Topplista lagres i en JSON-fil så den overlever omstart av serveren.
// På Render må HIGHSCORE_FILE peke til en persistent disk, ellers nullstilles den ved ny deploy.
const HIGHSCORE_FILE = process.env.HIGHSCORE_FILE || path.join(__dirname, 'highscores.json');
let highScores = loadHighScores();

function loadHighScores() {
    try {
        const list = JSON.parse(fs.readFileSync(HIGHSCORE_FILE, 'utf8'));
        return Array.isArray(list) ? list.filter(h => typeof h.name === 'string' && Number.isFinite(h.score)).slice(0, 10) : [];
    } catch (e) {
        return [];
    }
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

function addHighScore(id) {
    const score = scores[id] || 0;
    if (!players[id] || score <= 0) return;
    highScores.push({ name: players[id].name, score });
    highScores.sort((a, b) => b.score - a.score);
    highScores = highScores.slice(0, 10);
    saveHighScores();
}

function startTurn(id) {
    game.playerId = id || null;
    game.ballsLeft = BALLS_PER_GAME;
    if (id) scores[id] = 0;
    physics.setFlipper('left', false);
    physics.setFlipper('right', false);
    physics.resetBall();
    plungerPullStart = null;
}

// Hvor langt fjæra er trukket (0–1). Full styrke etter 1,2 sekunder.
function plungerPower() {
    if (plungerPullStart === null) return 0;
    return Math.min(1, (Date.now() - plungerPullStart) / 1200);
}

// Avslutter spillet for nåværende spiller og gir turen videre
function endGame() {
    const id = game.playerId;
    if (id) {
        addHighScore(id);
        lastGame = { name: players[id].name, score: scores[id] || 0, at: Date.now() };
        queue = queue.filter(q => q !== id);
        queue.push(id);
        soundEvents.push({ type: 'gameover' });
    }
    startTurn(queue[0]);
}

// Den som har tur styrer. Uten spillere (eller fra storskjermen, som ikke har navn) er det fritt fram.
function canControl(socket) {
    return !game.playerId || socket.id === game.playerId || !players[socket.id];
}

io.on('connection', (socket) => {
    socket.emit('layout', physics.layout);

    socket.on('set-name', (rawName) => {
        const name = cleanName(rawName);
        if (!name) return;
        players[socket.id] = { name };
        if (scores[socket.id] === undefined) scores[socket.id] = 0;
        if (!queue.includes(socket.id)) queue.push(socket.id);
        if (!game.playerId) startTurn(socket.id);
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
        if (!players[socket.id]) return;
        const wasPlaying = game.playerId === socket.id;
        if (wasPlaying) addHighScore(socket.id);
        queue = queue.filter(q => q !== socket.id);
        delete players[socket.id];
        delete scores[socket.id];
        if (wasPlaying) startTurn(queue[0]);
    });
});

setInterval(() => {
    const events = physics.step();

    const addScore = (points) => {
        if (game.playerId) scores[game.playerId] = (scores[game.playerId] || 0) + points;
    };
    for (const i of events.hits) {
        addScore(physics.bumpers[i].score);
        soundEvents.push({ type: 'bumper', i });
    }
    for (const i of events.slings) {
        addScore(physics.SLING_SCORE);
        soundEvents.push({ type: 'sling', i });
    }

    if (events.drained) {
        soundEvents.push({ type: 'drain' });
        if (game.playerId) {
            game.ballsLeft -= 1;
            if (game.ballsLeft <= 0) endGame();
        }
    }

    io.emit('state', buildGameState());
    soundEvents = [];
}, 1000 / 60);

function buildGameState() {
    const f = physics.flippers;
    return {
        players: queue.map(id => ({ id, name: players[id].name })),
        scores,
        currentPlayer: game.playerId,
        ballsLeft: game.ballsLeft,
        ballsPerGame: BALLS_PER_GAME,
        // "Game over" vises noen sekunder etter at et spill er ferdig
        gameOver: lastGame && Date.now() - lastGame.at < 4000 ? { name: lastGame.name, score: lastGame.score } : null,
        ball: { x: physics.ball.x, y: physics.ball.y, r: physics.ball.r, ready: physics.ball.ready },
        flippers: {
            left: { angle: f.left.angle, pressed: f.left.pressed },
            right: { angle: f.right.angle, pressed: f.right.pressed },
        },
        bumpers: physics.bumpers.map(b => ({ x: b.x, y: b.y, r: b.r, score: b.score, color: b.color, hitFlash: b.hitFlash })),
        slingFlash: physics.slingshots.map(s => s.flash),
        plunger: plungerPower(),
        events: soundEvents,
        highScores,
    };
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`🎰 Pinball server kjører på port ${PORT}`);
});
