/* ==========================================================================
   Preload — the only bridge between the sandboxed game and the OS.
   Exposes a tiny, read/append-only high-score API on window.lotScores.
   ========================================================================== */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lotScores', {
  get: () => ipcRenderer.invoke('scores:get'),
  add: (record) => ipcRenderer.invoke('scores:add', record),
});

/* let the pause menu's Quit button close the app entirely */
contextBridge.exposeInMainWorld('lotApp', {
  quit: () => ipcRenderer.invoke('app:quit'),
});
