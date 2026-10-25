# CLAUDE.md

Flerspiller-flipperspill: ett felles brett på en storskjerm, spillerne styrer med mobilen.
Serveren eier all spilltilstand og kjører fysikk og regler; nettleserne tegner bare det serveren sender.
Kode, kommentarer, commit-meldinger og brukertekster er på norsk.

## Kommandoer

- `npm install` og `npm start`: starter serveren på port 10000 (eller `PORT`).
- Tester: `node --test tests/*.test.js` (37 tester). `npm test` (`node --test tests/`) feiler på
  Node 24, som ikke godtar en mappe som argument.
- Ingen byggesteg: alt i `public/` serveres som det er.

## Oppbygning

Server (rotmappa, CommonJS):

- `server.js`: Express og Socket.IO, kø og turer, spill-løkka på 60 Hz, REST-API for redigeringen.
- `physics.js`: egenskrevet 2D-fysikk. Brettet er 800 × 1300, fart i enheter per tick, 6 delsteg per tick.
  `step()` returnerer hendelser og gir ingen poeng selv.
- `rules.js`: gjør hendelsene om til poeng, bonus, multiplikator, ball save, multiball, jackpot og
  rampecombo. `DEFAULT_RULES` kan overstyres per maskin under `rules` i `board.json`.
- `boards.js`: lagrede brett med alle versjoner (angre). `cleanBoard()` validerer brett før lagring.
- `custommachines.js`: egne maskiner fra redigeringen. `highscores.js`: topp 10 per maskin.

`physics.js` og `rules.js` brukes også i nettleseren. Serveren pakker dem inn på `/engine/physics.js`
og `/engine/rules.js` som `window.PinballPhysics` og `window.PinballRules` (pakkingen ligger i
`server.js`). De må derfor fortsatt virke uten Node: ingen `require` av andre moduler.

Nettsider (`public/`):

- `index.html`: velg styring (tastatur eller mobil, huskes i `localStorage`), maskinkort, QR-koder
  (bare ved mobil) og knapper som åpner brett og poengtavle i egne vinduer.
- `pinball.html`: storskjermen. Sender `table-screen` og får `state` 60 ganger i sekundet. Ved
  tastaturspill blir vinduet selv en spiller: hovedsiden sender `?spill=<maskin>&navn=<navn>`
  (eller en beskjed over BroadcastChannel hvis vinduet er åpent), og vinduet stiller seg i kø med
  egen klient-id (`pinball-tastatur-id`).
- `mobile.html`: spillerens kontroller (navn, kø, flippere, fjær).
- `score.html`: kø, poeng og topplister.
- `redigering.html`: brettredigering, egne maskiner, «Prøv brettet» (lokal fysikk) og
  «Sjekk brettet» (5 minutter simulert spill med robotspiller).
- `engine/renderer.js` tegner på canvas ut fra layout, state og et tema. `engine/sound.js` lager all lyd
  med Web Audio, uten lydfiler. `engine/screens.js` bruker BroadcastChannel mellom vinduene.

Maskiner: `public/machines/<id>/` med `machine.json` (navn, ikon, farger), `board.json` (elementer og
regler) og `theme.js` (`PinballThemes['<id>']`, utseende og lyder). Innebygd finnes `gard` og `rommet`.
Ny innebygd maskin = ny mappe og omstart; den lastes automatisk.

## Viktig å vite

- Det finnes bare ett fysisk brett og én spiller om gangen. Brettet bytter til maskinen til den som har tur.
- Fast for alle maskiner (i `physics.js`): yttervegger, buet tak, kanal, enveisport, inlane-skinner og
  flippere. Alt annet kommer fra brettet via `loadBoard()`.
- Brettet er speilsymmetrisk om x = 350; `"speil": true` gir en speilet kopi.
- Hvilket brett som gjelder: siste lagring fra redigeringen, ellers `board.json`. En lagring med
  `_standard: true` betyr «bruk standardbrettet».
- Nye elementfelt må legges inn i `cleanBoard()`, ellers fjernes de ved lagring. Testen i
  `tests/boards.test.js` sjekker at standardbrettene gir samme fysikk etter `cleanBoard()`.
- Spillere identifiseres med en fast klient-id fra `localStorage`. Den er en hemmelig nøkkel og skal
  aldri sendes til andre klienter; de ser bare den offentlige id-en.
- Trafikk koster (Render tar betalt over 5 GB ut i måneden): `state` sendes bare når den har endret seg,
  andre sider enn storskjermen får den 10 ganger i sekundet, tall rundes, og meldinger komprimeres.
  Hold `buildGameState()` liten.
- Lagring: Turso (libSQL) når `TURSO_DATABASE_URL` og `TURSO_AUTH_TOKEN` er satt, ellers JSON-filer
  (`highscores.json`, `saved-boards.json`, `custom-machines.json`, som er i `.gitignore`).
  På Render nullstilles JSON-filene ved deploy.
- REST-API-et (`/api/maskiner`, `/api/brett`) har ingen tilgangskontroll.
- Kø og poeng i pågående spill ligger bare i minnet.
