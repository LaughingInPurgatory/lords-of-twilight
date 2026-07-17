/* ==========================================================================
   make-icon.js — build/icon.png for electron-builder (.icns / .ico at pack).

   Source: icon.jpg at repo root (1024×1024 art, often exported on a
   checkerboard). We key the greyscale checker fringe onto the game’s
   deep-twilight background so the dock / installer icon looks solid.

       npm run icon
       node scripts/make-icon.js [path/to/source.jpg]
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'icon.jpg');
const OUT = path.join(ROOT, 'build', 'icon.png');

/* window chrome / brand void */
const BR = 0x0b, BG = 0x0a, BB = 0x12;

function loadRGBAFromImage(srcPath) {
  if (!fs.existsSync(srcPath)) {
    throw new Error('icon source not found: ' + srcPath);
  }
  const tmp = path.join(require('os').tmpdir(), 'lot-icon-src.png');
  execFileSync('sips', ['-s', 'format', 'png', srcPath, '--out', tmp], { stdio: 'ignore' });
  const buf = fs.readFileSync(tmp);
  let off = 8, w, h, color, idat = Buffer.alloc(0);
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); off += 4;
    const type = buf.toString('ascii', off, off + 4); off += 4;
    const data = buf.subarray(off, off + len); off += len + 4;
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      color = data[9];
    } else if (type === 'IDAT') {
      idat = Buffer.concat([idat, data]);
    } else if (type === 'IEND') break;
  }
  const bpp = color === 6 ? 4 : color === 2 ? 3 : 0;
  if (!bpp) throw new Error('unsupported PNG color type ' + color);
  const inflated = zlib.inflateSync(idat);
  const stride = 1 + w * bpp;
  const recon = Buffer.alloc(w * h * bpp);
  for (let y = 0; y < h; y++) {
    const ft = inflated[y * stride];
    const row = inflated.subarray(y * stride + 1, y * stride + 1 + w * bpp);
    const out = recon.subarray(y * w * bpp, (y + 1) * w * bpp);
    const prev = y > 0 ? recon.subarray((y - 1) * w * bpp, y * w * bpp) : null;
    for (let i = 0; i < w * bpp; i++) {
      const left = i >= bpp ? out[i - bpp] : 0;
      const up = prev ? prev[i] : 0;
      const upLeft = prev && i >= bpp ? prev[i - bpp] : 0;
      let val = row[i];
      if (ft === 1) val = (val + left) & 255;
      else if (ft === 2) val = (val + up) & 255;
      else if (ft === 3) val = (val + ((left + up) >> 1)) & 255;
      else if (ft === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        val = (val + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 255;
      } else if (ft !== 0) {
        throw new Error('PNG filter ' + ft);
      }
      out[i] = val;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = recon[i * bpp];
    rgba[i * 4 + 1] = recon[i * bpp + 1];
    rgba[i * 4 + 2] = recon[i * bpp + 2];
    rgba[i * 4 + 3] = 255;
  }
  return { w, h, rgba };
}

function keyCheckerboard(img) {
  const { w, h, rgba } = img;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2 + 8;
  const R_ART = Math.min(w, h) * 0.466;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      const avg = (r + g + b) / 3;
      const dist = Math.hypot(x - cx, y - cy);
      const isChroma = sat >= 28;
      const isChecker = sat < 22 && (avg <= 38 || avg >= 218);
      const isMush = sat < 14 && avg > 38 && avg < 218;

      let replace = false;
      if (dist > R_ART + 40) {
        if (!isChroma || (avg > 240 && sat < 45)) replace = true;
        else if (isChecker || isMush) replace = true;
      } else if (dist > R_ART) {
        if (isChecker || (isMush && avg > 180)) replace = true;
        if (!isChroma && avg >= 210) replace = true;
        if (!isChroma && avg <= 25) replace = true;
      }
      /* protect title lettering under the medallion */
      if (replace && y > h * 0.76 && y < h * 0.97 && x > w * 0.09 && x < w * 0.92 && sat > 18) {
        replace = false;
      }
      if (replace) {
        rgba[o] = BR; rgba[o + 1] = BG; rgba[o + 2] = BB;
        n++;
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (rgba[o] === BR && rgba[o + 1] === BG && rgba[o + 2] === BB) continue;
      const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      const avg = (r + g + b) / 3;
      const dist = Math.hypot(x - cx, y - cy);
      if (sat < 18 && avg >= 225 && dist > R_ART * 0.84) {
        rgba[o] = BR; rgba[o + 1] = BG; rgba[o + 2] = BB;
        n++;
      }
    }
  }
  return n;
}

function writePNG(file, w, h, rgba) {
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return (buf) => {
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
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png);
  return png.length;
}

const img = loadRGBAFromImage(SRC);
const keyed = keyCheckerboard(img);
const bytes = writePNG(OUT, img.w, img.h, img.rgba);
console.log(
  'wrote', OUT,
  (bytes / 1024).toFixed(1) + ' KB',
  '(' + img.w + '×' + img.h + ', keyed ' + keyed + ' bg px from', path.basename(SRC) + ')'
);
