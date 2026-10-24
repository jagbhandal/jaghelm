import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { INCIDENT } from './testing/statusFixtures.js';

// Settings → Appearance's accent and density (#321) reach the whole app: the
// shell gives every root of the new UI the switches the display config
// picks, a change applies at once, and it is saved with the display config.
// An accent colour a config saved before #304 maps to the nearest offered,
// once, and Settings says so.

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

// `serverConfig` is the display config the server holds; each config the app
// saves lands in `server.saves`.
function stubServer({ serverConfig = {}, config = {} } = {}) {
  server = { saves: [] };
  localStorage.setItem('jaghelm-config', JSON.stringify(config));
  vi.stubGlobal(
    'fetch',
    vi.fn((url, init) => {
      const path = String(url).split('?')[0];
      if (path === '/api/auth/check') return respond({ authRequired: true, authenticated: true });
      if (path === '/api/status') return respond(INCIDENT);
      if (path === '/api/display-config' && init?.method === 'POST') {
        server.saves.push(JSON.parse(init.body));
        return respond({ ok: true }, 200, { ETag: `"v${server.saves.length + 1}"` });
      }
      if (path === '/api/display-config') return respond(serverConfig, 200, { ETag: '"v1"' });
      if (['/api/todos', '/api/gitea/activity', '/api/cron/status'].includes(path))
        return respond([]);
      return respond({});
    })
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('jaghelm-token', 'tok');
});
afterEach(() => vi.useRealTimers());

async function renderApp(path = '/') {
  window.history.replaceState(null, '', path);
  render(<App />);
  await screen.findByRole('navigation', { name: 'Main' });
}

/** Every root of the new UI the shell draws: its chrome, and each page or section. */
const shellRoots = () => {
  const roots = [
    screen.getByRole('banner').closest('.jh-ui'),
    screen.getByRole('navigation', { name: 'Main' }).closest('.jh-ui'),
    screen.getByRole('navigation', { name: 'Tabs' }).closest('.jh-ui'),
    ...document.querySelectorAll('[data-slot="shell-section"], [data-slot="shell-page"]'),
  ];
  expect(roots.every(Boolean)).toBe(true);
  return roots;
};
const switchesOf = (root) => [root.getAttribute('data-accent'), root.getAttribute('data-density')];

describe('the accent and density, app-wide', () => {
  it('the display config’s reach every root of the shell, the Overview’s sections too', async () => {
    stubServer({ serverConfig: { accent: 'fuchsia', density: 'compact' } });
    await renderApp('/');
    await waitFor(() =>
      expect(screen.getByRole('banner').closest('.jh-ui')).toHaveAttribute('data-accent', 'fuchsia')
    );
    const roots = shellRoots();
    expect(roots.length).toBeGreaterThan(3);
    for (const root of roots) expect(switchesOf(root)).toEqual(['fuchsia', 'compact']);
  });

  it('the defaults, Violet and comfortable, set no attribute; an accent nobody offers reads as Violet', async () => {
    stubServer({ serverConfig: { accent: 'blue', density: 'cosy' } });
    await renderApp('/');
    await waitFor(() =>
      expect(document.querySelector('[data-slot="shell-section"]')).not.toBeNull()
    );
    for (const root of shellRoots()) expect(switchesOf(root)).toEqual([null, null]);
  });

  it('Compact, picked in Settings → Appearance, applies everywhere at once and is saved', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    stubServer();
    await renderApp('/settings/appearance');
    const density = await screen.findByRole('radiogroup', { name: 'Density' });
    await user.click(within(density).getByRole('radio', { name: 'Compact' }));
    for (const root of shellRoots()) expect(root).toHaveAttribute('data-density', 'compact');
    // The section's own root too: Settings draws in it.
    expect(density.closest('.jh-ui')).toHaveAttribute('data-density', 'compact');
    expect(JSON.parse(localStorage.getItem('jaghelm-config')).density).toBe('compact');
    await act(() => vi.advanceTimersByTimeAsync(2500));
    await waitFor(() => expect(server.saves.at(-1)).toMatchObject({ density: 'compact' }));

    // A reload draws it straight away, from this browser's copy, before the server answers.
    cleanup();
    stubServer({ config: { density: 'compact' }, serverConfig: { density: 'compact' } });
    window.history.replaceState(null, '', '/');
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main' });
    expect(screen.getByRole('banner').closest('.jh-ui')).toHaveAttribute('data-density', 'compact');
  });
});

describe('an accent colour saved before #304', () => {
  it('maps to the nearest offered once the server’s copy is in, is saved, and Settings says so', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubServer({ serverConfig: { title: 'Home', accentColor: '#ec4899' } });
    await renderApp('/settings/appearance');
    await waitFor(() =>
      expect(screen.getByRole('banner').closest('.jh-ui')).toHaveAttribute('data-accent', 'fuchsia')
    );
    const accent = screen.getByRole('region', { name: 'Accent' });
    expect(within(accent).getByText('Your accent is now Fuchsia')).toBeInTheDocument();
    expect(within(accent).getByRole('radio', { name: 'Fuchsia' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await act(() => vi.advanceTimersByTimeAsync(2500));
    await waitFor(() => expect(server.saves.length).toBeGreaterThan(0));
    const saved = server.saves.at(-1);
    expect(saved).toMatchObject({
      title: 'Home',
      accent: 'fuchsia',
      accentNotice: { from: '#ec4899', to: 'fuchsia' },
    });
    expect(saved).not.toHaveProperty('accentColor');
  });
});
