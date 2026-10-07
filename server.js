const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ================= GAME STATE =================
let players = {};
let scores = {};
let ball = { x: 400, y: 350, vx: 3, vy: -3, radius: 8, r: 8, active: true };
let flipStates = { left: false, right: false };
let gameStarted = true; // Setter denne til true som standard slik at spillere kan joine med en gang
let highScores = [];

// Bumpers
const bumpers = [
    { x: 250, y: 180, r: 30, score: 50, color: '#ff6b6b', hitFlash: 0 },
    { x: 550, y: 180, r: 30, score: 50, color: '#4ecdc4', hitFlash: 0 },
    { x: 400, y: 280, r: 25, score: 100, color: '#ffe66d', hitFlash: 0 },
    { x: 300, y: 350, r: 20, score: 75, color: '#a8e6cf', hitFlash: 0 },
    { x: 500, y: 350, r: 20, score: 75, color: '#ff8b94', hitFlash: 0 },
];

// Slingshots
const slingshots = [
    { x: 120, y: 440, w: 70, h: 60, triangular: true, score: 25 },
    { x: 680, y: 440, w: 70, h: 60, triangular: true, score: 25 },
];

// Walls
const walls = [
    { x: 10, y: 10, w: 80, h: 5 },
    { x: 10, y: 10, w: 5, h: 90 },
    { x: 85, y: 10, w: 5, h: 90 },
];

let particles = [];

io.on('connection', (socket) => {
    console.log(`Klient koblet til: ${socket.id}`);

    socket.on('set-name', (name) => {
        players[socket.id] = { name, joinedAt: Date.now() };
        if (scores[socket.id] === undefined) {
            scores[socket.id] = 0;
        }
        io.emit('state', buildGameState());
    });

    socket.on('flip-left', (pressed) => {
        flipStates.left = pressed;
    });

    socket.on('flip-right', (pressed) => {
        flipStates.right = pressed;
    });

    socket.on('start-game', () => {
        gameStarted = true;
        resetBall();
        io.emit('state', buildGameState());
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            let s = scores[socket.id] || 0;
            if (s > 0) highScores.push({ name: players[socket.id].name, score: s });
            highScores.sort((a, b) => b.score - a.score);
            highScores = highScores.slice(0, 10);
            delete players[socket.id];
            delete scores[socket.id];
        }
        io.emit('state', buildGameState());
    });
});

function resetBall() {
    ball.x = 40 + Math.random() * 20;
    ball.y = 40;
    ball.vx = (Math.random() - 0.5) * 4;
    ball.vy = 2;
    ball.active = true;
}

// Physics Loop
setInterval(() => {
    if (!gameStarted) return;

    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.vy += 0.08; // tyngdekraft

    // Enkel veggsjekk og kollisjon
    if (ball.x < 15 || ball.x > 85) ball.vx *= -1;
    if (ball.y < 15) ball.vy *= -1;

    // Sjekk om ballen faller ut i bunn
    if (ball.y > 95) {
        resetBall();
    }

    io.emit('state', buildGameState());
}, 1000 / 60);

function buildGameState() {
    return {
        players: Object.keys(players).map(id => ({
            id, name: players[id].name, joinedAt: players[id].joinedAt
        })),
        scores,
        ball: { ...ball },
        flippers: { ...flipStates },
        gameStarted,
        bumpers: bumpers.map(b => ({ ...b })),
        slingshots: slingshots.map(s => ({ ...s })),
        walls: walls.map(w => ({ ...w })),
        highScores,
    };
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`🎰 Pinball server kjører på port ${PORT}`);
});