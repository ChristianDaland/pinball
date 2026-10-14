// Egne maskiner laget i redigeringen ("+ Nytt brett"). En egen maskin har navn, ikon, slagord og
// farger, bruker utseendet (theme.js) til en innebygd maskin, og har sitt eget brett og egen toppliste.
// Nye maskiner er utkast (published = false) til de publiseres; da vises de på hovedsiden.
// Med Turso lagres de i tabellen pinball_machines, ellers i en JSON-fil (CUSTOM_MACHINES_FILE).
const fs = require('fs');

function createMachineStore({ file }) {
    let machines = [];   // [{ id, name, tagline, icon, theme, colors, board, published, createdAt }]
    let db = null;

    async function init() {
        const url = process.env.TURSO_DATABASE_URL;
        const authToken = process.env.TURSO_AUTH_TOKEN;
        if (url && (authToken || url.startsWith('file:'))) {
            try {
                const { createClient } = require('@libsql/client');
                db = createClient({ url, authToken });
                await db.execute(`CREATE TABLE IF NOT EXISTS pinball_machines (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                )`);
                const res = await db.execute('SELECT data FROM pinball_machines ORDER BY created_at, id');
                machines = res.rows.map(r => JSON.parse(String(r.data)));
                return;
            } catch (err) {
                console.error('[DB] Feil ved lasting av egne maskiner, bruker JSON-fil:', err.message);
                db = null;
            }
        }
        try {
            machines = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (e) {
            machines = [];
        }
    }

    async function write(m) {
        if (db) {
            await db.execute({
                sql: 'INSERT INTO pinball_machines (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
                args: [m.id, JSON.stringify(m)],
            });
        } else {
            fs.writeFileSync(file, JSON.stringify(machines, null, 2));
        }
    }

    const list = () => machines;

    async function add(m) {
        machines.push(m);
        await write(m);
        return m;
    }

    async function update(id, changes) {
        const m = machines.find(x => x.id === id);
        if (!m) return null;
        Object.assign(m, changes);
        await write(m);
        return m;
    }

    async function remove(id) {
        machines = machines.filter(x => x.id !== id);
        if (db) await db.execute({ sql: 'DELETE FROM pinball_machines WHERE id = ?', args: [id] });
        else fs.writeFileSync(file, JSON.stringify(machines, null, 2));
    }

    return { init, list, add, update, remove };
}

// Lager en id fra navnet (små bokstaver, a–z, 0–9 og bindestrek), unik blant de som finnes
function makeMachineId(name, taken) {
    const base = name.toLowerCase()
        .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'maskin';
    let id = base, n = 2;
    while (taken.includes(id)) id = `${base}-${n++}`;
    return id;
}

module.exports = { createMachineStore, makeMachineId };
