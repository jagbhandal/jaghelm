import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { AttentionPanel } from '@ui/attention-panel';

// The mock's incident.
const ISSUES = [
  {
    id: 'immich',
    state: 'crit',
    word: 'Down',
    title: 'Immich',
    where: 'Service · Production (vm-103)',
    reason: 'Kuma: HTTP 502 for 4 min',
    age: '4 m',
  },
  {
    id: 'ups',
    state: 'crit',
    word: 'On battery',
    title: 'UPS',
    where: 'Power',
    reason: '82 % charge · about 31 min runtime left',
    age: '2 m',
  },
  {
    id: 'wiki',
    state: 'unknown',
    word: 'No signal',
    title: 'Wiki.js',
    where: 'Service · Production (vm-103)',
    reason: 'No heartbeat yet',
    age: '2 m',
  },
];

const incident = {
  state: 'crit',
  counts: '2 critical, 2 warnings, 1 no signal',
  subline: 'Immich is down and the UPS is on battery.',
};

describe('AttentionPanel', () => {
  it('names the overall state as the page heading, in its colour, with the counts after it', () => {
    render(<AttentionPanel {...incident} issues={ISSUES} />);
    const panel = screen.getByRole('region', { name: 'Needs attention' });
    expect(panel).toHaveClass('rounded-xl', 'border', 'bg-surface-1');
    const heading = within(panel).getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Critical · 2 critical, 2 warnings, 1 no signal');
    expect(heading).toHaveClass('text-headline');
    expect(within(heading).getByText('Critical')).toHaveClass('font-bold', 'text-crit-fg');
    expect(within(heading).getByText(/2 critical/)).toHaveClass('text-text-2', 'font-semibold');
    // The 14px lamp adds the shape; the word beside it names the state.
    const lamp = panel.querySelector('[data-slot="status-lamp"]');
    expect(lamp).toHaveAttribute('width', '14');
    expect(lamp).toHaveAttribute('data-shape', 'bar');
    expect(lamp).toHaveAttribute('aria-hidden', 'true');
    expect(within(panel).getByText('Immich is down and the UPS is on battery.')).toHaveClass(
      'text-text-2'
    );
  });

  it('lists the issues as rows that open what they name', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <AttentionPanel
        {...incident}
        issues={[{ ...ISSUES[0], onOpen }, { ...ISSUES[1], href: '/power' }, ISSUES[2]]}
      />
    );
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    await user.click(
      screen.getByRole('button', { name: 'Immich, Down, Service · Production (vm-103)' })
    );
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'UPS, On battery, Power' })).toHaveAttribute(
      'href',
      '/power'
    );
    // A row with nothing to open is content, not a control.
    expect(within(items[2]).queryByRole('button')).toBeNull();
    expect(screen.getByRole('list')).toHaveClass('divide-y', 'border-t');
  });

  it('shows the action, and the filter with Clear', async () => {
    const user = userEvent.setup();
    const onClearFilter = vi.fn();
    render(
      <AttentionPanel
        {...incident}
        issues={ISSUES.slice(0, 1)}
        action={<a href="#alerts">All alerts →</a>}
        filter="Services"
        onClearFilter={onClearFilter}
      />
    );
    expect(screen.getByRole('link', { name: 'All alerts →' })).toBeInTheDocument();
    expect(screen.getByText('Showing Services only')).toBeInTheDocument();
    expect(screen.queryByText(/needs attention$/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClearFilter).toHaveBeenCalledOnce();
  });

  it('says so, quietly, when the subsystem it is filtered to has nothing to show', () => {
    render(<AttentionPanel {...incident} issues={[]} filter="Jobs" onClearFilter={() => {}} />);
    const panel = screen.getByRole('region', { name: 'Needs attention' });
    expect(within(panel).getByText('Showing Jobs only')).toBeInTheDocument();
    expect(within(panel).getByText('Nothing in Jobs needs attention')).toHaveClass(
      'text-body-sm',
      'text-text-3'
    );
    expect(within(panel).queryByRole('list')).toBeNull();
  });

  it('is the quiet line when all is well: no green word, no list', () => {
    render(
      <AttentionPanel
        state="ok"
        counts="32 services up · 6 nodes healthy · backups on time"
        meta="Last incident 2 d ago"
      />
    );
    const line = screen.getByRole('region', { name: 'Status' });
    const heading = within(line).getByRole('heading', { level: 1, name: 'All systems normal' });
    expect(heading).toHaveClass('text-title-xs');
    expect(line.querySelector('.text-ok-fg')).toBeNull();
    // The heading says the state once; the lamp beside it is its shape only.
    const lamp = line.querySelector('[data-slot="status-lamp"]');
    expect(lamp).toHaveAttribute('data-shape', 'disc');
    expect(lamp).toHaveAttribute('aria-hidden', 'true');
    expect(within(line).queryByRole('img')).toBeNull();
    expect(within(line).getAllByText('All systems normal')).toHaveLength(1);
    expect(within(line).getByText('Last incident 2 d ago')).toHaveClass('ml-auto', 'text-caption');
    expect(screen.queryByRole('list')).toBeNull();
  });

  // #298: a filter from the subsystem strip on a quiet board still says so,
  // with its Clear, at the end of the line.
  it('says the filter on the quiet line too, with Clear', async () => {
    const user = userEvent.setup();
    const onClearFilter = vi.fn();
    render(
      <AttentionPanel
        state="ok"
        counts="All 12 services up · 3 nodes healthy"
        filter="Nodes"
        onClearFilter={onClearFilter}
      />
    );
    const line = screen.getByRole('region', { name: 'Status' });
    expect(within(line).getByRole('heading', { name: 'All systems normal' })).toBeInTheDocument();
    const note = within(line).getByText('Showing Nodes only');
    expect(note.parentElement).toHaveClass('ml-auto', 'text-body-sm', 'text-text-2');
    expect(screen.queryByText(/needs attention/)).toBeNull();
    await user.click(within(line).getByRole('button', { name: 'Clear' }));
    expect(onClearFilter).toHaveBeenCalledOnce();
  });

  // Spec §6.1: maintenance doesn't break the quiet line; the subsystem detail
  // under it ("1 in maintenance") says what is in maintenance.
  it('stays quiet for maintenance, which is never an issue, and not for a warning', () => {
    const { rerender } = render(
      <AttentionPanel state="maintenance" counts="32 services up · 1 in maintenance" />
    );
    const line = screen.getByRole('region', { name: 'Status' });
    expect(within(line).getByRole('heading', { name: 'All systems normal' })).toBeInTheDocument();
    expect(within(line).getByText('32 services up · 1 in maintenance')).toHaveClass('text-text-2');
    expect(within(line).queryByText('Maintenance')).toBeNull();
    const lamp = line.querySelector('[data-slot="status-lamp"]');
    expect(lamp).toHaveAttribute('data-shape', 'wrench');
    expect(lamp).toHaveAttribute('aria-hidden', 'true');
    expect(within(line).queryByRole('img')).toBeNull();
    rerender(<AttentionPanel state="warn" counts="1 warning" />);
    expect(screen.getByRole('region', { name: 'Needs attention' })).toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent('Warning · 1 warning');
  });

  // #449: with nothing set up the model's board is empty, its own overall
  // state: no issue, nothing silent, and no health anybody checked.
  it('is the quiet line when nothing is set up (empty): no lamp, no alarm, the sentence once', () => {
    const { rerender } = render(<AttentionPanel state="empty" counts="Nothing monitored yet" />);
    const line = screen.getByRole('region', { name: 'Status' });
    expect(line).toHaveAttribute('data-state', 'empty');
    const heading = within(line).getByRole('heading', { level: 1, name: 'Nothing monitored yet' });
    expect(heading).toHaveClass('text-title-xs');
    expect(within(line).getAllByText('Nothing monitored yet')).toHaveLength(1);
    // No state to show, so no lamp, and none of a state's words.
    expect(line.querySelector('[data-slot="status-lamp"]')).toBeNull();
    expect(line.querySelector('[data-slot="status-word"]')).toBeNull();
    expect(within(line).queryByText('No signal')).toBeNull();
    expect(within(line).queryByText('All systems normal')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Needs attention' })).toBeNull();
    // Without the sentence it says the same; with a word, the word heads it.
    rerender(<AttentionPanel state="empty" />);
    expect(screen.getByRole('heading', { name: 'Nothing monitored yet' })).toBeInTheDocument();
    rerender(<AttentionPanel state="empty" word="Set up JagHelm" counts="Nothing monitored yet" />);
    expect(screen.getByRole('heading', { name: 'Set up JagHelm' })).toBeInTheDocument();
    expect(screen.getByText('Nothing monitored yet')).toHaveClass('text-text-2');
  });

  it('takes another heading level', () => {
    render(<AttentionPanel state="crit" titleAs="h2" />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Critical');
  });
});

// #484: on a phone the Overview draws the panel in two parts around the
// subsystem strip (the Phone board: status card, strip, issue list). One
// panel, one region, its header and its rows; `between` sits between them.
describe('AttentionPanel split around `between` (#484)', () => {
  const LINKED = ISSUES.map((issue) => ({ ...issue, href: `#${issue.id}` }));
  const STRIP = (
    <section aria-label="Subsystems">
      <button type="button">Services</button>
      <button type="button">Nodes</button>
    </section>
  );
  const ALERTS = <a href="#alerts">All alerts</a>;
  // Where `a` is in the page against `b`: -1 before it, 1 after.
  const order = (a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;

  it('draws the header, then `between`, then the rows, in one region, two frames', () => {
    render(
      <AttentionPanel
        {...incident}
        titleAs="h2"
        action={ALERTS}
        issues={LINKED}
        between={STRIP}
        split
      />
    );
    const panel = screen.getByRole('region', { name: 'Needs attention' });
    expect(panel).toHaveAttribute('data-layout', 'split');
    const header = panel.querySelector('[data-slot="attention-panel-header"]');
    const rows = panel.querySelector('[data-slot="attention-panel-rows"]');
    const strip = within(panel).getByRole('region', { name: 'Subsystems' });
    expect(order(header, strip)).toBe(-1);
    expect(order(strip, rows)).toBe(-1);
    // The heading, the sentence and the action are the header's; the rows, the rows'.
    expect(within(header).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Critical · 2 critical, 2 warnings, 1 no signal'
    );
    expect(within(header).getByText(incident.subline)).toBeInTheDocument();
    expect(within(header).getByRole('link', { name: 'All alerts' })).toBeInTheDocument();
    expect(within(rows).getAllByRole('listitem')).toHaveLength(3);
    expect(within(header).queryByRole('list')).toBeNull();
    // Two cards, as the desktop panel's frame; the region itself draws none.
    for (const part of [header, rows]) {
      expect(part).toHaveClass('rounded-xl', 'border', 'border-border', 'bg-surface-1');
    }
    expect(panel).not.toHaveClass('border');
    expect(panel).not.toHaveClass('bg-surface-1');
    // The list is the top of its card: no second edge under the card's own.
    expect(within(rows).getByRole('list')).not.toHaveClass('border-t');
    // One region named "Needs attention"; the rows have the Phone board's
    // label, a heading a level under the panel's, so heading navigation
    // finds them after the strip.
    expect(screen.getAllByRole('region', { name: 'Needs attention' })).toHaveLength(1);
    const label = within(panel).getByRole('heading', { level: 3 });
    expect(label).toHaveTextContent('Needs attention · 3');
    expect(label).toHaveClass('text-overline', 'text-text-3', 'uppercase');
    expect(order(strip, label)).toBe(-1);
    expect(order(label, rows)).toBe(-1);
    expect(screen.getAllByRole('heading').map((h) => h.tagName)).toEqual(['H2', 'H3']);
  });

  it('labels the rows a level under the panel’s heading, counting what it lists', () => {
    const { rerender } = render(<AttentionPanel {...incident} issues={ISSUES} split />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Needs attention · 3');
    // Filtered to a subsystem with nothing, the label has no count: the note says so.
    rerender(<AttentionPanel {...incident} issues={[]} filter="Jobs" split />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/^Needs attention$/);
  });

  it('takes the focus header, then `between`, then the rows', async () => {
    const user = userEvent.setup();
    render(
      <AttentionPanel
        {...incident}
        titleAs="h2"
        action={ALERTS}
        issues={LINKED}
        between={STRIP}
        split
      />
    );
    const expected = [
      screen.getByRole('link', { name: 'All alerts' }),
      screen.getByRole('button', { name: 'Services' }),
      screen.getByRole('button', { name: 'Nodes' }),
      screen.getByRole('link', { name: /^Immich, Down/ }),
      screen.getByRole('link', { name: /^UPS, On battery/ }),
      screen.getByRole('link', { name: /^Wiki\.js, No signal/ }),
    ];
    for (const el of expected) {
      await user.tab();
      expect(el).toHaveFocus();
    }
  });

  it('unsplit, draws one frame as before, `between` after it, outside the region', () => {
    render(
      <AttentionPanel {...incident} titleAs="h2" action={ALERTS} issues={LINKED} between={STRIP} />
    );
    const panel = screen.getByRole('region', { name: 'Needs attention' });
    expect(panel).not.toHaveAttribute('data-layout');
    expect(panel).toHaveClass('overflow-hidden', 'rounded-xl', 'border', 'bg-surface-1');
    expect(panel.querySelector('[data-slot="attention-panel-header"]')).toBeNull();
    expect(panel.querySelector('[data-slot="attention-panel-rows"]')).toBeNull();
    // The rows' label is the phone's alone: one heading, as before.
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    const strip = screen.getByRole('region', { name: 'Subsystems' });
    expect(panel.contains(strip)).toBe(false);
    expect(panel.nextElementSibling).toBe(strip);
    expect(within(panel).getByRole('list')).toHaveClass('border-t');
  });

  it('puts "Showing … only" and Clear at the top of the rows, under `between`', async () => {
    const user = userEvent.setup();
    const onClearFilter = vi.fn();
    const { rerender } = render(
      <AttentionPanel
        {...incident}
        issues={LINKED.slice(0, 1)}
        filter="Services"
        onClearFilter={onClearFilter}
        between={STRIP}
        split
      />
    );
    const panel = screen.getByRole('region', { name: 'Needs attention' });
    const header = panel.querySelector('[data-slot="attention-panel-header"]');
    const rows = panel.querySelector('[data-slot="attention-panel-rows"]');
    expect(within(header).queryByText('Showing Services only')).toBeNull();
    const note = within(rows).getByText('Showing Services only');
    expect(order(note, within(rows).getByRole('list'))).toBe(-1);
    // Under the note, the list has its edge again.
    expect(within(rows).getByRole('list')).toHaveClass('border-t');
    await user.click(within(rows).getByRole('button', { name: 'Clear' }));
    expect(onClearFilter).toHaveBeenCalledOnce();

    // Filtered to a subsystem with nothing: the note says so, still under `between`.
    rerender(
      <AttentionPanel
        {...incident}
        issues={[]}
        filter="Jobs"
        onClearFilter={onClearFilter}
        between={STRIP}
        split
      />
    );
    const after = screen
      .getByRole('region', { name: 'Needs attention' })
      .querySelector('[data-slot="attention-panel-rows"]');
    expect(within(after).getByText('Showing Jobs only')).toBeInTheDocument();
    expect(within(after).getByText('Nothing in Jobs needs attention')).toBeInTheDocument();
    expect(order(screen.getByRole('region', { name: 'Subsystems' }), after)).toBe(-1);
  });

  it('has no rows card with nothing to list: the header, then `between`', () => {
    // A stale status that last said all was well: no signal, no rows.
    render(
      <AttentionPanel
        state="unknown"
        counts="last known 3 min ago: All systems normal"
        subline="Can't reach JagHelm"
        between={STRIP}
        split
      />
    );
    const panel = screen.getByRole('region', { name: 'Needs attention' });
    expect(panel.querySelector('[data-slot="attention-panel-rows"]')).toBeNull();
    const header = panel.querySelector('[data-slot="attention-panel-header"]');
    expect(header.nextElementSibling).toBe(screen.getByRole('region', { name: 'Subsystems' }));
  });

  it('keeps a stale status steel in both parts: the ring, "No signal", every row unknown', () => {
    render(
      <AttentionPanel
        state="unknown"
        counts="last known 3 min ago: Critical · 2 critical, 1 no signal"
        subline="Can't reach JagHelm"
        titleAs="h2"
        issues={LINKED.map((issue) => ({ ...issue, state: 'unknown' }))}
        between={STRIP}
        split
      />
    );
    const panel = screen.getByRole('region', { name: 'Needs attention' });
    expect(panel).toHaveAttribute('data-state', 'unknown');
    const header = panel.querySelector('[data-slot="attention-panel-header"]');
    expect(within(header).getByRole('heading', { level: 2 })).toHaveTextContent(
      'No signal · last known 3 min ago: Critical · 2 critical, 1 no signal'
    );
    const lamps = [...panel.querySelectorAll('[data-slot="status-lamp"]')];
    expect(lamps).toHaveLength(1 + LINKED.length);
    for (const lamp of lamps) expect(lamp).toHaveAttribute('data-state', 'unknown');
    expect(panel.querySelector('.text-crit-fg, .text-warn-fg, .text-ok-fg')).toBeNull();
  });

  it('draws `between` under the quiet line, unsplit', () => {
    render(
      <AttentionPanel state="ok" counts="All 12 services up · 3 nodes healthy" between={STRIP} />
    );
    const line = screen.getByRole('region', { name: 'Status' });
    const strip = screen.getByRole('region', { name: 'Subsystems' });
    expect(line.nextElementSibling).toBe(strip);
    expect(line.contains(strip)).toBe(false);
  });

  it("split and quiet, is the Phone board's healthy card, the sentence under its heading, `between` under it (#303)", () => {
    render(
      <AttentionPanel
        state="ok"
        counts="All 12 services up · 3 nodes healthy"
        meta="Updated 12 s ago"
        titleAs="h2"
        between={STRIP}
        split
      />
    );
    const panel = screen.getByRole('region', { name: 'Status' });
    const header = panel.querySelector('[data-slot="attention-panel-header"]');
    const strip = screen.getByRole('region', { name: 'Subsystems' });
    expect(within(header).getByRole('heading', { level: 2 })).toHaveTextContent(
      /^All systems normal$/
    );
    expect(header).toHaveTextContent('All 12 services up · 3 nodes healthy');
    expect(header).toHaveTextContent('Updated 12 s ago');
    expect(header.nextElementSibling).toBe(strip);
    expect(panel.querySelector('[data-slot="attention-panel-rows"]')).toBeNull();
    expect(within(panel).queryByRole('heading', { name: /Needs attention/ })).toBeNull();
  });

  it('split, an empty board is its sentence alone, with no lamp (#449, #303)', () => {
    render(<AttentionPanel state="empty" counts="Nothing monitored yet" titleAs="h2" split />);
    const panel = screen.getByRole('region', { name: 'Status' });
    expect(within(panel).getByRole('heading', { level: 2 })).toHaveTextContent(
      /^Nothing monitored yet$/
    );
    expect(panel.querySelector('[data-slot="status-lamp"]')).toBeNull();
    expect(panel.querySelectorAll('p')).toHaveLength(0);
  });
});
