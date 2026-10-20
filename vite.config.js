import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Tailwind CSS v4 compiles src/ui/tailwind.css, the new UI stack's stylesheet
  // (docs/ARCHITECTURE.md, "UI stack").
  plugins: [react(), tailwindcss()],
  define: {
    // The status components in src/ui/ draw the web's look here, as a build
    // constant, so this bundle leaves out the Android look they also carry
    // until Phase 4 (#326; src/ui/lib/status.js, mobile/vite.config.mobile.js).
    __ANDROID_LOOK__: 'false',
  },
  resolve: {
    alias: {
      // The shared component library (shadcn/ui, components.json). The Android
      // build maps the same alias, so both apps import `@ui/...` alike.
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
    },
  },
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
            // Match whole package directories: a bare '/react/' would also catch
            // '@base-ui/react/' and pull the UI library into the eager chunk.
            if (
              id.includes('/node_modules/react/') ||
              id.includes('/node_modules/react-dom/') ||
              id.includes('/node_modules/scheduler/')
            )
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
    // Node 25+ ships its own `localStorage` global, which shadows jsdom's and is
    // undefined without --localstorage-file. Turn it off in the test workers so
    // the tests get jsdom's, as a browser would (#375).
    execArgv: ['--no-experimental-webstorage'],
    setupFiles: ['./src/testing/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    // These are pure node:test suites; they run under `npm test`, not vitest
    // (vitest can't bundle the `node:test` builtin import).
    exclude: [
      'src/components/HelmGrid/gridMath.test.js',
      'src/utils/thresholds.test.js',
      'src/util/span.test.js',
      'src/api/client.test.js',
      'node_modules/**',
    ],
    css: false,
    restoreMocks: true,
  },
});
