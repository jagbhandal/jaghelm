/**
 * #673: the token never follows a redirect to another origin. Two real local
 * servers: the first (JAGHELM_GITEA_URL) redirects the issue read to the
 * second, which records the headers it received.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const seen = [];
const other = http.createServer((req, res) => {
  seen.push(req.headers);
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ body: '## For Jag\n- [ ] **#1** x' }));
});
await new Promise((r) => other.listen(0, '127.0.0.1', r));
const origin = http.createServer((req, res) => {
  res.statusCode = 302;
  res.setHeader('Location', `http://127.0.0.1:${other.address().port}/stolen`);
  res.end();
});
await new Promise((r) => origin.listen(0, '127.0.0.1', r));
process.env.JAGHELM_GITEA_URL = `http://127.0.0.1:${origin.address().port}`;
process.env.JAGHELM_GITEA_TOKEN = 'secret-test-token'; // pragma: allowlist secret
after(() => {
  origin.close();
  other.close();
});

const { hostActionsAnswer, _resetHostActions } = await import('./hostActions.js');

test('a redirect to another origin arrives without the Authorization header', async () => {
  _resetHostActions();
  await hostActionsAnswer();
  assert.equal(seen.length, 1, 'the redirect was followed, so the check below means something');
  for (const headers of seen) {
    assert.equal(headers.authorization, undefined);
    assert.ok(!JSON.stringify(headers).includes('secret-test-token'));
  }
});
