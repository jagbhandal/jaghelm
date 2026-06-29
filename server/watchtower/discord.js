// Thin Discord webhook poster. URL is operator-configured (trusted) but we still
// host-pin to Discord so a misconfig can't be turned into an SSRF primitive.
const ALLOWED_HOSTS = new Set(['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com']);

export function isValidWebhookUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export async function postToDiscord(webhookUrl, content, { fetchImpl = fetch } = {}) {
  if (!webhookUrl) return { ok: false, skipped: 'no-webhook' };
  if (!isValidWebhookUrl(webhookUrl)) return { ok: false, skipped: 'bad-webhook' };
  const res = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
  return { ok: !!res.ok, status: res.status };
}
