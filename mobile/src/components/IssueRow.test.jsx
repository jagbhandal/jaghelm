import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IssueRow } from '@ui/issue-row';

const HERE = dirname(fileURLToPath(import.meta.url));

// The issue-row rules in MobileApp.css as [selector, declarations] pairs. The
// stylesheet is read as text, not imported (scripts/ui-stack.test.mjs).
function issueRowRules() {
  const css = readFileSync(resolve(HERE, '..', 'MobileApp.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // The last two parts of each chunk are a rule's selector and body, even when an
  // @media block opens in front of it.
  return css.split('}')
    .map((chunk) => chunk.split('{').slice(-2).map((part) => part.trim()))
    .filter(([selector, body]) => body !== undefined && selector.includes('.issue-row'));
}

/** A service that is DOWN (severity=critical, shape=slash). */
const downIncident = {
  id: 'service:abc123',
  kind: 'service',
  title: 'jellyfin',
  node: 'vm-103',
  cause: 'Service is down',
  uptime24: null,
  status: 'down',
  severity: 'critical',
  word: 'DOWN',
  shape: 'slash',
  readout: 'vm-103',
  target: { kind: 'service', uid: 'abc123', url: '' },
};

/** UPS on battery (severity=caution, shape=bolt). */
const upsIncident = {
  id: 'ups:apcups',
  kind: 'ups',
  title: 'UPS on battery',
  node: 'UPS',
  cause: 'On battery — 47% charge',
  uptime24: null,
  status: 'down',
  severity: 'caution',
  word: 'ON BATTERY',
  shape: 'bolt',
  readout: '47% · 8m',
  target: { kind: 'ups' },
};

/** Tracked-unknown service (severity=unknown, shape=ring). */
const unknownIncident = {
  id: 'unknown:xyz',
  kind: 'unknown',
  title: 'vaultwarden',
  node: 'vm-101',
  cause: 'No signal',
  uptime24: null,
  status: 'unknown',
  severity: 'unknown',
  word: 'UNKN',
  shape: 'ring',
  readout: 'vm-101 · no signal',
  target: { kind: 'service', uid: 'xyz', url: '' },
};

/** Cron failure (severity=caution, shape=slash). */
const cronIncident = {
  id: 'cron:vm-101:backup-daily',
  kind: 'cron',
  title: 'backup-daily failed',
  node: 'vm-101',
  cause: 'Exit code 1',
  uptime24: null,
  status: 'down',
  severity: 'caution',
  word: 'FAILED',
  shape: 'slash',
  readout: 'vm-101',
  target: { kind: 'cron', job: 'backup-daily' },
};

describe('IssueRow', () => {
  describe('basic rendering', () => {
    it('renders the status word via StatusWord', () => {
      const { container } = render(<IssueRow incident={downIncident} />);
      // Use .status-word selector to avoid matching the SVG <title> accessibility element
      const statusWord = container.querySelector('.status-word');
      expect(statusWord).not.toBeNull();
      expect(statusWord.textContent).toBe('DOWN');
    });

    it('renders the service name (DM Sans prose)', () => {
      render(<IssueRow incident={downIncident} />);
      expect(screen.getByText('jellyfin')).toBeInTheDocument();
    });

    it('renders the mono readout', () => {
      render(<IssueRow incident={downIncident} />);
      expect(screen.getByText('vm-103')).toBeInTheDocument();
    });

    it('renders a StatusLamp with the correct severity class', () => {
      const { container } = render(<IssueRow incident={downIncident} />);
      const svg = container.querySelector('svg.status-lamp');
      expect(svg).not.toBeNull();
      expect(svg.classList.contains('lamp--critical')).toBe(true);
    });

    it('renders without crashing when onOpen is not provided', () => {
      const { container } = render(<IssueRow incident={downIncident} />);
      expect(container.firstChild).not.toBeNull();
    });
  });

  describe('down row — cause is shown + no invented age', () => {
    it('shows the prose cause line for a critical (down) incident', () => {
      render(<IssueRow incident={downIncident} />);
      expect(screen.getByText('Service is down')).toBeInTheDocument();
    });

    it('readout for a down row is the node name only — no minutes/duration pattern', () => {
      render(<IssueRow incident={downIncident} />);
      const readoutEl = screen.getByText('vm-103');
      // Must not contain a duration like "12m", "5 min", or a clock "HH:MM"
      expect(readoutEl.textContent).not.toMatch(/\d+m\b/);
      expect(readoutEl.textContent).not.toMatch(/\d+\s*min/i);
      expect(readoutEl.textContent).not.toMatch(/\d+:\d{2}/);
      // Must not contain words for time
      expect(readoutEl.textContent).not.toMatch(/ago|since|duration/i);
    });

    it('the readout element is specifically the node name string', () => {
      render(<IssueRow incident={downIncident} />);
      const readoutEl = screen.getByText('vm-103');
      expect(readoutEl.textContent).toBe('vm-103');
    });
  });

  describe('cause NOT shown for non-critical rows', () => {
    it('cause is NOT rendered for a caution (UPS) incident', () => {
      render(<IssueRow incident={upsIncident} />);
      // The cause string exists on the incident but must not appear in the DOM
      expect(screen.queryByText('On battery — 47% charge')).toBeNull();
    });

    it('cause is NOT rendered for a caution (cron) incident', () => {
      render(<IssueRow incident={cronIncident} />);
      expect(screen.queryByText('Exit code 1')).toBeNull();
    });

    it('cause is NOT rendered for an unknown incident', () => {
      render(<IssueRow incident={unknownIncident} />);
      expect(screen.queryByText('No signal')).toBeNull();
    });
  });

  describe('UPS row readout', () => {
    it('renders the UPS readout as "{charge}% · {runtime}"', () => {
      render(<IssueRow incident={upsIncident} />);
      expect(screen.getByText('47% · 8m')).toBeInTheDocument();
    });

    it('renders the ON BATTERY status word', () => {
      const { container } = render(<IssueRow incident={upsIncident} />);
      const statusWord = container.querySelector('.status-word');
      expect(statusWord).not.toBeNull();
      expect(statusWord.textContent).toBe('ON BATTERY');
    });

    it('UPS lamp uses bolt shape (path, no circle)', () => {
      const { container } = render(<IssueRow incident={upsIncident} />);
      const svg = container.querySelector('svg.status-lamp');
      expect(svg).not.toBeNull();
      expect(svg.classList.contains('lamp--caution')).toBe(true);
      // bolt has a path
      expect(container.querySelector('path')).not.toBeNull();
      expect(container.querySelector('circle')).toBeNull();
    });
  });

  describe('unknown row', () => {
    it('renders the UNKN status word', () => {
      const { container } = render(<IssueRow incident={unknownIncident} />);
      const statusWord = container.querySelector('.status-word');
      expect(statusWord).not.toBeNull();
      expect(statusWord.textContent).toBe('UNKN');
    });

    it('renders the no-signal readout', () => {
      render(<IssueRow incident={unknownIncident} />);
      expect(screen.getByText('vm-101 · no signal')).toBeInTheDocument();
    });

    it('unknown lamp uses ring shape (hollow circle)', () => {
      const { container } = render(<IssueRow incident={unknownIncident} />);
      const circle = container.querySelector('circle');
      expect(circle).not.toBeNull();
      expect(circle.getAttribute('fill')).toBe('none');
    });
  });

  describe('onOpen callback', () => {
    // The caller owns the route (Overview, via nav/issueRoute.js), so the row
    // passes nothing back.
    it('calls onOpen with no argument when the row is clicked', () => {
      const onOpen = vi.fn();
      render(<IssueRow incident={downIncident} onOpen={onOpen} />);
      fireEvent.click(screen.getByRole('button'));
      expect(onOpen).toHaveBeenCalledOnce();
      expect(onOpen).toHaveBeenCalledWith();
    });
  });

  // #279: a row that opens something is a button named after what it opens; a
  // row with nothing to open must not look or announce as tappable.
  describe('interactive vs non-interactive (#279)', () => {
    it('with onOpen the row is a focusable button named title, word, readout', () => {
      render(<IssueRow incident={downIncident} onOpen={vi.fn()} />);
      const row = screen.getByRole('button', { name: 'jellyfin, DOWN, vm-103' });
      row.focus();
      expect(row).toHaveFocus();
    });

    it('the accessible name spells out UNKN; the visible word stays UNKN', () => {
      const { container } = render(<IssueRow incident={unknownIncident} onOpen={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'vaultwarden, unknown, vm-101 · no signal' })).toBeInTheDocument();
      expect(container.querySelector('.status-word').textContent).toBe('UNKN');
    });

    it('the accessible name leaves out an empty readout', () => {
      render(<IssueRow incident={{ ...upsIncident, readout: '' }} onOpen={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'UPS on battery, ON BATTERY' })).toBeInTheDocument();
    });

    it('only the button variant gets the pointer cursor and the pressed tint', () => {
      const rules = issueRowRules();
      const tappable = rules.filter(([sel, body]) => sel.includes(':active') || /cursor:\s*pointer/.test(body));
      expect(tappable.length).toBeGreaterThan(0);
      for (const [sel] of tappable) expect(sel).toMatch(/^#mobile-root button\.issue-row/);
    });

    it('without onOpen the row is not a button and keeps its content', () => {
      const { container } = render(<IssueRow incident={cronIncident} />);
      expect(screen.queryByRole('button')).toBeNull();
      const row = container.querySelector('.issue-row');
      expect(row).not.toBeNull();
      expect(row.tagName).toBe('DIV');
      expect(row.className).toMatch(/issue-row--caution/);
      expect(screen.getByText('backup-daily failed')).toBeInTheDocument();
    });
  });
});
