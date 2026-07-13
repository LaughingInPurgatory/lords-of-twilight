/* ==========================================================================
   LORDS OF TWILIGHT — a tale of the Third Age of Midnight
   A spiritual sequel to Mike Singleton's Lords of Midnight / Doomdark's
   Revenge. Panorama exploration, lord recruiting, and the Abyssal Rift.
   Pure canvas + DOM. No dependencies.
   ========================================================================== */
'use strict';

/* ---------------------------------------------------------------- helpers */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp  = (a, b, t) => a + (b - a) * t;
const colLerp = (a, b, t) => [lerp(a[0],b[0],t), lerp(a[1],b[1],t), lerp(a[2],b[2],t)];
const rgb  = c => `rgb(${c[0]|0},${c[1]|0},${c[2]|0})`;
const rgba = (c, a) => `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;
/* scores / player names land in innerHTML — strip markup characters */
const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* stable per-tile variation so scenery never flickers frame to frame */
function tRand(tx, ty, i) {
  let s = (tx * 374761393 + ty * 668265263 + i * 2246822519) >>> 0;
  s = Math.imul(s ^ (s >>> 13), 1274126177) >>> 0;
  return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
}

/* ------------------------------------------------------------- constants */
const DIRS = [
  { dx: 0, dy: -1 }, { dx: 1, dy: -1 }, { dx: 1, dy: 0 }, { dx: 1, dy: 1 },
  { dx: 0, dy: 1 },  { dx: -1, dy: 1 }, { dx: -1, dy: 0 }, { dx: -1, dy: -1 },
];
const DIRNAMES = ['north','north-east','east','south-east','south','south-west','west','north-west'];
const DIRSHORT = ['N','NE','E','SE','S','SW','W','NW'];

const MAPW = 60, MAPH = 44;
let RIFT_X = 52, RIFT_Y = 22;       /* re-anchored for every new world */
let START_X = 6, START_Y = 22;
/* ---- balance tunables --------------------------------------------------
   Aimed at a ~100-day campaign: corruption reaches the Citadel near the
   final days (dist ~46–50 × 0.50 ≈ day 92–100), seal needs a real host
   (~half the free lords + night recruits), and night pressure is present
   without steamrolling a careful player.                                  */
const DAY_LIMIT = 100;
const AP_PER_DAY = 12;
const HOUR_STEP = 16 / AP_PER_DAY;      /* daylight spans 06:00 → 22:00 */
const SEAL_STRENGTH = 750;
const CORRUPT_PER_NIGHT = 0.50;
const MAX_ENEMIES = 16;
const ENEMY_AGGRO = 6;                 /* chebyshev range for night pursuit */
const ENEMY_SPAWN_EVERY = 4;           /* nights between new warbands */
const RALLY_WAR = { citadel: 10, keep: 8, village: 5 };
const BATTLE_WIN_LOSS_CAP = 0.50;      /* max fraction lost on a victory */
const SEAL_FAIL_KEEP = 0.85;           /* strength retained after a failed seal */
const FALLBACK_SEED = 20260707;     /* proven-good world if generation ever fails */
const SAVE_VERSION = 1;

const MOVE_COST = { plains:1, downs:1, keep:1, citadel:1, village:1, tower:1, forest:2, hills:2, wasteland:2, rift:2 };
const TERRAIN_AHEAD = {
  mountains:'the mountains', forest:'a dark forest', hills:'rolling hills',
  downs:'the downs', wasteland:'the blighted waste', rift:'THE ABYSSAL RIFT', plains:'the open plains',
};
const TERRAIN_AT = {
  plains:'on the plains', forest:'in a dark forest', hills:'among the hills',
  downs:'on the downs', wasteland:'in the blighted waste',
};

/* ------------------------------------------------------------------ DOM */
const cv = document.getElementById('scene'), g = cv.getContext('2d');
const W = cv.width, H = cv.height;
const HORIZON = Math.round(H * 0.42);
const mapCv = document.getElementById('mapc'), mg = mapCv.getContext('2d');
const portCv = document.getElementById('portrait'), pg = portCv.getContext('2d');
const $ = id => document.getElementById(id);

/* -------------------------------------------------------------- music ---
   The four tracks are bundled beside index.html, so a plain relative
   Audio() src loads them straight from disk — no server, no fetch.
   A missing file just fails silently.                                     */
const MUSIC = { title:'title.mp3', play:'bg.mp3', victory:'win.mp3', gameover:'ded.mp3' };
let curTrack = null, curTrackName = '', desiredTrack = '', musicToken = 0;
let musicOn = localStorage.getItem('lot_music') !== 'off';
function playMusic(name) {
  desiredTrack = name;                         /* remembered so toggling on resumes the right track */
  if (curTrackName === name && curTrack) return;
  const token = ++musicToken;
  if (curTrack) { curTrack.pause(); curTrack = null; }
  curTrackName = '';
  const file = MUSIC[name];
  if (!file || !musicOn) return;
  if (token !== musicToken || !musicOn) return;
  const a = new Audio(file);
  a.loop = (name === 'title' || name === 'play');
  a.volume = 0.55;
  a.addEventListener('error', () => { if (curTrack === a) { curTrack = null; curTrackName = ''; } });
  curTrack = a;
  curTrackName = name;
  a.play().catch(() => {});                    /* autoplay-blocked until a gesture */
}
function stopMusic() {
  musicToken++;
  if (curTrack) {
    try { curTrack.pause(); curTrack.removeAttribute('src'); curTrack.load(); } catch { /* ignore */ }
    curTrack = null;
  }
  curTrackName = '';
}
function setMusic(on) {
  musicOn = on;
  localStorage.setItem('lot_music', on ? 'on' : 'off');
  if (!on) {
    stopMusic();
  } else if (desiredTrack) {
    playMusic(desiredTrack);
  }
  updateMusicUI();
}
function updateMusicUI() {
  const t = $('musicBtnTitle'); if (t) t.textContent = musicOn ? '♪ Music: On' : '♪ Music: Off';
  const h = $('musicBtnHud'); if (h) h.textContent = musicOn ? '♪ ON' : '♪ OFF';
}
/* browsers block autoplay until the first interaction — resume then */
for (const ev of ['pointerdown', 'keydown']) {
  document.addEventListener(ev, () => {
    if (curTrack && curTrack.paused) curTrack.play().catch(() => {});
  }, { capture: true });
}

/* ------------------------------------------------------------- game data */
const RECRUITS = [
  { key:'Thornfast',  name:'Thane Brekka',   title:'the Ironvale',      war:110, rid:40 },
  { key:'Greyvale',   name:'Lady Sylvara',   title:'of the Mists',      war:80,  rid:70 },
  { key:'Ravenmoor',  name:'Lord Gareth',    title:'the Duskbane',      war:130, rid:50 },
  { key:'Coldstone',  name:'Marshal Dorn',   title:'of Coldstone',      war:150, rid:60 },
  { key:'Duskholm',   name:'Lord Veyran',    title:'the Grim',          war:120, rid:55 },
  { key:'Stormgard',  name:'Thane Ulric',    title:'of Stormgard',      war:140, rid:45 },
  { key:'Westmarch',  name:'Warden Cael',    title:'of Westmarch',      war:100, rid:60 },
  { key:'Elmwick',    name:'Fenwick',        title:'the Bold',          war:60,  rid:20 },
  { key:'Millbrook',  name:'Elara',          title:'the Moonwhisper',   war:70,  rid:40 },
  { key:'Ashford',    name:'Captain Torvin', title:'of Ashford',        war:90,  rid:30 },
  { key:'Braewynn',   name:'Rhoswen',        title:'of Braewynn',       war:80,  rid:45 },
  { key:'Fernhollow', name:'Bryn',           title:'of Fernhollow',     war:70,  rid:25 },
  { key:'Oakhurst',   name:'Maera',          title:'of Oakhurst',       war:65,  rid:35 },
  { key:'Seer',       name:'Ithrilan',       title:'the Seer',          war:40,  rid:20 },
];

let world, state;

/* -------------------------------------------------------------- worldgen */
function inMap(x, y) { return x >= 0 && y >= 0 && x < MAPW && y < MAPH; }
function tileAt(x, y) { return inMap(x, y) ? world.tiles[y * MAPW + x] : null; }

/* every quest is a new realm: roll worlds until one passes the proof-walk */
function genWorld(seed) {
  for (let attempt = 0; attempt < 12; attempt++) {
    if (tryGenWorld((seed + attempt * 7919) >>> 0)) return;
  }
  tryGenWorld(FALLBACK_SEED);
}

function tryGenWorld(seed) {
  const rnd = mulberry32(seed);
  /* anchors: the Citadel rises in the west, the Rift gapes in the east */
  START_X = 4 + Math.floor(rnd() * 4);
  START_Y = 8 + Math.floor(rnd() * (MAPH - 16));
  RIFT_X = MAPW - 10 + Math.floor(rnd() * 4);
  RIFT_Y = 9 + Math.floor(rnd() * (MAPH - 18));
  const tiles = [];
  for (let i = 0; i < MAPW * MAPH; i++) tiles.push({ t:'plains', place:null, corrupt:false });
  const set = (x, y, t) => { if (inMap(x, y)) tiles[y * MAPW + x].t = t; };
  const get = (x, y) => inMap(x, y) ? tiles[y * MAPW + x].t : 'mountains';

  /* border wall of mountains */
  for (let x = 0; x < MAPW; x++) { set(x, 0, 'mountains'); set(x, MAPH - 1, 'mountains'); }
  for (let y = 0; y < MAPH; y++) { set(0, y, 'mountains'); set(MAPW - 1, y, 'mountains'); }
  for (let x = 1; x < MAPW - 1; x++) {
    if (rnd() < 0.45) set(x, 1, 'mountains');
    if (rnd() < 0.45) set(x, MAPH - 2, 'mountains');
  }

  /* interior mountain chains */
  for (let c = 0; c < 14; c++) {
    let x = 3 + Math.floor(rnd() * (MAPW - 6));
    let y = 3 + Math.floor(rnd() * (MAPH - 6));
    const len = 8 + Math.floor(rnd() * 10);
    for (let i = 0; i < len; i++) {
      const nearStart = Math.abs(x - START_X) <= 2 && Math.abs(y - START_Y) <= 2;
      const nearRift  = Math.abs(x - RIFT_X)  <= 4 && Math.abs(y - RIFT_Y)  <= 4;
      if (!nearStart && !nearRift) set(x, y, 'mountains');
      x += Math.floor(rnd() * 3) - 1; y += Math.floor(rnd() * 3) - 1;
      x = clamp(x, 1, MAPW - 2); y = clamp(y, 1, MAPH - 2);
    }
  }

  /* terrain blobs */
  const blob = (type, count, rad) => {
    for (let b = 0; b < count; b++) {
      const cx = 2 + Math.floor(rnd() * (MAPW - 4)), cy = 2 + Math.floor(rnd() * (MAPH - 4));
      const r = 1 + Math.floor(rnd() * rad);
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
        if ((x-cx)*(x-cx) + (y-cy)*(y-cy) <= r*r + rnd() && get(x, y) === 'plains') set(x, y, type);
      }
    }
  };
  blob('forest', 18, 3); blob('hills', 14, 3); blob('downs', 10, 3);

  /* the Rift and its blighted waste */
  for (let y = RIFT_Y - 4; y <= RIFT_Y + 4; y++) for (let x = RIFT_X - 4; x <= RIFT_X + 4; x++) {
    if (inMap(x, y) && x > 0 && x < MAPW - 1 && y > 0 && y < MAPH - 1 &&
        (x-RIFT_X)*(x-RIFT_X) + (y-RIFT_Y)*(y-RIFT_Y) <= 17) set(x, y, 'wasteland');
  }
  set(RIFT_X, RIFT_Y, 'rift');

  /* carve a guaranteed meandering corridor citadel -> rift, remembering it */
  const corridor = [];
  let py = START_Y;
  for (let x = START_X; x <= RIFT_X; x++) {
    const t = (x - START_X) / Math.max(1, RIFT_X - START_X);
    py = clamp(Math.round(lerp(START_Y, RIFT_Y, t) + Math.sin(x * 0.35) * 3 + (rnd() - 0.5) * 2), 2, MAPH - 3);
    for (const yy of [py - 1, py, py + 1]) {
      if (get(x, yy) === 'mountains') set(x, yy, rnd() < 0.4 ? 'hills' : 'plains');
    }
    corridor.push([x, py]);
  }

  /* named places — scattered anew for every world */
  const placeSpecs = [
    { type:'citadel', name:'Citadel of Dawn', key:null, x:START_X, y:START_Y },
    { type:'keep',    name:'Keep of Thornfast',     key:'Thornfast' },
    { type:'keep',    name:'Keep of Greyvale',      key:'Greyvale' },
    { type:'keep',    name:'Keep of Ravenmoor',     key:'Ravenmoor' },
    { type:'keep',    name:'Keep of Coldstone',     key:'Coldstone' },
    { type:'keep',    name:'Keep of Duskholm',      key:'Duskholm' },
    { type:'keep',    name:'Keep of Stormgard',     key:'Stormgard' },
    { type:'keep',    name:'Keep of Westmarch',     key:'Westmarch' },
    { type:'village', name:'Village of Elmwick',    key:'Elmwick' },
    { type:'village', name:'Village of Millbrook',  key:'Millbrook' },
    { type:'village', name:'Village of Ashford',    key:'Ashford' },
    { type:'village', name:'Village of Braewynn',   key:'Braewynn' },
    { type:'village', name:'Village of Fernhollow', key:'Fernhollow' },
    { type:'village', name:'Village of Oakhurst',   key:'Oakhurst' },
    { type:'village', name:'Village of Redbrook',   key:null },
    { type:'tower',   name:'Tower of the Seer',     key:'Seer' },
    { type:'tower',   name:'Tower of Whispers',     key:null },
    { type:'tower',   name:'Watchtower of Morn',    key:null },
    { type:'tower',   name:'Tower of Gloamwatch',   key:null },
    { type:'tower',   name:'Tower of Highspire',    key:null },
  ];
  /* spots keep their distance from one another and shun the blight */
  const placed = [{ x:START_X, y:START_Y }, { x:RIFT_X, y:RIFT_Y }];
  const findSpot = () => {
    for (let minDist = 5; minDist >= 2; minDist--) {
      for (let tries = 0; tries < 250; tries++) {
        const x = 3 + Math.floor(rnd() * (MAPW - 7));
        const y = 2 + Math.floor(rnd() * (MAPH - 4));
        if (get(x, y) === 'rift') continue;
        if (Math.hypot(x - RIFT_X, y - RIFT_Y) < 7) continue;
        if (placed.some(p => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) < minDist)) continue;
        return { x, y };
      }
    }
    return null;
  };
  const places = [];
  for (const spec of placeSpecs) {
    let sx = spec.x, sy = spec.y;
    if (sx === undefined) {
      const s = findSpot();
      if (!s) return false;
      sx = s.x; sy = s.y;
    }
    placed.push({ x: sx, y: sy });
    set(sx, sy, spec.type);
    /* keep approaches passable */
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && get(sx + dx, sy + dy) === 'mountains' &&
          sx + dx > 0 && sx + dx < MAPW - 1 && sy + dy > 0 && sy + dy < MAPH - 1) {
        set(sx + dx, sy + dy, 'plains');
      }
    }
    const rec = spec.key ? RECRUITS.find(r => r.key === spec.key) : null;
    const place = { type: spec.type, name: spec.name, key: spec.key, x: sx, y: sy, lord: rec || null, recruited: false, visited: false };
    places.push(place);
    tiles[sy * MAPW + sx].place = place;
    /* carve an L-shaped pass to the great corridor so no hold is sealed off */
    let bx = corridor[0][0], by = corridor[0][1], bd = 1e9;
    for (const [cx2, cy2] of corridor) {
      const d = Math.abs(cx2 - sx) + Math.abs(cy2 - sy);
      if (d < bd) { bd = d; bx = cx2; by = cy2; }
    }
    let wx = sx;
    while (wx !== bx) { wx += Math.sign(bx - wx); if (get(wx, sy) === 'mountains') set(wx, sy, rnd() < 0.4 ? 'hills' : 'plains'); }
    let wy = sy;
    while (wy !== by) { wy += Math.sign(by - wy); if (get(bx, wy) === 'mountains') set(bx, wy, rnd() < 0.4 ? 'hills' : 'plains'); }
  }

  /* abyssal warbands — two guards at the very brink, the rest prowl the east */
  const enemies = [];
  const brink = DIRS.map(d => [RIFT_X + d.dx, RIFT_Y + d.dy])
    .filter(([x, y]) => get(x, y) !== 'mountains' && get(x, y) !== 'rift');
  for (let i = 0; i < 2 && brink.length; i++) {
    const [x, y] = brink.splice(Math.floor(rnd() * brink.length), 1)[0];
    enemies.push({ x, y, str: 240 + Math.floor(rnd() * 40) });
  }
  for (let tries = 0; enemies.length < 12 && tries < 400; tries++) {
    const x = Math.floor(MAPW * 0.45) + Math.floor(rnd() * Math.floor(MAPW * 0.5));
    const y = 2 + Math.floor(rnd() * (MAPH - 4));
    const t = get(x, y);
    if (t === 'mountains' || t === 'rift') continue;
    if (tiles[y * MAPW + x].place) continue;
    if (Math.max(Math.abs(x - START_X), Math.abs(y - START_Y)) < 14) continue;
    if (enemies.some(e => Math.max(Math.abs(e.x - x), Math.abs(e.y - y)) < 3)) continue;
    enemies.push({ x, y, str: 100 + Math.floor(rnd() * 75) });
  }

  /* the proof-walk: the Rift and every named place must be reachable (BFS) */
  const seen = new Uint8Array(MAPW * MAPH);
  const queue = [[START_X, START_Y]];
  seen[START_Y * MAPW + START_X] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const [x, y] = queue[qi];
    for (const d of DIRS) {
      const nx = x + d.dx, ny = y + d.dy;
      if (!inMap(nx, ny) || seen[ny * MAPW + nx] || tiles[ny * MAPW + nx].t === 'mountains') continue;
      seen[ny * MAPW + nx] = 1;
      queue.push([nx, ny]);
    }
  }
  if (!seen[RIFT_Y * MAPW + RIFT_X]) return false;
  if (places.some(p => !seen[p.y * MAPW + p.x])) return false;

  world = {
    tiles, places, enemies,
    discovered: new Uint8Array(MAPW * MAPH),
    corruptR: 2.5,
    riftKnown: false,
  };
  applyCorruption();
  return true;
}

function applyCorruption() {
  for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) {
    const d = Math.hypot(x - RIFT_X, y - RIFT_Y);
    world.tiles[y * MAPW + x].corrupt = d <= world.corruptR;
  }
}

function reveal(cx, cy, r) {
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if (inMap(x, y) && (x-cx)*(x-cx) + (y-cy)*(y-cy) <= r*r + 1) {
      world.discovered[y * MAPW + x] = 1;
      if (world.tiles[y * MAPW + x].t === 'rift') world.riftKnown = true;
    }
  }
}

/* ----------------------------------------------------------------- state */
function newGame() {
  genWorld((Math.random() * 4294967296) >>> 0);   /* a new realm every quest */
  const battleSeed = (Math.random() * 1e9) | 0;
  state = {
    screen: state ? state.screen : 'title',
    day: 1,
    lords: [{
      name:'Lord Athelorn', title:'Heir of the Moonprince', x:START_X, y:START_Y,
      face:2, war:130, rid:70, ap:AP_PER_DAY, alive:true, seed:7,
    }],
    active: 0,
    modals: [],
    pendingEnd: null,
    endAnim: 0,
    scoreSent: false,
    stats: { battles: 0, recruited: 0 },
    battleSeed,
    rngBattle: mulberry32(battleSeed),
  };
  reveal(START_X, START_Y, 3);
  updateHUD();
}

const lordStr = l => l.war + l.rid * 1.5;
function stackAt(x, y) { return state.lords.filter(l => l.alive && l.x === x && l.y === y); }
function hostNearRift() {
  return state.lords.filter(l => l.alive && Math.max(Math.abs(l.x - RIFT_X), Math.abs(l.y - RIFT_Y)) <= 2)
    .reduce((s, l) => s + lordStr(l), 0);
}
function totalStr() { return state.lords.filter(l => l.alive).reduce((s, l) => s + lordStr(l), 0); }
function activeLord() {
  const l = state.lords[state.active];
  if (l && l.alive) return l;
  const idx = state.lords.findIndex(x => x.alive);
  if (idx >= 0) { state.active = idx; return state.lords[idx]; }
  return state.lords[0]; /* last fallen lord — end screen still needs a portrait */
}
function livingLords() { return state.lords.filter(l => l.alive); }
function lordsWithAp() { return livingLords().filter(l => l.ap > 0); }
function phaseName(h) {
  return h < 6 ? 'night' : h < 9 ? 'dawn' : h < 12 ? 'morning' : h < 16 ? 'afternoon' : h < 19 ? 'evening' : h < 22 ? 'dusk' : 'night';
}

/* ================================================================= RENDER */

/* camera motion — discrete LoM steps get a short ease so the world feels
   like it is sliding/rushing past rather than teleporting tile-to-tile.   */
const cam = {
  pan: 0, zoom: 0, bob: 0, roll: 0, drift: 0,
  lastT: 0,
};
function kickTurn(dir) {
  cam.pan = dir * 1.15;
  cam.roll = dir * 0.055;
  cam.drift = dir * 0.35;
}
function kickMove(sign) {
  /* +1 forward (zoom in / rush), -1 back (zoom out / fall away) */
  cam.zoom = sign > 0 ? 0.16 : -0.12;
  cam.bob = sign > 0 ? 1.0 : 0.7;
  cam.drift += sign * 0.15;
}
function tickCam(time) {
  const dt = cam.lastT ? Math.min(0.05, time - cam.lastT) : 0.016;
  cam.lastT = time;
  const decay = Math.exp(-dt * 7.5);
  const decaySlow = Math.exp(-dt * 4.2);
  cam.pan *= decay;
  cam.zoom *= decay;
  cam.bob *= decaySlow;
  cam.roll *= decay;
  cam.drift *= decaySlow;
  /* settle tiny residuals so we don't keep transforming forever */
  if (Math.abs(cam.pan) < 0.001) cam.pan = 0;
  if (Math.abs(cam.zoom) < 0.0005) cam.zoom = 0;
  if (Math.abs(cam.bob) < 0.002) cam.bob = 0;
  if (Math.abs(cam.roll) < 0.0002) cam.roll = 0;
}

/* ------- environment palette, keyframed across the day, doom-tinted ----- */
const SKY_KEYS = [
  { h:0,    top:[6,8,26],    bot:[22,26,58],   ground:[16,18,32], fog:[30,34,62]  },
  { h:5,    top:[10,12,34],  bot:[30,32,70],   ground:[20,22,38], fog:[38,42,74]  },
  { h:6.5,  top:[52,34,84],  bot:[228,128,92], ground:[54,46,62], fog:[196,128,116] },
  { h:9,    top:[86,138,198],bot:[186,212,232],ground:[90,124,82],fog:[182,202,222] },
  { h:16,   top:[80,128,190],bot:[196,206,220],ground:[86,118,80],fog:[178,196,214] },
  { h:19,   top:[64,42,96],  bot:[240,138,72], ground:[66,54,60], fog:[208,132,96]  },
  { h:21.5, top:[14,14,40],  bot:[36,36,80],   ground:[22,24,42], fog:[42,46,82]  },
  { h:24,   top:[6,8,26],    bot:[22,26,58],   ground:[16,18,32], fog:[30,34,62]  },
];
function envColors(hour, doom) {
  let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    if (hour >= SKY_KEYS[i].h && hour <= SKY_KEYS[i + 1].h) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
  }
  const t = (hour - a.h) / Math.max(0.001, b.h - a.h);
  const purple = [120, 40, 150];
  const dt = clamp(doom, 0, 0.5);
  const env = {
    top:    colLerp(colLerp(a.top, b.top, t), purple, dt * 0.35),
    bot:    colLerp(colLerp(a.bot, b.bot, t), purple, dt * 0.30),
    ground: colLerp(colLerp(a.ground, b.ground, t), [60, 30, 80], dt * 0.35),
    fog:    colLerp(colLerp(a.fog, b.fog, t), purple, dt * 0.30),
  };
  env.sil = env.ground.map(c => c * 0.45);
  env.grass = colLerp(env.ground, [70, 120, 55], 0.35);
  env.dirt = colLerp(env.ground, [90, 70, 45], 0.25);
  return env;
}

/* stars, fixed constellation */
const STARS = (() => {
  const r = mulberry32(99), s = [];
  for (let i = 0; i < 100; i++) s.push([r() * W, r() * HORIZON * 0.95, r() * 1.8 + 0.35, r() * 6.28]);
  return s;
})();

function drawSky(env, hour, time) {
  const grad = g.createLinearGradient(0, 0, 0, HORIZON + 8);
  grad.addColorStop(0, rgb(env.top));
  grad.addColorStop(0.55, rgb(colLerp(env.top, env.bot, 0.55)));
  grad.addColorStop(1, rgb(env.bot));
  g.fillStyle = grad; g.fillRect(0, 0, W, HORIZON + 2);

  /* soft cloud banks for depth */
  const cloudA = clamp(1 - Math.abs(hour - 13) / 10, 0, 1) * 0.22;
  if (cloudA > 0.02) {
    g.fillStyle = rgba([255, 250, 255], cloudA);
    for (let i = 0; i < 5; i++) {
      const cx = ((i * 211 + time * 3 * (i % 2 ? 1 : -1)) % (W + 160)) - 80;
      const cy = HORIZON * (0.18 + (i % 3) * 0.12);
      g.beginPath(); g.ellipse(cx, cy, 70 + i * 8, 14 + (i % 2) * 6, 0, 0, 6.29); g.fill();
      g.beginPath(); g.ellipse(cx + 40, cy + 4, 50, 12, 0, 0, 6.29); g.fill();
    }
  }

  const darkness = clamp((Math.abs(hour - 13) - 6) / 5, 0, 1);
  if (darkness > 0.05) {
    for (const [sx, sy, sr, ph] of STARS) {
      g.globalAlpha = darkness * (0.45 + 0.55 * Math.sin(time * 1.5 + ph));
      g.fillStyle = '#e8ecff'; g.beginPath(); g.arc(sx, sy, sr * 0.7, 0, 6.29); g.fill();
    }
    g.globalAlpha = 1;
    const mx = W * 0.78, my = HORIZON * 0.28;
    const moonG = g.createRadialGradient(mx, my, 2, mx, my, 36);
    moonG.addColorStop(0, rgba([240, 242, 255], darkness * 0.95));
    moonG.addColorStop(0.45, rgba([210, 215, 240], darkness * 0.55));
    moonG.addColorStop(1, 'rgba(200,210,255,0)');
    g.fillStyle = moonG; g.beginPath(); g.arc(mx, my, 36, 0, 6.29); g.fill();
    g.fillStyle = rgb(env.top);
    g.beginPath(); g.arc(mx + 9, my - 4, 18, 0, 6.29); g.fill();
  }
  if (hour >= 6 && hour <= 20) {
    const t = (hour - 6) / 14;
    const sx = W * (0.12 + 0.76 * t), sy = HORIZON - Math.sin(t * Math.PI) * HORIZON * 0.75 + 20;
    const glow = g.createRadialGradient(sx, sy, 3, sx, sy, 110);
    const warm = hour < 8.5 || hour > 17.5;
    glow.addColorStop(0, warm ? 'rgba(255,200,130,.98)' : 'rgba(255,248,220,.98)');
    glow.addColorStop(0.2, warm ? 'rgba(255,160,90,.55)' : 'rgba(255,240,200,.4)');
    glow.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = glow; g.beginPath(); g.arc(sx, sy, 110, 0, 6.29); g.fill();
  }
}

/* perspective ground with grass, stones, and ruts that rush with cam motion */
function drawGroundPlane(env, lord, time) {
  time = time || 0;
  const grad = g.createLinearGradient(0, HORIZON, 0, H);
  grad.addColorStop(0, rgb(colLerp(env.ground, env.fog, 0.78)));
  grad.addColorStop(0.25, rgb(colLerp(env.ground, env.fog, 0.35)));
  grad.addColorStop(0.55, rgb(env.ground));
  grad.addColorStop(1, rgb(env.ground.map(c => c * 0.72)));
  g.fillStyle = grad; g.fillRect(0, HORIZON, W, H - HORIZON);

  /* vanishing-point strips for pseudo-3D floor */
  const vpX = W / 2 + cam.pan * 40;
  for (let i = 0; i < 10; i++) {
    const t0 = i / 10, t1 = (i + 1) / 10;
    const y0 = HORIZON + (H - HORIZON) * (t0 * t0);
    const y1 = HORIZON + (H - HORIZON) * (t1 * t1);
    if (i % 2) {
      g.fillStyle = rgba([0, 0, 0], 0.04);
      g.beginPath();
      g.moveTo(vpX - 8, HORIZON); g.lineTo(0 - cam.pan * 30, y1);
      g.lineTo(W - cam.pan * 30, y1); g.lineTo(vpX + 8, HORIZON);
      g.closePath(); g.fill();
    }
    g.strokeStyle = rgba(colLerp(env.ground, [40, 55, 30], 0.4), 0.08 + t0 * 0.1);
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, y0); g.lineTo(W, y0); g.stroke();
  }

  if (!lord) return;

  /* near-field detail: grass tufts, stones, flowers — parallax with cam */
  const seedX = lord.x * 17 + lord.y * 31 + lord.face * 7;
  const rush = cam.zoom * 90 + cam.bob * Math.sin(time * 18) * 8;
  const grass = env.grass || env.ground;
  const dirt = env.dirt || env.ground;
  for (let i = 0; i < 48; i++) {
    const r1 = tRand(seedX, i, 1), r2 = tRand(seedX, i, 2), r3 = tRand(seedX, i, 3);
    const fx = (r1 * 1.2 - 0.1) * W + cam.pan * -55 + cam.drift * 30;
    const fy = HORIZON + 28 + r2 * (H - HORIZON - 20) + rush * (0.3 + r2);
    if (fy < HORIZON + 10 || fy > H - 4) continue;
    const near = (fy - HORIZON) / (H - HORIZON);
    const sc = 0.4 + near * 1.6;
    if (r3 < 0.55) {
      g.strokeStyle = rgba(colLerp(grass, [30, 80, 30], r1 * 0.4), 0.35 + near * 0.45);
      g.lineWidth = Math.max(1, 1.2 * sc);
      g.lineCap = 'round';
      for (let b = 0; b < 3; b++) {
        const lean = (b - 1) * 3 * sc + Math.sin(time * 2.5 + i + b) * 1.5 * sc * Math.max(0.2, cam.bob);
        g.beginPath();
        g.moveTo(fx + b * 2 * sc, fy);
        g.quadraticCurveTo(fx + lean, fy - 6 * sc, fx + lean * 1.4, fy - (10 + r2 * 8) * sc);
        g.stroke();
      }
    } else if (r3 < 0.8) {
      g.fillStyle = rgba(colLerp(dirt, [80, 75, 70], 0.4), 0.55 + near * 0.3);
      g.beginPath(); g.ellipse(fx, fy, 3.5 * sc, 1.6 * sc, 0, 0, 6.29); g.fill();
    } else {
      g.fillStyle = rgba(r1 > 0.5 ? [220, 180, 70] : [190, 90, 140], 0.5 + near * 0.35);
      g.beginPath(); g.arc(fx, fy - 5 * sc, 1.8 * sc, 0, 6.29); g.fill();
      g.strokeStyle = rgba([40, 90, 40], 0.5);
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx, fy - 5 * sc); g.stroke();
    }
  }

  /* soft road/rut toward facing direction */
  g.fillStyle = rgba(dirt, 0.18);
  g.beginPath();
  g.moveTo(vpX - 18, HORIZON + 6);
  g.lineTo(W * 0.38 + cam.pan * -20, H);
  g.lineTo(W * 0.62 + cam.pan * -20, H);
  g.lineTo(vpX + 18, HORIZON + 6);
  g.closePath(); g.fill();
}

/* --------- distant-rift horizon glow when facing roughly toward it ------ */
function drawRiftHorizonGlow(lord, time) {
  const dx = RIFT_X - lord.x, dy = RIFT_Y - lord.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1.5 || dist > 24) return;
  const ang = Math.atan2(dy, dx);
  const faceAng = (lord.face * 45 - 90) * Math.PI / 180;
  let diff = ang - faceAng;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  if (Math.abs(diff) > Math.PI / 3) return;
  const cx = W / 2 + (diff / (Math.PI / 3)) * W * 0.55 + cam.pan * 50;
  const a = Math.min(0.55, 7 / dist) * (0.75 + 0.25 * Math.sin(time * 2.2));
  const glow = g.createRadialGradient(cx, HORIZON, 5, cx, HORIZON, 200);
  glow.addColorStop(0, rgba([233, 92, 255], a));
  glow.addColorStop(0.4, rgba([160, 40, 200], a * 0.45));
  glow.addColorStop(1, 'rgba(120,20,160,0)');
  g.fillStyle = glow;
  g.fillRect(cx - 200, HORIZON - 140, 400, 160);
}

function drawGroundShadow(x, y, s, wMul) {
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.beginPath(); g.ellipse(x, y + 1 * s, 55 * s * (wMul || 1), 8 * s, 0, 0, 6.29); g.fill();
}

/* --------------------------- terrain — pseudo-3D ------------------------ */
function drawMountains(x, y, s, tx, ty, P) {
  const w = 400 * s, h = (175 + tRand(tx, ty, 1) * 95) * s;
  drawGroundShadow(x, y, s, 1.5);
  /* back → front peaks: each is a real mountain (steep ridges, lit/shade faces, snow) */
  const peaks = [
    { ox: -0.28, hw: 0.42, hh: 0.62 + tRand(tx, ty, 4) * 0.12 },
    { ox: 0.30,  hw: 0.38, hh: 0.70 + tRand(tx, ty, 5) * 0.12 },
    { ox: -0.02, hw: 0.52, hh: 0.95 + tRand(tx, ty, 6) * 0.08 },
  ];
  for (let pi = 0; pi < peaks.length; pi++) {
    const p = peaks[pi];
    const cx = x + p.ox * w;
    const half = p.hw * w * 0.5;
    const ph = p.hh * h;
    const tipX = cx + (tRand(tx, ty, 10 + pi) - 0.5) * half * 0.2;
    const tipY = y - ph;
    /* base footing (broader rock mass) */
    g.fillStyle = P.mountShade;
    g.beginPath();
    g.moveTo(cx - half * 1.15, y);
    g.lineTo(cx - half * 0.7, y - ph * 0.22);
    g.lineTo(cx + half * 0.7, y - ph * 0.18);
    g.lineTo(cx + half * 1.15, y);
    g.closePath(); g.fill();
    /* left (lit) face */
    g.fillStyle = P.mountLit;
    g.beginPath();
    g.moveTo(cx - half, y);
    g.lineTo(cx - half * 0.55, y - ph * 0.38);
    g.lineTo(cx - half * 0.25, y - ph * 0.55);
    g.lineTo(tipX, tipY);
    g.lineTo(cx + half * 0.08, y);
    g.closePath(); g.fill();
    /* right (shade) face */
    g.fillStyle = P.mountShade;
    g.beginPath();
    g.moveTo(cx + half * 0.08, y);
    g.lineTo(tipX, tipY);
    g.lineTo(cx + half * 0.35, y - ph * 0.5);
    g.lineTo(cx + half * 0.7, y - ph * 0.28);
    g.lineTo(cx + half, y);
    g.closePath(); g.fill();
    /* mid body blend so the ridge reads */
    g.fillStyle = P.mount;
    g.beginPath();
    g.moveTo(cx - half * 0.35, y - ph * 0.15);
    g.lineTo(tipX - half * 0.05, tipY + ph * 0.12);
    g.lineTo(tipX + half * 0.12, tipY + ph * 0.18);
    g.lineTo(cx + half * 0.4, y - ph * 0.12);
    g.closePath(); g.fill();
    /* ridge line */
    g.strokeStyle = P.mountHi;
    g.lineWidth = Math.max(1, 1.4 * s);
    g.beginPath();
    g.moveTo(cx - half * 0.5, y - ph * 0.2);
    g.lineTo(tipX, tipY);
    g.lineTo(cx + half * 0.55, y - ph * 0.25);
    g.stroke();
    /* snow cap — irregular lower edge, only on taller peaks */
    if (p.hh > 0.68) {
      const snowBot = tipY + ph * (0.22 + tRand(tx, ty, 20 + pi) * 0.08);
      const sg = g.createLinearGradient(tipX, tipY, tipX, snowBot);
      sg.addColorStop(0, P.snow);
      sg.addColorStop(0.7, P.snow);
      sg.addColorStop(1, 'rgba(230,235,245,0)');
      g.fillStyle = sg;
      g.beginPath();
      g.moveTo(tipX, tipY);
      g.lineTo(tipX - half * 0.22, tipY + ph * 0.12);
      g.lineTo(tipX - half * 0.18, snowBot - ph * 0.02);
      g.lineTo(tipX - half * 0.05, snowBot + ph * 0.03);
      g.lineTo(tipX + half * 0.08, snowBot);
      g.lineTo(tipX + half * 0.2, tipY + ph * 0.14);
      g.closePath(); g.fill();
    }
    /* cliff ledges on shade side */
    g.strokeStyle = P.mount;
    g.lineWidth = Math.max(1, 1.2 * s);
    g.beginPath();
    g.moveTo(tipX + half * 0.1, tipY + ph * 0.35);
    g.lineTo(tipX + half * 0.35, tipY + ph * 0.38);
    g.moveTo(tipX + half * 0.05, tipY + ph * 0.55);
    g.lineTo(tipX + half * 0.4, tipY + ph * 0.52);
    g.stroke();
  }
}
function drawHills(x, y, s, tx, ty, P) {
  const w = 310 * s, h = (58 + tRand(tx, ty, 2) * 28) * s;
  drawGroundShadow(x, y, s, 1.1);
  for (const [ox, sc, lit] of [[-0.28, 0.8, false], [0.2, 1, true], [0.45, 0.55, false]]) {
    g.fillStyle = lit ? P.hillLit : P.hill;
    g.beginPath();
    g.ellipse(x + ox * w, y, w * 0.34 * sc, h * sc, 0, Math.PI, 0);
    g.fill();
    if (lit) {
      g.fillStyle = P.grassTuft;
      g.globalAlpha = 0.35;
      g.beginPath(); g.ellipse(x + ox * w - 8 * s, y - h * 0.35, w * 0.12 * sc, h * 0.25 * sc, -0.3, 0, 6.29); g.fill();
      g.globalAlpha = 1;
    }
  }
}
function drawDowns(x, y, s, tx, ty, P) {
  const w = 330 * s, h = 32 * s;
  drawGroundShadow(x, y, s, 1.0);
  for (const [ox, sc, lit] of [[-0.28, 0.9, false], [0.18, 1, true]]) {
    g.fillStyle = lit ? P.downLit : P.down;
    g.beginPath();
    g.ellipse(x + ox * w, y, w * 0.42 * sc, h * sc, 0, Math.PI, 0);
    g.fill();
  }
}
function drawPine(cx, y, s, r1, r2, P, time, i) {
  const th = (70 + r2 * 42) * s;
  const sway = Math.sin(time * 1.3 + i * 1.6) * 1.8 * s * (0.35 + cam.bob * 0.5);
  const trunkW = Math.max(2.2, (4.5 + r1 * 2) * s);
  const trunkH = th * 0.38;
  /* trunk — slightly tapered */
  g.fillStyle = P.trunk;
  g.beginPath();
  g.moveTo(cx - trunkW * 0.55 + sway * 0.15, y);
  g.lineTo(cx - trunkW * 0.35 + sway * 0.4, y - trunkH);
  g.lineTo(cx + trunkW * 0.35 + sway * 0.4, y - trunkH);
  g.lineTo(cx + trunkW * 0.55 + sway * 0.15, y);
  g.closePath(); g.fill();
  g.fillStyle = P.trunkLit;
  g.fillRect(cx - trunkW * 0.35 + sway * 0.3, y - trunkH, trunkW * 0.28, trunkH * 0.95);
  /* stacked fir tiers — classic pine silhouette */
  const tiers = 4 + ((r1 * 2) | 0);
  for (let t = 0; t < tiers; t++) {
    const u = t / (tiers - 1);                    /* 0 bottom → 1 top */
    const tierY = y - trunkH * 0.55 - u * th * 0.72;
    const tierH = th * (0.28 - u * 0.06);
    const tierW = (38 + r1 * 10) * s * (1.05 - u * 0.62);
    const sw = sway * (0.5 + u * 0.6);
    const jL = (tRand(i * 17, t, 3) - 0.5) * tierW * 0.08;
    const jR = (tRand(i * 17, t, 4) - 0.5) * tierW * 0.08;
    /* dark body */
    g.fillStyle = t % 2 ? P.treeDark : P.tree;
    g.beginPath();
    g.moveTo(cx + sw, tierY - tierH);
    g.lineTo(cx - tierW * 0.5 + sw * 0.4 + jL, tierY + tierH * 0.15);
    g.lineTo(cx - tierW * 0.15 + sw * 0.5, tierY + tierH * 0.02);
    g.lineTo(cx + tierW * 0.05 + sw * 0.5, tierY + tierH * 0.12);
    g.lineTo(cx + tierW * 0.5 + sw * 0.4 + jR, tierY + tierH * 0.15);
    g.closePath(); g.fill();
    /* sunlit left edge of needles */
    g.fillStyle = P.treeLit;
    g.beginPath();
    g.moveTo(cx + sw, tierY - tierH);
    g.lineTo(cx - tierW * 0.5 + sw * 0.4 + jL, tierY + tierH * 0.15);
    g.lineTo(cx - tierW * 0.05 + sw, tierY - tierH * 0.15);
    g.closePath(); g.fill();
  }
  /* tip */
  g.fillStyle = P.treeLit;
  g.beginPath();
  g.moveTo(cx + sway, y - th);
  g.lineTo(cx - 5 * s + sway * 0.7, y - th + 14 * s);
  g.lineTo(cx + 5 * s + sway * 0.7, y - th + 14 * s);
  g.closePath(); g.fill();
}
function drawBroadleaf(cx, y, s, r1, r2, P, time, i) {
  const th = (55 + r2 * 30) * s;
  const sway = Math.sin(time * 1.5 + i) * 2.4 * s * (0.4 + cam.bob * 0.5);
  const trunkW = Math.max(2.5, 5.5 * s);
  g.fillStyle = P.trunk;
  g.beginPath();
  g.moveTo(cx - trunkW * 0.5, y);
  g.lineTo(cx - trunkW * 0.3 + sway * 0.3, y - th * 0.55);
  g.lineTo(cx + trunkW * 0.3 + sway * 0.3, y - th * 0.55);
  g.lineTo(cx + trunkW * 0.5, y);
  g.closePath(); g.fill();
  g.fillStyle = P.trunkLit;
  g.fillRect(cx - trunkW * 0.25 + sway * 0.2, y - th * 0.55, trunkW * 0.3, th * 0.5);
  /* forked upper branches */
  g.strokeStyle = P.trunk;
  g.lineWidth = Math.max(1, 2 * s);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx + sway * 0.3, y - th * 0.5);
  g.lineTo(cx - 10 * s + sway, y - th * 0.78);
  g.moveTo(cx + sway * 0.3, y - th * 0.48);
  g.lineTo(cx + 12 * s + sway, y - th * 0.75);
  g.stroke();
  /* cloud of foliage — overlapping lobes */
  const lobes = [
    [0, 0.78, 0.42, 0.34, P.treeDark],
    [-0.28, 0.68, 0.32, 0.28, P.tree],
    [0.30, 0.66, 0.30, 0.26, P.tree],
    [-0.08, 0.88, 0.28, 0.24, P.treeLit],
    [0.14, 0.82, 0.24, 0.2, P.treeLit],
  ];
  for (const [ox, oy, rw, rh, col] of lobes) {
    g.fillStyle = col;
    g.beginPath();
    g.ellipse(cx + ox * th + sway, y - oy * th, rw * th, rh * th, 0, 0, 6.29);
    g.fill();
  }
}
function drawTree(cx, y, s, r1, r2, P, time, i) {
  if (r1 < 0.72) drawPine(cx, y, s, r1, r2, P, time, i);
  else drawBroadleaf(cx, y, s, r1, r2, P, time, i);
}
function drawForest(x, y, s, tx, ty, P, time) {
  drawGroundShadow(x, y, s, 1.2);
  const n = 7, w = 280 * s;
  /* underbrush */
  g.fillStyle = P.treeDark;
  for (let i = 0; i < 5; i++) {
    const bx = x + (tRand(tx, ty, i + 80) - 0.5) * w * 0.9;
    g.beginPath();
    g.ellipse(bx, y - 2 * s, 10 * s, 5 * s, 0, 0, 6.29);
    g.fill();
  }
  /* back row then front for depth */
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      if ((i % 2) !== pass) continue;
      const r1 = tRand(tx, ty, i), r2 = tRand(tx, ty, i + 20);
      const cx = x + (i - (n - 1) / 2) * (w / n) + (r1 - 0.5) * 14 * s;
      const yOff = pass ? 0 : -3 * s;
      drawTree(cx, y + yOff, s * (pass ? 1.08 : 0.86), r1, r2, P, time, i + pass * 11);
    }
  }
}
function crenels(x, y, w, hgt, n, fill) {
  g.fillStyle = fill;
  const tw = w / (n * 2 - 1);
  for (let i = 0; i < n; i++) g.fillRect(x + i * tw * 2, y - hgt, tw, hgt);
}
function drawKeep(x, y, s, tx, ty, P, big, night) {
  const w = (big ? 175 : 124) * s, wallH = (big ? 74 : 54) * s;
  const tH = (big ? 138 : 100) * s, tW = (big ? 36 : 28) * s;
  drawGroundShadow(x, y, s, 1.25);
  /* side face (right) for 3D block */
  g.fillStyle = P.stoneShade;
  g.beginPath();
  g.moveTo(x + w / 2, y - wallH); g.lineTo(x + w / 2 + 16 * s, y - wallH + 10 * s);
  g.lineTo(x + w / 2 + 16 * s, y + 6 * s); g.lineTo(x + w / 2, y);
  g.closePath(); g.fill();
  /* main wall with vertical gradient */
  const wg = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  wg.addColorStop(0, P.stoneLit); wg.addColorStop(0.55, P.stone); wg.addColorStop(1, P.stoneShade);
  g.fillStyle = wg;
  g.fillRect(x - w / 2, y - wallH, w, wallH);
  /* towers */
  const drawTowerBlock = (tx0, topH) => {
    g.fillStyle = P.stone;
    g.fillRect(tx0, y - topH, tW, topH);
    g.fillStyle = P.stoneLit;
    g.fillRect(tx0, y - topH, tW * 0.35, topH);
    g.fillStyle = P.stoneShade;
    g.fillRect(tx0 + tW * 0.7, y - topH, tW * 0.3, topH);
    crenels(tx0, y - topH, tW, 8 * s, 3, P.stoneLit);
  };
  drawTowerBlock(x - w / 2 - tW * 0.25, tH);
  drawTowerBlock(x + w / 2 - tW * 0.75, tH);
  crenels(x - w / 2 + tW * 0.7, y - wallH, w - tW * 1.5, 7 * s, 6, P.stoneLit);
  /* gate with depth */
  g.fillStyle = P.dark;
  g.beginPath();
  g.moveTo(x - 14 * s, y); g.lineTo(x - 14 * s, y - 26 * s);
  g.arc(x, y - 26 * s, 14 * s, Math.PI, 0);
  g.lineTo(x + 14 * s, y); g.closePath(); g.fill();
  g.strokeStyle = P.stoneShade; g.lineWidth = Math.max(1, 2 * s);
  g.stroke();
  if (night) {
    g.fillStyle = P.window;
    g.shadowColor = 'rgba(255,200,100,0.7)'; g.shadowBlur = 8 * s;
    g.fillRect(x - w / 2 - tW * 0.25 + tW * 0.35, y - tH * 0.75, 5 * s, 8 * s);
    g.fillRect(x + w / 2 - tW * 0.75 + tW * 0.35, y - tH * 0.68, 5 * s, 8 * s);
    g.shadowBlur = 0;
  }
  if (big) {
    g.strokeStyle = P.dark; g.lineWidth = Math.max(1, 2.5 * s);
    g.beginPath(); g.moveTo(x, y - tH); g.lineTo(x, y - tH - 30 * s); g.stroke();
    g.fillStyle = P.banner;
    g.beginPath();
    g.moveTo(x, y - tH - 30 * s); g.lineTo(x + 24 * s, y - tH - 22 * s); g.lineTo(x, y - tH - 14 * s);
    g.closePath(); g.fill();
  }
}
function drawVillage(x, y, s, tx, ty, P, night) {
  drawGroundShadow(x, y, s, 1.1);
  for (let i = 0; i < 3; i++) {
    const r = tRand(tx, ty, i + 3);
    const hx = x + (i - 1) * 54 * s + (r - 0.5) * 12 * s;
    const hw = (36 + r * 10) * s, hh = (22 + r * 7) * s;
    /* side wall */
    g.fillStyle = P.stoneShade;
    g.beginPath();
    g.moveTo(hx + hw / 2, y - hh); g.lineTo(hx + hw / 2 + 10 * s, y - hh + 6 * s);
    g.lineTo(hx + hw / 2 + 10 * s, y + 3 * s); g.lineTo(hx + hw / 2, y);
    g.closePath(); g.fill();
    const wg = g.createLinearGradient(hx - hw / 2, 0, hx + hw / 2, 0);
    wg.addColorStop(0, P.stoneLit); wg.addColorStop(1, P.stone);
    g.fillStyle = wg;
    g.fillRect(hx - hw / 2, y - hh, hw, hh);
    /* thick roof */
    g.fillStyle = P.roofShade;
    g.beginPath();
    g.moveTo(hx - hw / 2 - 5 * s, y - hh); g.lineTo(hx, y - hh - 18 * s);
    g.lineTo(hx + hw / 2 + 12 * s, y - hh + 4 * s); g.lineTo(hx + hw / 2 + 5 * s, y - hh);
    g.closePath(); g.fill();
    g.fillStyle = P.roof;
    g.beginPath();
    g.moveTo(hx - hw / 2 - 5 * s, y - hh); g.lineTo(hx, y - hh - 18 * s);
    g.lineTo(hx + hw / 2 + 5 * s, y - hh); g.closePath(); g.fill();
    if (night) {
      g.fillStyle = P.window; g.shadowColor = 'rgba(255,200,80,0.6)'; g.shadowBlur = 6 * s;
      g.fillRect(hx - 3 * s, y - hh * 0.55, 6 * s, 7 * s); g.shadowBlur = 0;
    }
  }
}
function drawTower(x, y, s, tx, ty, P, night) {
  const tw = 26 * s, th = 132 * s;
  drawGroundShadow(x, y, s, 0.55);
  /* cylinder shading */
  const tg = g.createLinearGradient(x - tw / 2, 0, x + tw / 2, 0);
  tg.addColorStop(0, P.stoneLit); tg.addColorStop(0.45, P.stone); tg.addColorStop(1, P.stoneShade);
  g.fillStyle = tg;
  g.fillRect(x - tw / 2, y - th, tw, th);
  /* cone roof with volume */
  g.fillStyle = P.roofShade;
  g.beginPath();
  g.moveTo(x - tw / 2 - 6 * s, y - th); g.lineTo(x, y - th - 28 * s); g.lineTo(x + tw / 2 + 10 * s, y - th + 4 * s);
  g.closePath(); g.fill();
  g.fillStyle = P.roof;
  g.beginPath();
  g.moveTo(x - tw / 2 - 6 * s, y - th); g.lineTo(x, y - th - 28 * s); g.lineTo(x + tw / 2 + 6 * s, y - th);
  g.closePath(); g.fill();
  g.fillStyle = night ? P.window : P.dark;
  if (night) { g.shadowColor = 'rgba(255,210,100,0.75)'; g.shadowBlur = 10 * s; }
  g.fillRect(x - 4 * s, y - th * 0.78, 8 * s, 11 * s);
  g.shadowBlur = 0;
  /* balcony ring */
  g.fillStyle = P.stoneLit;
  g.fillRect(x - tw * 0.65, y - th * 0.55, tw * 1.3, 4 * s);
}
function drawWaste(x, y, s, tx, ty, P) {
  drawGroundShadow(x, y, s, 0.9);
  const r = tRand(tx, ty, 8);
  const cx = x + (r - 0.5) * 60 * s;
  g.strokeStyle = P.dead; g.lineWidth = Math.max(1, 4 * s); g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx, y); g.lineTo(cx + 4 * s, y - 55 * s);
  g.moveTo(cx + 2 * s, y - 32 * s); g.lineTo(cx - 20 * s, y - 50 * s);
  g.moveTo(cx + 3 * s, y - 42 * s); g.lineTo(cx + 22 * s, y - 62 * s);
  g.stroke();
  g.fillStyle = P.dead;
  for (let i = 0; i < 5; i++) {
    const sx = x + (tRand(tx, ty, i + 30) - 0.5) * 230 * s;
    g.beginPath();
    g.moveTo(sx - 6 * s, y); g.lineTo(sx, y - (14 + tRand(tx, ty, i + 40) * 12) * s); g.lineTo(sx + 6 * s, y);
    g.closePath(); g.fill();
  }
}
function drawRift(x, y, s, time, closing) {
  const open = 1 - clamp(closing || 0, 0, 1);
  const h = 200 * s * (0.4 + 0.6 * open), pw = 75 * s * open + 8 * s;
  const pulse = 0.8 + 0.2 * Math.sin(time * 3);
  const glow = g.createRadialGradient(x, y - h * 0.45, 4, x, y - h * 0.45, 210 * s * pulse + 30);
  glow.addColorStop(0, rgba([250, 160, 255], 0.85 * open + 0.1));
  glow.addColorStop(0.35, rgba([190, 60, 235], 0.5 * open));
  glow.addColorStop(1, 'rgba(110,20,150,0)');
  g.fillStyle = glow;
  g.fillRect(x - 230 * s, y - h - 120 * s, 460 * s, h + 180 * s);
  g.fillStyle = '#0b0212';
  g.beginPath();
  g.moveTo(x - pw * 0.4, y);
  g.lineTo(x - pw * 0.55, y - h * 0.3); g.lineTo(x - pw * 0.2, y - h * 0.5);
  g.lineTo(x - pw * 0.35, y - h * 0.78); g.lineTo(x, y - h);
  g.lineTo(x + pw * 0.3, y - h * 0.72); g.lineTo(x + pw * 0.15, y - h * 0.45);
  g.lineTo(x + pw * 0.5, y - h * 0.25); g.lineTo(x + pw * 0.35, y);
  g.closePath(); g.fill();
  g.strokeStyle = rgba([255, 150, 255], 0.9 * open + 0.05);
  g.lineWidth = Math.max(1, 3 * s);
  g.beginPath(); g.moveTo(x - pw * 0.1, y - 4); g.lineTo(x - pw * 0.15, y - h * 0.5); g.lineTo(x + pw * 0.05, y - h * 0.95);
  g.stroke();
  for (let i = 0; i < 9; i++) {
    const ph = (time * 0.35 + i / 9) % 1;
    const mx = x + Math.sin(time + i * 2.2) * 42 * s;
    g.fillStyle = rgba([240, 140, 255], (1 - ph) * 0.85 * open);
    g.beginPath(); g.arc(mx, y - ph * (h + 95 * s), (2.8 - ph * 1.6) * Math.max(s, 0.35) * 2, 0, 6.29); g.fill();
  }
}
function drawCorruptMark(x, y, s, tx, ty) {
  g.fillStyle = rgba([190, 80, 230], 0.7);
  for (let i = 0; i < 4; i++) {
    const cx = x + (tRand(tx, ty, i + 50) - 0.5) * 160 * s;
    const ch = (12 + tRand(tx, ty, i + 60) * 16) * s;
    g.beginPath();
    g.moveTo(cx - 5 * s, y); g.lineTo(cx, y - ch); g.lineTo(cx + 5 * s, y);
    g.closePath(); g.fill();
  }
  g.strokeStyle = rgba([180, 60, 220], 0.35);
  g.lineWidth = Math.max(1, 1.5 * s);
  g.beginPath(); g.ellipse(x, y, 40 * s, 6 * s, 0, 0, 6.29); g.stroke();
}

/* Abyssal horde — bulkier, horned, clawed, smoke-wreathed */
function drawHorde(x, y, s, time) {
  const pulse = 0.65 + 0.35 * Math.sin(time * 4.2);
  const stomp = Math.sin(time * 5) * 1.5 * s;
  const aura = g.createRadialGradient(x, y - 28 * s, 2, x, y - 28 * s, 100 * s);
  aura.addColorStop(0, rgba([255, 30, 70], 0.4 * pulse));
  aura.addColorStop(0.45, rgba([160, 10, 120], 0.22 * pulse));
  aura.addColorStop(1, 'rgba(80,0,60,0)');
  g.fillStyle = aura;
  g.fillRect(x - 105 * s, y - 120 * s, 210 * s, 140 * s);
  /* scorched earth + cracks */
  g.fillStyle = rgba([40, 4, 20], 0.65);
  g.beginPath(); g.ellipse(x, y + stomp * 0.3, 70 * s, 10 * s, 0, 0, 6.29); g.fill();
  g.strokeStyle = rgba([255, 40, 80], 0.35 * pulse);
  g.lineWidth = Math.max(1, 1.5 * s);
  for (let c = 0; c < 4; c++) {
    const a = c * 1.4 + time * 0.2;
    g.beginPath(); g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * 50 * s, y + Math.sin(a) * 8 * s); g.stroke();
  }
  /* banner */
  g.strokeStyle = '#120510'; g.lineWidth = Math.max(1, 3.5 * s);
  g.beginPath(); g.moveTo(x + 32 * s, y); g.lineTo(x + 36 * s, y - 72 * s); g.stroke();
  g.fillStyle = '#1a0618';
  g.beginPath();
  g.moveTo(x + 36 * s, y - 72 * s); g.lineTo(x + 62 * s, y - 62 * s); g.lineTo(x + 36 * s, y - 50 * s);
  g.closePath(); g.fill();
  g.fillStyle = rgba([255, 50, 100], 0.95 * pulse);
  g.beginPath(); g.arc(x + 46 * s, y - 61 * s, 4.5 * s, 0, 6.29); g.fill();
  /* smoke wisps */
  for (let i = 0; i < 5; i++) {
    const ph = (time * 0.25 + i * 0.18) % 1;
    g.fillStyle = rgba([40, 10, 30], (1 - ph) * 0.35);
    g.beginPath();
    g.ellipse(x + Math.sin(time + i) * 30 * s, y - 20 * s - ph * 70 * s, (12 - ph * 6) * s, (8 - ph * 4) * s, 0, 0, 6.29);
    g.fill();
  }
  /* warriors */
  for (let i = 0; i < 5; i++) {
    const hx = x + (i - 2) * 22 * s;
    const hh = (44 + (i % 3) * 11) * s;
    const sway = Math.sin(time * 3.2 + i * 1.4) * 3 * s;
    const by = y + stomp * (i % 2 ? 1 : -0.5);
    /* bulk body */
    g.fillStyle = '#07020c';
    g.beginPath();
    g.moveTo(hx - 12 * s + sway, by);
    g.lineTo(hx - 14 * s + sway * 0.5, by - hh * 0.45);
    g.lineTo(hx - 10 * s, by - hh * 0.72);
    g.lineTo(hx - 16 * s, by - hh * 0.95); /* left horn */
    g.lineTo(hx - 4 * s, by - hh * 0.88);
    g.lineTo(hx, by - hh * 1.05);
    g.lineTo(hx + 4 * s, by - hh * 0.88);
    g.lineTo(hx + 16 * s, by - hh * 0.95); /* right horn */
    g.lineTo(hx + 10 * s, by - hh * 0.72);
    g.lineTo(hx + 14 * s + sway * 0.5, by - hh * 0.45);
    g.lineTo(hx + 12 * s + sway, by);
    g.closePath(); g.fill();
    /* crimson rim */
    g.strokeStyle = rgba([255, 40, 90], 0.65 * pulse);
    g.lineWidth = Math.max(1, 2 * s);
    g.stroke();
    /* claws */
    g.strokeStyle = rgba([255, 80, 120], 0.7);
    g.lineWidth = Math.max(1, 1.8 * s);
    g.beginPath();
    g.moveTo(hx - 12 * s, by - hh * 0.4); g.lineTo(hx - 22 * s + sway, by - hh * 0.15);
    g.moveTo(hx - 12 * s, by - hh * 0.38); g.lineTo(hx - 20 * s + sway, by - hh * 0.05);
    g.moveTo(hx + 12 * s, by - hh * 0.4); g.lineTo(hx + 22 * s + sway, by - hh * 0.15);
    g.stroke();
    /* eyes + maw */
    g.fillStyle = rgba([255, 40, 90], 0.9 * pulse);
    g.shadowColor = 'rgba(255,20,80,0.9)'; g.shadowBlur = 8 * s;
    g.beginPath(); g.ellipse(hx - 5 * s, by - hh * 0.78, 3.2 * s, 2.4 * s, 0, 0, 6.29); g.fill();
    g.beginPath(); g.ellipse(hx + 5 * s, by - hh * 0.78, 3.2 * s, 2.4 * s, 0, 0, 6.29); g.fill();
    g.fillStyle = '#fff0f5';
    g.beginPath(); g.arc(hx - 5 * s, by - hh * 0.78, 1.2 * s, 0, 6.29); g.fill();
    g.beginPath(); g.arc(hx + 5 * s, by - hh * 0.78, 1.2 * s, 0, 6.29); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = rgba([120, 0, 30], 0.85);
    g.beginPath(); g.ellipse(hx, by - hh * 0.62, 5 * s, 3 * s, 0, 0, 6.29); g.fill();
  }
}
function drawBanner(x, y, s) {
  drawGroundShadow(x, y, s * 0.6, 0.4);
  g.strokeStyle = '#2c2a20'; g.lineWidth = Math.max(1, 2.5 * s);
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 58 * s); g.stroke();
  g.fillStyle = '#ffd24a';
  g.beginPath(); g.moveTo(x, y - 58 * s); g.lineTo(x + 22 * s, y - 50 * s); g.lineTo(x, y - 42 * s);
  g.closePath(); g.fill();
  /* tiny rider silhouette with volume */
  g.fillStyle = '#1a1520';
  g.beginPath(); g.arc(x, y - 28 * s, 7 * s, 0, 6.29); g.fill();
  g.fillStyle = '#3a3050';
  g.fillRect(x - 6 * s, y - 24 * s, 12 * s, 24 * s);
  g.fillStyle = '#c8a050';
  g.fillRect(x - 7 * s, y - 18 * s, 14 * s, 4 * s);
}

/* palette for one depth row: lit / mid / shade for volume */
function rowPalette(env, fogT, night) {
  const f = c => rgb(colLerp(c, env.fog, fogT));
  const mount = colLerp(env.sil, [76, 80, 108], 0.45);
  const hill = colLerp(env.sil, [86, 104, 70], 0.5);
  const down = colLerp(env.sil, [120, 130, 88], 0.5);
  const tree = colLerp(env.sil, [24, 66, 38], 0.65);
  const tree2 = colLerp(env.sil, [34, 84, 48], 0.65);
  const stone = colLerp(env.sil, [110, 106, 124], 0.55);
  const roof = colLerp(env.sil, [96, 52, 44], 0.6);
  return {
    mount: f(mount),
    mountLit: f(colLerp(mount, [140, 145, 170], 0.35)),
    mountShade: f(colLerp(mount, [30, 32, 48], 0.45)),
    mountHi: f(colLerp(mount, [200, 205, 220], 0.4)),
    snow: f([230, 234, 245]),
    hill: f(hill),
    hillLit: f(colLerp(hill, [130, 150, 90], 0.35)),
    down: f(down),
    downLit: f(colLerp(down, [160, 170, 110], 0.3)),
    tree: f(tree2),
    treeLit: f(colLerp(tree2, [70, 140, 70], 0.4)),
    treeDark: f(colLerp(tree, [10, 40, 20], 0.4)),
    trunk: f([55, 38, 28]),
    trunkLit: f([90, 65, 45]),
    stone: f(stone),
    stoneLit: f(colLerp(stone, [170, 165, 180], 0.35)),
    stoneShade: f(colLerp(stone, [50, 48, 62], 0.4)),
    roof: f(roof),
    roofShade: f(colLerp(roof, [40, 20, 20], 0.4)),
    dark: f(env.sil.map(c => c * 0.45)),
    dead: f(colLerp(env.sil, [58, 44, 70], 0.6)),
    grassTuft: f(colLerp(env.grass || env.ground, [50, 110, 40], 0.5)),
    window: night ? '#ffe0a0' : '#ffd98a',
    banner: '#e8b23a',
  };
}

/* ------------------------------ panorama -------------------------------- */
const MAXD = 7;
const rowScale = d => 1.5 / (d + 0.3);
const rowY = d => HORIZON + (H - HORIZON - 6) * (1.25 / (d + 0.25)) - 6;

function drawFeature(tile, x, y, s, tx, ty, P, time, night) {
  switch (tile.t) {
    case 'mountains': drawMountains(x, y, s, tx, ty, P); break;
    case 'forest':    drawForest(x, y, s, tx, ty, P, time); break;
    case 'hills':     drawHills(x, y, s, tx, ty, P); break;
    case 'downs':     drawDowns(x, y, s, tx, ty, P); break;
    case 'keep':      drawKeep(x, y, s, tx, ty, P, false, night); break;
    case 'citadel':   drawKeep(x, y, s, tx, ty, P, true, night); break;
    case 'village':   drawVillage(x, y, s, tx, ty, P, night); break;
    case 'tower':     drawTower(x, y, s, tx, ty, P, night); break;
    case 'wasteland': drawWaste(x, y, s, tx, ty, P); break;
    case 'rift':      drawRift(x, y, s, time, 0); break;
    case 'plains':
      /* sparse near ground clutter only when close */
      if (s > 0.55) {
        g.fillStyle = P.grassTuft;
        for (let i = 0; i < 3; i++) {
          const gx = x + (tRand(tx, ty, i + 70) - 0.5) * 120 * s;
          g.fillRect(gx, y - 4 * s, 2 * s, 4 * s);
        }
      }
      break;
  }
  if (tile.corrupt && tile.t !== 'rift') drawCorruptMark(x, y, s, tx, ty);
}

function renderPanorama(lord, time) {
  tickCam(time);
  const hour = 6 + (AP_PER_DAY - lord.ap) * HOUR_STEP;
  const doom = world.corruptR / 48;
  const env = envColors(hour, doom);
  const night = hour >= 20 || hour < 6;

  /* world is drawn under a camera transform so turns/steps feel continuous */
  g.save();
  const pivotX = W / 2, pivotY = HORIZON + (H - HORIZON) * 0.55;
  const bobY = Math.sin(time * 14) * cam.bob * 7 + cam.bob * 3;
  const panX = cam.pan * 95;
  const z = 1 + cam.zoom + cam.bob * 0.02;
  g.translate(pivotX + panX, pivotY + bobY);
  g.rotate(cam.roll + cam.pan * 0.02);
  g.scale(z, z);
  g.translate(-pivotX, -pivotY);

  drawSky(env, hour, time);
  drawRiftHorizonGlow(lord, time);
  drawGroundPlane(env, lord, time);

  const fwd = DIRS[lord.face], rt = DIRS[(lord.face + 2) % 8];
  let hordeNear = false;
  /* motion offset so features slide sideways/vertically during steps */
  const slideX = cam.pan * 40;
  const slideY = -cam.zoom * 55;

  for (let d = MAXD; d >= 1; d--) {
    const s = rowScale(d), y = rowY(d) + slideY * (1 / (d + 0.5));
    const spacing = 300 * s + 14;
    const kmax = Math.ceil((W / 2) / spacing) + 1;
    const fogT = Math.min(0.85, (d - 1) * 0.14);
    const P = rowPalette(env, fogT, night);

    const drawCell = k => {
      const tx = lord.x + fwd.dx * d + rt.dx * k;
      const ty = lord.y + fwd.dy * d + rt.dy * k;
      const x = W / 2 + k * spacing + slideX * (0.3 + 0.7 / d);
      const tile = tileAt(tx, ty) || { t: 'mountains', corrupt: false };
      drawFeature(tile, x, y, s, tx, ty, P, time, night);
      if (inMap(tx, ty)) {
        const en = world.enemies.find(e => e.x === tx && e.y === ty);
        if (en) { drawHorde(x, y, s, time); if (d <= 2 && Math.abs(k) <= 1) hordeNear = true; }
        const friends = stackAt(tx, ty).filter(l => l !== lord);
        if (friends.length) drawBanner(x + 30 * s, y, s);
      }
    };
    for (let k = kmax; k > 0; k--) { drawCell(-k); drawCell(k); }
    drawCell(0);

    /* depth fog veil between rows */
    if (d > 2) {
      g.fillStyle = rgba(env.fog, 0.04 + fogT * 0.06);
      g.fillRect(0, HORIZON, W, y - HORIZON + 20);
    }
  }

  /* motion blur streak when turning hard */
  if (Math.abs(cam.pan) > 0.35) {
    g.fillStyle = rgba(env.fog, Math.min(0.2, Math.abs(cam.pan) * 0.12));
    const dir = cam.pan > 0 ? 1 : -1;
    for (let i = 0; i < 6; i++) {
      g.fillRect(dir > 0 ? W - 20 - i * 30 : i * 30, 0, 14, H);
    }
  }
  g.restore();

  /* HUD text stays screen-stable */
  const here = tileAt(lord.x, lord.y);
  const atStr = here.place ? `at the ${here.place.name}` : (TERRAIN_AT[here.t] || 'on the plains');
  let aheadStr = 'the open plains';
  for (let d = 1; d <= 5; d++) {
    const tx = lord.x + fwd.dx * d, ty = lord.y + fwd.dy * d;
    const t = tileAt(tx, ty);
    if (!t) { aheadStr = 'the mountains'; break; }
    if (t.place) { aheadStr = `the ${t.place.name}`; break; }
    if (t.t !== 'plains') { aheadStr = TERRAIN_AHEAD[t.t]; break; }
  }
  g.save();
  g.shadowColor = 'rgba(0,0,0,.9)'; g.shadowBlur = 6;
  g.fillStyle = '#ffd98a';
  g.font = '600 21px Georgia, serif';
  g.fillText(lord.name.toUpperCase(), 18, 32);
  g.fillStyle = '#e6e0f2';
  g.font = 'italic 15px Georgia, serif';
  g.fillText(`stands ${atStr}, looking ${DIRNAMES[lord.face]} to ${aheadStr}.`, 18, 54);
  g.fillStyle = '#c0b8dc';
  g.font = '13px Georgia, serif';
  const hrs = lord.ap;
  g.fillText(`Day ${state.day} — ${phaseName(hour)}. ${hrs > 0 ? hrs + ' hours of daylight remain.' : 'Night has come; you must rest.'}`, 18, 74);
  if (hordeNear) {
    g.fillStyle = '#ff8f9e';
    g.font = '600 14px Georgia, serif';
    g.fillText('An Abyssal horde is near!', 18, 96);
  }
  g.fillStyle = '#ffd98a'; g.font = '700 26px Georgia, serif'; g.textAlign = 'center';
  g.fillText(DIRSHORT[lord.face], W - 50, 40);
  g.font = '11px Georgia, serif'; g.fillStyle = '#9d95c0';
  g.fillText('facing', W - 50, 54);
  g.textAlign = 'left';
  g.restore();
}

/* ----------------------------- title scene ------------------------------ */
function ridge(yBase, amp, seedOff, col, time, speed) {
  g.fillStyle = col;
  g.beginPath(); g.moveTo(0, H);
  for (let x = 0; x <= W; x += 8) {
    const n = Math.sin(x * 0.011 + seedOff) * 0.55 + Math.sin(x * 0.027 + seedOff * 2.7 + time * speed) * 0.3 + Math.sin(x * 0.053 + seedOff * 5.1) * 0.15;
    g.lineTo(x, yBase - Math.abs(n) * amp - n * amp * 0.3);
  }
  g.lineTo(W, H); g.closePath(); g.fill();
}
function renderTitle(time) {
  const env = envColors(19.4, 0.25);
  drawSky(env, 19.4, time);
  /* pulsing rift glow bleeding over the horizon */
  const pulse = 0.75 + 0.25 * Math.sin(time * 1.7);
  const glow = g.createRadialGradient(W * 0.62, HORIZON + 30, 10, W * 0.62, HORIZON + 30, 340 * pulse);
  glow.addColorStop(0, 'rgba(240,120,255,.5)');
  glow.addColorStop(0.4, 'rgba(170,50,220,.25)');
  glow.addColorStop(1, 'rgba(120,20,160,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  ridge(HORIZON + 46, 120, 1.7, rgb(colLerp(env.sil, [70, 60, 110], 0.4)), time, 0.05);
  ridge(HORIZON + 96, 95, 4.2, rgb(colLerp(env.sil, [44, 36, 74], 0.4)), time, 0.08);
  ridge(HORIZON + 160, 70, 8.9, rgb([20, 14, 34]), time, 0.12);
  g.fillStyle = '#0d0918';
  g.fillRect(0, H - 60, W, 60);
  /* drifting embers */
  for (let i = 0; i < 26; i++) {
    const ph = (time * 0.09 + i * 0.113) % 1;
    const ex = (i * 173 + Math.sin(time * 0.6 + i) * 60) % W;
    const ey = H - ph * H;
    g.fillStyle = rgba(i % 3 ? [240, 140, 255] : [255, 190, 120], (1 - ph) * 0.5);
    g.beginPath(); g.arc(ex, ey, 1.6 + (1 - ph), 0, 6.29); g.fill();
  }
}

/* -------------------------- end screen scenes --------------------------- */
function renderVictory(time) {
  const t = clamp((time - state.endAnim) / 5, 0, 1);       /* rift sealing over 5s */
  const env = envColors(lerp(20, 8.5, t), 0.25 * (1 - t)); /* night -> golden dawn */
  drawSky(env, lerp(20, 8.5, t), time);
  drawGroundPlane(env);
  ridge(HORIZON + 60, 110, 2.3, rgb(colLerp(env.sil, [80, 70, 110], 0.4)), time, 0.03);
  drawRift(W / 2, H * 0.86, 1.5, time, t);
  if (t > 0.15) { /* golden rays + rising sparks */
    g.save(); g.globalAlpha = (t - 0.15) * 0.5;
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + (i - 4) * 0.22 + Math.sin(time * 0.4) * 0.03;
      g.strokeStyle = 'rgba(255,220,140,.6)'; g.lineWidth = 14;
      g.beginPath(); g.moveTo(W / 2, H * 0.6);
      g.lineTo(W / 2 + Math.cos(a) * 700, H * 0.6 + Math.sin(a) * 700); g.stroke();
    }
    g.restore();
    for (let i = 0; i < 40; i++) {
      const ph = (time * 0.22 + i * 0.077) % 1;
      const ex = (i * 149 + Math.sin(time + i * 1.7) * 40) % W;
      g.fillStyle = rgba([255, 225, 150], (1 - ph) * 0.85 * t);
      g.beginPath(); g.arc(ex, H - ph * H, 2.2 - ph, 0, 6.29); g.fill();
    }
  }
}
function renderGameOver(time) {
  const env = { top:[12,4,20], bot:[60,10,44], ground:[18,8,26], fog:[70,20,60], sil:[10,4,16] };
  drawSky(env, 23, time);
  const pulse = 0.7 + 0.3 * Math.sin(time * 2.6);
  const glow = g.createRadialGradient(W / 2, HORIZON + 40, 10, W / 2, HORIZON + 40, 420 * pulse);
  glow.addColorStop(0, 'rgba(255,60,120,.55)');
  glow.addColorStop(0.5, 'rgba(180,20,120,.28)');
  glow.addColorStop(1, 'rgba(100,0,80,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  drawGroundPlane(env);
  ridge(HORIZON + 55, 115, 3.1, '#150a20', time, 0.04);
  drawRift(W / 2, H * 0.88, 1.9, time, 0);
  /* falling ash */
  for (let i = 0; i < 34; i++) {
    const ph = (time * 0.13 + i * 0.09) % 1;
    const ex = (i * 191 + Math.sin(time * 0.8 + i) * 50) % W;
    g.fillStyle = rgba([160, 140, 170], (1 - ph) * 0.4);
    g.beginPath(); g.arc(ex, ph * H, 1.5, 0, 6.29); g.fill();
  }
}

/* ------------------------------- portrait ------------------------------- */
function drawPortrait(lord) {
  const r = mulberry32(lord.seed * 1000 + 17);
  const skin = [[214,178,148],[188,146,116],[160,120,94],[226,192,166],[200,160,130]][ (r()*5)|0 ];
  const skinShade = skin.map(c => c * 0.72);
  const skinHi = skin.map(c => Math.min(255, c * 1.12));
  const cloth = [[70,60,120],[110,50,60],[50,90,70],[100,80,40],[60,80,110],[90,70,50]][ (r()*6)|0 ];
  const hairC = [[40,28,20],[70,50,30],[30,30,35],[90,70,40],[20,20,22]][ (r()*5)|0 ];
  const helm = r() > 0.42;
  const beard = !helm && r() > 0.4;
  pg.clearRect(0, 0, 72, 72);
  /* atmospheric backdrop */
  const bgr = pg.createRadialGradient(36, 28, 4, 36, 40, 48);
  bgr.addColorStop(0, '#3a3058'); bgr.addColorStop(0.6, '#1a162e'); bgr.addColorStop(1, '#0c0a16');
  pg.fillStyle = bgr; pg.fillRect(0, 0, 72, 72);
  /* cloak / shoulders with folds */
  const cloak = pg.createLinearGradient(10, 50, 62, 72);
  cloak.addColorStop(0, rgb(cloth.map(c => c * 0.7)));
  cloak.addColorStop(0.5, rgb(cloth));
  cloak.addColorStop(1, rgb(cloth.map(c => c * 0.55)));
  pg.fillStyle = cloak;
  pg.beginPath(); pg.ellipse(36, 76, 32, 24, 0, Math.PI, 0); pg.fill();
  pg.fillStyle = rgb(cloth.map(c => Math.min(255, c * 1.25)));
  pg.beginPath(); pg.ellipse(28, 62, 8, 5, -0.4, 0, 6.29); pg.fill();
  /* neck */
  pg.fillStyle = rgb(skinShade);
  pg.fillRect(31, 48, 10, 10);
  /* head volume */
  const faceG = pg.createLinearGradient(24, 24, 48, 52);
  faceG.addColorStop(0, rgb(skinHi));
  faceG.addColorStop(0.45, rgb(skin));
  faceG.addColorStop(1, rgb(skinShade));
  pg.fillStyle = faceG;
  pg.beginPath(); pg.ellipse(36, 38, 14, 17, 0, 0, 6.29); pg.fill();
  /* ear */
  pg.fillStyle = rgb(skin);
  pg.beginPath(); pg.ellipse(23, 38, 3, 5, 0, 0, 6.29); pg.fill();
  pg.beginPath(); pg.ellipse(49, 38, 3, 5, 0, 0, 6.29); pg.fill();
  /* hair under helm / hood */
  if (!helm) {
    pg.fillStyle = rgb(hairC);
    pg.beginPath(); pg.ellipse(36, 28, 15, 12, 0, Math.PI, 0); pg.fill();
    pg.fillRect(22, 28, 5, 14); pg.fillRect(45, 28, 5, 14);
  }
  if (helm) {
    const metal = pg.createLinearGradient(20, 18, 52, 40);
    metal.addColorStop(0, '#c8ccd8'); metal.addColorStop(0.4, '#8b8fa8'); metal.addColorStop(1, '#4a4e62');
    pg.fillStyle = metal;
    pg.beginPath(); pg.arc(36, 34, 16, Math.PI, 0); pg.fill();
    pg.fillRect(20, 32, 32, 6);
    pg.fillStyle = '#3a3e50';
    pg.fillRect(33, 32, 6, 16); /* nose guard */
    pg.fillStyle = '#d0d4e0';
    pg.fillRect(22, 22, 3, 8); pg.fillRect(47, 22, 3, 8); /* rivets */
  } else {
    pg.fillStyle = rgb(cloth.map(c => c * 0.55));
    pg.beginPath(); pg.arc(36, 32, 17, Math.PI * 0.95, Math.PI * 0.05); pg.fill();
    pg.fillStyle = rgb(cloth.map(c => c * 0.85));
    pg.beginPath(); pg.arc(36, 34, 12, Math.PI * 1.05, Math.PI * -0.05); pg.fill();
  }
  /* brows */
  pg.strokeStyle = rgb(hairC.map(c => c * 0.8));
  pg.lineWidth = 1.5;
  pg.beginPath(); pg.moveTo(27, 35); pg.lineTo(33, 34); pg.stroke();
  pg.beginPath(); pg.moveTo(39, 34); pg.lineTo(45, 35); pg.stroke();
  /* eyes with whites + iris + catchlight */
  pg.fillStyle = '#f2efe8';
  pg.beginPath(); pg.ellipse(30, 39, 3.2, 2.4, 0, 0, 6.29); pg.fill();
  pg.beginPath(); pg.ellipse(42, 39, 3.2, 2.4, 0, 0, 6.29); pg.fill();
  const iris = ['#3a4a6a', '#4a3a28', '#2a4a3a', '#4a3a5a'][ (r()*4)|0 ];
  pg.fillStyle = iris;
  pg.beginPath(); pg.arc(30, 39, 1.8, 0, 6.29); pg.fill();
  pg.beginPath(); pg.arc(42, 39, 1.8, 0, 6.29); pg.fill();
  pg.fillStyle = '#0a0a10';
  pg.beginPath(); pg.arc(30.3, 39, 0.9, 0, 6.29); pg.fill();
  pg.beginPath(); pg.arc(42.3, 39, 0.9, 0, 6.29); pg.fill();
  pg.fillStyle = 'rgba(255,255,255,0.85)';
  pg.fillRect(29, 38, 1.2, 1.2); pg.fillRect(41, 38, 1.2, 1.2);
  /* nose */
  pg.strokeStyle = rgb(skinShade);
  pg.lineWidth = 1.2;
  pg.beginPath(); pg.moveTo(36, 40); pg.lineTo(34, 46); pg.lineTo(38, 46); pg.stroke();
  /* mouth */
  pg.strokeStyle = rgb(skinShade.map(c => c * 0.85));
  pg.beginPath(); pg.moveTo(32, 50); pg.quadraticCurveTo(36, 52, 40, 50); pg.stroke();
  if (beard) {
    const bg = pg.createLinearGradient(36, 48, 36, 62);
    bg.addColorStop(0, rgb(hairC)); bg.addColorStop(1, 'rgba(0,0,0,0)');
    pg.fillStyle = bg;
    pg.beginPath(); pg.ellipse(36, 54, 11, 9, 0, 0, Math.PI); pg.fill();
  }
  /* armor collar */
  pg.fillStyle = rgb(colLerp(cloth, [180, 160, 90], 0.35));
  pg.fillRect(24, 56, 24, 4);
  pg.fillStyle = 'rgba(255,220,140,0.35)';
  pg.fillRect(34, 56, 4, 4);
  /* soft rim light */
  pg.strokeStyle = 'rgba(200,190,255,0.25)';
  pg.lineWidth = 2;
  pg.beginPath(); pg.ellipse(36, 38, 14.5, 17.5, 0, -0.8, 0.6); pg.stroke();
}

/* ------------------------------- minimap -------------------------------- */
const MAP_TS = 9;   /* px per tile: 60x44 world → 540x396 canvas */
const MAP_COLORS = {
  plains:'#31502e', forest:'#1c3d22', hills:'#4d5340', downs:'#5d6342',
  mountains:'#5b5b70', wasteland:'#3a2b44', keep:'#31502e', citadel:'#31502e',
  village:'#31502e', tower:'#31502e', rift:'#12041c',
};
function renderMap() {
  const ts = MAP_TS;
  mg.fillStyle = '#07060d'; mg.fillRect(0, 0, mapCv.width, mapCv.height);
  for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) {
    if (!world.discovered[y * MAPW + x]) continue;
    const tile = world.tiles[y * MAPW + x];
    const px = x * ts, pyy = y * ts;
    mg.fillStyle = MAP_COLORS[tile.t] || '#333';
    mg.fillRect(px, pyy, ts - 1, ts - 1);
    if (tile.corrupt) { mg.fillStyle = 'rgba(140,60,190,.5)'; mg.fillRect(px, pyy, ts - 1, ts - 1); }
    if (tile.t === 'mountains') {
      mg.fillStyle = '#7e7e96';
      mg.beginPath();
      mg.moveTo(px + ts*0.15, pyy + ts*0.82); mg.lineTo(px + ts*0.5, pyy + ts*0.15); mg.lineTo(px + ts*0.85, pyy + ts*0.82);
      mg.closePath(); mg.fill();
    }
    if (tile.t === 'forest') {
      mg.fillStyle = '#2f6b3a';
      mg.beginPath();
      mg.moveTo(px + ts*0.2, pyy + ts*0.82); mg.lineTo(px + ts*0.5, pyy + ts*0.18); mg.lineTo(px + ts*0.8, pyy + ts*0.82);
      mg.closePath(); mg.fill();
    }
    if (tile.place) {
      const p = tile.place;
      if (p.type === 'citadel') { mg.fillStyle = '#ffd24a'; mg.fillRect(px + ts*0.15, pyy + ts*0.15, ts*0.7, ts*0.7); }
      else if (p.type === 'keep') { mg.fillStyle = '#e8d9a0'; mg.fillRect(px + ts*0.2, pyy + ts*0.2, ts*0.6, ts*0.6); }
      else if (p.type === 'village') { mg.fillStyle = '#d8b46a'; mg.beginPath(); mg.arc(px + ts/2, pyy + ts/2, ts*0.26, 0, 6.29); mg.fill(); }
      else if (p.type === 'tower') {
        mg.fillStyle = '#9adfe8';
        mg.beginPath(); mg.moveTo(px + ts/2, pyy + ts*0.12); mg.lineTo(px + ts*0.18, pyy + ts*0.85); mg.lineTo(px + ts*0.82, pyy + ts*0.85);
        mg.closePath(); mg.fill();
      }
      if (p.lord && !p.recruited) { mg.fillStyle = '#9fe6a0'; mg.fillRect(px + ts*0.68, pyy + ts*0.05, ts*0.28, ts*0.28); }
    }
    if (tile.t === 'rift' && world.riftKnown) {
      const pu = 0.6 + 0.4 * Math.sin(performance.now() / 300);
      mg.fillStyle = rgba([233, 92, 255], pu);
      mg.font = `${ts + 7}px serif`; mg.textAlign = 'center';
      mg.fillText('✦', px + ts/2, pyy + ts - 1);
      mg.textAlign = 'left';
    }
  }
  for (const e of world.enemies) {
    if (!world.discovered[e.y * MAPW + e.x]) continue;
    const cx = e.x*MAP_TS + MAP_TS/2, cy = e.y*MAP_TS + MAP_TS/2;
    mg.fillStyle = 'rgba(255,60,60,.35)';                     /* threat glow */
    mg.beginPath(); mg.arc(cx, cy, MAP_TS*0.62, 0, 6.29); mg.fill();
    mg.fillStyle = '#ff5c5c';
    mg.beginPath(); mg.arc(cx, cy, MAP_TS*0.3, 0, 6.29); mg.fill();
  }
  state.lords.forEach((l, i) => {
    if (!l.alive) return;
    const cx = l.x*MAP_TS + MAP_TS/2, cy = l.y*MAP_TS + MAP_TS/2;
    mg.fillStyle = '#ffd24a';
    mg.save(); mg.translate(cx, cy); mg.rotate(Math.PI/4);
    mg.fillRect(-MAP_TS*0.28, -MAP_TS*0.28, MAP_TS*0.56, MAP_TS*0.56); mg.restore();
    if (i === state.active) {
      mg.strokeStyle = '#fff2c8'; mg.lineWidth = 1.6;
      mg.beginPath(); mg.arc(cx, cy, MAP_TS*0.62, 0, 6.29); mg.stroke();
    }
  });
}

/* ================================================================== HUD */
function updateHUD() {
  const l = activeLord();
  if (!l) return;
  drawPortrait(l);
  const aliveN = livingLords().length;
  const pips = '●'.repeat(Math.max(0, l.ap)) + '○'.repeat(Math.max(0, AP_PER_DAY - l.ap));
  /* ahead cost so the player can plan the last hours of daylight */
  const fwd = DIRS[l.face];
  const ahead = tileAt(l.x + fwd.dx, l.y + fwd.dy);
  let aheadHint = '';
  if (ahead && ahead.t !== 'mountains') {
    let cost = MOVE_COST[ahead.t] || 1;
    if (ahead.corrupt) cost += 1;
    aheadHint = ` &nbsp;<span style="color:#6e668e">→${cost}h</span>`;
  } else if (ahead && ahead.t === 'mountains') {
    aheadHint = ` &nbsp;<span style="color:#6e668e">→blocked</span>`;
  }
  $('lordInfo').innerHTML =
    `<span class="nm">${esc(l.name)}</span><br><span class="tt">${esc(l.title)}</span><br>` +
    `⚔ ${l.war} warriors &nbsp;♞ ${l.rid} riders<br>` +
    `<span style="color:#8fd0a0">${pips}</span>${aheadHint} &nbsp;<span style="color:#6e668e">(lord ${state.active + 1}/${aliveN})</span>`;
  const host = totalStr() | 0;
  const near = hostNearRift() | 0;
  $('hudRight').innerHTML =
    `<span class="day">Day ${Math.min(state.day, DAY_LIMIT)} of ${DAY_LIMIT}</span><br>` +
    `Host strength: <b style="color:#e8d9a0">${host}</b><br>` +
    `<span class="qi">${world.riftKnown ? `At the Rift: ${near} / ${SEAL_STRENGTH} needed` : `Seek the Abyssal Rift — ${SEAL_STRENGTH} spears must gather`}</span><br>` +
    `<span id="padInfo">${padConnected ? '🎮 gamepad ready' : ''}</span>`;
}

/* ================================================================ MODALS */
function showModal(html, cb) {
  state.modals.push({ html, cb });
  if (state.modals.length === 1) presentModal();
}
function presentModal() {
  const m = state.modals[0];
  if (!m) return;
  $('modalBox').innerHTML = m.html + '<div class="cont"><button class="btn" data-act="confirm">Continue &nbsp;⏎</button></div>';
  $('ovModal').classList.remove('hidden');
}
function closeModal() {
  const m = state.modals.shift();
  $('ovModal').classList.add('hidden');
  if (m && m.cb) m.cb();
  if (state.modals.length) presentModal();
  else if (state.pendingEnd) { const p = state.pendingEnd; state.pendingEnd = null; goEnd(p.outcome, p.cause); }
}
const modalOpen = () => state.modals.length > 0;

/* ================================================================ ACTIONS */
function turn(dir) {
  const l = activeLord();
  if (!l) return;
  l.face = (l.face + (dir > 0 ? 1 : 7)) % 8;
  kickTurn(dir > 0 ? 1 : -1);
}
function tryStep(sign) {
  /* sign +1 = forward (facing), -1 = back (opposite) */
  const l = activeLord();
  if (!l || !l.alive) return;
  const dir = DIRS[sign > 0 ? l.face : (l.face + 4) % 8];
  const nx = l.x + dir.dx, ny = l.y + dir.dy;
  const t = tileAt(nx, ny);
  if (!t || t.t === 'mountains') {
    showModal(`<h3>No Way Through</h3>The mountains bar your path. You must find another way.`);
    return;
  }
  let cost = MOVE_COST[t.t] || 1;
  if (t.corrupt) cost += 1;
  if (l.ap < cost) {
    const others = lordsWithAp().filter(x => x !== l);
    if (others.length) {
      showModal(
        `<h3>Night Draws Near</h3>${esc(l.name)} is too weary to go on — but <b>${others.length}</b> other lord${others.length > 1 ? 's still have' : ' still has'} daylight left.<br>` +
        `<small style="color:#9d95c0">Continue to command the next lord with hours left, or press <b>R</b> to rest the whole host.</small>`,
        () => {
          const n = state.lords.length;
          for (let i = 1; i <= n; i++) {
            const idx = (state.active + i) % n;
            const cand = state.lords[idx];
            if (cand.alive && cand.ap > 0) { state.active = idx; updateHUD(); return; }
          }
          switchLord(1);
        });
    } else {
      showModal(`<h3>Night Draws Near</h3>${esc(l.name)} is too weary to go on. Press <b>R</b> to rest until dawn.`);
    }
    return;
  }
  const en = world.enemies.find(e => e.x === nx && e.y === ny);
  if (en) {
    l.ap = Math.max(0, l.ap - 1);
    kickMove(sign);
    battle(stackAt(l.x, l.y), en, false, () => {
      if (!world.enemies.includes(en) && l.alive) { moveLordTo(l, nx, ny, 0); kickMove(sign); }
    });
    return;
  }
  kickMove(sign);
  moveLordTo(l, nx, ny, cost);
}
function tryForward() { tryStep(1); }
function tryBackward() { tryStep(-1); }
function moveLordTo(l, nx, ny, cost) {
  l.x = nx; l.y = ny;
  l.ap = Math.max(0, l.ap - cost);
  reveal(nx, ny, 3);
  const t = tileAt(nx, ny);

  if (t.t === 'rift') { attemptSeal(l); updateHUD(); autoSave(); return; }

  if (t.place) {
    const p = t.place;
    if (!p.visited) {
      p.visited = true;
      if (p.type === 'tower') {
        reveal(nx, ny, 8);
        if (p.name === 'Tower of the Seer' || p.name === 'Watchtower of Morn') {
          world.riftKnown = true;
          reveal(RIFT_X, RIFT_Y, 2);
          showModal(`<h3>${esc(p.name)}</h3><span class="arc">Visions swirl in the high chamber…</span><br>The Rift is revealed upon your map — far to the <b>east</b>, wreathed in blighted land. Only a host of <b>${SEAL_STRENGTH}</b> spears may seal it.`, () => autoSave());
        } else {
          showModal(`<h3>${esc(p.name)}</h3>From the heights you survey the land, and your map grows.`, () => autoSave());
        }
      }
    }
    if (p.lord && !p.recruited) {
      p.recruited = true;
      const rec = p.lord;
      state.lords.push({
        name: rec.name, title: rec.title, x: nx, y: ny, face: l.face,
        war: rec.war, rid: rec.rid, ap: AP_PER_DAY, alive: true,
        seed: 20 + state.lords.length * 13,
      });
      state.stats.recruited++;
      showModal(
        `<h3>${esc(rec.name)} ${esc(rec.title)} joins the host!</h3>` +
        `<span class="good">⚔ ${rec.war} warriors and ♞ ${rec.rid} riders swear their swords to the Quest.</span><br>` +
        `<i>"The Abyss shall not have these lands while we draw breath."</i><br>` +
        `<small style="color:#9d95c0">Press TAB to command each lord in turn.</small>`,
        () => autoSave());
    }
  }
  updateHUD();
  /* autosave after quiet moves; modal paths save on continue */
  if (!modalOpen()) autoSave();
}
function attemptSeal(l) {
  const host = hostNearRift();
  if (host >= SEAL_STRENGTH) {
    state.endAnim = performance.now() / 1000;
    goEnd('victory',
      `With ${host | 0} spears gathered at the brink, ${l.name} casts the Word of Dawn into the deep. ` +
      `The Abyss howls — and the Rift seals shut forever.`);
  } else {
    l.war = Math.max(1, Math.round(l.war * SEAL_FAIL_KEEP));
    l.rid = Math.max(0, Math.round(l.rid * SEAL_FAIL_KEEP));
    const back = DIRS[(l.face + 4) % 8];
    l.x = clamp(l.x + back.dx, 1, MAPW - 2);
    l.y = clamp(l.y + back.dy, 1, MAPH - 2);
    showModal(
      `<h3>The Abyss Roars</h3>` +
      `<span class="bad">Your host of ${host | 0} is too few — a wall of shadow hurls you back, and warriors are lost to the deep.</span><br>` +
      `Gather <b>${SEAL_STRENGTH}</b> spears within sight of the Rift, then enter it once more.`);
    if (!state.lords.some(x => x.alive)) queueEnd('gameover', 'The last of the free lords was swallowed by the Abyss.');
  }
}

/* -------------------------------- battle -------------------------------- */
function defMod(t) { return t === 'keep' || t === 'citadel' ? 1.35 : t === 'tower' ? 1.2 : t === 'forest' ? 1.15 : t === 'hills' ? 1.1 : 1; }
function battle(stack, enemy, enemyAttacks, after) {
  const rnd = state.rngBattle;
  const pStrBase = stack.reduce((s, l) => s + lordStr(l), 0);
  if (pStrBase <= 0) { if (after) after(); return; }
  const pTile = tileAt(stack[0].x, stack[0].y);
  const pEff = pStrBase * (0.9 + rnd() * 0.25) * (enemyAttacks ? defMod(pTile.t) : 1);
  const eEff = enemy.str * (0.9 + rnd() * 0.25);
  const names = stack.map(l => l.name).join(', ');
  let html;
  if (pEff >= eEff) {
    const frac = clamp(0.5 * (eEff / pEff) * (0.7 + rnd() * 0.6), 0.05, BATTLE_WIN_LOSS_CAP);
    let lost = 0;
    for (const l of stack) {
      const lw = Math.round(l.war * frac), lr = Math.round(l.rid * frac);
      l.war -= lw; l.rid -= lr; lost += lw + lr;
      if (l.war + l.rid < 5) l.alive = false;
    }
    world.enemies = world.enemies.filter(e => e !== enemy);
    state.stats.battles++;
    html = `<h3>Victory in Battle!</h3><span class="good">${names} ${stack.length > 1 ? 'have' : 'has'} broken an Abyssal horde of ${enemy.str | 0}.</span><br>` +
           `<span class="bad">${lost} of your company fell in the fighting.</span>`;
  } else {
    let lost = 0;
    const frac = 0.45 + rnd() * 0.2;
    for (const l of stack) {
      const lw = Math.round(l.war * frac), lr = Math.round(l.rid * frac);
      l.war -= lw; l.rid -= lr; lost += lw + lr;
      if (l.war + l.rid < 5) l.alive = false;
    }
    enemy.str = Math.round(enemy.str * 0.6);
    const dead = stack.filter(l => !l.alive);
    html = `<h3>Driven Back!</h3><span class="bad">The horde is too fierce — ${lost} of your company are slain.</span>` +
           (dead.length ? `<br><span class="bad">${dead.map(l => l.name).join(', ')} ${dead.length > 1 ? 'have' : 'has'} fallen forever.</span>` : '');
  }
  showModal(html, () => {
    fixActiveLord();
    if (!state.lords.some(l => l.alive)) queueEnd('gameover', 'The last of the free lords has fallen. Shadow takes the land.');
    else if (after) after();
    updateHUD();
    autoSave();
  });
}
function fixActiveLord() {
  /* activeLord() already re-homes onto a living lord when possible */
  activeLord();
}
function queueEnd(outcome, cause) { state.pendingEnd = { outcome, cause }; }

/* -------------------------------- night --------------------------------- */
function doRest() {
  if (state.screen !== 'play' || modalOpen()) return;
  state.day++;
  world.corruptR += CORRUPT_PER_NIGHT;
  applyCorruption();
  const notes = [];

  /* the Abyss spawns new warbands */
  if (state.day % ENEMY_SPAWN_EVERY === 0 && world.enemies.length < MAX_ENEMIES) {
    const rnd = state.rngBattle;
    for (let tries = 0; tries < 20; tries++) {
      const a = rnd() * Math.PI * 2;
      const x = Math.round(RIFT_X + Math.cos(a) * 4), y = Math.round(RIFT_Y + Math.sin(a) * 4);
      const t = tileAt(x, y);
      if (t && t.t !== 'mountains' && t.t !== 'rift' && !world.enemies.some(e => e.x === x && e.y === y)) {
        world.enemies.push({ x, y, str: Math.min(280, 90 + state.day * 2.5) | 0 });
        notes.push('A new horde crawls from the Rift.');
        break;
      }
    }
  }

  /* hordes prowl */
  const nightFights = [];
  for (const e of [...world.enemies]) {
    let target = null, best = ENEMY_AGGRO;
    for (const l of state.lords) {
      if (!l.alive) continue;
      const d = Math.max(Math.abs(l.x - e.x), Math.abs(l.y - e.y));
      if (d < best) { best = d; target = l; }
    }
    let dx = 0, dy = 0;
    if (target) { dx = Math.sign(target.x - e.x); dy = Math.sign(target.y - e.y); }
    else { dx = (state.rngBattle() * 3 | 0) - 1; dy = (state.rngBattle() * 3 | 0) - 1; }
    const nx = e.x + dx, ny = e.y + dy;
    const t = tileAt(nx, ny);
    if (t && t.t !== 'mountains' && t.t !== 'rift' && !world.enemies.some(o => o !== e && o.x === nx && o.y === ny)) {
      const victim = stackAt(nx, ny);
      if (victim.length) nightFights.push({ stack: victim, enemy: e });
      else { e.x = nx; e.y = ny; }
    }
  }

  /* rally: lords resting at friendly walls draw recruits */
  for (const l of state.lords) {
    if (!l.alive) continue;
    const t = tileAt(l.x, l.y);
    if (t.place && !t.corrupt && RALLY_WAR[t.place.type] != null) {
      l.war += RALLY_WAR[t.place.type];
    }
    l.ap = AP_PER_DAY;
  }

  /* doom warnings */
  const citadelDist = Math.hypot(START_X - RIFT_X, START_Y - RIFT_Y);
  if (world.corruptR >= citadelDist) {
    queueEnd('gameover', 'The corruption of the Abyss has swallowed the Citadel of Dawn. The last light of the free lands is gone.');
  } else if (world.corruptR >= citadelDist - 6) {
    notes.push('<span class="bad">The corruption gnaws at the very fields of the Citadel of Dawn!</span>');
  } else if (world.corruptR >= citadelDist * 0.6) {
    notes.push('<span class="arc">The purple blight spreads ever westward…</span>');
  }
  if (state.day > DAY_LIMIT) {
    queueEnd('gameover', `${DAY_LIMIT} days have passed. The Rift yawns too wide to ever be sealed, and shadow falls upon the world.`);
  } else if (state.day === DAY_LIMIT - 9) {
    notes.push(`<span class="bad">Only ${DAY_LIMIT - state.day} days remain!</span>`);
  }

  showModal(`<h3>Night Falls — Day ${Math.min(state.day, DAY_LIMIT)}</h3>The free lords rest, and the Abyss stirs.<br>${notes.join('<br>') || 'The night passes quietly.'}`, () => {
    autoSave();
  });
  for (const f of nightFights) battle(f.stack, f.enemy, true, null);
  updateHUD();
}

function switchLord(dir) {
  const n = state.lords.length;
  for (let i = 1; i <= n; i++) {
    const idx = (state.active + dir * i + n * i) % n;
    if (state.lords[idx].alive) { state.active = idx; break; }
  }
  updateHUD();
}

/* ======================================================= SAVE / RESUME --
   One quest slot. Electron writes savegame.json in the user data dir via
   window.lotSave; without the bridge we fall back to localStorage so the
   game is still playable if opened outside Electron.                      */
function serializeGame() {
  if (!world || !state || state.screen !== 'play') return null;
  const places = world.places.map(p => ({
    type: p.type, name: p.name, key: p.key || null,
    x: p.x | 0, y: p.y | 0,
    recruited: !!p.recruited, visited: !!p.visited,
    lordKey: p.lord && p.lord.key ? p.lord.key : (p.key || null),
  }));
  const placeIdx = new Map(world.places.map((p, i) => [p, i]));
  const tiles = world.tiles.map(t => ({
    t: t.t,
    c: t.corrupt ? 1 : 0,
    p: t.place != null && placeIdx.has(t.place) ? placeIdx.get(t.place) : -1,
  }));
  return {
    v: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    meta: {
      day: state.day,
      lords: livingLords().length,
      host: totalStr() | 0,
    },
    anchors: { START_X, START_Y, RIFT_X, RIFT_Y },
    world: {
      tiles,
      places,
      enemies: world.enemies.map(e => ({ x: e.x | 0, y: e.y | 0, str: e.str | 0 })),
      discovered: Array.from(world.discovered),
      corruptR: +world.corruptR,
      riftKnown: !!world.riftKnown,
    },
    state: {
      day: state.day | 0,
      active: state.active | 0,
      stats: {
        battles: (state.stats && state.stats.battles) | 0,
        recruited: (state.stats && state.stats.recruited) | 0,
      },
      battleSeed: (state.battleSeed | 0) || 1,
      lords: state.lords.map(l => ({
        name: String(l.name || 'Lord').slice(0, 32),
        title: String(l.title || '').slice(0, 48),
        x: l.x | 0, y: l.y | 0,
        face: ((l.face | 0) % 8 + 8) % 8,
        war: Math.max(0, l.war | 0),
        rid: Math.max(0, l.rid | 0),
        ap: clamp(l.ap | 0, 0, AP_PER_DAY),
        alive: !!l.alive,
        seed: l.seed | 0,
      })),
    },
  };
}

async function persistSave(payload) {
  if (!payload) return { ok: false, error: 'empty' };
  try {
    if (window.lotSave && window.lotSave.write) {
      return await window.lotSave.write(payload);
    }
    localStorage.setItem('lot_save', JSON.stringify(payload));
    return { ok: true, savedAt: payload.savedAt };
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'write failed' };
  }
}

async function clearPersistedSave() {
  try {
    if (window.lotSave && window.lotSave.clear) await window.lotSave.clear();
    else localStorage.removeItem('lot_save');
  } catch { /* ignore */ }
}

async function fetchSaveMeta() {
  try {
    if (window.lotSave && window.lotSave.meta) return await window.lotSave.meta();
    const raw = localStorage.getItem('lot_save');
    if (!raw) return { exists: false };
    const data = JSON.parse(raw);
    if (!data || data.v !== SAVE_VERSION) return { exists: false };
    return {
      exists: true,
      savedAt: data.savedAt || null,
      day: (data.meta && data.meta.day) || (data.state && data.state.day) || 1,
      lords: (data.meta && data.meta.lords) || 1,
      host: data.meta && data.meta.host != null ? data.meta.host : null,
    };
  } catch { return { exists: false }; }
}

async function fetchSaveData() {
  try {
    if (window.lotSave && window.lotSave.get) {
      const res = await window.lotSave.get();
      return res && res.ok ? res.data : null;
    }
    const raw = localStorage.getItem('lot_save');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function applySaveData(data) {
  if (!data || data.v !== SAVE_VERSION || !data.world || !data.state || !data.anchors) return false;
  const a = data.anchors;
  START_X = a.START_X | 0; START_Y = a.START_Y | 0;
  RIFT_X = a.RIFT_X | 0; RIFT_Y = a.RIFT_Y | 0;
  if (!inMap(START_X, START_Y) || !inMap(RIFT_X, RIFT_Y)) return false;

  const w = data.world;
  if (!Array.isArray(w.tiles) || w.tiles.length !== MAPW * MAPH) return false;
  if (!Array.isArray(w.places) || !Array.isArray(w.enemies)) return false;

  const places = w.places.map(p => {
    const key = p.key || p.lordKey || null;
    const rec = key ? RECRUITS.find(r => r.key === key) : null;
    return {
      type: p.type,
      name: p.name,
      key,
      x: p.x | 0, y: p.y | 0,
      lord: rec || null,
      recruited: !!p.recruited,
      visited: !!p.visited,
    };
  });

  const tiles = new Array(MAPW * MAPH);
  for (let i = 0; i < MAPW * MAPH; i++) {
    const src = w.tiles[i] || { t: 'plains', c: 0, p: -1 };
    const pi = src.p | 0;
    tiles[i] = {
      t: src.t || 'plains',
      corrupt: !!src.c,
      place: pi >= 0 && pi < places.length ? places[pi] : null,
    };
  }

  let discovered;
  if (Array.isArray(w.discovered) && w.discovered.length === MAPW * MAPH) {
    discovered = Uint8Array.from(w.discovered.map(v => v ? 1 : 0));
  } else {
    discovered = new Uint8Array(MAPW * MAPH);
  }

  world = {
    tiles,
    places,
    enemies: w.enemies.map(e => ({ x: e.x | 0, y: e.y | 0, str: Math.max(1, e.str | 0) })),
    discovered,
    corruptR: Math.max(0, +w.corruptR || 0),
    riftKnown: !!w.riftKnown,
  };
  applyCorruption();

  const st = data.state;
  const battleSeed = (st.battleSeed | 0) || 1;
  const lords = (st.lords || []).map(l => ({
    name: String(l.name || 'Lord').slice(0, 32),
    title: String(l.title || '').slice(0, 48),
    x: clamp(l.x | 0, 0, MAPW - 1),
    y: clamp(l.y | 0, 0, MAPH - 1),
    face: ((l.face | 0) % 8 + 8) % 8,
    war: Math.max(0, l.war | 0),
    rid: Math.max(0, l.rid | 0),
    ap: clamp(l.ap | 0, 0, AP_PER_DAY),
    alive: !!l.alive,
    seed: l.seed | 0,
  }));
  if (!lords.length) return false;

  state = {
    screen: 'play',
    day: Math.max(1, st.day | 0),
    lords,
    active: clamp(st.active | 0, 0, lords.length - 1),
    modals: [],
    pendingEnd: null,
    endAnim: 0,
    scoreSent: false,
    stats: {
      battles: (st.stats && st.stats.battles) | 0,
      recruited: (st.stats && st.stats.recruited) | 0,
    },
    battleSeed,
    rngBattle: mulberry32(battleSeed),
  };
  fixActiveLord();
  return true;
}

async function autoSave() {
  if (!state || state.screen !== 'play') return;
  const snap = serializeGame();
  if (!snap) return;
  await persistSave(snap);
}

async function saveQuest(opts) {
  const quiet = opts && opts.quiet;
  if (!state || state.screen !== 'play') {
    if (!quiet) showModal(`<h3>Nothing to Save</h3>There is no quest in progress.`);
    return false;
  }
  /* never snapshot mid-modal (partial battle outcomes, etc.) */
  if (modalOpen() && !(opts && opts.force)) {
    if (!quiet) showModal(`<h3>Not Yet</h3>Finish the present moment, then the quest may be saved.`);
    return false;
  }
  const snap = serializeGame();
  const res = await persistSave(snap);
  if (!quiet) {
    if (res && res.ok) {
      showModal(`<h3>Quest Saved</h3><span class="good">Day ${state.day}</span> is carved into the annals. You may continue this quest from the title screen.`);
    } else {
      showModal(`<h3>Save Failed</h3><span class="bad">The annals would not take the mark${res && res.error ? ' — ' + esc(res.error) : ''}.</span>`);
    }
  }
  refreshContinueButton();
  return !!(res && res.ok);
}

async function continueQuest() {
  if (state && state.screen === 'play' && !pauseOpen()) return;
  const data = await fetchSaveData();
  if (!data) {
    showModal(`<h3>No Saved Quest</h3>The annals hold no unfinished road. Begin a new quest.`);
    refreshContinueButton();
    return;
  }
  if (!applySaveData(data)) {
    showModal(`<h3>Save Corrupted</h3><span class="bad">The saved quest could not be restored.</span> Begin anew.`);
    await clearPersistedSave();
    refreshContinueButton();
    return;
  }
  closePause();
  $('ovModal').classList.add('hidden');
  state.modals = [];
  state.screen = 'play';
  syncOverlays();
  playMusic('play');
  updateHUD();
  showModal(
    `<h3>The Road Resumes</h3>` +
    `Day <b>${state.day}</b> of ${DAY_LIMIT}. Host strength <b>${totalStr() | 0}</b>. ` +
    `${livingLords().length} lord${livingLords().length === 1 ? '' : 's'} still ride free.<br>` +
    `<small style="color:#9d95c0">Seal the Rift with <b>${SEAL_STRENGTH}</b> spears before corruption claims the Citadel.</small>`);
}

async function refreshContinueButton() {
  const btn = $('continueBtn');
  const hint = $('continueHint');
  if (!btn) return;
  const meta = await fetchSaveMeta();
  if (meta && meta.exists) {
    btn.classList.remove('hidden');
    btn.disabled = false;
    if (hint) {
      const host = meta.host != null ? ` · host ${meta.host}` : '';
      hint.textContent = `Day ${meta.day || '?'} · ${meta.lords || '?'} lord${meta.lords === 1 ? '' : 's'}${host}`;
      hint.classList.remove('hidden');
    }
  } else {
    btn.classList.add('hidden');
    if (hint) { hint.textContent = ''; hint.classList.add('hidden'); }
  }
}

/* ============================================================== SCREENS */
function syncOverlays() {
  $('ovTitle').classList.toggle('hidden', state.screen !== 'title');
  $('ovEnd').classList.toggle('hidden', state.screen !== 'end');
  $('ovPause').classList.add('hidden');
  if (state.screen !== 'play') { $('ovMap').classList.add('hidden'); $('ovModal').classList.add('hidden'); }
}

/* ------------------------------- pause menu ----------------------------- */
const pauseOpen = () => !$('ovPause').classList.contains('hidden');
function openPause() {
  $('ovPause').classList.remove('hidden');
  autoSave(); /* silent autosave whenever the host halts */
  $('pauseScores').innerHTML = 'Consulting the annals…';
  fetchScores().then(s => renderScoreList(s, -1, 'pauseScores'))
    .catch(() => { $('pauseScores').innerHTML = '<i>The annals are unreachable.</i>'; });
}
function closePause() { $('ovPause').classList.add('hidden'); }
async function quitGame() {
  try {
    if (state && state.screen === 'play' && !modalOpen()) await autoSave();
  } catch { /* still quit */ }
  shutdownRenderer();
  try {
    if (window.lotApp && window.lotApp.quit) await window.lotApp.quit();
    else window.close();
  } catch {
    window.close();
  }
}
async function startGame() {
  await clearPersistedSave();
  newGame();
  state.screen = 'play';
  syncOverlays();
  playMusic('play');
  showModal(
    `<h3>The Quest of the Rift</h3>` +
    `<i>"Ride east, Athelorn. Rally every lord who yet stands free — Ithrilan foretold that only a host of ` +
    `<b>${SEAL_STRENGTH} spears</b>, gathered at the very brink, can seal the Abyssal Rift. ` +
    `You have <b>${DAY_LIMIT} days</b> before the corruption swallows the Citadel of Dawn."</i><br>` +
    `<small style="color:#9d95c0">Turn with ←/→, ride with ↑, rest at night with R, map with M, pause with Esc. The quest auto-saves.</small>`);
  updateHUD();
  autoSave();
  refreshContinueButton();
}
async function goEnd(outcome, cause) {
  await clearPersistedSave();
  refreshContinueButton();
  state.screen = 'end';
  state.outcome = outcome;
  state.scoreSent = false;
  state.endAnim = performance.now() / 1000;
  const won = outcome === 'victory';
  playMusic(won ? 'victory' : 'gameover');
  const days = Math.min(state.day, DAY_LIMIT);
  state.finalScore = won
    ? 10000 + (DAY_LIMIT - days) * 250 + state.stats.battles * 150 + (totalStr() | 0) * 2 + state.stats.recruited * 100
    : days * 50 + state.stats.battles * 150 + state.stats.recruited * 100;
  $('ovEnd').className = 'ov ' + (won ? 'victory' : 'gameover');
  $('endTitle').textContent = won ? '✦ The Rift Is Sealed ✦' : 'Darkness Falls';
  $('endCause').innerHTML = cause + (won
    ? '<br><b style="color:#ffe9a8">Congratulations, Lord of Twilight — the free lands sing your name!</b>'
    : '<br><i>Yet legends say the Quest may be attempted again…</i>');
  $('endStats').innerHTML =
    `Days on the road: ${days} &nbsp;·&nbsp; Lords rallied: ${state.stats.recruited + 1}` +
    `<br>Battles won: ${state.stats.battles} &nbsp;·&nbsp; Host remaining: ${totalStr() | 0}` +
    `<br><b style="color:#ffd98a">SCORE: ${state.finalScore}</b>`;
  $('scoreRow').style.display = '';
  $('nameIn').value = localStorage.getItem('lot_name') || '';
  $('endScores').innerHTML = 'Fetching the annals…';
  fetchScores().then(renderScoreList).catch(() => { $('endScores').innerHTML = '<i>The annals are unreachable (offline).</i>'; });
  syncOverlays();
}

/* ============================================================ HIGH SCORES
   Persisted by the Electron main process (the one external file:
   highscores.txt in the per-user data dir), reached over a contextBridge
   API exposed as window.lotScores. Falls back gracefully if absent.       */
async function fetchScores() {
  if (!window.lotScores) return [];
  return (await window.lotScores.get()).scores || [];
}
function renderScoreList(scores, rank, elId = 'endScores') {
  const el = $(elId);
  if (!scores.length) { el.innerHTML = '<i>No names yet stand in the annals. Be the first!</i>'; return; }
  el.innerHTML = '<b>— THE ANNALS OF TWILIGHT —</b><br>' + scores.slice(0, 10).map((s, i) =>
    `<span class="${i === rank ? 'me' : ''}">${String(i + 1).padStart(2, ' ')}. ${esc(s.name).padEnd(16, '·')} ${String(s.score | 0).padStart(6, ' ')}  ${s.outcome === 'victory' ? '✦' : '✝'} day ${s.days | 0}</span>`
  ).join('<br>');
}
async function submitScore() {
  if (state.scoreSent || state.screen !== 'end') return;
  const name = ($('nameIn').value.trim() || 'WANDERER').slice(0, 16);
  localStorage.setItem('lot_name', name);
  state.scoreSent = true;
  $('scoreRow').style.display = 'none';
  try {
    if (!window.lotScores) throw new Error('no scores bridge');
    const data = await window.lotScores.add({
      name, score: state.finalScore, days: Math.min(state.day, DAY_LIMIT), outcome: state.outcome,
    });
    renderScoreList(data.scores || [], data.rank);
  } catch {
    $('endScores').innerHTML = '<i>The annals are unreachable — your deed lives on in memory alone.</i>';
  }
}
async function loadTitleScores() {
  try {
    const scores = await fetchScores();
    $('titleScores').innerHTML = scores.length
      ? '<b>THE ANNALS:</b> ' + scores.slice(0, 5).map((s, i) => `${i + 1}. ${esc(s.name)} ${s.score | 0}${s.outcome === 'victory' ? '✦' : ''}`).join(' &nbsp;·&nbsp; ')
      : '<i>No legends yet written — be the first.</i>';
  } catch { $('titleScores').innerHTML = ''; }
}

/* ================================================================= INPUT */
function dispatch(act) {
  if ((act === 'confirm' || act === 'cancel') && modalOpen()) { closeModal(); return; }
  switch (act) {
    case 'start':        if (state.screen === 'title') startGame(); return;
    case 'continue':     if (state.screen === 'title' || pauseOpen()) continueQuest(); return;
    case 'restart':      if (state.screen === 'end' || pauseOpen()) startGame(); return;
    case 'resume':       closePause(); return;
    case 'save':         if (state.screen === 'play') saveQuest(); return;
    case 'toTitle':
      if (state.screen === 'end' || pauseOpen()) {
        if (state.screen === 'play') autoSave();
        closePause();
        state.screen = 'title';
        syncOverlays();
        loadTitleScores();
        refreshContinueButton();
        playMusic('title');
      }
      return;
    case 'quit':         quitGame(); return;
    case 'submitScore':  submitScore(); return;
    case 'toggleMusic':  setMusic(!musicOn); return;   /* works on any screen */
  }
  if (state.screen !== 'play' || modalOpen()) return;
  /* pause menu takes precedence over all other play input */
  if (pauseOpen()) {
    /* Esc / B / M / Enter / Space / Start all dismiss pause */
    if (act === 'cancel' || act === 'toggleMap' || act === 'confirm' || act === 'forward' || act === 'resume') closePause();
    return;
  }
  const mapUp = !$('ovMap').classList.contains('hidden');
  if (act === 'toggleMap') { $('ovMap').classList.toggle('hidden'); return; }
  if (mapUp) { if (act === 'cancel') $('ovMap').classList.add('hidden'); return; }
  if (act === 'cancel') { openPause(); return; }   /* Esc / B opens the pause menu */
  switch (act) {
    case 'turnLeft':  turn(-1); updateHUD(); break;
    case 'turnRight': turn(1);  updateHUD(); break;
    case 'forward':   tryForward(); break;
    case 'back':      tryBackward(); break;
    case 'rest':      doRest(); break;
    case 'nextLord':  switchLord(1); break;
    case 'prevLord':  switchLord(-1); break;
  }
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b) { dispatch(b.dataset.act); return; }
});
cv.addEventListener('click', e => {
  if (state.screen === 'title') { dispatch('start'); return; }
  if (state.screen !== 'play' || modalOpen()) return;
  const r = cv.getBoundingClientRect();
  const fx = (e.clientX - r.left) / r.width;
  dispatch(fx < 0.3 ? 'turnLeft' : fx > 0.7 ? 'turnRight' : 'forward');
});

const KEYMAP = {
  ArrowLeft:'turnLeft', a:'turnLeft', ArrowRight:'turnRight', d:'turnRight',
  ArrowUp:'forward', w:'forward', ArrowDown:'back', x:'back',
  r:'rest', m:'toggleMap', Tab:'nextLord', n:'nextLord',
  Enter:'confirm', ' ':'confirm', Escape:'cancel', f:'forward',
  u:'toggleMusic',                          /* ♪ music on/off */
  q:'prevLord',                             /* previous lord (LB / Q) */
  s:'save',                                 /* save quest */
};
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Enter') submitScore();
    return;
  }
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const act = KEYMAP[key];
  if (!act) return;
  e.preventDefault();
  if (state.screen === 'title' && (act === 'confirm' || act === 'forward')) { dispatch('start'); return; }
  if (state.screen === 'end' && act === 'confirm') { dispatch('restart'); return; }
  if (act === 'confirm' && !modalOpen() && state.screen === 'play') { dispatch('forward'); return; }
  dispatch(act);
});

/* gamepad — edge-detected standard mapping */
let padConnected = false;
let padPrev = [];
/* 0=A 1=B 2=X 3=Y 4=LB 5=RB 9=Start 12–15=D-pad */
const PAD_ACTS = {
  0:'confirmA', 1:'cancel', 2:'rest', 3:'toggleMap',
  4:'prevLord', 5:'nextLord', 9:'startBtn',
  12:'forward', 13:'rest', 14:'turnLeft', 15:'turnRight',
};
let axisPrev = [0, 0];
window.addEventListener('gamepadconnected', () => { padConnected = true; if (state) updateHUD(); });
window.addEventListener('gamepaddisconnected', () => { padConnected = false; if (state) updateHUD(); });
function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const p = [...pads].find(x => x && x.connected);
  if (!p) return;
  if (!padConnected) { padConnected = true; updateHUD(); }
  p.buttons.forEach((b, i) => {
    const was = padPrev[i] || false;
    if (b.pressed && !was) {
      let act = PAD_ACTS[i];
      if (act === 'confirmA') {
        act = modalOpen() ? 'confirm' : state.screen === 'title' ? 'start' : state.screen === 'end' ? 'restart' : 'forward';
      } else if (act === 'startBtn') {
        /* Start: begin from title, restart from end, otherwise pause/resume */
        act = state.screen === 'title' ? 'start'
          : state.screen === 'end' ? 'restart'
          : pauseOpen() ? 'resume' : 'cancel';
      }
      if (act) dispatch(act);
    }
    padPrev[i] = b.pressed;
  });
  const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
  const dz = 0.55;
  const axd = ax < -dz ? -1 : ax > dz ? 1 : 0;
  const ayd = ay < -dz ? -1 : ay > dz ? 1 : 0;
  if (axd !== 0 && axisPrev[0] === 0) dispatch(axd < 0 ? 'turnLeft' : 'turnRight');
  if (ayd === -1 && axisPrev[1] === 0) dispatch(modalOpen() ? 'confirm' : 'forward');
  if (ayd === 1 && axisPrev[1] === 0 && !modalOpen()) dispatch('back');
  axisPrev = [axd, ayd];
}

/* =============================================================== MAIN LOOP */
let rafId = 0;
let rendererAlive = true;
function shutdownRenderer() {
  if (!rendererAlive) return;
  rendererAlive = false;
  stopMusic();
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
}
window.addEventListener('pagehide', shutdownRenderer);
window.addEventListener('beforeunload', shutdownRenderer);

function frame(ts) {
  if (!rendererAlive) return;
  const time = ts / 1000;
  pollGamepad();
  if (state.screen === 'title') renderTitle(time);
  else if (state.screen === 'play') {
    const lord = activeLord();
    if (lord) renderPanorama(lord, time);
    if (!$('ovMap').classList.contains('hidden')) renderMap();
  } else if (state.screen === 'end') {
    if (state.outcome === 'victory') renderVictory(time);
    else renderGameOver(time);
  }
  rafId = requestAnimationFrame(frame);
}

/* --------------------------------- boot ---------------------------------- */
newGame();
state.screen = 'title';
syncOverlays();
loadTitleScores();
refreshContinueButton();
playMusic('title');
updateMusicUI();
if (window.lotSave) {
  if (window.lotSave.onMenuSave) window.lotSave.onMenuSave(() => dispatch('save'));
  if (window.lotSave.onMenuContinue) window.lotSave.onMenuContinue(() => {
    if (state.screen === 'title') dispatch('continue');
    else if (state.screen === 'play' && !pauseOpen()) openPause();
  });
}
requestAnimationFrame(frame);
