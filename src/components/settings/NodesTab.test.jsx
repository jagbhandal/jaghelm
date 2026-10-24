import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import NodesTab from './NodesTab';
import { apiFetch, isReadOnlyServer } from '../../api/client.js';

vi.mock('../../api/client.js', () => ({
  apiFetch: vi.fn(),
  isReadOnlyServer: vi.fn(() => false),
}));

// What Nodes says with no nodes (#566). While the first boot waits for
// Prometheus to have nodes (the live services payload's `discovery:
// 'waiting'`), they come by themselves; otherwise nothing is discovering, so
// the words never say they will.
const EMPTY = { nodes: {}, services: {}, integrations: {} };

describe('NodesTab with no nodes', () => {
  it('while the first boot waits, says the nodes come once Prometheus has some', () => {
    render(<NodesTab serverConfig={EMPTY} onSave={vi.fn()} saving={false} discovery="waiting" />);
    expect(screen.getByText(/asks Prometheus again every refresh and adds them as soon as it has some/)).toBeTruthy();
    expect(screen.queryByText(/by hand/)).toBeNull();
  });

  it('otherwise never says discovery is under way: add them by hand, or fix PROMETHEUS_URL and restart', () => {
    render(<NodesTab serverConfig={EMPTY} onSave={vi.fn()} saving={false} />);
    expect(screen.getByText(/only when it starts with no services\.yaml/)).toBeTruthy();
    expect(screen.getByText(/add them to services\.yaml by hand/)).toBeTruthy();
    expect(screen.getByText(/if PROMETHEUS_URL is wrong, fix it and restart/)).toBeTruthy();
    expect(screen.queryByText(/every refresh/)).toBeNull();
  });

  it('with nodes, says neither', () => {
    const cfg = { ...EMPTY, nodes: { pi1: { display_name: 'Gateway', visible: true } } };
    render(<NodesTab serverConfig={cfg} onSave={vi.fn()} saving={false} discovery="waiting" />);
    expect(screen.getByText('Gateway')).toBeTruthy();
    expect(screen.queryByText(/No nodes/)).toBeNull();
  });
});

// Jag, 2026-10-23 (#306): the new design marks a node by its name, its role
// and its colour; the node's icon showed only on the old board's panels.
describe('NodesTab without an icon', () => {
  it('has no Icon field, and draws no icon for a node that has one', () => {
    const cfg = {
      ...EMPTY,
      nodes: { pi1: { display_name: 'Gateway', icon: 'https://icons.example/pi.png' } },
    };
    render(<NodesTab serverConfig={cfg} onSave={vi.fn()} saving={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Display Name')).toBeTruthy();
    expect(screen.queryByText('Icon')).toBeNull();
    expect(document.querySelector('img[src="https://icons.example/pi.png"]')).toBeNull();
  });
});

// #572: Find nodes asks Prometheus now (POST /api/services/nodes/find) and adds
// the nodes the file lacks through the tab's ordinary save; it never removes,
// renames or edits a node.
const FIRST_BOOT_NODE = (key) => ({
  prometheus_node: key,
  display_name: key,
  subtitle: '',
  border_color: '#3b82f6',
  visible: true,
  auto_discover: true,
  hide: ['prometheus', 'node-exporter', 'cadvisor'],
});
const answer = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

describe('NodesTab Find nodes', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    isReadOnlyServer.mockReturnValue(false);
  });

  it('a config with no nodes gets what Prometheus has from one click and one Add', async () => {
    apiFetch.mockReturnValue(answer(200, { nodes: { pi1: FIRST_BOOT_NODE('pi1'), vm103: FIRST_BOOT_NODE('vm103') } }));
    const onSave = vi.fn();
    render(<NodesTab serverConfig={EMPTY} onSave={onSave} saving={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find nodes' }));
    await screen.findByText(/pi1, vm103/);
    expect(onSave).not.toHaveBeenCalled(); // finding only looks
    expect(apiFetch).toHaveBeenCalledWith('/api/services/nodes/find', expect.objectContaining({ method: 'POST' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 nodes' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      ...EMPTY,
      nodes: { pi1: FIRST_BOOT_NODE('pi1'), vm103: FIRST_BOOT_NODE('vm103') },
    });
  });

  it('existing nodes and their settings go back untouched, new ones after them', async () => {
    const mine = { prometheus_node: 'pi1', display_name: 'Gateway', visible: false, auto_discover: false, hide: ['x'], border_color: '#f00' };
    const cfg = { nodes: { pi1: mine }, services: { a: { b: 1 } }, integrations: { i: {} } };
    apiFetch.mockReturnValue(answer(200, { nodes: { pi2: FIRST_BOOT_NODE('pi2') } }));
    const onSave = vi.fn();
    render(<NodesTab serverConfig={cfg} onSave={onSave} saving={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find nodes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add 1 node' }));
    const saved = onSave.mock.calls[0][0];
    expect(saved.nodes.pi1).toBe(mine);
    expect(Object.keys(saved.nodes)).toEqual(['pi1', 'pi2']);
    expect(saved.services).toBe(cfg.services);
    expect(saved.integrations).toBe(cfg.integrations);
  });

  it('a node the screen has meanwhile, by key or by its Prometheus label, is not added twice', async () => {
    const cfg = { ...EMPTY, nodes: { gateway: { prometheus_node: 'pi1', visible: false }, pi2: {} } };
    apiFetch.mockReturnValue(answer(200, { nodes: { pi1: FIRST_BOOT_NODE('pi1'), pi2: FIRST_BOOT_NODE('pi2') } }));
    render(<NodesTab serverConfig={cfg} onSave={vi.fn()} saving={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find nodes' }));
    expect(await screen.findByText('No new nodes')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Add/ })).toBeNull();
  });

  it('nothing new says No new nodes and saves nothing', async () => {
    apiFetch.mockReturnValue(answer(200, { nodes: {} }));
    const onSave = vi.fn();
    render(<NodesTab serverConfig={EMPTY} onSave={onSave} saving={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find nodes' }));
    expect(await screen.findByText('No new nodes')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Prometheus unreachable says so in the server\'s words and saves nothing', async () => {
    apiFetch.mockReturnValue(answer(502, { error: 'Prometheus refused the connection' }));
    const onSave = vi.fn();
    render(<NodesTab serverConfig={EMPTY} onSave={onSave} saving={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find nodes' }));
    expect(await screen.findByText('Prometheus refused the connection')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('a request that never reached the server says so', async () => {
    apiFetch.mockReturnValue(Promise.reject(new TypeError('Failed to fetch')));
    render(<NodesTab serverConfig={EMPTY} onSave={vi.fn()} saving={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find nodes' }));
    expect(await screen.findByText(/Couldn.t reach JagHelm/)).toBeTruthy();
  });

  it('Cancel drops the found nodes without saving', async () => {
    apiFetch.mockReturnValue(answer(200, { nodes: { pi1: FIRST_BOOT_NODE('pi1') } }));
    const onSave = vi.fn();
    render(<NodesTab serverConfig={EMPTY} onSave={onSave} saving={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find nodes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: /^Add/ })).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('no Prometheus set up says so with the .env hint, not No new nodes', async () => {
    apiFetch.mockReturnValue(answer(502, { error: 'No Prometheus is set up', code: 'prometheus_unset' }));
    render(<NodesTab serverConfig={EMPTY} onSave={vi.fn()} saving={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find nodes' }));
    expect(await screen.findByText(/No Prometheus is set up\. Set PROMETHEUS_URL in \.env/)).toBeTruthy();
    expect(screen.queryByText('No new nodes')).toBeNull();
  });

  it('after Add focus is back on Find nodes and a polite live region says Added 2 nodes', async () => {
    apiFetch.mockReturnValue(answer(200, { nodes: { pi1: FIRST_BOOT_NODE('pi1'), vm103: FIRST_BOOT_NODE('vm103') } }));
    render(<NodesTab serverConfig={EMPTY} onSave={vi.fn()} saving={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find nodes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add 2 nodes' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Find nodes' }));
    const live = screen.getByText('Added 2 nodes');
    expect(live.getAttribute('role')).toBe('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
  });

  it('after Cancel focus is back on Find nodes', async () => {
    apiFetch.mockReturnValue(answer(200, { nodes: { pi1: FIRST_BOOT_NODE('pi1') } }));
    render(<NodesTab serverConfig={EMPTY} onSave={vi.fn()} saving={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find nodes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Find nodes' }));
  });

  it('on the read-only demo it asks nothing', async () => {
    isReadOnlyServer.mockReturnValue(true);
    render(<NodesTab serverConfig={EMPTY} onSave={vi.fn()} saving={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find nodes' }));
    await waitFor(() => expect(screen.getByText(/No new nodes/)).toBeTruthy());
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('is there with nodes too', () => {
    const cfg = { ...EMPTY, nodes: { pi1: { display_name: 'Gateway' } } };
    render(<NodesTab serverConfig={cfg} onSave={vi.fn()} saving={false} />);
    expect(screen.getByRole('button', { name: 'Find nodes' })).toBeTruthy();
  });
});
