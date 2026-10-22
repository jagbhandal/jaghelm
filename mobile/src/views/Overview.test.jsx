import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import Overview from './Overview.jsx';
import { STALE, UPS_ONLINE, boardOf, inputs, monitored, node } from '../testing/board.js';

// A node with `downCount` services down (Kuma) and one up.
function makeData(downCount, extra = {}) {
  const services = [];
  for (let i = 0; i < downCount; i++) {
    services.push(monitored(`vm-101:s${i}`, 'down', { display_name: `Svc ${i}`, url: `http://h/s${i}` }));
  }
  services.push(monitored('vm-101:ok', 'up', { display_name: 'Ok' }));
  return boardOf(
    inputs({ nodes: { 'vm-101': node({}, { display_name: 'VM 101', services }) }, ups: UPS_ONLINE }),
    extra
  );
}

describe('Overview, on the status model (#325)', () => {
  it('renders the status card, a cell per subsystem with anything, and the issues (no per-node bars — Bug #10)', () => {
    render(<Overview data={makeData(1)} nav={{ push: vi.fn() }} />);
    expect(document.querySelector('.sys-status-card')).not.toBeNull();
    // Services, Nodes and Power have something; Jobs, Backups and Integrations don't.
    expect([...document.querySelectorAll('.subsystem-cell__label')].map((l) => l.textContent)).toEqual([
      'Services',
      'Nodes',
      'Power',
    ]);
    expect(document.querySelector('.issue-row__name').textContent).toBe('Svc 0');
    expect(document.querySelector('.usage-bar')).toBeNull();
  });

  it('down → red card with the model\'s word and counts, the sentence, Services DOWN, a row with its reason', () => {
    render(<Overview data={makeData(2)} nav={{ push: vi.fn() }} />);
    expect(document.querySelector('.sys-status-card__headline').textContent).toBe('Critical · 2 critical');
    const word = document.querySelector('.sys-status-card__word');
    expect(word.textContent).toBe('Critical');
    expect(word.className).toMatch(/sys-status-card__word--critical/);
    expect(document.querySelector('.sys-status-card__subline').textContent).toBe('2 services down');

    const svcCell = screen.getByText('Services').closest('.subsystem-cell');
    expect(svcCell.className).toMatch(/subsystem-cell--critical/);
    expect(within(svcCell).getByText('DOWN')).toBeInTheDocument();
    expect(within(svcCell).getByText('1 / 3')).toHaveClass('subsystem-cell__value');
    expect(within(svcCell).getByText('up')).toHaveClass('subsystem-cell__sub');

    // Every row says where it is and the model's reason.
    const row = screen.getByText('Svc 0').closest('.issue-row');
    expect(row.className).toMatch(/issue-row--critical/);
    expect(within(row).getByText('Service · vm-101')).toBeInTheDocument();
    expect(within(row).getByText('Kuma: down')).toBeInTheDocument();
  });

  it('tapping a down issue row pushes that service\'s detail screen (#279)', () => {
    const push = vi.fn();
    render(<Overview data={makeData(2)} nav={{ push }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Svc 1, Down, Service · vm-101' }));
    expect(push).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith('serviceDetail', { uid: 'vm-101:s1' });
  });

  it('healthy → "All systems normal" and the model\'s sentence, the 🌙 clear state, no issue rows', () => {
    render(<Overview data={makeData(0)} nav={{ push: vi.fn() }} />);
    expect(document.querySelector('.sys-status-card__headline').textContent).toBe('All systems normal');
    expect(document.querySelector('.sys-status-card__word')).toBeNull();
    expect(document.querySelector('.sys-status-card__subline').textContent).toBe(
      '1 service up · 1 node healthy'
    );
    expect(screen.getByText(/Nothing on fire/)).toBeInTheDocument();
    expect(document.querySelector('.issue-row')).toBeNull();
  });

  it('the Power cell draws the model\'s value and sub-line, and adds the runtime the model doesn\'t carry', () => {
    const power = () => [...document.querySelectorAll('.subsystem-cell')].find(
      (c) => c.querySelector('.subsystem-cell__label').textContent === 'Power'
    );
    const lines = () => [
      power().querySelector('.subsystem-cell__value').textContent,
      power().querySelector('.subsystem-cell__sub').textContent,
    ];
    // On mains: the model's charge is the sub-line (#541), so no readings line repeats it.
    const mains = render(<Overview data={makeData(0)} nav={{ push: vi.fn() }} />);
    expect(lines()).toEqual(['On mains', '100 % charge']);
    expect(power().querySelector('.subsystem-cell__readings')).toBeNull();
    mains.unmount();
    // On battery: the runtime left (the model's sub-line has the charge already).
    const onBattery = boardOf(
      inputs({ nodes: { 'vm-101': node({}, { display_name: 'VM 101' }) }, ups: { ...UPS_ONLINE, status: 2, charge: 47.6, runtime: 480 } })
    );
    const battery = render(<Overview data={onBattery} nav={{ push: vi.fn() }} />);
    expect(lines()).toEqual(['On battery', '47 % charge']);
    expect(power().querySelector('.subsystem-cell__readings').textContent).toBe('8 min left');
    battery.unmount();
    // /api/ups didn't answer: no readings line, the model's two lines alone.
    render(<Overview data={{ ...onBattery, ups: null }} nav={{ push: vi.fn() }} />);
    expect(power().querySelector('.subsystem-cell__readings')).toBeNull();
  });

  it('from a server before #541 (no value or sub-line), the Power cell still shows its charge on mains', () => {
    // That server's model: no `value` or `sub` on a subsystem, no charge on a UPS on mains.
    const data = makeData(0);
    for (const s of data.status.subsystems) {
      delete s.value;
      delete s.sub;
    }
    delete data.status.entities.find((e) => e.id === 'power/ups').metric;
    render(<Overview data={data} nav={{ push: vi.fn() }} />);
    const power = [...document.querySelectorAll('.subsystem-cell')].find(
      (c) => c.querySelector('.subsystem-cell__label').textContent === 'Power'
    );
    expect(power.querySelector('.subsystem-cell__value').textContent).toBe('On mains');
    expect(power.querySelector('.subsystem-cell__sub')).toBeNull();
    expect(power.querySelector('.subsystem-cell__readings').textContent).toBe('100% charge');
  });

  it('stale (#480) → steel "No signal" card with why and what it last knew; cells and rows keep their words, drawn as no signal', () => {
    const stale = makeData(1, { error: new Error('fetch failed'), freshness: STALE });
    render(<Overview data={stale} nav={{ push: vi.fn() }} />);

    expect(document.querySelector('.sys-status-card').className).toMatch(/sys-status-card--unknown/);
    expect(document.querySelector('.sys-status-card__headline').textContent).toBe('No signal');
    expect(document.querySelector('.sys-status-card__subline').textContent).toBe("Can't reach JagHelm");
    expect(document.querySelector('.sys-status-card__counts').textContent).toBe(
      'last known 3 min ago: Critical · 1 critical'
    );

    // Never green, amber or red: every cell and row is steel, its last known word kept.
    const svcCell = screen.getByText('Services').closest('.subsystem-cell');
    expect(within(svcCell).getByText('DOWN')).toBeInTheDocument();
    expect(document.querySelectorAll('.subsystem-cell--unknown')).toHaveLength(3);
    expect(document.querySelector('.issue-row').className).toMatch(/issue-row--unknown/);
    expect(document.querySelector('[class*="--critical"], [class*="--healthy"], [class*="--caution"]')).toBeNull();

    expect(screen.getByRole('alert').textContent).toMatch(/Couldn't reach JagHelm/);
    expect(screen.queryByText(/Nothing on fire/)).toBeNull();
  });

  it('no status at all, out of reach → steel card with why, the error banner', () => {
    const noData = { status: null, servicesBody: null, loading: false, error: new Error('fail'), freshness: STALE };
    render(<Overview data={noData} nav={{ push: vi.fn() }} />);
    expect(document.querySelector('.sys-status-card__headline').textContent).toBe('No signal');
    expect(document.querySelector('.sys-status-card__subline').textContent).toBe("Can't reach JagHelm");
    expect(document.querySelectorAll('.subsystem-cell')).toHaveLength(0);
    expect(screen.getByRole('alert').textContent).toBe("Couldn't reach JagHelm");
  });

  it('loading with no data → Connecting… and Loading…, no clear state', () => {
    const loadingData = { status: null, servicesBody: null, loading: true, error: null };
    render(<Overview data={loadingData} nav={{ push: vi.fn() }} />);
    expect(document.querySelector('.sys-status-card__subline').textContent).toBe('Connecting…');
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing on fire/)).toBeNull();
  });

  it('an empty board (#449) → the quiet first-run line, never no signal or healthy, and no cells', () => {
    const empty = boardOf(
      inputs({
        nodes: {},
        services: { nodes: {}, overallHealth: 'unknown', sources: { prometheus: { ok: true } } },
        ups: { status: null, charge: null, runtime: null, load: null, ok: true, configured: false, model: null },
      })
    );
    expect(empty.status.overall.state).toBe('empty');
    render(<Overview data={empty} nav={{ push: vi.fn() }} />);
    const card = document.querySelector('.sys-status-card');
    expect(card.className).toMatch(/sys-status-card--empty/);
    expect(card.querySelector('.sys-status-card__headline').textContent).toBe('Nothing monitored yet');
    expect(card.querySelector('.sys-status-card__word')).toBeNull();
    expect(document.querySelectorAll('.subsystem-cell')).toHaveLength(0);
    expect(screen.queryByText(/Nothing on fire|No active issues/)).toBeNull();
  });
});
