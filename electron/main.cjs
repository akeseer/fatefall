/**
 * Fatefall as its own application.
 *
 * The game is a static build in `dist/`. Loading it straight from disk would
 * mean `file://`, where module scripts and the fetch that loads the DM intent
 * model both run into browser restrictions, so the built files are served
 * from a tiny HTTP server bound to the loopback interface on a free port and
 * the window is pointed at that. Nothing is reachable from outside the
 * machine: the server binds 127.0.0.1 and serves only files under `dist/`.
 *
 * ── Boot ──
 *
 * A small frameless splash comes up at once, so the first thing the player
 * sees is not a blank window. While it is up the update check runs against
 * the manifest named in package.json (`fatefall.updates`), with a short
 * timeout so a machine that is offline waits a moment and then plays. The
 * game window loads behind the splash and is shown, with the splash closed,
 * once it has painted.
 *
 * ── App only ──
 *
 * `preload.cjs` puts a `fatefall` object on the game's window with the app
 * version and the update result. The game refuses to start without it, so
 * the built files are inert in a plain browser.
 *
 * The window is the game and nothing else: no menu bar, no navigation, links
 * that would leave the game open in the system browser instead. Saves live in
 * the app's own profile, separate from any browser's.
 *
 * `FATEFALL_SHOT=<path>` takes a screenshot a few seconds after the window is
 * up and quits; it is the smoke test for the packaged app.
 */

const { app, BrowserWindow, ipcMain, shell, net } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { compareVersions, readManifest } = require('./version.cjs');

const DIST = path.join(__dirname, '..', 'dist');
const PKG = require('../package.json');

/** How long the update check may hold the splash before the game starts anyway. */
const UPDATE_TIMEOUT_MS = 6000;

/** How long the splash lingers after the check so its last line can be read. */
const SPLASH_LINGER_MS = 900;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/** Serve `dist/` on a free loopback port. Resolves with the port. */
function serve() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      if (pathname === '/') pathname = '/index.html';
      const file = path.normalize(path.join(DIST, pathname));
      if (!file.startsWith(DIST + path.sep) && file !== DIST) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

// ── Updates ──

/** Where the latest version is published, from package.json. */
function updateSource() {
  // An override for testing the check against a local manifest.
  if (process.env.FATEFALL_UPDATE_URL) return process.env.FATEFALL_UPDATE_URL;
  const cfg = (PKG.fatefall && PKG.fatefall.updates) || {};
  if (cfg.github) return `https://api.github.com/repos/${cfg.github}/releases/latest`;
  if (cfg.manifest) return cfg.manifest;
  return null;
}

/** Fetch JSON with Electron's net stack and a hard timeout. */
function fetchJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), timeoutMs);
    const request = net.request({ url, method: 'GET' });
    request.setHeader('Accept', 'application/json');
    request.setHeader('User-Agent', `Fatefall/${PKG.version}`);
    request.on('response', response => {
      const chunks = [];
      response.on('data', c => chunks.push(c));
      response.on('end', () => {
        clearTimeout(timer);
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (err) {
          reject(err);
        }
      });
      response.on('error', err => { clearTimeout(timer); reject(err); });
    });
    request.on('error', err => { clearTimeout(timer); reject(err); });
    request.end();
  });
}

/**
 * The launch check. Never throws: an offline machine, an unset source or a
 * malformed manifest all come back as 'unknown' with a reason, and the game
 * starts regardless.
 */
async function checkForUpdates() {
  const source = updateSource();
  if (!source) return { status: 'unknown', reason: 'no update source configured' };
  try {
    const manifest = readManifest(await fetchJson(source, UPDATE_TIMEOUT_MS));
    if (!manifest) return { status: 'unknown', reason: 'unreadable manifest' };
    if (compareVersions(manifest.version, PKG.version) > 0) {
      return { status: 'available', latest: manifest.version, url: manifest.url, notes: manifest.notes };
    }
    return { status: 'current', latest: manifest.version };
  } catch (err) {
    return { status: 'unknown', reason: err && err.message ? err.message : String(err) };
  }
}

// ── Windows ──

function openSplash() {
  const splash = new BrowserWindow({
    width: 420,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  splash.removeMenu();
  splash.once('ready-to-show', () => splash.show());
  const loaded = splash.loadFile(path.join(__dirname, 'splash.html'));
  const say = async (text, tone) => {
    if (splash.isDestroyed()) return;
    try {
      await loaded;
      await splash.webContents.executeJavaScript(
        `window.setStatus(${JSON.stringify(text)}, ${JSON.stringify(tone || '')}); window.setVersion(${JSON.stringify(PKG.version)});`,
      );
    } catch {
      /* the splash may already be closing */
    }
  };
  return { splash, say };
}

// The game is allowed to start its music without a click: this is an app, not
// a page that might autoplay at someone.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let updateResult = { status: 'unknown', reason: 'not checked yet' };

// The preload asks for this synchronously before the game's first script runs.
ipcMain.on('fatefall:info', event => {
  event.returnValue = { version: PKG.version, platform: process.platform, update: updateResult };
});
ipcMain.on('fatefall:open-update', () => {
  if (updateResult.url && /^https?:/.test(updateResult.url)) shell.openExternal(updateResult.url);
});

// ── The window, as the game's settings screen sees it ──
//
// Size, placement, maximised and fullscreen are remembered in the profile so
// the window opens as it was closed; the game asks for changes over IPC and is
// told about every change, whoever made it, so its setting stays truthful.

function windowStateFile() {
  return path.join(app.getPath('userData'), 'window.json');
}

function readWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

function writeWindowState(win) {
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(windowStateFile(), JSON.stringify({
      width: b.width, height: b.height, x: b.x, y: b.y,
      maximized: win.isMaximized(), fullscreen: win.isFullScreen(),
    }));
  } catch {
    /* a profile that cannot be written just forgets the window */
  }
}

function windowState(win) {
  const b = win.getBounds();
  return { fullscreen: win.isFullScreen(), maximized: win.isMaximized(), width: b.width, height: b.height };
}

ipcMain.handle('fatefall:window', (event, req) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return null;
  const op = req && typeof req === 'object' ? req.op : 'state';
  if (op === 'fullscreen') {
    win.setFullScreen(!!req.on);
  } else if (op === 'size') {
    const width = Math.max(900, Math.min(7680, Math.round(Number(req.width) || 1280)));
    const height = Math.max(680, Math.min(4320, Math.round(Number(req.height) || 880)));
    if (win.isFullScreen()) win.setFullScreen(false);
    if (win.isMaximized()) win.unmaximize();
    win.setSize(width, height);
    win.center();
  } else if (op === 'maximize') {
    if (win.isFullScreen()) win.setFullScreen(false);
    win.maximize();
  }
  return windowState(win);
});

async function start() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('Fatefall: no build found in dist/. Run `npm run build` first.');
    app.quit();
    return;
  }

  const { splash, say } = openSplash();
  void say('Starting…');

  const [port] = await Promise.all([
    serve(),
    (async () => {
      void say('Checking for updates…');
      updateResult = await checkForUpdates();
      if (updateResult.status === 'available') {
        void say(`Update ${updateResult.latest} is available. Opening the game…`, 'warn');
      } else if (updateResult.status === 'current') {
        void say('You have the latest version.', 'good');
      } else {
        void say('Could not check for updates. Opening the game…', 'warn');
      }
      await new Promise(r => setTimeout(r, SPLASH_LINGER_MS));
    })(),
  ]);

  const remembered = readWindowState();
  const win = new BrowserWindow({
    width: Number(remembered.width) >= 900 ? Math.round(remembered.width) : 1280,
    height: Number(remembered.height) >= 680 ? Math.round(remembered.height) : 880,
    ...(Number.isFinite(remembered.x) && Number.isFinite(remembered.y) ? { x: Math.round(remembered.x), y: Math.round(remembered.y) } : {}),
    fullscreen: !!remembered.fullscreen,
    minWidth: 900,
    minHeight: 680,
    backgroundColor: '#0a0a0a',
    title: 'Fatefall',
    // The packaged app carries the icon in its executable; this is for `npm run app`.
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  if (remembered.maximized && !remembered.fullscreen) win.maximize();

  // Every change to the window is remembered and reported to the game.
  let stateTimer = null;
  const noteState = () => {
    if (win.isDestroyed()) return;
    if (stateTimer) clearTimeout(stateTimer);
    stateTimer = setTimeout(() => { stateTimer = null; if (!win.isDestroyed()) writeWindowState(win); }, 400);
    try { win.webContents.send('fatefall:window-state', windowState(win)); } catch { /* closing */ }
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, noteState);
  win.on('close', () => { if (stateTimer) clearTimeout(stateTimer); writeWindowState(win); });

  // Anything that tries to open a new window goes to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // And the window itself never leaves the game.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}/`)) event.preventDefault();
  });

  win.once('ready-to-show', async () => {
    // In screenshot mode the splash is captured before it goes, so the boot
    // screen is checked along with the game.
    const shot = process.env.FATEFALL_SHOT;
    if (shot && !splash.isDestroyed()) {
      try {
        const image = await splash.webContents.capturePage();
        fs.writeFileSync(shot.replace(/\.png$/i, '') + '.splash.png', image.toPNG());
      } catch {
        /* the splash is optional evidence */
      }
    }
    win.show();
    if (!splash.isDestroyed()) splash.close();
  });
  await win.loadURL(`http://127.0.0.1:${port}/`);

  const shot = process.env.FATEFALL_SHOT;
  if (shot) {
    setTimeout(async () => {
      try {
        const image = await win.webContents.capturePage();
        fs.writeFileSync(shot, image.toPNG());
        console.log(`Fatefall: screenshot written to ${shot}`);
      } catch (err) {
        console.error('Fatefall: screenshot failed', err);
      }
      app.quit();
    }, 4000);
  }
}

app.whenReady().then(start);
app.on('window-all-closed', () => app.quit());
