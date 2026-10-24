import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import ServicesTab from './ServicesTab';

// Settings → Nodes & Services' services (#319). How each edit is made is
// servicesConfig.test.js's; these drive the screen: the monitor tag, the
// Auto-match suggestion (accepted, or overridden by another choice), the
// per-node writes, and the hide rules.

function liveOf(nodes) {
  return {
    nodes: Object.fromEntries(
      Object.entries(nodes).map(([key, services]) => [
        key,
        { display_name: key === 'pi1' ? 'Pi One' : key === 'pi2' ? 'Pi Two' : 'Gateway', services },
      ])
    ),
  };
}

function props({ services = {}, live, hide = [], monitorNames = [], mapping = null, onSave = vi.fn() } = {}) {
  const liveServices =
    live ??
    liveOf({
      gateway: [
        { container: 'redis', display_name: 'Redis Cache', status: 'up', monitored: false },
        { container: 'redis-backup', display_name: 'Redis Backup', status: 'up', monitored: false },
      ],
    });
  const nodeCfg = Object.fromEntries(
    Object.entries(liveServices.nodes).map(([k, n]) => [k, { display_name: n.display_name, hide }])
  );
  return { serverConfig: { services, nodes: nodeCfg }, liveServices, monitorNames, mapping, onSave, saving: false };
}

const renderTab = (p) => render(<ServicesTab {...p} />);

const openNode = (label = 'Gateway') => fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
const rowFor = (container) => document.querySelector(`[data-service$=":${container}"]`);
const edit = (container) => fireEvent.click(within(rowFor(container)).getByRole('button', { name: /^Edit/ }));

async function pick(user, option) {
  await user.click(screen.getByRole('combobox', { name: 'Uptime Kuma monitor' }));
  await user.click(await screen.findByRole('option', { name: option }));
}

describe('hide/unhide is exact-match', () => {
  it('hiding "redis" does not add a rule that would also hide "redis-backup"', () => {
    const onSave = vi.fn();
    renderTab(props({ onSave }));
    openNode();
    fireEvent.click(within(rowFor('redis')).getByRole('button', { name: /^Hide/ }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].nodes.gateway.hide).toEqual(['redis']);
  });

  it('shows redis hidden and redis-backup visible when only "redis" is hidden', () => {
    renderTab(props({ hide: ['redis'] }));
    openNode();
    expect(within(rowFor('redis')).getByRole('button', { name: /^Show/ })).toBeInTheDocument();
    expect(within(rowFor('redis-backup')).getByRole('button', { name: /^Hide/ })).toBeInTheDocument();
  });
});

describe('the monitor tag says whether a monitor is really attached (#319)', () => {
  const tagOf = (container) => rowFor(container).querySelector('[data-slot="monitor-tag"]');

  it('a running container with no monitor reads "no monitor", not "monitored"', () => {
    // The bug: any container whose status was up read "monitored".
    renderTab(
      props({
        live: liveOf({ vm103: [{ container: 'loki', display_name: 'Loki', status: 'up', monitored: false }] }),
      })
    );
    openNode('Gateway');
    expect(tagOf('loki')).toHaveAttribute('data-kind', 'none');
    expect(tagOf('loki')).toHaveTextContent('no monitor');
    expect(tagOf('loki')).not.toHaveTextContent('monitored');
  });

  it('a container with a monitor reads "monitored" and names it', () => {
    renderTab(
      props({
        live: liveOf({ vm103: [{ container: 'gitea', display_name: 'Gitea', status: 'up', monitored: true }] }),
        mapping: { services: { 'vm103:gitea': { attached: 'Gitea', suggested: 'Gitea', why: 'exact', candidates: [] } } },
      })
    );
    openNode();
    expect(tagOf('gitea')).toHaveAttribute('data-kind', 'monitored');
    expect(tagOf('gitea')).toHaveTextContent('monitored');
    expect(tagOf('gitea')).toHaveTextContent('Gitea');
  });

  it('a stopped container with a monitor is still monitored; a down one without is not', () => {
    renderTab(
      props({
        live: liveOf({
          vm103: [
            { container: 'a', display_name: 'A', status: 'unknown', monitored: true },
            { container: 'b', display_name: 'B', status: 'down', monitored: false },
          ],
        }),
      })
    );
    openNode();
    expect(tagOf('a')).toHaveAttribute('data-kind', 'monitored');
    expect(tagOf('b')).toHaveAttribute('data-kind', 'none');
  });

  it('a container mapped to false reads "opted out"', () => {
    renderTab(
      props({
        services: { loki: { monitor: false } },
        live: liveOf({ vm103: [{ container: 'loki', display_name: 'Loki', status: 'up', monitored: false }] }),
      })
    );
    openNode();
    expect(tagOf('loki')).toHaveAttribute('data-kind', 'opted-out');
    expect(tagOf('loki')).toHaveTextContent('opted out');
  });
});

describe('Auto-match suggestions (#319)', () => {
  const live = liveOf({ vm103: [{ container: 'gitea', display_name: 'Gitea', status: 'up', monitored: false }] });
  const mapping = {
    services: {
      'vm103:gitea': {
        attached: null,
        suggested: 'Gitea',
        why: 'exact',
        candidates: [
          { name: 'Gitea', kind: 'exact' },
          { name: 'Gitea SSH', kind: 'contains' },
        ],
      },
    },
  };
  const names = ['Gitea', 'Gitea SSH', 'Other'];
  const open = () => {
    openNode();
    edit('gitea');
  };

  it('says which monitor Auto-match would pick, and why', () => {
    renderTab(props({ live, mapping, monitorNames: names }));
    open();
    const box = screen.getByRole('group', { name: /Auto-match suggestion for Gitea/ });
    expect(box).toHaveTextContent('Auto-match would pick Gitea');
    expect(box).toHaveTextContent('matched by name');
    // The other similar monitors are offered, the suggestion is not repeated.
    expect(within(box).getByRole('button', { name: 'Use Gitea SSH for Gitea' })).toBeInTheDocument();
    expect(within(box).getAllByRole('button', { name: /^Use Gitea for/ })).toHaveLength(1);
  });

  it('says "no match" when Auto-match finds nothing', () => {
    renderTab(
      props({
        live,
        mapping: { services: { 'vm103:gitea': { attached: null, suggested: null, why: null, candidates: [] } } },
        monitorNames: names,
      })
    );
    open();
    const box = screen.getByRole('group', { name: /Auto-match suggestion/ });
    expect(box).toHaveTextContent('finds no monitor');
    expect(box).toHaveTextContent('no match');
    expect(within(box).queryByRole('button')).toBeNull();
  });

  it('accepting the suggestion writes it as the container’s monitor in one click', () => {
    const onSave = vi.fn();
    renderTab(props({ live, mapping, monitorNames: names, onSave }));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Use Gitea for Gitea' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].services.gitea).toEqual({ monitor: 'Gitea' });
  });

  it('choosing another monitor overrides the suggestion', async () => {
    const onSave = vi.fn();
    renderTab(props({ live, mapping, monitorNames: names, onSave }));
    open();
    await pick(userEvent.setup(), 'Other');
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].services.gitea).toEqual({ monitor: 'Other' });
  });

  it('one click on a similar name chooses it over the suggestion', () => {
    const onSave = vi.fn();
    renderTab(props({ live, mapping, monitorNames: names, onSave }));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Use Gitea SSH for Gitea' }));
    expect(onSave.mock.calls[0][0].services.gitea).toEqual({ monitor: 'Gitea SSH' });
  });

  it('once accepted it says so, and Auto-match takes the mapping off again', async () => {
    const onSave = vi.fn();
    renderTab(props({ live, mapping, monitorNames: names, services: { gitea: { monitor: 'Gitea' } }, onSave }));
    open();
    const box = screen.getByRole('group', { name: /Auto-match suggestion/ });
    expect(box).toHaveTextContent('Using this suggestion');
    expect(within(box).queryByRole('button', { name: 'Use Gitea for Gitea' })).toBeNull();
    await pick(userEvent.setup(), /^Auto-match/);
    expect(onSave.mock.calls[0][0].services).toEqual({});
  });

  it('No monitor is a choice of its own: false, never Auto-match', async () => {
    const onSave = vi.fn();
    renderTab(props({ live, mapping, monitorNames: names, onSave }));
    open();
    await pick(userEvent.setup(), 'No monitor');
    expect(onSave.mock.calls[0][0].services.gitea).toEqual({ monitor: false });
  });

  it('shows false as No monitor, not Auto-match', () => {
    renderTab(props({ live, mapping, monitorNames: names, services: { gitea: { monitor: false } } }));
    open();
    expect(screen.getByRole('combobox', { name: /Uptime Kuma monitor/ })).toHaveTextContent('No monitor');
  });

  it('a mapping to a monitor Kuma does not have still shows, as what it is', () => {
    renderTab(props({ live, mapping, monitorNames: names, services: { gitea: { monitor: 'Dead' } } }));
    open();
    expect(screen.getByRole('combobox', { name: /Uptime Kuma monitor/ })).toHaveTextContent(
      'Dead (not in Uptime Kuma)'
    );
  });

  it('works without suggestions (the read failed): the choices are all there is', () => {
    renderTab(props({ live, mapping: null, monitorNames: names }));
    open();
    expect(screen.getByRole('combobox', { name: /Uptime Kuma monitor/ })).toHaveTextContent('Auto-match');
    expect(screen.queryByRole('button', { name: /^Use / })).toBeNull();
  });
});

// A container on two nodes keeps one monitor per node (#633).
function twoNodes({ services = {}, mapping = null, onSave = vi.fn() } = {}) {
  const svc = { container: 'gateway-npm', display_name: 'NPM', status: 'up', monitored: false };
  return props({
    services,
    live: liveOf({ pi1: [svc], pi2: [svc] }),
    monitorNames: ['NPM A', 'NPM B'],
    mapping,
    onSave,
  });
}

describe('monitor per node', () => {
  it('accepting the suggestion on pi2 writes monitor_per_node.pi2 and leaves pi1 alone', () => {
    const onSave = vi.fn();
    renderTab(
      twoNodes({
        services: { 'gateway-npm': { monitor: 'NPM A' } },
        mapping: {
          services: {
            'pi2:gateway-npm': {
              attached: 'NPM A',
              suggested: 'NPM B',
              why: 'word',
              candidates: [{ name: 'NPM B', kind: 'word' }],
            },
          },
        },
        onSave,
      })
    );
    openNode('Pi Two');
    edit('gateway-npm');
    expect(screen.getByRole('group', { name: /Auto-match suggestion/ })).toHaveTextContent(
      'matched by a shared word'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use NPM B for NPM' }));
    // The container-wide value is migrated onto the other node, then this node's is set.
    expect(onSave.mock.calls[0][0].services['gateway-npm']).toEqual({
      monitor_per_node: { pi1: 'NPM A', pi2: 'NPM B' },
    });
  });

  it('overriding by the dropdown on one node leaves the other', async () => {
    const onSave = vi.fn();
    renderTab(twoNodes({ services: { 'gateway-npm': { monitor_per_node: { pi1: 'NPM A' } } }, onSave }));
    openNode('Pi Two');
    edit('gateway-npm');
    await pick(userEvent.setup(), 'NPM B');
    expect(onSave.mock.calls[0][0].services['gateway-npm']).toEqual({
      monitor_per_node: { pi1: 'NPM A', pi2: 'NPM B' },
    });
  });

  it('shows the node entry, else the container-wide monitor', () => {
    renderTab(twoNodes({ services: { 'gateway-npm': { monitor: 'NPM A', monitor_per_node: { pi2: 'NPM B' } } } }));
    openNode('Pi Two');
    edit('gateway-npm');
    expect(screen.getByRole('combobox', { name: /Uptime Kuma monitor/ })).toHaveTextContent('NPM B');
    cleanup();
    renderTab(twoNodes({ services: { 'gateway-npm': { monitor: 'NPM A', monitor_per_node: { pi2: 'NPM B' } } } }));
    openNode('Pi One');
    edit('gateway-npm');
    expect(screen.getByRole('combobox', { name: /Uptime Kuma monitor/ })).toHaveTextContent('NPM A');
  });

  it('describes the field by its multi-node hint', () => {
    renderTab(twoNodes());
    openNode('Pi Two');
    edit('gateway-npm');
    const select = screen.getByRole('combobox', { name: /Uptime Kuma monitor/ });
    const hint = document.getElementById(select.getAttribute('aria-describedby').split(' ')[0]);
    expect(hint.textContent).toMatch(/several nodes/);
  });
});

describe('display name and icon', () => {
  const name = () => screen.getByRole('textbox', { name: 'Display name' });
  const icon = () => screen.getByRole('textbox', { name: 'Icon key' });

  it('renaming pi1 writes display_name_per_node.pi1 only', () => {
    const onSave = vi.fn();
    renderTab(twoNodes({ onSave }));
    openNode('Pi One');
    edit('gateway-npm');
    fireEvent.change(name(), { target: { value: 'NPM Primary' } });
    expect(onSave.mock.calls[0][0].services['gateway-npm']).toEqual({
      display_name_per_node: { pi1: 'NPM Primary' },
    });
  });

  it('the icon is per node too', () => {
    const onSave = vi.fn();
    renderTab(twoNodes({ services: { 'gateway-npm': { icon_per_node: { pi2: 'b' } } }, onSave }));
    openNode('Pi One');
    edit('gateway-npm');
    fireEvent.change(icon(), { target: { value: 'a' } });
    expect(onSave.mock.calls[0][0].services['gateway-npm']).toEqual({ icon_per_node: { pi1: 'a', pi2: 'b' } });
  });

  it("shows this node's value, and the default as placeholder", () => {
    renderTab(
      twoNodes({ services: { 'gateway-npm': { display_name: 'Proxy', display_name_per_node: { pi1: 'Primary' } } } })
    );
    openNode('Pi One');
    edit('gateway-npm');
    expect(name()).toHaveValue('Primary');
    expect(name()).toHaveAttribute('placeholder', 'Gateway Npm');
  });

  it('a container on one node writes the plain keys', () => {
    const onSave = vi.fn();
    renderTab(props({ onSave }));
    openNode();
    edit('redis');
    fireEvent.change(name(), { target: { value: 'Cache' } });
    expect(onSave.mock.calls[0][0].services.redis).toEqual({ display_name: 'Cache' });
  });

  it("the row title follows the node's name", () => {
    renderTab(twoNodes({ services: { 'gateway-npm': { display_name_per_node: { pi1: 'Primary' } } } }));
    openNode('Pi One');
    expect(within(rowFor('gateway-npm')).getByText('Primary')).toBeInTheDocument();
  });

  it('types a whole name: each keystroke saves, the other node stays', () => {
    let config;
    const onSave = vi.fn((c) => (config = c));
    const p = twoNodes({ services: { 'gateway-npm': { display_name_per_node: { pi2: 'Keep' } } }, onSave });
    const view = renderTab(p);
    openNode('Pi One');
    edit('gateway-npm');
    for (const v of ['N', 'NP', 'NPM', 'NPM P']) {
      fireEvent.change(name(), { target: { value: v } });
      p.serverConfig = config;
      view.rerender(<ServicesTab {...p} />);
    }
    expect(config.services['gateway-npm']).toEqual({
      display_name_per_node: { pi1: 'NPM P', pi2: 'Keep' },
    });
  });

  it('Remove all overrides asks first, then clears the per-node maps too', async () => {
    const onSave = vi.fn();
    renderTab(
      twoNodes({
        services: {
          'gateway-npm': {
            display_name_per_node: { pi1: 'A' },
            icon_per_node: { pi1: 'x' },
            monitor_per_node: { pi1: 'NPM A' },
          },
        },
        onSave,
      })
    );
    openNode('Pi One');
    edit('gateway-npm');
    fireEvent.click(screen.getByRole('button', { name: /Remove all overrides/ }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove overrides' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].services).toEqual({});
  });
});

describe('before it is read', () => {
  it('says it is reading, with no rows', () => {
    render(<ServicesTab serverConfig={null} liveServices={null} monitorNames={[]} onSave={vi.fn()} saving={false} />);
    expect(screen.getByText('Reading services…')).toBeInTheDocument();
  });
});
