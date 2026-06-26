import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { openTarget } = vi.hoisted(() => ({ openTarget: vi.fn() }));
vi.mock('../open.js', () => ({ openTarget }));
vi.mock('@shared/hooks/useData.js', () => ({ getServiceIcon: () => null })); // node rows don't need icons

import Overview from './Overview.jsx';

function makeData(downCount) {
  const services = [];
  for (let i = 0; i < downCount; i++) services.push({ uid: `vm-101:s${i}`, container: `s${i}`, display_name: `Svc ${i}`, icon: null, status: 'down', ping: null, uptime24: 0.4, url: `http://h/s${i}` });
  services.push({ uid: 'vm-101:ok', container: 'ok', display_name: 'Ok', icon: null, status: 'up', ping: 5, uptime24: 0.999, url: '' });
  return {
    servicesBody: { nodes: { 'vm-101': { display_name: 'VM 101', subtitle: 'app', metrics: { cpu: '45.3', memPercent: '31.2' }, services } } },
    ups: { status: 1 }, cron: [], history: { 'vm-101:cpu': [1, 2, 3] }, loading: false, error: null,
  };
}

describe('Overview', () => {
  beforeEach(() => openTarget.mockReset());
  it('renders the subsystem strip, one inline incident, and a node row', () => {
    render(<Overview data={makeData(1)} nav={{ push: vi.fn() }} />);
    expect(screen.getByText('Services')).toBeInTheDocument();
    expect(screen.getByText('Svc 0')).toBeInTheDocument();
    // "VM 101" appears in both the incident-card node tag and the node-row name;
    // use getAllByText and assert at least one is a node-row button descendant.
    const vm101Els = screen.getAllByText('VM 101');
    expect(vm101Els.length).toBeGreaterThanOrEqual(1);
    expect(vm101Els.some((el) => el.closest('.node-row'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(openTarget).toHaveBeenCalled();
  });
  it('tapping a node row calls nav.push with node key', () => {
    const nav = { push: vi.fn() };
    render(<Overview data={makeData(1)} nav={nav} />);
    const nodeRow = document.querySelector('.node-row');
    expect(nodeRow).not.toBeNull();
    fireEvent.click(nodeRow);
    expect(nav.push).toHaveBeenCalledWith('node', { nodeKey: 'vm-101' });
  });
  it('collapses extra incidents behind "+N more"', () => {
    render(<Overview data={makeData(4)} nav={{ push: vi.fn() }} />);
    // default expanded = 2; remaining 2 behind the toggle
    expect(screen.getByText(/\+2 more/)).toBeInTheDocument();
    expect(screen.queryByText('Svc 2')).toBeNull();
    fireEvent.click(screen.getByText(/\+2 more/));
    expect(screen.getByText('Svc 2')).toBeInTheDocument();
  });
});
