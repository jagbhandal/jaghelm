import React, { lazy, Suspense } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ErrorBoundary from './components/ErrorBoundary';
import {
  installChunkReload,
  chunkReloadPending,
  RELOAD_KEY,
  RELOAD_STALL_MS,
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

// The entry chunk URLs of three deploys, as main.jsx passes them.
const BUILD_A = 'https://helm.example/assets/index-AAAA1111.js';
const BUILD_B = 'https://helm.example/assets/index-BBBB2222.js';
const BUILD_C = 'https://helm.example/assets/index-CCCC3333.js';

/** A reload() that throws, as when the navigation is refused outright. */
const blockedReload = () =>
  vi.fn(() => {
    throw new DOMException('navigation blocked', 'SecurityError');
  });

let uninstall = () => {};

/** Start a "page" on a build: install the listener as main.jsx does, with a fake reload. */
function loadPage(options = {}) {
  uninstall();
  const reload = vi.fn();
  uninstall = installChunkReload({ build: BUILD_A, reload, ...options });
  return reload;
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  uninstall();
  uninstall = () => {};
  vi.useRealTimers();
});

describe('chunk reload guard: one reload per build', () => {
  it('reloads once on the first chunk failure and swallows the error', () => {
    const reload = loadPage();
    const event = failChunk();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(chunkReloadPending()).toBe(true);
    expect(window.sessionStorage.getItem(RELOAD_KEY)).toBe(BUILD_A);
  });

  it('a further failure while that reload is under way neither reloads again nor surfaces', () => {
    // A view's CSS preload and its import() each fire the event, in one page.
    const reload = loadPage();
    failChunk();
    const second = failChunk();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(true);
  });

  it('a second failure on the same build lets the error through, however long after', () => {
    vi.useFakeTimers({ now: new Date('2026-10-19T12:00:00Z') });
    loadPage({ build: BUILD_B });
    failChunk();
    vi.setSystemTime(new Date('2026-10-19T12:10:00Z')); // the user clicks again ten minutes on
    const reload = loadPage({ build: BUILD_B }); // the reload got the same build back
    const event = failChunk();
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(chunkReloadPending()).toBe(false);
  });

  it('a new build reloads again', () => {
    loadPage({ build: BUILD_A });
    failChunk();
    const reload = loadPage({ build: BUILD_B }); // the reload landed on the new build
    const event = failChunk();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(window.sessionStorage.getItem(RELOAD_KEY)).toBe(BUILD_B);
  });

  it('two quick deploys each get their reload, and a broken chunk then shows the error', () => {
    for (const build of [BUILD_A, BUILD_B, BUILD_C]) {
      const reload = loadPage({ build });
      expect(failChunk().defaultPrevented, build).toBe(true);
      expect(reload, build).toHaveBeenCalledTimes(1);
    }
    const reload = loadPage({ build: BUILD_C });
    expect(failChunk().defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('a flag holding junk still reloads', () => {
    window.sessionStorage.setItem(RELOAD_KEY, 'not-a-build');
    const reload = loadPage();
    expect(failChunk().defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('without a build identity it never reloads', () => {
    const reload = loadPage({ build: '' });
    expect(failChunk().defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
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
        removeItem() {},
      }),
      'setItem throws': () => ({
        getItem: () => null,
        setItem() {
          throw new DOMException('quota', 'QuotaExceededError');
        },
        removeItem() {},
      }),
      'writes are not kept': () => ({ getItem: () => null, setItem() {}, removeItem() {} }),
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

  it('a reload that throws lets the error through', () => {
    const reload = blockedReload();
    loadPage({ reload });
    const event = failChunk();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
    expect(chunkReloadPending()).toBe(false);
  });

  it('a reload that never navigates stops counting as pending after the watchdog', () => {
    vi.useFakeTimers();
    loadPage();
    failChunk();
    vi.advanceTimersByTime(RELOAD_STALL_MS - 1);
    expect(chunkReloadPending()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(chunkReloadPending()).toBe(false);
    // Still the same build, so the next failure goes to the error screen.
    expect(failChunk().defaultPrevented).toBe(false);
  });

  it('uninstalling stops listening', () => {
    const reload = loadPage();
    uninstall();
    expect(failChunk().defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('chunk reload: the open page comes back', () => {
  it('reloads the page at its own URL, which names the page (#296), storing only the build', () => {
    window.history.replaceState(null, '', '/apps/netdata');
    const reload = loadPage();
    failChunk();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/apps/netdata');
    expect(Object.keys(window.sessionStorage)).toEqual([RELOAD_KEY]);
    window.history.replaceState(null, '', '/');
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

  it('second failure on the same build: shows the normal error screen', async () => {
    loadPage();
    const first = renderLazyView();
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    first.unmount();

    const reload = loadPage(); // the page the reload brought up, still on this build
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

  it('a reload that throws: shows the normal error screen', async () => {
    const reload = blockedReload();
    loadPage({ reload });
    renderLazyView();
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a reload that never navigates: blank at first, the error screen after the watchdog', async () => {
    vi.useFakeTimers();
    const reload = loadPage(); // a no-op, as when the navigation is cancelled
    const { container } = renderLazyView();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RELOAD_STALL_MS - 1);
    });
    expect(container).toBeEmptyDOMElement();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload Dashboard' })).toBeInTheDocument();
  });
});
