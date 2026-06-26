import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    minify: true,
    rollupOptions: {
      output: {
        // Split heavy vendors into their own cacheable chunks so an app change
        // doesn't bust the (rarely-changing) library bundles.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Only split the EAGER vendors (loaded on first paint) into stable,
            // cacheable chunks. React + dnd-kit are used by the dashboard itself.
            if (id.includes('react-dom') || id.includes('/react/') || id.includes('/scheduler/'))
              return 'vendor-react';
            if (id.includes('@dnd-kit')) return 'vendor-dnd';
            // Everything else (e.g. react-colorful, used only by the lazy Settings
            // tabs) is left to default chunking so it lands in the async chunk
            // that imports it — and isn't modulepreloaded on first paint.
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3099', '/uploads': 'http://localhost:3099' },
  },
  // Component tests run under jsdom with RTL. globals:true gives describe/it/expect
  // without imports; setup.js wires jest-dom matchers and resets between tests.
  test: {
    environment: 'jsdom',
    globals: true,
    // Undo vi.stubGlobal between tests so a stubbed fetch can't leak across files.
    unstubGlobals: true,
    setupFiles: ['./src/testing/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    // These are pure node:test suites; they run under `npm test`, not vitest
    // (vitest can't bundle the `node:test` builtin import).
    exclude: [
      'src/components/HelmGrid/gridMath.test.js',
      'src/utils/thresholds.test.js',
      'src/api/client.test.js',
      'node_modules/**',
    ],
    css: false,
    restoreMocks: true,
  },
});
