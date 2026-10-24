/*
 * Heartbeat strips of monitors that are off Kuma's status page (#671): the
 * server marks a strip `history: 'since-restart'` (JagHelm's own sampling),
 * and the web says so instead of drawing the time before the restart as
 * outage-looking hollow rings:
 *
 *  - the row has the words "history since restart" (icon and words, with the
 *    reason as a tooltip), and its slots before the restart are flat
 *    "not recorded" dashes, none a hollow ring;
 *  - the drawer writes the reason out (a finger has no tooltip);
 *  - a monitor with Kuma's history on the same board has neither;
 *  - at a phone's width, the row has the words and no sideways scroll.
 */
import { test, expect } from '@playwright/test';
import { demo, openApp } from './app.mjs';

const UID = 'apps:jellyfin';
const KEPT = 5;

/** The demo's /api/services with Jellyfin's strip cut to its last few beats and marked as sampled. */
function sampled() {
  const body = structuredClone(demo('/api/services').body);
  const b = body.beats[UID];
  body.beats[UID] = {
    t: b.t + b.d.slice(0, b.s.length - KEPT).reduce((a, x) => a + x, 0),
    d: b.d.slice(-(KEPT - 1)),
    s: b.s.slice(-KEPT),
    p: b.p.slice(-KEPT),
    history: 'since-restart',
  };
  return body;
}

const row = (page, uid) => page.locator(`[data-slot="entity-row"][data-entity="services/${uid}"]`);

test('a since-restart strip says so in words and draws unrecorded slots, not outage rings', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, '/', { answers: { '/api/services': sampled() } });
  const jellyfin = row(page, UID);
  await expect(jellyfin).toBeVisible();
  const note = jellyfin.locator('[data-slot="beat-history-note"]');
  await expect(note).toHaveText('history since restart');
  await expect(note).toHaveAttribute('title', /not on Kuma's status page/);
  await expect(note.locator('svg')).toBeVisible();
  const strip = jellyfin.locator('[data-slot="uptime-bar"]');
  await expect(strip.locator('[data-beat="unrecorded"]')).toHaveCount(30 - KEPT);
  await expect(strip.locator('[data-beat="none"]')).toHaveCount(0);
  await expect(strip).toHaveAccessibleName(/earlier checks not recorded/);
  // A monitor with Kuma's history on the same board is unchanged.
  const other = row(page, 'apps:vaultwarden');
  await expect(other.locator('[data-slot="beat-history-note"]')).toHaveCount(0);
  await expect(other.locator('[data-beat="unrecorded"]')).toHaveCount(0);
});

for (const width of [1024, 1440]) {
  test(`${width}: a labelled row is as tall as an unlabelled one`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openApp(page, '/', { answers: { '/api/services': sampled() } });
    const heights = async (uid) => (await row(page, uid).boundingBox()).height;
    await expect(row(page, UID).locator('[data-slot="beat-history-note"]')).toBeVisible();
    expect(await heights(UID)).toBe(await heights('apps:vaultwarden'));
  });
}

test('the drawer writes the reason out', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, '/', { answers: { '/api/services': sampled() } });
  await row(page, UID).click();
  const why = page.locator('[data-slot="beat-history-why"]');
  await expect(why).toBeVisible();
  await expect(why).toContainText("not on Kuma's status page");
});

test('a phone row has the words and does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openApp(page, '/', { answers: { '/api/services': sampled() } });
  const note = page.locator('[data-slot="beat-history-note"]').first();
  await expect(note).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
