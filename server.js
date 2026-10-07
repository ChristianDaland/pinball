const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const W = 800, H = 1300;
const GRAVITY = 0.11;
const BALL_R = 9; // Litt større ball for mer stabil kollisjon

const bumpers = [
    { x: 260, y: 300, r: 30, score: 50, color: '#ff6b6b', hitFlash: 0 },
    { x: 440, y: 300, r: 30, score: 50, color: '#4ecdc4', hitFlash: 0 },
    { x: 350, y: 440, r: 25, score: 100, color: '#ffe66d', hitFlash: 0 },
    { x: 200, y: 580, r: 25, score: 75, color: '#a8e6cf', hitFlash: 0 },
    { x: 500, y: 580, r: 25, score: 75, color: '#ff8b94', hitFlash: 0 },
];

let players = {};
let scores = {};
let ball = { x: 660, y: 1150, vx: 0, vy: 0, r: BALL_R, active: true };
let flipStates = { left: false, right: false };
let gameStarted = true;
let highScores = [];

const FLIPPER_LEN = 110;

// Flipper definisjoner (pivot-punkter)
const leftFlipperPivot = { x: 230, y: 1100 };
const rightFlipperPivot = { x: 470, y: 1100 };

io.on('connection', (socket) => {
    socket.on('set-name', (name) => {
        if (!name) return;
        players[socket.id] = { name, joinedAt: Date.now() };
        if (scores[socket.id] === undefined) scores[socket.id] = 0;
        io.emit('state', buildGameState());
    });

    socket.on('flip-left', (pressed) => { flipStates.left = pressed || false; });
    socket.on('flip-right', (pressed) => { flipStates.right = pressed || false; });

    socket.on('ball-launch', () => {
        ball.x = 660;
        ball.y = 1150;
        ball.vx = 0;
        ball.vy = -28; 
        ball.active = true;
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
    ball.x = 660;
    ball.y = 1150;
    ball.vx = 0;
    ball.vy = 0;
    ball.active = true;
}

let particles = [];
function addParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 8,
            vy: (Math.random() - 0.5) * 8,
            life: 25, maxLife: 25,
            color: color || '#e94560',
            size: 3 + Math.random() * 3
        });
    }
}

setInterval(() => {
    if (!gameStarted || !ball.active) return;

    // 1. Håndtering av oppskyting i høyre kanal
    if (ball.x > 620 && ball.x < 720 && ball.y > 150 && ball.vy < 0) {
        ball.y += ball.vy;
        if (ball.y <= 150) {
            ball.vx = -7;
            ball.vy = -4;
        }
    } else {
        ball.vy += GRAVITY;
        ball.x += ball.vx;
        ball.y += ball.vy;
    }

    // --- UTENFOR- SIKKERHETSREGLER (UGGEN-STOPPER / INGEN FLUKT) ---
    // Venstre yttervegg (X = 80)
    if (ball.x - ball.r < 80) {
        ball.x = 80 + ball.r;
        ball.vx = Math.abs(ball.vx) * 0.8;
    }
    // Høyre yttervegg (X = 720) - unntatt når ballen er i utskytningskanalen i bunnen
    if (ball.x + ball.r > 720 && ball.y > 150 && !(ball.x > 620 && ball.y > 980)) {
        ball.x = 720 - ball.r;
        ball.vx = -Math.abs(ball.vx) * 0.8;
    }
    // Toppvegg / tak (Y = 25)
    if (ball.y - ball.r < 25) {
        ball.y = 25 + ball.r;
        ball.vy = Math.abs(ball.vy) * 0.8;
    }
    // Skillevegg mellom bane og utskytningskanal (X = 620)
    if (ball.y > 150 && ball.y < 980 && ball.x > 610 && ball.x < 630) {
        if (ball.vx > 0) { // Prøver å gå fra banen og inn i kanalen
            ball.x = 620 - ball.r;
            ball.vx = -Math.abs(ball.vx) * 0.8;
        }
    }

    // --- ROBUUST FLIPPER-FYSIKK (Garantert treff og dult) ---
    const leftAngle = flipStates.left ? -0.55 : 0.35;
    const rightAngle = flipStates.right ? (Math.PI + 0.55) : (Math.PI - 0.35);

    const fL = {
        x1: leftFlipperPivot.x, y1: leftFlipperPivot.y,
        x2: leftFlipperPivot.x + Math.cos(leftAngle) * FLIPPER_LEN,
        y2: leftFlipperPivot.y + Math.sin(leftAngle) * FLIPPER_LEN
    };
    const fR = {
        x1: rightFlipperPivot.x, y1: rightFlipperPivot.y,
        x2: rightFlipperPivot.x + Math.cos(rightAngle) * FLIPPER_LEN,
        y2: rightFlipperPivot.y + Math.sin(rightAngle) * FLIPPER_LEN
    };

    [ { seg: fL, isLeft: true, flipping: flipStates.left }, 
      { seg: fR, isLeft: false, flipping: flipStates.right } ].forEach(f => {
        const w = f.seg;
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

        // Ekstra raus kollisjonssone for spakene slik at de aldri glipper
        if (dist < ball.r + 8) {
            const nx = distX / (dist || 1);
            const ny = distY / (dist || 1);

            // Skyv ballen ut av flipperen umiddelbart
            ball.x = closestX + nx * (ball.r + 9);
            ball.y = closestY + ny * (ball.r + 9);

            if (f.flipping) {
                // HVIS SPAKEN ER AKTIV: Sla ballen bestemt opp og inn i banen!
                ball.vy = -21;
                ball.vx = f.isLeft ? 10 : -10;
            } else {
                // Vanlig sprett fra passiv spak
                const dot = ball.vx * nx + ball.vy * ny;
                ball.vx = (ball.vx - 2 * dot * nx) * 0.8;
                ball.vy = (ball.vy - 2 * dot * ny) * 0.8;
            }
        }
    });

    // --- BUMPERS / HINDRE ---
    for (const b of bumpers) {
        if (b.hitFlash > 0) b.hitFlash -= 1;
        const dx = ball.x - b.x;
        const dy = ball.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < b.r + ball.r) {
            const nx = dx / (dist || 1);
            const ny = dy / (dist || 1);
            ball.x = b.x + nx * (b.r + ball.r + 2);
            ball.y = b.y + ny * (b.r + ball.r + 2);
            
            const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
            ball.vx = nx * Math.max(speed, 6) + nx * 4;
            ball.vy = ny * Math.max(speed, 6) + ny * 4;
            
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

function buildGameState() {
    return {
        players: Object.keys(players).map(id => ({ id, name: players[id].name })),
        scores,
        ball: { ...ball },
        flippers: { ...flipStates },
        gameStarted,
        bumpers: bumpers.map(b => ({ ...b })),
        highScores,
    };
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`🎰 Pinball server kjører på port ${PORT}`);
});