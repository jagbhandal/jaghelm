/*
 * The one container the gallery renders in (#289, docs/GALLERY.md): the
 * Playwright image for the exact @playwright/test version in package.json,
 * pinned by digest too, so its Chromium, its fonts and its libraries never
 * change under the baselines. CI's gallery job (.gitea/workflows/check.yml)
 * runs in it, and `npm run gallery:test` and `npm run gallery:update` run it
 * locally (scripts/gallery.mjs). scripts/gallery-build.test.mjs fails when the
 * three disagree. A Playwright upgrade changes all three, then
 * `npm run gallery:update` regenerates the baselines in the same PR.
 */
export const PLAYWRIGHT_VERSION = '1.63.0';

export const GALLERY_IMAGE = `mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27`;

/** Set in the container by CI and by scripts/gallery.mjs; playwright.config.mjs refuses to run without it. */
export const IMAGE_ENV = 'JH_GALLERY_IMAGE';
