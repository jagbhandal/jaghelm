/*
 * The Android screenshots' build (#546, docs/mobile/DESIGN.md "Android
 * screenshots"): the app's own Vite config (vite.config.mobile.js: the
 * Android look, its stylesheets, its packages), its own index.html and
 * src/main.jsx, with two changes, so the screens draw exactly as in the APK:
 *
 *  - every Capacitor plugin is native.js, which stubs the phone at the
 *    boundary (storage, push, the app's lifecycle, the network);
 *  - push is off, whatever the machine has: a google-services.json would
 *    otherwise turn it on here and not in CI.
 *
 * It builds into visual/out/ (git-ignored). playwright.android.config.mjs
 * builds and serves it, from mobile/.
 */
import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import app from '../vite.config.mobile.js';

const NATIVE = fileURLToPath(new URL('./native.js', import.meta.url));

/** The plugins the app imports; each one is native.js here. */
export const PLUGINS = [
  '@capacitor/app',
  '@capacitor/network',
  '@capacitor/preferences',
  '@capacitor/push-notifications',
  'capacitor-secure-storage-plugin',
];

export default mergeConfig(
  app,
  defineConfig({
    define: { __PUSH_ENABLED__: 'false' },
    resolve: { alias: Object.fromEntries(PLUGINS.map((name) => [name, NATIVE])) },
    build: { outDir: 'visual/out', emptyOutDir: true },
    preview: { host: '127.0.0.1', strictPort: true },
  })
);
