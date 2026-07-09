# Lords of Twilight

*A tale of the Third Age of Midnight*

A strategy/adventure game in the spirit of Mike Singleton's **Lords of Midnight** and **Doomdark's Revenge** — first-person panorama exploration, a compass, and a realm to conquer. This time the enemy isn't Doomdark's army: it's the Abyss itself, pouring through a Rift torn into the world.

It's a **fully self-contained desktop app** built with Electron. It opens in its own window — no browser, no server, nothing else to install. Everything (game, artwork, music) is bundled inside the app; the **only** file it ever writes is your high-score table.

## Play

Grab the installer for your platform — each opens the game in its own window:

| Platform | File |
|----------|------|
| **Windows** | `Lords of Twilight-<version>-win-x64.exe` (installer) or `…win-x64.zip` (unzip &amp; run `Lords of Twilight.exe`) |
| **macOS** | `Lords of Twilight-<version>-mac-arm64.dmg` (Apple Silicon) or `…mac-x64.dmg` (Intel) |
| **Linux** | `Lords of Twilight-<version>-linux-x86_64.AppImage` (or `…arm64.AppImage`) — `chmod +x` it, then run |

> The builds are **unsigned**. On macOS the first launch needs right-click → **Open** (or *System Settings → Privacy &amp; Security → Open Anyway*); on Windows SmartScreen, choose **More info → Run anyway**.

Your high scores are saved per-user (e.g. `~/Library/Application Support/Lords of Twilight/highscores.txt` on macOS, `%APPDATA%` on Windows), so they survive reinstalls and updates. That flat text file is the only thing the app writes outside itself — delete it to reset the annals.

The four music tracks (title / gameplay / victory / defeat) are bundled in and play automatically; toggle them on/off from the title screen or the in-game HUD, and your choice is remembered.

## Run from source / build it yourself

You need Node and (for `npm install` only) network access — Electron downloads its platform binaries.

```bash
npm install            # electron + electron-builder (dev deps only)
npm start              # run the game in its own window
npm run icon           # regenerate build/icon.png (optional)

npm run dist:mac       # → dist/*.dmg
npm run dist:linux     # → dist/*.AppImage
npm run dist:win       # → dist/*.exe (NSIS installer) + *.zip
```

`npm run dist` builds all three platforms at once. Cross-building the Windows **NSIS installer** from macOS/Linux works because electron-builder ships its own bundled NSIS + Wine; if that ever fails, `npm run dist:win:nowine` produces just the runnable `.exe`-in-a-`.zip`. Builds default to your machine's CPU architecture — add `--x64` or `--arm64` to target the other.

### Project layout

```
main.js            Electron main process — window + the high-score file (IPC)
preload.js         contextBridge exposing the score API to the game
renderer/
  index.html       page shell + styles
  game.js          the entire game (world, renderer, input, logic, screens)
  *.mp3            bundled music
scripts/make-icon.js   procedural app icon generator (pure Node)
build/icon.png     app icon (→ .icns / .ico at build time)
```

## How to Play

### The story

Long after Doomdark fell and the Ice Crown was shattered, a new wound has torn open in the deep east: **the Abyssal Rift**. Creatures of living shadow are pouring out of it, and a purple corruption is spreading across the land, night by night, toward the **Citadel of Dawn**.

You are **Lord Athelorn**, Heir of the Moonprince. Your quest: ride out from the Citadel, rally every free lord still standing, gather a host strong enough to seal the Rift — before the corruption swallows your home, or time runs out.

### The view

The game presents the world the way the original Lords of Midnight did: a first-person panorama looking out across the land in one of eight compass directions (N, NE, E, SE, S, SW, W, NW). Turn to look around; walk forward to travel one tile in the direction you're facing. Distant mountains, forests, keeps, and the baleful glow of the Rift itself all render live as silhouettes on the horizon.

Every world is procedurally generated and different each time you start a new game — mountain ranges, forests, keeps, villages, towers, and the Rift itself are all placed fresh, though the game always guarantees a walkable path exists to everything.

### Controls

The game supports **keyboard, mouse, and gamepad** simultaneously — use whichever you like.

| Action | Keyboard | Mouse | Gamepad |
|---|---|---|---|
| Turn left / right | `←` `→` or `A` `D` | Click left/right edge of the view | D-pad / left stick |
| Move forward | `↑` or `W` | Click the center of the view | D-pad / left stick up |
| Rest until dawn | `R` | REST button | X |
| Open/close map | `M` | MAP button | Y |
| Switch active lord | `Tab` | NEXT LORD button | LB / RB |
| Confirm / continue | `Enter` or `Space` | Continue button | A |
| Cancel / close | `Esc` | Close button | B |
| Toggle music | — | ♪ button (title or HUD) | — |

### Exploring & recruiting

As you travel, you'll come across:

- **Keeps, villages, and towers** — visit one and, if a lord is waiting there, they join your cause along with their warriors and riders. Your strength grows every time.
- **Towers** — some hold a seer's vision; visiting one may reveal the Rift's location on your map.
- **Abyssal warbands** — roaming patrols of shadow-creatures. Walking into one triggers a battle. Win, and the horde is destroyed (with losses on your side); lose, and your host is bloodied and driven back.

You can command multiple lords at once — recruit them, then use **Tab** to switch which one you're actively directing. Each lord has their own position, army, and hours of daylight remaining.

### Time & the corruption

Each day gives you a limited number of hours to act — moving, fighting, and visiting places all cost time. When you run out, **rest (R)** to advance to the next dawn. But resting has a cost too: every night, the corruption spreading from the Rift grows a little wider, and new Abyssal warbands may emerge and prowl the land. The clock is ticking — you have a limited number of days before the corruption reaches the Citadel of Dawn itself.

### Winning & losing

**Victory** — gather a large enough host near the Rift (the game tells you the target once it's been located) and step into it. Your combined armies seal the Rift shut for good.

**Defeat** — happens if the corruption reaches and swallows the Citadel of Dawn, if every one of your lords falls in battle, or if you run out of days before sealing the Rift.

Either way, you'll get a chance to carve your name — and your score — into the leaderboard, then ride out again into a brand new, freshly generated realm.
