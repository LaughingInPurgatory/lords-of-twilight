# Lords of Twilight

*A tale of the Third Age of Midnight*

A browser strategy/adventure game in the spirit of Mike Singleton's **Lords of Midnight** and **Doomdark's Revenge** — first-person panorama exploration, a compass, and a realm to conquer. This time the enemy isn't Doomdark's army: it's the Abyss itself, pouring through a Rift torn into the world.

The entire game — server and client — lives in a single file, `twilight.js`. No build step, no `npm install`, no framework. Just Node.

## Running it

```bash
node twilight.js
```

Then open **http://localhost:3210** in a browser.

Want a different port?

```bash
PORT=8080 node twilight.js
```

### Music (optional)

Drop these files next to `twilight.js` and the game will find and play them automatically — nothing to configure:

| File        | Plays                    |
|-------------|---------------------------|
| `title.mp3` | Looping, on the title screen |
| `bg.mp3`    | Looping, while you play   |
| `win.mp3`   | On victory                |
| `ded.mp3`   | On defeat                 |

Missing a file? The game just plays silently for that screen — nothing breaks. Music can also be toggled on/off from the title screen or the in-game HUD, and your preference is remembered.

### High scores

Every run can be saved to a local leaderboard kept in a plain-text file, `highscores.txt`, created next to `twilight.js` the first time someone submits a score. Delete it to reset the annals.

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
