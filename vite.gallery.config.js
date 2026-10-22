/*
 * The component gallery's build (#289, docs/GALLERY.md): the app's own Vite
 * config (the same plugins, defines and `@ui` alias, so the components build
 * exactly as they do for the app), with the gallery page as its only entry and
 * its own output folder. The production build (vite.config.js) has index.html
 * as its only entry and never reaches gallery/; scripts/gallery-build.test.mjs
 * checks both. The Playwright tests build and serve this (playwright.config.mjs).
 */
import { defineConfig, mergeConfig } from 'vite';
import app from './vite.config.js';

export const GALLERY_OUT_DIR = 'dist-gallery';

export default mergeConfig(
  app,
  defineConfig({
    // public/ as the app serves it: the header and the sign-in page draw
    // JagHelm's logo from it (/logo.svg, /logo-login.svg, #530). The page never
    // registers the service worker or reads the manifest.
    build: {
      outDir: GALLERY_OUT_DIR,
      emptyOutDir: true,
      rollupOptions: { input: { gallery: 'gallery/index.html' } },
    },
    preview: { host: '127.0.0.1', strictPort: true },
  })
);
