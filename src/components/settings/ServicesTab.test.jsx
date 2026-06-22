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
