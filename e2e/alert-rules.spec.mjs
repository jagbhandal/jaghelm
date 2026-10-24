/*
 * Alert rules in a real browser (#669): Settings → Notifications → Alert rules.
 * Turning quiet hours on shows the times and says whether it is quiet now, a
 * known cause is added, the display config keeps both (versioned, as the route
 * does, #547), and the Alerts page tags a matching alert with its cause.
 */
import { test, expect } from '@playwright/test';
import { openApp, reply, demo } from './app.mjs';

const NOT_DEMO = { authenticated: true, authRequired: false, demo: false };

function keeper(config = {}) {
  const server = { config, version: 1 };
  const etag = () => `"v${server.version}"`;
  const displayConfig = (request) => {
    if (request.method() !== 'POST') return reply(200, server.config, { ETag: etag() });
    if (request.headers()['if-match'] !== etag())
      return reply(409, { error: 'Stale', stale: true }, { ETag: etag() });
    server.config = request.postDataJSON();
    server.version += 1;
    return reply(200, { ok: true }, { ETag: etag() });
  };
  return { server, answers: { '/api/auth/check': NOT_DEMO, '/api/display-config': displayConfig } };
}

test.describe('alert rules', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('quiet hours and a known cause: the controls change what the page says, and are kept', async ({
    page,
  }) => {
    const { server, answers } = keeper({});
    await openApp(page, '/settings/notifications#alert-rules', { answers });
    const rules = page.getByRole('region', { name: 'Alert rules' });
    await expect(rules).toBeVisible();
    await expect(rules.getByText('Quiet hours are off', { exact: false })).toBeVisible();

    await rules.getByRole('switch', { name: 'Quiet hours' }).click();
    await expect(rules.getByLabel('From')).toHaveValue('22:00');
    await expect(
      rules.getByText(/Quiet now, until|Not quiet now\. From 22:00 to 07:00 Toronto time/)
    ).toBeVisible();
    await rules.getByRole('radio', { name: 'Silent' }).click();
    await expect(rules.getByText(/[Nn]othing rings/)).toBeVisible();

    await rules.getByRole('button', { name: 'Add a known cause' }).click();
    const rows = rules.locator('[data-cause-row]');
    await rows.last().getByLabel('Name contains').fill('jellyfin');
    await rows.last().getByLabel('Label').fill('Nightly transcode cleanup');

    // The save is debounced; wait for the server to hold it.
    await expect
      .poll(() => server.config.alerts?.knownCauses?.at(-1)?.label, { timeout: 8000 })
      .toBe('Nightly transcode cleanup');
    expect(server.config.alerts.quietHours).toMatchObject({ enabled: true, mode: 'silent' });
  });

  test('the Alerts page tags an alert with its known cause', async ({ page }) => {
    const events = demo('/api/events', { query: { limit: '50' } }).body;
    const tagged = {
      ...events,
      events: events.events.map((e, i) =>
        i === 0 ? { ...e, cause: 'Omada AP auto-upgrade reboot' } : e
      ),
    };
    await openApp(page, '/alerts', { answers: { '/api/events': tagged } });
    await expect(page.getByText('Known cause: Omada AP auto-upgrade reboot')).toBeVisible();
  });
});
