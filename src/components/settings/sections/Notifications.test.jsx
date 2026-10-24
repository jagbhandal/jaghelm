/*
 * Settings → Notifications (#320, #268): the threshold editor (checked as the
 * server checks it, saved over the version read, the server's refusal on its
 * row, a conflict read again), the categories each phone chose, the phones
 * (no token, Remove asks first) and the test push with its outcome, and
 * what the section says with push off.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Notifications from './Notifications.jsx';
import { draftErrors, draftOf, tableOf } from './notificationsData.js';
import { OverlayProvider } from '../../../context/OverlayContext.jsx';
import { setReadOnlyServer } from '../../../api/client.js';

const row = (metric, unit, warn, crit, defaults, min = 10, max = 100) => ({
  band: 5,
  metric,
  unit,
  warn,
  crit,
  defaults,
  min,
  max,
  custom: warn !== defaults.warn || crit !== defaults.crit,
});
const THRESHOLDS = [
  row('cpu', '%', 90, null, { warn: 90, crit: null }),
  row('mem', '%', 90, null, { warn: 90, crit: null }),
  row('disk', '%', 88, 94, { warn: 90, crit: 95 }),
  row('temp', '°C', 75, 85, { warn: 75, crit: 85 }, 30, 120),
];
const PREFS = {
  enabled: true,
  notifyRecoveries: true,
  categories: { service: true, host: true, ups: true, cron: true, watchtower: true },
};
const DEVICES = {
  enabled: true,
  stalled: null,
  defaults: PREFS,
  devices: [
    {
      id: '3f9a1c77e0b2',
      name: 'Pixel 8',
      model: 'Pixel 8',
      os: '15',
      platform: 'android',
      appVersion: '1.3.0',
      registeredAt: '2026-10-11T12:00:00.000Z',
      lastSeenAt: '2026-10-23T10:00:00.000Z',
      lastDeliveredAt: '2026-10-23T09:00:00.000Z',
      lastError: null,
      prefs: PREFS,
    },
    {
      id: '8c2d4e6f0a1b',
      name: 'Galaxy Tab S9',
      model: 'Galaxy Tab S9',
      os: '14',
      platform: 'android',
      appVersion: '1.2.0',
      registeredAt: '2026-09-13T12:00:00.000Z',
      lastSeenAt: '2026-10-20T10:00:00.000Z',
      lastDeliveredAt: null,
      lastError: {
        at: '2026-10-22T10:00:00.000Z',
        sentence: "Google's push service failed on it; JagHelm tries again",
      },
      prefs: {
        ...PREFS,
        notifyRecoveries: false,
        categories: { ...PREFS.categories, watchtower: false },
      },
    },
  ],
  test: null,
  cooldownS: 30,
};

let calls;
let answers;
beforeEach(() => {
  calls = [];
  answers = {
    'GET /api/thresholds': () =>
      Response.json({ thresholds: THRESHOLDS }, { headers: { ETag: '"v1"' } }),
    'GET /api/push/devices': () => Response.json(DEVICES),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, opts = {}) => {
      const method = opts.method ?? 'GET';
      calls.push({
        method,
        url,
        headers: opts.headers ?? {},
        body: opts.body ? JSON.parse(opts.body) : undefined,
      });
      const answer = answers[`${method} ${url}`];
      return answer ? answer(opts) : Response.json({ error: 'no answer' }, { status: 500 });
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  setReadOnlyServer(false);
});

const renderSection = () =>
  render(
    <OverlayProvider>
      <Notifications />
    </OverlayProvider>
  );

const thresholds = () => screen.getByRole('region', { name: 'Thresholds' });
const field = (name) => within(thresholds()).getAllByRole('textbox', { name });
const rowOf = (metric) => document.querySelector(`[data-metric="${metric}"]`);

describe('the thresholds', () => {
  it('shows each metric’s lines in force with its unit and defaults; CPU and memory have no critical line', async () => {
    renderSection();
    await waitFor(() => expect(field(/^Warning at/)).toHaveLength(4));
    expect(field(/^Warning at/).map((i) => i.value)).toEqual(['90', '90', '88', '75']);
    expect(field(/^Critical at/).map((i) => i.value)).toEqual(['94', '85']);
    expect(within(rowOf('cpu')).getByText('None: warns only')).toBeInTheDocument();
    expect(within(rowOf('disk')).getByText('Defaults 90 % and 95 %')).toBeInTheDocument();
    expect(within(rowOf('temp')).getAllByText('°C')).toHaveLength(2);
    // Disk is away from its defaults: it can be reset; CPU can't.
    expect(
      within(rowOf('disk')).getByRole('button', { name: /^Reset to default/ })
    ).toBeInTheDocument();
    expect(within(rowOf('cpu')).queryByRole('button', { name: /^Reset to default/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save thresholds' })).toBeDisabled();
  });

  it('names each field, Reset and Send test for its metric or phone', async () => {
    renderSection();
    await waitFor(() => expect(field(/^Warning at/)).toHaveLength(4));
    for (const name of ['CPU', 'Memory', 'Disk', 'Temperature']) {
      expect(
        within(thresholds()).getByRole('textbox', { name: `Warning at for ${name}` })
      ).toBeTruthy();
    }
    expect(
      within(thresholds()).getByRole('textbox', { name: 'Critical at for Temperature' })
    ).toBeTruthy();
    expect(
      within(rowOf('disk')).getByRole('button', { name: 'Reset to default for Disk' })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Send test to Galaxy Tab S9' })
    ).toBeInTheDocument();
  });

  it('marks a warning line at or over its critical one once focus leaves the row, not while typing, and saves nothing', async () => {
    const user = userEvent.setup();
    renderSection();
    const [, , diskWarn] = await screen.findAllByRole('textbox', { name: /^Warning at/ });
    await user.clear(diskWarn);
    await user.type(diskWarn, '96');
    // Still in the row: nothing said yet, and nothing asserted.
    expect(within(rowOf('disk')).queryByText(/must be under/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(diskWarn).not.toHaveAttribute('aria-invalid');
    await user.click(document.body);
    const message = within(rowOf('disk')).getByText(
      'The warning line (96 %) must be under the critical line (94 %)'
    );
    expect(message).not.toHaveAttribute('role');
    expect(diskWarn).toHaveAttribute('aria-invalid', 'true');
    expect(diskWarn).toHaveAccessibleDescription(message.textContent);
    await user.click(screen.getByRole('button', { name: 'Save thresholds' }));
    expect(screen.getByRole('status')).toHaveTextContent('Fix the lines marked above first.');
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('a Save shows the page’s check on a row focus never left', async () => {
    const user = userEvent.setup();
    renderSection();
    const [, , diskWarn] = await screen.findAllByRole('textbox', { name: /^Warning at/ });
    await user.clear(diskWarn);
    await user.type(diskWarn, '96');
    await user.click(screen.getByRole('button', { name: 'Save thresholds' }));
    expect(within(rowOf('disk')).getByText(/must be under the critical line/)).toBeInTheDocument();
  });

  it('a warning line saved above its critical one (by hand) loads as a notice, not an error, until a line is edited', async () => {
    const user = userEvent.setup();
    answers['GET /api/thresholds'] = () =>
      Response.json(
        {
          thresholds: THRESHOLDS.map((r) =>
            r.metric === 'disk' ? { ...r, warn: 96, crit: 96, custom: true } : r
          ),
        },
        { headers: { ETag: '"v1"' } }
      );
    answers['PUT /api/thresholds'] = () =>
      Response.json({ thresholds: THRESHOLDS }, { headers: { ETag: '"v2"' } });
    renderSection();
    const [, , diskWarn] = await screen.findAllByRole('textbox', { name: /^Warning at/ });
    // Both lines as on disk, nothing marked invalid, nothing blocked.
    expect(diskWarn).toHaveValue('96');
    expect(field(/^Critical at/)[0]).toHaveValue('96');
    expect(diskWarn).not.toHaveAttribute('aria-invalid');
    expect(diskWarn).toHaveAccessibleDescription(
      /As set on the host: .*must be under the critical line/
    );
    expect(screen.queryByRole('alert')).toBeNull();
    // Editing it makes it an ordinary row, checked as any other.
    await user.clear(diskWarn);
    await user.type(diskWarn, '97');
    await user.click(document.body);
    expect(diskWarn).toHaveAttribute('aria-invalid', 'true');
    await user.clear(diskWarn);
    await user.type(diskWarn, '90');
    await user.click(field(/^Critical at/)[0]);
    await user.clear(field(/^Critical at/)[0]);
    await user.type(field(/^Critical at/)[0], '95');
    await user.click(screen.getByRole('button', { name: 'Save thresholds' }));
    expect(calls.find((c) => c.method === 'PUT').body.disk).toBeNull();
  });

  it('says the hysteresis in force, not a fixed one', async () => {
    answers['GET /api/thresholds'] = () =>
      Response.json(
        {
          thresholds: THRESHOLDS.map((r) => (r.unit === '%' ? { ...r, band: 3 } : r)),
        },
        { headers: { ETag: '"v1"' } }
      );
    renderSection();
    expect(await screen.findByText(/falls 3 points \(5 °C\) under its line/)).toBeInTheDocument();
  });

  it('saves over the version read: each row its lines and unit, or null at its defaults', async () => {
    const user = userEvent.setup();
    answers['PUT /api/thresholds'] = () =>
      Response.json(
        {
          thresholds: THRESHOLDS.map((r) =>
            r.metric === 'cpu' ? { ...r, warn: 85, custom: true } : r
          ),
        },
        { headers: { ETag: '"v2"' } }
      );
    renderSection();
    const [cpuWarn] = await screen.findAllByRole('textbox', { name: /^Warning at/ });
    await user.clear(cpuWarn);
    await user.type(cpuWarn, '85');
    await user.click(screen.getByRole('button', { name: 'Save thresholds' }));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put.headers['If-Match']).toBe('"v1"');
    expect(put.body).toEqual({
      cpu: { warn: 85, unit: '%' },
      mem: null,
      disk: { warn: 88, crit: 94, unit: '%' },
      temp: null,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Saved. The board and push judge by these from the next refresh.'
    );
  });

  it('Reset to default puts the row back to its defaults, and saves it as null', async () => {
    const user = userEvent.setup();
    answers['PUT /api/thresholds'] = () =>
      Response.json({ thresholds: THRESHOLDS }, { headers: { ETag: '"v2"' } });
    renderSection();
    await screen.findAllByRole('textbox', { name: /^Warning at/ });
    await user.click(within(rowOf('disk')).getByRole('button', { name: /^Reset to default/ }));
    expect(field(/^Warning at/)[2]).toHaveValue('90');
    expect(field(/^Critical at/)[0]).toHaveValue('95');
    await user.click(screen.getByRole('button', { name: 'Save thresholds' }));
    expect(calls.find((c) => c.method === 'PUT').body.disk).toBeNull();
  });

  it('shows the server’s refusal on the row it names', async () => {
    const user = userEvent.setup();
    answers['PUT /api/thresholds'] = () =>
      Response.json({ error: "temp's unit is °C (Celsius)", metric: 'temp' }, { status: 400 });
    renderSection();
    const inputs = await screen.findAllByRole('textbox', { name: /^Warning at/ });
    await user.clear(inputs[3]);
    await user.type(inputs[3], '70');
    await user.click(screen.getByRole('button', { name: 'Save thresholds' }));
    expect(await within(rowOf('temp')).findByText(/unit is °C/)).toHaveTextContent(
      "temp's unit is °C"
    );
  });

  it('a save refused as stale reads the thresholds again and says so', async () => {
    const user = userEvent.setup();
    answers['PUT /api/thresholds'] = () =>
      Response.json({ error: 'changed', stale: true }, { status: 409 });
    renderSection();
    const [cpuWarn] = await screen.findAllByRole('textbox', { name: /^Warning at/ });
    await user.clear(cpuWarn);
    await user.type(cpuWarn, '80');
    await user.click(screen.getByRole('button', { name: 'Save thresholds' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/changed on another device/);
    expect(calls.filter((c) => c.method === 'GET' && c.url === '/api/thresholds')).toHaveLength(2);
    await waitFor(() => expect(field(/^Warning at/)[0]).toHaveValue('90'));
  });

  it('says why when they can’t be read, with a way to try again; the headings stay', async () => {
    answers['GET /api/thresholds'] = () =>
      Response.json(
        { error: "thresholds.json doesn't parse (line 1)", code: 'config_unparseable' },
        { status: 503 }
      );
    renderSection();
    expect(await within(thresholds()).findByRole('alert')).toHaveTextContent(
      "thresholds.json doesn't parse"
    );
    expect(within(thresholds()).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('the checks and the table it sends, as functions', () => {
    const draft = draftOf(THRESHOLDS);
    expect(draftErrors(THRESHOLDS, { ...draft, cpu: { warn: '5', crit: null } }).cpu).toBe(
      'The warning line must be from 10 to 100 %'
    );
    expect(draftErrors(THRESHOLDS, { ...draft, temp: { warn: 'hot', crit: '85' } }).temp).toMatch(
      /a number/
    );
    expect(draftErrors(THRESHOLDS, { ...draft, temp: { warn: '70', crit: '130' } }).temp).toBe(
      'The critical line must be from 30 to 120 °C'
    );
    expect(draftErrors(THRESHOLDS, draft)).toEqual({});
    expect(tableOf(THRESHOLDS, { ...draft, mem: { warn: '87,5', crit: null } }).mem).toEqual({
      warn: 87.5,
      unit: '%',
    });
  });
});

describe('the phones', () => {
  it('lists each phone by name with its times, its last failure in words and what it chose; never its id', async () => {
    renderSection();
    const devices = screen.getByRole('region', { name: 'Devices' });
    expect(await within(devices).findByRole('heading', { name: 'Pixel 8' })).toBeInTheDocument();
    const tab = within(devices).getByRole('heading', { name: 'Galaxy Tab S9' }).closest('li');
    expect(tab).toHaveTextContent('Android 14 · app 1.2.0');
    expect(tab).toHaveTextContent('no push delivered yet');
    expect(tab).toHaveTextContent("Google's push service failed on it; JagHelm tries again");
    expect(tab).toHaveTextContent('Gets Services, Hosts, UPS and Cron, without recoveries');
    for (const d of DEVICES.devices) expect(document.body.textContent).not.toContain(d.id);
  });

  it('lists the categories a phone chooses from, read-only, with what a new phone starts with', async () => {
    renderSection();
    const categories = screen.getByRole('region', { name: 'What pages the phones' });
    expect(categories).toHaveTextContent(
      /Each phone chooses its own categories in the JagHelm app/
    );
    for (const label of ['Services', 'Hosts', 'UPS', 'Cron', 'Updates', 'Recoveries']) {
      expect(within(categories).getByText(label)).toBeInTheDocument();
    }
    expect(within(categories).queryByRole('switch')).toBeNull();
    expect(within(categories).queryByRole('checkbox')).toBeNull();
  });

  it('Remove asks first, naming the phone; only Remove phone sends the removal', async () => {
    const user = userEvent.setup();
    answers['DELETE /api/push/devices/3f9a1c77e0b2'] = () => Response.json({ removed: true });
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Remove Pixel 8' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove this phone?' });
    expect(within(dialog).getByText('Pixel 8')).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent('3f9a1c77e0b2');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Remove Pixel 8' }));
    await user.click(await screen.findByRole('button', { name: 'Remove phone' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'DELETE' && c.url === '/api/push/devices/3f9a1c77e0b2')
      ).toBe(true)
    );
  });

  it('sends a test push to one phone and shows its outcome on the row', async () => {
    const user = userEvent.setup();
    const test = {
      at: '2026-10-23T12:00:00.000Z',
      device: '3f9a1c77e0b2',
      historyId: '41',
      done: true,
      sentence: 'Delivered: Google accepted it for this phone.',
      results: [
        {
          device: '3f9a1c77e0b2',
          state: 'sent',
          sentence: 'Delivered: Google accepted it for this phone.',
        },
      ],
    };
    answers['POST /api/push/test'] = () => Response.json(test, { status: 202 });
    renderSection();
    const pixel = (await screen.findByRole('heading', { name: 'Pixel 8' })).closest('li');
    await user.click(within(pixel).getByRole('button', { name: 'Send test to Pixel 8' }));
    expect(calls.find((c) => c.method === 'POST').body).toEqual({ device: '3f9a1c77e0b2' });
    expect(await within(pixel).findByText(/Delivered: Google accepted it/)).toBeInTheDocument();
  });

  it('a test push refused for its wait says so', async () => {
    const user = userEvent.setup();
    answers['POST /api/push/test'] = () =>
      Response.json(
        { error: 'One test push per phone every 30 seconds: try again in 12 s', retryAfterS: 12 },
        { status: 429 }
      );
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Send test push' }));
    expect(calls.find((c) => c.method === 'POST').body).toEqual({});
    expect(await screen.findByText(/try again in 12 s/)).toBeInTheDocument();
  });

  it('with push off says so and how to turn it on, sends nothing, and the thresholds can still be edited', async () => {
    answers['GET /api/push/devices'] = () =>
      Response.json({ ...DEVICES, enabled: false, devices: [] });
    renderSection();
    const devices = screen.getByRole('region', { name: 'Devices' });
    expect(await within(devices).findByText('Push is off on this server')).toBeInTheDocument();
    expect(devices).toHaveTextContent('FCM_SERVICE_ACCOUNT');
    expect(within(devices).queryByRole('button', { name: /Send test/ })).toBeNull();
    await waitFor(() => expect(field(/^Warning at/)[0]).not.toHaveAttribute('readonly'));
    expect(screen.getByRole('button', { name: 'Save thresholds' })).toBeInTheDocument();
  });

  it('the read-only demo saves and sends nothing, and says so', async () => {
    setReadOnlyServer(true);
    renderSection();
    await waitFor(() => expect(field(/^Warning at/)[0]).toHaveAttribute('readonly'));
    expect(screen.queryByRole('button', { name: 'Save thresholds' })).toBeNull();
    expect(screen.getByText('This is a read-only demo: nothing is saved.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });
});
