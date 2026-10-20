// Vitest + React Testing Library setup. Loaded once before the component suite.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

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
