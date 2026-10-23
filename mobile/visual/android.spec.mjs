/*
 * The Android app's screens against their baselines (#546, docs/mobile/DESIGN.md
 * "Android screenshots"), the net under #303, which moves them into src/.
 *
 * Each state opens the app as the phone does (index.html, src/main.jsx, boot,
 * sign-in, the shell, the tabs), reaches its screen by tapping, as a person
 * would, and is shot at 390 × 844 against mobile/visual/baselines/<id>.png,
 * exactly. The phone itself is stubbed at the boundary (native.js: storage,
 * push, lifecycle, network), and the server is answered here at a fixed
 * address from the boards in fixtures.js, built by the server's own model.
 * Nothing is logged as an error, and nothing else is fetched.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { BASE_URL_KEY, PUSH_TOKEN_KEY, REMEMBER_KEY, TOKEN_KEY } from '../src/runtimeConfig.js';
import {
  NOW,
  backendOf,
  calm,
  degradedSubsystem,
  downService,
  empty,
  multiIncident,
} from './fixtures.js';

const BASELINES = fileURLToPath(new URL('./baselines/', import.meta.url));

/** The server the app was set up with, as the Login screen stores it. */
const SERVER = 'http://jaghelm:3099';
const BASE = `${SERVER}/api`;
const MINUTE = 60_000;

/** The phone's storage for a session that resumes: the server, a session, "Keep me signed in". */
const SIGNED_IN = {
  secure: { [BASE_URL_KEY]: BASE, [TOKEN_KEY]: 'shots-session' }, // pragma: allowlist secret
  prefs: { [REMEMBER_KEY]: 'true' },
};

const PUSH_PREFS = {
  categories: { service: true, host: true, ups: true, cron: false, watchtower: true },
  notifyRecoveries: true,
  enabled: true,
};

// Steps: what a person taps to reach the screen.
const tab = (name) => (page) => page.getByRole('tab', { name, exact: true }).click();
const tap = (role, name) => (page) => page.getByRole(role, { name }).first().click();

/** The same state scrolled to the end of its screen: what lies below the fold. */
const end = (state) => ({ ...state, id: `${state.id}-end`, scroll: 'end' });

/**
 * Every state, by the id of its baseline. `board` is what the server answers
 * (none: the app never gets that far); `push`, whether the server can send
 * pushes (it can, unless false); `native`, the phone's storage at launch
 * (SIGNED_IN unless given); `down`, the server unreachable from the start;
 * `steps`, the taps from launch; `lost`, the server lost that long after;
 * `shows`, the screen it ends on, by its accessible name (or its text, before
 * the shell); `loaded`, what that screen shows once it has read what it
 * reads; and `scroll: 'end'`, shot scrolled to its end. A screen taller than
 * the phone's fails unless its state has an end shot too (`end`).
 */
const OVERVIEW_NO_SIGNAL = {
  // The phone loses the server 3 minutes on: the last status, as no signal.
  id: 'overview-no-signal',
  board: multiIncident,
  shows: 'Overview',
  lost: 3 * MINUTE,
};
const OVERVIEW_MULTI = { id: 'overview-multi', board: multiIncident, shows: 'Overview' };
// Active, then History (#314): the alert history the server keeps.
const ALERTS_MULTI = {
  id: 'alerts-multi',
  board: multiIncident,
  steps: [tab('Alerts')],
  shows: 'Alerts',
  loaded: (page) => page.getByRole('heading', { name: 'Yesterday', exact: true }),
};
const WITH_PUSH_TOKEN = {
  secure: SIGNED_IN.secure,
  prefs: { ...SIGNED_IN.prefs, [PUSH_TOKEN_KEY]: 'shots-device' }, // pragma: allowlist secret
};
const NOTIFICATION_SETTINGS = {
  id: 'notification-settings',
  board: calm,
  native: WITH_PUSH_TOKEN,
  steps: [tab('Alerts'), tap('button', 'Notification settings')],
  shows: 'Notification settings',
  loaded: (page) => page.getByRole('switch', { name: 'Services' }),
};

const STATES = [
  { id: 'overview-calm', board: calm, shows: 'Overview' },
  { id: 'overview-degraded', board: degradedSubsystem, shows: 'Overview' },
  OVERVIEW_MULTI,
  end(OVERVIEW_MULTI),
  OVERVIEW_NO_SIGNAL,
  end(OVERVIEW_NO_SIGNAL),
  { id: 'overview-empty', board: empty, shows: 'Overview' },
  { id: 'services-calm', board: calm, steps: [tab('Services')], shows: 'Services' },
  { id: 'services-down', board: downService, steps: [tab('Services')], shows: 'Services' },
  {
    id: 'services-filtered',
    board: downService,
    steps: [tab('Services'), tap('button', /^Down/)],
    shows: 'Services',
  },
  { id: 'infra-calm', board: calm, steps: [tab('Infra')], shows: 'Infra' },
  ALERTS_MULTI,
  end(ALERTS_MULTI),
  {
    id: 'service-detail',
    board: downService,
    steps: [tab('Services'), tap('button', 'Gitea on VM 101')],
    shows: 'Service detail',
  },
  {
    id: 'node-detail',
    board: degradedSubsystem,
    steps: [tab('Infra'), tap('button', 'VM 101 detail')],
    shows: 'Node detail',
  },
  {
    id: 'incident-detail',
    board: multiIncident,
    steps: [tab('Alerts'), tap('button', /^Gitea, /)],
    shows: 'Incident detail',
  },
  {
    // Not a service: the UPS on battery, which has no screen of its own.
    id: 'incident-detail-ups',
    board: multiIncident,
    steps: [tab('Alerts'), tap('button', /^UPS, /)],
    shows: 'Incident detail',
  },
  NOTIFICATION_SETTINGS,
  end(NOTIFICATION_SETTINGS),
  {
    // A server with no notification credentials.
    ...NOTIFICATION_SETTINGS,
    id: 'notification-settings-unavailable',
    push: false,
    loaded: (page) => page.getByText(/^Push notifications are unavailable/),
  },
  { id: 'login', native: {}, shows: 'Connect to JagHelm' },
  {
    id: 'login-reauth',
    native: { secure: { [BASE_URL_KEY]: BASE } },
    shows: `Connected to ${BASE}`,
  },
  { id: 'connection', down: true, shows: "Can't reach JagHelm" },
];
const IDS = new Set(STATES.map((s) => s.id));

/** Every service icon the server's icon cache sends: one plain tile. */
const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
  '<rect width="24" height="24" rx="6" fill="#5b6478"/></svg>';

/**
 * The server's answer to a GET of `path` under /api, as `{ json }` or
 * `{ svg }`, or undefined if it has none: `server.answers` (backendOf's) and
 * `server.push`.
 */
function answerOf(server, method, path) {
  const board = server.answers;
  if (method !== 'GET') return undefined;
  if (path === '/auth/check') return { json: { authenticated: true } };
  if (path === '/icons/cached') return { svg: ICON };
  if (path === '/push/status') return { json: { enabled: server.push } };
  if (path === '/push/prefs') return { json: { prefs: PUSH_PREFS } };
  return board[path] === undefined ? undefined : { json: board[path] };
}

/**
 * Opens the app for `state`: the phone's storage, the frozen clock, and the
 * server answered at SERVER. Returns the server (its answers, by path; set
 * `down` to refuse it from then on) and the problems seen: an error logged,
 * a request to anywhere else, or one the server has no answer for.
 */
async function launch(page, state) {
  const problems = [];
  const server = {
    answers: state.board ? backendOf(state.board) : {},
    push: state.push ?? true,
    down: Boolean(state.down),
    refused: false,
  };
  page.on('console', (m) => {
    // A refused request logs its failure; only the refusals asked for are expected.
    if (m.type() !== 'error') return;
    const refusal = /^Failed to load resource: net::ERR_CONNECTION_REFUSED/;
    if (server.refused && refusal.test(m.text())) return;
    problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  const origin = new URL(test.info().project.use.baseURL).origin;
  await page.route(
    (url) => url.origin !== origin,
    (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== SERVER) {
        problems.push(`request to another origin: ${request.url()}`);
        return route.abort();
      }
      const cors = { 'access-control-allow-origin': origin };
      if (request.method() === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: {
            ...cors,
            'access-control-allow-headers': '*',
            'access-control-allow-methods': 'GET, POST, PUT, DELETE',
          },
        });
      }
      if (server.down) {
        server.refused = true;
        return route.abort('connectionrefused');
      }
      const path = url.pathname.slice(new URL(BASE).pathname.length);
      const answer = answerOf(server, request.method(), path);
      if (answer === undefined) {
        problems.push(`no answer for ${request.method()} ${url.pathname}`);
        return route.abort();
      }
      if (answer.svg) return route.fulfill({ contentType: 'image/svg+xml', body: answer.svg });
      return route.fulfill({
        contentType: 'application/json',
        // /api/status says when the server built it (#499).
        headers: { ...cors, 'last-modified': new Date(NOW).toUTCString() },
        body: JSON.stringify(answer.json),
      });
    }
  );
  await page.addInitScript((native) => {
    window.__JH_NATIVE__ = native;
  }, state.native ?? SIGNED_IN);
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  return { server, problems };
}

/** The web fonts and every image in, every transition and animation done. */
async function settled(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(
    () =>
      document.fonts.status === 'loaded' &&
      [...document.images].every((img) => img.complete) &&
      document.getAnimations().every((a) => a.playState !== 'running')
  );
}

/**
 * How far the screen scrolls past the phone's (0: it fits): the shell's
 * content, or the page before the shell.
 */
const below = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.mobile-content') ?? document.scrollingElement;
    return el.scrollHeight - el.clientHeight;
  });

/** Scrolls the screen to its end. */
const scrollToEnd = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.mobile-content') ?? document.scrollingElement;
    el.scrollTop = el.scrollHeight;
  });

/** The app's status bar, a button that refreshes. */
const statusBar = (page) => page.getByRole('button', { name: /Tap to (refresh now|retry)\.$/ });

for (const state of STATES) {
  test(state.id, async ({ page }) => {
    const { server, problems } = await launch(page, state);
    if (state.board) {
      // The first round in: the bar says the model's sentence ("Connecting…" before).
      const { sentence } = server.answers['/status'].overall;
      await expect(statusBar(page)).toHaveAccessibleName(`${sentence}. Tap to refresh now.`);
    }
    for (const step of state.steps ?? []) await step(page);
    if (state.lost) {
      server.down = true;
      await page.clock.setFixedTime(NOW + state.lost);
      await statusBar(page).click();
      await expect(statusBar(page)).toHaveAccessibleName("Can't reach JagHelm. Tap to retry.");
    }
    const screen = state.board
      ? page.getByRole('region', { name: state.shows, exact: true })
      : page.getByText(state.shows, { exact: true });
    await expect(screen).toBeVisible();
    if (state.loaded) await expect(state.loaded(page)).toBeVisible();
    await settled(page);

    // Nothing below the fold goes unshot: a taller screen has an end shot.
    const hidden = await below(page);
    if (state.scroll === 'end') {
      expect(hidden, 'nothing below the fold: drop this end shot').toBeGreaterThan(0);
      await scrollToEnd(page);
      await settled(page);
    } else if (hidden > 0) {
      expect(
        IDS.has(`${state.id}-end`),
        `${hidden}px of the screen lie below the fold: add end(${state.id}) to STATES`
      ).toBe(true);
    }

    await expect.soft(page).toHaveScreenshot(`${state.id}.png`);
    expect(problems, 'errors, and requests elsewhere or unanswered').toEqual([]);
  });
}

test('the baselines are exactly the states', () => {
  const files = readdirSync(BASELINES)
    .filter((f) => f.endsWith('.png'))
    .sort();
  const expected = STATES.map((s) => `${s.id}.png`).sort();
  expect(
    files.filter((f) => !expected.includes(f)),
    'baselines with no state (delete them)'
  ).toEqual([]);
  // A run that writes the missing ones (locally) is writing them now.
  if (test.info().config.updateSnapshots !== 'none') return;
  expect(
    expected.filter((f) => !files.includes(f)),
    'states with no baseline'
  ).toEqual([]);
});

test('every native plugin the app imports is stubbed', () => {
  const src = fileURLToPath(new URL('../src/', import.meta.url));
  const imported = new Set();
  for (const file of readdirSync(src, { recursive: true })) {
    if (!/\.jsx?$/.test(file) || /\.test\./.test(file)) continue;
    for (const [, name] of readFileSync(`${src}${file}`, 'utf8').matchAll(
      /from '((?:@capacitor\/|capacitor-)[^']+)'/g
    )) {
      imported.add(name);
    }
  }
  // Core is no plugin: in a browser native HTTP is off by its own check (nativeHttp.js).
  imported.delete('@capacitor/core');
  expect(imported.size).toBeGreaterThan(0);
  const config = readFileSync(new URL('./vite.config.visual.js', import.meta.url), 'utf8');
  expect([...imported].filter((name) => !config.includes(`'${name}'`))).toEqual([]);
});
