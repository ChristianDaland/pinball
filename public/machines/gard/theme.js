// Gårdspinball: treskap med utskjæringer, grønn eng, gårdsdyr på bumperne.
// Fargene som ikke står her, er standardverdiene i engine/renderer.js (som er laget for dette temaet).
PinballThemes['gard'] = {
  title: 'GÅRDSPINBALL',
  bumperIcons: ['🐓', '🐑', '🐔', '🐴', '🐄'],
  bumperColors: ['#ff6b6b', '#4ecdc4', '#ffe66d', '#a8e6cf', '#ff8b94'],

  colors: {
    cabinetGrain: '#2e1808',
  },

  // Utskjæringer i treverket: dyr i hjørnene og korn langs sidene
  decorateCabinet(g, { W, silhouette }) {
    const carve = 'rgba(40,20,6,0.55)';
    g.drawImage(silhouette('🐓', 90, carve), 30, 25, 117, 117);
    g.drawImage(silhouette('🐴', 90, carve, true), W - 147, 25, 117, 117);
    const wheat = silhouette('🌾', 40, carve);
    for (const y of [470, 640, 810, 980, 1150]) {
      g.drawImage(wheat, 14, y, 52, 52);
      g.drawImage(wheat, W - 66, y, 52, 52);
    }
  },

  // Gresstrå, tuster og blomster på enga
  decoratePlayfield(g, { seeded, silhouette }) {
    const rnd = seeded(42);
    g.strokeStyle = 'rgba(150,200,110,0.07)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < 260; i++) {
      const x = 80 + rnd() * 640, y = 100 + rnd() * 1200;
      g.moveTo(x, y);
      g.lineTo(x + (rnd() - 0.5) * 5, y - 6 - rnd() * 9);
    }
    g.stroke();

    const tuft = silhouette('🌿', 40, 'rgba(10,30,12,0.35)');
    const flower = silhouette('🌼', 26, 'rgba(10,30,12,0.3)');
    [[150, 620], [560, 700], [300, 760], [130, 360], [590, 400], [420, 860]].forEach(([x, y]) => g.drawImage(tuft, x, y, 46, 46));
    for (let x = 90; x < 610; x += 34 + rnd() * 20) {
      g.drawImage(rnd() < 0.3 ? flower : tuft, x, 1180 + rnd() * 50, 40, 40);
    }
  },

  // s = lydmotoren (tone, noise, pling, plong), e = hendelsen fra serveren
  sounds: {
    // De store bumperne (50 p) sier plong, de mindre plinger lysere jo mer de gir
    bumper: (s, e) => [
      () => s.plong(196),   // 🐓 G3
      () => s.plong(147),   // 🐑 D3
      () => s.pling(1047),  // 🐔 C6 – 100 poeng
      () => s.pling(784),   // 🐴 G5
      () => s.pling(880),   // 🐄 A5
    ][e.i % 5](),
    sling: (s) => { s.plong(330); s.noise(0.05, { vol: 0.35, freq: 2500, q: 0.8 }); },
    flipper: (s) => { s.noise(0.04, { vol: 0.5, freq: 1800, q: 1.5 }); s.tone(90, 0.08, { type: 'square', vol: 0.12 }); },
    flipperDown: (s) => s.noise(0.025, { vol: 0.2, freq: 1200, q: 1.5 }),
    launch: (s, e) => {
      s.noise(0.25, { vol: 0.35, freq: 600, q: 0.7 });
      s.tone(180, 0.35, { type: 'sawtooth', vol: 0.08, slideTo: 300 + (e.power || 0.7) * 600 });
    },
    drain: (s) => {
      s.tone(392, 0.25, { type: 'triangle', vol: 0.3 });
      s.tone(330, 0.25, { type: 'triangle', vol: 0.3, delay: 0.22 });
      s.tone(262, 0.6, { type: 'triangle', vol: 0.3, delay: 0.44, slideTo: 196 });
    },
    rollover: (s) => s.pling(1319),
    drop: (s) => { s.plong(110); s.noise(0.06, { vol: 0.4, freq: 600, q: 1 }); },
    dropsComplete: (s) => [523, 659, 784, 1047].forEach((f, i) => s.tone(f, 0.2, { type: 'triangle', vol: 0.25, delay: i * 0.1 })),
    standup: (s) => { s.tone(1568, 0.25, { type: 'triangle', vol: 0.2 }); s.tone(2093, 0.15, { vol: 0.08 }); },
    kickback: (s) => { s.noise(0.25, { vol: 0.5, freq: 500, q: 0.7 }); s.plong(98); },
    ballSaved: (s) => [784, 988, 1175].forEach((f, i) => s.tone(f, 0.25, { type: 'triangle', vol: 0.25, delay: i * 0.12 })),
    multiplier: (s) => [392, 523, 659, 784].forEach((f, i) => {
      s.tone(f, 0.5, { vol: 0.22, delay: i * 0.1 });
      s.tone(f * 2.76, 0.25, { vol: 0.06, delay: i * 0.1 });
    }),
    spin: (s) => s.noise(0.02, { vol: 0.25, freq: 3500, q: 3 }),
    lock: (s) => { s.plong(131); s.tone(659, 0.3, { type: 'triangle', vol: 0.2, delay: 0.3 }); },
    multiball: (s) => [262, 330, 392, 523, 659, 784, 1047].forEach((f, i) => s.tone(f, 0.25, { type: 'triangle', vol: 0.22, delay: i * 0.08 })),
    jackpot: (s) => { [523, 659, 784, 1047].forEach((f, i) => { s.tone(f, 0.6, { vol: 0.25, delay: i * 0.12 }); s.tone(f * 2.76, 0.3, { vol: 0.06, delay: i * 0.12 }); }); },
    rampEnter: (s) => s.noise(0.5, { vol: 0.25, freq: 900, q: 0.6 }),
    ramp: (s, e) => [523, 659, 784, 1047].slice(0, 2 + Math.min(2, e.combo || 1)).forEach((f, i) => s.tone(f, 0.25, { type: 'triangle', vol: 0.22, delay: i * 0.09 })),
    jackpotUp: (s) => s.pling(1568),
    extraBall: (s) => { [392, 523, 659, 784, 659, 784, 1047].forEach((f, i) => s.tone(f, 0.25, { type: 'triangle', vol: 0.25, delay: i * 0.13 })); },
    ballLost: (s) => s.tone(330, 0.4, { type: 'triangle', vol: 0.2, slideTo: 165 }),
    bonus: (s) => { for (let i = 0; i < 8; i++) s.tone(700 + i * 60, 0.07, { type: 'triangle', vol: 0.15, delay: 0.3 + i * 0.08 }); },
    gameover: (s) => {
      [523, 494, 466, 440].forEach((f, i) => s.tone(f, 0.35, { type: 'square', vol: 0.08, delay: 0.8 + i * 0.28 }));
      s.tone(220, 1.2, { type: 'triangle', vol: 0.25, delay: 0.8 + 4 * 0.28, slideTo: 110 });
    },
  },
};
