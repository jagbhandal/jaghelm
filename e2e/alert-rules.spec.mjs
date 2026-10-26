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
      rules.getByText(
        /Quiet now \(.* in UTC\), until|Not quiet now \(.* in UTC\)\. From 22:00 to 07:00 in UTC/
      )
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

  test('the time zone: picking one changes the status line and is kept; saved alerts without one stay on Toronto', async ({
    page,
  }) => {
    // A live install: quiet hours saved before the zone could be chosen.
    const { server, answers } = keeper({
      alerts: { quietHours: { enabled: true, start: '22:00', end: '07:00' } },
    });
    await openApp(page, '/settings/notifications#alert-rules', { answers });
    const rules = page.getByRole('region', { name: 'Alert rules' });
    await expect(rules.getByText(/in America\/Toronto/).first()).toBeVisible();
    await expect(rules.getByText(/what quiet hours have always used/)).toBeVisible();

    await rules.getByRole('combobox', { name: 'Time zone' }).click();
    await page.getByRole('option', { name: 'Asia/Tokyo', exact: true }).click();
    await expect(rules.getByText(/in Asia\/Tokyo/).first()).toBeVisible();
    await expect(rules.getByText(/in America\/Toronto/)).toHaveCount(0);
    await expect.poll(() => server.config.alerts?.timezone, { timeout: 8000 }).toBe('Asia/Tokyo');
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
