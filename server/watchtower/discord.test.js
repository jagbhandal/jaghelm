import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidWebhookUrl, postToDiscord } from './discord.js';

test('only https Discord hosts are valid', () => {
  assert.equal(isValidWebhookUrl('https://discord.com/api/webhooks/1/abc'), true);
  assert.equal(isValidWebhookUrl('http://discord.com/api/webhooks/1/abc'), false);
  assert.equal(isValidWebhookUrl('https://evil.example/x'), false);
  assert.equal(isValidWebhookUrl('not a url'), false);
});

test('skips when no webhook configured', async () => {
  const r = await postToDiscord('', 'hi', { fetchImpl: async () => { throw new Error('should not call'); } });
  assert.equal(r.skipped, 'no-webhook');
});

test('posts content with mentions disabled', async () => {
  let captured;
  const fetchImpl = async (url, opts) => { captured = { url, opts }; return { ok: true, status: 204 }; };
  const r = await postToDiscord('https://discord.com/api/webhooks/1/abc', 'hello', { fetchImpl });
  assert.equal(r.ok, true);
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.content, 'hello');
  assert.deepEqual(body.allowed_mentions, { parse: [] });
});
