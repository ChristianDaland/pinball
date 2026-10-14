/* ══════════════════════ PINBALL-TEGNEMOTOR ══════════════════════
   Tegner brettet ut fra layout (fra serveren), state (60/s fra serveren) og et TEMA.
   Motoren vet ingenting om gårder eller verdensrom – alt utseende kommer fra temaet.

   Et tema registreres i public/machines/<id>/theme.js:
       PinballThemes['<id>'] = { title, bumperIcons, colors: {...}, ... };
   Alt som ikke er satt i temaet, hentes fra DEFAULT_THEME under.
   Se DEFAULT_THEME for hvilke verdier som finnes.
*/
window.PinballThemes = window.PinballThemes || {};

const PinballRenderer = (() => {
  const BW = 800, BH = 1300; // brettets koordinater; alt tegnes i disse og skaleres med S

  const DEFAULT_THEME = {
    title: 'PINBALL',                 // teksten i displayet øverst på brettet
    bumperIcons: ['★', '★', '★', '★', '★'], // emoji/tegn midt på hver bumper (i samme rekkefølge som i physics.js)
    bumperColors: null,               // farge per bumper; null = fargene fra physics.js
    colors: {
      page: '#120b05',                // bakgrunnen rundt brettet
      cabinet: ['#4a2a12', '#7a4a22', '#6b3f1c', '#7a4a22', '#4a2a12'], // skapet, gradient fra venstre til høyre
      cabinetGrain: null,             // farge på årer i skapet (null = ingen)
      cabinetEdge: 'rgba(30,15,5,0.7)',
      cabinetEdgeLight: 'rgba(255,210,150,0.18)',
      playfield: ['#173a1e', '#1f4d29', '#215a2c', '#122e17'], // spillefeltet, gradient ovenfra og ned
      sheen: 'rgba(255,255,255,0.05)', // glassrefleks
      lane: ['#2a1a0c', '#3c2612'],   // oppskytingskanalen
      drainShade: 'rgba(0,0,0,0.75)',
      vignette: 'rgba(0,0,0,0.45)',
      frame: '#3a2210',               // rammen rundt spillefeltet
      frameTrim: '#c4963b',
      rail: ['#4d4d4d', '#b8bcc2', 'rgba(255,255,255,0.75)'], // metallskinner: kant, midte, refleks
      deflector: ['#8b5e34', '#5c3a1e'],
      deflectorEdge: '#c0c4ca',
      sling: ['#9a6a3c', '#5c3a1e'],
      slingEdge: '#3a2210',
      slingInset: 'rgba(255,210,150,0.35)',
      rivet: ['#d0d4da', '#6a6a6a'],
      rubber: '#efe9dc',              // gummistrikken på slingshots
      rubberFlash: '#ffe08a',
      rubberGlow: '#ffcc55',
      slingParticles: '#ffcc55',
      led: ['rgba(255,240,200,1)', 'rgba(255,190,70,0.95)', 'rgba(255,150,30,0.35)', 'rgba(255,140,20,0)'],
      spring: '#c9a227',
      plungerHead: ['#8b6914', '#e0c07a'],
      label: '#ffcc55',               // "SKYV!" ved kanalen
      bumperFace: '#f3e6c4',
      bumperRim: '#7a5a30',
      bumperInner: ['#fff8e6', '#e8d6ac'],
      bumperScore: '#f3e6c4',
      flipper: ['#ffffff', '#e4e6ea', '#a9adb3'],
      flipperEdge: '#7d828a',
      flipperGlow: '#fff4c0',
      bolt: ['#f4f4f4', '#6a6e74'],
      ball: ['#ffffff', '#e2e4e8', '#8e939a', '#4e5258'],
      ballReflection: 'rgba(80,160,90,0.35)', // refleks av brettet i ballen
      displayFrame: ['#5a5e64', '#d8dbe0', '#6e7278'],
      displayBg: '#140d06',
      displayDots: 'rgba(255,140,30,0.06)',
      displayText: '#ffb347',
      displayGlow: '#ff9a1f',
      hudText: '#f3e6c4',
      gameOver: '#ffcc55',
      gameOverGlow: '#ffaa22',
      // Brettelementer fra board.json
      popSkirt: '#3a2a18',            // "skjørtet" rundt pop bumpers
      rolloverOn: '#ffcc55',          // rollover-knapp når bokstaven er tent
      rolloverOff: '#3a2a14',
      rolloverText: '#1a1005',
      dropTarget: ['#ffe9a8', '#c9962f'], // drop target (lys, mørk)
      dropSlot: 'rgba(0,0,0,0.55)',   // sporet når målet ligger nede
      standup: ['#ffffff', '#9fb0c0'],
      standupFlash: '#fff4c0',
      lightOn: '#ff6b3d',             // innfelte lys: kickback, ball save, multiplikator
      lightOff: 'rgba(60,30,20,0.6)',
      lightText: '#ffffff',
      callout: '#ffcc55',             // store meldinger midt på brettet (BALL SAVED!, ×3 …)
    },
    // Valgfrie tegnefunksjoner for pynt. g er et 2D-kontekst i brettkoordinater, api har hjelpere.
    decorateCabinet: null,    // (g, api) – tegnes oppå skapet (utskjæringer, logoer …)
    decoratePlayfield: null,  // (g, api) – tegnes på spillefeltet, under bumpere og skinner
    // Lyder: se engine/sound.js. Hver funksjon får lydmotoren s og hendelsen e.
    sounds: {},
  };

  let canvas, ctx, S = 1;
  let layout = null;
  let T = DEFAULT_THEME, C = DEFAULT_THEME.colors;
  let particles = [];
  let ledFlash = 0;
  let glowSprite = null;
  const staticLayer = document.createElement('canvas');
  let staticDirty = true;

  /* ── HJELPERE ── */
  // Fast tilfeldig tallrekke, så dekorasjonene ser like ut hver gang brettet tegnes på nytt
  function seeded(seed) {
    return () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function lighten(hex, amt) {
    let r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `rgb(${Math.min(255,r+amt)},${Math.min(255,g+amt)},${Math.min(255,b+amt)})`;
  }
  function darken(hex, amt) {
    let r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `rgb(${Math.max(0,r-amt)},${Math.max(0,g-amt)},${Math.max(0,b-amt)})`;
  }

  // Lager en ensfarget silhuett av en emoji (f.eks. "utskjæringer" i treverket)
  function silhouette(emoji, size, color, flip) {
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(size * 1.3);
    const g = c.getContext('2d');
    if (flip) { g.translate(c.width, 0); g.scale(-1, 1); }
    g.font = `${size}px serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(emoji, c.width / 2, c.height / 2);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // Ferdigtegnet lysglorie for LED-ene (mye raskere enn shadowBlur på hvert lys)
  function makeGlowSprite() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, C.led[0]);
    grad.addColorStop(0.15, C.led[1]);
    grad.addColorStop(0.4, C.led[2]);
    grad.addColorStop(1, C.led[3]);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  // Gradient med jevnt fordelte fargestopp
  function stops(grad, colors) {
    colors.forEach((c, i) => grad.addColorStop(colors.length === 1 ? 0 : i / (colors.length - 1), c));
    return grad;
  }

  const api = { W: BW, H: BH, seeded, lighten, darken, silhouette, stops };

  function playfieldPath(g) {
    g.beginPath();
    g.moveTo(80, BH);
    g.lineTo(80, 345);
    g.arc(400, 345, 320, Math.PI, Math.PI * 2);
    g.lineTo(720, BH);
    g.closePath();
  }

  /* ══════════════════════ STATISK LAG ══════════════════════ */
  // Skap, bakgrunn, vegger og skinner endrer seg aldri, så de tegnes én gang til et eget lerret
  function buildStatic() {
    staticLayer.width = canvas.width;
    staticLayer.height = canvas.height;
    const g = staticLayer.getContext('2d');
    g.setTransform(S, 0, 0, S, 0, 0);
    drawCabinet(g);
    drawPlayfield(g);
    if (layout) {
      drawRails(g);
      drawDeflectors(g);
      drawSlingshotBodies(g);
    }
    staticDirty = false;
  }

  function drawCabinet(g) {
    const wood = g.createLinearGradient(0, 0, BW, 0);
    const cab = C.cabinet;
    if (cab.length === 5) {
      // Klassisk skap: mørke kanter, lyse lister og flat midte
      [0, 0.08, 0.5, 0.92, 1].forEach((p, i) => wood.addColorStop(p, cab[i]));
    } else {
      stops(wood, cab);
    }
    g.fillStyle = wood;
    g.fillRect(0, 0, BW, BH);

    // Årer i treverket
    if (C.cabinetGrain) {
      const rnd = seeded(7);
      g.save();
      g.globalAlpha = 0.18;
      g.strokeStyle = C.cabinetGrain;
      g.lineWidth = 1;
      for (let i = 0; i < 70; i++) {
        const x = rnd() * BW, amp = 2 + rnd() * 5, ph = rnd() * 10;
        g.beginPath();
        for (let y = 0; y <= BH; y += 20) g.lineTo(x + Math.sin(y * 0.01 + ph) * amp, y);
        g.stroke();
      }
      g.restore();
    }

    // Fresede kanter rundt hele skapet
    g.save();
    g.strokeStyle = C.cabinetEdge;
    g.lineWidth = 4;
    g.strokeRect(10, 10, BW - 20, BH - 20);
    g.strokeStyle = C.cabinetEdgeLight;
    g.lineWidth = 2;
    g.strokeRect(15, 15, BW - 30, BH - 30);
    g.restore();

    if (T.decorateCabinet) {
      g.save();
      T.decorateCabinet(g, api);
      g.restore();
    }
  }

  function drawPlayfield(g) {
    g.save();
    playfieldPath(g);
    g.clip();

    const bg = g.createLinearGradient(0, 0, 0, BH);
    const pf = C.playfield;
    if (pf.length === 4) {
      [0, 0.45, 0.8, 1].forEach((p, i) => bg.addColorStop(p, pf[i]));
    } else {
      stops(bg, pf);
    }
    g.fillStyle = bg;
    g.fillRect(0, 0, BW, BH);

    if (T.decoratePlayfield) {
      g.save();
      T.decoratePlayfield(g, api);
      g.restore();
    }

    // Glassrefleks på skrå over brettet
    const sheen = g.createLinearGradient(250, 0, 650, 500);
    sheen.addColorStop(0, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.5, C.sheen);
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sheen;
    g.fillRect(0, 0, BW, BH);

    // Oppskytingskanalen
    const lane = g.createLinearGradient(620, 0, 720, 0);
    lane.addColorStop(0, C.lane[0]);
    lane.addColorStop(1, C.lane[1]);
    g.fillStyle = lane;
    g.fillRect(620, 260, 100, BH - 260);

    // Mørkt avløp nederst
    const drain = g.createLinearGradient(0, 1150, 0, BH);
    drain.addColorStop(0, 'rgba(0,0,0,0)');
    drain.addColorStop(1, C.drainShade);
    g.fillStyle = drain;
    g.fillRect(80, 1150, 540, 150);

    // Vignett
    const vig = g.createRadialGradient(350, 600, 200, 350, 600, 800);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, C.vignette);
    g.fillStyle = vig;
    g.fillRect(0, 0, BW, BH);
    g.restore();

    // Ramme rundt spillefeltet (taket og ytterveggene)
    g.save();
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(80, BH);
    g.lineTo(80, 345);
    g.arc(400, 345, 320, Math.PI, Math.PI * 2);
    g.lineTo(720, BH);
    g.strokeStyle = C.frame;
    g.lineWidth = 12;
    g.stroke();
    g.strokeStyle = C.frameTrim;
    g.lineWidth = 2;
    g.stroke();
    g.restore();
  }

  // Metallskinne: mørk kant, lys midte og et skinn av refleks
  function metalLine(g, x1, y1, x2, y2, width) {
    g.save();
    g.lineCap = 'round';
    g.strokeStyle = C.rail[0];
    g.lineWidth = width + 2;
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    g.strokeStyle = C.rail[1];
    g.lineWidth = width;
    g.stroke();
    g.strokeStyle = C.rail[2];
    g.lineWidth = width * 0.3;
    g.stroke();
    g.restore();
  }

  function drawRails(g) {
    layout.walls.filter(w => w.kind === 'rail').forEach(w => metalLine(g, w.x1, w.y1, w.x2, w.y2, 5));
    // Ytre metallskinne langs kanalen
    metalLine(g, 706, 360, 706, 1270, 3);
  }

  function drawDeflectors(g) {
    layout.deflectors.forEach(poly => {
      g.save();
      g.beginPath();
      poly.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y));
      g.closePath();
      const grad = g.createLinearGradient(poly[0].x, poly[0].y, poly[1].x, poly[1].y);
      grad.addColorStop(0, C.deflector[0]);
      grad.addColorStop(1, C.deflector[1]);
      g.fillStyle = grad;
      g.fill();
      g.strokeStyle = C.deflectorEdge;
      g.lineWidth = 3;
      g.stroke();
      g.restore();
    });
  }

  function drawSlingshotBodies(g) {
    layout.slingshots.forEach(s => {
      g.save();
      g.beginPath();
      g.moveTo(s.a.x, s.a.y); g.lineTo(s.b.x, s.b.y); g.lineTo(s.c.x, s.c.y); g.closePath();
      const grad = g.createLinearGradient(s.a.x, s.a.y, s.c.x, s.c.y);
      grad.addColorStop(0, C.sling[0]);
      grad.addColorStop(1, C.sling[1]);
      g.fillStyle = grad;
      g.fill();
      g.strokeStyle = C.slingEdge;
      g.lineWidth = 3;
      g.stroke();
      // Innfelt plate og nagler
      const cx = (s.a.x + s.b.x + s.c.x) / 3, cy = (s.a.y + s.b.y + s.c.y) / 3;
      g.beginPath();
      [s.a, s.b, s.c].forEach((p, i) => {
        const x = cx + (p.x - cx) * 0.6, y = cy + (p.y - cy) * 0.6;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.closePath();
      g.strokeStyle = C.slingInset;
      g.lineWidth = 2;
      g.stroke();
      [s.a, s.b, s.c].forEach(p => {
        const x = cx + (p.x - cx) * 0.8, y = cy + (p.y - cy) * 0.8;
        g.fillStyle = C.rivet[0];
        g.beginPath(); g.arc(x, y, 3.2, 0, Math.PI * 2); g.fill();
        g.fillStyle = C.rivet[1];
        g.beginPath(); g.arc(x + 0.8, y + 0.8, 1.2, 0, Math.PI * 2); g.fill();
      });
      g.restore();
    });
  }

  /* ══════════════════════ DYNAMISKE ELEMENTER ══════════════════════ */
  // LED-lys langs buen og sidene, med et "løpelys" og blink ved treff
  const leds = [];
  for (let a = Math.PI + 0.06; a < Math.PI * 2 - 0.04; a += 0.085) leds.push({ x: 400 + Math.cos(a) * 335, y: 345 + Math.sin(a) * 335 });
  for (let y = 380; y < 1280; y += 34) { leds.push({ x: 64, y }); leds.push({ x: 736, y }); }
  leds.sort((p, q) => Math.atan2(p.y - 600, p.x - 400) - Math.atan2(q.y - 600, q.x - 400));

  function drawLeds(now) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    leds.forEach((p, i) => {
      const chase = Math.pow(Math.max(0, Math.sin(now * 0.004 - i * 0.35)), 6);
      const a = Math.min(1, 0.3 + chase * 0.7 + ledFlash * 0.7);
      ctx.globalAlpha = a;
      ctx.drawImage(glowSprite, p.x - 11, p.y - 11, 22, 22);
    });
    ctx.restore();
    ledFlash = Math.max(0, ledFlash - 0.06);
  }

  function drawSlingRubbers(state) {
    if (!layout) return;
    layout.slingshots.forEach((s, i) => {
      const flash = (state.slingFlash[i] || 0) / 8;
      // Gummistrikken spretter litt ut når den sparker
      const dx = s.c.x - s.a.x, dy = s.c.y - s.a.y, len = Math.hypot(dx, dy);
      let nx = dy / len, ny = -dx / len;
      if (nx * (350 - s.a.x) < 0) { nx = -nx; ny = -ny; }
      const off = flash * 5;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.shadowColor = C.rubberGlow;
      ctx.shadowBlur = flash * 25 * S;
      ctx.strokeStyle = flash > 0 ? C.rubberFlash : C.rubber;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(s.a.x + nx * off, s.a.y + ny * off);
      ctx.lineTo(s.c.x + nx * off, s.c.y + ny * off);
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawPlunger(state) {
    const pull = state.ball.ready ? state.plunger || 0 : 0;
    const x = 670, top = 1192 + pull * 40, bottom = 1292;
    ctx.save();
    // Fjær
    ctx.strokeStyle = C.spring;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, top);
    const coils = 9;
    for (let i = 1; i <= coils; i++) ctx.lineTo(x + (i % 2 ? 11 : -11), top + (bottom - top) * i / coils);
    ctx.stroke();
    // Stempelhode
    const head = ctx.createLinearGradient(x - 16, 0, x + 16, 0);
    head.addColorStop(0, C.plungerHead[0]);
    head.addColorStop(0.5, C.plungerHead[1]);
    head.addColorStop(1, C.plungerHead[0]);
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.roundRect(x - 16, top - 4, 32, 8, 3);
    ctx.fill();
    ctx.restore();

    // Ladeindikator ved siden av kanalen
    if (pull > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(626, 1000, 8, 150);
      ctx.fillStyle = `hsl(${40 - pull * 40}, 100%, 55%)`;
      ctx.fillRect(626, 1150 - pull * 150, 8, pull * 150);
      ctx.restore();
    }
  }

  function drawPlungerLabel(state, now) {
    if (!state.ball.ready || state.plunger > 0) return;
    ctx.save();
    ctx.globalAlpha = 0.45 + 0.35 * Math.sin(now / 200);
    ctx.fillStyle = C.label;
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(670, 1040);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('SKYV! ▶', 0, 0);
    ctx.restore();
  }

  // Farge og ikon kan settes per bumper i board.json; ellers brukes temaets lister
  function bumperColor(b, i) {
    return b.color || (T.bumperColors && T.bumperColors[i]) || '#ff6b6b';
  }

  /* ── elementer fra board.json ── */
  // Innfelt rundt lys med tekst (kickback, ball save, multiplikator)
  function insertLight(x, y, r, text, on, now) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.arc(0, 0, r + 2, 0, Math.PI * 2); ctx.fill();
    if (on) {
      ctx.shadowColor = C.lightOn;
      ctx.shadowBlur = (10 + 6 * Math.sin(now / 120)) * S;
    }
    ctx.fillStyle = on ? C.lightOn : C.lightOff;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = on ? C.lightText : 'rgba(255,255,255,0.35)';
    ctx.font = `bold ${Math.round(r * 0.8)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 1);
    ctx.restore();
  }

  function drawRollovers(state, now) {
    if (!layout || !layout.rollovers) return;
    const tbl = state.table || {};
    const blink = tbl.rolloverFlash && Math.floor(now / 120) % 2 === 0;
    layout.rollovers.forEach((r, i) => {
      const lit = tbl.rolloverFlash ? blink : (tbl.rollovers || [])[i];
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath(); ctx.arc(0, 0, r.r + 3, 0, Math.PI * 2); ctx.fill();
      if (lit) { ctx.shadowColor = C.rolloverOn; ctx.shadowBlur = 14 * S; }
      ctx.fillStyle = lit ? C.rolloverOn : C.rolloverOff;
      ctx.beginPath(); ctx.arc(0, 0, r.r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = lit ? C.rolloverText : 'rgba(255,255,255,0.4)';
      ctx.font = `bold ${Math.round(r.r * 1.15)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(r.letter, 0, 1);
      ctx.restore();
    });
  }

  // Tykk, avrundet plate langs et linjestykke
  function plate(x1, y1, x2, y2, width, colors, glow) {
    ctx.save();
    ctx.lineCap = 'round';
    if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 16 * S; }
    ctx.strokeStyle = colors[1];
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = colors[0];
    ctx.lineWidth = width * 0.45;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }

  function drawTargets(state) {
    if (!layout) return;
    const tbl = state.table || {};
    (layout.dropBanks || []).forEach((bank, bi) => {
      bank.targets.forEach((t, ti) => {
        const up = !tbl.drops || (tbl.drops[bi] || [])[ti] !== false;
        if (up) {
          plate(t.x1, t.y1, t.x2, t.y2, 10, C.dropTarget);
        } else {
          ctx.save();
          ctx.strokeStyle = C.dropSlot;
          ctx.lineWidth = 4;
          ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke();
          ctx.restore();
        }
      });
    });
    (layout.standups || []).forEach((s, i) => {
      const flash = ((tbl.standupFlash || [])[i] || 0) > 0;
      plate(s.x1, s.y1, s.x2, s.y2, 10, flash ? [C.standupFlash, C.standupFlash] : C.standup, flash ? C.standupFlash : null);
    });
  }

  // Lys for kickback (i outlanen), ball save (mellom flipperne) og multiplikator (midt nede)
  function drawLights(state, now) {
    if (!layout) return;
    const tbl = state.table || {};
    (layout.kickbacks || []).forEach((k, i) => insertLight(k.x, k.y, 13, '⬆', (tbl.kickbacks || [])[i], now));
    insertLight(350, 1176, 12, '↺', !!state.ballSave, now);
    const mults = (state.multipliers || []).filter(m => m > 1);
    mults.forEach((m, i) => {
      const x = 350 + (i - (mults.length - 1) / 2) * 40;
      insertLight(x, 880, 15, m + '×', (state.multiplier || 1) >= m, now);
    });
  }

  // Store meldinger midt på brettet som blekner ut
  let callouts = [];
  function callout(text) {
    callouts.push({ text, life: 90 });
  }
  function drawCallouts() {
    callouts = callouts.filter(c => --c.life > 0);
    callouts.forEach((c, i) => {
      const a = Math.min(1, c.life / 30);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${44 + (90 - c.life) * 0.15}px sans-serif`;
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      const y = 760 - i * 56;
      ctx.strokeText(c.text, 350, y);
      ctx.shadowColor = C.callout;
      ctx.shadowBlur = 18 * S;
      ctx.fillStyle = C.callout;
      ctx.fillText(c.text, 350, y);
      ctx.restore();
    });
  }

  function drawBumpers(state) {
    const icons = T.bumperIcons;
    state.bumpers.forEach((b, i) => {
      const flash = b.hitFlash / 10;
      const color = bumperColor(b, i);
      const r = b.r * (1 + flash * 0.06);

      ctx.save();
      ctx.translate(b.x, b.y);

      // Skygge og glød ved treff
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.arc(3, 5, r + 3, 0, Math.PI * 2); ctx.fill();
      if (flash > 0) {
        const glow = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r + 26 * flash);
        glow.addColorStop(0, color);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.8 * flash;
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(0, 0, r + 26 * flash, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Pop bumpers har et mørkt "skjørt" med en lysende ring
      if (b.type === 'pop') {
        ctx.fillStyle = C.popSkirt;
        ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = flash > 0 ? '#ffffff' : color;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0, 0, r + 4, 0, Math.PI * 2); ctx.stroke();
      }

      // Skive med kant
      ctx.fillStyle = C.bumperFace;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = C.bumperRim;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Solstråle-ring
      const points = 16;
      ctx.fillStyle = flash > 0 ? lighten(color, 60) : color;
      ctx.beginPath();
      for (let k = 0; k < points * 2; k++) {
        const a = (k / (points * 2)) * Math.PI * 2;
        const rad = k % 2 === 0 ? r * 0.94 : r * 0.68;
        k ? ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad) : ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      ctx.closePath();
      ctx.fill();

      // Indre skive
      const inner = ctx.createRadialGradient(-r * 0.2, -r * 0.2, 1, 0, 0, r * 0.62);
      inner.addColorStop(0, flash > 0 ? '#ffffff' : C.bumperInner[0]);
      inner.addColorStop(1, C.bumperInner[1]);
      ctx.fillStyle = inner;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = darken(color, 30);
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Ikonet
      ctx.font = `${r * 0.78}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.icon || icons[i % icons.length], 0, r * 0.04);

      // Poeng under bumperen
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(b.score, 1, r + 17);
      ctx.fillStyle = C.bumperScore;
      ctx.fillText(b.score, 0, r + 16);

      ctx.restore();
    });
  }

  // Flipper som avsmalnende gummi med metallbolt
  function drawFlipper(pivot, len, flip) {
    const R1 = 11, R2 = 6;
    ctx.save();
    ctx.translate(pivot.px, pivot.py);
    ctx.rotate(flip.angle);

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    flipperShape(len, R1, R2, 3, 5);
    ctx.fill();

    const grad = ctx.createLinearGradient(0, -R1, 0, R1);
    grad.addColorStop(0, C.flipper[0]);
    grad.addColorStop(0.5, C.flipper[1]);
    grad.addColorStop(1, C.flipper[2]);
    ctx.fillStyle = grad;
    if (flip.pressed) { ctx.shadowColor = C.flipperGlow; ctx.shadowBlur = 16 * S; }
    flipperShape(len, R1, R2, 0, 0);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = C.flipperEdge;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Bolt i pivot-punktet
    const bolt = ctx.createRadialGradient(-2, -2, 1, 0, 0, 6);
    bolt.addColorStop(0, C.bolt[0]);
    bolt.addColorStop(1, C.bolt[1]);
    ctx.fillStyle = bolt;
    ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function flipperShape(len, r1, r2, ox, oy) {
    const a = Math.asin((r1 - r2) / len);
    ctx.beginPath();
    ctx.arc(ox, oy, r1, Math.PI / 2 + a, Math.PI * 1.5 - a);
    ctx.arc(ox + len, oy, r2, -Math.PI / 2 - a, Math.PI / 2 + a);
    ctx.closePath();
  }

  function drawFlippers(state) {
    if (!layout) return;
    drawFlipper(layout.flipper.left, layout.flipper.len, state.flippers.left);
    drawFlipper(layout.flipper.right, layout.flipper.len, state.flippers.right);
  }

  function drawBall(state) {
    const ball = state.ball;
    const r = ball.r || 9;
    // Mens fjæra trekkes, følger ballen stempelet ned
    const x = ball.x, y = ball.y + (ball.ready ? (state.plunger || 0) * 40 : 0);

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.arc(x + 3, y + 4, r, 0, Math.PI * 2); ctx.fill();

    const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.05, x, y, r);
    grad.addColorStop(0, C.ball[0]);
    grad.addColorStop(0.35, C.ball[1]);
    grad.addColorStop(0.75, C.ball[2]);
    grad.addColorStop(1, C.ball[3]);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

    // Refleks av brettet i underkant
    ctx.fillStyle = C.ballReflection;
    ctx.beginPath(); ctx.arc(x + r * 0.15, y + r * 0.45, r * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /* ── partikler (kun visuelt) ── */
  function addParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 28, maxLife: 28, color, size: 2 + Math.random() * 3 });
    }
  }
  function updateParticles() {
    particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vx *= 0.93; p.vy *= 0.93; p.vy += 0.08; p.life--; });
    particles = particles.filter(p => p.life > 0);
  }
  function drawParticles() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    particles.forEach(p => {
      ctx.globalAlpha = (p.life / p.maxLife) * 0.9;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (p.life / p.maxLife), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  // LED-display med metallramme (tittel og poeng)
  function displayBox(x, y, w, h, text, size) {
    ctx.save();
    ctx.fillStyle = C.displayFrame[0];
    ctx.beginPath(); ctx.roundRect(x - 4, y - 4, w + 8, h + 8, 9); ctx.fill();
    const frame = ctx.createLinearGradient(0, y - 4, 0, y + h + 4);
    frame.addColorStop(0, C.displayFrame[1]);
    frame.addColorStop(1, C.displayFrame[2]);
    ctx.strokeStyle = frame;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = C.displayBg;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill();

    // Prikkmønster som på et ekte LED-display
    ctx.fillStyle = C.displayDots;
    for (let px = x + 4; px < x + w - 2; px += 4) for (let py = y + 4; py < y + h - 2; py += 4) ctx.fillRect(px, py, 1.5, 1.5);

    ctx.font = `bold ${size}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = C.displayGlow;
    ctx.shadowBlur = 10 * S;
    ctx.fillStyle = C.displayText;
    ctx.fillText(text, x + w / 2, y + h / 2 + 1);
    ctx.restore();
  }

  // Tittelen står øverst; poeng og spiller nederst mellom flipperne (toppen er brukt av rollovers)
  function drawHud(state) {
    const cx = 350;
    displayBox(cx - 130, 112, 260, 40, T.title, 24);
    const yBox = 1200, yText = 1256, yInfo = 1278;

    const current = state.players.find(p => p.id === state.currentPlayer);
    if (current) {
      const score = (state.scores[current.id] || 0).toLocaleString('nb-NO');
      displayBox(cx - 85, yBox, 170, 36, score, 26);
      const ballNo = state.ballsPerGame - state.ballsLeft + 1;
      ctx.save();
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(`${current.name}  ·  Ball ${ballNo}/${state.ballsPerGame}`, cx + 1, yText + 1);
      ctx.fillStyle = C.hudText;
      ctx.fillText(`${current.name}  ·  Ball ${ballNo}/${state.ballsPerGame}`, cx, yText);
      // Nedtelling når ballen ligger klar og spilleren ikke skyter den ut
      if (state.launchCountdown !== null && state.launchCountdown <= 20) {
        ctx.font = 'bold 15px sans-serif';
        ctx.fillStyle = C.label;
        ctx.fillText(`Skyt ut ballen! ${state.launchCountdown} s før neste i køen`, cx, yInfo);
      } else if (current.away) {
        ctx.font = '14px sans-serif';
        ctx.fillStyle = '#ffb3b3';
        ctx.fillText('Mistet forbindelsen – venter…', cx, yInfo);
      }
      ctx.restore();
    } else {
      displayBox(cx - 115, yBox, 230, 36, 'SKANN QR', 22);
      ctx.save();
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = C.hudText;
      ctx.fillText('Skann QR-koden på hovedsiden for å spille', cx, yText);
      ctx.restore();
    }
  }

  function drawGameOver(state) {
    if (!state.gameOver) return;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(80, 640, 540, 170);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.gameOver;
    ctx.shadowColor = C.gameOverGlow;
    ctx.shadowBlur = 20 * S;
    ctx.font = 'bold 50px serif';
    ctx.fillText('GAME OVER', 350, 695);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.font = '22px sans-serif';
    ctx.fillText(`${state.gameOver.name}: ${state.gameOver.score.toLocaleString('nb-NO')} poeng`, 350, 760);
    ctx.restore();
  }

  /* ══════════════════════ OFFENTLIG API ══════════════════════ */
  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    setTheme(null);
  }

  // Skarp på HiDPI-skjermer; brettet skaleres til å fylle vinduet
  function resize() {
    const cssScale = Math.min(window.innerWidth / BW, window.innerHeight / BH);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = Math.floor(BW * cssScale) + 'px';
    canvas.style.height = Math.floor(BH * cssScale) + 'px';
    canvas.width = Math.floor(BW * cssScale * dpr);
    canvas.height = Math.floor(BH * cssScale * dpr);
    S = canvas.width / BW;
    staticDirty = true;
  }

  function setLayout(data) { layout = data; staticDirty = true; }

  // Slår sammen temaet med standardverdiene og tegner det statiske laget på nytt
  function setTheme(theme) {
    theme = theme || {};
    T = Object.assign({}, DEFAULT_THEME, theme, {
      colors: Object.assign({}, DEFAULT_THEME.colors, theme.colors || {}),
      sounds: theme.sounds || {},
    });
    C = T.colors;
    glowSprite = makeGlowSprite();
    document.body.style.background = C.page;
    document.documentElement.style.setProperty('--accent', C.label);
    staticDirty = true;
  }

  // Lager effekter for hendelser i en ny state (partikler, LED-blink)
  function handleEvents(data) {
    for (const e of data.events || []) {
      if (e.type === 'bumper') {
        const b = data.bumpers[e.i];
        addParticles(b.x, b.y, bumperColor(b, e.i), 14);
        ledFlash = 1;
      }
      if (e.type === 'sling' && layout) {
        const s = layout.slingshots[e.i];
        addParticles((s.a.x + s.c.x) / 2, (s.a.y + s.c.y) / 2, C.slingParticles, 8);
      }
      if (e.type === 'rollover' && layout) {
        const r = layout.rollovers[e.i];
        addParticles(r.x, r.y, C.rolloverOn, 8);
      }
      if (e.type === 'drop' && layout) {
        const t = layout.dropBanks[e.bank].targets[e.target];
        addParticles((t.x1 + t.x2) / 2, (t.y1 + t.y2) / 2, C.dropTarget[0], 12);
      }
      if (e.type === 'standup' && layout) {
        const s = layout.standups[e.i];
        addParticles((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, C.standupFlash, 10);
      }
      if (e.type === 'kickback' && layout) {
        const k = layout.kickbacks.find(x => x.side === (data.ball.x < 350 ? 'left' : 'right')) || layout.kickbacks[0];
        if (k) addParticles(k.x, k.y, C.lightOn, 24);
        callout('KICKBACK!');
      }
      if (e.type === 'multiplier') { callout(`BONUS ${e.value}×`); ledFlash = 1; }
      if (e.type === 'dropsComplete') { callout('KICKBACK TENT!'); ledFlash = 1; }
      if (e.type === 'ballSaved') callout('BALL SAVED!');
      if (e.type === 'bonus') callout(`BONUS ${e.bonus.toLocaleString('nb-NO')} × ${e.multiplier}`);
    }
  }

  function frame(state, now) {
    if (staticDirty) buildStatic();
    updateParticles();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(staticLayer, 0, 0);
    ctx.setTransform(S, 0, 0, S, 0, 0);

    drawLeds(now);
    drawRollovers(state, now);
    drawLights(state, now);
    drawTargets(state);
    drawSlingRubbers(state);
    drawPlunger(state);
    drawPlungerLabel(state, now);
    drawHud(state);
    drawBumpers(state);
    drawFlippers(state);
    drawBall(state);
    drawParticles();
    drawCallouts();
    drawGameOver(state);
  }

  return { init, resize, setLayout, setTheme, handleEvents, frame, get theme() { return T; } };
})();
