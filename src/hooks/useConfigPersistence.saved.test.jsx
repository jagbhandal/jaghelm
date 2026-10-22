import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';
import { useConfigPersistence } from './useConfigPersistence.js';

// The saved config (#269): what the server has, which the embed check asks
// about. It is the mount load's config, then each save once the server takes it.

let server; // the server's display config
let accept; // whether the server takes a save

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  server = { title: 'Server', tabs: [{ id: 'a', type: 'iframe', url: 'https://a.example/' }] };
  accept = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      if ((init.method || 'GET').toUpperCase() === 'GET') {
        // With its version (#547): a copy without one is never shown.
        return new Response(JSON.stringify(server), { status: 200, headers: { ETag: '"v1"' } });
      }
      if (!accept) return new Response('{"error":"nope"}', { status: 500 });
      server = JSON.parse(init.body);
      return new Response('{"ok":true}', { status: 200 });
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms) => act(() => vi.advanceTimersByTimeAsync(ms));

function mount() {
  return renderHook(() => {
    const [config, setConfig] = useState({ title: 'Local' });
    const saved = useConfigPersistence(config, setConfig, vi.fn(), vi.fn());
    return { config, setConfig, saved };
  });
}

const editUrl = (result, url) =>
  act(() =>
    result.current.setConfig((c) => ({ ...c, tabs: [{ id: 'a', type: 'iframe', url }] }))
  );

describe('the saved config', () => {
  it('is null before the load, then the server config', async () => {
    const { result } = mount();
    expect(result.current.saved).toBeNull();
    await advance(0);
    expect(result.current.saved.tabs[0].url).toBe('https://a.example/');
  });

  it('follows a save once the server takes it, not before', async () => {
    const { result } = mount();
    await advance(3000);
    editUrl(result, 'https://b.example/');
    await advance(1900);
    expect(result.current.saved.tabs[0].url).toBe('https://a.example/');
    await advance(200);
    expect(result.current.saved.tabs[0].url).toBe('https://b.example/');
  });

  it('keeps the last saved config when a save fails', async () => {
    const { result } = mount();
    await advance(3000);
    accept = false;
    editUrl(result, 'https://c.example/');
    await advance(3000);
    expect(result.current.config.tabs[0].url).toBe('https://c.example/');
    expect(result.current.saved.tabs[0].url).toBe('https://a.example/');
  });
});
