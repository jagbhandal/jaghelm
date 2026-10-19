import React, { lazy, Suspense } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ErrorBoundary from './components/ErrorBoundary';
import {
  installChunkReload,
  chunkReloadPending,
  RELOAD_KEY,
  RELOAD_WINDOW_MS,
} from './chunkReload.js';

// What Vite's preload helper (__vitePreload) does around every lazy import() in a
// build: a failed import fires a cancelable `vite:preloadError` on window, and
// preventDefault() swallows the error, so the import resolves to undefined.
function viteImport(load) {
  return load().catch((err) => {
    const event = new Event('vite:preloadError', { cancelable: true });
    event.payload = err;
    window.dispatchEvent(event);
    if (!event.defaultPrevented) throw err;
  });
}

const goneChunk = () =>
  Promise.reject(
    new TypeError('Failed to fetch dynamically imported module: /assets/SettingsView-old.js')
  );

/** Fire one chunk failure as Vite does; returns the event so tests can read defaultPrevented. */
function failChunk() {
  const event = new Event('vite:preloadError', { cancelable: true });
  event.payload = new TypeError('Failed to fetch dynamically imported module');
  window.dispatchEvent(event);
  return event;
}

let uninstall = () => {};
let clock = 1_000_000;
const now = () => clock;

/** Start a "page": install the listener as main.jsx does, with a fake reload. */
function loadPage(options = {}) {
  uninstall();
  const reload = vi.fn();
  uninstall = installChunkReload({ reload, now, ...options });
  return reload;
}

beforeEach(() => {
  window.sessionStorage.clear();
  clock = 1_000_000;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  uninstall();
  uninstall = () => {};
});

describe('chunk reload guard', () => {
  it('reloads once on the first chunk failure and swallows the error', () => {
    const reload = loadPage();
    const event = failChunk();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(chunkReloadPending()).toBe(true);
    expect(window.sessionStorage.getItem(RELOAD_KEY)).toBe(String(clock));
  });

  it('a further failure while that reload is under way neither reloads again nor surfaces', () => {
    // A view's CSS preload and its import() each fire the event, in one page.
    const reload = loadPage();
    failChunk();
    const second = failChunk();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(true);
  });

  it('a second failure after the reload lets the error through to the error screen', () => {
    loadPage();
    failChunk();
    clock += 5_000;
    const reload = loadPage(); // the reloaded page, same tab session
    const event = failChunk();
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(chunkReloadPending()).toBe(false);
  });

  it('the flag expires, so a later deploy in the same tab reloads again', () => {
    loadPage();
    failChunk();
    clock += RELOAD_WINDOW_MS - 1;
    let reload = loadPage();
    failChunk();
    expect(reload).not.toHaveBeenCalled();

    clock += 2; // now past the window since the first reload
    reload = loadPage();
    const event = failChunk();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(window.sessionStorage.getItem(RELOAD_KEY)).toBe(String(clock));
  });

  it('a failure on a page with no chunk failure yet reloads even when the flag holds junk', () => {
    window.sessionStorage.setItem(RELOAD_KEY, 'not-a-time');
    const reload = loadPage();
    expect(failChunk().defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  describe('when sessionStorage is unusable, it never reloads and the error goes through', () => {
    const cases = {
      'reading window.sessionStorage throws': () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
      'getItem throws': () => ({
        getItem() {
          throw new DOMException('blocked', 'SecurityError');
        },
        setItem() {},
      }),
      'setItem throws': () => ({
        getItem: () => null,
        setItem() {
          throw new DOMException('quota', 'QuotaExceededError');
        },
      }),
      'writes are not kept': () => ({ getItem: () => null, setItem() {} }),
    };
    for (const [name, getStorage] of Object.entries(cases)) {
      it(name, () => {
        const reload = loadPage({ getStorage });
        const event = failChunk();
        expect(reload).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
        expect(chunkReloadPending()).toBe(false);
      });
    }
  });

  it('uninstalling stops listening', () => {
    const reload = loadPage();
    uninstall();
    expect(failChunk().defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('a lazy view whose chunk is gone, through the root ErrorBoundary', () => {
  function renderLazyView() {
    const View = lazy(() => viteImport(goneChunk));
    return render(
      <ErrorBoundary>
        <Suspense fallback={<p>Loading…</p>}>
          <View />
        </Suspense>
      </ErrorBoundary>
    );
  }

  it('first failure: reloads once and does not flash the error screen', async () => {
    const reload = loadPage();
    const { container } = renderLazyView();
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('second failure in the same session: shows the normal error screen', async () => {
    loadPage();
    const first = renderLazyView();
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    first.unmount();

    clock += 3_000;
    const reload = loadPage(); // the page the reload brought up
    renderLazyView();
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/Failed to fetch dynamically imported module/)).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it('storage that throws: shows the normal error screen without reloading', async () => {
    const reload = loadPage({
      getStorage: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    renderLazyView();
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });
});
