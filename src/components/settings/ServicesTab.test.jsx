import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ServicesTab from './ServicesTab';
import { OverlayProvider } from '../../context/OverlayContext.jsx';

// ServicesTab hide rules must match a container by its EXACT name, not a
// substring. The old `containerName.includes(h)` logic meant hiding "redis"
// also hid "redis-backup", and un-hiding a container stripped every rule whose
// name was a substring of it. These tests lock in exact-match semantics by
// driving the Hide/Show buttons and asserting the `hide` list handed to onSave.

const NODE_KEY = 'gateway';

function makeProps({ hide = [], onSave } = {}) {
  return {
    serverConfig: {
      services: {},
      nodes: { [NODE_KEY]: { display_name: 'Gateway', hide } },
    },
    liveServices: {
      nodes: {
        [NODE_KEY]: {
          display_name: 'Gateway',
          services: [
            // display_name differs from container so text queries stay unambiguous.
            { container: 'redis', display_name: 'Redis Cache', status: 'up' },
            { container: 'redis-backup', display_name: 'Redis Backup', status: 'up' },
          ],
        },
      },
    },
    monitorNames: [],
    onSave: onSave || vi.fn(),
    saving: false,
  };
}

function renderTab(props) {
  return render(
    <OverlayProvider>
      <ServicesTab {...props} />
    </OverlayProvider>
  );
}

// The services list lives behind the collapsible node header; expand it first.
function expandNode() {
  fireEvent.click(screen.getByText('Gateway'));
}

// Find the service-row element for a given container name. The container name
// is rendered in a mono <div>; the row is two levels up (mono div → name block
// → flex row), which also holds the Hide/Show button.
function rowFor(containerName) {
  const monoEl = screen.getByText((_content, el) => {
    return (
      el?.tagName === 'DIV' &&
      el.style.fontFamily?.includes('font-mono') &&
      el.textContent.trim() === containerName
    );
  });
  return monoEl.parentElement.parentElement;
}

describe('ServicesTab hide/unhide is exact-match', () => {
  it('hiding "redis" does not add a rule that would also hide "redis-backup"', () => {
    const onSave = vi.fn();
    renderTab(makeProps({ hide: [], onSave }));
    expandNode();

    fireEvent.click(within(rowFor('redis')).getByRole('button', { name: 'Hide' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.nodes[NODE_KEY].hide).toEqual(['redis']);
  });

  it('renders redis as hidden but redis-backup as visible when only "redis" is hidden', () => {
    renderTab(makeProps({ hide: ['redis'] }));
    expandNode();

    // Exact-match: redis offers "Show" (already hidden); redis-backup still
    // offers "Hide" — a substring match would have wrongly hidden it too.
    expect(within(rowFor('redis')).getByRole('button', { name: 'Show' })).toBeInTheDocument();
    expect(
      within(rowFor('redis-backup')).getByRole('button', { name: 'Hide' })
    ).toBeInTheDocument();
  });

  it('un-hiding "redis" leaves an unrelated "redis-backup" rule intact', () => {
    const onSave = vi.fn();
    renderTab(makeProps({ hide: ['redis', 'redis-backup'], onSave }));
    expandNode();

    fireEvent.click(within(rowFor('redis')).getByRole('button', { name: 'Show' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    // Only the exact "redis" rule was removed; "redis-backup" survives.
    expect(saved.nodes[NODE_KEY].hide).toEqual(['redis-backup']);
  });
});

// A container on two nodes keeps one monitor per node (#633).
function twoNodeProps(services, onSave) {
  const svc = { container: 'gateway-npm', display_name: 'NPM', status: 'up' };
  return {
    serverConfig: {
      services,
      nodes: { pi1: { display_name: 'Pi One' }, pi2: { display_name: 'Pi Two' } },
    },
    liveServices: {
      nodes: {
        pi1: { display_name: 'Pi One', services: [svc] },
        pi2: { display_name: 'Pi Two', services: [svc] },
      },
    },
    monitorNames: ['NPM A', 'NPM B'],
    onSave,
    saving: false,
  };
}

function openMonitorSelect(nodeLabel) {
  fireEvent.click(screen.getByText(nodeLabel));
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  return screen.getByRole('combobox');
}

describe('ServicesTab monitor per node', () => {
  it('editing pi2 writes monitor_per_node.pi2 and leaves pi1 and monitor alone', () => {
    const onSave = vi.fn();
    renderTab(
      twoNodeProps(
        { 'gateway-npm': { monitor: 'NPM A', monitor_per_node: { pi1: 'NPM A' } } },
        onSave
      )
    );
    fireEvent.change(openMonitorSelect('Pi Two'), { target: { value: 'NPM B' } });
    expect(onSave.mock.calls[0][0].services['gateway-npm']).toEqual({
      monitor: 'NPM A',
      monitor_per_node: { pi1: 'NPM A', pi2: 'NPM B' },
    });
  });

  it('shows the node entry, else the container-wide monitor, and offers every monitor on both nodes', () => {
    renderTab(
      twoNodeProps(
        { 'gateway-npm': { monitor: 'NPM A', monitor_per_node: { pi2: 'NPM B' } } },
        vi.fn()
      )
    );
    const select = openMonitorSelect('Pi Two');
    expect(select.value).toBe('NPM B');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.value)
    ).toEqual(['', 'NPM A', 'NPM B']);
  });

  it('falls back to the container-wide monitor on a node with no entry (backward compatible)', () => {
    renderTab(twoNodeProps({ 'gateway-npm': { monitor: 'NPM A' } }, vi.fn()));
    expect(openMonitorSelect('Pi One').value).toBe('NPM A');
  });

  it('Auto-match removes only this node entry', () => {
    const onSave = vi.fn();
    renderTab(
      twoNodeProps({ 'gateway-npm': { monitor_per_node: { pi1: 'NPM A', pi2: 'NPM B' } } }, onSave)
    );
    fireEvent.change(openMonitorSelect('Pi Two'), { target: { value: '' } });
    expect(onSave.mock.calls[0][0].services['gateway-npm']).toEqual({
      monitor_per_node: { pi1: 'NPM A' },
    });
  });

  it('Auto-match on the last entry drops the empty map and the empty override', () => {
    const onSave = vi.fn();
    renderTab(twoNodeProps({ 'gateway-npm': { monitor_per_node: { pi2: 'NPM B' } } }, onSave));
    fireEvent.change(openMonitorSelect('Pi Two'), { target: { value: '' } });
    expect(onSave.mock.calls[0][0].services).toEqual({});
  });

  it('Auto-match keeps display_name when it drops the last per-node entry', () => {
    const onSave = vi.fn();
    renderTab(
      twoNodeProps(
        { 'gateway-npm': { display_name: 'Proxy', monitor_per_node: { pi2: 'NPM B' } } },
        onSave
      )
    );
    fireEvent.change(openMonitorSelect('Pi Two'), { target: { value: '' } });
    expect(onSave.mock.calls[0][0].services['gateway-npm']).toEqual({ display_name: 'Proxy' });
  });

  it('a container on one node still writes the container-wide monitor', () => {
    const onSave = vi.fn();
    renderTab({ ...makeProps({ onSave }), monitorNames: ['Redis'] });
    expandNode();
    fireEvent.click(within(rowFor('redis')).getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Redis' } });
    expect(onSave.mock.calls[0][0].services.redis).toEqual({ monitor: 'Redis' });
  });
});
