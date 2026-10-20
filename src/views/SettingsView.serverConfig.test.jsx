import { render, screen, fireEvent, act, within } from '@testing-library/react';
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

/** A server that answers the config masked and merges each post as the route does. */
function stubServer() {
  const posts = [];
  const merged = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, opts = {}) => {
      if (url === '/api/services/config' && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        posts.push(body);
        const r = restoreCredentials(body, ON_DISK);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
        merged.push(r.config);
        return Response.json({ ok: true });
      }
      if (url === '/api/services/config') return Response.json(maskCredentials(ON_DISK));
      if (url === '/api/services') return Response.json(LIVE);
      if (url === '/api/services/monitors') return Response.json([]);
      return Response.json({});
    })
  );
  return { posts, merged };
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

function expectRoundTrip({ posts, merged }, want) {
  expect(posts).toHaveLength(1);
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
});
