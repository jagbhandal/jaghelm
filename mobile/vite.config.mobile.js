import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
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

// The app version reported to the server (push registration) is the one in
// mobile/package.json, which CI checks against the mobile-v<version> release tag.
const appVersion = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
).version;

export default defineConfig({
  // Tailwind CSS v4 compiles the shared src/ui/tailwind.css (docs/ARCHITECTURE.md, "UI stack").
  plugins: [react(), tailwindcss()],
  define: {
    __PUSH_ENABLED__: JSON.stringify(pushConfigured),
    __APP_VERSION__: JSON.stringify(appVersion),
    // The status components in src/ui/ draw the Android app's own look here, so
    // its screens look as they did before those components moved there (#287,
    // src/ui/lib/status.js). A stopgap: Phase 4 (#326) rebuilds the screens on
    // src/ui/ and deletes this define.
    __ANDROID_LOOK__: 'true',
  },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../src', import.meta.url)),
      // The shared component library, under the same name as on the web.
      '@ui': fileURLToPath(new URL('../src/ui', import.meta.url)),
    },
    // Code under ../src (src/ui/ above all) must use THIS app's copies of these
    // packages. Without dedupe, an import from ../src resolves to the root
    // node_modules: a second React when it is installed (hooks break), and
    // nothing at all in the APK build, which installs mobile/ only.
    dedupe: [
      'react',
      'react-dom',
      '@base-ui/react',
      'class-variance-authority',
      'clsx',
      'lucide-react',
      'tailwind-merge',
      'tailwindcss',
    ],
  },
  // mobile/dist is the Capacitor webDir — NOT served by Express.
  build: { outDir: 'dist', assetsDir: 'assets', minify: true },
  server: { port: 5174 },
  test: {
    environment: 'jsdom',
    globals: true,
    unstubGlobals: true,
    // Node 25+ ships its own `localStorage` global, which shadows jsdom's and is
    // undefined without --localstorage-file. Turn it off in the test workers so
    // the tests get jsdom's, as the WebView would (#375).
    execArgv: ['--no-experimental-webstorage'],
    setupFiles: ['./src/testing/setup.js'],
    include: ['*.test.{js,jsx}', 'src/**/*.test.{js,jsx}'],
    css: false,
    restoreMocks: true,
  },
});
