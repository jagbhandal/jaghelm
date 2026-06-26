import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

// Push is enabled ONLY when this build ships Firebase config. Calling
// PushNotifications.register() without it crashes the app natively (uncaught,
// un-catchable in JS), so the client must gate on the EXACT same signal the
// Android gradle uses (build.gradle: `if (servicesJSON.text)` — non-empty
// CONTENT, not mere existence). Keying both on the same predicate is what stops
// the two configs drifting into "web push on / APK has no Firebase" → the crash.
function hasFirebaseConfig() {
  try {
    const p = fileURLToPath(new URL('./android/app/google-services.json', import.meta.url));
    return existsSync(p) && readFileSync(p, 'utf8').trim().length > 0;
  } catch {
    return false;
  }
}
const pushConfigured = hasFirebaseConfig();

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
