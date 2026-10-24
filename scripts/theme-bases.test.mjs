// The theme validator's base data (server/themeBases.js, #331) is tokens.css as
// data: it must match what tokens.css gives today, and name the same accents.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCENTS, DEFAULT_ACCENT } from '../src/ui/accents.js';
import { ACCENT_ROLES, THEME_BASES } from '../server/themeBases.js';
import { ACCENT_ROLE_NAMES, THEME_BASE_IDS } from '../server/themes.js';
import { OUT_FILE, themeBasesSource } from './theme-bases.mjs';
import { TOKENS_FILE } from './ui-contrast.mjs';

test('server/themeBases.js is what tokens.css gives (npm run theme-bases rewrites it)', () => {
  assert.equal(
    readFileSync(OUT_FILE, 'utf8'),
    themeBasesSource(readFileSync(TOKENS_FILE, 'utf8')),
    'server/themeBases.js is out of date: run npm run theme-bases'
  );
});

test('the validator knows the same themes and accents as the app', () => {
  assert.deepEqual(Object.keys(THEME_BASES), [...THEME_BASE_IDS]);
  for (const theme of THEME_BASE_IDS) {
    assert.deepEqual(
      Object.keys(ACCENT_ROLES[theme]),
      ACCENTS.map((a) => a.id).filter((id) => id !== DEFAULT_ACCENT)
    );
  }
  assert.equal(DEFAULT_ACCENT, 'violet');
  assert.ok(ACCENT_ROLE_NAMES.includes('accent') && ACCENT_ROLE_NAMES.includes('meter'));
});

test('every role the contrast pairings read can be set by a theme', async () => {
  const { PAIRINGS } = await import('./ui-contrast.mjs');
  const names = new Set(PAIRINGS.flatMap((p) => [p.fg, p.bg, p.over].filter(Boolean)));
  for (const name of names) assert.ok(name in THEME_BASES.dark, `${name} is not in the dark base`);
  for (const name of names)
    assert.ok(name in THEME_BASES.light, `${name} is not in the light base`);
});
