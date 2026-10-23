import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import App from './App.jsx';

// App tabs stay loaded (#269): an app tab's frame mounts on its first visit and
// stays mounted, hidden, while another page is open, so coming back finds the
// app as it was left: the same frame and document, not a reload. Each opens
// from its entry in the sidebar's Apps group (#296).

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
      tabs: [
        { id: 'grafana', label: 'Grafana', type: 'iframe', url: 'https://grafana.example/' },
        { id: 'kuma', label: 'Uptime Kuma', type: 'iframe', url: 'https://kuma.example/' },
      ],
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

// The sidebar entry named `name` (an app's name may say it is still loaded).
const entry = async (name) =>
  within(await screen.findByRole('navigation', { name: 'Main' })).getByRole('link', {
    name: new RegExp(`^${name}(,|$)`),
  });
const open = async (name) => {
  fireEvent.click(await entry(name));
  await waitFor(async () => expect(await entry(name)).toHaveAttribute('aria-current', 'page'));
};
const frame = (url) => document.querySelector(`iframe[src="${url}"]`);

describe('app tabs stay loaded between switches', () => {
  it('keeps a visited app mounted, hidden, with its state', async () => {
    render(<App />);
    await open('Overview');
    expect(document.querySelector('iframe')).toBeNull();

    await open('Grafana');
    await waitFor(() => expect(frame('https://grafana.example/')).not.toBeNull());
    const grafana = frame('https://grafana.example/');
    fireEvent.load(grafana);
    // State inside the app: its document's own window.
    grafana.contentWindow.appState = 'dashboard 7, last 24 h';

    await open('Overview');
    expect(grafana.isConnected).toBe(true);
    expect(grafana).not.toBeVisible();

    await open('Uptime Kuma');
    await waitFor(() => expect(frame('https://kuma.example/')).not.toBeNull());
    expect(frame('https://grafana.example/')).toBe(grafana);

    await open('Grafana');
    expect(frame('https://grafana.example/')).toBe(grafana);
    expect(grafana.contentWindow.appState).toBe('dashboard 7, last 24 h');
    expect(grafana).toBeVisible();
    expect(frame('https://kuma.example/')).not.toBeVisible();
  });

  it('keeps it through Settings too', async () => {
    render(<App />);
    await open('Grafana');
    await waitFor(() => expect(frame('https://grafana.example/')).not.toBeNull());
    const grafana = frame('https://grafana.example/');
    await open('Settings');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    expect(grafana.isConnected).toBe(true);
    await open('Grafana');
    expect(frame('https://grafana.example/')).toBe(grafana);
  });
});
