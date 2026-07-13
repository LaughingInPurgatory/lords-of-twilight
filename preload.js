/* ==========================================================================
   Preload — the only bridge between the sandboxed game and the OS.
   Exposes a tiny high-score API and a single-slot save/resume API on
   window.lotScores / window.lotSave, plus menu events and app quit.
   ========================================================================== */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lotScores', {
  get: () => ipcRenderer.invoke('scores:get'),
  add: (record) => ipcRenderer.invoke('scores:add', record),
});

contextBridge.exposeInMainWorld('lotSave', {
  get: () => ipcRenderer.invoke('save:get'),
  meta: () => ipcRenderer.invoke('save:meta'),
  write: (payload) => ipcRenderer.invoke('save:write', payload),
  clear: () => ipcRenderer.invoke('save:clear'),
  onMenuSave: (cb) => { ipcRenderer.on('menu:save', () => { try { cb(); } catch (_) {} }); },
  onMenuContinue: (cb) => { ipcRenderer.on('menu:continue', () => { try { cb(); } catch (_) {} }); },
});

/* let the pause menu's Quit button close the app entirely */
contextBridge.exposeInMainWorld('lotApp', {
  quit: () => ipcRenderer.invoke('app:quit'),
});
