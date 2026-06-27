import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ServiceCard from './ServiceCard';

// ServiceCard renders a single service across three layout modes (list/row/grid)
// and three status styles (dot/badge/minimal). These tests lock in the
// *behavior/output* — the service name, the status badge text, and the
// non-color status cue (the Phase 4 glyph + screen-reader label) — so a refactor
// of how config/props are threaded can't silently change what the user sees.

const baseService = (overrides = {}) => ({
  name: 'Grafana',
  status: 'up',
  ...overrides,
});

describe('ServiceCard', () => {
  it('renders the service name in every layout mode', () => {
    for (const cardLayout of ['list', 'row', 'grid']) {
      const { unmount } = render(<ServiceCard service={baseService()} cardLayout={cardLayout} />);
      expect(screen.getByText('Grafana')).toBeInTheDocument();
      unmount();
    }
  });

  it('badge mode shows "running" for an up service and "down" for a down one', () => {
    const { rerender } = render(
      <ServiceCard service={baseService({ status: 'up' })} statusStyle="badge" cardLayout="row" />
    );
    // up maps to the "running" badge text (st === 'up' ? 'running' : st)
    expect(screen.getByText('running')).toBeInTheDocument();

    rerender(
      <ServiceCard service={baseService({ status: 'down' })} statusStyle="badge" cardLayout="row" />
    );
    expect(screen.getByText('down')).toBeInTheDocument();
  });

  it('conveys up vs down via a non-color cue (glyph + SR label) in dot mode', () => {
    // dot mode renders a StatusDot with role="img" and an accessible label.
    const { rerender } = render(
      <ServiceCard service={baseService({ status: 'up' })} statusStyle="dot" cardLayout="row" />
    );
    expect(screen.getByRole('img', { name: 'Status: Up' })).toBeInTheDocument();

    rerender(
      <ServiceCard service={baseService({ status: 'down' })} statusStyle="dot" cardLayout="row" />
    );
    expect(screen.getByRole('img', { name: 'Status: Down' })).toBeInTheDocument();
  });

  it('minimal mode conveys status via a glyph and omits the badge', () => {
    render(
      <ServiceCard
        service={baseService({ status: 'down' })}
        statusStyle="minimal"
        cardLayout="list"
      />
    );
    // Non-color cue present...
    expect(screen.getByRole('img', { name: 'Status: Down' })).toBeInTheDocument();
    // ...but no status/ping badge text in minimal mode.
    expect(screen.queryByText('down')).not.toBeInTheDocument();
    expect(screen.queryByText('running')).not.toBeInTheDocument();
  });

  it('unknown status reads as "Unknown" via the cue', () => {
    render(
      <ServiceCard service={baseService({ status: 'weird' })} statusStyle="dot" cardLayout="grid" />
    );
    expect(screen.getByRole('img', { name: 'Status: Unknown' })).toBeInTheDocument();
  });

  it('shows the ping badge when ping > 0 and docker stats when enabled', () => {
    render(
      <ServiceCard
        service={baseService({ ping: 12, docker: { cpu: 5, memMB: 256 } })}
        statusStyle="badge"
        cardLayout="row"
        showDockerStats
      />
    );
    expect(screen.getByText('12ms')).toBeInTheDocument();
    // Docker stats grid renders a CPU stat box with the value.
    expect(screen.getByText('CPU')).toBeInTheDocument();
    expect(screen.getByText('5%')).toBeInTheDocument();
    // 256 MB stays in MB (formatMem keeps < 1000 MB as MB).
    expect(screen.getByText('256 MB')).toBeInTheDocument();
  });

  it('hides docker stats when showDockerStats is false', () => {
    render(
      <ServiceCard
        service={baseService({ docker: { cpu: 5, memMB: 256 } })}
        statusStyle="badge"
        cardLayout="row"
        showDockerStats={false}
      />
    );
    expect(screen.queryByText('CPU')).not.toBeInTheDocument();
  });

  it('renders appData label/value pairs when showAppData is on', () => {
    render(
      <ServiceCard
        service={baseService({ appData: { Queries: 42 } })}
        statusStyle="badge"
        cardLayout="grid"
        showAppData
      />
    );
    expect(screen.getByText('Queries')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('surfaces the integration "why is this dashed?" doctor on a fetch error', () => {
    render(
      <ServiceCard
        service={baseService({ appData: { _doctor: { error: 'HTTP 401 Unauthorized' } } })}
        statusStyle="badge"
        cardLayout="grid"
        showAppData
      />
    );
    // The collapsed <details> summary + the redacted error in the detail.
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
    expect(screen.getByText('HTTP 401 Unauthorized')).toBeInTheDocument();
    // _doctor must NOT leak into the stat grid as a garbage tile.
    expect(screen.queryByText('_doctor')).not.toBeInTheDocument();
  });

  it('shows real stats AND the doctor when an integration partially failed', () => {
    render(
      <ServiceCard
        service={baseService({ appData: { Queries: 42, _doctor: { error: 'HTTP 500' } } })}
        statusStyle="badge"
        cardLayout="row"
        showAppData
      />
    );
    expect(screen.getByText('Queries')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it('shows no doctor when there is no integration error', () => {
    render(
      <ServiceCard
        service={baseService({ appData: { Queries: 42 } })}
        statusStyle="badge"
        cardLayout="grid"
        showAppData
      />
    );
    expect(screen.queryByText(/no data/i)).not.toBeInTheDocument();
  });

  it('shows an "unmonitored" tag with a nudge tooltip for a running untracked service', () => {
    render(<ServiceCard service={{ name: 'Postgres', status: 'running', monitored: false, source: 'container' }} statusStyle="badge" cardLayout="row" />);
    const tag = screen.getByText('unmonitored');
    expect(tag).toBeInTheDocument();
    expect(tag).toHaveAttribute('title', expect.stringContaining('add one to track'));
  });

  it('does NOT show the unmonitored tag for a monitored service', () => {
    render(<ServiceCard service={{ name: 'Gitea', status: 'up', monitored: true, source: 'container' }} statusStyle="badge" cardLayout="row" />);
    expect(screen.queryByText('unmonitored')).toBeNull();
  });

  it('renders a presence breadcrumb grey with a "last seen X ago" subtitle and no unmonitored tag', () => {
    render(<ServiceCard service={{ name: 'Postgres', status: 'unknown', monitored: false, source: 'presence', lastSeenAt: Date.now() - 2 * 60_000 }} statusStyle="badge" cardLayout="row" />);
    expect(screen.getByText(/last seen .* ago/)).toBeInTheDocument();
    expect(screen.queryByText('unmonitored')).toBeNull();
  });
});
