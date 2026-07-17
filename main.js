/* ==========================================================================
   LORDS OF TWILIGHT — Electron main process
   --------------------------------------------------------------------------
   No HTTP server. The game (renderer/index.html + game.js + bundled .mp3s)
   is loaded straight into the window over file://. Outside the app bundle
   the process only ever touches two plain-text files in the per-user data
   dir: highscores.txt and savegame.json (via the contextBridge APIs in
   preload.js).
   ========================================================================== */
'use strict';

const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const SMOKE = process.env.LOT_SMOKE === '1';   // headless self-test, quits after load
const QUIT_TEST = process.env.LOT_QUIT_TEST === '1'; // boot then quitApp — proves clean exit
const IS_MAC = process.platform === 'darwin';
const SCORE_FILE = () => path.join(app.getPath('userData'), 'highscores.txt');
const SAVE_FILE = () => path.join(app.getPath('userData'), 'savegame.json');
const TOP_N = 10;
const MAX_SAVE_BYTES = 2 * 1024 * 1024; // 2 MiB hard cap
/* save schema: v3 = 120×88 map (current). Older payloads are rejected. */
const SAVE_OK = (v) => v === 1 || v === 2 || v === 3;
let win = null;
let quitting = false;
let hardExitTimer = null;

/* Always tear the process down — macOS must not keep a dock-only zombie. */
function scheduleHardExit(ms) {
  if (hardExitTimer != null) return;
  hardExitTimer = setTimeout(() => {
    try { app.exit(0); } catch { /* fall through */ }
    try { process.exit(0); } catch { /* ignore */ }
  }, ms == null ? 350 : ms);
}

function destroyAllWindows() {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        w.removeAllListeners('close');
        w.removeAllListeners('closed');
        if (!w.isDestroyed()) {
          try {
            /* stop renderer work before destroy (WebGL / Audio can hang quit) */
            if (!w.webContents.isDestroyed()) {
              w.webContents.removeAllListeners();
              try { w.webContents.closeDevTools(); } catch { /* ignore */ }
            }
          } catch { /* ignore */ }
          w.destroy();
        }
      } catch { /* already gone */ }
    }
  } catch { /* ignore */ }
  win = null;
}

/* force a full process exit — games shouldn't linger in the dock after Quit */
function quitApp() {
  if (quitting) {
    /* re-entry (e.g. window-all-closed after before-quit) — still force exit */
    scheduleHardExit(200);
    return;
  }
  quitting = true;
  /* macOS: hide dock icon immediately so a slow hard-exit doesn't look "stuck" */
  if (IS_MAC) {
    try { if (app.dock) app.dock.hide(); } catch { /* ignore */ }
  }
  destroyAllWindows();
  try { app.quit(); } catch { /* ignore */ }
  /* hard stop if audio/WebGL/IPC keeps the event loop alive (common on macOS) */
  scheduleHardExit(350);
}

/* ---------------------- plain-text high-score DB ------------------------
   one record per line:  score|name|days|outcome|iso-date
   File is rewritten to the top N on every add (never grows unbounded).   */
function cleanName(raw) {
  return String(raw || 'WANDERER')
    .replace(/[^\x20-\x7E]/g, '')   // printable ASCII only
    .replace(/[|\\<>&]/g, '')       // keep the flat file + HTML sinks safe
    .trim().slice(0, 16) || 'WANDERER';
}
function loadScores() {
  let text = '';
  try { text = fs.readFileSync(SCORE_FILE(), 'utf8'); } catch { return []; }
  const scores = [];
  for (const line of text.split('\n')) {
    const p = line.split('|');
    if (p.length < 5) continue;
    const score = parseInt(p[0], 10);
    if (!Number.isFinite(score)) continue;
    scores.push({
      score: Math.max(0, Math.min(9999999, score)),
      name: cleanName(p[1]),
      days: Math.max(0, Math.min(999, parseInt(p[2], 10) || 0)),
      outcome: p[3] === 'victory' ? 'victory' : 'defeat',
      date: String(p[4] || '').slice(0, 40),
    });
  }
  scores.sort((a, b) => b.score - a.score || (a.date < b.date ? 1 : -1));
  return scores;
}
function sanitize(body) {
  const name = cleanName(body && body.name);
  const score = Math.max(0, Math.min(9999999, Math.floor(Number(body && body.score) || 0)));
  const days = Math.max(0, Math.min(999, Math.floor(Number(body && body.days) || 0)));
  const outcome = body && body.outcome === 'victory' ? 'victory' : 'defeat';
  return { name, score, days, outcome, date: new Date().toISOString() };
}
function writeScores(scores) {
  const lines = scores.map(s => `${s.score}|${s.name}|${s.days}|${s.outcome}|${s.date}`).join('\n');
  fs.writeFileSync(SCORE_FILE(), lines ? lines + '\n' : '', 'utf8');
}
function addScore(body) {
  const rec = sanitize(body);
  const all = loadScores();
  all.push(rec);
  all.sort((a, b) => b.score - a.score || (a.date < b.date ? 1 : -1));
  const top = all.slice(0, TOP_N);
  writeScores(top);
  const rank = top.findIndex(s => s.date === rec.date && s.name === rec.name && s.score === rec.score);
  return { scores: top, rank };
}

/* --------------------------- save / resume ------------------------------
   One quest slot. The renderer owns the schema; main only stores JSON and
   returns a lightweight meta view for the title-screen Continue button.  */
function readSaveRaw() {
  try {
    const text = fs.readFileSync(SAVE_FILE(), 'utf8');
    if (!text || text.length > MAX_SAVE_BYTES) return null;
    const data = JSON.parse(text);
    if (!data || !SAVE_OK(data.v) || !data.world || !data.state) return null;
    return data;
  } catch {
    return null;
  }
}
function writeSave(payload) {
  if (!payload || typeof payload !== 'object' || !SAVE_OK(payload.v)) {
    return { ok: false, error: 'invalid save payload' };
  }
  const json = JSON.stringify(payload);
  if (json.length > MAX_SAVE_BYTES) return { ok: false, error: 'save too large' };
  fs.writeFileSync(SAVE_FILE(), json, 'utf8');
  return { ok: true, savedAt: payload.savedAt || null };
}
function clearSave() {
  try { fs.unlinkSync(SAVE_FILE()); } catch { /* no slot */ }
  return { ok: true };
}
function saveMeta() {
  const data = readSaveRaw();
  if (!data) return { exists: false };
  const lords = (data.state && data.state.lords) || [];
  const alive = lords.filter(l => l && l.alive).length;
  return {
    exists: true,
    savedAt: data.savedAt || null,
    day: (data.state && data.state.day) || 1,
    lords: alive || lords.length || 1,
    host: data.meta && data.meta.host != null ? data.meta.host : null,
  };
}

ipcMain.handle('scores:get', () => ({ scores: loadScores().slice(0, TOP_N) }));
ipcMain.handle('scores:add', (_e, body) => {
  try { return addScore(body); }
  catch (err) { console.error('score write failed:', err.message); return { scores: loadScores().slice(0, TOP_N), rank: -1 }; }
});
ipcMain.handle('save:get', () => {
  try { return { ok: true, data: readSaveRaw() }; }
  catch (err) { return { ok: false, data: null, error: err.message }; }
});
ipcMain.handle('save:meta', () => {
  try { return saveMeta(); }
  catch { return { exists: false }; }
});
ipcMain.handle('save:write', (_e, payload) => {
  try { return writeSave(payload); }
  catch (err) { console.error('save write failed:', err.message); return { ok: false, error: err.message }; }
});
ipcMain.handle('save:clear', () => {
  try { return clearSave(); }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('app:quit', () => { quitApp(); return { ok: true }; });

/* ------------------------------- window --------------------------------- */
function buildMenu() {
  /*
   * In-game pause owns Save / Continue — no full Edit/View menu.
   * On macOS we still need a minimal app menu so Cmd+Q / dock Quit / About
   * work natively; without it, Quit accelerators can vanish and the process
   * is easier to leave half-alive.
   */
  if (IS_MAC) {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: app.name || 'Lords of Twilight',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          {
            label: 'Quit',
            accelerator: 'Command+Q',
            click: () => { quitApp(); },
          },
        ],
      },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 764,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: '#0b0a12',
    show: false,
    title: 'Lords of Twilight',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => { if (!SMOKE && !QUIT_TEST) win.show(); });
  win.on('close', (e) => {
    if (quitting) return;
    /* red traffic-light / Cmd+W: full quit for a single-window game (incl. macOS) */
    e.preventDefault();
    quitApp();
  });
  win.on('closed', () => {
    win = null;
    /* belt-and-braces: if something closed the window without quitApp */
    if (!quitting) quitApp();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // only allow http(s) links out of the app
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (SMOKE || QUIT_TEST) {
    win.webContents.once('did-finish-load', async () => {
      if (QUIT_TEST && !SMOKE) {
        try {
          await win.webContents.executeJavaScript(`(async () => {
            for (let i = 0; i < 80; i++) {
              if (typeof genWorld === 'function') return true;
              await new Promise(r => setTimeout(r, 50));
            }
            return false;
          })()`);
          console.log('LOT_QUIT_TEST_OK');
          /* same path as pause → Quit: renderer cleanup + lotApp.quit → quitApp */
          try {
            await win.webContents.executeJavaScript(`
              (async () => {
                if (typeof shutdownRenderer === 'function') shutdownRenderer();
                if (window.lotApp && window.lotApp.quit) await window.lotApp.quit();
              })()
            `);
          } catch {
            quitApp();
          }
          scheduleHardExit(500);
        } catch (err) {
          console.error('LOT_QUIT_TEST_FAIL', err && err.message ? err.message : err);
          quitApp();
        }
        return;
      }
      try {
        /* boot.js is async — wait for game.js globals before asserting */
        const ready = await win.webContents.executeJavaScript(`(async () => {
          for (let i = 0; i < 80; i++) {
            if (typeof genWorld === 'function' && typeof serializeGame === 'function') return true;
            await new Promise(r => setTimeout(r, 50));
          }
          return false;
        })()`);
        if (!ready) {
          console.error('LOT_SMOKE_FAIL', JSON.stringify({ ok: false, reason: 'boot timeout' }));
          app.exit(1);
          return;
        }
        const report = await win.webContents.executeJavaScript(`(async () => {
          genWorld(20260707);
          const places = world.places.length;
          const reachRift = world.tiles[RIFT_Y * MAPW + RIFT_X].t === 'rift';
          newGame();
          state.screen = 'play';
          dispatch('turnRight');
          dispatch('forward');
          const lord = activeLord();
          const snap = serializeGame();
          if (!snap) return { ok: false, reason: 'serialize' };
          const wrote = await persistSave(snap);
          if (!wrote || !wrote.ok) return { ok: false, reason: 'write', wrote };
          /* mutate then restore */
          const dayBefore = state.day;
          state.day = 99;
          const ok = await applySaveData(snap);
          return {
            ok: !!ok && state.day === dayBefore,
            places,
            reachRift,
            apOk: !!lord && lord.ap >= 0 && lord.ap <= AP_PER_DAY,
            name: lord && lord.name,
            screen: state.screen,
            day: state.day,
          };
        })()`);
        if (!report || !report.ok || report.places < 10 || !report.reachRift || report.screen !== 'play') {
          console.error('LOT_SMOKE_FAIL', JSON.stringify(report));
          app.exit(1);
          return;
        }
        console.log('LOT_SMOKE_OK scores=' + SCORE_FILE() + ' places=' + report.places + ' save=ok');
      } catch (err) {
        console.error('LOT_SMOKE_FAIL', err && err.message ? err.message : err);
        app.exit(1);
        return;
      }
      setTimeout(() => quitApp(), 100);
    });
  }
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  /* macOS dock click — only recreate if user didn't already quit */
  app.on('activate', () => {
    if (quitting) return;
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/* Last window closed → leave the process (do NOT keep alive on macOS). */
app.on('window-all-closed', () => {
  if (!quitting) quitApp();
  else scheduleHardExit(200);
});

/*
 * Cmd+Q / dock Quit / app.quit() — do not cancel quit; tear windows down and
 * schedule a hard exit so WebGL/audio cannot leave a dock-only zombie.
 * (Previously we preventDefault + re-entered quitApp, which could race.)
 */
app.on('before-quit', () => {
  quitting = true;
  if (IS_MAC) {
    try { if (app.dock) app.dock.hide(); } catch { /* ignore */ }
  }
  destroyAllWindows();
  scheduleHardExit(350);
});

app.on('will-quit', () => {
  scheduleHardExit(150);
});
