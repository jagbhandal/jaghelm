/**
 * apiError (#338): a logged error line names the request path (query and fragment
 * dropped: a query string can carry a token), so it can be matched to its request.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LOG_LEVEL = 'debug';
const { apiError } = await import('./errors.js');

function capture(fn) {
  const lines = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s) => (lines.push(s), true);
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return lines.map((l) => JSON.parse(l));
}

function fakeRes(originalUrl) {
  return { req: { originalUrl }, status() { return this; }, json() { return this; } };
}

test('apiError lines carry the request path without query or fragment (#338)', () => {
  const [line] = capture(() =>
    apiError(fakeRes('/api/gitea/activity?apikey=s3cret&x=1#frag'), 502, 'Upstream unreachable', new Error('boom'))
  );
  assert.equal(line.path, '/api/gitea/activity');
  assert.equal(line.status, 502);
  assert.doesNotMatch(JSON.stringify(line), /s3cret/);
});

test('apiError still logs when the response has no request attached (#338)', () => {
  const res = { status() { return this; }, json() { return this; } };
  const [line] = capture(() => apiError(res, 500, 'x', new Error('boom')));
  assert.equal(line.status, 500);
});
