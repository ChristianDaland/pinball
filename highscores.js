// Topplister per maskin – de 10 beste til enhver tid.
// Med TURSO_DATABASE_URL og TURSO_AUTH_TOKEN (samme oppsett som Hybrid Poker) lagres alle
// resultater i Turso-tabellen pinball_highscores, og overlever deploy og omstart på Render.
// Uten database brukes en JSON-fil (HIGHSCORE_FILE), som på Render nullstilles ved deploy.
// En "file:"-adresse i TURSO_DATABASE_URL gir en lokal SQLite-fil (for testing).
const fs = require('fs');

const TOP_N = 10;

function createHighScores({ machineIds, file }) {
    const lists = {};               // maskin-id -> [{ name, score }] (maks TOP_N, best først)
    for (const id of machineIds) lists[id] = [];
    let db = null;

    async function init() {
        const url = process.env.TURSO_DATABASE_URL;
        const authToken = process.env.TURSO_AUTH_TOKEN;
        if (url && (authToken || url.startsWith('file:'))) {
            try {
                const { createClient } = require('@libsql/client');
                db = createClient({ url, authToken });
                await db.execute(`CREATE TABLE IF NOT EXISTS pinball_highscores (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    machine TEXT NOT NULL,
                    name TEXT NOT NULL,
                    score INTEGER NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                )`);
                await db.execute('CREATE INDEX IF NOT EXISTS pinball_highscores_machine_score ON pinball_highscores (machine, score DESC)');
                for (const id of machineIds) {
                    const res = await db.execute({
                        sql: 'SELECT name, score FROM pinball_highscores WHERE machine = ? ORDER BY score DESC, id ASC LIMIT ?',
                        args: [id, TOP_N],
                    });
                    lists[id] = res.rows.map(r => ({ name: String(r.name), score: Number(r.score) }));
                }
                console.log('[DB] Tilkoblet Turso – topplister lastet.');
                return;
            } catch (err) {
                console.error('[DB] Feil ved databaseinit, bruker JSON-fil:', err.message);
                db = null;
            }
        } else {
            console.warn('[DB] TURSO_DATABASE_URL / TURSO_AUTH_TOKEN er ikke satt – topplistene lagres i', file);
        }
        loadFile();
    }

    // Filformat: { "<maskin-id>": [{ name, score }, …] }. Gammelt format (én liste) hører til gården.
    function loadFile() {
        let data = {};
        try {
            data = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (e) { /* ingen fil ennå */ }
        if (Array.isArray(data)) data = { gard: data };
        for (const id of machineIds) {
            const list = Array.isArray(data && data[id]) ? data[id] : [];
            lists[id] = list.filter(h => h && typeof h.name === 'string' && Number.isFinite(h.score))
                .sort((a, b) => b.score - a.score).slice(0, TOP_N);
        }
    }

    function saveFile() {
        fs.writeFile(file, JSON.stringify(lists, null, 2), (err) => {
            if (err) console.error('Kunne ikke lagre topplista:', err.message);
        });
    }

    function top(machine) {
        return lists[machine] || [];
    }

    // Legger til et resultat. Lista i minnet oppdateres med en gang; databasen i bakgrunnen.
    function add(machine, name, score) {
        if (!lists[machine] || !(score > 0)) return;
        const list = lists[machine];
        list.push({ name, score });
        list.sort((a, b) => b.score - a.score); // stabil sortering: likt resultat havner etter de eldre
        lists[machine] = list.slice(0, TOP_N);
        if (db) {
            db.execute({ sql: 'INSERT INTO pinball_highscores (machine, name, score) VALUES (?, ?, ?)', args: [machine, name, score] })
                .catch(err => console.error('[DB] Kunne ikke lagre resultat:', err.message));
        } else {
            saveFile();
        }
    }

    return { init, top, add, TOP_N };
}

module.exports = { createHighScores };
