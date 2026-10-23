/*
 * The cross-client status suite, Android side (#325, spec §6 "Proof", §9): the
 * phone draws what the model says, in the words the web says it.
 *
 * Each fixture (server/testing/statusScenarios.js: healthy, incident,
 * source-down, first-run, thresholds, every-state, low-battery,
 * config-broken) is built as the live loop builds /api/status, and handed to
 * the Android app's own screens, through MobileApp, as its poll would hand it
 * over (useDashboard: the status, the /api/services cards, the reach and the
 * answer's clock). Then the screens are read back and checked against the
 * model, as the web's screen side checks the web's (src/ui/crossClient.test.jsx):
 *
 *  - the status bar: the overall state's lamp (none on an empty board) and the
 *    model's sentence;
 *  - the Overview's status card: the model's word for the board's state and
 *    the issues' counts ("Critical · 1 critical"), or the quiet line, "All
 *    systems normal", or an empty board's sentence alone; the sentence under it;
 *  - the strip: a cell per subsystem that has anything, its state, its worst
 *    entity's word, and the model's value over its sub-line (#541); the Power
 *    cell, with the UPS on battery, the model's runtime in the app's words
 *    ("22 min left", #549), and none while stale, as the UPS's issue says it;
 *  - the issue list: a row per issue, in the model's order, its state, word,
 *    name, where (as the web's rows say it) and reason;
 *  - Infra's node cards: each node's state and word, its hosted services
 *    counted from the model's entities ("4 / 5 services up · 1 down", "No
 *    services"), and each bar's level and number, as the model judged and
 *    printed them.
 *
 * And each fixture again with the status stale (#480: the server can't be
 * reached, a 503 past the status's TTL, or no answer for too long): every
 * lamp, cell, row, card and bar is drawn as no signal, keeping the model's
 * words as last known; the card says "No signal", why, and what it last knew.
 *
 * A disagreement fails the suite unless a named exception in KNOWN covers it,
 * in the fixtures it names. An exception that no longer happens fails too.
 * The push side is server/status/crossClient.test.js (`npm run test:ci`); the
 * web's screens, src/ui/crossClient.test.jsx (`npm run test:client`); this
 * file runs in `npm --prefix mobile test`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const { addListener, getPref, setPref, useDashboard } = vi.hoisted(() => ({
  addListener: vi.fn(),
  getPref: vi.fn(),
  setPref: vi.fn(),
  useDashboard: vi.fn(),
}));
vi.mock('@capacitor/app', () => ({ App: { addListener, exitApp: vi.fn() } }));
vi.mock('./storage/prefsAdapter.js', () => ({ getPref, setPref }));
vi.mock('./data/useDashboard.js', () => ({ useDashboard }));
vi.mock('./push/registerPush.js', () => ({
  initPush: vi.fn().mockResolvedValue({ enabled: false }),
  disablePush: vi.fn(),
}));

import MobileApp from './MobileApp.jsx';
import { runScenario, STATUS_SCENARIOS } from '../../server/testing/statusScenarios.js';
import { readingLines, shownReading } from '../../server/status/readings.js';
import { judgeNode, judgeService } from '../../server/status/rules.js';
import { EMPTY } from '../../server/status/summary.js';
import { DEFAULT_THRESHOLDS } from '../../server/status/thresholds.js';
import { countsText, whereOf } from '@shared/shell/statusView.js';
import { NO_SIGNAL, toSeverity } from '@ui/lib/status.js';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const INTERVAL = 30_000;

// ── The model's words ────────────────────────────────────────────────────

// The model's own word for each state a headline can say (as the web suite
// takes them): what it calls a node in that state, and a service in maintenance.
const nodeAt = (diskPercent) =>
  judgeNode(
    { reachable: true, failedReads: [], metrics: { cpu: '10', memPercent: '40', diskPercent } },
    { prometheusOk: true, thresholds: DEFAULT_THRESHOLDS }
  ).word;
const MODEL_WORD = {
  crit: nodeAt('99'),
  warn: nodeAt('91'),
  unknown: judgeNode(null, { prometheusOk: false, thresholds: DEFAULT_THRESHOLDS }).word,
  maintenance: judgeService({ kumaStatus: 'maintenance', kumaOk: true }).word,
};
const QUIET_HEADING = 'All systems normal';

// Each node reading, where /api/services has its value, and the Android bar's label.
const READINGS = {
  cpu: { field: 'cpu', label: 'CPU', unit: '%' },
  mem: { field: 'memPercent', label: 'MEM', unit: '%' },
  disk: { field: 'diskPercent', label: 'DISK', unit: '%' },
  temp: { field: 'temp', label: 'TEMP', unit: '°C' },
};
const JUDGED = new Set(['ok', 'warn', 'crit']);

// ── The phone, fed one fixture ───────────────────────────────────────────

/** An answer clock as useDashboard serves it: the last answer `age` ms ago. */
function clock(age) {
  const at = Date.now() - age;
  return {
    get: () => at,
    subscribe: () => () => {},
    builtAt: () => null,
    staleAfter: 2 * INTERVAL + 12_000,
  };
}

/**
 * How a fixture reaches the phone: fresh; or stale, as the server can't be
 * reached (`down`), as it answers 503 past the status's TTL (`expired`), or
 * as no answer has come for longer than two polls (`aged`).
 */
const WAYS = {
  fresh: { reach: 'ok', age: 0, error: null },
  down: { reach: 'down', age: 5 * 60_000, error: new Error('fetch failed') },
  expired: { reach: 'waiting', age: 5 * 60_000, error: null },
  aged: { reach: 'ok', age: 5 * 60_000, error: null },
};

/** Draw MobileApp on a fixture's /api/status and /api/services. */
async function phone(run, way = 'fresh') {
  const { reach, age, error } = WAYS[way];
  const services = run.cycle.caches.getCached('services');
  // As a client gets them: JSON.
  const status = JSON.parse(JSON.stringify(run.status));
  const servicesBody = JSON.parse(JSON.stringify(services));
  useDashboard.mockReturnValue({
    status,
    servicesBody,
    reach,
    updated: clock(age),
    loading: false,
    error,
    lastUpdated: Date.now() - age,
    intervalMs: INTERVAL,
    foreground: true,
    refresh: vi.fn(),
  });
  let view;
  await act(async () => {
    view = render(<MobileApp />);
  });
  return { status, servicesBody, ...view };
}

// ── Reading the screens back ─────────────────────────────────────────────

const SEVERITY_CLASS = /(?:^|\s)[\w-]+--(critical|caution|healthy|unknown|maintenance|empty)(?:\s|$)/;
/** The severity a class list draws (`lamp--critical`, `issue-row--unknown`, …). */
const drawn = (el) => (el ? (SEVERITY_CLASS.exec(el.getAttribute('class') ?? '')?.[1] ?? null) : null);
const text = (el) => el?.textContent ?? null;

/** The worst entity of a subsystem, by the model's ranking: its word is the cell's. */
function worstOf(status, subsystem) {
  const match = (e) => e.subsystem === subsystem.id && e.state === subsystem.state;
  return status.issues.find(match) ?? status.entities.find(match);
}

/** The hosted services line, counted from the model's entities on the node. */
function hostedLine(status, nodeKey) {
  const hosted = status.entities.filter(
    (e) => (e.kind === 'service' || e.kind === 'container') && e.node === nodeKey
  );
  if (hosted.length === 0) return 'No services';
  const up = hosted.filter((e) => e.state === 'ok').length;
  const down = hosted.filter((e) => e.state === 'crit').length;
  const line = `${up} / ${hosted.length} ${hosted.length === 1 ? 'service' : 'services'} up`;
  return down ? `${line} · ${down} down` : line;
}

/**
 * The UPS's runtime as both clients say it (#549): the model's minutes left
 * while it has the UPS on battery, in the app's words, and none while stale.
 * The web's suite (src/phone/crossClient.test.jsx) holds its UPS sheet to it.
 */
function runtimeLine(status, stale) {
  const ups = status.entities.find((e) => e.id === 'power/ups');
  const onBattery = ups?.state === 'crit' || ups?.state === 'warn';
  return !stale && onBattery && Number.isFinite(ups.runtimeMinutes)
    ? `${ups.runtimeMinutes} min left`
    : null;
}

/**
 * Where the phone and the model disagree, as findings `{ subject, what,
 * model, screen }`. `stale`: the status is stale, so every state is drawn as
 * no signal, and the card says so.
 */
function disagreements({ status, servicesBody }, { stale, cause }) {
  const findings = [];
  const say = (subject, what, model, screen) =>
    findings.push({ subject, what, model: String(model), screen: String(screen) });
  // What the phone should draw for a model state: the model's, or no signal.
  const shown = (state) => (stale ? 'unknown' : toSeverity(state));
  const { state, sentence } = status.overall;
  const issues = status.issues;
  const empty = state === EMPTY && issues.length === 0;

  // The status bar.
  const bar = document.querySelector('.mobile-statusbar');
  const barLamp = bar.querySelector('.status-lamp');
  if (stale) {
    if (drawn(barLamp) !== 'unknown') say('status bar', 'lamp', 'unknown', drawn(barLamp));
    if (text(bar.querySelector('.mobile-statusbar__summary')) !== cause)
      say('status bar', 'sentence', cause, text(bar.querySelector('.mobile-statusbar__summary')));
  } else {
    if (empty ? barLamp !== null : drawn(barLamp) !== toSeverity(state))
      say('status bar', 'lamp', empty ? 'none' : toSeverity(state), drawn(barLamp) ?? 'none');
    if (text(bar.querySelector('.mobile-statusbar__summary')) !== sentence)
      say('status bar', 'sentence', sentence, text(bar.querySelector('.mobile-statusbar__summary')));
  }

  // The status card.
  const card = document.querySelector('.sys-status-card');
  const headline = text(card.querySelector('.sys-status-card__headline'));
  const word = card.querySelector('.sys-status-card__word');
  const subline = text(card.querySelector('.sys-status-card__subline'));
  const footer = text(card.querySelector('.sys-status-card__counts'));
  const quiet = issues.length === 0 && (state === 'ok' || state === 'maintenance');
  if (stale) {
    if (drawn(card) !== 'unknown') say('card', 'state', 'unknown', drawn(card));
    if (headline !== MODEL_WORD.unknown) say('card', 'headline', MODEL_WORD.unknown, headline);
    if (subline !== cause) say('card', 'why', cause, subline);
    if (!footer?.startsWith('last known ') || !footer.includes(': '))
      say('card', 'last known', 'last known <age>: <what it said>', footer);
  } else if (empty) {
    if (drawn(card) !== 'empty') say('card', 'state', 'empty', drawn(card));
    if (headline !== sentence) say('card', 'headline', sentence, headline);
    if (word) say('card', 'word', 'none', text(word));
    if (subline !== null) say('card', 'sentence', 'said once', subline);
  } else {
    if (drawn(card) !== toSeverity(state)) say('card', 'state', toSeverity(state), drawn(card));
    const counts = countsText(issues);
    const heading = quiet
      ? QUIET_HEADING
      : counts
        ? `${MODEL_WORD[state]} · ${counts}`
        : MODEL_WORD[state];
    if (headline !== heading) say('card', 'headline', heading, headline);
    if (quiet ? word !== null : text(word) !== MODEL_WORD[state])
      say('card', 'word', quiet ? 'none' : MODEL_WORD[state], text(word) ?? 'none');
    if (subline !== sentence) say('card', 'sentence', sentence, subline);
  }

  // The strip: a cell for each subsystem that has anything, in the model's order.
  const cells = [...document.querySelectorAll('.subsystem-cell')];
  const subsystems = status.subsystems.filter((s) => s.counts.total > 0);
  if (cells.length !== subsystems.length) say('strip', 'cells', subsystems.length, cells.length);
  subsystems.forEach((s, n) => {
    const cell = cells[n];
    if (!cell) return;
    const subject = `strip/${s.id}`;
    if (text(cell.querySelector('.subsystem-cell__label')) !== s.name)
      say(subject, 'label', s.name, text(cell.querySelector('.subsystem-cell__label')));
    if (drawn(cell) !== shown(s.state)) say(subject, 'state', shown(s.state), drawn(cell));
    if (drawn(cell.querySelector('.status-lamp')) !== shown(s.state))
      say(subject, 'lamp', shown(s.state), drawn(cell.querySelector('.status-lamp')));
    const said = worstOf(status, s).word;
    if (text(cell.querySelector('.status-word')) !== said.toUpperCase())
      say(subject, 'word', said.toUpperCase(), text(cell.querySelector('.status-word')));
    // The model's value and sub-line (#541), as they are, fresh or stale: the
    // status card says how old a stale status is, once, not each cell.
    if (text(cell.querySelector('.subsystem-cell__value')) !== s.value)
      say(subject, 'value', s.value, text(cell.querySelector('.subsystem-cell__value')));
    const drawnSub = text(cell.querySelector('.subsystem-cell__sub'));
    if (drawnSub !== (s.sub || null)) say(subject, 'sub', s.sub || 'none', drawnSub ?? 'none');
    // The runtime the Power cell adds (#549); no other cell has a line of it.
    const runtime = s.id === 'power' ? runtimeLine(status, stale) : null;
    const drawnRuntime = text(cell.querySelector('.subsystem-cell__readings'));
    if (drawnRuntime !== runtime) say(subject, 'runtime', runtime ?? 'none', drawnRuntime ?? 'none');
  });

  // The issue list, in the model's order.
  const rows = [...document.querySelectorAll('.overview-issues .issue-row')];
  if (rows.length !== issues.length) say('issues', 'count', issues.length, rows.length);
  issues.forEach((issue, n) => {
    const row = rows[n];
    if (!row) return;
    if (drawn(row) !== shown(issue.state)) say(issue.id, 'state', shown(issue.state), drawn(row));
    if (drawn(row.querySelector('.status-lamp')) !== shown(issue.state))
      say(issue.id, 'lamp', shown(issue.state), drawn(row.querySelector('.status-lamp')));
    if (text(row.querySelector('.status-word')) !== issue.word.toUpperCase())
      say(issue.id, 'word', issue.word.toUpperCase(), text(row.querySelector('.status-word')));
    if (text(row.querySelector('.issue-row__name')) !== issue.name)
      say(issue.id, 'name', issue.name, text(row.querySelector('.issue-row__name')));
    if (text(row.querySelector('.issue-row__readout')) !== whereOf(issue))
      say(issue.id, 'where', whereOf(issue), text(row.querySelector('.issue-row__readout')));
    if (text(row.querySelector('.issue-row__cause')) !== issue.reason)
      say(issue.id, 'reason', issue.reason, text(row.querySelector('.issue-row__cause')));
  });

  // Infra: a card per node the model has.
  fireEvent.click(screen.getByRole('tab', { name: 'Infra' }));
  const nodes = status.entities.filter((e) => e.kind === 'node');
  const cards = [...document.querySelectorAll('.node-card')];
  if (cards.length !== nodes.length) say('infra', 'cards', nodes.length, cards.length);
  for (const e of nodes) {
    const nodeCard = cards.find((c) => text(c.querySelector('.node-card__name')) === e.name);
    if (!nodeCard) {
      say(e.id, 'card', e.name, 'none drawn');
      continue;
    }
    const lamp = nodeCard.querySelector('.node-card__lamp .status-lamp');
    if (drawn(lamp) !== shown(e.state)) say(e.id, 'lamp', shown(e.state), drawn(lamp));
    if (lamp?.getAttribute('aria-label') !== e.word)
      say(e.id, 'word', e.word, lamp?.getAttribute('aria-label'));
    const hosted = hostedLine(status, e.node);
    if (text(nodeCard.querySelector('.node-card__count')) !== hosted)
      say(e.id, 'hosted', hosted, text(nodeCard.querySelector('.node-card__count')));
    const metrics = servicesBody.nodes?.[e.node]?.metrics ?? {};
    for (const bar of nodeCard.querySelectorAll('.usage-bar')) {
      const reading = Object.keys(READINGS).find(
        (k) => READINGS[k].label === text(bar.querySelector('.usage-bar__label'))
      );
      const level = e.conditions?.[reading];
      const subject = `${e.id} ${reading}`;
      const want = level == null ? 'none' : stale ? 'unknown' : level;
      if ((bar.dataset.state ?? 'none') !== want)
        say(subject, 'bar state', want, bar.dataset.state ?? 'none');
      const raw = Number(metrics[READINGS[reading].field]);
      const number = JUDGED.has(level)
        ? `${shownReading(raw, readingLines(status.thresholds, reading))}${READINGS[reading].unit}`
        : '—';
      if (text(bar.querySelector('.usage-bar__value')) !== number)
        say(subject, 'number', number, text(bar.querySelector('.usage-bar__value')));
    }
  }
  fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
  return findings;
}

const describeFinding = (f) =>
  `${f.subject}: ${f.what}: the model says "${f.model}", the phone "${f.screen}"`;

// ── Known divergences ────────────────────────────────────────────────────

/**
 * The disagreements the suite knows about, each named, with the issue that
 * settles it and the fixtures it shows in. None today.
 */
const KNOWN = [];

function check(name, findings) {
  const here = KNOWN.filter((k) => k.at.includes(name));
  const unexplained = findings.filter((f) => !here.some((k) => k.covers(f)));
  expect(unexplained.map(describeFinding), 'disagreements no named exception covers').toEqual([]);
  for (const k of here) {
    expect(
      findings.some((f) => k.covers(f)),
      `known divergence "${k.name}" (${k.issue}) no longer happens in ${name}: delete it from KNOWN`
    ).toBe(true);
  }
}

beforeEach(() => {
  addListener.mockReset();
  addListener.mockReturnValue({ remove() {} });
  getPref.mockResolvedValue(null);
  setPref.mockResolvedValue(undefined);
});

// The incident boards' tiles name their problem in the sub-line, as the
// mock's do, never the OK word beside one (#541; summary.js tileOf).
const PROBLEM_SUBS = {
  incident: ['1 down', 'healthy', '100 % charge', 'OK', '1 failed'],
  'every-state': [
    '1 missing · 1 pending · 1 in maintenance',
    '1 unreachable',
    '64 % charge',
    '1 overdue · 1 failed',
    '1 overdue',
    '1 failing · 1 offline',
  ],
};

// The scenarios with the UPS on battery, and its runtime in the app's words
// (#549): every-state's is 1290 s, 21.5 min, rounded as the app always has.
const RUNTIME = { 'every-state': '22 min left', 'low-battery': '4 min left' };

/** Opens the UPS's issue from the Overview; its detail's runtime line, or null. */
function upsDetailRuntime() {
  const row = [...document.querySelectorAll('.overview-issues .issue-row')].find(
    (r) => text(r.querySelector('.issue-row__readout')) === 'Power'
  );
  fireEvent.click(row);
  return text(document.querySelector('[aria-label="Incident detail"] .detail-readings'));
}

describe('cross-client, Android screens', () => {
  for (const name of STATUS_SCENARIOS) {
    it(`${name}: the phone says what the model says`, async () => {
      const board = await phone(runScenario(name, { now: NOW }));
      check(name, disagreements(board, { stale: false }));
    });
  }

  for (const name of STATUS_SCENARIOS) {
    it(`${name}, the server out of reach: every state is no signal, the words last known`, async () => {
      const board = await phone(runScenario(name, { now: NOW }), 'down');
      // The status bar names the failed round; the card says why too.
      check(name, disagreements(board, { stale: true, cause: NO_SIGNAL.down }));
    });
  }

  for (const [name, subs] of Object.entries(PROBLEM_SUBS)) {
    it(`${name}: each cell's sub-line names its problem (#541)`, async () => {
      await phone(runScenario(name, { now: NOW }));
      const drawn = [...document.querySelectorAll('.subsystem-cell__sub')];
      expect(drawn.map((el) => el.textContent)).toEqual(subs);
    });
  }

  for (const [name, words] of Object.entries(RUNTIME)) {
    it(`${name}: the Power cell and the UPS's issue say "${words}", from the model alone (#549)`, async () => {
      const { status } = await phone(runScenario(name, { now: NOW }));
      expect(runtimeLine(status, false)).toBe(words);
      expect(text(document.querySelector('.subsystem-cell__readings'))).toBe(words);
      expect(upsDetailRuntime()).toBe(words);
    });

    it(`${name}, the server out of reach: no runtime on the cell or the issue, the words last known (#549)`, async () => {
      await phone(runScenario(name, { now: NOW }), 'down');
      expect(document.querySelector('.subsystem-cell__readings')).toBeNull();
      expect(upsDetailRuntime()).toBeNull();
      expect(document.querySelector('[aria-label="Incident detail"] .detail-cause')).not.toBeNull();
    });
  }

  it('incident, a 503 past the status TTL: no signal, "out of date" (#480)', async () => {
    const board = await phone(runScenario('incident', { now: NOW }), 'expired');
    check('incident', disagreements(board, { stale: true, cause: NO_SIGNAL.expired }));
  });

  it('incident, no answer for longer than two polls: no signal, though the last poll said ok (#480)', async () => {
    const board = await phone(runScenario('incident', { now: NOW }), 'aged');
    check('incident', disagreements(board, { stale: true, cause: NO_SIGNAL.expired }));
  });

  it('first-run: the quiet first-run line, never no signal and never healthy (#449)', async () => {
    await phone(runScenario('first-run', { now: NOW }));
    const card = document.querySelector('.sys-status-card');
    expect(card.className).toMatch(/sys-status-card--empty/);
    expect(card.textContent).toBe('System statusNothing monitored yet');
    expect(document.querySelector('.mobile-statusbar .status-lamp')).toBeNull();
    expect(document.body.textContent).not.toMatch(/no signal|healthy|all systems normal/i);
    expect(document.querySelectorAll('.subsystem-cell')).toHaveLength(0);
  });

  it('config-broken: the broken services.yaml is an issue on the phone, not just a push (#505)', async () => {
    const { status } = await phone(runScenario('config-broken', { now: NOW }));
    const issue = status.issues.find((i) => i.id === 'sources/config');
    const row = [...document.querySelectorAll('.overview-issues .issue-row')].find(
      (r) => r.querySelector('.issue-row__name').textContent === issue.name
    );
    expect(row.querySelector('.issue-row__readout').textContent).toBe('Configuration');
    expect(row.querySelector('.issue-row__cause').textContent).toBe(
      "services.yaml doesn't parse (line 12)"
    );
    expect(document.querySelector('.mobile-statusbar__summary').textContent).toBe(
      status.overall.sentence
    );
  });
});
