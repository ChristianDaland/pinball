// RomPinball: metallskap med nagler, stjernehimmel med tåker og planeter, neon-lys.
// Dette temaet setter (nesten) alle verdiene, så det er et godt utgangspunkt å kopiere
// når du lager en ny maskin. Se DEFAULT_THEME i engine/renderer.js for forklaring.
PinballThemes['rommet'] = {
  title: 'ROMPINBALL',
  bumperIcons: ['🪐', '🌍', '☀️', '🌙', '☄️'],
  bumperColors: ['#b26bff', '#3fa9ff', '#ffd23f', '#9fb3ff', '#ff6b3d'],

  colors: {
    page: '#02030a',
    cabinet: ['#0b1024', '#26304f', '#161d38', '#26304f', '#0b1024'],
    cabinetGrain: null,
    cabinetEdge: 'rgba(0,0,0,0.8)',
    cabinetEdgeLight: 'rgba(120,200,255,0.25)',
    playfield: ['#05061a', '#0d0b2e', '#160c36', '#03030d'],
    sheen: 'rgba(160,200,255,0.06)',
    lane: ['#0a0d1e', '#151a33'],
    drainShade: 'rgba(0,0,0,0.85)',
    vignette: 'rgba(0,0,0,0.55)',
    frame: '#0b0f22',
    frameTrim: '#5ef2ff',
    rail: ['#1d2a44', '#8fb8d8', 'rgba(220,250,255,0.8)'],
    deflector: ['#3a2a6e', '#1a1440'],
    deflectorEdge: '#5ef2ff',
    sling: ['#4b2a8a', '#1a1040'],
    slingEdge: '#0b0f22',
    slingInset: 'rgba(94,242,255,0.45)',
    rivet: ['#c9d6e8', '#4a5670'],
    rubber: '#c06bff',
    rubberFlash: '#ffffff',
    rubberGlow: '#d38bff',
    slingParticles: '#d38bff',
    led: ['rgba(220,255,255,1)', 'rgba(94,242,255,0.95)', 'rgba(60,140,255,0.35)', 'rgba(40,80,255,0)'],
    spring: '#8fb8d8',
    plungerHead: ['#3a4a6a', '#cfe8ff'],
    label: '#5ef2ff',
    bumperFace: '#1a1d3a',
    bumperRim: '#5ef2ff',
    bumperInner: ['#2c2f5c', '#0d0f26'],
    bumperScore: '#cfe8ff',
    flipper: ['#ffffff', '#cfe8ff', '#6f8fb8'],
    flipperEdge: '#3a4a6a',
    flipperGlow: '#5ef2ff',
    bolt: ['#ffffff', '#4a5670'],
    ball: ['#ffffff', '#e6f2ff', '#8aa0c0', '#3c4660'],
    ballReflection: 'rgba(170,90,255,0.35)',
    displayFrame: ['#1d2a44', '#8fb8d8', '#2a3550'],
    displayBg: '#02040e',
    displayDots: 'rgba(94,242,255,0.07)',
    displayText: '#7ff6ff',
    displayGlow: '#00d5ff',
    hudText: '#cfe8ff',
    gameOver: '#ff5edb',
    gameOverGlow: '#b026ff',
    popSkirt: '#141836',
    rolloverOn: '#5ef2ff',
    rolloverOff: '#141a3a',
    rolloverText: '#02040e',
    dropTarget: ['#ffb27a', '#b5432a'],
    dropSlot: 'rgba(0,0,0,0.6)',
    standup: ['#e6f2ff', '#5a6f98'],
    standupFlash: '#7ff6ff',
    lightOn: '#ff5edb',
    lightOff: 'rgba(40,30,80,0.7)',
    lightText: '#ffffff',
    callout: '#7ff6ff',
  },

  // Metallplater med nagler, og raketter/UFO-er som "dekaler" på skapet
  decorateCabinet(g, { W, H, silhouette }) {
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 2;
    for (let y = 200; y < H; y += 220) {
      g.beginPath(); g.moveTo(18, y); g.lineTo(70, y); g.moveTo(W - 70, y); g.lineTo(W - 18, y); g.stroke();
    }
    g.fillStyle = 'rgba(200,220,255,0.35)';
    for (let y = 40; y < H - 20; y += 55) {
      for (const x of [26, W - 26]) { g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fill(); }
    }
    const decal = 'rgba(94,242,255,0.22)';
    g.drawImage(silhouette('🚀', 90, decal), 30, 25, 117, 117);
    g.drawImage(silhouette('🛸', 90, decal, true), W - 147, 25, 117, 117);
    const star = silhouette('✦', 36, 'rgba(160,200,255,0.25)');
    for (const y of [480, 650, 820, 990, 1160]) {
      g.drawImage(star, 18, y, 44, 44);
      g.drawImage(star, W - 62, y, 44, 44);
    }
  },

  // Stjerner, tåker og planeter på spillefeltet
  decoratePlayfield(g, { seeded }) {
    const rnd = seeded(2001);

    // Tåker: store, myke fargeskyer
    [[220, 520, 260, '120,40,200'], [520, 860, 300, '30,90,220'], [300, 1050, 220, '200,40,140']].forEach(([x, y, r, rgb]) => {
      const neb = g.createRadialGradient(x, y, 0, x, y, r);
      neb.addColorStop(0, `rgba(${rgb},0.28)`);
      neb.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = neb;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    });

    // Stjerner i ulike størrelser
    for (let i = 0; i < 420; i++) {
      const x = 80 + rnd() * 640, y = 20 + rnd() * 1280, s = rnd();
      g.fillStyle = `rgba(255,255,255,${0.25 + s * 0.6})`;
      g.beginPath(); g.arc(x, y, s < 0.92 ? 0.6 + s * 0.8 : 1.8, 0, Math.PI * 2); g.fill();
    }

    // Stor planet med ring nede til venstre
    g.save();
    g.translate(200, 760);
    const planet = g.createRadialGradient(-25, -25, 5, 0, 0, 70);
    planet.addColorStop(0, '#5a3a8a');
    planet.addColorStop(1, '#1a0e33');
    g.globalAlpha = 0.55;
    g.fillStyle = planet;
    g.beginPath(); g.arc(0, 0, 70, 0, Math.PI * 2); g.fill();
    g.rotate(-0.35);
    g.strokeStyle = 'rgba(180,140,255,0.6)';
    g.lineWidth = 4;
    g.beginPath(); g.ellipse(0, 0, 115, 22, 0, 0, Math.PI * 2); g.stroke();
    g.restore();

    // Liten måne oppe til høyre
    const moon = g.createRadialGradient(545, 395, 2, 552, 402, 26);
    moon.addColorStop(0, 'rgba(200,210,255,0.45)');
    moon.addColorStop(1, 'rgba(80,90,140,0.15)');
    g.fillStyle = moon;
    g.beginPath(); g.arc(552, 402, 26, 0, Math.PI * 2); g.fill();
  },

  // s = lydmotoren (tone, noise, pling, plong), e = hendelsen fra serveren
  sounds: {
    // "Laser-zap" som faller i tonehøyde; høyere tone jo flere poeng
    bumper: (s, e) => {
      const base = [520, 440, 880, 660, 740][e.i % 5];
      s.tone(base, 0.25, { type: 'square', vol: 0.12, slideTo: base / 3 });
      s.tone(base * 1.5, 0.18, { vol: 0.15, slideTo: base / 2 });
    },
    sling: (s) => { s.tone(1400, 0.12, { type: 'sawtooth', vol: 0.08, slideTo: 300 }); s.noise(0.04, { vol: 0.2, freq: 4000, q: 1 }); },
    flipper: (s) => { s.tone(180, 0.07, { type: 'square', vol: 0.12, slideTo: 90 }); s.noise(0.03, { vol: 0.3, freq: 2500, q: 2 }); },
    flipperDown: (s) => s.noise(0.02, { vol: 0.15, freq: 1500, q: 2 }),
    launch: (s, e) => {
      s.noise(0.4, { vol: 0.3, freq: 300, q: 0.5 });
      s.tone(120, 0.6, { type: 'sawtooth', vol: 0.1, slideTo: 600 + (e.power || 0.7) * 1200 });
    },
    drain: (s) => {
      s.tone(600, 0.9, { type: 'sine', vol: 0.3, slideTo: 80 });
      s.tone(605, 0.9, { type: 'sine', vol: 0.2, slideTo: 82 });
    },
    rollover: (s) => s.tone(1200, 0.12, { type: 'sine', vol: 0.15, slideTo: 1800 }),
    drop: (s) => { s.tone(220, 0.2, { type: 'square', vol: 0.12, slideTo: 80 }); s.noise(0.08, { vol: 0.3, freq: 800, q: 1 }); },
    dropsComplete: (s) => [523, 659, 784, 1047].forEach((f, i) => s.tone(f, 0.18, { type: 'square', vol: 0.08, delay: i * 0.08 })),
    standup: (s) => s.tone(900, 0.1, { type: 'triangle', vol: 0.2, slideTo: 600 }),
    kickback: (s) => { s.noise(0.3, { vol: 0.4, freq: 400, q: 0.6 }); s.tone(100, 0.4, { type: 'sawtooth', vol: 0.12, slideTo: 900 }); },
    ballSaved: (s) => [880, 1175, 1568].forEach((f, i) => s.tone(f, 0.2, { vol: 0.15, delay: i * 0.1 })),
    multiplier: (s) => [440, 554, 659, 880].forEach((f, i) => s.tone(f, 0.25, { type: 'sawtooth', vol: 0.07, delay: i * 0.09 })),
    bonus: (s) => { for (let i = 0; i < 8; i++) s.tone(600 + i * 80, 0.06, { type: 'square', vol: 0.06, delay: 0.3 + i * 0.07 }); },
    gameover: (s) => {
      [784, 659, 523, 392, 330].forEach((f, i) => s.tone(f, 0.3, { type: 'triangle', vol: 0.2, delay: 0.8 + i * 0.22 }));
      s.tone(196, 1.4, { type: 'sine', vol: 0.25, delay: 0.8 + 5 * 0.22, slideTo: 60 });
    },
  },
};
