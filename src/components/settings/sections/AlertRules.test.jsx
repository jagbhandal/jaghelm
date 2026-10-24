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
beforeEach(() => {
  calls = [];
  view = { held: 0, snoozed: [], acked: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, opts = {}) => {
      const method = opts.method ?? 'GET';
      calls.push({ method, url, body: opts.body ? JSON.parse(opts.body) : undefined });
      if (url === '/api/push/alerts') return Response.json(view);
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
      screen.getByText(/(Quiet now, until|Not quiet now\. From 22:00 to 07:00 Toronto time)/)
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
    await user.click(screen.getByRole('combobox', { name: 'Group a burst of alerts' }));
    await user.click(await screen.findByRole('option', { name: 'Off: each alert on its own' }));
    expect(seen.config.alerts.groupWindowSeconds).toBe(0);
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
});
