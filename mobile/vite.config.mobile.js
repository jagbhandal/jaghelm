import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// Push is enabled ONLY when this build ships Firebase config — mirrors the Android
// gradle's `google-services.json`-exists conditional. Calling PushNotifications
// .register() without it crashes the app natively (uncaught, un-catchable in JS),
// so the client gates on the SAME signal. An explicit env var can force-enable it.
const pushConfigured =
  existsSync(fileURLToPath(new URL('./android/app/google-services.json', import.meta.url))) ||
  process.env.VITE_PUSH_ENABLED === '1';

export default defineConfig({
  plugins: [react()],
  define: {
    __PUSH_ENABLED__: JSON.stringify(pushConfigured),
  },
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
    include: ['*.test.{js,jsx}', 'src/**/*.test.{js,jsx}'],
    css: false,
    restoreMocks: true,
  },
});
