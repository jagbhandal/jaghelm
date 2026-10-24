import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PhoneDetail from './PhoneDetail.jsx';
import { PhonePlatform } from '../phone/platform.js';
import { OverlayProvider } from '../context/OverlayContext.jsx';
import { forgetAnswers } from '../hooks/useData.js';
import { webStatus } from '../hooks/useStatus.js';
import { stackBoard, STACK_NOW } from '../../server/testing/stackBoard.js';

// The board as the web reads it: counted by stacks (useStatus webStatus).
const webBoard = (opts) => {
  const board = stackBoard(opts);
  return { ...board, status: webStatus(board.status) };
};
import { issueRowsOf, cellsOf, nodeCardsOf, serviceRowsOf } from '../phone/data/board.js';

// The phone's sheet and board with Compose stacks (#642): a stack is one row
// in the list and one sheet, its containers a list in it, each with a sheet of
// its own. The board is the server's own (server/testing/stackBoard.js).

const UPDATED = Object.freeze({ subscribe: () => () => {}, get: () => STACK_NOW });
const dataOf = (opts) => {
  const { status, services } = webBoard(opts);
  return {
    status,
    reach: 'ok',
    servicesBody: services,
    updated: UPDATED,
    loading: false,
    error: null,
    freshness: { stale: false },
  };
};

beforeEach(() => {
  forgetAnswers();
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({}) })
    )
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('the phone board', () => {
  const data = dataOf({ redis: 'down' });

  it('lists a stack once, as the stack, in its rollup; worst first', () => {
    const rows = serviceRowsOf(data);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({
      uid: 'vm103:immich-server',
      display_name: 'Immich',
      state: 'crit',
      word: 'Degraded',
      reason: 'Immich Redis is down',
    });
    expect(rows[0].stack.chip).toBe('+3 · 1 down');
    expect(rows.map((r) => r.uid)).not.toContain('vm103:immich-redis');
  });

  it("a container's own sheet finds it, folded", () => {
    const row = serviceRowsOf({ ...data, withFolded: true }).find((r) => r.uid === 'vm103:immich-redis');
    expect(row).toMatchObject({ folded: true, state: 'crit', word: 'Down' });
  });

  it('the Services tile counts rows; a node counts its containers, as Infrastructure does', () => {
    const tile = cellsOf(data).find((c) => c.key === 'services');
    expect(tile).toMatchObject({ value: '6 / 7', sub: '1 degraded' });
    expect(nodeCardsOf(data)[0].services).toBe('15 / 16 services up · 1 down');
  });

  it('the issue is the stack row, naming the failing container', () => {
    expect(issueRowsOf(data)).toEqual([
      expect.objectContaining({
        title: 'Immich',
        readout: 'Stack · vm103',
        cause: 'Immich Redis is down · 1 of 4 containers',
        word: 'Degraded',
        target: { kind: 'service', uid: 'vm103:immich-server' },
      }),
    ]);
  });
});

function sheet(uid, data, nav = { push: vi.fn(), pop: vi.fn() }) {
  render(
    <OverlayProvider>
      <PhonePlatform value={{ openTarget: vi.fn() }}>
        <PhoneDetail screen="serviceDetail" data={data} nav={nav} params={{ uid }} />
      </PhonePlatform>
    </OverlayProvider>
  );
  return nav;
}

describe('the phone sheet of a stack', () => {
  it('is the stack: its name, its rollup, its containers; Details opens that container\'s sheet', async () => {
    const nav = sheet('vm103:immich-server', dataOf({ redis: 'down' }));
    expect(screen.getByRole('heading', { name: 'Immich' })).toBeInTheDocument();
    expect(screen.getByText('Degraded')).toBeInTheDocument();
    expect(screen.getAllByText('Immich Redis is down').length).toBeGreaterThan(0);
    const list = screen.getByRole('region', { name: 'Containers of Immich' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    await userEvent.click(within(list).getByRole('button', { name: 'Details of Immich Redis' }));
    expect(nav.push).toHaveBeenCalledWith('serviceDetail', { uid: 'vm103:immich-redis' });
  });

  it('a folded container has a sheet of its own, with no stack list', () => {
    sheet('vm103:immich-redis', dataOf({ redis: 'down' }));
    expect(screen.getByRole('heading', { name: 'Immich Redis' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Containers of/ })).toBeNull();
  });

  it('a service on its own has no stack list', () => {
    sheet('vm103:gitea', dataOf());
    expect(screen.queryByRole('region', { name: /Containers of/ })).toBeNull();
  });
});
