import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import SettingsView from './SettingsView';
import { ConfigProvider } from '../context/ConfigContext.jsx';
import { OverlayProvider } from '../context/OverlayContext.jsx';
import {
  maskCredentials,
  restoreCredentials,
} from '../../server/util/configMask.js';

// #413: GET /api/services/config answers each stored credential as
// { "$stored": true }, and the Nodes and Services tabs post the whole config
// back. These drive both tabs against a stub server that answers with the
// real masking and merges each post with the real restore, so they check the
// round trip end to end: the tabs send every marker back where it was, and
// the merged config keeps every credential.

const STORED = Object.freeze({ $stored: true });

/** services.yaml as stored, with every kind of credential it can hold. */
const ON_DISK = {
  nodes: {
    pi1: { display_name: 'Gateway', visible: true, hide: ['prometheus'] },
    nas: { display_name: 'NAS', visible: true },
  },
  services: { adguard: { monitor: 'AdGuard' } },
  integrations: {
    statuspage: {
      url: 'http://status.example.test',
      auth: 'header',
      authHeader: 'X-Api-Key',
      token: 'plain-token-7f3a', // pragma: allowlist secret
      extraHeaders: { Authorization: 'Bearer header-secret-91c2' }, // pragma: allowlist secret
    },
    npm: { url: 'http://npm.example.test', username: 'admin', password: 'hunter2-plaintext' }, // pragma: allowlist secret
    adguard_primary: {
      preset: 'adguard',
      url: 'http://adguard.example.test',
      password: '$secret:integration_adguard_primary_password', // pragma: allowlist secret
    },
    loginapp: {
      url: 'http://login.example.test',
      auth: 'session',
      session: { loginEndpoint: '/login', loginBody: { pass: 'session-secret-55d1' } }, // pragma: allowlist secret
    },
  },
};
const CREDENTIALS = [
  'plain-token-7f3a',
  'header-secret-91c2',
  'hunter2-plaintext',
  '$secret:',
  'session-secret-55d1',
];

const LIVE = {
  nodes: {
    nas: {
      display_name: 'NAS',
      services: [{ container: 'watchtower', display_name: 'Watchtower', status: 'up' }],
    },
  },
};

/**
 * A server that answers the config masked and merges each post as the route
 * does, against `disk` (services.yaml as stored, which a test may change).
 * Like the route (#423), it answers a read with the config's version as an
 * ETag and saves a post only over that version (If-Match): none is a 428, an
 * old one a 409 `{ stale: true }`. `changeElsewhere` changes the stored config
 * as another tab or a hand edit would, which makes a new version.
 * `holdNextPost` keeps the next post unanswered until its release is called,
 * and `holdNextRead` the next read, which answers as the config is then.
 * `hangNextPost` never answers the next post: it fails only when its signal
 * aborts. `requests` lists each config, services and monitors request.
 */
function stubServer(disk = structuredClone(ON_DISK), { etagOnRead = () => true } = {}) {
  const posts = [];
  const sentVersions = [];
  const merged = [];
  let reads = 0;
  let version = 1;
  let held = null;
  let heldRead = null;
  let hang = false;
  const requests = [];
  // Why services.yaml can't be used now (it doesn't parse, or can't be read:
  // brokenCode says which), and whether reads fail for another reason.
  let broken = null;
  let brokenCode = 'config_unparseable';
  let readsFail = false;
  const unparseable = () => Response.json({ error: broken, code: brokenCode }, { status: 503 });
  const tag = () => `"v${version}"`;
  const answer = (body) => {
    if (body.ifMatch == null) {
      return Response.json({ error: 'No config version; reload Settings' }, { status: 428 });
    }
    if (body.ifMatch !== tag()) {
      return Response.json(
        { error: 'services.yaml changed since Settings read it', stale: true },
        { status: 409 }
      );
    }
    const r = restoreCredentials(body.config, disk);
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
    merged.push(r.config);
    for (const k of Object.keys(disk)) delete disk[k];
    Object.assign(disk, structuredClone(r.config));
    version += 1;
    return Response.json({ ok: true }, { headers: { ETag: tag() } });
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, opts = {}) => {
      if (String(url).startsWith('/api/services')) {
        requests.push({ url, method: opts.method ?? 'GET', signal: opts.signal });
      }
      if (url === '/api/services/config' && opts.method === 'POST') {
        const body = {
          config: JSON.parse(opts.body),
          ifMatch: new Headers(opts.headers).get('If-Match'),
        };
        posts.push(body.config);
        sentVersions.push(body.ifMatch);
        if (held) {
          const { promise } = held;
          held = null;
          await promise;
        }
        if (hang) {
          hang = false;
          await new Promise((_, reject) =>
            opts.signal?.addEventListener('abort', () => reject(opts.signal.reason))
          );
        }
        return broken ? unparseable() : answer(body);
      }
      if (url === '/api/services/config') {
        reads += 1;
        if (heldRead) {
          const { promise } = heldRead;
          heldRead = null;
          await promise;
        }
        if (broken) return unparseable();
        if (readsFail) {
          return Response.json({ error: 'Internal server error' }, { status: 500 });
        }
        const headers = etagOnRead(reads) ? { ETag: tag() } : {};
        return Response.json(maskCredentials(disk), { headers });
      }
      if (url === '/api/services') return Response.json(LIVE);
      if (url === '/api/services/monitors') return Response.json([]);
      return Response.json({});
    })
  );
  return {
    posts,
    sentVersions,
    merged,
    reads: () => reads,
    changeElsewhere(change) {
      change(disk);
      version += 1;
    },
    holdNextPost() {
      let release;
      const promise = new Promise((resolve) => (release = resolve));
      held = { promise, release };
      return release;
    },
    hangNextPost() {
      hang = true;
    },
    requests,
    holdNextRead() {
      let release;
      const promise = new Promise((resolve) => (release = resolve));
      heldRead = { promise, release };
      return release;
    },
    /**
     * A hand edit that leaves services.yaml unparseable, for `why`; with
     * `code` 'config_unreadable', a file the server can't read (#536).
     */
    breakFile(why, code = 'config_unparseable') {
      broken = why;
      brokenCode = code;
      version += 1;
    },
    /** The file fixed by hand. */
    fixFile() {
      broken = null;
      version += 1;
    },
    failReads(on) {
      readsFail = on;
    },
  };
}

/** The app around Settings; `open={false}` leaves Settings for another page. */
function Harness({ open = true }) {
  const [config, setConfig] = useState({ title: 'JAGHELM', tabs: [], sections: {}, links: {} });
  return (
    <OverlayProvider>
      <ConfigProvider config={config} setConfig={setConfig}>
        {open && <SettingsView theme="dark" setTheme={() => {}} />}
      </ConfigProvider>
    </OverlayProvider>
  );
}

/** Run `edit` with the save's debounce timer under control, then let it fire. */
function editAndFlush(edit) {
  vi.useFakeTimers();
  try {
    edit();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
  } finally {
    vi.useRealTimers();
  }
}

/** ON_DISK with `node`'s entry changed by `change`. */
function onDiskWith(node, change) {
  const want = structuredClone(ON_DISK);
  Object.assign(want.nodes[node], change);
  return want;
}

function expectRoundTrip({ posts, merged, sentVersions }, want) {
  expect(posts).toHaveLength(1);
  // The post carries the version the read answered (#423).
  expect(sentVersions).toEqual(['"v1"']);
  const sent = JSON.stringify(posts[0]);
  for (const c of CREDENTIALS) expect(sent).not.toContain(c);
  // Every marker goes back where the read put it.
  expect(posts[0].integrations).toEqual(maskCredentials(ON_DISK).integrations);
  expect(posts[0].integrations.npm.password).toEqual(STORED);
  // And the merge restores every credential.
  expect(merged).toEqual([want]);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Settings Nodes and Services tabs post the stored-credential markers back (#413)', () => {
  it('the Nodes tab: hiding a node keeps every credential', async () => {
    const server = stubServer();
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Nodes/ }));
    const title = await screen.findByText('Gateway');
    const card = title.closest('div[style*="border-left"]');
    editAndFlush(() => fireEvent.click(within(card).getByRole('checkbox')));
    await act(async () => {});
    expectRoundTrip(server, onDiskWith('pi1', { visible: false }));
  });

  it('the Services tab: hiding a container keeps every credential', async () => {
    const server = stubServer();
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Services/ }));
    fireEvent.click(await screen.findByText('NAS'));
    editAndFlush(() => fireEvent.click(screen.getByRole('button', { name: 'Hide' })));
    await act(async () => {});
    expectRoundTrip(server, onDiskWith('nas', { hide: ['watchtower'] }));
  });

  it('a refused save says why, and the screen shows what is stored again', async () => {
    const disk = structuredClone(ON_DISK);
    const server = stubServer(disk);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Nodes/ }));
    const nodeCard = async () =>
      (await screen.findByText('Gateway')).closest('div[style*="border-left"]');
    const card = await nodeCard();
    // npm's password goes, under the same version: the stub's way to have the
    // server refuse a marker for a reason other than the version.
    delete disk.integrations.npm.password;
    editAndFlush(() => fireEvent.click(within(card).getByRole('checkbox')));
    expect(within(card).getByRole('checkbox')).not.toBeChecked();

    // The 409's message is shown, and the config is read again.
    expect(
      await screen.findByText(/No credential is stored at integrations\.npm\.password/)
    ).toBeInTheDocument();
    expect(server.merged).toEqual([]);
    await waitFor(() => expect(server.reads()).toBe(2));
    await waitFor(async () =>
      expect(within(await nodeCard()).getByRole('checkbox')).toBeChecked()
    );
  });
});

describe('Settings saves the config only over the version it read (#423)', () => {
  /** The Nodes tab's card for the node titled `title`. */
  const nodeCard = async (title) =>
    (await screen.findByText(title)).closest('div[style*="border-left"]');
  /** Click the visibility checkbox on `title`'s card and let the save go out. */
  const toggleNode = async (title) => {
    const card = await nodeCard(title);
    editAndFlush(() => fireEvent.click(within(card).getByRole('checkbox')));
    await act(async () => {});
  };
  const openNodes = () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Nodes/ }));
  };

  it('the Nodes tab and the Services tab each send the version their config was read at', async () => {
    const server = stubServer();
    openNodes();
    await toggleNode('Gateway');
    // The Services tab reads the config again (version 2 since the save).
    fireEvent.click(screen.getByRole('button', { name: /Services/ }));
    await waitFor(() => expect(server.reads()).toBe(2));
    fireEvent.click(await screen.findByText('NAS'));
    editAndFlush(() => fireEvent.click(screen.getByRole('button', { name: 'Hide' })));
    await act(async () => {});
    expect(server.sentVersions).toEqual(['"v1"', '"v2"']);
    expect(server.merged).toHaveLength(2);
  });

  it('a second save sends the version the first answered, without reading again', async () => {
    const server = stubServer();
    openNodes();
    await toggleNode('Gateway');
    await toggleNode('NAS');
    expect(server.sentVersions).toEqual(['"v1"', '"v2"']);
    expect(server.reads()).toBe(1);
    const both = onDiskWith('pi1', { visible: false });
    both.nodes.nas.visible = false;
    expect(server.merged.at(-1)).toEqual(both);
  });

  it('a save made while another is on its way waits for it, then sends the version it answered', async () => {
    const server = stubServer();
    openNodes();
    const release = server.holdNextPost();
    await toggleNode('Gateway');
    await toggleNode('NAS');
    // The second save is not sent while the first is unanswered.
    expect(server.posts).toHaveLength(1);
    await act(async () => release());
    await waitFor(() => expect(server.posts).toHaveLength(2));
    await act(async () => {});
    expect(server.sentVersions).toEqual(['"v1"', '"v2"']);
    expect(server.merged).toHaveLength(2);
  });

  it('a save over an older read (409) says "Settings changed elsewhere; reloaded" and shows what is stored', async () => {
    const server = stubServer();
    openNodes();
    await nodeCard('Gateway');
    // Another tab renames the node after this one read the config.
    server.changeElsewhere((disk) => (disk.nodes.pi1.display_name = 'Edge'));
    await toggleNode('Gateway');

    expect(await screen.findByText('Settings changed elsewhere; reloaded')).toBeInTheDocument();
    expect(server.merged).toEqual([]);
    await waitFor(() => expect(server.reads()).toBe(2));
    expect(within(await nodeCard('Edge')).getByRole('checkbox')).toBeChecked();
    expect(screen.queryByText('Gateway')).not.toBeInTheDocument();
  });

  it('a refused save drops the edits made after it on the screen it came from', async () => {
    const server = stubServer();
    openNodes();
    await nodeCard('Gateway');
    server.changeElsewhere((disk) => (disk.nodes.nas.display_name = 'Disks'));
    const release = server.holdNextPost();
    await toggleNode('Gateway');
    await toggleNode('NAS');
    await act(async () => release());
    expect(await screen.findByText('Settings changed elsewhere; reloaded')).toBeInTheDocument();
    await waitFor(() => expect(server.reads()).toBe(2));
    await nodeCard('Disks');
    // The second edit, made on the screen the 409 replaced, is never sent,
    // and Settings says so rather than dropping it without a word.
    expect(server.posts).toHaveLength(1);
    expect(server.merged).toEqual([]);
    expect(
      await screen.findByText('Not saved: an earlier change on this screen was refused')
    ).toBeInTheDocument();
  });

  it('a save without a version (428) reloads too, and the next save sends the version read', async () => {
    // The first read comes back without an ETag.
    const server = stubServer(undefined, { etagOnRead: (n) => n > 1 });
    openNodes();
    await toggleNode('Gateway');
    expect(await screen.findByText(/No config version; reload Settings/)).toBeInTheDocument();
    await waitFor(() => expect(server.reads()).toBe(2));
    await waitFor(async () =>
      expect(within(await nodeCard('Gateway')).getByRole('checkbox')).toBeChecked()
    );
    await toggleNode('Gateway');
    expect(server.sentVersions).toEqual([null, '"v1"']);
    expect(server.merged).toEqual([onDiskWith('pi1', { visible: false })]);
  });
});

describe('Settings when services.yaml cannot be read (#423)', () => {
  const BROKEN =
    "services.yaml doesn't parse (line 4): fix it by hand; JagHelm won't save over it";
  const nodeCard = async (title) =>
    (await screen.findByText(title)).closest('div[style*="border-left"]');
  const toggleNode = async (title) => {
    const card = await nodeCard(title);
    editAndFlush(() => fireEvent.click(within(card).getByRole('checkbox')));
    await act(async () => {});
  };
  const openNodes = () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Nodes/ }));
  };

  it('the Nodes and Services tabs say why instead of showing a config, and show it once fixed', async () => {
    const server = stubServer();
    server.breakFile(BROKEN);
    openNodes();
    expect(await screen.findByText(BROKEN)).toBeInTheDocument();
    expect(screen.queryByText('Gateway')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Services/ }));
    await waitFor(() => expect(server.reads()).toBe(2));
    expect(await screen.findByText(BROKEN)).toBeInTheDocument();
    expect(screen.queryByText('NAS')).not.toBeInTheDocument();

    server.fixFile();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('NAS')).toBeInTheDocument();
    expect(screen.queryByText(BROKEN)).not.toBeInTheDocument();
  });

  it("a save refused for it shows the server's message, reads nothing again and doesn't show the edit as saved", async () => {
    const server = stubServer();
    openNodes();
    await nodeCard('Gateway');
    server.breakFile(BROKEN);
    await toggleNode('Gateway');

    expect(await screen.findByText(`Not saved: ${BROKEN}`)).toBeInTheDocument();
    expect(screen.queryByText('Settings changed elsewhere; reloaded')).not.toBeInTheDocument();
    // The tab says why in place of the edited config.
    expect(await screen.findByText(BROKEN)).toBeInTheDocument();
    expect(screen.queryByText('Gateway')).not.toBeInTheDocument();
    // No reload, so no loop: still the one read and the one post.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(server.reads()).toBe(1);
    expect(server.posts).toHaveLength(1);

    // Fixed by hand: Try again reads it, and the next save is sent over it.
    server.fixFile();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await toggleNode('Gateway');
    expect(server.sentVersions).toEqual(['"v1"', '"v3"']);
    expect(server.merged).toEqual([onDiskWith('pi1', { visible: false })]);
  });

  it("when the read after a refused save fails, the tab says so instead of showing the edit as saved", async () => {
    const server = stubServer();
    openNodes();
    await nodeCard('Gateway');
    server.changeElsewhere((disk) => (disk.nodes.pi1.display_name = 'Edge'));
    server.failReads(true);
    await toggleNode('Gateway');

    expect(await screen.findByText('Settings changed elsewhere; reloaded')).toBeInTheDocument();
    expect(
      await screen.findByText("Couldn't read the config: Internal server error")
    ).toBeInTheDocument();
    expect(screen.queryByText('Gateway')).not.toBeInTheDocument();
    expect(server.reads()).toBe(2);

    server.failReads(false);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await toggleNode('Edge');
    expect(server.sentVersions).toEqual(['"v1"', '"v2"']);
    expect(server.merged.at(-1).nodes.pi1).toEqual({
      ...ON_DISK.nodes.pi1,
      display_name: 'Edge',
      visible: false,
    });
  });
});

describe("Settings when services.yaml can't be read (#536, #550)", () => {
  const UNREADABLE =
    "services.yaml can't be read (permission denied): fix it on the host; JagHelm won't save over a file it can't read";
  const nodeCard = async (title) =>
    (await screen.findByText(title)).closest('div[style*="border-left"]');

  it('a save refused with config_unreadable shows the reason at once, without reading again, as config_unparseable does', async () => {
    const server = stubServer();
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Nodes/ }));
    const card = await nodeCard('Gateway');
    server.breakFile(UNREADABLE, 'config_unreadable');
    editAndFlush(() => fireEvent.click(within(card).getByRole('checkbox')));
    await act(async () => {});

    expect(await screen.findByText(`Not saved: ${UNREADABLE}`)).toBeInTheDocument();
    expect(screen.queryByText('Settings changed elsewhere; reloaded')).not.toBeInTheDocument();
    // The tab says why in place of the edited config, from the save's answer.
    expect(await screen.findByText(UNREADABLE)).toBeInTheDocument();
    expect(screen.queryByText('Gateway')).not.toBeInTheDocument();
    // No reload: still the one read and the one post.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(server.reads()).toBe(1);
    expect(server.posts).toHaveLength(1);
  });
});

describe('Settings keeps one config version across its tabs (#501)', () => {
  const nodeCard = async (title) =>
    (await screen.findByText(title)).closest('div[style*="border-left"]');
  const toggleNode = async (title) => {
    const card = await nodeCard(title);
    editAndFlush(() => fireEvent.click(within(card).getByRole('checkbox')));
    await act(async () => {});
  };
  const openNodes = () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Nodes/ }));
  };
  const toServices = () => fireEvent.click(screen.getByRole('button', { name: /Services/ }));
  /** On the Services tab, hide the NAS's container and let the save go out. */
  const hideWatchtower = async () => {
    fireEvent.click(await screen.findByText('NAS'));
    editAndFlush(() => fireEvent.click(screen.getByRole('button', { name: 'Hide' })));
    await act(async () => {});
  };
  /** Gateway hidden on the Nodes tab, then watchtower on the Services tab. */
  const bothEdits = () => {
    const want = onDiskWith('pi1', { visible: false });
    want.nodes.nas.hide = ['watchtower'];
    return want;
  };
  const STALE = 'Settings changed elsewhere; reloaded';

  it('an edit, a switch to another tab before its save goes out, then an edit there: both are saved', async () => {
    const server = stubServer();
    openNodes();
    const card = await nodeCard('Gateway');
    vi.useFakeTimers();
    try {
      fireEvent.click(within(card).getByRole('checkbox'));
      toServices();
      act(() => {
        vi.advanceTimersByTime(1500);
      });
    } finally {
      vi.useRealTimers();
    }
    await hideWatchtower();
    await waitFor(() => expect(server.merged).toHaveLength(2));
    expect(server.sentVersions).toEqual(['"v1"', '"v2"']);
    expect(server.merged.at(-1)).toEqual(bothEdits());
    expect(screen.queryByText(STALE)).not.toBeInTheDocument();
  });

  it('the same with the first save still on its way during the switch', async () => {
    const server = stubServer();
    openNodes();
    const release = server.holdNextPost();
    await toggleNode('Gateway');
    expect(server.posts).toHaveLength(1);
    toServices();
    await act(async () => {});
    // The tab's read waits for the save, so it can't answer the version before it.
    expect(server.reads()).toBe(1);
    await act(async () => release());
    await waitFor(() => expect(server.reads()).toBe(2));
    await hideWatchtower();
    await waitFor(() => expect(server.merged).toHaveLength(2));
    expect(server.sentVersions).toEqual(['"v1"', '"v2"']);
    expect(server.merged.at(-1)).toEqual(bothEdits());
    expect(screen.queryByText(STALE)).not.toBeInTheDocument();
  });

  it("an edit made before the new tab's read answers stays on the screen, and is saved", async () => {
    const server = stubServer();
    openNodes();
    const release = server.holdNextPost();
    await toggleNode('Gateway');
    toServices();
    await hideWatchtower();
    await act(async () => release());
    await waitFor(() => expect(server.merged).toHaveLength(2));
    expect(server.reads()).toBe(2);
    expect(server.sentVersions).toEqual(['"v1"', '"v2"']);
    expect(server.merged.at(-1)).toEqual(bothEdits());
    // The read, older than the edit, didn't put the screen back.
    expect(screen.getByRole('button', { name: 'Show' })).toBeInTheDocument();
  });

  it("a change elsewhere that such a read shows still refuses the edit's save (409) and reloads", async () => {
    const server = stubServer();
    openNodes();
    await nodeCard('Gateway');
    const release = server.holdNextRead();
    toServices();
    await waitFor(() => expect(server.reads()).toBe(2));
    server.changeElsewhere((disk) => (disk.nodes.pi1.display_name = 'Edge'));
    await hideWatchtower();
    await act(async () => release());

    expect(await screen.findByText(STALE)).toBeInTheDocument();
    expect(server.sentVersions).toEqual(['"v1"']);
    expect(server.merged).toEqual([]);
    await waitFor(() => expect(server.reads()).toBe(3));
    // The reload shows what is stored: the edit is gone.
    expect(await screen.findByRole('button', { name: 'Hide' })).toBeInTheDocument();
  });

  it('the read after a refused save replaces the screen even when an edit was made meanwhile', async () => {
    const server = stubServer();
    openNodes();
    await nodeCard('Gateway');
    server.changeElsewhere((disk) => (disk.nodes.pi1.display_name = 'Edge'));
    const release = server.holdNextRead();
    await toggleNode('Gateway');
    expect(await screen.findByText(STALE)).toBeInTheDocument();
    await waitFor(() => expect(server.reads()).toBe(2));
    // An edit on the refused screen while the reload is out.
    await toggleNode('Gateway');
    await act(async () => release());

    expect(within(await nodeCard('Edge')).getByRole('checkbox')).toBeChecked();
    expect(
      await screen.findByText('Not saved: an earlier change on this screen was refused')
    ).toBeInTheDocument();
    expect(server.posts).toHaveLength(1);
    expect(server.merged).toEqual([]);
  });
});

describe('Settings saves outlive the view, a silent server and the tab (#501)', () => {
  const nodeCard = async (title) =>
    (await screen.findByText(title)).closest('div[style*="border-left"]');
  const toggleNode = async (title) => {
    const card = await nodeCard(title);
    editAndFlush(() => fireEvent.click(within(card).getByRole('checkbox')));
    await act(async () => {});
  };
  const openNodes = () => {
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Nodes/ }));
    return view;
  };

  it('an edit, leaving Settings before its save goes out, then an edit on coming back: both are saved', async () => {
    const server = stubServer();
    const { rerender } = openNodes();
    const card = await nodeCard('Gateway');
    const release = server.holdNextPost();
    vi.useFakeTimers();
    try {
      fireEvent.click(within(card).getByRole('checkbox'));
      rerender(<Harness open={false} />);
    } finally {
      vi.useRealTimers();
    }
    // Leaving Settings sends the save at once.
    await act(async () => {});
    expect(server.posts).toHaveLength(1);
    rerender(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Nodes/ }));
    await act(async () => {});
    // The new view's read waits for the save.
    expect(server.reads()).toBe(1);
    await act(async () => release());
    await waitFor(() => expect(server.reads()).toBe(2));
    await toggleNode('NAS');
    await waitFor(() => expect(server.merged).toHaveLength(2));
    expect(server.sentVersions).toEqual(['"v1"', '"v2"']);
    const both = onDiskWith('pi1', { visible: false });
    both.nodes.nas.visible = false;
    expect(server.merged.at(-1)).toEqual(both);
    expect(screen.queryByText('Settings changed elsewhere; reloaded')).not.toBeInTheDocument();
  });

  it('a save the server never answers gives up after 15 s, says so, and the config is read again before the next save', async () => {
    const timeouts = [];
    const controllers = new Map();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      timeouts.push(ms);
      const controller = new AbortController();
      controllers.set(controller.signal, controller);
      return controller.signal;
    });
    const server = stubServer();
    openNodes();
    await nodeCard('Gateway');
    server.hangNextPost();
    await toggleNode('Gateway');
    expect(server.posts).toHaveLength(1);

    // 15 s pass with no answer.
    const post = server.requests.find((r) => r.method === 'POST');
    act(() =>
      controllers.get(post.signal).abort(new DOMException('signal timed out', 'TimeoutError'))
    );
    expect(
      await screen.findByText("Not saved: the server didn't answer in 15 s")
    ).toBeInTheDocument();
    await waitFor(() => expect(server.reads()).toBe(2));
    await waitFor(async () =>
      expect(within(await nodeCard('Gateway')).getByRole('checkbox')).toBeChecked()
    );
    await toggleNode('Gateway');
    await waitFor(() => expect(server.merged).toHaveLength(1));
    expect(server.sentVersions).toEqual(['"v1"', '"v1"']);
    // Every save and read carried the one timeout.
    expect(server.requests.length).toBeGreaterThan(6);
    for (const r of server.requests) expect(r.signal).toBeInstanceOf(AbortSignal);
    expect(new Set(timeouts)).toEqual(new Set([15_000]));
  });

  it('closing the tab asks first while a save is waiting or on its way, and not after', async () => {
    const server = stubServer();
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const unloadCalls = (spy) => spy.mock.calls.filter(([type]) => type === 'beforeunload');
    const closingAsks = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    openNodes();
    const card = await nodeCard('Gateway');
    expect(closingAsks()).toBe(false);
    const release = server.holdNextPost();
    vi.useFakeTimers();
    try {
      fireEvent.click(within(card).getByRole('checkbox'));
      expect(closingAsks()).toBe(true);
      act(() => {
        vi.advanceTimersByTime(1500);
      });
    } finally {
      vi.useRealTimers();
    }
    await act(async () => {});
    expect(server.posts).toHaveLength(1);
    expect(closingAsks()).toBe(true);
    await act(async () => release());
    await waitFor(() => expect(server.merged).toHaveLength(1));
    await waitFor(() => expect(closingAsks()).toBe(false));
    expect(unloadCalls(added)).toHaveLength(1);
    expect(unloadCalls(removed)).toHaveLength(1);
    expect(unloadCalls(removed)[0][1]).toBe(unloadCalls(added)[0][1]);
  });
});
