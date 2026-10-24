/*
 * The order of the nodes (#667): the one rule (orderNodes), where it is applied
 * (the services body, useDashboardData) and what the screens then list.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { moveKey, orderNodes, savedOrder, withNodeOrder } from './nodeOrder.js';
import { useDashboardData } from './useDashboardData.js';
import { infrastructureNodes } from './infrastructureView.js';
import { serviceGroups, serviceRows } from './servicesView.js';
import { serviceFilterOptions } from './pageFilters.js';
import { demoBoard } from '../testing/statusFixtures.js';
import { forgetAnswers } from '../hooks/useData.js';

const NOW = Date.parse('2026-10-20T09:00:00Z');

describe('orderNodes', () => {
  const keys = ['edge', 'apps', 'storage'];
  it('lists the saved keys first, as saved', () => {
    expect(orderNodes(keys, ['storage', 'edge', 'apps'])).toEqual(['storage', 'edge', 'apps']);
  });
  it('puts a node the list lacks (a new one) after, in its current order', () => {
    expect(orderNodes(['edge', 'apps', 'storage', 'new1', 'new2'], ['storage', 'edge'])).toEqual([
      'storage',
      'edge',
      'apps',
      'new1',
      'new2',
    ]);
  });
  it('ignores a listed node that is gone, leaving no gap', () => {
    expect(orderNodes(keys, ['storage', 'gone', 'edge'])).toEqual(['storage', 'edge', 'apps']);
  });
  it('counts a repeated key once', () => {
    expect(orderNodes(keys, ['apps', 'apps', 'edge'])).toEqual(['apps', 'edge', 'storage']);
  });
  it.each([[undefined], [null], ['apps'], [{ 0: 'apps' }], [['apps', 3]], [[null]]])(
    'a bad nodeOrder (%j) is the old order',
    (bad) => {
      expect(orderNodes(keys, bad)).toEqual(keys);
    }
  );
  it('does not change what it is given', () => {
    const list = ['storage'];
    orderNodes(keys, list);
    expect(keys).toEqual(['edge', 'apps', 'storage']);
    expect(list).toEqual(['storage']);
  });
});

describe('moveKey and savedOrder', () => {
  it('moves one place, and refuses the ends and a stranger', () => {
    expect(moveKey(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveKey(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveKey(['a', 'b', 'c'], 'a', -1)).toBeNull();
    expect(moveKey(['a', 'b', 'c'], 'c', 1)).toBeNull();
    expect(moveKey(['a', 'b', 'c'], 'z', 1)).toBeNull();
  });
  it('saves at most the 64 keys the server keeps', () => {
    const many = Array.from({ length: 70 }, (_, i) => `n${i}`);
    expect(savedOrder(many)).toHaveLength(64);
  });
});

describe('withNodeOrder', () => {
  const body = { nodes: { edge: { a: 1 }, apps: { a: 2 }, storage: { a: 3 } }, other: 1 };
  it('reorders the nodes and keeps the rest of the body', () => {
    const out = withNodeOrder(body, ['storage', 'edge']);
    expect(Object.keys(out.nodes)).toEqual(['storage', 'edge', 'apps']);
    expect(out.nodes.storage).toBe(body.nodes.storage);
    expect(out.other).toBe(1);
  });
  it('is the same object when there is nothing to change (a 304 stays stable)', () => {
    expect(withNodeOrder(body, undefined)).toBe(body);
    expect(withNodeOrder(body, ['edge', 'apps'])).toBe(body);
    expect(withNodeOrder(body, 'edge')).toBe(body);
    expect(withNodeOrder(null, ['edge'])).toBeNull();
  });
});

describe('the screens list the nodes in the saved order', () => {
  const board = demoBoard({ scenario: 'incident', now: NOW });
  const ORDER = ['storage', 'apps', 'edge'];
  const services = withNodeOrder(board.services, ORDER);

  it('Infrastructure: the node cards', () => {
    const before = infrastructureNodes({ status: board.status, services: board.services });
    const nodes = infrastructureNodes({ status: board.status, services });
    expect(before.map((n) => n.key)).toEqual(Object.keys(board.services.nodes));
    expect(nodes.map((n) => n.key)).toEqual(ORDER);
  });
  it('Services: the groups by node', () => {
    const rows = serviceRows({ status: board.status, services });
    const keys = serviceGroups(rows, { by: 'node', services }).map((g) => g.key);
    expect(keys).toEqual(ORDER.map((k) => `node:${k}`));
  });
  it('Services: the Node filter', () => {
    const rows = serviceRows({ status: board.status, services });
    expect(serviceFilterOptions(rows, services).nodes.map((n) => n.value)).toEqual(ORDER);
  });
});

describe('useDashboardData applies nodeOrder to the services body', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    forgetAnswers();
  });
  const json = (body) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  });
  const serve = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn((url) =>
        Promise.resolve(
          json(String(url).endsWith('/api/services') ? { nodes: { a: {}, b: {}, c: {} } } : {})
        )
      )
    );

  it('puts the saved order on serviceData.nodes, and follows a change of it', async () => {
    serve();
    const { result, rerender } = renderHook(({ nodeOrder }) => useDashboardData(0, { nodeOrder }), {
      initialProps: { nodeOrder: ['c', 'a'] },
    });
    await waitFor(() =>
      expect(Object.keys(result.current.serviceData.nodes)).toEqual(['c', 'a', 'b'])
    );
    rerender({ nodeOrder: ['b'] });
    expect(Object.keys(result.current.serviceData.nodes)).toEqual(['b', 'a', 'c']);
    rerender({ nodeOrder: 'junk' });
    expect(Object.keys(result.current.serviceData.nodes)).toEqual(['a', 'b', 'c']);
  });
});
