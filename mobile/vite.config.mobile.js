import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
  // mobile/dist is the Capacitor webDir — NOT served by Express.
  build: { outDir: 'dist', assetsDir: 'assets', minify: true },
  server: { port: 5174 },
  test: {
    environment: 'jsdom',
    globals: true,
    unstubGlobals: true,
    setupFiles: ['./src/testing/setup.js'],
    include: ['capacitor.config.test.js', 'index.html.test.js', 'scaffold.test.js', 'src/**/*.test.{js,jsx}'],
    css: false,
    restoreMocks: true,
  },
});
