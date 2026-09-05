/**
 * Version arithmetic for the update check, kept apart from the Electron
 * entry so it can be tested without a window.
 */

/** "v1.2.3-beta" -> [1, 2, 3]; anything unparseable -> null. */
function parseVersion(text) {
  if (typeof text !== 'string') return null;
  const m = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(text);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
}

/** Negative when a < b, positive when a > b, zero when equal or unparseable. */
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * Read an update manifest into one shape. Two forms are understood:
 * the app's own `{ version, url, notes }`, and a GitHub release
 * (`tag_name`, `html_url`, `body`, `assets[]`).
 */
function readManifest(json) {
  if (!json || typeof json !== 'object') return null;
  if (typeof json.tag_name === 'string') {
    const asset = Array.isArray(json.assets) ? json.assets.find(a => /\.exe$/i.test(a.name || '')) : null;
    return {
      version: json.tag_name.replace(/^v/, ''),
      url: (asset && asset.browser_download_url) || json.html_url || null,
      notes: typeof json.body === 'string' ? json.body : '',
    };
  }
  if (typeof json.version === 'string') {
    return { version: json.version.replace(/^v/, ''), url: json.url || null, notes: json.notes || '' };
  }
  return null;
}

module.exports = { parseVersion, compareVersions, readManifest };
