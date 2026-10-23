/*
 * The cross-client status suite, the web's phone screens (#303, spec §8
 * "Phone width"): below 768px the web draws the Android app's screens, from
 * src/phone/, in its own look, and says the same words.
 *
 * Each fixture (server/testing/statusScenarios.js) is built as the live loop
 * builds /api/status, and handed to the shared screens as the web gives them
 * their data (src/shell/phoneData.js: the header's poll judged fresh or stale
 * by the one rule, and the board's cards). Then the screens are read back and
 * checked against the model, as mobile/src/crossClient.test.jsx checks the
 * same screens in the Android look, item for item:
 *
 *  - the status card: the model's word for the board's state, alone, as the
 *    Phone board's card says it (the Android look puts the issues' counts
 *    after it, "Critical · 1 critical", which its own suite,
 *    mobile/src/crossClient.test.jsx, holds), or "All systems normal", or an
 *    empty board's sentence alone; the sentence under it; stale, "No signal",
 *    why, and what it last knew;
 *  - the strip: a tile per subsystem that has anything, its state, its worst
 *    entity's word, the model's value and sub-line (a phone's tile leaves the
 *    sub-line, and a stale tile its word, to a screen reader);
 *  - the issue rows, in the model's order: state, word, name, where (in the
 *    row's name; a phone's row draws the age there, as the Phone board's) and
 *    reason;
 *  - Infrastructure's node cards: each node's state and word, its hosted
 *    services counted from the model's entities, and each meter's level and
 *    number, as the model judged and printed them;
 *  - the UPS's sheet: on battery, the model's runtime in the app's words ("21
 *    min left", #549), and none while stale (the web's tile leaves it to the
 *    sheet; the Android cell draws it, which its own suite holds).
 *
 * And each fixture again with the server out of reach: every lamp, tile, row,
 * card and meter is drawn as no signal, keeping the model's words as last
 * known. A disagreement fails the suite unless a named exception in KNOWN
 * covers it; an exception that no longer happens fails too.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, within } from '@testing-library/react';
import Overview from './views/Overview.jsx';
import Infra from './views/Infra.jsx';
import IncidentDetail from './views/IncidentDetail.jsx';
import { PhonePlatform } from './platform.js';
import { phoneData } from '../shell/phoneData.js';
import { useStatusFreshness } from '../shell/statusFreshness.js';
import { whereOf } from '../shell/statusView.js';
import { runScenario, STATUS_SCENARIOS } from '../../server/testing/statusScenarios.js';
import { readingLines, shownReading } from '../../server/status/readings.js';
import { judgeNode, judgeService } from '../../server/status/rules.js';
import { EMPTY } from '../../server/status/summary.js';
import { DEFAULT_THRESHOLDS } from '../../server/status/thresholds.js';
import { NO_SIGNAL, WORDS } from '../ui/lib/status.js';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const INTERVAL = 30_000;

// ── The model's words, as the Android suite takes them ──────────────────

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

const READINGS = {
  cpu: { field: 'cpu', unit: '%' },
  mem: { field: 'memPercent', unit: '%' },
  disk: { field: 'diskPercent', unit: '%' },
  temp: { field: 'temp', unit: '°C' },
};
const JUDGED = new Set(['ok', 'warn', 'crit']);

// ── The web's phone, fed one fixture ────────────────────────────────────

/** An answer clock as useStatus serves it: the last answer `age` ms ago. */
function clock(age) {
  const at = Date.now() - age;
  return {
    get: () => at,
    subscribe: () => () => {},
    builtAt: () => null,
    staleAfter: 2 * INTERVAL + 12_000,
  };
}

const WAYS = {
  fresh: { reach: 'ok', age: 0, error: null },
  down: { reach: 'down', age: 5 * 60_000, error: 'fetch failed' },
};

/** A screen as PhoneView draws it: the web's data, a nav, the web's platform. */
function WebScreen({ screen, status, services, reach, updated, error, params = {} }) {
  const Screen = screen;
  const freshness = useStatusFreshness({ status, reach, updated });
  const data = phoneData({
    status,
    reach,
    updated,
    freshness,
    board: {
      serviceData: services,
      servicesLoaded: true,
      sources: { services: { error } },
    },
  });
  return (
    <PhonePlatform value={{ openTarget: vi.fn() }}>
      <Screen data={data} nav={{ push: vi.fn(), pop: vi.fn() }} params={params} />
    </PhonePlatform>
  );
}

/** Draw `Screen` on a fixture's /api/status and /api/services. */
function phone(Screen, run, way = 'fresh', params = {}) {
  const { reach, age, error } = WAYS[way];
  const status = JSON.parse(JSON.stringify(run.status));
  const services = JSON.parse(JSON.stringify(run.cycle.caches.getCached('services')));
  const view = render(
    <WebScreen
      screen={Screen}
      status={status}
      services={services}
      reach={reach}
      updated={clock(age)}
      error={error}
      params={params}
    />
  );
  return { status, services, ...view };
}

/**
 * The UPS's runtime as both clients say it (#549): the model's minutes left
 * while it has the UPS on battery, in the app's words, and none while stale.
 */
function runtimeLine(status, stale) {
  const ups = status.entities.find((e) => e.id === 'power/ups');
  const onBattery = ups?.state === 'crit' || ups?.state === 'warn';
  return !stale && onBattery && Number.isFinite(ups.runtimeMinutes)
    ? `${ups.runtimeMinutes} min left`
    : null;
}

/** The UPS fact on its sheet, or null. */
function upsFact(root) {
  const term = [...root.querySelectorAll('[data-slot="fact-list"] dt')].find(
    (dt) => dt.textContent === 'UPS'
  );
  return term ? term.nextElementSibling.textContent : null;
}

// The scenarios with the UPS on battery, and its runtime in the app's words (#549).
const RUNTIME = { 'every-state': '21 min left', 'low-battery': '4 min left' };

// ── Reading the screens back ────────────────────────────────────────────

const text = (el) => el?.textContent ?? null;
const stateOf = (el) => el?.getAttribute('data-state') ?? null;
const lampOf = (el) => el.querySelector('[data-slot="status-lamp"]');

function worstOf(status, subsystem) {
  const match = (e) => e.subsystem === subsystem.id && e.state === subsystem.state;
  return status.issues.find(match) ?? status.entities.find(match);
}

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

/** Where the Overview and the model disagree, as findings. */
function overviewDisagreements(root, { status }, { stale, cause }) {
  const findings = [];
  const say = (subject, what, model, screen) =>
    findings.push({ subject, what, model: String(model), screen: String(screen) });
  const shown = (state) => (stale ? 'unknown' : state);
  const { state, sentence } = status.overall;
  const issues = status.issues;
  const empty = state === EMPTY && issues.length === 0;
  const quiet = issues.length === 0 && (state === 'ok' || state === 'maintenance');

  // The status card.
  const panel = root.querySelector('[data-slot="attention-panel"]');
  const header = panel.querySelector('[data-slot="attention-panel-header"]');
  const heading = text(within(header).getByRole('heading', { level: 2 }));
  const lines = [...header.querySelectorAll('p')].map(text);
  if (stale) {
    if (stateOf(panel) !== 'unknown') say('card', 'state', 'unknown', stateOf(panel));
    if (heading !== MODEL_WORD.unknown) say('card', 'headline', MODEL_WORD.unknown, heading);
    if (!lines.includes(cause)) say('card', 'why', cause, lines.join(' | '));
    if (!lines.some((l) => l.startsWith('last known ') && l.includes(': ')))
      say('card', 'last known', 'last known <age>: <what it said>', lines.join(' | '));
  } else if (empty) {
    if (stateOf(panel) !== EMPTY) say('card', 'state', EMPTY, stateOf(panel));
    if (heading !== sentence) say('card', 'headline', sentence, heading);
    if (lines.includes(sentence)) say('card', 'sentence', 'said once', sentence);
  } else {
    if (stateOf(panel) !== state) say('card', 'state', state, stateOf(panel));
    // The word alone; the counts are the Android card's (its own suite's).
    const want = quiet ? QUIET_HEADING : MODEL_WORD[state];
    if (heading !== want) say('card', 'headline', want, heading);
    if (!lines.includes(sentence)) say('card', 'sentence', sentence, lines.join(' | '));
  }

  // The strip.
  const tiles = [...root.querySelectorAll('[data-slot="subsystem-tile"]')];
  const subsystems = status.subsystems.filter((s) => s.counts.total > 0);
  if (tiles.length !== subsystems.length) say('strip', 'tiles', subsystems.length, tiles.length);
  subsystems.forEach((s, n) => {
    const tile = tiles[n];
    if (!tile) return;
    const subject = `strip/${s.id}`;
    if (!tile.textContent.startsWith(s.name)) say(subject, 'label', s.name, tile.textContent);
    if (stateOf(tile) !== shown(s.state)) say(subject, 'state', shown(s.state), stateOf(tile));
    if (stateOf(lampOf(tile)) !== shown(s.state))
      say(subject, 'lamp', shown(s.state), stateOf(lampOf(tile)));
    const word = worstOf(status, s).word;
    // Fresh, the lamp is named by the word; stale, "No signal", the word after the label.
    const lampName = lampOf(tile).getAttribute('aria-label');
    if (stale) {
      if (lampName !== WORDS.unknown && word !== WORDS.unknown)
        say(subject, 'lamp name', WORDS.unknown, lampName);
      if (lampName !== word && !tile.textContent.includes(word))
        say(subject, 'word', word, tile.textContent);
    } else if (lampName !== word) say(subject, 'word', word, lampName);
    const value = text(tile.querySelector('[data-slot="subsystem-value"]'));
    if (value !== s.value) say(subject, 'value', s.value, value);
    if (s.sub && !tile.textContent.includes(s.sub)) say(subject, 'sub', s.sub, tile.textContent);
  });

  // The issue rows, in the model's order.
  const rows = [...panel.querySelectorAll('[data-slot="issue-row"]')];
  if (rows.length !== issues.length) say('issues', 'count', issues.length, rows.length);
  issues.forEach((issue, n) => {
    const row = rows[n];
    if (!row) return;
    if (stateOf(row) !== shown(issue.state))
      say(issue.id, 'state', shown(issue.state), stateOf(row));
    if (stateOf(lampOf(row)) !== shown(issue.state))
      say(issue.id, 'lamp', shown(issue.state), stateOf(lampOf(row)));
    const drawn = row.textContent;
    for (const [what, words] of [
      ['name', issue.name],
      ['word', issue.word],
      ['reason', issue.reason],
    ])
      if (!drawn.includes(words)) say(issue.id, what, words, drawn);
    const name = row.getAttribute('aria-label') ?? '';
    if (!name.includes(whereOf(issue))) say(issue.id, 'where', whereOf(issue), name);
  });
  return findings;
}

/** Where Infrastructure's cards and the model disagree. */
function infraDisagreements(root, { status, services }, { stale }) {
  const findings = [];
  const say = (subject, what, model, screen) =>
    findings.push({ subject, what, model: String(model), screen: String(screen) });
  const shown = (state) => (stale ? 'unknown' : state);
  const nodes = status.entities.filter((e) => e.kind === 'node');
  const cards = [...root.querySelectorAll('[data-slot="node-card"]')];
  if (cards.length !== nodes.length) say('infra', 'cards', nodes.length, cards.length);
  for (const e of nodes) {
    const card = cards.find((c) => text(c.querySelector('h3')) === e.name);
    if (!card) {
      say(e.id, 'card', e.name, 'none drawn');
      continue;
    }
    if (stateOf(card) !== shown(e.state)) say(e.id, 'state', shown(e.state), stateOf(card));
    const lamp = card.querySelector('[data-slot="node-state"] [data-slot="status-lamp"]');
    if (stateOf(lamp) !== shown(e.state)) say(e.id, 'lamp', shown(e.state), stateOf(lamp));
    const said = card.querySelector('[data-slot="node-state"]').textContent;
    const named = lamp.getAttribute('aria-label');
    if (said !== e.word && named !== e.word) say(e.id, 'word', e.word, `${said} | ${named}`);
    const hosted = hostedLine(status, e.node);
    const footer = text(card.querySelector('[data-slot="node-footer"]'));
    if (!footer?.includes(hosted)) say(e.id, 'hosted', hosted, footer);
    const metrics = services.nodes?.[e.node]?.metrics ?? {};
    for (const meter of card.querySelectorAll('[data-slot="metric-meter"]')) {
      const reading = meter.dataset.reading;
      const level = e.conditions?.[reading];
      const subject = `${e.id} ${reading}`;
      const want = level == null ? 'ok' : stale ? 'unknown' : level;
      // A meter the model didn't judge is drawn with its own level, an empty track.
      if (JUDGED.has(level) && stateOf(meter) !== want)
        say(subject, 'meter state', want, stateOf(meter));
      const raw = Number(metrics[READINGS[reading].field]);
      const number = JUDGED.has(level)
        ? `${shownReading(raw, readingLines(status.thresholds, reading))}${READINGS[reading].unit}`
        : '—';
      if (!meter.textContent.includes(number)) say(subject, 'number', number, meter.textContent);
    }
  }
  return findings;
}

const describeFinding = (f) =>
  `${f.subject}: ${f.what}: the model says "${f.model}", the web's phone "${f.screen}"`;

/** The disagreements the suite knows about, each named. None. */
const KNOWN = [];

function check(name, findings) {
  const here = KNOWN.filter((k) => k.at.includes(name));
  const unexplained = findings.filter((f) => !here.some((k) => k.covers(f)));
  expect(unexplained.map(describeFinding), 'disagreements no named exception covers').toEqual([]);
}

describe("cross-client, the web's phone screens (#303)", () => {
  for (const name of STATUS_SCENARIOS) {
    it(`${name}: the Overview and Infrastructure say what the model says, as Android's do`, () => {
      const run = runScenario(name, { now: NOW });
      const overview = phone(Overview, run);
      check(name, overviewDisagreements(overview.container, overview, { stale: false }));
      overview.unmount();
      const infra = phone(Infra, run);
      check(name, infraDisagreements(infra.container, infra, { stale: false }));
    });
  }

  for (const name of STATUS_SCENARIOS) {
    it(`${name}, the server out of reach: every state no signal, the words last known`, () => {
      const run = runScenario(name, { now: NOW });
      const overview = phone(Overview, run, 'down');
      check(
        name,
        overviewDisagreements(overview.container, overview, {
          stale: true,
          cause: NO_SIGNAL.down,
        })
      );
      overview.unmount();
      const infra = phone(Infra, run, 'down');
      check(name, infraDisagreements(infra.container, infra, { stale: true }));
    });
  }

  for (const name of STATUS_SCENARIOS) {
    it(`${name}: the UPS's sheet draws the model's runtime on battery, and none stale (#549)`, () => {
      for (const [way, stale] of [
        ['fresh', false],
        ['down', true],
      ]) {
        const run = runScenario(name, { now: NOW });
        if (!run.status.issues.some((i) => i.id === 'power/ups')) return;
        const sheet = phone(IncidentDetail, run, way, { id: 'power/ups' });
        expect(upsFact(sheet.container), way).toBe(runtimeLine(sheet.status, stale));
        sheet.unmount();
      }
    });
  }

  for (const [name, words] of Object.entries(RUNTIME)) {
    it(`${name}: the UPS's sheet says "${words}", the words Android says (#549)`, () => {
      const { container } = phone(IncidentDetail, runScenario(name, { now: NOW }), 'fresh', {
        id: 'power/ups',
      });
      expect(upsFact(container)).toBe(words);
    });
  }

  it('first-run: the quiet first-run card, never no signal and never healthy (#449)', () => {
    const { container } = phone(Overview, runScenario('first-run', { now: NOW }));
    const panel = container.querySelector('[data-slot="attention-panel"]');
    expect(panel).toHaveAttribute('data-state', EMPTY);
    expect(within(panel).getByRole('heading', { level: 2 })).toHaveTextContent(
      /^Nothing monitored yet$/
    );
    expect(container.textContent).not.toMatch(/no signal|healthy|all systems normal/i);
    expect(container.querySelectorAll('[data-slot="subsystem-tile"]')).toHaveLength(0);
  });

  it('config-broken: the broken services.yaml is an issue row, its place "Configuration" (#505)', () => {
    const { container, status } = phone(Overview, runScenario('config-broken', { now: NOW }));
    const issue = status.issues.find((i) => i.id === 'sources/config');
    const row = [...container.querySelectorAll('[data-slot="issue-row"]')].find((r) =>
      r.textContent.includes(issue.name)
    );
    expect(row).toHaveTextContent("services.yaml doesn't parse (line 12)");
    expect(row.getAttribute('aria-label')).toContain('Configuration');
  });
});
