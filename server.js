const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ================= GAME AREA (800x900 virtual) =================
const W = 800, H = 900;
const GRAVITY = 0.12;
const BALL_R = 7;

// ================= PINBOARD CABINET SHAPE =================
// Walls as line segments in the game area
function makeWalls() {
    return [
        // Top
        { x1: 60, y1: 0,   x2: 740, y2: 0 },
        // Outer left wall (curves down)
        { x1: 10, y1: 30,   x2: 40, y2: 200 },
        { x1: 40, y1: 200,  x2: 55, y2: 280 },
        // Left slingshot (triangle top)
        { x1: 55, y1: 350,  x2: 100, y2: 430 },
        // Left flipper guide wall
        { x1: 120, y1: 680, x2: 260, y2: 780 },
        // Right flipper guide wall
        { x1: 680, y1: 680, x2: 560, y2: 780 },
        // Right slingshot (triangle top)
        { x1: 745, y1: 350, x2: 700, y2: 430 },
        { x1: 760, y1: 280, x2: 760, y2: 200 },
        // Outer right wall (curves up)
        { x1: 760, y1: 200,  x2: 790, y2: 30 },
        // Plunger lane left divider
        { x1: 740, y1: 50,   x2: 740, y2: 850 },
        // Top of plunger lane
        { x1: 740, y1: 0,    x2: 800, y2: 0 },
        // Drain left wall (above flippers)
        { x1: 60, y1: 650,    x2: 150, y2: 680 },
        // Drain right wall (above flippers)
        { x1: 740, y1: 650,   x2: 650, y2: 680 },
    ];
}

// ================= BUMPERS =================
const bumpers = [
    { x: 300, y: 180, r: 28, score: 50, color: '#ff6b6b', hitFlash: 0 },
    { x: 500, y: 180, r: 28, score: 50, color: '#4ecdc4', hitFlash: 0 },
    { x: 400, y: 300, r: 22, score: 100, color: '#ffe66d', hitFlash: 0 },
];

// ================= SLINGSHOTS (triangular bumpers) =================
const slingshots = [
    { x1: 140, y1: 500, x2: 90, y2: 580, x3: 140, y3: 640, score: 50 },
    { x1: 660, y1: 500, x2: 710, y2: 580, x3: 660, y3: 640, score: 50 },
];

// ================= GAME STATE =================
let players = {};
let scores = {};
let ball = { x: 760, y: 100, vx: 0, vy: 0, r: BALL_R, active: true, plunger: 0 };
let flipStates = { left: false, right: false };
let gameStarted = true;
let highScores = [];

// Flippers defined as line segments with pivot points and angles
const FLIPPER_LEN = 90;
const FLIPPER_W = 12;
const FLIPPER_SPEED = 0.25;
let flipLeftAngle = 0.4;   // resting angle (radians, from horizontal)
let flipRightAngle = Math.PI - 0.4;
let flipLeftTarget = flipLeftAngle;
let flipRightTarget = flipRightAngle;

function getFlipLeftEnd() {
    const px = 260, py = 780; // pivot point
    return {
        x1: px, y1: py,
        x2: px + Math.cos(flipLeftAngle) * FLIPPER_LEN,
        y2: py + Math.sin(flipLeftAngle) * FLIPPER_LEN
    };
}

function getFlipRightEnd() {
    const px = 540, py = 780; // pivot point
    return {
        x1: px, y1: py,
        x2: px + Math.cos(flipRightAngle) * FLIPPER_LEN,
        y2: py + Math.sin(flipRightAngle) * FLIPPER_LEN
    };
}

let particles = [];

io.on('connection', (socket) => {
    console.log(`Klient koblet til: ${socket.id}`);
    socket.on('set-name', (name) => {
        players[socket.id] = { name, joinedAt: Date.now() };
        if (scores[socket.id] === undefined) scores[socket.id] = 0;
        io.emit('state', buildGameState());
    });
    socket.on('flip-left', (pressed) => { flipStates.left = pressed || false; });
    socket.on('flip-right', (pressed) => { flipStates.right = pressed || false; });
    socket.on('ball-launch', () => {
        ball.active = true;
        ball.x = 760 + Math.random() * 10;
        ball.y = 80;
        ball.plunger = 0;
        io.emit('state', buildGameState());
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
    ball.x = 760 + Math.random() * 20;
    ball.y = 80;
    ball.vx = (Math.random() - 0.5) * 3;
    ball.vy = 1;
    ball.active = true;
    ball.plunger = 0;
}

function addParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 6,
            vy: (Math.random() - 0.5) * 6,
            life: 20 + Math.random() * 15,
            maxLife: 35,
            color: color || '#e94560',
            size: 2 + Math.random() * 4
        });
    }
}

// ================= PHYSICS LOOP (60fps) =================
setInterval(() => {
    if (!gameStarted || !ball.active) return;

    // Update flipper targets based on input
    flipLeftTarget = flipStates.left ? -0.5 : 0.4;
    flipRightTarget = flipStates.right ? (Math.PI + 0.5) : (Math.PI - 0.4);

    // Smooth flipper animation
    flipLeftAngle += (flipLeftTarget - flipLeftAngle) * FLIPPER_SPEED * 3;
    flipRightAngle += (flipRightTarget - flipRightAngle) * FLIPPER_SPEED * 3;

    const walls = makeWalls();
    const fL = getFlipLeftEnd();
    const fR = getFlipRightEnd();

    // Add flippers to collision list
    const allSegments = [...walls,
        { x1: fL.x1, y1: fL.y1, x2: fL.x2, y2: fL.y2 },
        { x1: fR.x1, y1: fR.y1, x2: fR.x2, y2: fR.y2 }
    ];

    // Apply gravity
    ball.vy += GRAVITY;

    // Move ball
    ball.x += ball.vx;
    ball.y += ball.vy;

    // Wall collisions (line segment)
    for (const w of allSegments) {
        collideBallSegment(w);
    }

    // Bumper collisions
    for (const b of bumpers) {
        if (b.hitFlash > 0) b.hitFlash -= 1;
        const dx = ball.x - b.x;
        const dy = ball.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < b.r + ball.r) {
            // Push out
            const nx = dx / dist;
            const ny = dy / dist;
            ball.x = b.x + nx * (b.r + ball.r + 1);
            ball.y = b.y + ny * (b.r + ball.r + 1);
            // Bounce with extra velocity
            const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
            const boost = 5;
            ball.vx = nx * speed * 0.9 + nx * boost;
            ball.vy = ny * speed * 0.9 + ny * boost;
            b.hitFlash = 10;
            addParticles(b.x, b.y, b.color, 12);
        }
    }

    // Slingshot collisions (triangular)
    for (const s of slingshots) {
        const triWalls = [
            { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 },
            { x1: s.x2, y1: s.y2, x2: s.x3, y2: s.y3 },
            { x1: s.x3, y1: s.y3, x2: s.x1, y2: s.y1 }
        ];
        for (const tw of triWalls) {
            collideBallSegment(tw);
        }
    }

    // Plunger lane check
    if (ball.x > 740 && ball.y > 50) {
        ball.x = Math.max(741, Math.min(795, ball.x));
    }

    // Drain check
    if (ball.y > H + 20) {
        resetBall();
    }

    // Cap velocity
    const maxV = 18;
    const spd = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    if (spd > maxV) {
        ball.vx = ball.vx / spd * maxV;
        ball.vy = ball.vy / spd * maxV;
    }

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05;
        p.life--;
        if (p.life <= 0) particles.splice(i, 1);
    }

    io.emit('state', buildGameState());
}, 1000 / 60);

function collideBallSegment(w) {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return;

    // Project ball center onto segment
    let t = ((ball.x - w.x1) * dx + (ball.y - w.y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const closestX = w.x1 + t * dx;
    const closestY = w.y1 + t * dy;

    const distX = ball.x - closestX;
    const distY = ball.y - closestY;
    const dist = Math.sqrt(distX * distX + distY * distY);

    if (dist < ball.r && dist > 0) {
        // Normal direction
        const nx = distX / dist;
        const ny = distY / dist;

        // Push ball out of wall
        ball.x = closestX + nx * (ball.r + 0.5);
        ball.y = closestY + ny * (ball.r + 0.5);

        // Reflect velocity
        const dot = ball.vx * nx + ball.vy * ny;
        ball.vx -= 2 * dot * nx;
        ball.vy -= 2 * dot * ny;

        // Add bounce friction/energy loss
        ball.vx *= 0.85;
        ball.vy *= 0.85;

        // If flipper is moving toward ball, add energy
        if ((w === getFlipLeftEnd() || w === getFlipRightEnd())) {
            const isFlippingUp = (w === getFlipLeftEnd() && flipStates.left) ||
                                 (w === getFlipRightEnd() && flipStates.right);
            if (isFlippingUp) {
                // Add upward velocity boost
                ball.vy -= 4;
                ball.vx += (Math.random() - 0.5) * 3;
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
