import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';
import { useConfigPersistence } from './useConfigPersistence.js';

// A read-only server (the public demo, #248) is sent no settings: an edit stays
// in this browser, no save is attempted, and no "couldn't save" toast shows.

let requests;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const method = (init.method || 'GET').toUpperCase();
      requests.push(`${method} ${url}`);
      if (method !== 'GET')
        return new Response('{"error":"This is a read-only demo"}', { status: 403 });
      return new Response(JSON.stringify({ title: 'Demo', links: {} }), { status: 200 });
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
});

/** The hook over a real config state; returns its setter and the toast spy. */
async function mount(options) {
  const toast = vi.fn();
  const { result } = renderHook(() => {
    const [config, setConfig] = useState({ title: 'Local' });
    useConfigPersistence(config, setConfig, vi.fn(), toast, options);
    return { config, setConfig };
  });
  // The load from the server, then the save debounce.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  return { result, toast };
}

async function edit(result) {
  act(() => result.current.setConfig((c) => ({ ...c, title: 'Edited' })));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
}

describe('useConfigPersistence', () => {
  it('sends a read-only server nothing, keeps the edit in the browser, and shows no toast', async () => {
    const { result, toast } = await mount({ readOnly: true });
    expect(result.current.config.title).toBe('Demo');

    await edit(result);
    window.dispatchEvent(new Event('pagehide'));

    expect(requests).toEqual(['GET /api/display-config']);
    expect(JSON.parse(localStorage.getItem('jaghelm-config')).title).toBe('Edited');
    expect(toast).not.toHaveBeenCalled();
  });

  it('saves an edit to a writable server (control)', async () => {
    const { result } = await mount();
    requests.length = 0;

    await edit(result);

    expect(requests).toEqual(['POST /api/display-config']);
  });
});
