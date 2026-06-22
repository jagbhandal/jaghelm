/**
 * Focused tests for the GitLab preset's honest-field fix.
 *
 * Run with:  node --test server/integrations/presets/gitlab.test.js
 *
 * Bug being guarded: the preset used to hit
 *   /api/v4/projects?per_page=1&statistics=true
 * and surface path '0.id' under the label "Projects". That value is the id of
 * an arbitrary first project (a meaningless number), NOT a project count — and
 * with per_page=1 the body can never carry a real total (it only exists in the
 * x-total response header, which the JSON-body extractor can't read). The fix
 * repoints to /api/v4/version and shows the honest, body-readable version string.
 *
 * Style mirrors registry.test.js: drive the pure functions directly, no I/O.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import gitlab from './gitlab.js';
import { __test__ } from '../registry.js';
import { extractValue } from '../lib/extract.js';
import { formatValue } from '../lib/format.js';

const { validatePreset } = __test__;

test('gitlab preset passes registry validation', () => {
  // Validate a copy so we don't mutate the shared module export.
  const { ok, errors } = validatePreset('gitlab.js', { ...gitlab });
  assert.equal(ok, true, `expected valid, got errors: ${JSON.stringify(errors)}`);
});

test('gitlab no longer mislabels a project id as a count', () => {
  // The honest-fix guard: nothing may extract a project id ('0.id') and no
  // field may be labeled in a way that implies a count it cannot honestly carry.
  for (const f of gitlab.fields) {
    assert.notEqual(f.path, '0.id', 'must not surface an arbitrary project id');
    assert.notEqual(f.label, 'Projects', 'must not claim a "Projects" count it lacks');
  }
});

test('gitlab fetches a body-readable endpoint (not the per_page=1 list)', () => {
  // The version endpoint returns a real JSON body; the old projects endpoint
  // could only carry a total in a response header the extractor cannot read.
  assert.equal(gitlab.endpoint, '/api/v4/version');
  assert.ok(!gitlab.endpoint.includes('per_page'), 'must not depend on per_page paging');
});

test('gitlab version field resolves honestly against a realistic body', () => {
  // Shape per GitLab GET /api/v4/version.
  const body = { version: '16.11.1-ee', revision: 'abcdef0' };
  const field = gitlab.fields.find(f => f.key === 'version');
  assert.ok(field, 'expected a version field');

  const raw = extractValue(body, field.path);
  assert.equal(raw, '16.11.1-ee', 'path should resolve to the version string');

  const display = formatValue(raw, field.format || 'string');
  assert.equal(display, '16.11.1-ee', 'string format should pass the value through unchanged');
});
