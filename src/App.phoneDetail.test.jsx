import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PHONE_WIDTH } from '@ui/app-shell';
import { nasDiskIncident } from './testing/statusFixtures.js';

// Below 768px the phone's detail screens are a chunk of their own (#309,
// src/shell/PhoneDetail.jsx), so a phone's first load doesn't carry them.
// Until it is in, a sheet has its Back and says "Loading…" (never a blank
// dialog with nothing to focus); the chunk is asked for once the browser is
// idle after the screens draw, and at once beside them when the URL already
// names an entity (a deep link, a push). e2e/entity.spec.mjs holds the chunk
// back in a real browser.

// The detail screens' module, held back until released (the chunk on its way),
// and the preload, counted.
const { chunk } = vi.hoisted(() => {
  const chunk = { asked: 0, release: null, held: null };
  chunk.hold = () => {
    chunk.held = new Promise((resolve) => {
      chunk.release = () => {
        chunk.held = null;
        resolve();
      };
    });
  };
  return { chunk };
});

vi.mock('./shell/PhoneDetail.jsx', async (importOriginal) => {
  const { default: Real } = await importOriginal();
  return {
    default: function Held(props) {
      if (chunk.held) throw chunk.held;
      return <Real {...props} />;
    },
  };
});

vi.mock('./shell/preloadPhoneDetail.js', () => ({
  preloadPhoneDetail: () => {
    chunk.asked += 1;
  },
}));

import App from './App.jsx';

const BOARD = nasDiskIncident();

function respond(body, status = 200, headers = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

let idle;
beforeEach(() => {
  chunk.asked = 0;
  chunk.held = null;
  idle = [];
  vi.stubGlobal('requestIdleCallback', (cb) => idle.push(cb));
  vi.stubGlobal('cancelIdleCallback', () => {});
  localStorage.clear();
  localStorage.setItem('jaghelm-token', 'tok');
  localStorage.setItem('jaghelm-config', JSON.stringify({ tabs: [] }));
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    media: query,
    matches: query === PHONE_WIDTH,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const path = String(url).split('?')[0];
      if (path === '/api/auth/check') return respond({ authRequired: true, authenticated: true });
      if (path === '/api/status') return respond(BOARD.status);
      if (path === '/api/services') return respond(BOARD.services);
      if (path === '/api/display-config') return respond({}, 200, { ETag: '"v1"' });
      return respond({});
    })
  );
});

const view = () => document.querySelector('[data-slot="phone-view"]');

async function renderAt(path) {
  window.history.replaceState(null, '', path);
  render(<App />);
  await waitFor(() => expect(view()).not.toBeNull());
}

/** The sheet waiting for the detail's chunk: Back, its kind, and "Loading…" naming it. */
async function waitingSheet(kind) {
  const sheet = await screen.findByRole('dialog', { name: 'Loading…' });
  expect(sheet).toHaveAttribute('data-slot', 'phone-sheet');
  expect(within(sheet).getByRole('button', { name: 'Back' })).toBeInTheDocument();
  expect(within(sheet).getByText(kind)).toBeInTheDocument();
  return sheet;
}

describe('a phone’s detail screens, a chunk of their own (#309)', () => {
  it('a deep link: asked for beside the screens, Back and "Loading…" until it is in', async () => {
    chunk.hold();
    await renderAt('/?entity=services/apps:jellyfin');
    // Asked for at once, not once the screens have drawn and the browser is idle.
    expect(chunk.asked).toBeGreaterThan(0);
    await waitingSheet('Service');
    await act(async () => chunk.release());
    expect(await screen.findByRole('dialog', { name: 'Jellyfin' })).toBeInTheDocument();
  });

  it('the first detail opened, before the chunk is in: Back and "Loading…", and Back closes it', async () => {
    chunk.hold();
    await renderAt('/');
    expect(chunk.asked).toBe(0);
    const user = userEvent.setup();
    const list = await screen.findByRole('region', { name: 'Infrastructure' });
    await user.click(within(list).getByRole('button', { name: /^Storage, / }));
    const sheet = await waitingSheet('Node');
    await user.click(within(sheet).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.search).toBe('');
  });

  it('asked for once the browser is idle after the screens draw', async () => {
    await renderAt('/');
    await screen.findByRole('region', { name: 'Needs attention' });
    expect(chunk.asked).toBe(0);
    expect(idle.length).toBeGreaterThan(0);
    await act(async () => idle.forEach((cb) => cb()));
    expect(chunk.asked).toBe(1);
  });
});
