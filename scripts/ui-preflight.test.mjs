// Guards src/ui/preflight.css, the copy of Tailwind's preflight scoped to .jh-ui
// (scripts/ui-preflight.mjs). A Tailwind upgrade that changes preflight must
// regenerate the file, or the new UI would run on a stale reset.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OUT, SCOPE, readTailwindPreflight, scopePreflight } from './ui-preflight.mjs';

test('src/ui/preflight.css matches the installed Tailwind preflight', () => {
  const { css, version } = readTailwindPreflight();
  assert.equal(
    readFileSync(OUT, 'utf8'),
    scopePreflight(css, version),
    'src/ui/preflight.css is out of date: run node scripts/ui-preflight.mjs'
  );
});

test('the scoped preflight wraps every rule in @scope and resets the root itself', () => {
  const { css, version } = readTailwindPreflight();
  const out = scopePreflight(css, version);
  const body = out.slice(out.indexOf(`@scope (${SCOPE}) {`));
  assert.ok(body.startsWith(`@scope (${SCOPE}) {`));
  assert.ok(body.trimEnd().endsWith('}'));
  // preflight's `html, :host` rule would match outside the scope: it must be gone
  assert.doesNotMatch(body, /^html,/m);
  assert.match(body, /^:scope \{/m);
  assert.match(body, /^:scope,\n\*,\n::after,/m);
});

test('scopePreflight refuses a preflight whose shape it does not know', () => {
  assert.throws(() => scopePreflight('*,\n::after {}\n', 'x'), /html, :host/);
  assert.throws(() => scopePreflight('html,\n:host {}\n', 'x'), /universal reset/);
});
