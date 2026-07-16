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
const SCORE_FILE = () => path.join(app.getPath('userData'), 'highscores.txt');
const SAVE_FILE = () => path.join(app.getPath('userData'), 'savegame.json');
const TOP_N = 10;
const MAX_SAVE_BYTES = 2 * 1024 * 1024; // 2 MiB hard cap
let win = null;
let quitting = false;

/* force a full process exit — games shouldn't linger in the dock after Quit */
function quitApp() {
  if (quitting) return;
  quitting = true;
  try {
    if (win && !win.isDestroyed()) {
      win.removeAllListeners('close');
      win.destroy();
    }
  } catch { /* already gone */ }
  win = null;
  app.quit();
  /* hard stop if something (audio/ipc) keeps the event loop alive */
  setTimeout(() => { try { app.exit(0); } catch { process.exit(0); } }, 400);
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
    if (!data || data.v !== 1 || !data.world || !data.state) return null;
    return data;
  } catch {
    return null;
  }
}
function writeSave(payload) {
  if (!payload || typeof payload !== 'object' || payload.v !== 1) {
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
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Game',
      submenu: [
        {
          label: 'Save Quest',
          accelerator: 'CmdOrCtrl+S',
          click: () => win && win.webContents.send('menu:save'),
        },
        {
          label: 'Continue Quest',
          accelerator: 'CmdOrCtrl+O',
          click: () => win && win.webContents.send('menu:continue'),
        },
        { type: 'separator' },
        { label: 'New Realm (reload)', accelerator: 'CmdOrCtrl+R', click: () => win && win.reload() },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [{ label: 'Project on GitHub', click: () => shell.openExternal('https://github.com/LaughingInPurgatory/lords-of-twilight') }],
    },
  ]));
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
    icon: process.platform === 'linux' ? path.join(__dirname, 'build', 'icon.png') : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => { if (!SMOKE) win.show(); });
  win.on('close', (e) => {
    if (quitting) return;
    /* red traffic-light / Cmd+W: full quit for a single-window game */
    e.preventDefault();
    quitApp();
  });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // only allow http(s) links out of the app (Help → GitHub, etc.)
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (SMOKE) {
    win.webContents.once('did-finish-load', async () => {
      try {
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
  app.on('activate', () => {
    if (quitting) return;
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => { quitApp(); });
app.on('before-quit', () => { quitting = true; });
