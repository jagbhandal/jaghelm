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
// The themes (#304): what each test's browser has saved.
export const THEMES = { dark: 'dark', light: 'light' };

/** The demo's answer to `path` in `scenario`, as its server sends it. */
export const demo = (path, { method = 'GET', query = {}, scenario = 'incident' } = {}) =>
  demoResponse({ method, path, query, scenario });

/**
 * Opens the app at `path`, answering every request here, as the demo in
 * `scenario` (incident by default), with `config` over the demo's display
 * config, and `answers` (a body by path, such as a board's /api/status and
 * /api/services, or a function of the request that returns one, for a
 * server that keeps what it is sent) in place of the demo's. Returns the
 * server's state: set
 * `down` to refuse /api/status, as a backend that can't be reached, or
 * `expired` to answer it 503, as the server does once its status is past the
 * cache's TTL (#480). `theme` is the theme the browser has saved ('dark',
 * 'light' or 'system'; null, none).
 */
export async function openApp(
  page,
  path = '/',
  { down = false, theme = 'dark', scenario = 'incident', config = {}, answers = {} } = {}
) {
  const server = { down, expired: false };
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
    if (url.pathname === '/api/status' && server.expired)
      return route.fulfill({ status: 503, json: { error: 'Status not yet available' } });
    if (url.pathname === '/api/icons/cached') return route.fulfill({ status: 404, json: {} });
    if (Object.hasOwn(answers, url.pathname)) {
      const answer = answers[url.pathname];
      return route.fulfill({
        status: 200,
        json: typeof answer === 'function' ? answer(request) : answer,
      });
    }
    const out = demo(url.pathname, {
      method: request.method(),
      query: Object.fromEntries(url.searchParams),
      scenario,
    });
    const body =
      url.pathname === '/api/display-config' ? { ...out.body, tabs: APPS, ...config } : out.body;
    return route.fulfill({ status: out.status, json: body ?? {} });
  });
  if (theme != null)
    await page.addInitScript((id) => localStorage.setItem('jaghelm-theme', id), theme);
  await page.goto(path);
  await expect(page.getByRole('banner')).toBeVisible();
  return server;
}

/** axe's violations, one line per element. */
export async function axeFindings(builder) {
  const { violations } = await builder.analyze();
  return violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')}`));
}

/**
 * Every colour `area` draws, outside its lamps, that is red, amber or green
 * (OKLCH chroma 0.04 or more, hue in 345–45, 45–110 or 110–185: the crit, warn
 * and ok roles sit at about 25, 80 and 163, the accent at 293 and
 * maintenance's blue at 250), with where it is; and each lamp's size and
 * state. Colours are read by painting them on a canvas, so any CSS colour the
 * browser computes (oklch, color-mix, rgb) is read the same way; one it can't
 * paint is reported, not skipped. Anything inside `skip` (a selector) is left
 * out too, as the lamps are: a node's swatch is the user's own colour (#299).
 */
export function statusHues(area, { skip } = {}) {
  return area.evaluate((root, skip) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const SENTINEL = '#010203';
    const paint = (css) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = SENTINEL;
      ctx.fillStyle = css;
      if (ctx.fillStyle === SENTINEL && !/^#010203$/i.test(css)) return null;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a };
    };
    const lin = (c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const oklch = ({ r, g, b }) => {
      const [R, G, B] = [lin(r), lin(g), lin(b)];
      const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
      const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
      const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
      const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
      const Bk = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
      return { C: Math.hypot(A, Bk), h: ((Math.atan2(Bk, A) * 180) / Math.PI + 360) % 360 };
    };
    const family = ({ C, h }) => {
      if (C < 0.04) return null;
      if (h < 45 || h >= 345) return 'red';
      if (h < 110) return 'amber';
      if (h < 185) return 'green';
      return null;
    };
    const COLOUR = /(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\([^()]*\)|#[0-9a-f]{3,8}\b/gi;
    const where = (el) =>
      `${el.tagName.toLowerCase()}${el.dataset?.slot ? `[${el.dataset.slot}]` : ''} "${(el.textContent ?? '').trim().slice(0, 40)}"`;

    const found = [];
    const unread = [];
    const check = (el, property, value) => {
      for (const css of value.match(COLOUR) ?? []) {
        const rgba = paint(css);
        if (!rgba) {
          unread.push(`${where(el)} ${property}: ${css}`);
          continue;
        }
        if (rgba.a === 0) continue;
        const hue = family(oklch(rgba));
        if (hue) found.push({ hue, property, css, at: where(el), text: el.textContent.trim() });
      }
    };
    const lamps = [...root.querySelectorAll('[data-slot="status-lamp"]')].map((lamp) => ({
      size: Math.round(lamp.getBoundingClientRect().width),
      state: lamp.dataset.state,
    }));
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (el.closest('[data-slot="status-lamp"]') || (skip && el.closest(skip))) continue;
      const cs = getComputedStyle(el);
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (ownText) check(el, 'color', cs.color);
      check(el, 'background-color', cs.backgroundColor);
      check(el, 'background-image', cs.backgroundImage);
      check(el, 'box-shadow', cs.boxShadow);
      for (const side of ['top', 'right', 'bottom', 'left']) {
        const width = parseFloat(cs.getPropertyValue(`border-${side}-width`));
        if (width > 0 && cs.getPropertyValue(`border-${side}-style`) !== 'none') {
          check(el, `border-${side}-color`, cs.getPropertyValue(`border-${side}-color`));
        }
      }
      if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) {
        check(el, 'outline-color', cs.outlineColor);
      }
      if (cs.textDecorationLine !== 'none')
        check(el, 'text-decoration-color', cs.textDecorationColor);
      if (el instanceof SVGElement) {
        check(el, 'fill', cs.fill);
        check(el, 'stroke', cs.stroke);
      }
    }
    return { found, unread, lamps };
  }, skip ?? null);
}
