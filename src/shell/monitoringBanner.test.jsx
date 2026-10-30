/**
 * The Monitoring page's banner and chart focus (#752): nothing above the charts
 * when healthy, a "View graph" row per issue a drawn chart answers, "N other
 * issues" for the rest, and `?focus=` scrolling to, ringing, tagging and
 * announcing the chart, clearing on Escape or a press, quiet for a chart not
 * drawn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { UiRoot } from '@ui/root';
import MonitoringPage from './MonitoringPage.jsx';
import { MonitoringBanner } from './MonitoringBanner.jsx';
import { HEALTHY, INCIDENT } from '../testing/statusFixtures.js';
import { demoMonitoring } from '../../server/demoFixtures.js';

const NOW = Date.now();
const store = (at = NOW) => ({ get: () => at, subscribe: () => () => {}, staleAfter: 72_000 });

/** The incident with a CPU warning on a node added: a reading the one drawn chart answers. */
function withCpu() {
  const base = INCIDENT.status ?? INCIDENT;
  const disk = base.issues.find((i) => i.id === 'nodes/vm103');
  const cpu = {
    ...disk,
    id: 'nodes/pi-2',
    name: 'pi-2',
    metric: { name: 'cpu', value: 93, unit: '%' },
    reason: 'CPU 93 % (warning above 90 % for 2 cycles)',
  };
  return { ...base, issues: [...base.issues, cpu] };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/monitoring');
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const u = new URL(String(url), 'http://x');
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

const page = (status) =>
  render(
    <UiRoot>
      <MonitoringPage updated={store()} status={status} reach="ok" />
    </UiRoot>
  );
const chart = () => document.querySelector('[data-chart="cpu-overview"]');
const banner = () => document.querySelector('[data-slot="monitoring-banner"]');

describe('the banner', () => {
  it('draws nothing when healthy: just the charts', async () => {
    page(HEALTHY.status ?? HEALTHY);
    await waitFor(() => expect(chart()).not.toBeNull());
    expect(banner()).toBeNull();
  });

  it('draws a row only for an issue whose chart is drawn: the UPS has Power draw, a disk has Disk runway', async () => {
    page(INCIDENT.status ?? INCIDENT);
    await waitFor(() => expect(banner()).not.toBeNull());
    const b = banner();
    const hrefs = within(b).getAllByRole('link', { name: /View graph/ }).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      expect.stringContaining('focus=power-draw'),
      '/monitoring?focus=disk-runway&issue=nodes%2Fvm103',
    ]);
    expect(b.querySelectorAll('[data-slot="issue-row"]')).toHaveLength(2);
  });

  it('with a CPU issue, its row has View graph to the chart, and the rest are "N other issues" to Alerts', async () => {
    page(withCpu());
    const b = await waitFor(() => {
      expect(banner()).not.toBeNull();
      return banner();
    });
    const rows = b.querySelectorAll('[data-slot="issue-row"]');
    expect(rows).toHaveLength(3); // the UPS (Power draw, #753), the disk (Disk runway, #754) and the CPU
    expect(within(b).getByRole('link', { name: /View graph: pi-2/ })).toHaveAttribute(
      'href',
      '/monitoring?focus=cpu-overview&issue=nodes%2Fpi-2'
    );
    // The word and counts are the banner's rows', not the board's.
    expect(within(b).getByText(/1 critical, 2 warnings/)).toBeInTheDocument();
    expect(within(b).getByText('2 other issues')).toBeInTheDocument();
    expect(within(b).getByRole('link', { name: /Alerts/ })).toHaveAttribute('href', '/alerts');
  });
});

describe('the focus', () => {
  it('View graph focuses the chart: scrolled to, keyboard focus, ring, tag with the reason, announced', async () => {
    page(withCpu());
    const link = await screen.findByRole('link', { name: /View graph: pi-2/ });
    fireEvent.click(link);
    await waitFor(() => expect(chart()).toHaveAttribute('data-focused'));
    expect(window.location.search).toBe('?focus=cpu-overview&issue=nodes%2Fpi-2');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: 'start',
      behavior: 'smooth',
    });
    expect(document.activeElement).toBe(chart());
    const tag = within(chart()).getByText(/CPU 93 %/);
    expect(tag.closest('[data-slot="monitoring-focus-tag"]')).not.toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/CPU by node: pi-2, .*CPU 93 %/);
  });

  it('from a cold load of the URL, the same', async () => {
    window.history.replaceState(null, '', '/monitoring?focus=cpu-overview');
    page(withCpu());
    await waitFor(() => expect(chart()).toHaveAttribute('data-focused'));
    expect(document.activeElement).toBe(chart());
  });

  it('is scrolled once per address: a refresh of the charts does not scroll it back', async () => {
    window.history.replaceState(null, '', '/monitoring?focus=cpu-overview');
    page(withCpu());
    await waitFor(() => expect(chart()).toHaveAttribute('data-focused'));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('reduced motion scrolls at once', async () => {
    vi.stubGlobal('matchMedia', (q) => ({
      matches: q.includes('reduce'),
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }));
    window.history.replaceState(null, '', '/monitoring?focus=cpu-overview');
    page(withCpu());
    await waitFor(() => expect(chart()).toHaveAttribute('data-focused'));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: 'start',
      behavior: 'auto',
    });
  });

  it('tags the issue the link named, with its entity, not the first that maps', async () => {
    const status = withCpu();
    status.issues.push({
      ...status.issues.at(-1),
      id: 'nodes/pi-3',
      name: 'pi-3',
      reason: 'CPU 95 %',
    });
    window.history.replaceState(null, '', '/monitoring?focus=cpu-overview&issue=nodes%2Fpi-3');
    page(status);
    await waitFor(() => expect(chart()).toHaveAttribute('data-focused'));
    expect(within(chart()).getByText(/pi-3 · .*CPU 95 %/)).toBeInTheDocument();
  });

  it('says it once per focus: a new reading does not re-announce', async () => {
    window.history.replaceState(null, '', '/monitoring?focus=cpu-overview');
    const ui = (status) => (
      <UiRoot>
        <MonitoringPage updated={store()} status={status} reach="ok" />
      </UiRoot>
    );
    const { rerender } = render(ui(withCpu()));
    await waitFor(() => expect(chart()).toHaveAttribute('data-focused'));
    const first = screen.getByRole('status').textContent;
    const next = withCpu();
    next.issues.at(-1).reason = 'CPU 97 %';
    rerender(ui(next));
    expect(screen.getByRole('status').textContent).toBe(first);
  });

  it('Escape already handled elsewhere does not clear it', async () => {
    window.history.replaceState(null, '', '/monitoring?focus=cpu-overview');
    page(withCpu());
    await waitFor(() => expect(chart()).toHaveAttribute('data-focused'));
    const e = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    e.preventDefault();
    act(() => {
      document.dispatchEvent(e);
    });
    expect(chart()).toHaveAttribute('data-focused');
  });

  it('Escape clears the ring and the address', async () => {
    window.history.replaceState(null, '', '/monitoring?focus=cpu-overview');
    page(withCpu());
    await waitFor(() => expect(chart()).toHaveAttribute('data-focused'));
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    await waitFor(() => expect(chart()).not.toHaveAttribute('data-focused'));
    expect(window.location.search).toBe('');
    expect(within(chart()).queryByText(/CPU 93 %/)).toBeNull();
  });

  it('a press anywhere clears it', async () => {
    window.history.replaceState(null, '', '/monitoring?focus=cpu-overview');
    page(withCpu());
    await waitFor(() => expect(chart()).toHaveAttribute('data-focused'));
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(chart()).not.toHaveAttribute('data-focused'));
    expect(window.location.search).toBe('');
  });

  it('with no issue for the chart, it is ringed with no tag', async () => {
    window.history.replaceState(null, '', '/monitoring?focus=cpu-overview');
    page(HEALTHY.status ?? HEALTHY);
    await waitFor(() => expect(chart()).toHaveAttribute('data-focused'));
    expect(chart().querySelector('[data-slot="monitoring-focus-tag"]')).toBeNull();
  });

  it('a chart that is not drawn is quiet: no ring, no error, the page as it was', async () => {
    window.history.replaceState(null, '', '/monitoring?focus=network');
    page(withCpu());
    await waitFor(() => expect(chart()).not.toBeNull());
    expect(document.querySelector('[data-focused]')).toBeNull();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(document.querySelector('[data-slot="monitoring-error"]')).toBeNull();
  });
});

describe('MonitoringBanner', () => {
  it('follows the stale rule: an old status is no signal, its rows kept with their words', () => {
    render(
      <UiRoot>
        <MonitoringBanner
          status={withCpu()}
          reach="ok"
          updated={store(Date.now() - 3_600_000)}
          drawn={new Set(['cpu-overview'])}
        />
      </UiRoot>
    );
    const b = banner();
    expect(within(b).getByRole('heading', { level: 2 })).toHaveTextContent(
      /No signal.*last known.*Warning · 1 warning/
    );
    expect(b.querySelector('[data-state="unknown"]')).not.toBeNull();
    expect(within(b).getByRole('link', { name: /View graph: pi-2/ })).toBeInTheDocument();
  });

  it('draws a link only for an issue whose chart is in `drawn`', () => {
    const status = INCIDENT.status ?? INCIDENT;
    render(
      <UiRoot>
        <MonitoringBanner
          status={status}
          reach="ok"
          updated={store()}
          drawn={new Set(['disk-runway'])}
        />
      </UiRoot>
    );
    const links = screen.getAllByRole('link', { name: /View graph/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/monitoring?focus=disk-runway&issue=nodes%2Fvm103');
  });
});
