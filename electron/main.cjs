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
 * The window is the game and nothing else: no menu bar, no navigation, links
 * that would leave the game open in the system browser instead. Saves live in
 * the app's own profile, separate from any browser's.
 *
 * `FATEFALL_SHOT=<path>` takes a screenshot a few seconds after the window is
 * up and quits; it is the smoke test for the packaged app.
 */

const { app, BrowserWindow, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DIST = path.join(__dirname, '..', 'dist');

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

// The game is allowed to start its music without a click: this is an app, not
// a page that might autoplay at someone.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

async function start() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('Fatefall: no build found in dist/. Run `npm run build` first.');
    app.quit();
    return;
  }
  const port = await serve();

  const win = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 900,
    minHeight: 680,
    backgroundColor: '#0a0a0a',
    title: 'Fatefall',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());

  // Anything that tries to open a new window goes to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // And the window itself never leaves the game.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}/`)) event.preventDefault();
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
