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
 * `holdNextPost` keeps the next post unanswered until its release is called.
 */
function stubServer(disk = structuredClone(ON_DISK), { etagOnRead = () => true } = {}) {
  const posts = [];
  const sentVersions = [];
  const merged = [];
  let reads = 0;
  let version = 1;
  let held = null;
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
        return answer(body);
      }
      if (url === '/api/services/config') {
        reads += 1;
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
  };
}

function Harness() {
  const [config, setConfig] = useState({ title: 'JAGHELM', tabs: [], sections: {}, links: {} });
  return (
    <OverlayProvider>
      <ConfigProvider config={config} setConfig={setConfig}>
        <SettingsView theme="dark" setTheme={() => {}} />
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
    // Another tab removes npm's password after this one read the config.
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
    // The second edit, made on the screen the 409 replaced, is never sent.
    expect(server.posts).toHaveLength(1);
    expect(server.merged).toEqual([]);
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
