/* ==========================================================================
   make-icon.js — generates build/icon.png (1024x1024) with pure Node.
   No dependencies: a tiny PNG encoder + procedural "Abyssal Rift" artwork.
   electron-builder converts this PNG into .icns / .ico at package time.
       node scripts/make-icon.js
   ========================================================================== */
'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const S = 1024;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/* ---- scene geometry ---------------------------------------------------- */
const CX = S / 2, CY = S / 2;
// the jagged rift, a lightning-like bolt down the middle
const BOLT = [
  [512, 150], [470, 320], [556, 452], [496, 556],
  [566, 690], [478, 812], [520, 900],
];
function distToBolt(x, y) {
  let best = 1e9;
  for (let i = 0; i < BOLT.length - 1; i++) {
    const [x1, y1] = BOLT[i], [x2, y2] = BOLT[i + 1];
    const dx = x2 - x1, dy = y2 - y1;
    const t = clamp(((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy), 0, 1);
    const px = x1 + dx * t, py = y1 + dy * t;
    best = Math.min(best, Math.hypot(x - px, y - py));
  }
  return best;
}
// a few fixed stars
const STARS = [[210, 240], [300, 170], [820, 210], [760, 330], [880, 470], [180, 640], [860, 760], [260, 830]];

/* ---- render ------------------------------------------------------------ */
const raw = Buffer.alloc(S * (1 + S * 4));
for (let y = 0; y < S; y++) {
  raw[y * (1 + S * 4)] = 0; // filter byte
  for (let x = 0; x < S; x++) {
    const pr = Math.hypot(x - CX, y - CY);
    const rn = clamp(pr / (S * 0.52), 0, 1);

    // dark radial background, twilight purple fading to near-black
    let r = lerp(30, 6, Math.pow(rn, 1.1));
    let gg = lerp(24, 5, Math.pow(rn, 1.1));
    let b = lerp(50, 12, Math.pow(rn, 1.1));

    // faint stars
    for (const [sx, sy] of STARS) {
      const sd = Math.hypot(x - sx, y - sy);
      if (sd < 3.2) { const a = 1 - sd / 3.2; r = lerp(r, 235, a); gg = lerp(gg, 236, a); b = lerp(b, 255, a); }
    }

    // the rift glow (additive)
    const d = distToBolt(x, y);
    const halo = Math.exp(-d / 130) * 0.9;   // wide magenta aura
    const core = Math.exp(-d / 16);          // bright white-hot core
    r = clamp(r + halo * 210 + core * 255, 0, 255);
    gg = clamp(gg + halo * 60 + core * 235, 0, 255);
    b = clamp(b + halo * 235 + core * 255, 0, 255);

    // gold double ring border
    for (const [R, w] of [[476, 9], [452, 5]]) {
      const rd = Math.abs(pr - R);
      if (rd < w) {
        const a = (1 - rd / w) * 0.95;
        r = lerp(r, 236, a); gg = lerp(gg, 196, a); b = lerp(b, 92, a);
      }
    }

    const o = y * (1 + S * 4) + 1 + x * 4;
    raw[o] = r | 0; raw[o + 1] = gg | 0; raw[o + 2] = b | 0; raw[o + 3] = 255;
  }
}

/* ---- PNG encode -------------------------------------------------------- */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return buf => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
})();
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, 'ascii');
  const body = Buffer.concat([tb, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body), 0);
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('wrote', out, (png.length / 1024).toFixed(1) + ' KB');
