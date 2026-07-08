# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Lords of Twilight** — a browser strategy/adventure game in the style of Mike Singleton's *Lords of Midnight*. The entire application is **one file, `twilight.js`**: a Node HTTP server (core modules only) with the whole HTML5-canvas client embedded inside it as a template literal. This single-file constraint is a deliberate user requirement — do not split it into multiple source files, add npm dependencies, a package.json, a framework, or a build step.

## Commands

```bash
node twilight.js          # run the game → http://localhost:3210
PORT=8080 node twilight.js  # alternate port
node --check twilight.js  # syntax check — ALWAYS run after editing
```

There are no tests and no linter. Verification is done by playing the game in a browser (`.claude/launch.json` defines the `twilight` preview server config). All game logic functions (`dispatch`, `activeLord`, `world`, `state`, `tryGenWorld`, `goEnd`, …) are top-level in a classic script, so they are reachable as globals from the browser console / `preview_eval` — teleporting lords, forcing battles, and triggering end screens directly is the established way to test.

## Critical: editing the embedded client

`twilight.js` has three zones:

1. **Server code** (top): plain JS — edit normally.
2. **`const PAGE = \`...\``** (middle, ~90% of the file): the entire client (HTML + CSS + game JS) inside a template literal. Every backtick is escaped as `` \` `` and every `${` as `\${` (and `\` as `\\`). When editing here, **preserve these escapes** — a raw backtick or `${` inside PAGE breaks the whole file. Template literals in client code therefore look like: `` \`Day \${state.day}\` ``.
3. **Server routing** (bottom): plain JS.

For large client changes, the safer workflow is de-fuse → edit → re-fuse in a scratch directory:

```js
// de-fuse: extract the client to page.html
const s = fs.readFileSync('twilight.js','utf8');
const page = s.split('const PAGE = `')[1].split('`;\n\n/* ----')[0]
  .replace(/\\`/g,'`').replace(/\\\$\{/g,'${').replace(/\\\\/g,'\\');
// re-fuse: escape and splice back (escape order: \\ first, then `, then ${)
const esc = t => t.replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\$\{/g,'\\${');
```

After any edit: `node --check twilight.js`, restart the server, play-test.

## Architecture

### Server (Node core only: http, fs, path)
- **High scores**: plain-text DB `highscores.txt`, one record per line: `score|name|days|outcome|iso-date`. `GET/POST /api/scores` returns top 10. Input sanitized (printable ASCII, `|` stripped, lengths capped) to protect the flat file. Delete the file to reset scores.
- **Music**: serves optional `title.mp3` (title screen), `bg.mp3` (gameplay), `win.mp3` (victory), `ded.mp3` (defeat) from beside the script, with HTTP Range support (Safari). Missing files are fine — client probes with HEAD and skips silently.
- Only `/`, `/api/scores`, the four mp3 names, and `/favicon.ico` are routed; everything else 404s.

### Client (embedded in PAGE)
- **Screen state machine**: `state.screen` ∈ `title | play | end` (+ `state.outcome` for victory/gameover). DOM overlays (`#ovTitle`, `#ovEnd`, `#ovMap`, `#ovModal`) sit over one 960×540 canvas; `syncOverlays()` reconciles them. The RAF loop renders per-screen: `renderTitle` / `renderPanorama` / `renderVictory` / `renderGameOver`.
- **World gen**: `genWorld(seed)` → retries `tryGenWorld` (seeded `mulberry32`) up to 12× then falls back to `FALLBACK_SEED`. Every new game rolls a random seed. Invariants: Citadel anchored west, Rift east (`START_X/Y`, `RIFT_X/Y` are mutable globals set per world); a meandering corridor is carved between them; every named place gets an L-shaped mountain pass to the corridor; a BFS "proof-walk" rejects any world where the Rift or any place is unreachable.
- **Panorama renderer**: the signature LoM view. From the active lord's tile, samples a wedge along `DIRS[face]` (8 facings), depth rows `d = 7→1` painted back-to-front with per-row scale/fog (`rowScale`, `rowY`, `rowPalette`). Per-terrain draw functions take `(x, y, scale, tileX, tileY, palette)`; `tRand(tx,ty,i)` gives stable per-tile variation so scenery never flickers. Sky/ground colors come from `envColors(hour, doom)` keyframed over the day and tinted purple by corruption.
- **Input**: every device funnels into `dispatch(action)` — keyboard (`KEYMAP`), mouse (canvas thirds turn/forward + `[data-act]` buttons via one delegated click handler), gamepad (edge-detected polling in the RAF loop). New UI actions = add a `data-act` button + a `dispatch` case.
- **Game loop rules**: lords have `ap` (12/day, terrain-costed moves); `doRest()` runs the night phase — corruption radius grows, warbands spawn/prowl/attack, AP resets, lose conditions checked. Win = enter the Rift with ≥ `SEAL_STRENGTH` total lord strength within 2 tiles (`hostNearRift`). Modals are a queue (`showModal`/`closeModal`); deferred endings go through `queueEnd` and fire when the queue empties (`state.pendingEnd`).
- **Music manager**: `playMusic(name)` tracks `desiredTrack` even while muted so `setMusic(true)` resumes the right track; on/off persists in `localStorage('lot_music')`; autoplay unlock is retried on first pointer/key event.

### Balance tunables
All near the top of the embedded client: `MAPW/MAPH` (60×44), `DAY_LIMIT` (90), `AP_PER_DAY` (12), `SEAL_STRENGTH` (800), `CORRUPT_PER_NIGHT` (0.55 — tuned so corruption reaches the Citadel around day ~80), `MAX_ENEMIES`, `RECRUITS` (the 14 recruitable lords). If you change map size or anchors, keep the corruption pace and `DAY_LIMIT` in step.
