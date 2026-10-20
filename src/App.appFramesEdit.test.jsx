import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import App from './App.jsx';

// Editing a loaded app's URL (#269). The URL field changes the config on every
// key, and the config is saved 2 s after the last one. A hidden frame keeps
// the URL it last showed, and the embed check asks only about the URL the
// server has saved: an edited URL is checked once its save lands, so the
// answer can't be about the old URL, and nothing is checked per keystroke.

const OLD = 'https://vault.example/';
const NEW = 'https://vault2.example/';

let saved; // the server's display config
let checks; // embed-check requests, by tab id
let posts;

function respond(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  saved = { tabs: [{ id: 'vault', label: 'Vaultwarden', type: 'iframe', url: OLD }] };
  localStorage.setItem('jaghelm-config', JSON.stringify(saved));
  checks = [];
  posts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url, opts = {}) => {
      const path = String(url).split('?')[0];
      if (path === '/api/auth/check') return respond({ authRequired: false, authenticated: true });
      if (path === '/api/display-config') {
        if (opts.method === 'POST') {
          posts++;
          saved = JSON.parse(opts.body);
          return respond({ ok: true });
        }
        return respond(saved);
      }
      const m = /^\/api\/embed-check\/(.+)$/.exec(path);
      if (m) {
        // As the server does: it answers about the URL it has saved.
        checks.push(m[1]);
        const tab = saved.tabs.find((t) => t.id === m[1]);
        if (!tab) return respond({ error: 'No saved app tab has that id' }, 404);
        return respond(
          tab.url === NEW
            ? { url: tab.url, verdict: 'blocked', header: 'X-Frame-Options: DENY' }
            : { url: tab.url, verdict: 'allowed' }
        );
      }
      if (['/api/todos', '/api/gitea/activity', '/api/cron/status'].includes(path))
        return respond([]);
      return respond({});
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms) => act(() => vi.advanceTimersByTimeAsync(ms));
const frames = () => [...document.querySelectorAll('iframe')];
const blockedHeading = () =>
  screen.queryByRole('heading', { name: "Vaultwarden won't open inside JagHelm" });

async function openVault() {
  fireEvent.click(screen.getByRole('tab', { name: 'Vaultwarden' }));
  await vi.waitFor(() => expect(frames()).toHaveLength(1)); // the lazy chunk
  await advance(0);
}

// Open the app (its URL saved and allowed), then Settings → Tabs → its URL field.
async function editUrl() {
  render(<App />);
  await vi.waitFor(() => screen.getByRole('tab', { name: 'Vaultwarden' }));
  await advance(0);
  await openVault();
  fireEvent.load(frames()[0]);
  expect(checks).toEqual(['vault']);

  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  const nav = await vi.waitFor(() => screen.getByRole('navigation', { name: 'Settings sections' }));
  fireEvent.click(within(nav).getByText('Tabs'));
  fireEvent.click(await vi.waitFor(() => screen.getByText('Click to edit')));
  const input = screen.getByDisplayValue(OLD);
  // A key at a time, faster than the 2 s save.
  for (let n = 'https://vault'.length; n <= NEW.length; n++) {
    fireEvent.change(input, { target: { value: NEW.slice(0, n) } });
    await advance(100);
  }
}

describe("editing a loaded app's URL", () => {
  it('the hidden frame keeps its URL and nothing is checked while typing', async () => {
    await editUrl();
    expect(frames().map((f) => f.getAttribute('src'))).toEqual([OLD]);
    expect(checks).toEqual(['vault']);
    expect(posts).toBe(0);
  });

  it('a blocked new URL shows the blocked notice once saved (back after the save)', async () => {
    await editUrl();
    await advance(2000);
    expect(posts).toBe(1);
    expect(saved.tabs[0].url).toBe(NEW);
    // Saved, but the hidden frame still shows the old URL: nothing to ask yet.
    expect(checks).toEqual(['vault']);

    await openVault();
    expect(frames().map((f) => f.getAttribute('src'))).toEqual([NEW]);
    fireEvent.load(frames()[0]); // Chromium fires load for a refused frame too
    expect(checks).toEqual(['vault', 'vault']);
    expect(blockedHeading()).toBeInTheDocument();
  });

  it('a blocked new URL shows the blocked notice once saved (back before the save)', async () => {
    await editUrl();
    await openVault();
    expect(frames().map((f) => f.getAttribute('src'))).toEqual([NEW]);
    fireEvent.load(frames()[0]);
    // Not saved yet: the server would answer about the old URL, so nothing is asked.
    expect(checks).toEqual(['vault']);
    expect(blockedHeading()).toBeNull();

    await advance(2000);
    expect(posts).toBe(1);
    expect(checks).toEqual(['vault', 'vault']);
    expect(blockedHeading()).toBeInTheDocument();
  });
});
