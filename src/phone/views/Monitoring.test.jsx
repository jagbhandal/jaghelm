/**
 * Monitoring on a phone (#755): the title and the 44px range switch, the same
 * banner and "View graph" as the wide page, list rows where it has small
 * multiples, the power and runway charts in the one column, and a chart with
 * no phone drawing said in words (never a blank Panel), its issue left to the
 * banner's "N other issues".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { UiRoot } from '@ui/root';
import Monitoring from './Monitoring.jsx';
import { DRAWINGS } from '../../shell/monitoring.js';
import { PHONE_DRAWINGS } from '../../shell/monitoringPhone.jsx';
import { HEALTHY, INCIDENT } from '../../testing/statusFixtures.js';
import MonitoringPage from '../../shell/MonitoringPage.jsx';
import { resetMonitoringRange } from '../../shell/useMonitoringRange.js';
import { demoMonitoring } from '../../../server/demoFixtures.js';

const NOW = Date.now();
const store = () => ({ get: () => NOW, subscribe: () => () => {}, staleAfter: 72_000 });
let asked;

beforeEach(() => {
  asked = [];
  resetMonitoringRange();
  window.history.replaceState(null, '', '/monitoring');
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const u = new URL(String(url), 'http://x');
      asked.push(u.pathname + u.search);
      const body = demoMonitoring({ query: { range: u.searchParams.get('range') }, now: NOW }).body;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      });
    })
  );
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete Element.prototype.scrollIntoView;
});

const draw = (status) =>
  render(
    <UiRoot>
      <Monitoring updated={store()} status={status} reach="ok" />
    </UiRoot>
  );
const chart = (id) => document.querySelector(`[data-chart="${id}"]`);

describe('the phone Monitoring page', () => {
  it('names itself, with a 44px range switch that reads the range chosen', async () => {
    draw(HEALTHY.status ?? HEALTHY);
    expect(screen.getByRole('heading', { level: 1, name: 'Monitoring' })).toBeTruthy();
    const range = screen.getByRole('radiogroup', { name: 'Range' });
    expect(range.getAttribute('data-size')).toBe('touch');
    await waitFor(() => expect(chart('cpu-overview')).not.toBeNull());
    fireEvent.click(within(range).getByRole('radio', { name: '24 h' }));
    await waitFor(() => expect(asked).toContain('/api/monitoring?range=24h'));
  });

  it('draws CPU as list rows, and power, cost and runway in the column', async () => {
    draw(HEALTHY.status ?? HEALTHY);
    await waitFor(() => expect(chart('cpu-overview')).not.toBeNull());
    expect(chart('cpu-overview').querySelector('[data-variant="phone"]')).not.toBeNull();
    for (const id of ['power-draw', 'monthly-cost', 'disk-runway']) {
      expect(chart(id), id).not.toBeNull();
      expect(chart(id).querySelector('[data-slot="monitoring-phone-not-yet"]'), id).toBeNull();
    }
  });

  it('draws memory as rows with swap said, and network as one chart in the column (#759)', async () => {
    draw(HEALTHY.status ?? HEALTHY);
    await waitFor(() => expect(chart('memory')).not.toBeNull());
    expect(chart('memory').querySelector('[data-variant="phone"]')).not.toBeNull();
    expect(chart('memory').querySelector('[data-slot="small-multiples-aside"]')).not.toBeNull();
    expect(chart('network').querySelector('[data-slot="chart"], [data-slot="area-chart"]')).not.toBeNull();
    for (const id of ['memory', 'network']) {
      expect(chart(id).querySelector('[data-slot="monitoring-phone-not-yet"]'), id).toBeNull();
    }
  });
  it('draws the growers, the restart strip and the drives as list rows, none as "on a larger screen" (#763)', async () => {
    draw(HEALTHY.status ?? HEALTHY);
    await waitFor(() => expect(chart('drives')).not.toBeNull());
    for (const id of ['container-growth', 'restarts', 'drives']) {
      expect(Object.hasOwn(PHONE_DRAWINGS, id), id).toBe(true);
      expect(chart(id).querySelector('[data-slot="monitoring-phone-not-yet"]'), id).toBeNull();
    }
    // The drives are list rows, never the table that scrolls sideways.
    expect(chart('drives').querySelector('table')).toBeNull();
    expect(chart('drives').querySelector('[data-slot="drive-list"]')).not.toBeNull();
  });

  it('says in words that a chart without a phone drawing is on a larger screen', async () => {
    draw(HEALTHY.status ?? HEALTHY);
    await waitFor(() => expect(chart('drives')).not.toBeNull());
    for (const id of Object.keys(DRAWINGS).filter((id) => !Object.hasOwn(PHONE_DRAWINGS, id))) {
      expect(chart(id).textContent, id).toContain('Open Monitoring on a larger screen');
    }
  });

  it('draws the banner with View graph for a chart drawn here, and counts the rest as other issues', async () => {
    draw(INCIDENT.status ?? INCIDENT);
    const banner = await waitFor(() => {
      const el = document.querySelector('[data-slot="monitoring-banner"]');
      expect(el).not.toBeNull();
      return el;
    });
    const hrefs = within(banner)
      .getAllByRole('link', { name: /View graph/ })
      .map((a) => a.getAttribute('href'));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const id = new URL(href, 'http://x').searchParams.get('focus');
      expect(Object.keys(PHONE_DRAWINGS)).toContain(id);
    }
  });

  it('focuses and rings the chart a View graph link names', async () => {
    window.history.replaceState(null, '', '/monitoring?focus=disk-runway&issue=nodes%2Fvm103');
    draw(INCIDENT.status ?? INCIDENT);
    await waitFor(() => expect(chart('disk-runway')?.hasAttribute('data-focused')).toBe(true));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  // #807: a memory issue's View graph opens the node's sheet, as a temperature issue opens the drill-down.
  it('a memory issue\'s View graph rings the row and opens its sheet with both lines', async () => {
    const base = INCIDENT.status ?? INCIDENT;
    const disk = base.issues.find((i) => i.id === 'nodes/vm103');
    const mem = {
      ...disk,
      id: 'nodes/apps',
      name: 'apps',
      node: 'apps',
      metric: { name: 'mem', value: 93, unit: '%' },
      reason: 'Memory 93 %',
    };
    window.history.replaceState(null, '', '/monitoring?focus=memory&issue=nodes%2Fapps');
    draw({ ...base, issues: [...base.issues, mem] });
    await waitFor(() => expect(chart('memory')?.hasAttribute('data-focused')).toBe(true));
    const sheet = await screen.findByRole('dialog');
    // A PhoneSheet since #833: the dialog holds the memory drill-down.
    expect(sheet.getAttribute('data-slot')).toBe('phone-sheet');
    expect(sheet.querySelector('[data-drill="memory"]')).not.toBeNull();
    expect(within(sheet).getByText('apps')).toBeTruthy();
  });

  // #833: a press inside the sheet clears the ring (replacing the sheet's entry's URL);
  // closing the sheet then goes back to the View graph's entry, which must not reopen it.
  for (const how of ['the sheet’s Back', 'the browser’s Back', 'Escape']) {
    it(`View graph, a press inside, then ${how}: the sheet closes and stays closed`, async () => {
      const base = INCIDENT.status ?? INCIDENT;
      const disk = base.issues.find((i) => i.id === 'nodes/vm103');
      const mem = { ...disk, id: 'nodes/apps', name: 'apps', node: 'apps', metric: { name: 'mem', value: 93, unit: '%' }, reason: 'Memory 93 %' };
      window.history.pushState(null, '', '/monitoring?focus=memory&issue=nodes%2Fapps');
      draw({ ...base, issues: [...base.issues, mem] });
      const sheet = await screen.findByRole('dialog', { name: 'apps' });
      const back = within(sheet).getByRole('button', { name: 'Back' });
      if (how === 'Escape') fireEvent.keyDown(sheet, { key: 'Escape' });
      else fireEvent.pointerDown(back);
      if (how === 'the browser’s Back') window.history.back();
      else if (how === 'Escape') fireEvent(sheet, new Event('cancel', { cancelable: true }));
      else fireEvent.click(back);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await new Promise((r) => setTimeout(r, 200));
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  }

  // #802: the range survives the swap between the phone and the wide tree at 768px.
  it('keeps the chosen range when the wide page takes over, and back', async () => {
    const first = draw(HEALTHY.status ?? HEALTHY);
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Range' })).getByRole('radio', { name: '7 d' })
    );
    first.unmount();
    const wide = render(
      <UiRoot>
        <MonitoringPage updated={store()} status={HEALTHY.status ?? HEALTHY} reach="ok" />
      </UiRoot>
    );
    const checked = () =>
      within(screen.getByRole('radiogroup', { name: 'Range' })).getByRole('radio', { checked: true });
    expect(checked().textContent).toContain('7 d');
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Range' })).getByRole('radio', { name: '24 h' })
    );
    wide.unmount();
    draw(HEALTHY.status ?? HEALTHY);
    expect(checked().textContent).toContain('24 h');
  });
});
