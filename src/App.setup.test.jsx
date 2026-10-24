import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { forgetAnswers } from './hooks/useData.js';
import { demoBoard, FIRST_RUN } from './testing/statusFixtures.js';
import { demoResponse } from '../server/demo.js';

// The guided first run (#322, spec §8): on a fresh install (the server's
// setup-pending marker) the Overview's address opens a setup that goes
// Prometheus, nodes, Kuma and NUT, integrations, and ends on the Overview;
// Skip ends it too; nobody else ever sees it. e2e/setup.spec.mjs runs it in a
// browser against the demo's answers.

const BOARD = demoBoard({ scenario: 'healthy' });
const SERVICES_CONFIG = {
  nodes: { apps: { prometheus_node: 'apps', display_name: 'App Server', visible: true, hide: [] } },
  services: {},
  integrations: {},
};

let requests;
let server;

function respond(body, status = 200, headers = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function stubServer({ pending = true, status = BOARD.status, services = BOARD.services } = {}) {
  requests = [];
  server = { pending };
  vi.stubGlobal(
    'fetch',
    vi.fn((url, opts) => {
      const path = String(url).split('?')[0];
      requests.push(`${opts?.method ?? 'GET'} ${path}`);
      if (path === '/api/auth/check') return respond({ authRequired: true, authenticated: true });
      if (path === '/api/setup' && !opts?.method) return respond({ pending: server.pending });
      if (path === '/api/setup/done') {
        server.pending = false;
        return respond({ pending: false });
      }
      if (path === '/api/status') return respond(status);
      if (path === '/api/services') return respond(services);
      if (path === '/api/services/config') return respond(SERVICES_CONFIG, 200, { ETag: '"v1"' });
      if (path === '/api/display-config') return respond({}, 200, { ETag: '"d1"' });
      if (path === '/api/integrations') return respond({});
      if (['/api/todos', '/api/gitea/activity', '/api/cron/status', '/api/services/monitors'].includes(path))
        return respond([]);
      return respond(demoResponse({ path, scenario: 'healthy' }).body ?? {});
    })
  );
}

async function open(path = '/') {
  window.history.replaceState(null, '', path);
  render(<App />);
  await screen.findByRole('navigation', { name: 'Main' });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('jaghelm-token', 'tok');
  forgetAnswers();
});

describe('the guided first run (#322)', () => {
  it('walks Prometheus, nodes, Kuma and NUT, integrations, then lands on the Overview', async () => {
    stubServer();
    const user = userEvent.setup();
    await open();
    expect(await screen.findByRole('heading', { name: 'Set up JagHelm', level: 1 })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Infrastructure' })).toBeNull();

    // 1. Prometheus: its row is Settings → Sources' own, live.
    const prometheus = await screen.findByRole('region', { name: 'Connect Prometheus' });
    expect(within(prometheus).getByText('Answering')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // 2. Nodes: Settings' own editor, the discovered node in it.
    const nodes = await screen.findByRole('region', { name: 'Pick your nodes' });
    expect(await within(nodes).findByText('App Server')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // 3. Kuma and NUT: each its source row.
    const optional = await screen.findByRole('region', { name: 'Uptime Kuma and your UPS' });
    expect(within(optional).getByText('Uptime Kuma')).toBeInTheDocument();
    expect(within(optional).getByText('NUT (UPS)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // 4. Integrations: the Integrations section itself; then Finish.
    expect(await screen.findByRole('heading', { name: /Add an integration/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Finish and open the Overview/ }));

    expect(await screen.findByRole('region', { name: 'Infrastructure' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Set up JagHelm' })).toBeNull();
    expect(requests).toContain('POST /api/setup/done');
    expect(server.pending).toBe(false);
  });

  it('Skip setup ends the whole thing at any step', async () => {
    stubServer();
    const user = userEvent.setup();
    await open();
    await screen.findByRole('heading', { name: 'Set up JagHelm' });
    await user.click(screen.getByRole('button', { name: 'Skip setup' }));
    expect(await screen.findByRole('region', { name: 'Infrastructure' })).toBeVisible();
    expect(requests).toContain('POST /api/setup/done');
  });

  it('says what to set when Prometheus is not answering, and still lets you carry on', async () => {
    // No PROMETHEUS_URL: the model lists no Prometheus source.
    stubServer({
      status: { ...FIRST_RUN, sources: {} },
      services: { nodes: {}, discovery: 'waiting' },
    });
    const user = userEvent.setup();
    await open();
    await screen.findByRole('heading', { name: 'Set up JagHelm' });
    expect((await screen.findAllByText(/PROMETHEUS_URL/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Its address is JagHelm/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue anyway' }));
    // No node yet: nothing here may save, since a save ends the wait.
    const setup = within(document.querySelector('[data-slot="setup"]'));
    expect(await setup.findByText('Waiting for your first node')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Pick your nodes' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.queryByRole('heading', { name: /Add an integration/ })).toBeNull();
    expect(screen.getByText(/open once JagHelm has found your first node/)).toBeInTheDocument();
    expect(requests.filter((r) => r.startsWith('POST') || r.startsWith('PUT'))).toEqual([]);
  });

  it('shows nothing to an install that is not fresh', async () => {
    stubServer({ pending: false });
    await open();
    expect(await screen.findByRole('region', { name: 'Infrastructure' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Set up JagHelm' })).toBeNull();
  });

  // Spec §8: an unconfigured source renders no panel, no "Unknown" placeholder.
  it('a board whose only source is Prometheus draws no Power, Jobs or Backups, and no strip tile for them', async () => {
    const only = (e) => e.kind === 'node' || e.kind === 'service';
    stubServer({
      pending: false,
      status: {
        ...BOARD.status,
        entities: BOARD.status.entities.filter(only),
        subsystems: BOARD.status.subsystems.filter((s) => ['services', 'nodes'].includes(s.id)),
        sources: { prometheus: BOARD.status.sources.prometheus },
      },
    });
    await open();
    expect(await screen.findByRole('region', { name: 'Infrastructure' })).toBeVisible();
    expect(await screen.findByRole('region', { name: 'Services' })).toBeVisible();
    for (const name of ['Power', 'Jobs', 'Backups'])
      expect(screen.queryByRole('region', { name }), name).toBeNull();
    const strip = document.querySelector('[aria-label="Subsystems"]');
    expect(strip).not.toBeNull();
    expect(within(strip).queryByText(/^(Power|Jobs|Backups|Integrations)$/)).toBeNull();
    expect(within(strip).getByText('Nodes')).toBeInTheDocument();
    expect(screen.queryByText(/unknown/i)).toBeNull();
  });

  it('opens on the Overview only: Settings and the other pages stay reachable', async () => {
    stubServer();
    await open('/settings/sources');
    await screen.findByRole('heading', { name: 'Sources' });
    expect(screen.queryByRole('heading', { name: 'Set up JagHelm' })).toBeNull();
  });
});
