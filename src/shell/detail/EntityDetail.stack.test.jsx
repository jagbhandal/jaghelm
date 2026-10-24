/*
 * A Compose stack's detail (#642): the lead's entity drawn as the stack, its
 * containers listed with their own states, and the edits (Set lead, Ungroup,
 * Split out) sent to services.yaml. The board is the server's own
 * (server/testing/stackBoard.js).
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OverlayProvider } from '../../context/OverlayContext.jsx';
import { stackBoard } from '../../../server/testing/stackBoard.js';
import { entityDetail } from './entityDetail.js';
import { EntityDetail } from './EntityDetail.jsx';
import { StackSection } from './StackSection.jsx';

const mocks = vi.hoisted(() => ({
  lead: vi.fn(),
  ungroup: vi.fn(),
  split: vi.fn(),
  openEntity: vi.fn(),
  returnFocusTo: vi.fn(),
  opener: { current: null },
}));
vi.mock('./stackEdits.js', () => ({
  stackEdit: { lead: mocks.lead, ungroup: mocks.ungroup, split: mocks.split },
}));
vi.mock('../entityNav.js', async (importOriginal) => ({
  ...(await importOriginal()),
  openEntity: mocks.openEntity,
  returnFocusTo: mocks.returnFocusTo,
  entityOpener: () => mocks.opener.current,
}));

const LEAD = 'services/vm103:immich_server';
const viewOf = (opts) => {
  const { status, services } = stackBoard(opts);
  return entityDetail({ status, id: LEAD, read: { services: { body: services, error: null } } });
};

beforeEach(() => {
  for (const m of [mocks.lead, mocks.ungroup, mocks.split, mocks.openEntity, mocks.returnFocusTo]) {
    m.mockReset();
    m.mockResolvedValue(undefined);
  }
  mocks.opener.current = null;
});

describe('the stack as the view says it', () => {
  it("is named for the stack, in the rollup's state, with its containers and their images", () => {
    const view = viewOf({ redis: 'down' });
    expect(view).toMatchObject({
      status: 'found',
      eyebrow: 'Stack · Compose project immich',
      title: 'Immich',
      where: 'Production (vm103) · 4 containers',
      state: 'crit',
      word: 'Degraded',
      reason: 'Immich Redis is down',
      note: '3 of 4 containers running',
    });
    expect(view.stack).toMatchObject({ project: 'immich', node: 'vm103', count: 4 });
    expect(view.stack.members.map((m) => [m.name, m.state, !!m.lead])).toEqual([
      ['Immich Server', 'ok', true],
      ['Immich Machine Learning', 'ok', false],
      ['Immich Postgres', 'ok', false],
      ['Immich Redis', 'crit', false],
    ]);
    expect(view.stack.members[0].image).toBe('example.com/immich_server:latest');
    // Its heartbeats are the lead's own, its link the stack's.
    expect(view.links.primary).toBeNull();
  });

  it('a healthy stack says all its containers run; a container on its own is no stack', () => {
    const { status, services } = stackBoard();
    const read = { services: { body: services, error: null } };
    expect(entityDetail({ status, id: LEAD, read })).toMatchObject({
      state: 'ok',
      word: 'Up',
      note: 'All 4 containers running',
    });
    const gitea = entityDetail({ status, id: 'services/vm103:gitea', read });
    expect(gitea.stack).toBeNull();
    expect(gitea.eyebrow).toBe('Service');
  });

  it('a folded container has its own detail, as a container', () => {
    const { status, services } = stackBoard({ redis: 'down' });
    const view = entityDetail({
      status,
      id: 'services/vm103:immich_redis',
      read: { services: { body: services, error: null } },
    });
    expect(view).toMatchObject({ eyebrow: 'Service', title: 'Immich Redis', state: 'crit' });
    expect(view.stack).toBeNull();
  });
});

function drawn(opts) {
  const view = viewOf(opts);
  render(
    <OverlayProvider>
      <EntityDetail view={view} slots={{ stack: (v) => (v.stack ? <StackSection stack={v.stack} /> : null) }} />
    </OverlayProvider>
  );
  return view;
}

describe('the panel', () => {
  it("lists the containers with each one's own state, the lead first and tagged", () => {
    drawn({ redis: 'down' });
    const list = screen.getByRole('region', { name: 'Containers of Immich' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Immich Server');
    expect(items[0]).toHaveTextContent('Lead');
    expect(items[3]).toHaveTextContent('Immich Redis');
    expect(items[3]).toHaveTextContent('Kuma: down');
    expect(within(list).getByText('Containers · 4')).toBeInTheDocument();
    // The status box is the rollup's.
    expect(screen.getByText('Degraded')).toBeInTheDocument();
    expect(screen.getByText('Immich Redis is down')).toBeInTheDocument();
  });

  it('Details opens the container over the stack and keeps focus on the row that opened the stack', async () => {
    const row = document.createElement('button');
    document.body.append(row);
    mocks.opener.current = row;
    drawn();
    await userEvent.click(screen.getByRole('button', { name: 'Details of Immich Postgres' }));
    expect(mocks.openEntity).toHaveBeenCalledWith('services/vm103:immich_postgres');
    expect(mocks.returnFocusTo).toHaveBeenCalledWith(row);
    row.remove();
  });

  it('Set lead… saves the chosen container as the stack\'s lead, per node and project', async () => {
    drawn();
    await userEvent.click(screen.getByRole('combobox', { name: 'Set lead' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Immich Postgres' }));
    expect(mocks.lead).toHaveBeenCalledWith('vm103', 'immich', 'immich_postgres');
  });

  it('Ungroup and Split out save their edits; the lead has no Split out', async () => {
    drawn();
    expect(screen.queryByRole('button', { name: 'Split Immich Server out of the stack' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Ungroup' }));
    expect(mocks.ungroup).toHaveBeenCalledWith('vm103', 'immich');
    await userEvent.click(screen.getByRole('button', { name: 'Split Immich Redis out of the stack' }));
    expect(mocks.split).toHaveBeenCalledWith('vm103', 'immich', 'immich_redis');
  });

  it("a save that is refused says why, over the list, and nothing else changes", async () => {
    mocks.ungroup.mockRejectedValue(new Error('Settings changed elsewhere. Try again.'));
    drawn();
    await userEvent.click(screen.getByRole('button', { name: 'Ungroup' }));
    expect(await screen.findByText('Settings changed elsewhere. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ungroup' })).toBeEnabled();
  });
});
