// Lagrede brett fra redigeringen (redigering.html). Standardbrettet for hver maskin er
// public/machines/<id>/board.json; et lagret brett overstyrer det.
// Med Turso (TURSO_DATABASE_URL/TURSO_AUTH_TOKEN) lagres ALLE versjoner i tabellen pinball_boards,
// så "angre" kan gå tilbake til forrige lagring. Uten database brukes en JSON-fil (BOARDS_FILE).
const fs = require('fs');

function createBoardStore({ machineIds, file }) {
    const saved = {};     // maskin-id -> [{ board, savedAt }] (eldste først) – brukes uten database
    const latest = {};    // maskin-id -> { board, savedAt } | null
    let db = null;

    async function init() {
        const url = process.env.TURSO_DATABASE_URL;
        const authToken = process.env.TURSO_AUTH_TOKEN;
        if (url && (authToken || url.startsWith('file:'))) {
            try {
                const { createClient } = require('@libsql/client');
                db = createClient({ url, authToken });
                await db.execute(`CREATE TABLE IF NOT EXISTS pinball_boards (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    machine TEXT NOT NULL,
                    board TEXT NOT NULL,
                    saved_at TEXT NOT NULL DEFAULT (datetime('now'))
                )`);
                for (const id of machineIds) await loadLatest(id);
                console.log('[DB] Lagrede brett lastet.');
                return;
            } catch (err) {
                console.error('[DB] Feil ved lasting av brett, bruker JSON-fil:', err.message);
                db = null;
            }
        }
        try {
            Object.assign(saved, JSON.parse(fs.readFileSync(file, 'utf8')));
        } catch (e) { /* ingen fil ennå */ }
        for (const id of machineIds) {
            const list = saved[id] || [];
            latest[id] = list.length ? list[list.length - 1] : null;
        }
    }

    async function loadLatest(id) {
        const res = await db.execute({
            sql: 'SELECT board, saved_at FROM pinball_boards WHERE machine = ? ORDER BY id DESC LIMIT 1',
            args: [id],
        });
        latest[id] = res.rows.length ? { board: JSON.parse(String(res.rows[0].board)), savedAt: String(res.rows[0].saved_at) } : null;
    }

    function saveFile() {
        fs.writeFile(file, JSON.stringify(saved, null, 2), (err) => {
            if (err) console.error('Kunne ikke lagre brettfila:', err.message);
        });
    }

    // Tar med en maskin som ble laget etter oppstart
    async function ensure(id) {
        if (id in latest) return;
        if (db) await loadLatest(id);
        else latest[id] = (saved[id] || []).length ? saved[id][saved[id].length - 1] : null;
    }

    // Sletter alle lagrede versjoner for en maskin (når en egen maskin slettes)
    async function removeAll(id) {
        if (db) await db.execute({ sql: 'DELETE FROM pinball_boards WHERE machine = ?', args: [id] });
        else { delete saved[id]; saveFile(); }
        delete latest[id];
    }

    // Det lagrede brettet for en maskin, eller null (= bruk standardbrettet)
    function get(id) {
        return latest[id] || null;
    }

    async function save(id, board) {
        if (db) {
            await db.execute({ sql: 'INSERT INTO pinball_boards (machine, board) VALUES (?, ?)', args: [id, JSON.stringify(board)] });
            await loadLatest(id);
        } else {
            const entry = { board, savedAt: new Date().toISOString().slice(0, 19).replace('T', ' ') };
            (saved[id] = saved[id] || []).push(entry);
            latest[id] = entry;
            saveFile();
        }
        return latest[id];
    }

    // Angre: sletter siste lagring, så den forrige (eller standardbrettet) gjelder igjen
    async function undo(id) {
        if (db) {
            await db.execute({
                sql: 'DELETE FROM pinball_boards WHERE id = (SELECT MAX(id) FROM pinball_boards WHERE machine = ?)',
                args: [id],
            });
            await loadLatest(id);
        } else {
            (saved[id] = saved[id] || []).pop();
            latest[id] = saved[id].length ? saved[id][saved[id].length - 1] : null;
            saveFile();
        }
        return latest[id];
    }

    // Tilbakestill: lagrer en markør som betyr "bruk standardbrettet" (så angre kan hente brettet tilbake)
    async function reset(id) {
        return save(id, { _standard: true });
    }

    async function count(id) {
        if (db) {
            const res = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM pinball_boards WHERE machine = ?', args: [id] });
            return Number(res.rows[0].n);
        }
        return (saved[id] || []).length;
    }

    return { init, ensure, removeAll, get, save, undo, reset, count };
}

// Sjekker og rydder et brett fra redigeringen, så et ødelagt eller enormt brett ikke kan lagres.
// Kaster en feil med norsk melding hvis noe er galt.
function cleanBoard(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Brettet må være et objekt');
    const num = (v, name, min = -200, max = 1500) => {
        if (typeof v !== 'number' || !isFinite(v) || v < min || v > max) throw new Error(`Ugyldig tall i ${name}: ${v}`);
        return Math.round(v * 10) / 10;
    };
    const point = (p, name) => {
        if (!Array.isArray(p) || p.length !== 2) throw new Error(`Ugyldig punkt i ${name}`);
        return [num(p[0], name), num(p[1], name)];
    };
    const list = (v, name, max) => {
        if (v === undefined) return [];
        if (!Array.isArray(v) || v.length > max) throw new Error(`For mange eller ugyldige ${name} (maks ${max})`);
        return v;
    };
    const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
    const color = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined);
    const score = (v, name) => (v === undefined ? undefined : num(v, name, 0, 100000));
    const strip = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o; };

    const out = {};
    out.walls = list(input.walls, 'vegger', 60).map(w => strip({
        _info: str(w._info, 80),
        points: list(w.points, 'punkter i vegg', 30).map(p => point(p, 'vegg')),
        closed: !!w.closed || undefined,
        speil: !!w.speil || undefined,
    })).filter(w => w.points.length >= 2);
    out.slingshots = list(input.slingshots, 'slingshots', 6).map(s => strip({
        a: point(s.a, 'slingshot'), b: point(s.b, 'slingshot'), c: point(s.c, 'slingshot'),
        speil: !!s.speil || undefined, score: score(s.score, 'slingshot'),
        kick: s.kick === undefined ? undefined : num(s.kick, 'slingshot', 0, 20),
    }));
    const bumper = (b, name) => strip({
        _info: str(b._info, 80),
        x: num(b.x, name), y: num(b.y, name), r: num(b.r === undefined ? 25 : b.r, name, 8, 80),
        score: score(b.score, name), kick: b.kick === undefined ? undefined : num(b.kick, name, 0, 20),
        icon: str(b.icon, 8), color: color(b.color), speil: !!b.speil || undefined,
    });
    out.popBumpers = list(input.popBumpers, 'pop bumpers', 12).map(b => bumper(b, 'pop bumper'));
    out.bumpers = list(input.bumpers, 'bumpere', 12).map(b => bumper(b, 'bumper'));
    if (input.rollovers) {
        const r = input.rollovers;
        out.rollovers = strip({
            y: num(r.y, 'rollovers'),
            lanes: list(r.lanes, 'rollover-baner', 8).map(x => num(x, 'rollovers')),
            guides: list(r.guides, 'rollover-skinner', 9).map(x => num(x, 'rollovers')),
            guideTop: r.guideTop === undefined ? undefined : num(r.guideTop, 'rollovers'),
            guideBottom: r.guideBottom === undefined ? undefined : num(r.guideBottom, 'rollovers'),
            letters: str(r.letters, 8), score: score(r.score, 'rollovers'),
        });
    }
    const segment = (s, name) => strip({
        _info: str(s._info, 80), from: point(s.from, name), to: point(s.to, name),
        score: score(s.score, name), speil: !!s.speil || undefined,
    });
    out.dropTargets = list(input.dropTargets, 'drop targets', 6).map(d => strip({
        ...segment(d, 'drop targets'), count: Math.round(num(d.count === undefined ? 3 : d.count, 'drop targets', 1, 8)),
    }));
    out.standups = list(input.standups, 'standups', 12).map(s => segment(s, 'standup'));
    out.spinners = list(input.spinners, 'spinnere', 6).map(s => segment(s, 'spinner'));
    out.scoops = list(input.scoops, 'scoops', 4).map(s => strip({
        _info: str(s._info, 80), x: num(s.x, 'scoop'), y: num(s.y, 'scoop'), score: score(s.score, 'scoop'),
        ejectAngle: num(s.ejectAngle === undefined ? 110 : s.ejectAngle, 'scoop', -360, 360),
        ejectSpeed: num(s.ejectSpeed === undefined ? 9 : s.ejectSpeed, 'scoop', 1, 20),
    }));
    out.ramps = list(input.ramps, 'ramper', 4).map(r => strip({
        _info: str(r._info, 80),
        entrance: list(r.entrance, 'rampeinngang', 2).map(p => point(p, 'rampe')),
        path: list(r.path, 'rampebane', 40).map(p => point(p, 'rampe')),
        score: score(r.score, 'rampe'),
        minSpeed: r.minSpeed === undefined ? undefined : num(r.minSpeed, 'rampe', 1, 24),
    })).filter(r => r.entrance.length === 2 && r.path.length >= 2);
    if (['venstre', 'høyre', 'begge'].includes(input.kickback)) out.kickback = input.kickback;
    if (input.rules && typeof input.rules === 'object') {
        const r = input.rules, rules = {};
        for (const k of ['ballSaveSeconds', 'locksForMultiball', 'multiballExtraBalls', 'multiballSaveSeconds', 'jackpotScore',
            'rampsForExtraBall', 'rampComboSeconds', 'rampJackpotAdd', 'rolloversCompleteScore', 'dropsCompleteScore', 'kickbackScore']) {
            if (r[k] !== undefined) rules[k] = num(r[k], 'regler', 0, 1000000);
        }
        if (Array.isArray(r.multipliers)) rules.multipliers = list(r.multipliers, 'multiplikatorer', 8).map(m => num(m, 'multiplikator', 1, 100));
        out.rules = rules;
    }
    for (const k of Object.keys(out)) if (Array.isArray(out[k]) && !out[k].length) delete out[k];
    return out;
}

module.exports = { createBoardStore, cleanBoard };
