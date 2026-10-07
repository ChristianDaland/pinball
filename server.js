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
let ball = { x: 400, y: 350, vx: 3, vy: -3, radius: 8 };
let flipStates = { left: false, right: false };
let gameStarted = false;
let highScores = [];

// Bumpers (firkantede runde)
const bumpers = [
    { x: 250, y: 180, radius: 30, score: 50, color: '#ff6b6b', hitFlash: 0 },
    { x: 550, y: 180, radius: 30, score: 50, color: '#4ecdc4', hitFlash: 0 },
    { x: 400, y: 280, radius: 25, score: 100, color: '#ffe66d', hitFlash: 0 },
    { x: 300, y: 350, radius: 20, score: 75, color: '#a8e6cf', hitFlash: 0 },
    { x: 500, y: 350, radius: 20, score: 75, color: '#ff8b94', hitFlash: 0 },
    { x: 200, y: 450, radius: 18, score: 60, color: '#dda0dd', hitFlash: 0 },
    { x: 600, y: 450, radius: 18, score: 60, color: '#f39c12', hitFlash: 0 },
];

// Slingshots (trekanter)
const slingshots = [
    { x1: 80, y1: 400, x2: 150, y2: 480, x3: 150, y3: 320, score: 25, color: '#9b59b6', flash: 0 },
    { x1: 720, y1: 400, x2: 650, y2: 480, x3: 650, y3: 320, score: 25, color: '#e67e22', flash: 0 },
];

// Flippers
const leftFlipper = { x1: 200, y1: 540, x2: 280, y2: 530, angle: -0.3, active: false };
const rightFlipper = { x1: 600, y2: 540, x2: 520, y2: 530, angle: 0.3, active: false };

// Walls (kantene av banen)
const walls = [
    { x1: 80, y1: 60, x2: 720, y2: 60 },   // topp
    { x1: 80, y1: 540, x2: 200, y2: 540 },  // bunn venstre (utenom flipper)
    { x1: 600, y1: 540, x2: 720, y2: 540 }, // bunn høyre (utenom flipper)
    { x1: 80, y1: 60, x2: 80, y2: 540 },    // venstre vegg
    { x1: 720, y1: 60, x2: 720, y2: 540 },  // høyre vegg
];

// Score zones (mål-soner)
const scoreZones = [
    { x: 140, y: 570, w: 60, h: 20, score: 200, color: '#ff4444' }, // venstre ned
    { x: 600, y: 570, w: 60, h: 20, score: 200, color: '#4444ff' },  // høyre ned
];

// Partikler for effekt
let particles = [];

function addParticles(x, y, color, count = 8) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 8,
            vy: (Math.random() - 0.5) * 8,
            life: 1,
            color,
            size: Math.random() * 4 + 2,
        });
    }
}

function addScorePopup(x, y, points, color) {
    particles.push({
        x, y, vx: 0, vy: -2,
        life: 1.5,
        text: `+${points}`,
        color,
        size: 20,
    });
}

io.on('connection', (socket) => {
    console.log(`Klient koblet til: ${socket.id}`);

    socket.on('set-name', (name) => {
        if (!players[socket.id] && gameStarted) {
            players[socket.id] = { name, joinedAt: Date.now() };
            scores[socket.id] = 0;
            socket.emit('player-ready');
            io.emit('state', buildGameState());
        }
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

    socket.on('reset-ball', () => {
        if (!gameStarted) return;
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
        if (Object.keys(players).length === 0) {
            gameStarted = false;
        }
        io.emit('state', buildGameState());
    });
});

function resetBall() {
    ball.x = 400 + (Math.random() - 0.5) * 100;
    ball.y = 200;
    ball.vx = (Math.random() - 0.5) * 6;
    ball.vy = 3 + Math.random() * 3;
}

// ================= AUDIO =================
function generateAudio(freq, duration, type = 'square') {
    // Audio vil genereres på klientsiden med Web Audio API
    return { type: 'sound', freq, duration };
}

// ================= PHYSICS LOOP =================
setInterval(() => {
    if (!gameStarted) {
        io.emit('state', buildGameState());
        return;
    }

    // Oppdater flippers
    leftFlipper.active = flipStates.left;
    rightFlipper.active = flipStates.right;

    // Flytt ball
    ball.x += ball.vx;
    ball.y += ball.vy;

    // Tyngdekraft (svak)
    ball.vy += 0.12;

    // FRIKTSJON (liten)
    ball.vx *= 0.999;
    ball.vy *= 0.999;

    let scored = false;

    // Kollisjon med vegger
    for (let wall of walls) {
        let closest = closestPointOnSegment(ball.x, ball.y, wall.x1, wall.y1, wall.x2, wall.y2);
        let dx = ball.x - closest.x;
        let dy = ball.y - closest.y;
        let dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < ball.radius) {
            // Normal
            let nx = dx / dist;
            let ny = dy / dist;

            // Speil hastighet
            let dot = ball.vx * nx + ball.vy * ny;
            ball.vx -= 2 * dot * nx;
            ball.vy -= 2 * dot * ny;

            ball.x = closest.x + (dx / dist) * (ball.radius + 1);
            ball.y = closest.y + (dy / dist) * (ball.radius + 1);

            // Liten energi-tap
            ball.vx *= 0.95;
            ball.vy *= 0.95;
        }
    }

    // Kollisjon med flippers
    checkFlipperCollision(leftFlipper, true);
    checkFlipperCollision(rightFlipper, false);

    // Kollisjon med bumpers
    for (let bumper of bumpers) {
        let dx = ball.x - bumper.x;
        let dy = ball.y - bumper.y;
        let dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < ball.radius + bumper.radius) {
            let nx = dx / dist;
            let ny = dy / dist;
            let dot = ball.vx * nx + ball.vy * ny;

            // Bounce!
            ball.vx -= 2 * dot * nx;
            ball.vy -= 2 * dot * ny;

            // ØK hastighet (bumpers gir energi!)
            ball.vx *= 1.25;
            ball.vy *= 1.25;

            ball.x = bumper.x + nx * (ball.radius + bumper.radius + 1);
            ball.y = bumper.y + ny * (ball.radius + bumper.radius + 1);

            // Poeng + effekt
            for (let id in players) {
                scores[id] = (scores[id] || 0) + bumper.score;
            }
            addParticles(bumper.x, bumper.y, bumper.color, 15);
            addScorePopup(bumper.x, bumper.y - 30, bumper.score, bumper.color);
            bumper.hitFlash = 0.3;

            // Send lyd-lyd til klienter
            const freq = 440 + Math.random() * 440;
            io.emit('sound', { freq: freq, duration: 0.15 });
        }
    }

    // Kollisjon med slingshots
    for (let sling of slingshots) {
        let dist = pointToTriangleDist(ball.x, ball.y, sling.x1, sling.y1, sling.x2, sling.y3, sling.x3, sling.y3);
        if (dist < ball.radius + 5) {
            // Sky ballen vekk med stor kraft
            ball.vy -= 8;
            ball.vx += (ball.x < 400 ? -5 : 5);
            
            for (let id in players) {
                scores[id] = (scores[id] || 0) + sling.score;
            }
            addParticles(ball.x, ball.y, sling.color, 10);
            addScorePopup(ball.x, ball.y - 20, sling.score, sling.color);
            sling.flash = 0.3;
        }
    }

    // Sjekk score-zoner (ballen faller ut)
    for (let zone of scoreZones) {
        if (ball.x > zone.x && ball.x < zone.x + zone.w &&
            ball.y > zone.y && ball.y < zone.y + zone.h) {
            scored = true;
            addParticles(ball.x, ball.y, zone.color, 20);
            // Reset ball
            resetBall();
        }
    }

    // Oppdater flash-tid
    for (let bumper of bumpers) {
        if (bumper.hitFlash > 0) bumper.hitFlash -= 0.05;
    }
    for (let sling of slingshots) {
        if (sling.flash > 0) sling.flash -= 0.05;
    }

    // Oppdater partikler
    particles = particles.filter(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.03;
        return p.life > 0;
    });

    io.emit('state', buildGameState());
}, 1000 / 60);

function checkFlipperCollision(flipper, isLeft) {
    let angle = flipper.angle + (flipper.active ? (isLeft ? -0.5 : 0.5) : 0);
    let fx2 = flipper.x1 + Math.cos(angle) * 80;
    let fy2 = flipper.y1 + Math.sin(angle) * 80;

    // Flipper som en linje-segment
    let closest = closestPointOnSegment(ball.x, ball.y, flipper.x1, flipper.y1, fx2, fy2);
    let dx = ball.x - closest.x;
    let dy = ball.y - closest.y;
    let dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < ball.radius + 6) {
        let nx = dx / dist;
        let ny = dy / dist;

        // Hvis flipper er aktiv, gi ekstra kraft!
        if (flipper.active) {
            ball.vx -= 2 * (ball.vx * nx + ball.vy * ny) * nx;
            ball.vy -= 2 * (ball.vx * nx + ball.vy * ny) * ny;

            // Legger til flipper-hastighet!
            let flipForce = isLeft ? -4 : 4;
            ball.vy -= 10; // Hopp opp!
            ball.vx += flipForce;
        } else {
            let dot = ball.vx * nx + ball.vy * ny;
            ball.vx -= 2 * dot * nx;
            ball.vy -= 2 * dot * ny;
            ball.vx *= 0.9;
            ball.vy *= 0.9;
        }

        ball.x = closest.x + (dx / dist) * (ball.radius + 7);
        ball.y = closest.y + (dy / dist) * (ball.radius + 7);
    }
}

function closestPointOnSegment(px, py, x1, y1, x2, y2) {
    let dx = x2 - x1;
    let dy = y2 - y1;
    let lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return { x: x1, y: y1 };
    let t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    return { x: x1 + t * dx, y: y1 + t * dy };
}

function pointToTriangleDist(px, py, ax, ay, bx, by, cx, cy) {
    // Enkel distanse til trekant-kanter
    let d1 = Math.abs((by - cy) * px - (bx - cx) * py + bx * cy - cx * by);
    let d2 = Math.sqrt((by - cy) ** 2 + (cx - bx) ** 2);
    return d2 > 0 ? d1 / d2 : 999;
}

function buildGameState() {
    return {
        players: Object.keys(players).map(id => ({
            id, name: players[id].name, joinedAt: players[id].joinedAt
        })),
        scores,
        ball: { ...ball },
        flipStates: { ...flipStates },
        gameStarted,
        bumpers: bumpers.map(b => ({ ...b })),
        slingshots: slingshots.map(s => ({ ...s })),
        highScores,
    };
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`🎰 Pinball server kjører på port ${PORT}`);
    console.log(`📱 Mobil: http://localhost:${PORT}/mobile.html`);
    console.log(`📊 Score:   http://localhost:${PORT}/score.html`);
    console.log(`🎮 Arena:   http://localhost:${PORT}/index.html`);
});
