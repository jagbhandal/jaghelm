/**
 * /save + /test allow-list the user-supplied `params` to a preset's declared
 * urlParams keys, so a client can't inject handler-honored keys (tlsSkip to disable
 * cert validation, endpoint/url override, extraHeaders, extraEndpoints) into the
 * saved/tested integration config.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.JAGHELM_DATA_DIR = mkdtempSync(join(tmpdir(), 'jh-int-'));
const { initRegistry } = await import('../integrations/registry.js');
await initRegistry(); // load presets (app does this at startup) so getPreset works
const { allowedParams } = await import('./integrations.js');

test('keeps a preset-declared urlParam, drops injected keys', () => {
  const out = allowedParams('cloudflare', {
    account_id: 'abc',        // declared in the cloudflare preset's urlParams
    tlsSkip: true,            // injected — must be dropped
    endpoint: '/evil',        // injected — must be dropped
    extraHeaders: { x: 'y' }, // injected — must be dropped
  });
  assert.deepEqual(out, { account_id: 'abc' });
});

test('a non-preset (custom) integration accepts no params', () => {
  assert.deepEqual(allowedParams('_custom', { account_id: 'x', anything: 1 }), {});
});

test('tolerates missing / non-object params', () => {
  assert.deepEqual(allowedParams('cloudflare', undefined), {});
  assert.deepEqual(allowedParams('cloudflare', 'nope'), {});
});
