// Tester for spillereglene (rules.js): lås → multiball, jackpot, ball save. Kjør med: npm test
const test = require('node:test');
const assert = require('node:assert');
const physics = require('../physics');
const { createRules } = require('../rules');
const board = require('../public/machines/gard/board.json');

const none = () => ({ hits: [], slings: [], rollovers: [], rolloversComplete: false, drops: [], dropsComplete: [],
    standups: [], kickback: false, spins: [], scoops: [], lostBalls: 0, drained: false });
const types = (res) => res.events.map(e => e.type);

function setup() {
    physics.loadBoard(board);
    const rules = createRules(physics);
    rules.setBoardRules({ ...board.rules, locksForMultiball: 2, jackpotScore: 5000 });
    rules.newGame();
    return rules;
}

test('to låste baller starter multiball, og scoop under multiball gir jackpot', () => {
    const rules = setup();
    assert.deepStrictEqual(types(rules.handle({ ...none(), scoops: [0] }, 0)), ['lock']);
    assert.deepStrictEqual(types(rules.handle({ ...none(), scoops: [0] }, 0)), ['multiball']);
    assert.strictEqual(physics.pendingBalls, 2);
    assert.ok(rules.state(0).jackpotLit);
    const res = rules.handle({ ...none(), scoops: [0] }, 0);
    assert.deepStrictEqual(types(res), ['jackpot']);
    assert.strictEqual(res.points, 5000);
});

test('ball save i starten av multiball gir ballen tilbake', () => {
    const rules = setup();
    rules.handle({ ...none(), scoops: [0] }, 0);
    rules.handle({ ...none(), scoops: [0] }, 0);
    const res = rules.handle({ ...none(), lostBalls: 1 }, 5000);
    assert.deepStrictEqual(types(res), ['ballSaved']);
    assert.strictEqual(physics.pendingBalls, 3);
    const late = rules.handle({ ...none(), lostBalls: 1 }, 20000);
    assert.ok(types(late).includes('ballLost'));
});

test('ball save etter oppskyting, men ikke etter 8 sekunder', () => {
    const rules = setup();
    rules.onLaunch(0);
    let res = rules.handle({ ...none(), drained: true }, 3000);
    assert.deepStrictEqual(types(res), ['ballSaved']);
    assert.strictEqual(res.ballLost, false);
    rules.onLaunch(4000);                       // ny oppskyting: ball save er brukt opp for denne ballen
    res = rules.handle({ ...none(), drained: true }, 6000);
    assert.ok(res.ballLost);
});

test('bonus × multiplikator legges til når ballen er tapt', () => {
    const rules = setup();
    rules.handle({ ...none(), rollovers: [0], rolloversComplete: true }, 0);  // +100 bonus, 2×
    const res = rules.handle({ ...none(), drained: true }, 60000);
    const bonus = res.events.find(e => e.type === 'bonus');
    assert.deepStrictEqual({ bonus: bonus.bonus, multiplier: bonus.multiplier, total: bonus.total }, { bonus: 100, multiplier: 2, total: 200 });
    assert.ok(res.ballLost);
});
