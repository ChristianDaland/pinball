/* ══════════════════════ SKJERMENE ══════════════════════
   Hovedsiden (index.html) åpner brettet (pinball.html) og poengtavla (score.html) i egne
   vinduer, og kan be brettet stille seg i kø for tastaturspill (open med params). Brettet og poengtavla melder fra over en BroadcastChannel at de er åpne, så
   hovedsiden kan vise "✅ Brettet er åpent" – også etter at hovedsiden er lastet på nytt.
   Virker bare mellom vinduer i samme nettleser på samme maskin.
*/
const PinballScreens = (() => {
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('pinball-skjermer') : null;

  // Skjermene som kan åpnes fra hovedsiden: vindusnavn, adresse og vindusstørrelse
  const SCREENS = {
    brett: { name: 'pinball-brett', url: '/pinball.html', features: 'popup,width=700,height=1100' },
    score: { name: 'pinball-score', url: '/score.html', features: 'popup,width=1280,height=720' },
  };

  // Brukes av pinball.html og score.html: si fra at denne skjermen er åpen
  function announce(screen) {
    if (!channel) return;
    const say = () => channel.postMessage({ type: 'her', screen });
    say();
    setInterval(say, 2000);
    channel.addEventListener('message', (e) => { if (e.data && e.data.type === 'hvem') say(); });
    window.addEventListener('pagehide', () => channel.postMessage({ type: 'borte', screen }));
  }

  // Brukes av hovedsiden: onChange({ brett: true/false, score: true/false }) når noe endrer seg
  function watch(onChange) {
    const lastSeen = {};
    let last = '';
    const report = () => {
      const now = Date.now();
      const open = {};
      for (const s of Object.keys(SCREENS)) open[s] = !!lastSeen[s] && now - lastSeen[s] < 5000;
      const key = JSON.stringify(open);
      if (key !== last) { last = key; onChange(open); }
    };
    if (channel) {
      channel.addEventListener('message', (e) => {
        const d = e.data || {};
        if (d.type === 'her') lastSeen[d.screen] = Date.now();
        if (d.type === 'borte') delete lastSeen[d.screen];
        report();
      });
      channel.postMessage({ type: 'hvem' });
    }
    setInterval(report, 1000);
    report();
  }

  // Åpner en skjerm i eget vindu, eller henter fram vinduet hvis det allerede er åpent.
  // params (valgfritt) går til skjermen: i adressen når vinduet er nytt, ellers som en beskjed
  // over kanalen (se onMessage). Returnerer false hvis nettleseren blokkerte vinduet.
  function open(screen, params) {
    const s = SCREENS[screen];
    const w = window.open('', s.name, s.features);
    if (!w) return false;
    // Et vindu med dette navnet fantes ikke fra før: last inn siden
    let blank = true;
    try { blank = w.location.href === 'about:blank'; } catch (e) { /* annen adresse – la den være */ }
    if (blank) w.location.href = s.url + (params ? '?' + new URLSearchParams(params) : '');
    else if (params && channel) channel.postMessage({ type: 'beskjed', screen, params });
    w.focus();
    return true;
  }

  // Brukes av skjermene: fn(params) når hovedsiden sender en beskjed til denne skjermen
  function onMessage(screen, fn) {
    if (!channel) return;
    channel.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.type === 'beskjed' && d.screen === screen && d.params) fn(d.params);
    });
  }

  // Liten "⛶ Fullskjerm"-knapp oppe til høyre som skjules i fullskjerm
  function addFullscreenButton() {
    if (!document.fullscreenEnabled) return;
    const btn = document.createElement('button');
    btn.textContent = '⛶ Fullskjerm';
    btn.title = 'Fyll hele skjermen (Esc for å gå ut)';
    Object.assign(btn.style, {
      position: 'fixed', top: '14px', right: '14px', zIndex: 30,
      padding: '10px 16px', borderRadius: '999px', border: '2px solid rgba(255,255,255,0.5)',
      background: 'rgba(0,0,0,0.65)', color: '#fff', font: 'bold 15px sans-serif', cursor: 'pointer',
    });
    btn.addEventListener('click', () => document.documentElement.requestFullscreen().catch(() => {}));
    const update = () => { btn.style.display = document.fullscreenElement ? 'none' : 'block'; };
    document.addEventListener('fullscreenchange', update);
    update();
    document.body.appendChild(btn);
  }

  return { announce, watch, open, onMessage, addFullscreenButton };
})();
