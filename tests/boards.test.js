// Tester for lagring av brett fra redigeringen (boards.js). Kjør med: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const physics = require('../physics');
const { cleanBoard } = require('../boards');

const MACHINES = path.join(__dirname, '..', 'public', 'machines');
for (const id of fs.readdirSync(MACHINES).filter(id => fs.existsSync(path.join(MACHINES, id, 'board.json')))) {
    test(`${id}: standardbrettet er uendret etter opprydding (samme fysikk)`, () => {
        const board = JSON.parse(fs.readFileSync(path.join(MACHINES, id, 'board.json'), 'utf8'));
        physics.loadBoard(board);
        const before = JSON.stringify(physics.layout);
        physics.loadBoard(cleanBoard(board));
        assert.strictEqual(JSON.stringify(physics.layout), before);
    });
}

test('ugyldige brett avvises med forklaring', () => {
    assert.throws(() => cleanBoard(null), /objekt/);
    assert.throws(() => cleanBoard({ popBumpers: [{ x: 'a', y: 1 }] }), /Ugyldig tall/);
    assert.throws(() => cleanBoard({ walls: new Array(100).fill({ points: [[1, 1], [2, 2]] }) }), /maks/);
    assert.throws(() => cleanBoard({ bumpers: [{ x: 1e9, y: 1 }] }), /Ugyldig tall/);
});

test('ukjente felter og farlige verdier fjernes', () => {
    const b = cleanBoard({ hack: '<script>', bumpers: [{ x: 300, y: 400, color: 'red;}', icon: '🐓🐓🐓🐓🐓🐓🐓🐓🐓🐓' }], kickback: 'tull' });
    assert.ok(!('hack' in b) && !('kickback' in b));
    assert.ok(!('color' in b.bumpers[0]));
    assert.ok(b.bumpers[0].icon.length <= 8);
});
