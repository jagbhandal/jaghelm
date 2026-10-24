import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { INCIDENT } from './testing/statusFixtures.js';
import midnight from '../docs/examples/midnight-theme.json';

// Custom themes (#331) end to end: a theme in the display config is validated
// when it loads, applied to every root of the shell and to what the shell
// portals (the same custom properties the built-in themes' tokens give), kept
// across a reload, and a theme that fails changes nothing but its listing.

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
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => vi.useRealTimers());

async function renderApp(path = '/') {
  window.history.replaceState(null, '', path);
  render(<App />);
  await screen.findByRole('navigation', { name: 'Main' });
}

const BAD = {
  ...midnight,
  id: 'dim',
  name: 'Dim',
  tokens: { ...midnight.tokens, 'text-2': 'oklch(0.5 0.02 255)' },
};
const header = () => screen.getByRole('banner').closest('.jh-ui');
const BG = '--jh-bg';

describe('a custom theme chosen in this browser', () => {
  it('reaches every root of the shell as custom properties, and keeps its base’s attribute', async () => {
    localStorage.setItem('jaghelm-theme', 'custom:dark:midnight');
    stubServer({ config: { themes: [midnight] }, serverConfig: { themes: [midnight] } });
    await renderApp('/');
    await waitFor(() => expect(header().style.getPropertyValue(BG)).toBe('oklch(0.15 0.02 255)'));
    const roots = [
      header(),
      screen.getByRole('navigation', { name: 'Main' }).closest('.jh-ui'),
      ...document.querySelectorAll('[data-slot="shell-section"], [data-slot="shell-page"]'),
    ];
    expect(roots.length).toBeGreaterThan(2);
    for (const root of roots) {
      expect(root.style.getPropertyValue(BG)).toBe('oklch(0.15 0.02 255)');
      expect(root.style.getPropertyValue('--jh-text-2')).toBe('oklch(0.78 0.02 255)');
      expect(root).not.toHaveAttribute('data-theme'); // dark, its base
    }
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('a palette opened from the shell is a root with the same colours', async () => {
    const user = userEvent.setup();
    localStorage.setItem('jaghelm-theme', 'custom:dark:midnight');
    stubServer({ config: { themes: [midnight] }, serverConfig: { themes: [midnight] } });
    await renderApp('/');
    await waitFor(() => expect(header().style.getPropertyValue(BG)).not.toBe(''));
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog');
    expect(dialog.closest('.jh-ui').style.getPropertyValue(BG)).toBe('oklch(0.15 0.02 255)');
  });

  it('draws its base until the validator is in, then the theme; a light base never flashes dark', async () => {
    const light = {
      id: 'paper',
      name: 'Paper',
      base: 'light',
      tokens: { bg: '#fafafb' },
    };
    localStorage.setItem('jaghelm-theme', 'custom:light:paper');
    stubServer({ config: { themes: [light] }, serverConfig: { themes: [light] } });
    await renderApp('/');
    expect(header()).toHaveAttribute('data-theme', 'light');
    await waitFor(() => expect(header().style.getPropertyValue(BG)).toBe('#fafafb'));
    expect(header()).toHaveAttribute('data-theme', 'light');
  });

  it('a theme that fails is not applied: the app keeps its base, no half theme, no crash', async () => {
    localStorage.setItem('jaghelm-theme', 'custom:dark:dim');
    stubServer({ config: { themes: [BAD] }, serverConfig: { themes: [BAD] } });
    await renderApp('/');
    // Give the validator time to answer.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(header().style.getPropertyValue(BG)).toBe('');
    expect(header().style.cssText).toBe('');
    expect(header()).not.toHaveAttribute('data-theme');
    // Still chosen, so a fix to the config applies it.
    expect(localStorage.getItem('jaghelm-theme')).toBe('custom:dark:dim');
  });

  it('a theme the server’s copy no longer has goes back to the default', async () => {
    localStorage.setItem('jaghelm-theme', 'custom:dark:gone');
    stubServer({ config: { themes: [midnight] }, serverConfig: { themes: [midnight] } });
    await renderApp('/');
    await waitFor(() => expect(localStorage.getItem('jaghelm-theme')).toBe('dark'));
    expect(header().style.getPropertyValue(BG)).toBe('');
  });

  it('a hand-edited hostile theme in the config is rejected on load and nothing of it reaches a style', async () => {
    const evil = {
      ...midnight,
      id: 'evil',
      tokens: {
        bg: 'red; } body { display: none } .x { color: red',
        'text-1': 'url(//evil.example/x)',
      },
    };
    localStorage.setItem('jaghelm-theme', 'custom:dark:evil');
    stubServer({ config: { themes: [evil] }, serverConfig: { themes: [evil] } });
    await renderApp('/');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(header().getAttribute('style')).toBeNull();
    expect(getComputedStyle(document.body).display).not.toBe('none');
  });
});

describe('Settings → Appearance → Theme', () => {
  it('picking a custom theme applies it at once everywhere, is kept in this browser, and survives a reload', async () => {
    const user = userEvent.setup();
    stubServer({ serverConfig: { themes: [midnight] } });
    await renderApp('/settings/appearance');
    const group = await screen.findByRole('radiogroup', { name: 'Theme' });
    const midnightCard = within(group).getByRole('radio', { name: /Midnight/ });
    expect(header().style.getPropertyValue(BG)).toBe('');
    await user.click(midnightCard);
    await waitFor(() => expect(header().style.getPropertyValue(BG)).toBe('oklch(0.15 0.02 255)'));
    // The settings page itself, and the preview card, are in it.
    expect(group.closest('.jh-ui').style.getPropertyValue(BG)).toBe('oklch(0.15 0.02 255)');
    expect(localStorage.getItem('jaghelm-theme')).toBe('custom:dark:midnight');

    // A reload draws it from this browser's copy of the config.
    cleanup();
    stubServer({ config: { themes: [midnight] }, serverConfig: { themes: [midnight] } });
    await renderApp('/');
    await waitFor(() => expect(header().style.getPropertyValue(BG)).toBe('oklch(0.15 0.02 255)'));
  });

  it('importing a theme saves it with the display config and offers it, import to apply to reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    stubServer();
    await renderApp('/settings/appearance');
    const panel = await screen.findByRole('region', { name: 'Custom themes' });
    const box = within(panel).getByRole('textbox', { name: /Theme JSON/ });
    await user.click(box);
    await user.paste(JSON.stringify(midnight));
    expect(
      await within(panel).findByText(/Midnight: dark base, 8 colours\. Ready to import/)
    ).toBeVisible();
    await user.click(within(panel).getByRole('button', { name: 'Import theme' }));
    await act(() => vi.advanceTimersByTimeAsync(2500));
    await waitFor(() => expect(server.saves.at(-1)?.themes).toEqual([midnight]));

    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    await user.click(within(group).getByRole('radio', { name: /Midnight/ }));
    await waitFor(() => expect(header().style.getPropertyValue(BG)).toBe('oklch(0.15 0.02 255)'));

    const saved = server.saves.at(-1);
    cleanup();
    stubServer({ config: saved, serverConfig: saved });
    await renderApp('/');
    await waitFor(() => expect(header().style.getPropertyValue(BG)).toBe('oklch(0.15 0.02 255)'));
  });
});
