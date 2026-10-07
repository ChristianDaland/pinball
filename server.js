const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const W = 800, H = 1300;
const GRAVITY = 0.12;
const BALL_R = 7;

function makeWalls() {
    return [
        { x1: 60, y1: 0,   x2: 740, y2: 0 },
        { x1: 10, y1: 30,   x2: 40, y2: 200 },
        { x1: 40, y1: 200,  x2: 55, y2: 280 },
        { x1: 55, y1: 350,  x2: 100, y2: 430 },
        { x1: 120, y1: 980, x2: 230, y2: 1100 },
        { x1: 680, y1: 980, x2: 570, y2: 1100 },
        { x1: 745, y1: 350, x2: 700, y2: 430 },
        { x1: 760, y1: 280, x2: 760, y2: 200 },
        { x1: 760, y1: 200,  x2: 790, y2: 30 },
        { x1: 740, y1: 50,   x2: 740, y2: 1250 },
    ];
}

const bumpers = [
    { x: 300, y: 300, r: 35, score: 50, color: '#ff6b6b', hitFlash: 0 },
    { x: 500, y: 300, r: 35, score: 50, color: '#4ecdc4', hitFlash: 0 },
    { x: 400, y: 450, r: 30, score: 100, color: '#ffe66d', hitFlash: 0 },
];

const slingshots = [
    { x1: 140, y1: 700, x2: 90, y2: 800, x3: 140, y3: 880, score: 50 },
    { x1: 660, y1: 700, x2: 710, y2: 800, x3: 660, y3: 880, score: 50 },
];

let players = {};
let scores = {};
let ball = { x: 760, y: 100, vx: 0, vy: 0, r: BALL_R, active: true };
let flipStates = { left: false, right: false };
let gameStarted = true;
let highScores = [];

const FLIPPER_LEN = 110;
let flipLeftAngle = 0.35;
let flipRightAngle = Math.PI - 0.35;

function getFlipLeftEnd() {
    const px = 230, py = 1100;
    const angle = flipStates.left ? -0.4 : 0.35;
    return {
        x1: px, y1: py,
        x2: px + Math.cos(angle) * FLIPPER_LEN,
        y2: py + Math.sin(angle) * FLIPPER_LEN
    };
}

function getFlipRightEnd() {
    const px = 570, py = 1100;
    const angle = flipStates.right ? (Math.PI + 0.4) : (Math.PI - 0.35);
    return {
        x1: px, y1: py,
        x2: px + Math.cos(angle) * FLIPPER_LEN,
        y2: px + Math.sin(angle) * FLIPPER_LEN
    };
}

let particles = [];

io.on('connection', (socket) => {
    console.log(`Klient koblet til: ${socket.id}`);
    
    socket.on('set-name', (name) => {
        if (!name) return;
        players[socket.id] = { name, joinedAt: Date.now() };
        if (scores[socket.id] === undefined) scores[socket.id] = 0;
        io.emit('state', buildGameState());
    });

    socket.on('flip-left', (pressed) => { flipStates.left = pressed || false; });
    socket.on('flip-right', (pressed) => { flipStates.right = pressed || false; });

    socket.on('ball-launch', () => {
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
    ball.x = 760 + Math.random() * 20;
    ball.y = 100;
    ball.vx = -2 - Math.random() * 2;
    ball.vy = 2;
    ball.active = true;
}

function addParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 8,
            vy: (Math.random() - 0.5) * 8,
            life: 25,
            maxLife: 25,
            color: color || '#e94560',
            size: 3 + Math.random() * 3
        });
    }
}

setInterval(() => {
    if (!gameStarted || !ball.active) return;

    const walls = makeWalls();
    const fL = getFlipLeftEnd();
    const fR = getFlipRightEnd();

    const allSegments = [...walls,
        { x1: fL.x1, y1: fL.y1, x2: fL.x2, y2: fL.y2 },
        { x1: fR.x1, y1: fR.y1, x2: fR.x2, y2: fR.y2 }
    ];

    ball.vy += GRAVITY;
    ball.x += ball.vx;
    ball.y += ball.vy;

    for (const w of allSegments) {
        collideBallSegment(w, (w === fL || w === fR));
    }

    for (const b of bumpers) {
        if (b.hitFlash > 0) b.hitFlash -= 1;
        const dx = ball.x - b.x;
        const dy = ball.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < b.r + ball.r) {
            const nx = dx / dist;
            const ny = dy / dist;
            ball.x = b.x + nx * (b.r + ball.r + 2);
            ball.y = b.y + ny * (b.r + ball.r + 2);
            const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
            ball.vx = nx * speed * 0.9 + nx * 6;
            ball.vy = ny * speed * 0.9 + ny * 6;
            b.hitFlash = 10;
            addParticles(b.x, b.y, b.color, 12);
            
            const playerIds = Object.keys(scores);
            if (playerIds.length > 0) {
                scores[playerIds[0]] = (scores[playerIds[0]] || 0) + b.score;
            }
        }
    }

    if (ball.y > H + 50) {
        resetBall();
    }

    io.emit('state', buildGameState());
}, 1000 / 60);

function collideBallSegment(w, isFlipper) {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return;

    let t = ((ball.x - w.x1) * dx + (ball.y - w.y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const closestX = w.x1 + t * dx;
    const closestY = w.y1 + t * dy;

    const distX = ball.x - closestX;
    const distY = ball.y - closestY;
    const dist = Math.sqrt(distX * distX + distY * distY);

    if (dist < ball.r && dist > 0) {
        const nx = distX / dist;
        const ny = distY / dist;

        ball.x = closestX + nx * (ball.r + 1);
        ball.y = closestY + ny * (ball.r + 1);

        const dot = ball.vx * nx + ball.vy * ny;
        ball.vx -= 2 * dot * nx;
        ball.vy -= 2 * dot * ny;

        ball.vx *= 0.85;
        ball.vy *= 0.85;

        if (isFlipper) {
            const flippingUp = (w.x1 < 400 && flipStates.left) || (w.x1 > 400 && flipStates.right);
            if (flippingUp) {
                ball.vy -= 12; // Gir kraft oppover når flipperen slår opp!
                ball.vx += (Math.random() - 0.5) * 6;
            }
        }
    }
}

function buildGameState() {
    return {
        players: Object.keys(players).map(id => ({ id, name: players[id].name })),
        scores,
        ball: { ...ball },
        flippers: { ...flipStates },
        gameStarted,
        bumpers: bumpers.map(b => ({ ...b })),
        slingshots: slingshots.map(s => ({ ...s })),
        highScores,
    };
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`🎰 Pinball server kjører på port ${PORT}`);
});