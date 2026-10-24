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

  it('a paused monitor reads "monitor paused", naming it', () => {
    renderTab(
      props({
        live: liveOf({ vm103: [{ container: 'gitea', display_name: 'Gitea', status: 'up', monitored: true }] }),
        mapping: { services: { 'vm103:gitea': { attached: 'Gitea', paused: true, suggested: 'Gitea', why: 'exact', candidates: [] } } },
      })
    );
    openNode();
    expect(tagOf('gitea')).toHaveAttribute('data-kind', 'paused');
    expect(tagOf('gitea')).toHaveTextContent('monitor paused');
    expect(tagOf('gitea')).toHaveTextContent('Gitea');
  });

  it('a monitor’s own red card names the monitor', () => {
    renderTab(
      props({
        live: liveOf({ vm103: [{ container: 'pi-ping', uid: 'vm103:pi-ping', display_name: 'Pi Gateway (Ping)', status: 'down', monitored: true, source: 'monitor' }] }),
        mapping: { services: { 'vm103:pi-ping': { attached: 'Pi Gateway (Ping)', suggested: null, why: null, candidates: [] } } },
      })
    );
    openNode();
    expect(tagOf('pi-ping')).toHaveTextContent('Pi Gateway (Ping)');
  });

  it('the matcher’s answer wins over the board: a monitor cleared since reads "no monitor"', () => {
    renderTab(
      props({
        live: liveOf({ vm103: [{ container: 'gitea', display_name: 'Gitea', status: 'up', monitored: true }] }),
        mapping: { services: { 'vm103:gitea': { attached: null, suggested: null, why: null, candidates: [] } } },
      })
    );
    openNode();
    expect(tagOf('gitea')).toHaveAttribute('data-kind', 'none');
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
    expect(within(box).getByRole('button', { name: /^Use Gitea SSH/ })).toBeInTheDocument();
    expect(within(box).getAllByRole('button', { name: 'Use Gitea' })).toHaveLength(1);
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
    fireEvent.click(screen.getByRole('button', { name: 'Use Gitea' }));
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
    fireEvent.click(screen.getByRole('button', { name: /^Use Gitea SSH/ }));
    expect(onSave.mock.calls[0][0].services.gitea).toEqual({ monitor: 'Gitea SSH' });
  });

  it('once accepted it says so, and Auto-match takes the mapping off again', async () => {
    const onSave = vi.fn();
    renderTab(props({ live, mapping, monitorNames: names, services: { gitea: { monitor: 'Gitea' } }, onSave }));
    open();
    const box = screen.getByRole('group', { name: /Auto-match suggestion/ });
    expect(box).toHaveTextContent('Using this suggestion');
    expect(within(box).queryByRole('button', { name: 'Use Gitea' })).toBeNull();
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

  it('a similar monitor another mapping holds has no button, and says who holds it', () => {
    renderTab(
      props({
        live,
        monitorNames: names,
        mapping: {
          services: {
            'vm103:gitea': {
              attached: null,
              suggested: null,
              why: null,
              candidates: [{ name: 'Gitea', kind: 'exact' }, { name: 'Gitea SSH', kind: 'contains' }],
              held: { Gitea: { container: 'wiki', node: 'vm103' } },
            },
          },
        },
      })
    );
    open();
    const box = screen.getByRole('group', { name: /Auto-match suggestion/ });
    expect(within(box).queryByRole('button', { name: /^Use Gitea$/ })).toBeNull();
    expect(box).toHaveTextContent('mapped to wiki on Gateway');
    expect(within(box).getByRole('button', { name: /^Use Gitea SSH/ })).toBeInTheDocument();
  });

  it('the dropdown does not offer a monitor another mapping holds', async () => {
    renderTab(
      props({
        live,
        monitorNames: names,
        mapping: {
          services: {
            'vm103:gitea': {
              attached: null,
              suggested: null,
              why: null,
              candidates: [],
              held: { Other: { container: 'wiki', node: 'vm103' } },
            },
          },
        },
      })
    );
    open();
    await userEvent.setup().click(screen.getByRole('combobox', { name: 'Uptime Kuma monitor' }));
    const option = await screen.findByRole('option', { name: /Other \(mapped to wiki on Gateway\)/ });
    expect(option).toHaveAttribute('aria-disabled', 'true');
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
    fireEvent.click(screen.getByRole('button', { name: 'Use NPM B' }));
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

  it('clearing the last entry while the other node is offline stays per-node (#636)', () => {
    let config;
    const onSave = vi.fn((c) => (config = c));
    const p = twoNodes({ services: { 'gateway-npm': { display_name_per_node: { pi1: 'A' } } }, onSave });
    delete p.liveServices.nodes.pi2;
    const view = renderTab(p);
    openNode('Pi One');
    edit('gateway-npm');
    fireEvent.change(name(), { target: { value: '' } });
    p.serverConfig = config;
    view.rerender(<ServicesTab {...p} />);
    fireEvent.change(name(), { target: { value: 'B' } });
    expect(config.services['gateway-npm']).toEqual({ display_name_per_node: { pi1: 'B' } });
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

// #644: a Kuma monitor no container carries, shown on a node and placed on
// another with its Node choice (monitor_nodes in services.yaml).
describe('monitors no container carries (#644)', () => {
  const live = liveOf({
    vm101: [{ container: 'loki', uid: 'vm101:loki', display_name: 'Loki', status: 'up', monitored: false }],
    pi1: [],
  });
  const monitorOnly = [
    { uid: 'pi1:cadvisor-pi1', monitor: 'cadvisor-pi1', node: 'pi1', by: 'name', status: 'up' },
    { uid: 'vm101:Backups', monitor: 'Backups', node: 'vm101', by: 'first', status: 'down' },
  ];
  const mapping = { services: {}, monitorOnly };
  const monOnly = (name) => document.querySelector(`[data-service="monitor:${name}"]`);
  const editMon = (name) => fireEvent.click(within(monOnly(name)).getByRole('button', { name: /^Edit/ }));

  it('a row for each, on the node it was placed on, tagged "monitor only", with no Hide', () => {
    renderTab(props({ live, mapping }));
    fireEvent.click(screen.getByRole('button', { name: /Pi One/ }));
    expect(monOnly('cadvisor-pi1')).not.toBeNull();
    expect(monOnly('Backups')).toBeNull();
    expect(within(monOnly('cadvisor-pi1')).getByText('monitor only')).toBeInTheDocument();
    expect(within(monOnly('cadvisor-pi1')).queryByRole('button', { name: /^Hide/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Pi One/ })).toHaveTextContent('1 service');
  });

  it('a monitor with a red card is that one row, not two', () => {
    const cardLive = liveOf({
      vm101: [{ container: 'Backups', uid: 'vm101:Backups', display_name: 'Backups', status: 'down', monitored: true, source: 'monitor' }],
    });
    renderTab(props({ live: cardLive, mapping }));
    fireEvent.click(screen.getByRole('button', { name: /vm101|Gateway/ }));
    expect(document.querySelectorAll('[data-service]')).toHaveLength(1);
    expect(monOnly('Backups')).not.toBeNull();
  });

  it('the Node dropdown is on monitor-only rows alone, and says how the node was chosen', async () => {
    const user = userEvent.setup();
    renderTab(props({ live, mapping }));
    fireEvent.click(screen.getByRole('button', { name: /Pi One/ }));
    editMon('cadvisor-pi1');
    const node = screen.getByRole('combobox', { name: 'Node' });
    expect(node).toHaveTextContent('Automatic');
    expect(screen.getByText(/Shown on Pi One, from its name/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Uptime Kuma monitor' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    await user.click(node);
    expect(await screen.findAllByRole('option')).toHaveLength(3);
  });

  it('a container row has no Node dropdown', () => {
    renderTab(props({ live, mapping }));
    openNode('vm101|Gateway');
    edit('loki');
    expect(screen.queryByRole('combobox', { name: 'Node' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Uptime Kuma monitor' })).toBeInTheDocument();
  });

  it('choosing a node saves monitor_nodes by monitor name and keeps the rest of the config', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderTab(props({ live, mapping, services: { loki: { monitor: 'Loki' } }, onSave }));
    fireEvent.click(screen.getByRole('button', { name: /Pi One/ }));
    editMon('cadvisor-pi1');
    await user.click(screen.getByRole('combobox', { name: 'Node' }));
    await user.click(await screen.findByRole('option', { name: /vm101|Gateway/ }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.monitor_nodes).toEqual({ 'cadvisor-pi1': 'vm101' });
    expect(saved.services).toEqual({ loki: { monitor: 'Loki' } });
    expect(Object.keys(saved.nodes)).toEqual(['vm101', 'pi1']);
  });

  it('a setting moves the row to its node at once, shows it chosen, and Automatic clears it', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const p = props({ live, mapping, onSave });
    p.serverConfig.monitor_nodes = { 'Cadvisor-PI1': 'vm101' };
    renderTab(p);
    fireEvent.click(screen.getByRole('button', { name: /Pi One/ }));
    expect(monOnly('cadvisor-pi1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /vm101|Gateway/ }));
    editMon('cadvisor-pi1');
    const node = screen.getByRole('combobox', { name: 'Node' });
    expect(node).toHaveTextContent(/vm101|Gateway/);
    expect(screen.getByText(/as set here/)).toBeInTheDocument();
    await user.click(node);
    await user.click(await screen.findByRole('option', { name: 'Automatic' }));
    expect(onSave.mock.calls[0][0].monitor_nodes).toBeUndefined();
  });

  it('a setting naming a node that is not on the board still shows as chosen', async () => {
    const p = props({ live, mapping });
    p.serverConfig.monitor_nodes = { 'cadvisor-pi1': 'pi9' };
    renderTab(p);
    fireEvent.click(screen.getByRole('button', { name: /Pi One/ }));
    editMon('cadvisor-pi1');
    expect(screen.getByRole('combobox', { name: 'Node' })).toHaveTextContent('pi9 (not on the board)');
  });
});
