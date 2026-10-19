/**
 * #255: the icon repositories /api/icons/cached may fetch from. canonicalIconUrl()
 * turns the URL a browser asks for into the one URL the server fetches and keys
 * the cache by, or null. Every URL JagHelm itself builds must come back
 * unchanged, so the icons already cached under it stay cache hits.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalIconUrl, ICON_TYPES, MAX_ICON_URL_LENGTH } from './icon-sources.js';
import { initIconIndex, searchIcons, ICON_INDEX_FILE } from './icons.js';
import { ICON_CDN_BASE, iconSlugUrl } from '../src/utils/iconCdn.js';

const DASH = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg';
const SELF = 'https://cdn.jsdelivr.net/gh/selfhst/icons@latest/svg/gitea.svg';

test('the URLs JagHelm builds are accepted unchanged', () => {
  assert.equal(canonicalIconUrl(DASH), DASH);
  assert.equal(canonicalIconUrl(SELF), SELF);
  // The client's slug URLs (getServiceIcon, iconImageSrc, quick links).
  assert.equal(ICON_CDN_BASE, 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg');
  for (const slug of ['nginx-proxy-manager', 'uptime-kuma', 'pi-hole', 'collabora-online', 'vscode']) {
    assert.equal(canonicalIconUrl(iconSlugUrl(slug)), iconSlugUrl(slug), slug);
  }
});

test('every icon the picker offers is accepted unchanged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jh-icon-sources-'));
  try {
    const checkedAt = Date.now();
    writeFileSync(join(dir, ICON_INDEX_FILE), JSON.stringify({
      version: 1,
      repos: {
        'dashboard-icons': { etag: null, checkedAt, slugs: ['plex', 'home-assistant', 'adguard-home'] },
        selfhst: { etag: null, checkedAt, slugs: ['jellyseerr', 'immich', 'a.b_c-1'] },
      },
    }));
    await initIconIndex({ dataDir: dir });
    const results = searchIcons('', 100);
    assert.equal(results.length, 6);
    for (const r of results) assert.equal(canonicalIconUrl(r.url), r.url, r.url);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('other formats and refs of the same repositories are accepted', () => {
  for (const url of [
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/png/gitea.png',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/webp/gitea.webp',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh/selfhst/icons@latest/png/gitea.png',
    'https://cdn.jsdelivr.net/gh/selfhst/icons@main/webp/gitea.webp',
    'https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/svg/gitea.svg',
    'https://raw.githubusercontent.com/homarr-labs/dashboard-icons/HEAD/png/gitea.png',
    'https://raw.githubusercontent.com/selfhst/icons/main/webp/gitea.webp',
  ]) {
    assert.equal(canonicalIconUrl(url), url, url);
  }
});

test('equivalent spellings collapse to one canonical URL', () => {
  for (const variant of [
    `${DASH}?v=1`,
    `${DASH}?v=2&cb=${'x'.repeat(50)}`,
    `${DASH}#frag`,
    `${DASH}?`,
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/gitea.svg', // no ref = @latest on jsDelivr
    'HTTPS://CDN.JSDELIVR.NET/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://cdn.jsdelivr.net:443/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh/Homarr-Labs/Dashboard-Icons@latest/svg/gitea.svg', // GitHub names ignore case
    // The repository's name before it moved to homarr-labs; GitHub and jsDelivr
    // still serve it, and JagHelm itself built these URLs until 2026-06.
    'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons@latest/svg/gitea.svg',
  ]) {
    assert.equal(canonicalIconUrl(variant), DASH, variant);
  }
  assert.equal(
    canonicalIconUrl('https://raw.githubusercontent.com/walkxcode/dashboard-icons/main/svg/gitea.svg?token=abc'),
    'https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/svg/gitea.svg'
  );
});

test('other hosts are rejected', () => {
  for (const url of [
    'https://example.com/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://cdn.jsdelivr.net.evil.example/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://cdn.jsdelivr.net./gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg', // trailing dot
    'https://fastly.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://evil.cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://github.com/homarr-labs/dashboard-icons/raw/main/svg/gitea.svg',
    'https://151.101.1.229/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://[::1]/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://localhost/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://cdn.jsdelivr.net@evil.example/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
  ]) {
    assert.equal(canonicalIconUrl(url), null, url);
  }
});

test('other schemes, userinfo and ports are rejected', () => {
  for (const url of [
    'http://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'ftp://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'file:///gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'data:image/svg+xml,<svg/>',
    'javascript:alert(1)//cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://user@cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://user:pass@cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://cdn.jsdelivr.net:8443/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://cdn.jsdelivr.net:80/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    '//cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg', // relative
    '/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
  ]) {
    assert.equal(canonicalIconUrl(url), null, url);
  }
});

test('other repositories and paths on the allowed hosts are rejected', () => {
  for (const url of [
    'https://cdn.jsdelivr.net/gh/attacker/repo@latest/svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/other@latest/svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons-evil@latest/svg/gitea.svg',
    'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/gitea.svg',
    'https://cdn.jsdelivr.net/gh/marella/material-design-icons@latest/svg/outlined/folder_special.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/README.md',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/sub/gitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/avif/gitea.avif',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.png', // type not its directory's
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/png/gitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.html',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/Gitea.svg', // the files are all lowercase
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/SVG/gitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg/',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg;x',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/' + 'a'.repeat(200) + '.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs@latest/svg/gitea.svg',
    'https://cdn.jsdelivr.net/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://raw.githubusercontent.com/attacker/repo/main/svg/gitea.svg',
    'https://raw.githubusercontent.com/homarr-labs/dashboard-icons/svg/gitea.svg', // no ref
    'https://raw.githubusercontent.com/homarr-labs/dashboard-icons/refs/heads/main/svg/gitea.svg',
    'https://raw.githubusercontent.com/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
  ]) {
    assert.equal(canonicalIconUrl(url), null, url);
  }
});

test('refs other than the moving ones are rejected (each would be another copy of every icon)', () => {
  for (const url of [
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@v1.0.0/svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@1/svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@0123456789abcdef0123456789abcdef01234567/svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@0123abc/svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@/svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest@main/svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@LATEST/svg/gitea.svg',
    'https://raw.githubusercontent.com/homarr-labs/dashboard-icons/0123456789abcdef0123456789abcdef01234567/svg/gitea.svg',
    'https://raw.githubusercontent.com/homarr-labs/dashboard-icons/latest/svg/gitea.svg',
  ]) {
    assert.equal(canonicalIconUrl(url), null, url);
  }
});

test('path traversal and encoding tricks are rejected, not resolved', () => {
  for (const url of [
    'https://cdn.jsdelivr.net/gh/attacker/repo/../../gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/../svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/./svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/..',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/%2e%2e/gitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/.%2E/svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg%2fgitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg%2Fgitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg%5cgitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea%2esvg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/git%65a.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest\\svg\\gitea.svg',
    'https://cdn.jsdelivr.net\\gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://cdn.jsdelivr.net//gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh//homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg//gitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg\n',
    ' https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gi\ttea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitéa.svg',
    'https://cdn.jsdеlivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg', // Cyrillic "е"
    'https://cdn%2Ejsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
  ]) {
    assert.equal(canonicalIconUrl(url), null, JSON.stringify(url));
  }
});

test('non-strings and overlong input are rejected', () => {
  for (const v of [undefined, null, '', 42, {}, [DASH], ['a', 'b']]) {
    assert.equal(canonicalIconUrl(/** @type {any} */ (v)), null, JSON.stringify(v));
  }
  const long = `${DASH}?${'x'.repeat(MAX_ICON_URL_LENGTH)}`;
  assert.equal(canonicalIconUrl(long), null);
});

test('ICON_TYPES maps each accepted extension to the Content-Type the repositories send', () => {
  assert.deepEqual({ ...ICON_TYPES }, { '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' });
  assert.ok(Object.isFrozen(ICON_TYPES));
});
