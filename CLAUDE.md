# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Lords of Twilight** — a retro-modern browser-style strategy/adventure game in the spirit of Mike Singleton's *Lords of Midnight*, packaged as a **self-contained Electron desktop app**. The foe is Abyssal creatures pouring from a Rift; the player explores a procedurally-generated realm, recruits lords, and gathers a host strong enough to seal the Rift.

There is **no server**. The game is loaded directly into an Electron `BrowserWindow` over `file://`. The **only** thing that ever touches the filesystem outside the app bundle is the plain-text high-score database (`highscores.txt`), written to the per-user data dir.

> History: this began life as a single `twilight.js` Node HTTP server with the client embedded in a template literal. That server was removed; the client was split into normal files and the persistence/audio moved to Electron IPC + bundled assets. If you find references to `twilight.js`, a `PAGE` template literal, or an `/api/scores` HTTP endpoint anywhere, they are stale.

## Commands

```bash
npm install               # one-time: electron + electron-builder (dev deps only)
npm start                 # run the game in its own window (electron .)
npm run icon              # regenerate build/icon.png (pure-Node, no deps)

npm run dist              # build dmg + AppImage + win exe/zip into dist/
npm run dist:mac          # macOS .dmg  (add --x64 / --arm64 to pick arch)
npm run dist:linux        # Linux .AppImage
npm run dist:win          # Windows NSIS installer .exe + portable .zip

node --check main.js preload.js renderer/game.js   # syntax check after editing
```

There are no tests and no linter. Verify by playing, or headlessly: `LOT_SMOKE=1 npx electron .` boots the app, loads the game, prints `LOT_SMOKE_OK`, and quits. To exercise game logic/scores/audio without a visible window, run a throwaway Electron main that `loadFile`s `renderer/index.html` and drives it via `webContents.executeJavaScript` — all game functions (`dispatch`, `activeLord`, `world`, `state`, `tryGenWorld`, `goEnd`, `submitScore`, …) are top-level globals in the renderer, and `window.lotScores` is the score bridge.

## Architecture

Four source files do the work; the game itself is `renderer/game.js`.

### Main process — `main.js`
- Owns the **one external file**: `highscores.txt` in `app.getPath('userData')`. Contains the score DB (`loadScores`/`sanitize`/`addScore`, one `score|name|days|outcome|iso-date` record per line, top-10 by score) exposed over `ipcMain.handle('scores:get' | 'scores:add')`. Input is sanitized (printable ASCII, `|`/`\` stripped, lengths capped). Delete the file to reset scores.
- Creates the `BrowserWindow` (`contextIsolation: true`, `nodeIntegration: false`, `preload.js`) and `loadFile`s `renderer/index.html`. Builds the app menu (New Realm = reload, fullscreen, zoom, devtools). `LOT_SMOKE=1` = headless self-test.

### Preload — `preload.js`
The only renderer↔OS bridge: `contextBridge` exposes `window.lotScores = { get(), add(record) }`, both thin `ipcRenderer.invoke` wrappers. Keep this surface minimal.

### Renderer — `renderer/index.html` + `renderer/game.js`
`index.html` is the page shell + inline CSS + DOM overlays; it loads `game.js` via `<script src="game.js">`. `game.js` is a classic (non-module) script — everything is a top-level global, which is intentional for console/`executeJavaScript` testing. Key systems:
- **Screen state machine**: `state.screen` ∈ `title | play | end` (+ `state.outcome`). DOM overlays (`#ovTitle`, `#ovEnd`, `#ovMap`, `#ovModal`) over one 960×540 canvas; `syncOverlays()` reconciles them. RAF loop renders per-screen: `renderTitle` / `renderPanorama` / `renderVictory` / `renderGameOver`.
- **Random world gen**: `genWorld(seed)` retries `tryGenWorld` (seeded `mulberry32`) up to 12× then falls back to `FALLBACK_SEED`; every new game rolls a random seed. Invariants: Citadel anchored west, Rift east (`START_X/Y`, `RIFT_X/Y` are mutable globals set per world); a meandering corridor is carved between them; every named place gets an L-shaped pass to the corridor; a BFS **proof-walk** rejects any world where the Rift or any place is unreachable.
- **Panorama renderer**: the signature LoM view. From the active lord's tile, samples a wedge along `DIRS[face]` (8 facings), depth rows `d = 7→1` painted back-to-front with per-row scale/fog (`rowScale`, `rowY`, `rowPalette`). Per-terrain draw functions take `(x, y, scale, tileX, tileY, palette)`; `tRand(tx,ty,i)` gives stable per-tile variation. Sky/ground from `envColors(hour, doom)`, keyframed over the day and tinted purple by corruption.
- **Input**: every device funnels into `dispatch(action)` — keyboard (`KEYMAP`), mouse (canvas thirds turn/forward + delegated `[data-act]` buttons), gamepad (edge-detected polling in the RAF loop). New UI action = add a `data-act` button + a `dispatch` case.
- **Music**: the four tracks are **bundled** in `renderer/` and played with a plain relative `new Audio('title.mp3')` (no fetch/probe). `playMusic(name)` tracks `desiredTrack` even while muted so `setMusic(true)` resumes the right track; on/off persists in `localStorage('lot_music')`; autoplay is unlocked on first pointer/key event.
- **Scores**: `fetchScores`/`submitScore` call `window.lotScores`; both degrade gracefully if the bridge is absent (e.g. opened outside Electron).
- **Game loop rules**: lords have `ap` (12/day, terrain-costed); `doRest()` runs the night phase (corruption grows, warbands spawn/prowl/attack, AP resets, lose conditions checked). Win = enter the Rift with ≥ `SEAL_STRENGTH` host strength within 2 tiles (`hostNearRift`). Modals are a queue (`showModal`/`closeModal`); deferred endings go through `queueEnd`/`state.pendingEnd`.

### Assets & packaging
- `renderer/*.mp3` are bundled and `asarUnpack`ed (see `package.json` `build.asarUnpack`) so `file://` audio plays reliably from `app.asar.unpacked`.
- `scripts/make-icon.js`: pure-Node PNG encoder that regenerates `build/icon.png`; electron-builder converts it to `.icns`/`.ico`. Verify a generated PNG by opening it with the Read tool.
- Targets: `mac→dmg`, `win→nsis+zip`, `linux→AppImage`. The Windows NSIS installer cross-builds from macOS via electron-builder's bundled Wine. Builds are **unsigned**. `dist/` and `node_modules/` are gitignored.

### Balance tunables
Near the top of `renderer/game.js`: `MAPW/MAPH` (60×44), `DAY_LIMIT` (90), `AP_PER_DAY` (12), `SEAL_STRENGTH` (800), `CORRUPT_PER_NIGHT` (0.55 — tuned so corruption reaches the Citadel around day ~80), `MAX_ENEMIES`, `RECRUITS` (the recruitable lords). If you change map size or anchors, keep the corruption pace and `DAY_LIMIT` in step.
