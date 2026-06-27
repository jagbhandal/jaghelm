import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import IssueRow from './IssueRow.jsx';

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
    it('calls onOpen with incident.target when the row is clicked', () => {
      const onOpen = vi.fn();
      render(<IssueRow incident={downIncident} onOpen={onOpen} />);
      fireEvent.click(screen.getByRole('button'));
      expect(onOpen).toHaveBeenCalledOnce();
      expect(onOpen).toHaveBeenCalledWith(downIncident.target);
    });
  });
});
