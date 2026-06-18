import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', assetsDir: 'assets', minify: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3099', '/uploads': 'http://localhost:3099' },
  },
  // Component tests run under jsdom with RTL. globals:true gives describe/it/expect
  // without imports; setup.js wires jest-dom matchers and resets between tests.
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/testing/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    // gridMath.test.js is a pure node:test suite; it runs under `npm test`, not vitest.
    exclude: ['src/components/HelmGrid/gridMath.test.js', 'node_modules/**'],
    css: false,
    restoreMocks: true,
  },
});
