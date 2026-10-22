// Vitest + React Testing Library setup. Loaded once before the component suite.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';

// A test file that imports the app (anything that imports src/lazyViews.js)
// loads every lazily loaded view before its tests run (#490). From then on a
// view's loader answers at once, with a thenable that calls back in the same
// tick, so React.lazy renders the view without suspending: no first import to
// wait for, and no fallback whose reveal React holds back 300 ms. On a busy
// machine either took longer than a test's 1 s wait for the view. Only the
// files that import lazyViews.js pay for loading Settings, and the views load
// after the file's own vi.mock() calls, so they see its mocks.
// scripts/lazy-views.test.mjs keeps every lazy view in lazyViews.js.
const loadedViews = new Map();
let lazyViewsLoaded = null;
vi.mock('../lazyViews.js', async (importOriginal) => {
  const loaders = Object.entries(await importOriginal());
  lazyViewsLoaded = Promise.all(
    loaders.map(async ([name, load]) => loadedViews.set(name, await load()))
  );
  const loaded = (name) => ({ then: (resolve) => resolve(loadedViews.get(name)) });
  return Object.fromEntries(
    loaders.map(([name, load]) => [name, () => (loadedViews.has(name) ? loaded(name) : load())])
  );
});
beforeAll(() => lazyViewsLoaded);

// The floating layer likewise (src/ui/lib/floating.jsx, #444): a test file
// that imports a floating component (a tooltip, a dialog...) loads the layer
// before its tests run, so each draws Base UI from its first render, as it
// does in the app once the layer is in. The tests of the first, light render
// make a layer of their own (src/ui/floating.test.jsx).
let floatingLoaded = null;
vi.mock('../ui/lib/floating.jsx', async (importOriginal) => {
  const floating = await importOriginal();
  floatingLoaded = floating.floatingLayer.load();
  return floating;
});
beforeAll(() => floatingLoaded);

// Unmount React trees between tests so they don't leak into each other, and put
// the URL back at the Overview: the URL is the page (src/router, #296).
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

// jsdom doesn't implement these browser APIs that some components touch
// (NodeCard uses ResizeObserver for responsive columns; DashboardView reads
// matchMedia for the mobile breakpoint). Provide inert stubs so render() works.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom's Element.prototype.scrollIntoView throws "Not implemented"; the command
// palette calls it to keep the active option in view. Make it an inert no-op.
if (typeof window !== 'undefined' && window.Element) {
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};
  // jsdom's window.scrollTo logs "Not implemented"; the router calls it on a
  // new page (src/router/useRoute.js).
  window.scrollTo = function scrollTo() {};
}

if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  });
}
