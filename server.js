const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const physics = require('./physics');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const BALLS_PER_GAME = 3;

let players = {};    // socket.id -> { name }
let scores = {};     // socket.id -> poeng i siste/nåværende spill
let queue = [];      // rekkefølgen spillerne får tur i
let highScores = [];
let game = { playerId: null, ballsLeft: BALLS_PER_GAME };
let lastGame = null; // { name, score } – vises som "game over" på skjermen

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
}

function startTurn(id) {
    game.playerId = id || null;
    game.ballsLeft = BALLS_PER_GAME;
    if (id) scores[id] = 0;
    physics.setFlipper('left', false);
    physics.setFlipper('right', false);
    physics.resetBall();
}

// Avslutter spillet for nåværende spiller og gir turen videre
function endGame() {
    const id = game.playerId;
    if (id) {
        addHighScore(id);
        lastGame = { name: players[id].name, score: scores[id] || 0, at: Date.now() };
        queue = queue.filter(q => q !== id);
        queue.push(id);
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

    socket.on('ball-launch', () => {
        if (canControl(socket)) physics.launch();
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

    for (const i of events.hits) {
        if (game.playerId) scores[game.playerId] = (scores[game.playerId] || 0) + physics.bumpers[i].score;
    }

    if (events.drained && game.playerId) {
        game.ballsLeft -= 1;
        if (game.ballsLeft <= 0) endGame();
    }

    io.emit('state', buildGameState());
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
        highScores,
    };
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`🎰 Pinball server kjører på port ${PORT}`);
});
