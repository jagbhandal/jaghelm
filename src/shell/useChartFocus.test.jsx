/**
 * useChartFocus's lookup (#805): only a chart the page draws is focused. A
 * Panel in the DOM for a chart not in `charts` (the phone's "not on the phone
 * yet" row) is quiet: no ring, no scroll, no announcement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useChartFocus } from './useChartFocus.js';

beforeEach(() => {
  document.body.innerHTML =
    '<div data-slot="monitoring-chart" data-chart="restarts" tabindex="-1"></div>' +
    '<div data-slot="monitoring-chart" data-chart="memory" tabindex="-1"></div>';
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  document.body.innerHTML = '';
  delete Element.prototype.scrollIntoView;
  window.history.replaceState(null, '', '/');
});

const run = (id, charts) => {
  window.history.replaceState(null, '', `/monitoring?focus=${id}`);
  return renderHook(() => useChartFocus({ loaded: true, status: undefined, charts }));
};

describe('useChartFocus', () => {
  it('focuses a chart that is in `charts`', async () => {
    const { result } = run('memory', { memory: 'Memory' });
    await waitFor(() => expect(result.current.active).toBe('memory'));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('leaves a chart that has a Panel but is not in `charts` quiet', () => {
    const { result } = run('restarts', { memory: 'Memory' });
    expect(result.current.active).toBeNull();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(result.current.announce).toBe('');
  });
});
