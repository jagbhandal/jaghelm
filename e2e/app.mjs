/*
 * What the browser tests (e2e/*.spec.mjs) share: the app opened in a real
 * browser, every /api request answered here with the demo server's own answers
 * (demoResponse) in one of its scenarios, /api/status included (the status
 * model of the demo's board, #437), and two embedded apps served here.
 */
import { expect, test } from '@playwright/test';
import { demoResponse } from '../server/demo.js';

export const APPS = [
  { id: 'grafana', label: 'Grafana', type: 'iframe', url: '/embedded/grafana' },
  { id: 'kuma', label: 'Uptime Kuma', type: 'iframe', url: '/embedded/kuma' },
];
export const WIDTHS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
};
// Today's themes, until #304: the shell draws a light one light.
export const THEMES = { dark: 'dark', light: 'github-light' };

/** The demo's answer to `path` in `scenario`, as its server sends it. */
export const demo = (path, { method = 'GET', query = {}, scenario = 'incident' } = {}) =>
  demoResponse({ method, path, query, scenario });

/**
 * Opens the app at `path`, answering every request here, as the demo in
 * `scenario` (incident by default). Returns the server's state: set `down` to
 * refuse /api/status, as a backend that can't be reached.
 */
export async function openApp(
  page,
  path = '/',
  { down = false, theme = 'dark', scenario = 'incident' } = {}
) {
  const server = { down };
  const origin = new URL(test.info().project.use.baseURL).origin;
  await page.route(
    (url) => url.origin !== origin,
    (route) => route.abort()
  );
  await page.route('**/embedded/**', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><title>${name}</title><p>Embedded ${name}</p></html>`,
    });
  });
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/status' && server.down) return route.abort('connectionrefused');
    if (url.pathname === '/api/icons/cached') return route.fulfill({ status: 404, json: {} });
    const out = demo(url.pathname, {
      method: request.method(),
      query: Object.fromEntries(url.searchParams),
      scenario,
    });
    const body = url.pathname === '/api/display-config' ? { ...out.body, tabs: APPS } : out.body;
    return route.fulfill({ status: out.status, json: body ?? {} });
  });
  await page.addInitScript((id) => localStorage.setItem('jaghelm-theme', id), THEMES[theme]);
  await page.goto(path);
  await expect(page.getByRole('banner')).toBeVisible();
  return server;
}

/** axe's violations, one line per element. */
export async function axeFindings(builder) {
  const { violations } = await builder.analyze();
  return violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')}`));
}
