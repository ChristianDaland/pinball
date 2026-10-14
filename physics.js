// Fysikk for pinball-brettet. Alle koordinater er i et 800x1300-brett,
// og alle hastigheter er i piksler per tick (60 ticks i sekundet).
//
// FAST for alle maskiner: yttervegger, tak, oppskytingskanal, enveisport, flippere og inlane-skinnene.
// ALT ANNET (bumpere, slingshots, avvisere, rollovers, drop targets, standups, kickback,
// spinnere, scoops) kommer fra maskinens board.json via loadBoard(). Se public/machines/<id>/board.json.
// Flere baller samtidig (multiball): balls[]; kollisjonsfunksjonene jobber på "ball", som settes
// til hver ball etter tur.

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

// Standardverdier for brettelementer (kan overstyres per element i board.json)
const BUMPER_KICK = 4;        // vanlig bumper
const POP_KICK = 7;           // pop bumper ("jet bumper") – sparker hardere
const SLING_KICK = 6;
const SLING_SCORE = 10;
const ROLLOVER_R = 13;
const TARGET_THICKNESS = 4;
const DROP_RESET_TICKS = 90;      // så lenge alle drop targets ligger nede før de spretter opp
const ROLLOVER_FLASH_TICKS = 60;  // blinking når alle rollovers er tent
const KICKBACK_SPEED = 13;
const SPINNER_SPIN = 0.045;       // hvor mye spinneren snurrer per fartsenhet
const SPINNER_FRICTION = 0.975;
const SCOOP_R = 16;
const SCOOP_CAPTURE_SPEED = 14;   // går ballen fortere enn dette, ruller den over hullet
const SCOOP_HOLD_TICKS = 50;      // så lenge scoopen holder ballen før den skyter den ut
const MULTIBALL_EJECT_GAP = 40;   // ticks mellom hver ekstra ball i multiball
const BALL_BOUNCE = 0.9;          // ball mot ball

// Brettet er speilsymmetrisk om x = 350 (midt mellom venstre vegg og kanalen)
const MID_X = 350;
const mirror = (p) => ({ x: 2 * MID_X - p.x, y: p.y });
const pt = (p) => Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y };

// Buet tak: halvsirkel over hele brettet, også over kanalen, så ballen glir langs buen og inn på brettet
const ARC = { cx: 400, cy: 345, r: 320, segments: 32 };

// Faste vegger. kind: 'wood' = trevegg, 'rail' = metallskinne, 'arc' = taket
const OUTER_WALLS = [
    { x1: 80, y1: ARC.cy, x2: 80, y2: 1300, kind: 'wood' },     // venstre vegg
    { x1: 720, y1: ARC.cy, x2: 720, y2: 1300, kind: 'wood' },   // høyre vegg (ytterst i kanalen)
    { x1: LANE_DIVIDER_X, y1: 260, x2: LANE_DIVIDER_X, y2: 1300, kind: 'rail' }, // skillevegg mot kanalen
];
for (let i = 0; i < ARC.segments; i++) {
    const a1 = Math.PI + (i / ARC.segments) * Math.PI;
    const a2 = Math.PI + ((i + 1) / ARC.segments) * Math.PI;
    OUTER_WALLS.push({
        x1: ARC.cx + Math.cos(a1) * ARC.r, y1: ARC.cy + Math.sin(a1) * ARC.r,
        x2: ARC.cx + Math.cos(a2) * ARC.r, y2: ARC.cy + Math.sin(a2) * ARC.r,
        kind: 'arc',
    });
}

// Enveisport der kanalen munner ut: fra skilleveggens topp og opp til taket. Ballen fra kanalen
// slipper fritt gjennom (mot venstre), men en ball fra spillefeltet spretter tilbake.
const GATE = { x1: LANE_DIVIDER_X, y1: ARC.cy - Math.sqrt(ARC.r ** 2 - (ARC.cx - LANE_DIVIDER_X) ** 2), x2: LANE_DIVIDER_X, y2: 260 };
let gateSwing = 0; // > 0 en liten stund etter at ballen har passert porten fra kanalen (bare til tegning)

// Inlane-skinner ned mot flipperne. De ender i tangenten til flipper-pivoten, så ballen ruller
// glatt over på flipperen. Mellom skinnen og ytterveggen er det en outlane som går rett i avløpet.
const GUIDE_TOP = { x: 125, y: 934.8 };
const GUIDE_END = { x: 236.7, y: 1095.6 };
const GUIDE_WALLS = [
    { x1: GUIDE_TOP.x, y1: GUIDE_TOP.y, x2: GUIDE_END.x, y2: GUIDE_END.y, kind: 'rail' },
    { x1: mirror(GUIDE_TOP).x, y1: GUIDE_TOP.y, x2: mirror(GUIDE_END).x, y2: GUIDE_END.y, kind: 'rail' },
];
// x-koordinaten til venstre inlane-skinne i høyde y (brukes til å finne outlanen)
const guideX = (y) => GUIDE_TOP.x + (y - GUIDE_TOP.y) / (GUIDE_END.y - GUIDE_TOP.y) * (GUIDE_END.x - GUIDE_TOP.x);

const flippers = {
    left:  { px: 230, py: 1100, rest: 0.5, up: -0.45, angle: 0.5, av: 0, pressed: false },
    right: { px: 470, py: 1100, rest: Math.PI - 0.5, up: Math.PI + 0.45, angle: Math.PI - 0.5, av: 0, pressed: false },
};

function makeBall() {
    return { x: LANE_X, y: LANE_REST_Y, vx: 0, vy: 0, r: BALL_R, ready: true, held: false };
}
const mainBall = makeBall(); // hovedballen gjenbrukes alltid når det er én ball igjen
let balls = [mainBall];
let ball = mainBall;        // ballen som simuleres akkurat nå
let pendingBalls = 0;       // ekstra baller som venter på å bli skutt ut fra scoopen (multiball)
let pendingTimer = 0;

/* ══════════════════════ BRETTET (fra board.json) ══════════════════════ */
let walls = [];        // alle linjestykker ballen spretter av (faste + brettets)
let deflectors = [];   // lukkede polygoner (tegnes fylt)
let bumpers = [];      // { x, y, r, score, kick, type: 'pop'|'bumper', color, icon, hitFlash }
let slingshots = [];   // { a, b, c, score, kick, flash }
let rollovers = [];    // { x, y, r, letter, score, lit, inside }
let rolloverFlash = 0; // > 0 mens alle rollovers blinker etter at de ble fullført
let dropBanks = [];    // { score, targets: [{ x1, y1, x2, y2, up }], resetTimer }
let standups = [];     // { x1, y1, x2, y2, score, flash }
let kickbacks = [];    // { side: 'left'|'right', lit }
let spinners = [];     // { x1, y1, x2, y2, score, angle, speed, half }
let scoops = [];       // { x, y, r, ejectVx, ejectVy, held: ball|null, timer, cooldown }
let layout = null;

// Bygger brettet fra et board-objekt (innholdet i board.json). "speil": true lager en speilet kopi.
function loadBoard(board) {
    board = board || {};
    const boardWalls = [];
    const rails = [];
    deflectors = [];
    for (const w of board.walls || []) {
        const polys = [w.points.map(pt)];
        if (w.speil) polys.push(polys[0].map(mirror));
        for (const poly of polys) {
            const n = w.closed ? poly.length : poly.length - 1;
            for (let i = 0; i < n; i++) {
                const p = poly[i], q = poly[(i + 1) % poly.length];
                (w.closed ? boardWalls : rails).push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, kind: w.closed ? 'deflector' : 'rail' });
            }
            if (w.closed) deflectors.push(poly);
        }
    }

    bumpers = [];
    const addBumper = (b, type) => {
        const list = [b];
        if (b.speil) list.push({ ...b, ...mirror(b) });
        for (const e of list) {
            bumpers.push({
                x: e.x, y: e.y, r: e.r || 25, score: e.score || 50, type,
                kick: e.kick || (type === 'pop' ? POP_KICK : BUMPER_KICK),
                color: e.color || null, icon: e.icon || null, hitFlash: 0,
            });
        }
    };
    for (const b of board.popBumpers || []) addBumper(b, 'pop');
    for (const b of board.bumpers || []) addBumper(b, 'bumper');

    slingshots = [];
    for (const s of board.slingshots || []) {
        const tri = [pt(s.a), pt(s.b), pt(s.c)];
        const list = [tri];
        if (s.speil) list.push(tri.map(mirror));
        for (const [a, b, c] of list) slingshots.push({ a, b, c, score: s.score || SLING_SCORE, kick: s.kick || SLING_KICK, flash: 0 });
    }

    // Rollovers: sensorer i baner øverst, adskilt av korte skinner
    rollovers = [];
    rolloverFlash = 0;
    const ro = board.rollovers;
    if (ro) {
        (ro.lanes || []).forEach((x, i) => rollovers.push({
            x, y: ro.y, r: ROLLOVER_R, letter: (ro.letters || '')[i] || '', score: ro.score || 50, lit: false, inside: false,
        }));
        for (const gx of ro.guides || []) {
            rails.push({ x1: gx, y1: ro.guideTop || ro.y - 40, x2: gx, y2: ro.guideBottom || ro.y + 30, kind: 'rail' });
        }
    }

    // Drop targets: en rad mål langs et linjestykke, delt i "count" deler med litt mellomrom
    dropBanks = [];
    for (const d of board.dropTargets || []) {
        const ends = [[pt(d.from), pt(d.to)]];
        if (d.speil) ends.push([mirror(pt(d.from)), mirror(pt(d.to))]);
        for (const [a, b] of ends) {
            const count = d.count || 3, targets = [];
            for (let i = 0; i < count; i++) {
                const t0 = (i + 0.1) / count, t1 = (i + 0.9) / count;
                targets.push({
                    x1: a.x + (b.x - a.x) * t0, y1: a.y + (b.y - a.y) * t0,
                    x2: a.x + (b.x - a.x) * t1, y2: a.y + (b.y - a.y) * t1, up: true,
                });
            }
            dropBanks.push({ score: d.score || 100, targets, resetTimer: 0 });
        }
    }

    standups = [];
    for (const s of board.standups || []) {
        const ends = [[pt(s.from), pt(s.to)]];
        if (s.speil) ends.push([mirror(pt(s.from)), mirror(pt(s.to))]);
        for (const [a, b] of ends) standups.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, score: s.score || 50, flash: 0 });
    }

    // Spinnere: ballen passerer gjennom; spinneren snurrer etter hvor fort ballen gikk
    spinners = [];
    for (const s of board.spinners || []) {
        const ends = [[pt(s.from), pt(s.to)]];
        if (s.speil) ends.push([mirror(pt(s.from)), mirror(pt(s.to))]);
        for (const [a, b] of ends) spinners.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, score: s.score || 25, angle: 0, speed: 0, half: 0 });
    }

    // Scoops: hull som fanger ballen og skyter den ut igjen i en fast retning (grader, 90 = rett ned)
    scoops = [];
    for (const s of board.scoops || []) {
        const a = (s.ejectAngle === undefined ? 110 : s.ejectAngle) * Math.PI / 180;
        const speed = s.ejectSpeed || 9;
        scoops.push({ x: s.x, y: s.y, r: s.r || SCOOP_R, score: s.score || 250,
            ejectVx: Math.cos(a) * speed, ejectVy: Math.sin(a) * speed, held: null, timer: 0, cooldown: 0 });
    }

    const kb = board.kickback;
    kickbacks = (kb === 'begge' ? ['left', 'right'] : kb === 'venstre' ? ['left'] : kb === 'høyre' ? ['right'] : [])
        .map(side => ({ side, lit: false }));

    // Rekkefølgen betyr litt for kollisjonene; den følger det opprinnelige brettet
    walls = [...OUTER_WALLS, ...boardWalls, ...GUIDE_WALLS, ...rails];

    layout = {
        W, H,
        ballR: BALL_R,
        walls,
        arc: ARC,
        deflectors,
        slingshots: slingshots.map(s => ({ a: s.a, b: s.b, c: s.c })),
        rollovers: rollovers.map(r => ({ x: r.x, y: r.y, r: r.r, letter: r.letter })),
        dropBanks: dropBanks.map(b => ({ targets: b.targets.map(t => ({ x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2 })) })),
        standups: standups.map(s => ({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 })),
        kickbacks: kickbacks.map(k => ({ side: k.side, x: k.side === 'left' ? 104 : 2 * MID_X - 104, y: 1060 })),
        spinners: spinners.map(s => ({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 })),
        scoops: scoops.map(s => ({ x: s.x, y: s.y, r: s.r, ejectVx: s.ejectVx, ejectVy: s.ejectVy })),
        lane: { x: LANE_X, restY: LANE_REST_Y, dividerX: LANE_DIVIDER_X },
        gate: GATE,
        flipper: {
            len: FLIPPER_LEN, r: FLIPPER_R,
            left: { px: flippers.left.px, py: flippers.left.py },
            right: { px: flippers.right.px, py: flippers.right.py },
        },
    };
    resetBall();
}

// Nytt spill: alle mål opp, alle lys av
function resetTable() {
    for (const r of rollovers) { r.lit = false; r.inside = false; }
    rolloverFlash = 0;
    for (const bank of dropBanks) { bank.targets.forEach(t => { t.up = true; }); bank.resetTimer = 0; }
    for (const k of kickbacks) k.lit = false;
    for (const s of spinners) { s.speed = 0; s.angle = 0; }
}

function placeInLane(b) {
    Object.assign(b, { x: LANE_X, y: LANE_REST_Y, vx: 0, vy: 0, ready: true, held: false });
}

// Én ball, klar i kanalen (alltid samme ball-objekt, så andre kan holde en referanse til den)
function resetBall() {
    balls = [mainBall];
    ball = mainBall;
    placeInLane(ball);
    pendingBalls = 0;
    pendingTimer = 0;
    for (const s of scoops) { s.held = null; s.timer = 0; s.cooldown = 0; }
}

// Multiball: legger til ekstra baller som skytes ut fra scoopen én etter én
function addBalls(count) {
    if (!scoops.length) return;
    pendingBalls += count;
    if (pendingTimer === 0) pendingTimer = 1;
}

const ballInLane = () => balls.find(b => b.ready) || null;

// Skyter ballen opp kanalen. power (0–1) er hvor langt fjæra ble trukket. Uten power velges en
// tilfeldig styrke. Returnerer false hvis ballen ikke ligger klar.
const LAUNCH_MIN = 15.8, LAUNCH_MAX = 20;
function launch(power) {
    const b = ballInLane();
    if (!b) return false;
    if (typeof power !== 'number' || !isFinite(power)) power = 0.4 + Math.random() * 0.6;
    power = Math.max(0, Math.min(1, power));
    b.ready = false;
    b.vx = 0;
    b.vy = -(LAUNCH_MIN + power * (LAUNCH_MAX - LAUNCH_MIN));
    return true;
}

function setFlipper(side, pressed) {
    if (flippers[side]) flippers[side].pressed = !!pressed;
}

// "Lane change": flipperknappene flytter de tente rollover-lysene én bane til venstre/høyre
function rotateRollovers(dir) {
    if (rollovers.length < 2 || rolloverFlash > 0) return;
    const lit = rollovers.map(r => r.lit);
    if (dir < 0) lit.push(lit.shift()); else lit.unshift(lit.pop());
    rollovers.forEach((r, i) => { r.lit = lit[i]; });
}

/* ══════════════════════ KOLLISJONER ══════════════════════ */
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

// Spretter ballen av en flate. Returnerer farten inn mot flaten (negativ når ballen var på vei inn).
function bounce(hit, restitution) {
    const vn = ball.vx * hit.nx + ball.vy * hit.ny;
    if (vn < 0) {
        ball.vx -= (1 + restitution) * vn * hit.nx;
        ball.vy -= (1 + restitution) * vn * hit.ny;
    }
    return vn;
}

function collideWalls() {
    for (const w of walls) {
        const hit = pushOut(w.x1, w.y1, w.x2, w.y2, 0);
        if (hit) bounce(hit, WALL_BOUNCE);
    }
}

function collideSlingshots(slingHits) {
    slingshots.forEach((s, i) => {
        // De to rette sidene er vanlige vegger
        for (const [p, q] of [[s.a, s.b], [s.b, s.c]]) {
            const hit = pushOut(p.x, p.y, q.x, q.y, 0);
            if (hit) bounce(hit, WALL_BOUNCE);
        }
        // Den skrå siden sparker ballen ut igjen
        const hit = pushOut(s.a.x, s.a.y, s.c.x, s.c.y, 0);
        if (!hit) return;
        const vn = bounce(hit, WALL_BOUNCE);
        if (vn < -1 && s.flash === 0) {
            ball.vx += hit.nx * s.kick;
            ball.vy += hit.ny * s.kick;
            s.flash = 8;
            slingHits.push(i);
        }
    });
}

// Porten stopper bare ball som er på spillefeltsiden (x < porten) og er på vei inn i kanalen
function collideGate() {
    if (ball.y < GATE.y1 - BALL_R || ball.y > GATE.y2 + BALL_R) return;
    if (ball.x >= GATE.x1) {
        if (ball.vx < 0 && ball.x - GATE.x1 < BALL_R) gateSwing = 12;
        return;
    }
    if (ball.vx <= 0) return;
    const hit = pushOut(GATE.x1, GATE.y1, GATE.x2, GATE.y2, 0);
    if (hit) bounce(hit, WALL_BOUNCE);
}

function collideDropTargets(events) {
    dropBanks.forEach((bank, bi) => {
        bank.targets.forEach((t, ti) => {
            if (!t.up) return;
            const hit = pushOut(t.x1, t.y1, t.x2, t.y2, TARGET_THICKNESS);
            if (!hit) return;
            const vn = bounce(hit, WALL_BOUNCE);
            if (vn < -1.5) {
                t.up = false;
                events.drops.push({ bank: bi, target: ti });
                if (bank.targets.every(x => !x.up)) {
                    bank.resetTimer = DROP_RESET_TICKS;
                    for (const k of kickbacks) k.lit = true;
                    events.dropsComplete.push(bi);
                }
            }
        });
    });
}

function collideStandups(events) {
    standups.forEach((s, i) => {
        const hit = pushOut(s.x1, s.y1, s.x2, s.y2, TARGET_THICKNESS);
        if (!hit) return;
        const vn = bounce(hit, WALL_BOUNCE);
        if (vn < -1 && s.flash === 0) {
            s.flash = 10;
            events.standups.push(i);
        }
    });
}

function checkRollovers(events) {
    rollovers.forEach((r, i) => {
        const d = Math.hypot(ball.x - r.x, ball.y - r.y);
        if (!r.inside && d < r.r) {
            r.inside = true;
            events.rollovers.push(i);
            if (rolloverFlash === 0) {
                r.lit = true;
                if (rollovers.every(x => x.lit)) {
                    rolloverFlash = ROLLOVER_FLASH_TICKS;
                    events.rolloversComplete = true;
                }
            }
        } else if (r.inside && d > r.r + 6) {
            r.inside = false;
        }
    });
}

// Kickback: tent kickback slår ballen opp igjen når den er på vei ned i outlanen
function checkKickbacks(events) {
    if (ball.vy <= 0 || ball.y < 1030 || ball.y > 1080) return;
    for (const k of kickbacks) {
        if (!k.lit) continue;
        const inLeft = k.side === 'left' && ball.x < guideX(ball.y) - BALL_R - 2;
        const inRight = k.side === 'right' && ball.x > 2 * MID_X - guideX(ball.y) + BALL_R + 2 && ball.x < LANE_DIVIDER_X;
        if (inLeft || inRight) {
            k.lit = false;
            ball.vx = k.side === 'left' ? 0.4 : -0.4;
            ball.vy = -KICKBACK_SPEED;
            events.kickback = true;
        }
    }
}

// Spinner: ballen krysser linjen (fra hvilken som helst side) → spinneren får fart etter ballens fart
function checkSpinners(px, py) {
    for (const s of spinners) {
        const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
        const before = dx * (py - s.y1) - dy * (px - s.x1);
        const after = dx * (ball.y - s.y1) - dy * (ball.x - s.x1);
        if ((before < 0) === (after < 0)) continue;
        // Krysset innenfor spinnerens bredde?
        const lenSq = dx * dx + dy * dy;
        const tm = ((ball.x - s.x1) * dx + (ball.y - s.y1) * dy) / lenSq;
        if (tm < 0 || tm > 1) continue;
        const speed = Math.hypot(ball.vx, ball.vy);
        s.speed = Math.min(0.8, Math.max(s.speed, speed * SPINNER_SPIN));
    }
}

function updateSpinners(events) {
    spinners.forEach((s, i) => {
        if (s.speed < 0.01) { s.speed = 0; return; }
        s.angle += s.speed;
        s.speed *= SPINNER_FRICTION;
        const half = Math.floor(s.angle / Math.PI);
        if (half > s.half) { s.half = half; events.spins.push(i); }
    });
}

// Scoop: fanger ballen hvis den ikke går for fort
function checkScoops(events) {
    scoops.forEach((s, i) => {
        if (s.held || s.cooldown > 0) return;
        if (Math.hypot(ball.x - s.x, ball.y - s.y) >= s.r) return;
        if (Math.hypot(ball.vx, ball.vy) > SCOOP_CAPTURE_SPEED) return;
        Object.assign(ball, { x: s.x, y: s.y, vx: 0, vy: 0, held: true });
        s.held = ball;
        s.timer = SCOOP_HOLD_TICKS;
        events.scoops.push(i);
    });
}

function ejectFromScoop(s) {
    const b = s.held;
    const sp = Math.hypot(s.ejectVx, s.ejectVy);
    Object.assign(b, {
        held: false, vx: s.ejectVx, vy: s.ejectVy,
        x: s.x + s.ejectVx / sp * (s.r + BALL_R + 1), y: s.y + s.ejectVy / sp * (s.r + BALL_R + 1),
    });
    s.held = null;
    s.cooldown = 30;
}

// Scoopene teller ned og skyter ut; ekstra multiball-baller dukker opp i den første scoopen
function updateScoops() {
    for (const s of scoops) {
        if (s.cooldown > 0) s.cooldown -= 1;
        if (s.held && --s.timer <= 0) ejectFromScoop(s);
    }
    if (pendingBalls > 0 && --pendingTimer <= 0) {
        const s = scoops[0];
        if (s.held) { pendingTimer = 5; return; }
        const b = makeBall();
        Object.assign(b, { x: s.x, y: s.y, ready: false, held: true });
        balls.push(b);
        s.held = b;
        s.timer = 15;
        pendingBalls -= 1;
        pendingTimer = pendingBalls > 0 ? MULTIBALL_EJECT_GAP : 0;
    }
}

// Ball mot ball (like tunge): skyv fra hverandre og bytt fart langs treffretningen
function collideBalls() {
    for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        if (a.ready || a.held) continue;
        for (let j = i + 1; j < balls.length; j++) {
            const b = balls[j];
            if (b.ready || b.held) continue;
            const dx = b.x - a.x, dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            if (dist >= 2 * BALL_R || dist === 0) continue;
            const nx = dx / dist, ny = dy / dist, overlap = (2 * BALL_R - dist) / 2;
            a.x -= nx * overlap; a.y -= ny * overlap;
            b.x += nx * overlap; b.y += ny * overlap;
            const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (vn < 0) {
                const j2 = -(1 + BALL_BOUNCE) * vn / 2;
                a.vx -= j2 * nx; a.vy -= j2 * ny;
                b.vx += j2 * nx; b.vy += j2 * ny;
            }
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
        ball.vx += nx * b.kick;
        ball.vy += ny * b.kick;
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

// Drop targets spretter opp igjen etter en stund – men ikke oppå ballen
function updateDropBanks() {
    for (const bank of dropBanks) {
        if (bank.resetTimer <= 0) continue;
        bank.resetTimer -= 1;
        if (bank.resetTimer > 0) continue;
        const blocked = bank.targets.some(t => {
            const c = closestPoint(ball.x, ball.y, t.x1, t.y1, t.x2, t.y2);
            return Math.hypot(ball.x - c.x, ball.y - c.y) < BALL_R + TARGET_THICKNESS + 4;
        });
        if (blocked) bank.resetTimer = 10;
        else bank.targets.forEach(t => { t.up = true; });
    }
}

// Kjører én tick. Returnerer hva som skjedde, så serveren kan gi poeng og spille lyder.
// drained = den siste ballen er tapt; lostBalls = baller tapt mens andre fortsatt er i spill (multiball).
function step() {
    const events = {
        hits: [], slings: [], rollovers: [], rolloversComplete: false,
        drops: [], dropsComplete: [], standups: [], kickback: false,
        spins: [], scoops: [], lostBalls: 0, drained: false,
    };

    for (const b of bumpers) {
        if (b.hitFlash > 0) b.hitFlash -= 1;
    }
    for (const s of slingshots) {
        if (s.flash > 0) s.flash -= 1;
    }
    for (const s of standups) {
        if (s.flash > 0) s.flash -= 1;
    }
    if (gateSwing > 0) gateSwing -= 1;
    if (rolloverFlash > 0) {
        rolloverFlash -= 1;
        if (rolloverFlash === 0) rollovers.forEach(r => { r.lit = false; });
    }
    updateDropBanks();
    updateSpinners(events);
    updateScoops();

    for (let i = 0; i < SUBSTEPS; i++) {
        moveFlipper(flippers.left);
        moveFlipper(flippers.right);
        for (const b of balls) {
            if (b.ready || b.held) continue;
            ball = b;
            const px = ball.x, py = ball.y;

            ball.vy += GRAVITY / SUBSTEPS;
            ball.x += ball.vx / SUBSTEPS;
            ball.y += ball.vy / SUBSTEPS;

            collideWalls();
            collideGate();
            collideSlingshots(events.slings);
            collideDropTargets(events);
            collideStandups(events);
            collideFlipper(flippers.left);
            collideFlipper(flippers.right);
            collideBumpers(events.hits);
            checkRollovers(events);
            checkKickbacks(events);
            checkSpinners(px, py);
            checkScoops(events);
            clampSpeed();

            // Ballen har falt tilbake til bunnen av kanalen: legg den klar for ny oppskyting
            if (ball.x > LANE_DIVIDER_X && ball.y >= LANE_REST_Y && ball.vy > 0) {
                placeInLane(ball);
            }
        }
        if (balls.length > 1) collideBalls();
    }

    // Baller i avløpet
    const lost = balls.filter(b => b.y > H + 20);
    if (lost.length) {
        balls = balls.filter(b => b.y <= H + 20);
        if (balls.length === 0 && pendingBalls === 0) {
            resetBall();
            events.drained = true;
            events.lostBalls = lost.length - 1;
        } else {
            events.lostBalls = lost.length;
        }
    }
    ball = balls[0] || ball;
    return events;
}

// Brettets tilstand som endrer seg (sendes til klientene sammen med resten av state)
function tableState() {
    return {
        rollovers: rollovers.map(r => r.lit),
        rolloverFlash: rolloverFlash > 0,
        drops: dropBanks.map(b => b.targets.map(t => t.up)),
        standupFlash: standups.map(s => s.flash),
        kickbacks: kickbacks.map(k => k.lit),
        gateOpen: gateSwing > 0,
        spinners: spinners.map(s => s.angle),
        multiball: balls.length + pendingBalls > 1,
    };
}

loadBoard(null);

module.exports = {
    // "ball" er ballen i kanalen hvis det finnes en, ellers den første ballen
    get ball() { return ballInLane() || balls[0] || ball; },
    get balls() { return balls; },
    get pendingBalls() { return pendingBalls; },
    get layout() { return layout; },
    get bumpers() { return bumpers; },
    get slingshots() { return slingshots; },
    get rollovers() { return rollovers; },
    get dropBanks() { return dropBanks; },
    get standups() { return standups; },
    get spinners() { return spinners; },
    get scoops() { return scoops; },
    flippers,
    loadBoard, resetTable, step, launch, resetBall, addBalls, setFlipper, rotateRollovers, tableState,
};
