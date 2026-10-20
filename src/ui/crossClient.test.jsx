/*
 * The cross-client status suite, screen side (#293, spec §6 "Proof", §12): the
 * same input can never give one answer on the screen and another in a push.
 *
 * Each fixture (server/testing/statusScenarios.js: healthy, incident,
 * source-down, first-run, thresholds, every-state, low-battery) is built as
 * the live loop builds /api/status, and its status is drawn with the src/ui status components, the
 * way a screen draws the model (Board, below): the attention panel from the
 * overall state, sentence and issues; a subsystem tile per subsystem that has
 * anything; a row per entity; a meter per node reading. Then the screen is
 * read back and checked against the model: the headline's word and sentence,
 * each tile's state, word and counts, each row's state and word, and each
 * meter's state, number and line. The push side, the same fixtures through
 * the real push cycle, is server/status/crossClient.test.js (`npm run
 * test:ci`); this file runs in `npm run test:client`.
 *
 * A meter takes its lines (its threshold tick, and "warning above 90%") from
 * the fixture's threshold config, the one the model was given: /api/status
 * doesn't serve them yet (#451), so a screen has nowhere else to read them.
 *
 * A disagreement fails the suite unless a named exception in KNOWN covers it,
 * in the fixtures it names. An exception that no longer happens fails too, so
 * deleting it is the whole change once it is settled.
 *
 * Not covered: the legacy derivations, src/utils/thresholds.js (deleted by
 * #306) and mobile/src/data/derive.js (deleted by #325 and #326). Android's
 * screens join this suite in #325, when they render the model.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AttentionPanel } from './attention-panel.jsx';
import { EntityRow } from './entity-row.jsx';
import { MetricMeter } from './metric-meter.jsx';
import { SubsystemStrip } from './subsystem-strip.jsx';
import { STATES } from './lib/status.js';
import { runScenario, STATUS_SCENARIOS } from '../../server/testing/statusScenarios.js';
import { cycles, inputs, node } from '../../server/testing/statusFixtures.js';
import { judgeNode, judgeService } from '../../server/status/rules.js';
import { DEFAULT_THRESHOLDS } from '../../server/status/thresholds.js';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const noop = () => {};

// ── The model's words ────────────────────────────────────────────────────

// The model's own word for each state a headline can say: what it calls a
// node in that state (status/rules.js judgeNode) and a service in maintenance.
// The model gives the board a state, not a word, so the screen says the word
// for that state, and it must be this one.
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

// ── The screen: the model drawn with src/ui ──────────────────────────────

// Each node reading: where /api/services has its value (the model serves only
// the worst one, as `metric`), its unit, and its lines in the threshold config
// (not served by /api/status yet, #451).
const READINGS = {
  cpu: { field: 'cpu', unit: '%', lines: (t) => ({ warn: t.cpu.warn * 100 }) },
  mem: { field: 'memPercent', unit: '%', lines: (t) => ({ warn: t.mem.warn * 100 }) },
  disk: {
    field: 'diskPercent',
    unit: '%',
    lines: (t) => ({ warn: t.disk.warn * 100, crit: t.disk.crit * 100 }),
  },
  temp: { field: 'temp', unit: '°C', lines: (t) => ({ warn: t.temp.warn, crit: t.temp.crit }) },
};

/** The worst entity of a subsystem, by the model's ranking: its word is the tile's. */
function worstOf(status, subsystem) {
  const match = (e) => e.subsystem === subsystem.id && e.state === subsystem.state;
  return status.issues.find(match) ?? status.entities.find(match);
}

/**
 * A screen drawn from one /api/status, as the Overview draws the model: the
 * board's state and sentence and the ranked issues in the attention panel (the
 * sentence is the quiet line when nothing needs attention), a tile per
 * subsystem that has anything (spec §8: what isn't set up shows no panel), a
 * row per entity, and each node's meters, valued from /api/services and
 * coloured by the model's `conditions`, with the server's lines.
 */
function Board({ status, services, thresholds }) {
  const quiet = status.issues.length === 0;
  const cells = status.subsystems
    .filter((s) => s.counts.total > 0)
    .map((s) => ({
      key: s.id,
      label: s.name,
      state: s.state,
      word: worstOf(status, s)?.word,
      value: s.detail,
    }));
  return (
    <>
      <AttentionPanel
        state={status.overall.state}
        subline={quiet ? undefined : status.overall.sentence}
        counts={quiet ? status.overall.sentence : undefined}
        issues={status.issues.map((i) => ({
          id: i.id,
          state: i.state,
          word: i.word,
          title: i.name,
          reason: i.reason,
          onOpen: noop,
        }))}
      />
      {cells.length > 0 && <SubsystemStrip cells={cells} onSelect={noop} />}
      <ul aria-label="Entities">
        {status.entities.map((e) => (
          <li key={e.id} data-entity={e.id}>
            <EntityRow
              state={e.state}
              word={e.word}
              name={e.name}
              detail={e.reason}
              onOpen={noop}
            />
          </li>
        ))}
      </ul>
      {status.entities
        .filter((e) => e.kind === 'node' && e.conditions)
        .map((e) => (
          <section key={e.id} data-node={e.id}>
            {Object.entries(e.conditions)
              .filter(([reading]) => Object.hasOwn(READINGS, reading))
              .map(([reading, state]) => {
                const { field, unit, lines } = READINGS[reading];
                const raw = services?.nodes?.[e.node]?.metrics?.[field];
                const value = raw == null ? null : Number(raw);
                return (
                  <div key={reading} data-reading={reading} data-raw={value ?? ''}>
                    <MetricMeter
                      label={`${e.id} ${reading}`}
                      value={value}
                      unit={unit}
                      state={state}
                      {...lines(thresholds)}
                    />
                  </div>
                );
              })}
          </section>
        ))}
    </>
  );
}

// ── Reading the screen back ──────────────────────────────────────────────

/** The text of the elements an element's aria-describedby names, in order. */
function described(el, doc) {
  return (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => doc.getElementById(id)?.textContent ?? '');
}

const LABEL_READING = { CPU: 'cpu', Memory: 'mem', Disk: 'disk', Temperature: 'temp' };
const SAID = { warning: 'warn', critical: 'crit' };
// "Disk 94 % (warning above 90 %)", "Memory 87 % (warning until below 85 %)",
// "CPU 97 % (warning above 90 % for 2 cycles)": status/rules.js levelReason.
const READING_REASON =
  /^(CPU|Memory|Disk|Temperature) (\d+) (%|°C) \((warning|critical) (above|until below) ([\d.]+) (%|°C)/;

/**
 * Where the screen and the model disagree, as findings `{ subject, what,
 * model, screen }`.
 */
function disagreements({ status, cycle }) {
  const { container } = render(
    <Board
      status={status}
      services={cycle.caches.getCached('services')}
      thresholds={cycle.thresholds}
    />
  );
  const doc = container.ownerDocument;
  const findings = [];
  const say = (subject, what, model, screen, extra = {}) =>
    findings.push({ subject, what, model: String(model), screen: String(screen), ...extra });

  // The headline.
  const panel = container.querySelector('[data-slot="attention-panel"]');
  const { state, sentence } = status.overall;
  if (panel.dataset.state !== state) say('headline', 'state', state, panel.dataset.state);
  const quiet = panel.getAttribute('aria-label') === 'Status';
  if (quiet !== (status.issues.length === 0))
    say(
      'headline',
      'quiet',
      status.issues.length === 0 ? 'nothing needs attention' : 'issues',
      quiet ? 'the quiet line' : 'the attention panel'
    );
  if (!quiet) {
    const word = panel.querySelector('h1 [data-slot="status-word"]')?.textContent;
    if (word !== MODEL_WORD[state]) say('headline', 'word', MODEL_WORD[state], word);
  }
  if (!panel.textContent.includes(sentence))
    say('headline', 'sentence', sentence, panel.textContent);

  // The issues, in the model's order.
  const rows = [...panel.querySelectorAll('[data-slot="issue-row"]')];
  if (rows.length !== status.issues.length)
    say('issues', 'count', status.issues.length, rows.length);
  status.issues.forEach((issue, n) => {
    const row = rows[n];
    if (!row) return;
    if (row.dataset.state !== issue.state)
      say(issue.id, 'issue state', issue.state, row.dataset.state);
    const name = `${issue.name}, ${issue.word}`;
    if (row.getAttribute('aria-label') !== name)
      say(issue.id, 'issue word', name, row.getAttribute('aria-label'));
    if (described(row, doc)[0] !== issue.reason)
      say(issue.id, 'issue reason', issue.reason, described(row, doc)[0]);
  });

  // The subsystems: a tile for each that has anything, with its state, word and counts.
  const tiles = [...container.querySelectorAll('[data-slot="subsystem-tile"]')];
  const shown = status.subsystems.filter((s) => s.counts.total > 0);
  if (tiles.length !== shown.length) say('subsystems', 'tiles', shown.length, tiles.length);
  shown.forEach((s, n) => {
    const tile = tiles[n];
    if (!tile) return;
    if (tile.dataset.state !== s.state)
      say(`subsystems/${s.id}`, 'state', s.state, tile.dataset.state);
    const name = `${s.name}, ${worstOf(status, s).word}, ${s.detail}`;
    if (tile.getAttribute('aria-label') !== name)
      say(`subsystems/${s.id}`, 'word and counts', name, tile.getAttribute('aria-label'));
  });

  // Each entity's state and word.
  for (const e of status.entities) {
    const row = container.querySelector(`[data-entity="${e.id}"] [data-slot="entity-row"]`);
    if (row.dataset.state !== e.state) say(e.id, 'state', e.state, row.dataset.state);
    if (row.getAttribute('aria-label') !== `${e.name}, ${e.word}`)
      say(e.id, 'word', `${e.name}, ${e.word}`, row.getAttribute('aria-label'));
    if (described(row, doc)[0] !== e.reason) say(e.id, 'reason', e.reason, described(row, doc)[0]);
  }

  // Each node reading's meter: its state, and the number and line the model's reason says.
  for (const e of status.entities.filter((x) => x.kind === 'node' && x.conditions)) {
    const meterOf = (reading) =>
      container.querySelector(
        `[data-node="${e.id}"] [data-reading="${reading}"] [data-slot="metric-meter"]`
      );
    for (const [reading, level] of Object.entries(e.conditions)) {
      const meter = meterOf(reading);
      if (meter && meter.dataset.state !== level)
        say(`${e.id} ${reading}`, 'meter state', level, meter.dataset.state);
    }
    for (const part of e.reason.split(' · ')) {
      const m = READING_REASON.exec(part);
      if (!m) continue;
      const [, label, number, , said, how, line, unit] = m;
      const reading = LABEL_READING[label];
      const meter = meterOf(reading);
      const text = meter?.getAttribute('aria-valuetext') ?? '';
      const raw = Number(meter?.parentElement.dataset.raw);
      const subject = `${e.id} ${reading}`;
      if (meter?.dataset.state !== SAID[said])
        say(subject, 'meter state', SAID[said], meter?.dataset.state);
      if (!text.includes(said)) say(subject, 'meter word', said, text);
      const printed = /^-?[\d.]+/.exec(text)?.[0];
      if (printed !== number) say(subject, 'number', number, printed, { raw });
      if (how === 'above' && !text.includes(`above ${line}${unit}`))
        say(subject, 'line', `${said} above ${line}${unit}`, text);
    }
  }
  return findings;
}

/** One finding as a line of a failure message. */
const describeFinding = (f) =>
  `${f.subject}: ${f.what}: the model says "${f.model}", the screen "${f.screen}"`;

// ── Known divergences ────────────────────────────────────────────────────

/**
 * The disagreements the suite knows about, each named, with the issue that
 * settles it and the fixtures it shows in. Each one covers only its own
 * findings, only there, and must still happen there.
 */
const KNOWN = [
  {
    name: 'a meter rounds the reading the model floors',
    issue: '#450',
    why:
      'The model shows a reading rounded down, so it never reads as over a ' +
      'line it is under (status/rules.js wholePct): a 94.6 % disk is "Disk 94 %" on the screen\'s rows ' +
      'and in the push. MetricMeter prints Math.round of the value it is given, "95%", next to a 95 % ' +
      'crit line it is under.',
    at: ['thresholds'],
    covers: (f) =>
      f.what === 'number' &&
      Number(f.screen) === Math.round(f.raw) &&
      Number(f.model) === Math.floor(f.raw),
  },
];

describe('cross-client, screen', () => {
  for (const name of STATUS_SCENARIOS) {
    it(`${name}: the screen says what the model says`, () => {
      const findings = disagreements(runScenario(name, { now: NOW }));
      const here = KNOWN.filter((k) => k.at.includes(name));
      const unexplained = findings.filter((f) => !here.some((k) => k.covers(f)));
      expect(unexplained.map(describeFinding), 'disagreements no named exception covers').toEqual(
        []
      );
      for (const k of here) {
        expect(
          findings.some((f) => k.covers(f)),
          `known divergence "${k.name}" (${k.issue}) no longer happens in ${name}: delete it from KNOWN`
        ).toBe(true);
      }
    });
  }

  it('a reading with no value this cycle: the meter shows none, and the row says its level is held (#462)', () => {
    // The hottest sensor at 78 °C, then a cycle it doesn't answer.
    const board = (temp) => inputs({ nodes: { n1: node({ temp }) } });
    const [, status] = cycles([board('78.0'), board(null)]);
    const services = board(null).services;
    const cycle = {
      caches: { getCached: (k) => (k === 'services' ? services : null) },
      thresholds: DEFAULT_THRESHOLDS,
    };
    expect(disagreements({ status, cycle }).map(describeFinding)).toEqual([]);
    const n1 = status.entities.find((e) => e.id === 'nodes/n1');
    expect([n1.state, n1.reason]).toEqual([
      'warn',
      'Temperature: no reading (warning held until below 70 °C)',
    ]);
    const meter = document.querySelector(
      '[data-node="nodes/n1"] [data-reading="temp"] [data-slot="metric-meter"]'
    );
    expect(meter.dataset.state).toBe('unknown');
    expect(meter.textContent).toContain('No data');
    expect(meter.textContent).not.toMatch(/\d+\s*°C/);
  });

  it("the headline says the model's word for every state the board can be in", () => {
    // The fixtures reach crit, warn and unknown; this covers maintenance too.
    for (const state of STATES.filter((s) => s !== 'ok')) {
      const { container, unmount } = render(
        <AttentionPanel
          state={state}
          issues={[{ id: 'x', state, word: MODEL_WORD[state], title: 'x' }]}
        />
      );
      expect(container.querySelector('h1 [data-slot="status-word"]').textContent, state).toBe(
        MODEL_WORD[state]
      );
      unmount();
    }
  });
});
