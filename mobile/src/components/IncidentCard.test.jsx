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
    expect(screen.getByText('42.0%')).toBeInTheDocument(); // uptime24 scalar
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith(INC.target);
  });
  it('omits the uptime line when uptime24 is null (e.g. UPS/cron)', () => {
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
});
