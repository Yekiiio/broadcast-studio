'use strict';
const { app, BrowserWindow, shell, Menu, globalShortcut } = require('electron');
const path = require('path');
const { createServer } = require('./src/server');
const { OVERLAY_IDS } = require('./src/state');

if (!app.requestSingleInstanceLock()) app.quit();

let win;
let srv;


/** Raccourcis clavier globaux (actifs même pendant le jeu). */
function registerHotkeys() {
  const reg = (acc, fn) => { try { globalShortcut.register(acc, () => { try { fn(); } catch (_) { /* ignore */ } }); } catch (_) { /* raccourci déjà pris */ } };
  const act = (name, args) => srv.engine.action(name, args);
  OVERLAY_IDS.forEach((id, i) => reg(`CommandOrControl+Alt+${(i + 1) % 10}`, () => act('toggleOverlay', { id })));
  reg('CommandOrControl+Alt+Left', () => act('matchAdjust', { side: 'blue', delta: 1 }));
  reg('CommandOrControl+Alt+Right', () => act('matchAdjust', { side: 'red', delta: 1 }));
  reg('CommandOrControl+Alt+H', () => act('allVisibility', { value: false }));
  reg('CommandOrControl+Alt+S', () => act('allVisibility', { value: true }));
  reg('CommandOrControl+Alt+T', () => act('draftTimer', { run: true }));
  reg('CommandOrControl+Alt+Z', () => act('draftUndo', {}));
}

async function boot() {
  srv = await createServer({ dataDir: app.getPath('userData'), port: 3777 });
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0d1117',
    title: 'Broadcast Studio',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.loadURL(`http://127.0.0.1:${srv.port}/control/`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => (win = null));
  registerHotkeys();
}

app.whenReady().then(boot);
app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (srv) srv.close(); app.quit(); });
