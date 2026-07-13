# CLAUDE.md / AGENTS.md

Guidance for AI assistants working in this repository.

## Project

**Lords of Twilight** (v2.2.0) — retro-modern strategy/adventure in the spirit of Mike Singleton’s *Lords of Midnight*, packaged as a **self-contained Electron desktop app**. Abyssal creatures pour from a Rift; the player explores a procedural realm, recruits lords, and gathers a host to seal the Rift.

There is **no server**. The game loads into a `BrowserWindow` over `file://`. Outside the app bundle the process only touches two files in `app.getPath('userData')`:

| File | Purpose |
|------|---------|
| `highscores.txt` | Top-10 annals (`score\|name\|days\|outcome\|iso-date` per line) |
| `savegame.json` | Single-slot quest save (schema version `v: 1`) |

> History: started as a single `twilight.js` HTTP server with the client in a template literal. Server is gone. Stale if you see `twilight.js`, a `PAGE` template, or `/api/scores`.

## Commands

```bash
npm install               # electron + electron-builder (dev deps only)
npm start                 # run the game (electron .)
npm run icon              # regenerate build/icon.png (pure Node)

npm run dist              # mac + win + linux (all arches configured in scripts)
npm run dist:mac          # .dmg arm64 + x64
npm run dist:linux        # AppImage x64 + arm64
npm run dist:win          # NSIS + zip, x64 + arm64
npm run dist:win:nowine   # zip only (both arches)

# local test builds
npx electron-builder --mac dir --arm64    # .app only
npx electron-builder --mac dmg --arm64    # arm64 dmg

node --check main.js preload.js renderer/game.js
LOT_SMOKE=1 npx electron .                # headless: worldgen + save round-trip → LOT_SMOKE_OK
```

No unit tests / linter. Verify by play or smoke. Renderer game API is top-level globals (`dispatch`, `world`, `state`, `activeLord`, `serializeGame`, …) for `executeJavaScript`. Bridges: `window.lotScores`, `window.lotSave`, `window.lotApp`.

## Layout

```
main.js              Electron main — window, scores + save IPC, clean quit
preload.js           contextBridge only (lotScores / lotSave / lotApp)
renderer/
  index.html         shell, CSS, overlays, HUD
  game.js            entire game (world, render, input, logic, save)
  *.mp3              title / bg / win / ded
scripts/make-icon.js pure-Node icon PNG
build/afterPack.js   macOS ad-hoc codesign after pack
build/icon.png
```

## Architecture

### Main — `main.js`
- **Scores**: rewrite top-N on add; names sanitized (printable ASCII, strip `|\\<>&`).
- **Save IPC**: `save:get` / `save:meta` / `save:write` / `save:clear`; 2 MiB cap; rejects non-`v:1` payloads.
- **Window**: `contextIsolation`, `sandbox`, no `nodeIntegration`; `loadFile(renderer/index.html)`.
- **Quit**: single-window game — traffic-light close, last window, and `app:quit` all call `quitApp()` (destroy window → `app.quit` → hard `app.exit(0)` after 400 ms if needed). Do not reintroduce “keep alive on macOS after window close” without product intent.
- **Menu**: Save/Continue (⌘S / ⌘O → renderer), New Realm (reload), View, Help.
- **Smoke**: `LOT_SMOKE=1` runs genWorld, play step, serialize/persist/restore, logs `LOT_SMOKE_OK`.

### Preload — `preload.js`
Minimal bridge only:
- `lotScores.get/add`
- `lotSave.get/meta/write/clear` + `onMenuSave` / `onMenuContinue`
- `lotApp.quit`

### Renderer — `game.js` (+ `index.html`)
Classic non-module script (globals intentional).

| System | Notes |
|--------|--------|
| Screens | `state.screen` ∈ `title \| play \| end`; overlays `#ovTitle` `#ovEnd` `#ovMap` `#ovModal` `#ovPause`; `syncOverlays()` |
| Worldgen | `genWorld` → `tryGenWorld` (mulberry32), 12 attempts + `FALLBACK_SEED`; citadel west / rift east; corridor + L-passes; **BFS** proof-walk |
| Panorama | LoM wedge on 8 facings, depth `d=7→1`; `cam` pan/zoom/bob/roll on turn/move; pseudo-3D terrain (lit/shade faces); grass/pebbles on ground |
| Terrain art | Mountains = multi-peak lit/shade/snow; forest = pines + some broadleafs; keeps/villages/towers with side faces |
| Input | All devices → `dispatch(act)`; keys, canvas thirds, `[data-act]`, gamepad edge-poll |
| Move | `tryStep(+1/-1)` forward/back; costs from `MOVE_COST` + corrupt; battle if horde on tile |
| Night | `doRest()`: day++, corruption, spawn/prowl, keep rally, lose checks |
| Save | `serializeGame` / `applySaveData` / `autoSave` / `continueQuest`; Electron file or `localStorage` fallback; cleared on new game / end |
| Music | Bundled relative `Audio`; `stopMusic` + cancel RAF on `shutdownRenderer` (pagehide/beforeunload/quit) |
| Scores | Via `lotScores`; HTML-escape names on display |

**New action checklist:** `data-act` button (if UI) + `dispatch` case (+ `KEYMAP` / pad map if needed).

### Packaging
- `asarUnpack`: `**/*.mp3`
- `afterPack`: ad-hoc sign mac `.app` (no paid Developer ID)
- Artifacts unsigned; Gatekeeper / SmartScreen notes live in README
- `dist/`, `node_modules/` gitignored

## Balance tunables (`renderer/game.js` top)

| Constant | Typical | Role |
|----------|---------|------|
| `MAPW`/`MAPH` | 60×44 | map size |
| `DAY_LIMIT` | 100 | calendar cap |
| `AP_PER_DAY` | 12 | hours of daylight |
| `SEAL_STRENGTH` | 750 | host needed at Rift |
| `CORRUPT_PER_NIGHT` | 0.50 | radius growth (~citadel near end of campaign) |
| `MAX_ENEMIES` | 16 | warband cap |
| `ENEMY_AGGRO` | 6 | night pursuit Chebyshev range |
| `ENEMY_SPAWN_EVERY` | 4 | days between spawns |
| `RALLY_WAR` | citadel/keep/village | night recruit amounts |
| `BATTLE_WIN_LOSS_CAP` | 0.50 | max fraction lost on victory |
| `SEAL_FAIL_KEEP` | 0.85 | strength kept after failed seal |
| `RECRUITS` | array | named lords at places |

Changing map size or anchors → re-tune corruption vs `DAY_LIMIT`.

## Conventions
- No new deps unless required; game is pure canvas + DOM in the renderer.
- Keep IPC surface tiny; sanitize anything that hits disk or `innerHTML`.
- Prefer small diffs in `game.js` over rewrites; globals are deliberate for smoke/console.
- After substantive edits: `node --check …` and/or `LOT_SMOKE=1 npx electron .`.
- Do not commit `dist/` or `node_modules/`.
