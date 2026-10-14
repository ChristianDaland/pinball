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
    locksForMultiball: 2,        // så mange scoop-treff (låste baller) som skal til for multiball
    multiballExtraBalls: 2,      // ekstra baller i multiball (3 baller totalt)
    multiballSaveSeconds: 10,    // baller som drainer i starten av multiball, kommer tilbake
    jackpotScore: 5000,          // scoop-treff under multiball (startverdi)
    rampComboSeconds: 4,         // rampeskudd innen så kort tid etter forrige gir combo 2×, 3× …
    rampJackpotAdd: 1000,        // hvert rampeskudd under multiball øker jackpoten
    rampsForExtraBall: 5,        // så mange rampeskudd i ett spill gir ekstra ball (0 = aldri)
};

function createRules(physics) {
    let R = DEFAULT_RULES;
    let multIdx = 0, bonus = 0;
    let saveUntil = 0, saveUsed = false;
    let locks = 0, mbSaveUntil = 0;   // låste baller gjelder hele spillet
    let jackpotValue = DEFAULT_RULES.jackpotScore;
    let rampCount = 0, lastRampAt = -Infinity, combo = 0;

    function setBoardRules(rules) {
        R = { ...DEFAULT_RULES, ...(rules || {}) };
        jackpotValue = R.jackpotScore;
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
        locks = 0;
        mbSaveUntil = 0;
        jackpotValue = R.jackpotScore;
        rampCount = 0;
        lastRampAt = -Infinity;
        combo = 0;
        physics.resetTable();
    }

    const multiballActive = () => physics.balls.length + physics.pendingBalls > 1;

    // Ball save starter første gang ballen skytes ut (en svak oppskyting som ruller tilbake teller ikke på nytt)
    function onLaunch(now) {
        if (!saveUsed && saveUntil === 0 && R.ballSaveSeconds > 0) saveUntil = now + R.ballSaveSeconds * 1000;
    }

    // Gjør hendelsene fra én fysikk-tick om til poeng og meldinger.
    // Returnerer { points, events, ballLost, extraBall } – ballLost betyr at spilleren mister ballen.
    function handle(ev, now) {
        let points = 0, ballLost = false, extraBall = false;
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
        for (const i of ev.spins) {
            const s = physics.spinners[i];
            points += s.score;
            events.push({ type: 'spin', i, points: s.score });
        }
        for (const i of ev.scoops) {
            if (multiballActive()) {
                points += jackpotValue;
                events.push({ type: 'jackpot', i, points: jackpotValue });
                continue;
            }
            const s = physics.scoops[i];
            points += s.score;
            locks += 1;
            if (locks >= R.locksForMultiball) {
                locks = 0;
                physics.addBalls(R.multiballExtraBalls);
                mbSaveUntil = now + R.multiballSaveSeconds * 1000;
                jackpotValue = R.jackpotScore;
                events.push({ type: 'multiball', i, points: s.score });
            } else {
                events.push({ type: 'lock', i, locks, needed: R.locksForMultiball, points: s.score });
            }
        }
        for (const i of ev.rampEnter) events.push({ type: 'rampEnter', i });
        for (const i of ev.ramps) {
            combo = now - lastRampAt <= R.rampComboSeconds * 1000 ? combo + 1 : 1;
            lastRampAt = now;
            const p = physics.ramps[i].score * combo;
            points += p;
            rampCount += 1;
            events.push({ type: 'ramp', i, combo, count: rampCount, points: p });
            if (multiballActive()) {
                jackpotValue += R.rampJackpotAdd;
                events.push({ type: 'jackpotUp', value: jackpotValue });
            }
            if (R.rampsForExtraBall > 0 && rampCount === R.rampsForExtraBall) {
                extraBall = true;
                events.push({ type: 'extraBall' });
            }
        }
        if (ev.lostBalls > 0) {
            if (now < mbSaveUntil) {
                physics.addBalls(ev.lostBalls);
                events.push({ type: 'ballSaved' });
            } else {
                events.push({ type: 'ballLost' });
                if (!ev.drained && !multiballActive()) events.push({ type: 'multiballEnd' });
            }
        }
        if (ev.kickback) {
            points += R.kickbackScore;
            events.push({ type: 'kickback', points: R.kickbackScore });
        }
        if (ev.drained) {
            if (now < saveUntil || now < mbSaveUntil) {
                // Ball save: spilleren får ballen tilbake i kanalen
                saveUntil = 0;
                saveUsed = true;
                mbSaveUntil = 0;
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
        return { points, events, ballLost, extraBall };
    }

    function state(now) {
        return {
            multiplier: R.multipliers[multIdx], multipliers: R.multipliers, bonus,
            ballSave: now < saveUntil || now < mbSaveUntil,
            locks, locksNeeded: R.locksForMultiball, jackpotLit: multiballActive(), jackpotValue,
            ramps: rampCount, rampsForExtraBall: R.rampsForExtraBall,
        };
    }

    return { setBoardRules, newGame, onLaunch, handle, state };
}

module.exports = { createRules, DEFAULT_RULES };
