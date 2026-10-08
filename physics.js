// Fysikk for pinball-brettet. Alle koordinater er i et 800x1300-brett,
// og alle hastigheter er i piksler per tick (60 ticks i sekundet).

const W = 800, H = 1300;
const GRAVITY = 0.11;
const BALL_R = 9;
const SUBSTEPS = 6;          // flere små steg per tick, så ballen ikke går gjennom ting
const MAX_SPEED = 24;
const WALL_BOUNCE = 0.55;

const LANE_X = 670;          // midt i oppskytingskanalen
const LANE_REST_Y = 1180;    // der ballen hviler før oppskyting
const LANE_DIVIDER_X = 620;

const FLIPPER_LEN = 110;
const FLIPPER_R = 8;
const FLIP_UP_SPEED = 0.22;   // radianer per tick
const FLIP_DOWN_SPEED = 0.12;
const FLIPPER_BOUNCE = 0.3;

const BUMPER_KICK = 4;

// Vegger som linjestykker. Klienten tegner de samme veggene, så det du ser er det ballen treffer.
const walls = [
    { x1: 80, y1: 150, x2: 80, y2: 880 },       // venstre vegg
    { x1: 720, y1: 150, x2: 720, y2: 1300 },    // høyre vegg (ytterst i kanalen)
    { x1: 210, y1: 25, x2: 590, y2: 25 },       // tak
    { x1: 80, y1: 150, x2: 210, y2: 25 },       // skrått hjørne oppe til venstre
    { x1: 590, y1: 25, x2: 720, y2: 150 },      // skrått hjørne oppe til høyre (sender ballen ut av kanalen)
    { x1: LANE_DIVIDER_X, y1: 260, x2: LANE_DIVIDER_X, y2: 1300 }, // skillevegg mot kanalen
    // Ledeskinner ned mot flipperne. De ender i tangenten til flipper-pivoten,
    // så ballen ruller glatt over på flipperen i stedet for å bli liggende i en lomme.
    { x1: 80, y1: 870, x2: 236.7, y2: 1095.6 },
    { x1: 620, y1: 870, x2: 463.3, y2: 1095.6 },
];

const bumpers = [
    { x: 260, y: 300, r: 30, score: 50, color: '#ff6b6b', hitFlash: 0 },
    { x: 440, y: 300, r: 30, score: 50, color: '#4ecdc4', hitFlash: 0 },
    { x: 350, y: 440, r: 25, score: 100, color: '#ffe66d', hitFlash: 0 },
    { x: 200, y: 580, r: 25, score: 75, color: '#a8e6cf', hitFlash: 0 },
    { x: 500, y: 580, r: 25, score: 75, color: '#ff8b94', hitFlash: 0 },
];

const flippers = {
    left:  { px: 230, py: 1100, rest: 0.5, up: -0.45, angle: 0.5, av: 0, pressed: false },
    right: { px: 470, py: 1100, rest: Math.PI - 0.5, up: Math.PI + 0.45, angle: Math.PI - 0.5, av: 0, pressed: false },
};

const ball = { x: LANE_X, y: LANE_REST_Y, vx: 0, vy: 0, r: BALL_R, ready: true };

function resetBall() {
    ball.x = LANE_X;
    ball.y = LANE_REST_Y;
    ball.vx = 0;
    ball.vy = 0;
    ball.ready = true;
}

// Skyter ballen opp kanalen. Returnerer false hvis ballen ikke ligger klar.
function launch() {
    if (!ball.ready) return false;
    ball.ready = false;
    ball.vx = 0;
    ball.vy = -(17 + Math.random() * 2); // litt variasjon slik at ballen tar ulike veier
    return true;
}

function setFlipper(side, pressed) {
    if (flippers[side]) flippers[side].pressed = !!pressed;
}

function closestPoint(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return { x: x1 + t * dx, y: y1 + t * dy };
}

// Skyver ballen ut av et linjestykke med gitt tykkelse. Returnerer normalen ved treff.
function pushOut(x1, y1, x2, y2, thickness) {
    const c = closestPoint(ball.x, ball.y, x1, y1, x2, y2);
    const dx = ball.x - c.x, dy = ball.y - c.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = BALL_R + thickness;
    if (dist >= minDist || dist === 0) return null;
    const nx = dx / dist, ny = dy / dist;
    ball.x = c.x + nx * minDist;
    ball.y = c.y + ny * minDist;
    return { nx, ny, cx: c.x, cy: c.y };
}

function collideWalls() {
    for (const w of walls) {
        const hit = pushOut(w.x1, w.y1, w.x2, w.y2, 0);
        if (!hit) continue;
        const vn = ball.vx * hit.nx + ball.vy * hit.ny;
        if (vn < 0) {
            ball.vx -= (1 + WALL_BOUNCE) * vn * hit.nx;
            ball.vy -= (1 + WALL_BOUNCE) * vn * hit.ny;
        }
    }
}

function flipperTip(f) {
    return { x: f.px + Math.cos(f.angle) * FLIPPER_LEN, y: f.py + Math.sin(f.angle) * FLIPPER_LEN };
}

function moveFlipper(f) {
    const target = f.pressed ? f.up : f.rest;
    const speed = f.pressed ? FLIP_UP_SPEED : FLIP_DOWN_SPEED;
    const step = speed / SUBSTEPS;
    const diff = target - f.angle;
    if (Math.abs(diff) <= step) {
        f.angle = target;
        f.av = 0;
    } else {
        f.angle += Math.sign(diff) * step;
        f.av = Math.sign(diff) * speed;
    }
}

function collideFlipper(f) {
    const tip = flipperTip(f);
    const hit = pushOut(f.px, f.py, tip.x, tip.y, FLIPPER_R);
    if (!hit) return;
    // Flipperens fart i kontaktpunktet (rotasjon rundt pivot)
    const rx = hit.cx - f.px, ry = hit.cy - f.py;
    const sx = -f.av * ry, sy = f.av * rx;
    const rvx = ball.vx - sx, rvy = ball.vy - sy;
    const vn = rvx * hit.nx + rvy * hit.ny;
    if (vn < 0) {
        ball.vx = rvx - (1 + FLIPPER_BOUNCE) * vn * hit.nx + sx;
        ball.vy = rvy - (1 + FLIPPER_BOUNCE) * vn * hit.ny + sy;
    }
}

function collideBumpers(hits) {
    bumpers.forEach((b, i) => {
        const dx = ball.x - b.x, dy = ball.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= b.r + BALL_R) return;
        const nx = dx / (dist || 1), ny = dy / (dist || 1);
        ball.x = b.x + nx * (b.r + BALL_R);
        ball.y = b.y + ny * (b.r + BALL_R);
        const vn = ball.vx * nx + ball.vy * ny;
        if (vn < 0) {
            ball.vx -= 2 * vn * nx;
            ball.vy -= 2 * vn * ny;
        }
        ball.vx += nx * BUMPER_KICK;
        ball.vy += ny * BUMPER_KICK;
        // hitFlash fungerer også som pause, så ett treff gir poeng bare én gang
        if (b.hitFlash === 0) {
            b.hitFlash = 10;
            if (!hits.includes(i)) hits.push(i);
        }
    });
}

function clampSpeed() {
    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    if (speed > MAX_SPEED) {
        ball.vx *= MAX_SPEED / speed;
        ball.vy *= MAX_SPEED / speed;
    }
}

// Kjører én tick. Returnerer hva som skjedde: hvilke bumpere som ble truffet og om ballen gikk i avløpet.
function step() {
    const events = { hits: [], drained: false };

    for (const b of bumpers) {
        if (b.hitFlash > 0) b.hitFlash -= 1;
    }

    for (let i = 0; i < SUBSTEPS; i++) {
        moveFlipper(flippers.left);
        moveFlipper(flippers.right);
        if (ball.ready) continue;

        ball.vy += GRAVITY / SUBSTEPS;
        ball.x += ball.vx / SUBSTEPS;
        ball.y += ball.vy / SUBSTEPS;

        collideWalls();
        collideFlipper(flippers.left);
        collideFlipper(flippers.right);
        collideBumpers(events.hits);
        clampSpeed();

        // Ballen har falt tilbake til bunnen av kanalen: legg den klar for ny oppskyting
        if (ball.x > LANE_DIVIDER_X && ball.y >= LANE_REST_Y && ball.vy > 0) {
            resetBall();
        }
    }

    if (ball.y > H + 20) {
        events.drained = true;
        resetBall();
    }
    return events;
}

const layout = {
    W, H,
    ballR: BALL_R,
    walls,
    lane: { x: LANE_X, restY: LANE_REST_Y, dividerX: LANE_DIVIDER_X },
    flipper: {
        len: FLIPPER_LEN, r: FLIPPER_R,
        left: { px: flippers.left.px, py: flippers.left.py },
        right: { px: flippers.right.px, py: flippers.right.py },
    },
};

module.exports = { layout, ball, bumpers, flippers, step, launch, resetBall, setFlipper };
