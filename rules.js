// Spilleregler som bygger på hendelsene fra fysikken: poeng, bonus, multiplikator og ball save.
// Verdiene kan justeres per maskin under "rules" i board.json.
const DEFAULT_RULES = {
    ballSaveSeconds: 8,          // ball som drainer så kort tid etter oppskyting, kommer tilbake
    multipliers: [1, 2, 3, 5],   // bonusmultiplikator; ett steg opp hver gang alle rollovers er tent
    rolloversCompleteScore: 500,
    dropsCompleteScore: 1000,    // alle drop targets i en rad nede (tenner også kickback)
    kickbackScore: 100,
    rolloverBonus: 100,          // det som legges til bonusen (telles opp × multiplikator når ballen er tapt)
    dropBonus: 100,
    standupBonus: 50,
};

function createRules(physics) {
    let R = DEFAULT_RULES;
    let multIdx = 0, bonus = 0;
    let saveUntil = 0, saveUsed = false;

    function setBoardRules(rules) {
        R = { ...DEFAULT_RULES, ...(rules || {}) };
    }

    function resetBall() {
        multIdx = 0;
        bonus = 0;
        saveUntil = 0;
        saveUsed = false;
    }

    // Nytt spill: alle lys av og alle mål opp
    function newGame() {
        resetBall();
        physics.resetTable();
    }

    // Ball save starter første gang ballen skytes ut (en svak oppskyting som ruller tilbake teller ikke på nytt)
    function onLaunch(now) {
        if (!saveUsed && saveUntil === 0 && R.ballSaveSeconds > 0) saveUntil = now + R.ballSaveSeconds * 1000;
    }

    // Gjør hendelsene fra én fysikk-tick om til poeng og meldinger.
    // Returnerer { points, events, ballLost } – ballLost betyr at spilleren mister ballen.
    function handle(ev, now) {
        let points = 0, ballLost = false;
        const events = [];
        for (const i of ev.hits) {
            const b = physics.bumpers[i];
            points += b.score;
            events.push({ type: 'bumper', i, pop: b.type === 'pop', points: b.score });
        }
        for (const i of ev.slings) {
            const s = physics.slingshots[i];
            points += s.score;
            events.push({ type: 'sling', i, points: s.score });
        }
        for (const i of ev.rollovers) {
            const r = physics.rollovers[i];
            points += r.score;
            bonus += R.rolloverBonus;
            events.push({ type: 'rollover', i, points: r.score });
        }
        if (ev.rolloversComplete) {
            multIdx = Math.min(multIdx + 1, R.multipliers.length - 1);
            points += R.rolloversCompleteScore;
            events.push({ type: 'multiplier', value: R.multipliers[multIdx], points: R.rolloversCompleteScore });
        }
        for (const d of ev.drops) {
            const s = physics.dropBanks[d.bank].score;
            points += s;
            bonus += R.dropBonus;
            events.push({ type: 'drop', bank: d.bank, target: d.target, points: s });
        }
        for (const bank of ev.dropsComplete) {
            points += R.dropsCompleteScore;
            events.push({ type: 'dropsComplete', bank, points: R.dropsCompleteScore });
        }
        for (const i of ev.standups) {
            const s = physics.standups[i];
            points += s.score;
            bonus += R.standupBonus;
            events.push({ type: 'standup', i, points: s.score });
        }
        if (ev.kickback) {
            points += R.kickbackScore;
            events.push({ type: 'kickback', points: R.kickbackScore });
        }
        if (ev.drained) {
            if (now < saveUntil) {
                // Ball save: spilleren får ballen tilbake i kanalen
                saveUntil = 0;
                saveUsed = true;
                events.push({ type: 'ballSaved' });
            } else {
                const multiplier = R.multipliers[multIdx];
                if (bonus > 0) {
                    points += bonus * multiplier;
                    events.push({ type: 'bonus', bonus, multiplier, total: bonus * multiplier });
                }
                events.push({ type: 'drain' });
                resetBall();
                ballLost = true;
            }
        }
        return { points, events, ballLost };
    }

    function state(now) {
        return { multiplier: R.multipliers[multIdx], multipliers: R.multipliers, bonus, ballSave: now < saveUntil };
    }

    return { setBoardRules, newGame, onLaunch, handle, state };
}

module.exports = { createRules, DEFAULT_RULES };
