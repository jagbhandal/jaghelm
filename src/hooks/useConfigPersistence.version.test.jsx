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
    // Why the file doesn't parse, or can't be read, when it doesn't or can't.
    broken: null,
    unreadable: null,
    // Reads that never answer: the tab closes while one is out.
    hangReads: false,
    noVersion: false,
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
        if (server.hangReads) return new Promise(() => {});
        if (server.unreadable) {
          return Response.json(
            { error: server.unreadable, code: 'config_unreadable' },
            { status: 503 }
          );
        }
        const headers = server.noVersion ? {} : { ETag: `"v${server.version}"` };
        if (server.broken) {
          return Response.json(
            { error: server.broken, code: 'config_unparseable' },
            { status: 503, headers }
          );
        }
        return Response.json(server.config, { headers });
      }
      const ifMatch = new Headers(init.headers).get('If-Match');
      server.posts.push({ body: JSON.parse(init.body), ifMatch, keepalive: init.keepalive });
      if (server.hold) await server.hold;
      server.beforeAnswer?.(server.posts.length);
      if (server.unreadable) {
        return Response.json(
          { error: server.unreadable, code: 'config_unreadable' },
          { status: 503 }
        );
      }
      if (!ifMatch) return Response.json({ error: 'no version' }, { status: 428 });
      if (ifMatch !== `"v${server.version}"`) {
        return Response.json(
          { error: 'stale', stale: true },
          { status: 409, headers: { ETag: `"v${server.version}"` } }
        );
      }
      server.config = JSON.parse(init.body);
      server.broken = null;
      server.version += 1;
      return Response.json({ ok: true }, { headers: { ETag: `"v${server.version}"` } });
    })
  );
}

/** A hand edit that leaves the file unparseable (a trailing comma): a new version, no copy. */
function breakFile() {
  server.broken =
    "display-config.json doesn't parse (Expected double-quoted property name at line 6, column 1); the next save rewrites it";
  server.version += 1;
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

describe('a file that is no config never shrinks one (#547)', () => {
  // A config with what a stale device must never lose.
  const FULL = Object.freeze({
    ...SERVER,
    links: { Media: [{ name: 'Plex', url: 'https://plex.example/' }] },
    tabs: [{ id: 'grafana', label: 'Grafana', type: 'iframe', url: 'https://grafana.example/' }],
    backupJobs: ['nas:restic'],
  });

  it("the review's case: the file breaks by hand, a stale device flips one switch, and the file gets its whole config back", async () => {
    stubServer(structuredClone(FULL));
    const { result, toast } = await mount();
    breakFile();

    await edit(result, (c) => (c.overviewSections.services = false));

    const want = {
      ...structuredClone(FULL),
      overviewSections: { ...FULL.overviewSections, services: false },
    };
    // Refused (409), then the broken file's version, with every key.
    expect(server.posts.map((p) => p.ifMatch)).toEqual(['"v1"', '"v2"']);
    expect(server.posts[1].body).toEqual(want);
    expect(server.config).toEqual(want);
    expect(result.current.config).toEqual(want);
    expect(shadow()).toEqual(want);
    expect(toast).not.toHaveBeenCalled();
  });

  it("a file that doesn't parse at load: the device keeps its config, and its next edit sends the whole of it over the file's version", async () => {
    stubServer(null);
    breakFile();
    localStorage.setItem('jaghelm-config', JSON.stringify(FULL));
    const { result } = await mount(structuredClone(FULL));
    expect(result.current.config).toEqual(FULL);
    expect(shadow()).toEqual(FULL);
    expect(result.current.saved).toBeNull();

    await edit(result, (c) => (c.title = 'Lab'));
    expect(server.posts.map((p) => p.ifMatch)).toEqual(['"v2"']);
    expect(server.config).toEqual({ ...FULL, title: 'Lab' });
  });

  it("no file at a refused save: the whole config goes over the missing file's version", async () => {
    stubServer(structuredClone(FULL));
    const { result } = await mount();
    // Removed by hand: the read answers null, with its version.
    server.config = null;
    server.version += 1;

    await edit(result, (c) => (c.title = 'Lab'));
    expect(server.config).toEqual({ ...FULL, title: 'Lab' });
    expect(result.current.config).toEqual({ ...FULL, title: 'Lab' });
  });

  it('a copy without a version is never shown', async () => {
    server.noVersion = true;
    const { result } = await mount({ title: 'Local' });
    expect(result.current.config).toEqual({ title: 'Local' });
    expect(shadow()).toEqual({ title: 'Local' });
    expect(result.current.saved).toBeNull();
  });

  it("a file the server can't read: the device keeps its config and says why, at load and at a save", async () => {
    const WHY =
      "display-config.json can't be read (permission denied): fix it on the host; JagHelm won't save over a file it can't read";
    server.unreadable = WHY;
    const { result, toast } = await mount({ title: 'Local', links: { Media: [] } });
    expect(toast).toHaveBeenCalledWith(`Couldn't read the display settings: ${WHY}`, 'error');
    expect(result.current.config).toEqual({ title: 'Local', links: { Media: [] } });

    await edit(result, (c) => (c.title = 'Lab'));
    expect(server.posts).toHaveLength(1);
    expect(toast).toHaveBeenCalledWith(`Not saved: ${WHY}`, 'error');
    expect(result.current.config).toEqual({ title: 'Lab', links: { Media: [] } });
    expect(shadow()).toEqual({ title: 'Lab', links: { Media: [] } });
  });
});

describe('an edit whose save never landed is saved at the next load (#547)', () => {
  /** The browser opened again: the config it kept, as App starts with it. */
  const reopen = () => mount(JSON.parse(localStorage.getItem('jaghelm-config')));

  it("the tab closed before the save went out: the edit is saved, and another device's change is kept", async () => {
    const first = await mount();
    act(() =>
      first.result.current.setConfig((c) => ({
        ...c,
        overviewSections: { ...c.overviewSections, infrastructure: false },
      }))
    );
    // The tab closes: its timers go with it, unsent.
    vi.clearAllTimers();
    first.unmount();
    expect(server.posts).toEqual([]);
    elsewhere((c) => (c.overviewSections.services = false));

    const { result } = await reopen();
    await advance(2100);

    const want = {
      ...SERVER,
      overviewSections: { strip: true, services: false, infrastructure: false },
    };
    expect(server.posts.map((p) => p.ifMatch)).toEqual(['"v2"']);
    expect(server.config).toEqual(want);
    expect(result.current.config).toEqual(want);
  });

  it('the flush was refused (409) as the tab closed: the same', async () => {
    const first = await mount();
    elsewhere((c) => (c.overviewSections.services = false));
    act(() => first.result.current.setConfig((c) => ({ ...c, title: 'Lab' })));
    // The refused flush's read never comes back: the tab is gone.
    server.hangReads = true;
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(server.posts.map((p) => p.ifMatch)).toEqual(['"v1"']);
    vi.clearAllTimers();
    first.unmount();
    server.hangReads = false;

    const { result } = await reopen();
    await advance(2100);

    const want = {
      ...SERVER,
      title: 'Lab',
      overviewSections: { ...SERVER.overviewSections, services: false },
    };
    expect(server.posts.map((p) => p.ifMatch)).toEqual(['"v1"', '"v2"']);
    expect(server.config).toEqual(want);
    expect(result.current.config).toEqual(want);
  });
});

// #517: a custom group's icon, colour and hidden, and the old board's
// `sections['group-<id>']`, are left out of every copy this device reads
// (dropDeadGroupKeys), so they are never an edit of its own: a device that
// only loads sends nothing, and its rebase can't undo another device's group
// edit (the groups are one array, replaced whole). Its next real save goes
// without them.
describe('custom groups saved by an older build (#517)', () => {
  const OLD_DNS = {
    id: 'custom-1',
    title: 'DNS',
    icon: '🛡️',
    borderColor: '#7c5cff',
    hidden: true,
    containers: ['adguard-home'],
  };
  const DNS = { id: 'custom-1', title: 'DNS', containers: ['adguard-home'] };
  const OLD = {
    ...SERVER,
    customGroups: [OLD_DNS],
    sections: { 'group-custom-1': { visible: false }, edge: { visible: true } },
  };

  it('a load alone sends nothing, and shows the groups without the dead keys', async () => {
    server.config = structuredClone(OLD);
    const { result } = await mount();
    await advance(10_000);
    expect(server.posts).toEqual([]);
    expect(result.current.config.customGroups).toEqual([DNS]);
    expect(result.current.config.sections).toEqual({ edge: { visible: true } });
  });

  it("another device's group edit survives this device's load and its next save; that save drops the dead keys", async () => {
    server.config = structuredClone(OLD);
    const { result } = await mount();
    // Device A groups pi-1's AdGuard Home while this one has only loaded.
    elsewhere((c) => (c.customGroups = [{ ...DNS, containers: ['pi-1:adguard-home'] }]));
    await advance(5000);
    expect(server.posts).toEqual([]);

    await edit(result, (c) => (c.title = 'Lab'));

    const want = {
      ...SERVER,
      title: 'Lab',
      customGroups: [{ ...DNS, containers: ['pi-1:adguard-home'] }],
      sections: { edge: { visible: true } },
    };
    // Refused once (409), rebased over A's copy, saved once.
    expect(server.posts.map((p) => p.ifMatch)).toEqual(['"v1"', '"v2"']);
    expect(server.config).toEqual(want);
    expect(result.current.config).toEqual(want);
  });

  it('an old build saving them again: merged without them at the next save, then quiet', async () => {
    server.config = { ...structuredClone(SERVER), customGroups: [DNS] };
    const { result } = await mount();
    elsewhere((c) =>
      c.customGroups.push({
        id: 'custom-2',
        title: 'Media',
        icon: '🎬',
        borderColor: '#ffffff',
        containers: ['jellyfin'],
      })
    );
    await edit(result, (c) => (c.title = 'Lab'));

    const want = {
      ...SERVER,
      title: 'Lab',
      customGroups: [DNS, { id: 'custom-2', title: 'Media', containers: ['jellyfin'] }],
    };
    expect(server.posts.map((p) => p.ifMatch)).toEqual(['"v1"', '"v2"']);
    expect(server.config).toEqual(want);
    expect(result.current.config).toEqual(want);
    await advance(10_000);
    expect(server.posts).toHaveLength(2);
  });

  it("this browser's kept copy from the old build counts no dead key as its edit", async () => {
    // Last visit: the old shape read and kept, nothing changed since.
    localStorage.setItem('jaghelm-config', JSON.stringify(OLD));
    localStorage.setItem('jaghelm-config-base', JSON.stringify({ config: OLD, version: '"v1"' }));
    elsewhere((c) => (c.customGroups = [{ ...DNS, containers: ['pi-1:adguard-home'] }]));
    server.config.customGroups[0].icon = '🛡️';
    const { result } = await mount(OLD);
    await advance(5000);
    expect(server.posts).toEqual([]);
    expect(result.current.config.customGroups).toEqual([
      { ...DNS, containers: ['pi-1:adguard-home'] },
    ]);
  });
});

// #306: the old grid board's keys (its layout and columns, the scheduled jobs
// panel's switch, the UPS panel's settings) are read by nothing, so every copy
// is read without them (dropDeadKeys): a load sends nothing, and the next save
// made for something else goes without them. A layout kept in this browser is
// never sent over another device's, the loss #233 found (a second device's
// stale layout replacing the first's on load).
describe("the old grid board's keys (#306, #233)", () => {
  const LAYOUT_A = { lg: [{ i: 'node-pve', x: 0, y: 0, w: 12, h: 8 }] };
  const LAYOUT_B = { lg: [{ i: 'node-pve', x: 12, y: 4, w: 6, h: 9 }] };
  const OLD = {
    ...SERVER,
    gridLayout: LAYOUT_A,
    gridColumns: 12,
    showCronJobs: false,
    sections: { ups: { visible: false }, edge: { visible: true } },
  };

  it('a load sends nothing, and shows none of them', async () => {
    server.config = structuredClone(OLD);
    const { result } = await mount();
    await advance(10_000);
    expect(server.posts).toEqual([]);
    for (const key of ['gridLayout', 'gridColumns', 'showCronJobs'])
      expect(result.current.config).not.toHaveProperty(key);
    expect(result.current.config.sections).toEqual({ edge: { visible: true } });
  });

  it('a stale layout kept in this browser is neither shown nor sent: the server keeps its own', async () => {
    server.config = structuredClone(OLD);
    const local = { ...structuredClone(OLD), gridLayout: LAYOUT_B };
    localStorage.setItem('jaghelm-config', JSON.stringify(local));
    localStorage.setItem(
      'jaghelm-config-base',
      JSON.stringify({ config: { ...structuredClone(OLD), gridLayout: null }, version: '"v1"' })
    );
    const { result } = await mount(local);
    await advance(10_000);
    expect(server.posts).toEqual([]);
    expect(server.config.gridLayout).toEqual(LAYOUT_A);
    expect(result.current.config).not.toHaveProperty('gridLayout');
  });

  it('the next save made for something else goes without them', async () => {
    server.config = structuredClone(OLD);
    const { result } = await mount();
    await edit(result, (c) => (c.title = 'Lab'));
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0].body).toEqual({
      ...SERVER,
      title: 'Lab',
      sections: { edge: { visible: true } },
    });
  });
});
