/* ==========================================================================
   LORDS OF TWILIGHT — Electron main process
   --------------------------------------------------------------------------
   No HTTP server. The game (renderer/index.html + game.js + bundled .mp3s)
   is loaded straight into the window over file://. The ONLY thing that ever
   touches the outside world is the plain-text high-score database, kept in
   the per-user data dir and reached from the game via a contextBridge API
   (see preload.js).
   ========================================================================== */
'use strict';

const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const SMOKE = process.env.LOT_SMOKE === '1';   // headless self-test, quits after load
const SCORE_FILE = () => path.join(app.getPath('userData'), 'highscores.txt');
const TOP_N = 10;
let win = null;

/* ---------------------- plain-text high-score DB ------------------------
   one record per line:  score|name|days|outcome|iso-date                  */
function loadScores() {
  let text = '';
  try { text = fs.readFileSync(SCORE_FILE(), 'utf8'); } catch { return []; }
  const scores = [];
  for (const line of text.split('\n')) {
    const p = line.split('|');
    if (p.length < 5) continue;
    const score = parseInt(p[0], 10);
    if (!Number.isFinite(score)) continue;
    scores.push({ score, name: p[1], days: parseInt(p[2], 10) || 0, outcome: p[3] === 'victory' ? 'victory' : 'defeat', date: p[4] });
  }
  scores.sort((a, b) => b.score - a.score);
  return scores;
}
function sanitize(body) {
  const name = String((body && body.name) || 'WANDERER')
    .replace(/[^\x20-\x7E]/g, '')   // printable ASCII only
    .replace(/[|\\]/g, '')          // keep the flat file intact
    .trim().slice(0, 16) || 'WANDERER';
  const score = Math.max(0, Math.min(9999999, Math.floor(Number(body && body.score) || 0)));
  const days = Math.max(0, Math.min(999, Math.floor(Number(body && body.days) || 0)));
  const outcome = body && body.outcome === 'victory' ? 'victory' : 'defeat';
  return { name, score, days, outcome, date: new Date().toISOString() };
}
function addScore(body) {
  const rec = sanitize(body);
  fs.appendFileSync(SCORE_FILE(), `${rec.score}|${rec.name}|${rec.days}|${rec.outcome}|${rec.date}\n`, 'utf8');
  const top = loadScores().slice(0, TOP_N);
  const rank = top.findIndex(s => s.date === rec.date && s.name === rec.name && s.score === rec.score);
  return { scores: top, rank };
}

ipcMain.handle('scores:get', () => ({ scores: loadScores().slice(0, TOP_N) }));
ipcMain.handle('scores:add', (_e, body) => {
  try { return addScore(body); }
  catch (err) { console.error('score write failed:', err.message); return { scores: loadScores().slice(0, TOP_N), rank: -1 }; }
});
ipcMain.handle('app:quit', () => app.quit());

/* ------------------------------- window --------------------------------- */
function buildMenu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Game',
      submenu: [
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
      submenu: [{ label: 'Project on GitHub', click: () => shell.openExternal('https://github.com/schtufbox/lords-of-twilight') }],
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
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  if (SMOKE) {
    win.webContents.once('did-finish-load', () => {
      console.log('LOT_SMOKE_OK scores=' + SCORE_FILE());
      setTimeout(() => app.quit(), 250);
    });
  }
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
