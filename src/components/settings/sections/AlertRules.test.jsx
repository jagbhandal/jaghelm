/*
 * Settings → Notifications → Alert rules (#669): each control writes the
 * display config's `alerts` and shows what it did; snoozed and acknowledged
 * alerts are listed and can be lifted.
 */
import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AlertRules from './AlertRules.jsx';
import { ConfigProvider } from '../../../context/ConfigContext.jsx';
import { OverlayProvider } from '../../../context/OverlayContext.jsx';
import { setReadOnlyServer } from '../../../api/client.js';

let calls;
let view;
let refuseZone;
let viewFails;
beforeEach(() => {
  calls = [];
  refuseZone = new Set();
  viewFails = false;
  view = { held: 0, snoozed: [], acked: [], serverTimezone: 'Asia/Tokyo' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, opts = {}) => {
      const method = opts.method ?? 'GET';
      calls.push({ method, url, body: opts.body ? JSON.parse(opts.body) : undefined });
      if (url === '/api/push/alerts') {
        return viewFails ? Response.json({}, { status: 500 }) : Response.json(view);
      }
      if (url.startsWith('/api/push/alerts/timezone')) {
        const name = new URL(url, 'http://x').searchParams.get('name');
        return refuseZone.has(name)
          ? Response.json({ error: 'This server does not know that time zone' }, { status: 400 })
          : Response.json({ valid: true });
      }
      if (url === '/api/push/alerts/clear') {
        view = { ...view, snoozed: [], acked: [] };
        return Response.json({ cleared: true });
      }
      return Response.json({}, { status: 500 });
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  setReadOnlyServer(false);
});

/** The section over a config it can change, the way the app holds one. */
function Harness({ initial = {}, onConfig }) {
  const [config, setConfig] = useState(initial);
  onConfig?.(config);
  return (
    <ConfigProvider config={config} setConfig={setConfig}>
      <OverlayProvider>
        <AlertRules />
      </OverlayProvider>
    </ConfigProvider>
  );
}
const mount = (initial, seen = { config: null }) => {
  render(<Harness initial={initial} onConfig={(c) => (seen.config = c)} />);
  return seen;
};

describe('Alert rules', () => {
  it('starts from the defaults on an install that never saved any: 1 minute, quiet hours off, the Omada cause', async () => {
    mount({});
    expect(
      await screen.findByText(/within 1 minute of the first arrive as one push/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Quiet hours are off/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('omada')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Omada AP auto-upgrade reboot')).toBeInTheDocument();
    expect(await screen.findByText('Nothing is snoozed or acknowledged.')).toBeInTheDocument();
  });

  it('quiet hours: the switch reveals the times and mode, saves them, and the line says when it is quiet', async () => {
    const user = userEvent.setup();
    const seen = mount({
      alerts: { quietHours: { enabled: false, start: '22:00', end: '07:00' } },
    });
    await user.click(screen.getByRole('switch', { name: 'Quiet hours' }));
    expect(seen.config.alerts.quietHours.enabled).toBe(true);
    expect(await screen.findByLabelText('From')).toHaveValue('22:00');
    expect(screen.getByLabelText('Until')).toHaveValue('07:00');
    expect(
      screen.getByText(
        /(Quiet now \(.* in America\/Toronto\), until|Not quiet now \(.* in America\/Toronto\)\. From 22:00 to 07:00 in America\/Toronto)/
      )
    ).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Silent' }));
    expect(seen.config.alerts.quietHours.mode).toBe('silent');
    expect(screen.getByText(/(nothing rings|Nothing rings)/)).toBeInTheDocument();
  });

  it('a known cause can be added, edited and deleted, and the config follows', async () => {
    const user = userEvent.setup();
    const seen = mount({ alerts: { knownCauses: [] } });
    await user.click(screen.getByRole('button', { name: 'Add a known cause' }));
    expect(seen.config.alerts.knownCauses).toEqual([{ match: '', label: '' }]);
    const [name, label] = await screen.findAllByRole('textbox');
    await user.type(name, 'nas');
    await user.type(label, 'Nightly scrub');
    expect(seen.config.alerts.knownCauses).toEqual([{ match: 'nas', label: 'Nightly scrub' }]);
    await user.click(screen.getByRole('button', { name: /^Delete the cause/ }));
    expect(seen.config.alerts.knownCauses).toEqual([]);
  });

  it('the burst window writes seconds and its sentence follows', async () => {
    const user = userEvent.setup();
    const seen = mount({});
    const select = screen.getByRole('combobox', { name: 'Group a burst of alerts' });
    await waitFor(() => expect(select).not.toHaveAttribute('aria-disabled', 'true'));
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: 'Off: each alert on its own' }));
    expect(seen.config.alerts.groupWindowSeconds).toBe(0);
    // The first save pins the zone that was showing, so it stays the one in force.
    expect(seen.config.alerts.timezone).toBe('Asia/Tokyo');
    expect(screen.getByText('Each alert is sent as soon as it happens.')).toBeInTheDocument();
  });

  it('lists what is snoozed and acknowledged and lifts it', async () => {
    const user = userEvent.setup();
    view = {
      held: 2,
      snoozed: [{ tag: 'services/pve:gitea', until: Date.now() + 3_600_000 }],
      acked: [{ tag: 'nodes/pve', since: Date.now() - 1000 }],
    };
    mount({});
    const row = await waitFor(() => {
      const el = document.querySelector('[data-silenced-row]');
      expect(el).not.toBeNull();
      return el;
    });
    expect(within(row).getByText('services/pve:gitea')).toBeInTheDocument();
    expect(screen.getByText('Acknowledged until it recovers')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lift for nodes/pve' }));
    expect(calls.find((c) => c.url === '/api/push/alerts/clear').body).toEqual({
      tag: 'nodes/pve',
    });
    expect(await screen.findByText('Nothing is snoozed or acknowledged.')).toBeInTheDocument();
  });

  it('in a read-only demo the controls are locked', async () => {
    setReadOnlyServer(true);
    mount({});
    expect(await screen.findByRole('switch', { name: 'Quiet hours' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Add a known cause' })).toBeDisabled();
  });

  describe('time zone (#703)', () => {
    it('an install with no saved alerts says it uses the server’s zone, and the status line is in it', async () => {
      const user = userEvent.setup();
      const seen = mount({});
      await waitFor(() =>
        expect(screen.getByRole('switch', { name: 'Quiet hours' })).not.toHaveAttribute(
          'aria-disabled',
          'true'
        )
      );
      // Before anything is saved, the line says where the zone comes from.
      expect(
        screen.getByText(/Quiet hours are off.* Using the server’s time zone: Asia\/Tokyo\./)
      ).toBeInTheDocument();
      await user.click(screen.getByRole('switch', { name: 'Quiet hours' }));
      expect(await screen.findByText('This is the server’s time zone.')).toBeInTheDocument();
      expect(screen.getByText(/in Asia\/Tokyo/)).toBeInTheDocument();
      // Turning it on pinned the zone, so a restart keeps what was shown.
      expect(seen.config.alerts).toMatchObject({
        timezone: 'Asia/Tokyo',
        quietHours: { enabled: true },
      });
    });

    it('LIVE INSTALL: saved alerts with no zone show America/Toronto as the one in force', async () => {
      const seen = mount({
        alerts: { quietHours: { enabled: true, start: '22:00', end: '07:00' } },
      });
      expect(
        await screen.findByText(/Using America\/Toronto, what quiet hours have always used/)
      ).toBeInTheDocument();
      expect(screen.getByText(/in America\/Toronto/)).toBeInTheDocument();
      expect(screen.queryByText(/Asia\/Tokyo/)).toBeNull();
      expect(seen.config.alerts.timezone).toBeUndefined();
    });

    it('choosing a zone saves it and the status line follows', async () => {
      const user = userEvent.setup();
      const seen = mount({
        alerts: { timezone: 'America/Toronto', quietHours: { enabled: true } },
      });
      await user.click(await screen.findByRole('combobox', { name: 'Time zone' }));
      await user.click(await screen.findByRole('option', { name: 'Europe/London' }));
      expect(seen.config.alerts.timezone).toBe('Europe/London');
      expect(screen.getByText(/in Europe\/London/)).toBeInTheDocument();
      expect(screen.queryByText(/in America\/Toronto/)).toBeNull();
    });

    it('offers this device’s zone with one click when it differs', async () => {
      const user = userEvent.setup();
      const real = Intl.DateTimeFormat.prototype.resolvedOptions;
      const system = real.call(new Intl.DateTimeFormat()).timeZone;
      vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function () {
        const o = real.call(this);
        // Only a formatter with no zone given (the device's own) reads as Auckland.
        return o.timeZone === system ? { ...o, timeZone: 'Pacific/Auckland' } : o;
      });
      const seen = mount({ alerts: { timezone: 'Asia/Tokyo', quietHours: { enabled: true } } });
      await user.click(
        await screen.findByRole('button', { name: 'Use this device’s zone (Pacific/Auckland)' })
      );
      expect(seen.config.alerts.timezone).toBe('Pacific/Auckland');
      expect(screen.queryByRole('button', { name: /Use this device/ })).toBeNull();
      vi.restoreAllMocks();
    });

    it('the picker offers only listed zones, UTC among them, and the saved one even if unlisted', async () => {
      const user = userEvent.setup();
      mount({ alerts: { timezone: 'Asia/Kolkata', quietHours: { enabled: true } } });
      await user.click(await screen.findByRole('combobox', { name: 'Time zone' }));
      expect(await screen.findByRole('option', { name: 'UTC' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Asia/Kolkata' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Mars/Olympus' })).toBeNull();
    });

    it('an alias of the saved zone is the same zone: no device-zone button, and the server note holds', async () => {
      view.serverTimezone = 'Asia/Calcutta';
      const real = Intl.DateTimeFormat.prototype.resolvedOptions;
      const system = real.call(new Intl.DateTimeFormat()).timeZone;
      vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function () {
        const o = real.call(this);
        return o.timeZone === system ? { ...o, timeZone: 'Asia/Calcutta' } : o;
      });
      mount({ alerts: { timezone: 'Asia/Kolkata', quietHours: { enabled: true } } });
      expect(await screen.findByText('This is the server’s time zone.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Use this device/ })).toBeNull();
      vi.restoreAllMocks();
    });

    it('a zone the server refuses shows its error, keeps the last good zone and saves nothing', async () => {
      const user = userEvent.setup();
      refuseZone.add('Europe/London');
      const seen = mount({ alerts: { timezone: 'UTC', quietHours: { enabled: true } } });
      const picker = await screen.findByRole('combobox', { name: 'Time zone' });
      await user.click(picker);
      await user.click(await screen.findByRole('option', { name: 'Europe/London' }));
      expect(
        await screen.findByText(/does not know that time zone.*Still using UTC/)
      ).toBeInTheDocument();
      expect(seen.config.alerts.timezone).toBe('UTC');
      expect(screen.getByText(/in UTC/)).toBeInTheDocument();
      // A later pick the server accepts still saves.
      await user.click(picker);
      await user.click(await screen.findByRole('option', { name: 'Asia/Tokyo' }));
      await waitFor(() => expect(seen.config.alerts.timezone).toBe('Asia/Tokyo'));
      expect(screen.queryByText(/Still using/)).toBeNull();
    });

    it('the zone note is tied to the picker', async () => {
      mount({ alerts: { quietHours: { enabled: true } } });
      const picker = await screen.findByRole('combobox', { name: 'Time zone' });
      const note = await screen.findByText(/Using America\/Toronto/);
      expect(picker.getAttribute('aria-describedby')).toContain(note.id);
    });

    it('when the server’s zone cannot be read it says so, instead of leaving the controls dead', async () => {
      viewFails = true;
      mount({});
      expect(
        await screen.findByText(/time zone could not be read. Reload the page./)
      ).toBeInTheDocument();
    });
  });
});
