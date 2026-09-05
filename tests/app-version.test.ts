import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseVersion, compareVersions, readManifest } = require('../electron/version.cjs') as {
  parseVersion: (s: unknown) => number[] | null;
  compareVersions: (a: string, b: string) => number;
  readManifest: (j: unknown) => { version: string; url: string | null; notes: string } | null;
};

/** The desktop shell's update check, minus the network. */
describe('app versions', () => {
  it('parses tags with and without a v, padding missing parts', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('v2.0')).toEqual([2, 0, 0]);
    expect(parseVersion('3')).toEqual([3, 0, 0]);
    expect(parseVersion('1.4.0-beta.2')).toEqual([1, 4, 0]);
    expect(parseVersion('latest')).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });

  it('orders versions numerically, not as strings', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('garbage', '1.0.0')).toBe(0);
  });

  it('reads the app manifest and a GitHub release alike', () => {
    expect(readManifest({ version: 'v1.1.0', url: 'https://x/y.exe', notes: 'n' })).toEqual({ version: '1.1.0', url: 'https://x/y.exe', notes: 'n' });
    expect(readManifest({
      tag_name: 'v1.2.0', html_url: 'https://gh/rel', body: 'notes',
      assets: [{ name: 'Fatefall Setup 1.2.0.exe', browser_download_url: 'https://gh/dl.exe' }],
    })).toEqual({ version: '1.2.0', url: 'https://gh/dl.exe', notes: 'notes' });
    expect(readManifest({ tag_name: 'v1.2.0', html_url: 'https://gh/rel' })?.url).toBe('https://gh/rel');
    expect(readManifest({ nothing: true })).toBeNull();
    expect(readManifest(null)).toBeNull();
  });
});
