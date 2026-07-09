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
const DAY_LIMIT = 90;
const AP_PER_DAY = 12;
const HOUR_STEP = 16 / AP_PER_DAY;      /* daylight spans 06:00 → 22:00 */
const SEAL_STRENGTH = 800;
const CORRUPT_PER_NIGHT = 0.55;
const MAX_ENEMIES = 18;
const FALLBACK_SEED = 20260707;     /* proven-good world if generation ever fails */

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
function setMusic(on) {
  musicOn = on;
  localStorage.setItem('lot_music', on ? 'on' : 'off');
  if (!on) {
    musicToken++;                              /* cancel any in-flight probe */
    if (curTrack) { curTrack.pause(); curTrack = null; }
    curTrackName = '';
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

  /* the proof-walk: the Rift and every named place must be reachable */
  const seen = new Uint8Array(MAPW * MAPH);
  const queue = [[START_X, START_Y]];
  seen[START_Y * MAPW + START_X] = 1;
  while (queue.length) {
    const [x, y] = queue.pop();
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
  state = {
    screen: state ? state.screen : 'title',
    day: 1,
    lords: [{
      name:'Lord Athelorn', title:'Heir of the Moonprince', x:START_X, y:START_Y,
      face:2, war:120, rid:60, ap:AP_PER_DAY, alive:true, seed:7,
    }],
    active: 0,
    modals: [],
    pendingEnd: null,
    endAnim: 0,
    scoreSent: false,
    stats: { battles: 0, recruited: 0 },
    rngBattle: mulberry32((Math.random() * 1e9) | 0),
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
const hourNow = () => 6 + (AP_PER_DAY - activeLord().ap) * HOUR_STEP;
function activeLord() { return state.lords[state.active]; }
function phaseName(h) {
  return h < 6 ? 'night' : h < 9 ? 'dawn' : h < 12 ? 'morning' : h < 16 ? 'afternoon' : h < 19 ? 'evening' : h < 22 ? 'dusk' : 'night';
}

/* ================================================================= RENDER */

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
  return env;
}

/* stars, fixed constellation */
const STARS = (() => {
  const r = mulberry32(99), s = [];
  for (let i = 0; i < 80; i++) s.push([r() * W, r() * HORIZON * 0.95, r() * 1.6 + 0.4, r() * 6.28]);
  return s;
})();

function drawSky(env, hour, time) {
  const grad = g.createLinearGradient(0, 0, 0, HORIZON);
  grad.addColorStop(0, rgb(env.top)); grad.addColorStop(1, rgb(env.bot));
  g.fillStyle = grad; g.fillRect(0, 0, W, HORIZON);

  const darkness = clamp((Math.abs(hour - 13) - 6) / 5, 0, 1); /* 1 at deep night */
  if (darkness > 0.05) {
    for (const [sx, sy, sr, ph] of STARS) {
      g.globalAlpha = darkness * (0.5 + 0.5 * Math.sin(time * 1.5 + ph));
      g.fillStyle = '#e8ecff'; g.fillRect(sx, sy, sr, sr);
    }
    g.globalAlpha = 1;
    /* crescent moon */
    g.fillStyle = rgba([230, 232, 250], darkness * 0.9);
    g.beginPath(); g.arc(W * 0.78, HORIZON * 0.3, 22, 0, 6.29); g.fill();
    g.fillStyle = rgb(env.top);
    g.beginPath(); g.arc(W * 0.78 + 9, HORIZON * 0.3 - 4, 19, 0, 6.29); g.fill();
  }
  if (hour >= 6 && hour <= 20) { /* sun */
    const t = (hour - 6) / 14;
    const sx = W * (0.12 + 0.76 * t), sy = HORIZON - Math.sin(t * Math.PI) * HORIZON * 0.75 + 20;
    const glow = g.createRadialGradient(sx, sy, 4, sx, sy, 90);
    const warm = hour < 8.5 || hour > 17.5;
    glow.addColorStop(0, warm ? 'rgba(255,190,120,.95)' : 'rgba(255,244,214,.95)');
    glow.addColorStop(0.25, warm ? 'rgba(255,150,80,.5)' : 'rgba(255,240,200,.35)');
    glow.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = glow; g.beginPath(); g.arc(sx, sy, 90, 0, 6.29); g.fill();
  }
}

function drawGroundPlane(env) {
  const grad = g.createLinearGradient(0, HORIZON, 0, H);
  grad.addColorStop(0, rgb(colLerp(env.ground, env.fog, 0.75)));
  grad.addColorStop(0.35, rgb(colLerp(env.ground, env.fog, 0.3)));
  grad.addColorStop(1, rgb(env.ground.map(c => c * 0.8)));
  g.fillStyle = grad; g.fillRect(0, HORIZON, W, H - HORIZON);
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
  const cx = W / 2 + (diff / (Math.PI / 3)) * W * 0.55;
  const a = Math.min(0.55, 7 / dist) * (0.75 + 0.25 * Math.sin(time * 2.2));
  const glow = g.createRadialGradient(cx, HORIZON, 5, cx, HORIZON, 190);
  glow.addColorStop(0, rgba([233, 92, 255], a));
  glow.addColorStop(0.4, rgba([160, 40, 200], a * 0.45));
  glow.addColorStop(1, 'rgba(120,20,160,0)');
  g.fillStyle = glow;
  g.fillRect(cx - 190, HORIZON - 130, 380, 150);
}

/* --------------------------- terrain silhouettes ------------------------ */
function drawMountains(x, y, s, tx, ty, P) {
  const w = 360 * s, h = (150 + tRand(tx, ty, 1) * 80) * s;
  const pts = [[-0.5,0],[-0.34,0.72],[-0.2,0.4],[-0.03,1],[0.12,0.5],[0.3,0.78],[0.5,0]];
  g.fillStyle = P.mount;
  g.beginPath(); g.moveTo(x - w/2, y);
  for (const [px, ph] of pts) {
    const j = (tRand(tx, ty, (px*10|0)+5) - 0.5) * 0.15;
    g.lineTo(x + (px + j*0.3) * w, y - (ph + j) * h);
  }
  g.lineTo(x + w/2, y); g.closePath(); g.fill();
  /* snow cap on the main peak */
  g.fillStyle = P.snow;
  g.beginPath();
  g.moveTo(x - 0.03*w, y - h); g.lineTo(x - 0.09*w, y - h*0.8); g.lineTo(x + 0.04*w, y - h*0.82);
  g.closePath(); g.fill();
}
function drawHills(x, y, s, tx, ty, P) {
  const w = 300 * s, h = (55 + tRand(tx, ty, 2) * 25) * s;
  g.fillStyle = P.hill;
  for (const [ox, sc] of [[-0.22, 0.85], [0.15, 1], [0.42, 0.6]]) {
    g.beginPath();
    g.ellipse(x + ox * w, y, w * 0.32 * sc, h * sc, 0, Math.PI, 0);
    g.fill();
  }
}
function drawDowns(x, y, s, tx, ty, P) {
  const w = 320 * s, h = 28 * s;
  g.fillStyle = P.down;
  for (const [ox, sc] of [[-0.25, 0.9], [0.2, 1]]) {
    g.beginPath();
    g.ellipse(x + ox * w, y, w * 0.4 * sc, h * sc, 0, Math.PI, 0);
    g.fill();
  }
}
function drawForest(x, y, s, tx, ty, P) {
  const n = 5, w = 260 * s;
  for (let i = 0; i < n; i++) {
    const r1 = tRand(tx, ty, i), r2 = tRand(tx, ty, i + 20);
    const cx = x + (i - (n - 1) / 2) * (w / n) + (r1 - 0.5) * 18 * s;
    const th = (55 + r2 * 30) * s, tw = (26 + r1 * 10) * s;
    g.fillStyle = i % 2 ? P.tree : P.tree2;
    g.beginPath();
    g.moveTo(cx, y - th); g.lineTo(cx - tw / 2, y); g.lineTo(cx + tw / 2, y);
    g.closePath(); g.fill();
  }
}
function crenels(x, y, w, hgt, n, fill) {
  g.fillStyle = fill;
  const tw = w / (n * 2 - 1);
  for (let i = 0; i < n; i++) g.fillRect(x + i * tw * 2, y - hgt, tw, hgt);
}
function drawKeep(x, y, s, tx, ty, P, big, night) {
  const w = (big ? 170 : 120) * s, wallH = (big ? 70 : 52) * s, tH = (big ? 130 : 95) * s, tW = (big ? 34 : 26) * s;
  g.fillStyle = P.stone;
  g.fillRect(x - w/2, y - wallH, w, wallH);                       /* wall */
  g.fillRect(x - w/2 - tW*0.3, y - tH, tW, tH);                   /* left tower */
  g.fillRect(x + w/2 - tW*0.7, y - tH, tW, tH);                   /* right tower */
  crenels(x - w/2 - tW*0.3, y - tH, tW, 7*s, 3, P.stone);
  crenels(x + w/2 - tW*0.7, y - tH, tW, 7*s, 3, P.stone);
  crenels(x - w/2 + tW*0.8, y - wallH, w - tW*1.6, 6*s, 6, P.stone);
  g.fillStyle = P.dark;                                            /* gate */
  g.beginPath();
  g.moveTo(x - 13*s, y); g.lineTo(x - 13*s, y - 24*s);
  g.arc(x, y - 24*s, 13*s, Math.PI, 0);
  g.lineTo(x + 13*s, y); g.closePath(); g.fill();
  if (night) {                                                     /* lit windows */
    g.fillStyle = P.window;
    g.fillRect(x - w/2 - tW*0.3 + tW*0.35, y - tH*0.75, 4*s, 7*s);
    g.fillRect(x + w/2 - tW*0.7 + tW*0.35, y - tH*0.68, 4*s, 7*s);
  }
  if (big) {                                                       /* citadel banner */
    g.strokeStyle = P.dark; g.lineWidth = Math.max(1, 2*s);
    g.beginPath(); g.moveTo(x, y - tH); g.lineTo(x, y - tH - 28*s); g.stroke();
    g.fillStyle = P.banner;
    g.beginPath(); g.moveTo(x, y - tH - 28*s); g.lineTo(x + 22*s, y - tH - 22*s); g.lineTo(x, y - tH - 16*s);
    g.closePath(); g.fill();
  }
}
function drawVillage(x, y, s, tx, ty, P, night) {
  for (let i = 0; i < 3; i++) {
    const r = tRand(tx, ty, i + 3);
    const hx = x + (i - 1) * 52 * s + (r - 0.5) * 14 * s;
    const hw = (34 + r * 8) * s, hh = (20 + r * 6) * s;
    g.fillStyle = P.stone;
    g.fillRect(hx - hw/2, y - hh, hw, hh);
    g.fillStyle = P.roof;
    g.beginPath();
    g.moveTo(hx - hw/2 - 4*s, y - hh); g.lineTo(hx, y - hh - 16*s); g.lineTo(hx + hw/2 + 4*s, y - hh);
    g.closePath(); g.fill();
    if (night) { g.fillStyle = P.window; g.fillRect(hx - 3*s, y - hh*0.6, 5*s, 6*s); }
  }
}
function drawTower(x, y, s, tx, ty, P, night) {
  const tw = 24 * s, th = 125 * s;
  g.fillStyle = P.stone;
  g.fillRect(x - tw/2, y - th, tw, th);
  g.beginPath();                                                   /* cone roof */
  g.moveTo(x - tw/2 - 5*s, y - th); g.lineTo(x, y - th - 26*s); g.lineTo(x + tw/2 + 5*s, y - th);
  g.closePath(); g.fillStyle = P.roof; g.fill();
  g.fillStyle = night ? P.window : P.dark;
  g.fillRect(x - 3.5*s, y - th * 0.8, 7*s, 10*s);
}
function drawWaste(x, y, s, tx, ty, P) {
  const r = tRand(tx, ty, 8);
  const cx = x + (r - 0.5) * 60 * s;
  g.strokeStyle = P.dead; g.lineWidth = Math.max(1, 4 * s); g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx, y); g.lineTo(cx + 4*s, y - 52*s);
  g.moveTo(cx + 2*s, y - 30*s); g.lineTo(cx - 18*s, y - 48*s);
  g.moveTo(cx + 3*s, y - 40*s); g.lineTo(cx + 20*s, y - 60*s);
  g.stroke();
  g.fillStyle = P.dead;
  for (let i = 0; i < 4; i++) {
    const sx = x + (tRand(tx, ty, i + 30) - 0.5) * 220 * s;
    g.beginPath();
    g.moveTo(sx - 5*s, y); g.lineTo(sx, y - (12 + tRand(tx,ty,i+40)*10)*s); g.lineTo(sx + 5*s, y);
    g.closePath(); g.fill();
  }
}
function drawRift(x, y, s, time, closing) {
  const open = 1 - clamp(closing || 0, 0, 1);
  const h = 190 * s * (0.4 + 0.6 * open), pw = 70 * s * open + 8 * s;
  const pulse = 0.8 + 0.2 * Math.sin(time * 3);
  const glow = g.createRadialGradient(x, y - h * 0.45, 4, x, y - h * 0.45, 200 * s * pulse + 30);
  glow.addColorStop(0, rgba([250, 160, 255], 0.85 * open + 0.1));
  glow.addColorStop(0.35, rgba([190, 60, 235], 0.5 * open));
  glow.addColorStop(1, 'rgba(110,20,150,0)');
  g.fillStyle = glow;
  g.fillRect(x - 220 * s, y - h - 120 * s, 440 * s, h + 170 * s);
  /* jagged fissure */
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
  /* rising motes */
  for (let i = 0; i < 7; i++) {
    const ph = (time * 0.35 + i / 7) % 1;
    const mx = x + Math.sin(time + i * 2.2) * 40 * s;
    g.fillStyle = rgba([240, 140, 255], (1 - ph) * 0.8 * open);
    g.beginPath(); g.arc(mx, y - ph * (h + 90 * s), (2.5 - ph * 1.5) * Math.max(s, 0.35) * 2, 0, 6.29); g.fill();
  }
}
function drawCorruptMark(x, y, s, tx, ty) {
  g.fillStyle = rgba([190, 80, 230], 0.75);
  for (let i = 0; i < 3; i++) {
    const cx = x + (tRand(tx, ty, i + 50) - 0.5) * 150 * s;
    const ch = (10 + tRand(tx, ty, i + 60) * 14) * s;
    g.beginPath();
    g.moveTo(cx - 4*s, y); g.lineTo(cx, y - ch); g.lineTo(cx + 4*s, y);
    g.closePath(); g.fill();
  }
}
/* the Abyssal horde — baleful aura, crimson rim-light, burning eyes,
   and a crooked banner so they read clearly at any distance */
function drawHorde(x, y, s, time) {
  const pulse = 0.7 + 0.3 * Math.sin(time * 4);
  /* baleful aura */
  const aura = g.createRadialGradient(x, y - 22*s, 2, x, y - 22*s, 85*s);
  aura.addColorStop(0, rgba([255, 40, 90], 0.34 * pulse));
  aura.addColorStop(0.5, rgba([190, 30, 160], 0.18 * pulse));
  aura.addColorStop(1, 'rgba(120,10,120,0)');
  g.fillStyle = aura;
  g.fillRect(x - 90*s, y - 105*s, 180*s, 125*s);
  /* scorched ground beneath them */
  g.fillStyle = rgba([60, 8, 40], 0.55);
  g.beginPath(); g.ellipse(x, y, 60*s, 8*s, 0, 0, 6.29); g.fill();
  /* crooked war-banner with a glowing sigil */
  g.strokeStyle = '#1a0a20'; g.lineWidth = Math.max(1, 3*s);
  g.beginPath(); g.moveTo(x + 26*s, y); g.lineTo(x + 30*s, y - 64*s); g.stroke();
  g.fillStyle = '#2a0d33';
  g.beginPath(); g.moveTo(x + 30*s, y - 64*s); g.lineTo(x + 52*s, y - 56*s); g.lineTo(x + 30*s, y - 46*s);
  g.closePath(); g.fill();
  g.fillStyle = rgba([255, 80, 220], 0.9 * pulse);
  g.beginPath(); g.arc(x + 37*s, y - 55*s, 3.5*s, 0, 6.29); g.fill();
  /* the horde itself — tall, spiky, rim-lit */
  for (let i = 0; i < 5; i++) {
    const hx = x + (i - 2) * 20 * s;
    const hh = (38 + (i % 3) * 9) * s;
    const sway = Math.sin(time * 3 + i * 1.3) * 2.5 * s;
    g.fillStyle = '#0a0312';
    g.beginPath();
    g.moveTo(hx - 10*s + sway, y);
    g.lineTo(hx - 5*s, y - hh * 0.7); g.lineTo(hx - 9*s, y - hh * 0.9);
    g.lineTo(hx - 2*s, y - hh * 0.85); g.lineTo(hx, y - hh);
    g.lineTo(hx + 2*s, y - hh * 0.8); g.lineTo(hx + 8*s, y - hh * 0.92);
    g.lineTo(hx + 5*s, y - hh * 0.65); g.lineTo(hx + 10*s + sway, y);
    g.closePath(); g.fill();
    g.strokeStyle = rgba([255, 60, 130], 0.55 * pulse);
    g.lineWidth = Math.max(1, 1.5*s);
    g.stroke();
    /* burning eyes: magenta glow, white-hot core */
    g.fillStyle = rgba([255, 60, 200], 0.85 * pulse);
    g.fillRect(hx - 5*s, y - hh * 0.85, 5*s, 5*s);
    g.fillRect(hx + 0.5*s, y - hh * 0.85, 5*s, 5*s);
    g.fillStyle = rgba([255, 240, 255], 0.95);
    g.fillRect(hx - 4*s, y - hh * 0.83, 2.6*s, 2.6*s);
    g.fillRect(hx + 1.5*s, y - hh * 0.83, 2.6*s, 2.6*s);
  }
}
function drawBanner(x, y, s) {
  g.strokeStyle = '#2c2a20'; g.lineWidth = Math.max(1, 2.5 * s);
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 55 * s); g.stroke();
  g.fillStyle = '#ffd24a';
  g.beginPath(); g.moveTo(x, y - 55*s); g.lineTo(x + 20*s, y - 48*s); g.lineTo(x, y - 41*s);
  g.closePath(); g.fill();
  g.fillStyle = '#1c1a14';
  g.beginPath(); g.arc(x, y - 26*s, 6*s, 0, 6.29); g.fill();   /* head */
  g.fillRect(x - 5*s, y - 22*s, 10*s, 22*s);                    /* body */
}

/* palette for one depth row: env colors fogged toward distance */
function rowPalette(env, fogT, night) {
  const f = c => rgb(colLerp(c, env.fog, fogT));
  return {
    mount: f(colLerp(env.sil, [76, 80, 108], 0.45)),
    snow:  f([225, 228, 240]),
    hill:  f(colLerp(env.sil, [86, 104, 70], 0.5)),
    down:  f(colLerp(env.sil, [120, 130, 88], 0.5)),
    tree:  f(colLerp(env.sil, [24, 66, 38], 0.65)),
    tree2: f(colLerp(env.sil, [34, 84, 48], 0.65)),
    stone: f(colLerp(env.sil, [110, 106, 124], 0.55)),
    roof:  f(colLerp(env.sil, [96, 52, 44], 0.6)),
    dark:  f(env.sil.map(c => c * 0.5)),
    dead:  f(colLerp(env.sil, [58, 44, 70], 0.6)),
    window:'#ffd98a',
    banner:'#e8b23a',
  };
}

/* ------------------------------ panorama -------------------------------- */
const MAXD = 7;
const rowScale = d => 1.5 / (d + 0.3);
const rowY = d => HORIZON + (H - HORIZON - 6) * (1.25 / (d + 0.25)) - 6;

function drawFeature(tile, x, y, s, tx, ty, P, time, night) {
  switch (tile.t) {
    case 'mountains': drawMountains(x, y, s, tx, ty, P); break;
    case 'forest':    drawForest(x, y, s, tx, ty, P); break;
    case 'hills':     drawHills(x, y, s, tx, ty, P); break;
    case 'downs':     drawDowns(x, y, s, tx, ty, P); break;
    case 'keep':      drawKeep(x, y, s, tx, ty, P, false, night); break;
    case 'citadel':   drawKeep(x, y, s, tx, ty, P, true, night); break;
    case 'village':   drawVillage(x, y, s, tx, ty, P, night); break;
    case 'tower':     drawTower(x, y, s, tx, ty, P, night); break;
    case 'wasteland': drawWaste(x, y, s, tx, ty, P); break;
    case 'rift':      drawRift(x, y, s, time, 0); break;
  }
  if (tile.corrupt && tile.t !== 'rift') drawCorruptMark(x, y, s, tx, ty);
}

function renderPanorama(lord, time) {
  const hour = 6 + (AP_PER_DAY - lord.ap) * HOUR_STEP;
  const doom = world.corruptR / 48;
  const env = envColors(hour, doom);
  const night = hour >= 20 || hour < 6;

  drawSky(env, hour, time);
  drawRiftHorizonGlow(lord, time);
  drawGroundPlane(env);

  const fwd = DIRS[lord.face], rt = DIRS[(lord.face + 2) % 8];
  let hordeNear = false;

  for (let d = MAXD; d >= 1; d--) {
    const s = rowScale(d), y = rowY(d);
    const spacing = 300 * s + 14;
    const kmax = Math.ceil((W / 2) / spacing) + 1;
    const fogT = Math.min(0.85, (d - 1) * 0.14);
    const P = rowPalette(env, fogT, night);

    const drawCell = k => {
      const tx = lord.x + fwd.dx * d + rt.dx * k;
      const ty = lord.y + fwd.dy * d + rt.dy * k;
      const x = W / 2 + k * spacing;
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
  }

  /* location text, LoM style */
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
  /* compass */
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
  const skin = [[214,178,148],[188,146,116],[160,120,94],[226,192,166]][ (r()*4)|0 ];
  const cloth = [[70,60,120],[110,50,60],[50,90,70],[100,80,40],[60,80,110]][ (r()*5)|0 ];
  const helm = r() > 0.45;
  pg.clearRect(0, 0, 72, 72);
  const bgr = pg.createLinearGradient(0, 0, 0, 72);
  bgr.addColorStop(0, '#241f3a'); bgr.addColorStop(1, '#121020');
  pg.fillStyle = bgr; pg.fillRect(0, 0, 72, 72);
  pg.fillStyle = rgb(cloth);                                  /* shoulders */
  pg.beginPath(); pg.ellipse(36, 74, 30, 22, 0, Math.PI, 0); pg.fill();
  pg.fillStyle = rgb(skin);                                   /* face */
  pg.beginPath(); pg.ellipse(36, 38, 13, 16, 0, 0, 6.29); pg.fill();
  if (helm) {
    pg.fillStyle = '#8b8fa8';
    pg.beginPath(); pg.arc(36, 34, 15, Math.PI, 0); pg.fill();
    pg.fillRect(21, 32, 30, 5);
    pg.fillRect(33, 32, 6, 14);                               /* nose guard */
  } else {
    pg.fillStyle = rgb(cloth.map(c => c * 0.6));              /* hood */
    pg.beginPath(); pg.arc(36, 33, 16, Math.PI * 0.95, Math.PI * 0.05); pg.fill();
  }
  if (r() > 0.5 && !helm) {                                   /* beard */
    pg.fillStyle = ['#5a4632','#777','#3a2e22'][ (r()*3)|0 ];
    pg.beginPath(); pg.ellipse(36, 50, 10, 7, 0, 0, Math.PI); pg.fill();
  }
  pg.fillStyle = '#1a1626';                                   /* eyes */
  pg.fillRect(29, 38, 4, 3); pg.fillRect(39, 38, 4, 3);
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
  drawPortrait(l);
  const pips = '●'.repeat(l.ap) + '○'.repeat(AP_PER_DAY - l.ap);
  $('lordInfo').innerHTML =
    `<span class="nm">${l.name}</span><br><span class="tt">${l.title}</span><br>` +
    `⚔ ${l.war} warriors &nbsp;♞ ${l.rid} riders<br>` +
    `<span style="color:#8fd0a0">${pips}</span> &nbsp;<span style="color:#6e668e">(lord ${state.active + 1}/${state.lords.filter(x=>x.alive).length})</span>`;
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
  l.face = (l.face + (dir > 0 ? 1 : 7)) % 8;
}
function tryForward() {
  const l = activeLord();
  const fwd = DIRS[l.face];
  const nx = l.x + fwd.dx, ny = l.y + fwd.dy;
  const t = tileAt(nx, ny);
  if (!t || t.t === 'mountains') {
    showModal(`<h3>No Way Through</h3>The mountains bar your path. You must find another way.`);
    return;
  }
  let cost = MOVE_COST[t.t] || 1;
  if (t.corrupt) cost += 1;
  if (l.ap < cost) {
    showModal(`<h3>Night Draws Near</h3>${l.name} is too weary to go on. Press <b>R</b> to rest until dawn.`);
    return;
  }
  /* battle bars the way */
  const en = world.enemies.find(e => e.x === nx && e.y === ny);
  if (en) {
    l.ap = Math.max(0, l.ap - 1);
    battle(stackAt(l.x, l.y), en, false, () => {
      if (!world.enemies.includes(en) && l.alive) { moveLordTo(l, nx, ny, 0); }
    });
    return;
  }
  moveLordTo(l, nx, ny, cost);
}
function moveLordTo(l, nx, ny, cost) {
  l.x = nx; l.y = ny;
  l.ap = Math.max(0, l.ap - cost);
  reveal(nx, ny, 3);
  const t = tileAt(nx, ny);

  if (t.t === 'rift') { attemptSeal(l); updateHUD(); return; }

  if (t.place) {
    const p = t.place;
    if (!p.visited) {
      p.visited = true;
      if (p.type === 'tower') {
        reveal(nx, ny, 8);
        if (p.name === 'Tower of the Seer' || p.name === 'Watchtower of Morn') {
          world.riftKnown = true;
          reveal(RIFT_X, RIFT_Y, 2);
          showModal(`<h3>${p.name}</h3><span class="arc">Visions swirl in the high chamber…</span><br>The Rift is revealed upon your map — far to the <b>east</b>, wreathed in blighted land. Only a host of <b>${SEAL_STRENGTH}</b> spears may seal it.`);
        } else {
          showModal(`<h3>${p.name}</h3>From the heights you survey the land, and your map grows.`);
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
        `<h3>${rec.name} ${rec.title} joins the host!</h3>` +
        `<span class="good">⚔ ${rec.war} warriors and ♞ ${rec.rid} riders swear their swords to the Quest.</span><br>` +
        `<i>"The Abyss shall not have these lands while we draw breath."</i><br>` +
        `<small style="color:#9d95c0">Press TAB to command each lord in turn.</small>`);
    }
  }
  updateHUD();
}
function attemptSeal(l) {
  const host = hostNearRift();
  if (host >= SEAL_STRENGTH) {
    state.endAnim = performance.now() / 1000;
    goEnd('victory',
      `With ${host | 0} spears gathered at the brink, ${l.name} casts the Word of Dawn into the deep. ` +
      `The Abyss howls — and the Rift seals shut forever.`);
  } else {
    l.war = Math.max(1, Math.round(l.war * 0.8));
    l.rid = Math.max(0, Math.round(l.rid * 0.8));
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
    const frac = clamp(0.5 * (eEff / pEff) * (0.7 + rnd() * 0.6), 0.05, 0.6);
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
  });
}
function fixActiveLord() {
  if (!activeLord().alive) {
    const idx = state.lords.findIndex(l => l.alive);
    if (idx >= 0) state.active = idx;
  }
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
  if (state.day % 3 === 0 && world.enemies.length < MAX_ENEMIES) {
    const rnd = state.rngBattle;
    for (let tries = 0; tries < 20; tries++) {
      const a = rnd() * Math.PI * 2;
      const x = Math.round(RIFT_X + Math.cos(a) * 4), y = Math.round(RIFT_Y + Math.sin(a) * 4);
      const t = tileAt(x, y);
      if (t && t.t !== 'mountains' && t.t !== 'rift' && !world.enemies.some(e => e.x === x && e.y === y)) {
        world.enemies.push({ x, y, str: Math.min(300, 100 + state.day * 3) });
        notes.push('A new horde crawls from the Rift.');
        break;
      }
    }
  }

  /* hordes prowl */
  const nightFights = [];
  for (const e of [...world.enemies]) {
    let target = null, best = 8;
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
    if (t.place && (t.place.type === 'keep' || t.place.type === 'citadel' || t.place.type === 'village') && !t.corrupt) {
      l.war += 6;
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
    queueEnd('gameover', `Ninety days have passed. The Rift yawns too wide to ever be sealed, and shadow falls upon the world.`);
  } else if (state.day === DAY_LIMIT - 9) {
    notes.push(`<span class="bad">Only ${DAY_LIMIT - state.day} days remain!</span>`);
  }

  showModal(`<h3>Night Falls — Day ${Math.min(state.day, DAY_LIMIT)}</h3>The free lords rest, and the Abyss stirs.<br>${notes.join('<br>') || 'The night passes quietly.'}`);
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

/* ============================================================== SCREENS */
function syncOverlays() {
  $('ovTitle').classList.toggle('hidden', state.screen !== 'title');
  $('ovEnd').classList.toggle('hidden', state.screen !== 'end');
  if (state.screen !== 'play') { $('ovMap').classList.add('hidden'); $('ovModal').classList.add('hidden'); }
}
function startGame() {
  newGame();
  state.screen = 'play';
  syncOverlays();
  playMusic('play');
  showModal(
    `<h3>The Quest of the Rift</h3>` +
    `<i>"Ride east, Athelorn. Rally every lord who yet stands free — Ithrilan foretold that only a host of ` +
    `<b>${SEAL_STRENGTH} spears</b>, gathered at the very brink, can seal the Abyssal Rift. ` +
    `You have <b>${DAY_LIMIT} days</b> before the corruption swallows the Citadel of Dawn."</i><br>` +
    `<small style="color:#9d95c0">Turn with ←/→, ride with ↑, rest at night with R, and consult your map with M.</small>`);
  updateHUD();
}
function goEnd(outcome, cause) {
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
function renderScoreList(scores, rank) {
  const el = $('endScores');
  if (!scores.length) { el.innerHTML = '<i>No names yet stand in the annals. Be the first!</i>'; return; }
  el.innerHTML = '<b>— THE ANNALS OF TWILIGHT —</b><br>' + scores.slice(0, 10).map((s, i) =>
    `<span class="${i === rank ? 'me' : ''}">${String(i + 1).padStart(2, ' ')}. ${s.name.padEnd(16, '·')} ${String(s.score).padStart(6, ' ')}  ${s.outcome === 'victory' ? '✦' : '✝'} day ${s.days}</span>`
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
      ? '<b>THE ANNALS:</b> ' + scores.slice(0, 5).map((s, i) => `${i + 1}. ${s.name} ${s.score}${s.outcome === 'victory' ? '✦' : ''}`).join(' &nbsp;·&nbsp; ')
      : '<i>No legends yet written — be the first.</i>';
  } catch { $('titleScores').innerHTML = ''; }
}

/* ================================================================= INPUT */
function dispatch(act) {
  if ((act === 'confirm' || act === 'cancel') && modalOpen()) { closeModal(); return; }
  switch (act) {
    case 'start':        if (state.screen === 'title') startGame(); return;
    case 'restart':      if (state.screen === 'end') startGame(); return;
    case 'toTitle':      if (state.screen === 'end') { state.screen = 'title'; syncOverlays(); loadTitleScores(); playMusic('title'); } return;
    case 'submitScore':  submitScore(); return;
    case 'toggleMusic':  setMusic(!musicOn); return;   /* works on any screen */
  }
  if (state.screen !== 'play' || modalOpen()) return;
  const mapUp = !$('ovMap').classList.contains('hidden');
  if (act === 'toggleMap') { $('ovMap').classList.toggle('hidden'); return; }
  if (mapUp) { if (act === 'cancel') $('ovMap').classList.add('hidden'); return; }
  switch (act) {
    case 'turnLeft':  turn(-1); updateHUD(); break;
    case 'turnRight': turn(1);  updateHUD(); break;
    case 'forward':   tryForward(); break;
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
  ArrowUp:'forward', w:'forward', r:'rest', m:'toggleMap', Tab:'nextLord', n:'nextLord',
  Enter:'confirm', ' ':'confirm', Escape:'cancel', f:'forward',
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
const PAD_ACTS = { 0:'confirmA', 1:'cancel', 2:'rest', 3:'toggleMap', 4:'prevLord', 5:'nextLord', 9:'confirmA', 12:'forward', 13:'rest', 14:'turnLeft', 15:'turnRight' };
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
  axisPrev = [axd, ayd];
}

/* =============================================================== MAIN LOOP */
function frame(ts) {
  const time = ts / 1000;
  pollGamepad();
  if (state.screen === 'title') renderTitle(time);
  else if (state.screen === 'play') {
    renderPanorama(activeLord(), time);
    if (!$('ovMap').classList.contains('hidden')) renderMap();
  } else if (state.screen === 'end') {
    if (state.outcome === 'victory') renderVictory(time);
    else renderGameOver(time);
  }
  requestAnimationFrame(frame);
}

/* --------------------------------- boot ---------------------------------- */
newGame();
state.screen = 'title';
syncOverlays();
loadTitleScores();
playMusic('title');
updateMusicUI();
requestAnimationFrame(frame);
