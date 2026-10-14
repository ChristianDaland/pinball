/* ══════════════════════ PINBALL-LYDMOTOR ══════════════════════
   Syntetiserer lyd med Web Audio – ingen lydfiler. Temaene bruker byggeklossene
   tone, noise, pling og plong i sine egne lydfunksjoner (theme.sounds).
   Nettlesere tillater bare lyd etter at brukeren har klikket eller trykket på en tast.
*/
const PinballSound = (() => {
  let audioCtx = null, master = null;
  const listeners = [];

  function init() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const comp = audioCtx.createDynamicsCompressor();
      master = audioCtx.createGain();
      master.gain.value = 0.7;
      master.connect(comp);
      comp.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    setTimeout(() => listeners.forEach(fn => fn(running())), 100);
  }

  function running() {
    return !!audioCtx && audioCtx.state === 'running';
  }

  // Kalles når lyden slås på/av, f.eks. for å skjule "Klikk for lyd"-knappen
  function onChange(fn) { listeners.push(fn); }

  // Én tone med valgfri pitch-glidning og eksponentiell utklinging
  function tone(freq, dur, { type = 'sine', vol = 0.3, delay = 0, slideTo = null, attack = 0.004 } = {}) {
    if (!running()) return;
    const t = audioCtx.currentTime + delay;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // Kort støy-støt (klikk, smell, sus)
  function noise(dur, { vol = 0.3, freq = 1500, q = 1, delay = 0 } = {}) {
    if (!running()) return;
    const t = audioCtx.currentTime + delay;
    const len = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const f = audioCtx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = audioCtx.createGain();
    g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
  }

  // "Pling": lys bjelle med en uharmonisk overtone
  function pling(freq) {
    tone(freq, 0.7, { vol: 0.28 });
    tone(freq * 2.76, 0.35, { vol: 0.08 });
    tone(freq * 5.4, 0.12, { vol: 0.03 });
  }

  // "Plong": dyp, treaktig tone som synker litt i tonehøyde
  function plong(freq) {
    tone(freq, 0.45, { type: 'triangle', vol: 0.45, slideTo: freq * 0.82 });
    tone(freq * 2, 0.18, { vol: 0.12, slideTo: freq * 1.7 });
    noise(0.03, { vol: 0.25, freq: 900, q: 2 });
  }

  const api = { tone, noise, pling, plong };

  // Spiller lyden for en hendelse med temaets lydfunksjoner (manglende lyd = stille)
  function play(sounds, type, e) {
    const fn = sounds && sounds[type];
    if (fn) fn(api, e || {});
  }

  return { init, running, onChange, play, tone, noise, pling, plong };
})();
