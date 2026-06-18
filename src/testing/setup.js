// Vitest + React Testing Library setup. Loaded once before the component suite.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Unmount React trees between tests so they don't leak into each other.
afterEach(() => cleanup());

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
