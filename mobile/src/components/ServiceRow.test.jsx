import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { getServiceIcon } = vi.hoisted(() => ({ getServiceIcon: vi.fn() }));
vi.mock('@shared/hooks/useData.js', () => ({ getServiceIcon }));

import ServiceRow from './ServiceRow.jsx';

beforeEach(() => getServiceIcon.mockReset());

const SVC = { uid: 'vm-101:gitea', display_name: 'Gitea', icon: null, status: 'down', ping: null, uptime24: 0.42, url: 'http://h/gitea', nodeName: 'VM 101' };
const SVC_UP = { uid: 'vm-101:adguard', display_name: 'AdGuard', icon: null, status: 'up', ping: 12, nodeName: 'VM 101', monitored: true, source: 'container' };

describe('ServiceRow', () => {
  it('renders an absolute base-aware icon URL, node tag, name, status', () => {
    getServiceIcon.mockReturnValue('http://host:8080/api/icons/cached?url=x');
    render(<ServiceRow service={SVC} onTap={() => {}} />);
    expect(screen.getByText('Gitea')).toBeInTheDocument();
    expect(screen.getByText('VM 101')).toBeInTheDocument();
    // The <img> element has alt="Gitea"; the StatusLamp SVG has aria-label="DOWN".
    // Query by the img's name to avoid matching the SVG.
    const img = screen.getByRole('img', { name: 'Gitea' });
    expect(img.getAttribute('src')).toMatch(/^http:\/\/host:8080\/api\/icons\/cached/);
    expect(img.getAttribute('src')).not.toMatch(/^\/api/); // never relative
  });

  it('omits the <img> when the resolver returns null', () => {
    getServiceIcon.mockReturnValue(null);
    render(<ServiceRow service={SVC} onTap={() => {}} />);
    // StatusLamp is an SVG with aria-label="DOWN" — it has role img but name "DOWN", not "Gitea".
    // A real <img alt="Gitea"> should be absent.
    expect(screen.queryByRole('img', { name: 'Gitea' })).toBeNull();
  });

  it('fires onTap with the service', () => {
    getServiceIcon.mockReturnValue(null);
    const onTap = vi.fn();
    render(<ServiceRow service={SVC} onTap={onTap} />);
    fireEvent.click(screen.getByRole('button', { name: /Gitea/ }));
    expect(onTap).toHaveBeenCalledWith(SVC);
  });

  it('renders StatusLamp SVG + StatusWord "DOWN" in the DOM for a down service', () => {
    getServiceIcon.mockReturnValue(null);
    const { container } = render(<ServiceRow service={SVC} onTap={() => {}} />);
    // StatusLamp: an SVG with class "status-lamp"
    expect(container.querySelector('.status-lamp')).not.toBeNull();
    // StatusWord: a span with class "status-word" containing the word
    const wordEl = container.querySelector('.status-word');
    expect(wordEl).not.toBeNull();
    expect(wordEl.textContent).toBe('DOWN');
  });

  it('renders "UP" StatusWord for an up service', () => {
    getServiceIcon.mockReturnValue(null);
    const { container } = render(<ServiceRow service={SVC_UP} onTap={() => {}} />);
    const wordEl = container.querySelector('.status-word');
    expect(wordEl).not.toBeNull();
    expect(wordEl.textContent).toBe('UP');
  });

  it('down row: StatusWord has critical (red) color', () => {
    getServiceIcon.mockReturnValue(null);
    const { container } = render(<ServiceRow service={SVC} onTap={() => {}} />);
    const wordEl = container.querySelector('.status-word');
    // StatusWord uses inline style for color so it is testable in jsdom
    expect(wordEl.style.color).toBe('var(--red)');
  });

  it('renders ping when non-null and > 0', () => {
    getServiceIcon.mockReturnValue(null);
    render(<ServiceRow service={SVC_UP} onTap={() => {}} />);
    expect(screen.getByText('12ms')).toBeInTheDocument();
  });

  it('omits ping when null', () => {
    getServiceIcon.mockReturnValue(null);
    render(<ServiceRow service={SVC} onTap={() => {}} />);
    expect(screen.queryByText(/ms/)).toBeNull();
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
