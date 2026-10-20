import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App.jsx';
import { TAB_KEY } from './chunkReload.js';

// After a chunk reload (#379) the page comes back on the tab that was open:
// chunkReload.js stored its id under TAB_KEY just before reloading, and AppMain
// takes it once at boot.

function respond(body) {
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(
    'jaghelm-config',
    JSON.stringify({
      tabs: [{ id: 'grafana', label: 'Grafana', type: 'iframe', url: 'https://grafana.example' }],
    })
  );
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const path = String(url).split('?')[0];
      if (path === '/api/auth/check') return respond({ authRequired: false, authenticated: true });
      if (['/api/todos', '/api/gitea/activity', '/api/cron/status'].includes(path))
        return respond([]);
      return respond({});
    })
  );
});

const selectedTab = async (name) =>
  waitFor(() => expect(screen.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true'));

describe('the tab open before a chunk reload comes back', () => {
  it('reopens Settings', async () => {
    sessionStorage.setItem(TAB_KEY, 'settings');
    render(<App />);
    expect(
      await screen.findByRole('navigation', { name: 'Settings sections' })
    ).toBeInTheDocument();
  });

  it('reopens an iframe tab', async () => {
    sessionStorage.setItem(TAB_KEY, 'grafana');
    render(<App />);
    await selectedTab('Grafana');
    await waitFor(() =>
      expect(document.querySelector('iframe')).toHaveAttribute('src', 'https://grafana.example')
    );
  });

  it('a tab the config no longer has falls back to the dashboard', async () => {
    sessionStorage.setItem(TAB_KEY, 'deleted-tab');
    render(<App />);
    await selectedTab('Dashboard');
    expect(document.querySelector('iframe')).toBeNull();
    expect(sessionStorage.getItem(TAB_KEY)).toBeNull();
  });

  it('is used once: the next normal reload opens the dashboard', async () => {
    sessionStorage.setItem(TAB_KEY, 'grafana');
    const first = render(<App />);
    await selectedTab('Grafana');
    first.unmount();

    render(<App />);
    await selectedTab('Dashboard');
    expect(document.querySelector('iframe')).toBeNull();
  });
});
