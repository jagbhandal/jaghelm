import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';
import { useConfigPersistence } from './useConfigPersistence.js';

// #547: the display config saves only over the version this device read
// (If-Match). A save refused because another device saved first (409) is
// rebased: the server's copy is read again, only what this device changed
// since its copy is laid over it, and that is saved once over the new
// version. A second refusal in a row takes the server's copy as it is.

let server;

/** A server that keeps the display config, versioned as the route does. */
function stubServer(config) {
  server = {
    config,
    version: 1,
    posts: [],
    reads: 0,
    hold: null,
    beforeAnswer: null,
    failReads: 0,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const method = (init.method || 'GET').toUpperCase();
      if (method === 'GET') {
        server.reads += 1;
        if (server.failReads > 0) {
          server.failReads -= 1;
          throw new TypeError('Failed to fetch');
        }
        return Response.json(server.config, { headers: { ETag: `"v${server.version}"` } });
      }
      const ifMatch = new Headers(init.headers).get('If-Match');
      server.posts.push({ body: JSON.parse(init.body), ifMatch, keepalive: init.keepalive });
      if (server.hold) await server.hold;
      server.beforeAnswer?.(server.posts.length);
      if (!ifMatch) return Response.json({ error: 'no version' }, { status: 428 });
      if (ifMatch !== `"v${server.version}"`) {
        return Response.json(
          { error: 'stale', stale: true },
          { status: 409, headers: { ETag: `"v${server.version}"` } }
        );
      }
      server.config = JSON.parse(init.body);
      server.version += 1;
      return Response.json({ ok: true }, { headers: { ETag: `"v${server.version}"` } });
    })
  );
}

/** Another device saves `change` of the server's copy. */
function elsewhere(change) {
  const next = structuredClone(server.config);
  change(next);
  server.config = next;
  server.version += 1;
}

const SERVER = Object.freeze({
  title: 'Home',
  refreshInterval: 30,
  overviewSections: { strip: true, services: true, infrastructure: true },
});

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  stubServer(structuredClone(SERVER));
});

afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms) => act(() => vi.advanceTimersByTimeAsync(ms));

/** The hook over a real config state, loaded from the server. */
async function mount(local = { title: 'Local' }) {
  const toast = vi.fn();
  const hook = renderHook(() => {
    const [config, setConfig] = useState(local);
    const saved = useConfigPersistence(config, setConfig, vi.fn(), toast);
    return { config, setConfig, saved };
  });
  await advance(3000);
  return { ...hook, toast };
}

/** An edit of the config, as Settings makes one, then the save's debounce. */
async function edit(result, change) {
  act(() =>
    result.current.setConfig((c) => {
      const next = structuredClone(c);
      change(next);
      return next;
    })
  );
  await advance(2100);
}

const shadow = () => JSON.parse(localStorage.getItem('jaghelm-config'));

describe('the display config saves over the version it read (#547)', () => {
  it('sends the version the read answered, and the next save the version the first answered', async () => {
    const { result } = await mount();
    // The config is the server's: nothing to save.
    expect(server.posts).toEqual([]);

    await edit(result, (c) => (c.title = 'Lab'));
    await edit(result, (c) => (c.refreshInterval = 60));

    expect(server.posts.map((p) => p.ifMatch)).toEqual(['"v1"', '"v2"']);
    expect(server.config).toEqual({ ...SERVER, title: 'Lab', refreshInterval: 60 });
    expect(server.reads).toBe(1);
  });

  it('a section hidden on another device stays hidden when this one saves: refused (409), rebased, saved once', async () => {
    const { result, toast } = await mount();
    elsewhere((c) => (c.overviewSections.services = false));

    await edit(result, (c) => (c.overviewSections.infrastructure = false));

    const want = {
      ...SERVER,
      overviewSections: { strip: true, services: false, infrastructure: false },
    };
    expect(server.posts.map((p) => p.ifMatch)).toEqual(['"v1"', '"v2"']);
    expect(server.config).toEqual(want);
    // This device now shows, keeps and has saved the merged config.
    expect(result.current.config).toEqual(want);
    expect(shadow()).toEqual(want);
    expect(result.current.saved).toEqual(want);
    expect(toast).toHaveBeenCalledWith('Merged with changes from another device', 'info');

    // And nothing goes out again for it.
    await advance(5000);
    expect(server.posts).toHaveLength(2);
  });

  it('the same setting changed on both: this later save wins, and nothing else is lost', async () => {
    const { result } = await mount();
    elsewhere((c) => {
      c.title = 'Theirs';
      c.refreshInterval = 60;
      c.overviewSections.strip = false;
    });

    await edit(result, (c) => (c.title = 'Mine'));

    expect(server.config).toEqual({
      ...SERVER,
      title: 'Mine',
      refreshInterval: 60,
      overviewSections: { strip: false, services: true, infrastructure: true },
    });
    expect(result.current.config).toEqual(server.config);
  });

  it("a second refusal in a row takes the server's copy, without this device's change, and says so", async () => {
    const { result, toast } = await mount();
    elsewhere((c) => (c.overviewSections.services = false));
    // A third device saves while the rebased save is on its way.
    server.beforeAnswer = (n) => n === 2 && elsewhere((c) => (c.title = 'Third'));

    await edit(result, (c) => (c.refreshInterval = 120));

    expect(server.posts).toHaveLength(2);
    const want = {
      ...SERVER,
      title: 'Third',
      overviewSections: { ...SERVER.overviewSections, services: false },
    };
    expect(server.config).toEqual(want);
    expect(result.current.config).toEqual(want);
    expect(shadow()).toEqual(want);
    expect(result.current.saved).toEqual(want);
    expect(toast).toHaveBeenCalledWith('Settings changed on another device; reloaded', 'error');
    expect(toast).not.toHaveBeenCalledWith('Merged with changes from another device', 'info');

    // The server's copy is not sent back.
    await advance(5000);
    expect(server.posts).toHaveLength(2);
  });

  it('a save without a version (the read failed) is refused (428), then only its edit is saved over the version read', async () => {
    server.failReads = 1;
    const { result } = await mount({ title: 'Stale copy', theme: 'dark' });

    await edit(result, (c) => (c.refreshInterval = 120));

    expect(server.posts.map((p) => p.ifMatch)).toEqual([null, '"v1"']);
    // The browser's old title and theme are not written over the server's.
    expect(server.config).toEqual({ ...SERVER, refreshInterval: 120 });
    expect(result.current.config).toEqual(server.config);
  });

  it('one save at a time: an edit made while a save is on its way goes out after it, over the version it answered', async () => {
    const { result } = await mount();
    let release;
    server.hold = new Promise((resolve) => (release = resolve));

    await edit(result, (c) => (c.title = 'One'));
    expect(server.posts).toHaveLength(1);
    await edit(result, (c) => (c.refreshInterval = 45));
    // Still one: the second waits for the first's answer.
    expect(server.posts).toHaveLength(1);

    server.hold = null;
    release();
    await advance(0);
    expect(server.posts.map((p) => p.ifMatch)).toEqual(['"v1"', '"v2"']);
    expect(server.config).toEqual({ ...SERVER, title: 'One', refreshInterval: 45 });
  });

  it('leaving the page sends the pending save at once, with its version', async () => {
    const { result } = await mount();
    act(() => result.current.setConfig((c) => ({ ...c, title: 'Leaving' })));
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]).toMatchObject({ ifMatch: '"v1"', keepalive: true });
    // Sent once: the debounce has nothing left to send.
    await advance(3000);
    expect(server.posts).toHaveLength(1);
  });
});
