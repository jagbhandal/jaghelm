import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import IncidentCard from './IncidentCard.jsx';

const INC = { id: 'service:vm-101:gitea', kind: 'service', title: 'Gitea', node: 'VM 101', cause: 'Service is down', uptime24: 0.42, status: 'down', target: { kind: 'service', url: 'http://h/gitea' } };
const UPS_INC = { id: 'ups:apcups', kind: 'ups', title: 'UPS on battery', node: 'UPS', cause: 'On battery', uptime24: null, status: 'down', target: { kind: 'ups' } };
const CRON_INC = { id: 'cron:pi:backup', kind: 'cron', title: 'backup failed', node: 'pi', cause: 'disk full', uptime24: null, status: 'down', target: { kind: 'cron', job: 'backup' } };

describe('IncidentCard', () => {
  it('shows title, node, cause, 24h uptime and an Open button', () => {
    const onOpen = vi.fn();
    render(<IncidentCard incident={INC} onOpen={onOpen} />);
    expect(screen.getByText('Gitea')).toBeInTheDocument();
    expect(screen.getByText('VM 101')).toBeInTheDocument();
    expect(screen.getByText('Service is down')).toBeInTheDocument();
    expect(screen.getByText('42.0%')).toBeInTheDocument(); // uptime24 scalar via UptimeRing SVG text
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith(INC.target);
  });
  it('omits the uptime ring when uptime24 is null (e.g. UPS/cron)', () => {
    render(<IncidentCard incident={{ ...INC, uptime24: null }} onOpen={() => {}} />);
    expect(screen.queryByText(/%$/)).toBeNull();
  });
  it('does NOT render an Open button for a UPS incident (no target.url)', () => {
    render(<IncidentCard incident={UPS_INC} onOpen={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
  });
  it('does NOT render an Open button for a cron incident (no target.url)', () => {
    render(<IncidentCard incident={CRON_INC} onOpen={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
  });
  it('renders the Open button for a service incident with a url', () => {
    render(<IncidentCard incident={INC} onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });

  // Bug #8: cause is ALWAYS shown on active cards
  it('always renders the cause text', () => {
    render(<IncidentCard incident={INC} onOpen={() => {}} />);
    expect(screen.getByText('Service is down')).toBeInTheDocument();
  });
  it('renders cause even when uptime24 is null (UPS/cron incidents)', () => {
    render(<IncidentCard incident={UPS_INC} onOpen={() => {}} />);
    expect(screen.getByText('On battery')).toBeInTheDocument();
  });

  // UptimeRing replaces UptimeLine (Bug #1 fix: no whitespace-node flex jam)
  it('renders UptimeRing (aria-label) when uptime24 is set', () => {
    render(<IncidentCard incident={INC} onOpen={() => {}} />);
    expect(screen.getByLabelText(/24-hour uptime/i)).toBeInTheDocument();
  });
  it('does NOT render a UptimeLine paragraph (no "24H uptime" prose label)', () => {
    render(<IncidentCard incident={INC} onOpen={() => {}} />);
    // UptimeLine renders "24H uptime" as span text; UptimeRing uses a separate SVG <text> node.
    // We assert the old prose "24H uptime" label is gone.
    expect(screen.queryByText('24H uptime')).toBeNull();
  });

  // Bug #9 / F8: Open button is the unified ghost variant (open-btn--ghost composed
  // on the open-btn base layout), matching IncidentDetail + ServiceDetail.
  it('Open button has the unified ghost class (open-btn--ghost), not the old incident-card__open', () => {
    render(<IncidentCard incident={INC} onOpen={() => {}} />);
    const openBtn = screen.getByRole('button', { name: 'Open' });
    expect(openBtn.classList.contains('open-btn--ghost')).toBe(true);
    expect(openBtn.classList.contains('incident-card__open')).toBe(false);
  });
});
