import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { getServiceIcon } = vi.hoisted(() => ({ getServiceIcon: vi.fn() }));
vi.mock('@shared/hooks/useData.js', () => ({ getServiceIcon }));

import ServiceRow from './ServiceRow.jsx';

beforeEach(() => getServiceIcon.mockReset());

const SVC = { uid: 'vm-101:gitea', display_name: 'Gitea', icon: null, status: 'down', ping: null, uptime24: 0.42, url: 'http://h/gitea', nodeName: 'VM 101' };

describe('ServiceRow', () => {
  it('renders an absolute base-aware icon URL, node tag, name, status', () => {
    getServiceIcon.mockReturnValue('http://host:8080/api/icons/cached?url=x');
    render(<ServiceRow service={SVC} onTap={() => {}} />);
    expect(screen.getByText('Gitea')).toBeInTheDocument();
    expect(screen.getByText('VM 101')).toBeInTheDocument();
    const img = screen.getByRole('img', { hidden: true });
    expect(img.getAttribute('src')).toMatch(/^http:\/\/host:8080\/api\/icons\/cached/);
    expect(img.getAttribute('src')).not.toMatch(/^\/api/); // never relative
  });
  it('omits the <img> when the resolver returns null', () => {
    getServiceIcon.mockReturnValue(null);
    render(<ServiceRow service={SVC} onTap={() => {}} />);
    expect(screen.queryByRole('img', { hidden: true })).toBeNull();
  });
  it('fires onTap with the service', () => {
    getServiceIcon.mockReturnValue(null);
    const onTap = vi.fn();
    render(<ServiceRow service={SVC} onTap={onTap} />);
    fireEvent.click(screen.getByRole('button', { name: /Gitea/ }));
    expect(onTap).toHaveBeenCalledWith(SVC);
  });

  it('shows an "unmonitored" tag for a running untracked service', () => {
    getServiceIcon.mockReturnValue(null);
    render(<ServiceRow service={{ display_name: 'Postgres', nodeName: 'VM103', status: 'running', monitored: false, source: 'container' }} />);
    const tag = screen.getByText('unmonitored');
    expect(tag).toBeInTheDocument();
    expect(tag).toHaveAttribute('title', expect.stringContaining('add one to track'));
  });

  it('renders a presence breadcrumb with a "last seen X ago" subtitle and no unmonitored tag', () => {
    getServiceIcon.mockReturnValue(null);
    render(<ServiceRow service={{ display_name: 'Postgres', nodeName: 'VM103', status: 'unknown', monitored: false, source: 'presence', lastSeenAt: Date.now() - 2 * 60_000 }} />);
    expect(screen.getByText(/last seen .* ago/)).toBeInTheDocument();
    expect(screen.queryByText('unmonitored')).toBeNull();
  });

  it('does not show the tag or subtitle for a monitored, up service', () => {
    getServiceIcon.mockReturnValue(null);
    render(<ServiceRow service={{ display_name: 'Gitea', nodeName: 'VM103', status: 'up', monitored: true, source: 'container' }} />);
    expect(screen.queryByText('unmonitored')).toBeNull();
    expect(screen.queryByText(/last seen/)).toBeNull();
  });
});
