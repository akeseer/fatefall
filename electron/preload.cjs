/**
 * The bridge between the app and the game.
 *
 * The game refuses to start in a plain browser; what tells it that it is
 * inside Fatefall the application is this object, put on `window` before any
 * of the game's own code runs. It carries the app's version and the result of
 * the launch update check, so the game can mention an update in its log, and
 * nothing else: the renderer stays sandboxed with no Node access.
 */

const { contextBridge, ipcRenderer } = require('electron');

const info = ipcRenderer.sendSync('fatefall:info');

contextBridge.exposeInMainWorld('fatefall', {
  app: true,
  version: info.version,
  platform: info.platform,
  /** { status: 'current' | 'available' | 'unknown', latest?, url?, notes? } */
  update: info.update,
  /** Open the download page for an available update in the system browser. */
  openUpdate: () => ipcRenderer.send('fatefall:open-update'),
  /**
   * The window, for the settings screen: `set` asks for fullscreen, a size or
   * maximised and resolves to the resulting state; `onState` reports every
   * change, including ones the player makes with the window's own controls.
   */
  window: {
    set: (req) => ipcRenderer.invoke('fatefall:window', req),
    onState: (cb) => { ipcRenderer.on('fatefall:window-state', (_event, state) => cb(state)); },
  },
});
