/*
 * The cross-client status suite, screen side (#293, spec §6 "Proof", §12): the
 * same input can never give one answer on the screen and another in a push.
 *
 * Each fixture (server/testing/statusScenarios.js: healthy, incident,
 * source-down, first-run, thresholds, every-state, low-battery, config-broken) is built as
 * the live loop builds /api/status, and its status is drawn with the src/ui status components, the
 * way a screen draws the model (Board, below): the attention panel from the
 * overall state, sentence and issues; a subsystem tile per subsystem that has
 * anything, as the Overview's strip makes them (src/shell/statusView.js
 * subsystemCells); a row per entity; the Overview's Infrastructure section, a
 * card per node with a meter per reading (src/shell/infrastructureView.js
 * infrastructureNodes, InfrastructureSection). Then the screen is
 * read back and checked against the model: the headline's word and sentence
 * (or the quiet line's heading), each tile's state, word and counts, each row's state and word, and each
 * meter's state, number and line. The push side, the same fixtures through
 * the real push cycle, is server/status/crossClient.test.js (`npm run
 * test:ci`); this file runs in `npm run test:client`.
 *
 * A meter takes its lines (its threshold tick, and "warning above 90%") from
 * the status itself: /api/status serves the lines the model judged by
 * (`thresholds`, #451), and server/status/readings.js reads a reading's lines
 * out of them, in its unit, for the model and the screens alike.
 *
 * A disagreement fails the suite unless a named exception in KNOWN covers it,
 * in the fixtures it names. An exception that no longer happens fails too, so
 * deleting it is the whole change once it is settled.
 *
 * Not covered: the Android app's legacy derivation, mobile/src/data/derive.js
 * (deleted by #325 and #326); the web's, src/utils/thresholds.js, went with
 * the node cards' old readings (#299). Android's screens join this suite in
 * #325, when they render the model.
 */
import { describe, it, expect } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AttentionPanel } from './attention-panel.jsx';
import { EntityRow } from './entity-row.jsx';
import { MetricMeter, meterState } from './metric-meter.jsx';
import { SubsystemStrip } from './subsystem-strip.jsx';
import { InfrastructureSection } from './infrastructure-section.jsx';
import { STATES } from './lib/status.js';
import { subsystemCells } from '../shell/statusView.js';
import { infrastructureNodes } from '../shell/infrastructureView.js';
import { runScenario, STATUS_SCENARIOS } from '../../server/testing/statusScenarios.js';
import { cycles, inputs, node, once } from '../../server/testing/statusFixtures.js';
import { readingLines } from '../../server/status/readings.js';
import { judgeNode, judgeService } from '../../server/status/rules.js';
import { EMPTY } from '../../server/status/summary.js';
import { DEFAULT_THRESHOLDS, resolveThresholds } from '../../server/status/thresholds.js';

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

// The quiet line's heading (spec §8, #464). An empty board has nothing checked,
// so it says the model's sentence ("Nothing monitored yet"); any other quiet
// board says all is normal, and the model's sentence follows it.
const QUIET_HEADING = 'All systems normal';

// ── The screen: the model drawn with src/ui ──────────────────────────────

// Each node reading: where /api/services has its value (the model serves only
// the worst one, as `metric`). Its lines are the status's own (`thresholds`,
// #451).
const READINGS = {
  cpu: { field: 'cpu' },
  mem: { field: 'memPercent' },
  disk: { field: 'diskPercent' },
  temp: { field: 'temp' },
};

/** A node reading's meter on the screen: the Infrastructure section's card. */
const meterIn = (root, nodeId, reading) =>
  root.querySelector(
    `[data-node="${nodeId}"] [data-slot="metric-meter"][data-reading="${reading}"]`
  );

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
 * row per entity, and the Infrastructure section: each node's meters, valued
 * from /api/services and coloured by the model's `conditions`, with the lines
 * /api/status serves.
 */
function Board({ status, services }) {
  const quiet = status.issues.length === 0;
  // The Overview's own cells (#298), so the suite checks what the page draws.
  const cells = subsystemCells(status);
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
      {/* The Overview's own section (#299), so the suite checks what the page draws. */}
      <InfrastructureSection nodes={infrastructureNodes({ status, services })} />
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
// "CPU 97 % (warning above 90 % for 2 cycles)", "Disk 87.6 % (warning above
// 87.5 %)": status/rules.js levelReason.
const READING_REASON =
  /^(CPU|Memory|Disk|Temperature) ([\d.]+) (%|°C) \((warning|critical) (above|until below) ([\d.]+) (%|°C)/;

/**
 * Where the screen and the model disagree, as findings `{ subject, what,
 * model, screen }`.
 */
function disagreements({ status, cycle }) {
  const services = cycle.caches.getCached('services');
  const { container } = render(<Board status={status} services={services} />);
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
  } else {
    const heading = panel.querySelector('h1')?.textContent;
    const said = state === EMPTY ? sentence : QUIET_HEADING;
    if (heading !== said) say('headline', 'quiet line', said, heading);
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
    const meterOf = (reading) => meterIn(container, e.id, reading);
    const rawOf = (reading) =>
      Number(services?.nodes?.[e.node]?.metrics?.[READINGS[reading]?.field]);
    for (const [reading, level] of Object.entries(e.conditions)) {
      // A storage pool has no meter on the card: its reason says it.
      if (!Object.hasOwn(READINGS, reading)) continue;
      const meter = meterOf(reading);
      if (!meter) say(`${e.id} ${reading}`, 'meter', level, 'none drawn');
      else if (meter.dataset.state !== level)
        say(`${e.id} ${reading}`, 'meter state', level, meter.dataset.state);
    }
    for (const part of e.reason.split(' · ')) {
      const m = READING_REASON.exec(part);
      if (!m) continue;
      const [, label, number, readUnit, said, how, line, unit] = m;
      const reading = LABEL_READING[label];
      const meter = meterOf(reading);
      const text = meter?.getAttribute('aria-valuetext') ?? '';
      const raw = rawOf(reading);
      const subject = `${e.id} ${reading}`;
      if (meter?.dataset.state !== SAID[said])
        say(subject, 'meter state', SAID[said], meter?.dataset.state);
      if (!text.includes(said)) say(subject, 'meter word', said, text);
      // The number and its unit, as the reason writes them ("86 °C"): one
      // reading, one number, one unit, on the meter and in the reason.
      const [, printed, printedUnit] = /^(-?[\d.]+)([^\d\s,]*)/.exec(text) ?? [];
      if (printed !== number) say(subject, 'number', number, printed, { raw });
      if (printedUnit !== readUnit) say(subject, 'unit', readUnit, printedUnit, { raw });
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
const KNOWN = [];

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
    const cycle = { caches: { getCached: (k) => (k === 'services' ? services : null) } };
    expect(disagreements({ status, cycle }).map(describeFinding)).toEqual([]);
    const n1 = status.entities.find((e) => e.id === 'nodes/n1');
    expect([n1.state, n1.reason]).toEqual([
      'warn',
      'Temperature: no reading (warning held until below 70 °C)',
    ]);
    const meter = meterIn(document, 'nodes/n1', 'temp');
    expect(meter.dataset.state).toBe('unknown');
    expect(meter.textContent).toContain('No data');
    expect(meter.textContent).not.toMatch(/\d+\s*°C/);
  });

  // Readings just below, on and just above each line, with the lines in force:
  // the defaults, and display-config.json's pushThresholds moving them (#451).
  // Each is [percent, the model's level].
  const LINE_CASES = [
    {
      name: 'the defaults',
      issue: '#451',
      pushThresholds: undefined,
      disk: [
        ['89.9', 'ok'],
        ['90.0', 'warn'],
        ['90.1', 'warn'],
        ['94.4', 'warn'],
        ['95.0', 'crit'],
        ['95.1', 'crit'],
      ],
      mem: [
        ['89.9', 'ok'],
        ['90.0', 'warn'],
        ['90.1', 'warn'],
      ],
    },
    {
      // Lines with a fraction (#450): the meter and the reason show the
      // reading to the line's decimals, so 87.5 on an 87.5 % line reads 87.5.
      name: 'lines with a fraction',
      issue: '#450',
      pushThresholds: { disk: 0.875, mem: 0.9125 },
      disk: [
        ['87.4', 'ok'],
        ['87.5', 'warn'],
        ['87.6', 'warn'],
        ['94.6', 'warn'],
        ['95.0', 'crit'],
      ],
      mem: [
        ['91.2', 'ok'],
        ['91.3', 'warn'],
      ],
    },
    {
      name: "display-config's pushThresholds",
      issue: '#451',
      pushThresholds: { disk: 0.8, mem: 0.85 },
      disk: [
        ['79.9', 'ok'],
        ['80.0', 'warn'],
        ['80.1', 'warn'],
        ['94.4', 'warn'],
        ['95.0', 'crit'],
        ['95.1', 'crit'],
      ],
      mem: [
        ['84.9', 'ok'],
        ['85.0', 'warn'],
        ['85.1', 'warn'],
      ],
    },
  ];

  for (const { name, issue, pushThresholds, ...byReading } of LINE_CASES) {
    it(`meters colour from the lines /api/status serves, below, on and above each line: ${name} (${issue})`, () => {
      const thresholds = resolveThresholds(pushThresholds);
      for (const [reading, rows] of Object.entries(byReading)) {
        const { field } = READINGS[reading];
        for (const [percent, level] of rows) {
          const board = inputs({ nodes: { n1: node({ [field]: percent }) } });
          // What a client gets: the status as JSON, its lines with it.
          const served = JSON.parse(JSON.stringify(once(board, { thresholds })));
          const at = `${reading} ${percent} %, ${name}`;
          expect(served.thresholds, at).toEqual(JSON.parse(JSON.stringify(thresholds)));
          const n1 = served.entities.find((e) => e.id === 'nodes/n1');
          expect(n1.conditions[reading], at).toBe(level);
          const cycle = {
            caches: { getCached: (k) => (k === 'services' ? board.services : null) },
          };
          expect(disagreements({ status: served, cycle }).map(describeFinding), at).toEqual([]);
          // The served lines alone colour the meter as the model judged it.
          const lines = readingLines(served.thresholds, reading);
          expect(meterState(Number(percent), lines), at).toBe(level);
          const meter = meterIn(document, 'nodes/n1', reading);
          expect(meter.dataset.state, at).toBe(level);
          // Its threshold tick is the served warn line.
          expect(meter.querySelector('[data-slot="meter-threshold"]'), at).toHaveStyle({
            left: `${lines.warn}%`,
          });
          if (level !== 'ok') {
            const line = level === 'crit' ? lines.crit : lines.warn;
            expect(meter.getAttribute('aria-valuetext'), at).toContain(
              `${level === 'crit' ? 'critical' : 'warning'} above ${line}%`
            );
          }
          cleanup();
        }
      }
    });
  }

  it('94.6 % by the 95 % line reads 94 on the meter and in the reason; on and over the line, 95 (#450)', () => {
    const rows = [
      // disk, pushThresholds, the meter's text, the reason
      ['94.6', undefined, '94%', 'Disk 94 % (warning above 90 %)'],
      ['95.0', undefined, '95%', 'Disk 95 % (critical above 95 %)'],
      ['95.4', undefined, '95%', 'Disk 95 % (critical above 95 %)'],
      ['87.5', { disk: 0.875 }, '87.5%', 'Disk 87.5 % (warning above 87.5 %)'],
      ['87.6', { disk: 0.875 }, '87.6%', 'Disk 87.6 % (warning above 87.5 %)'],
    ];
    for (const [disk, pushThresholds, shown, reason] of rows) {
      const board = inputs({ nodes: { n1: node({ diskPercent: disk }) } });
      const status = JSON.parse(
        JSON.stringify(once(board, { thresholds: resolveThresholds(pushThresholds) }))
      );
      const cycle = { caches: { getCached: (k) => (k === 'services' ? board.services : null) } };
      expect(disagreements({ status, cycle }).map(describeFinding), disk).toEqual([]);
      const n1 = status.entities.find((e) => e.id === 'nodes/n1');
      expect(n1.reason, disk).toBe(reason);
      const meter = meterIn(document, 'nodes/n1', 'disk');
      expect(meter.querySelector('.font-bold').textContent, disk).toBe(shown);
      expect(meter.getAttribute('aria-valuetext').split(',')[0], disk).toBe(shown);
      cleanup();
    }
  });

  it('every one-decimal line: the meter colours a reading on it, or a hundredth either side, as the model judges it (#450)', () => {
    // display-config.json holds a line as a fraction (0.913); discovery gives
    // a reading as a percent string. The model compares them as fractions, the
    // meter as percents: both on one grid, so they agree exactly on the line.
    const wrong = [];
    for (let tenths = 1; tenths < 1000; tenths += 1) {
      const line = Number(`0.${String(tenths).padStart(3, '0')}`);
      // The set as /api/status serves it.
      const served = JSON.parse(JSON.stringify(resolveThresholds({ mem: line })));
      const lines = readingLines(served, 'mem');
      for (const delta of [-1, 0, 1]) {
        const percent = ((tenths * 10 + delta) / 100).toFixed(2);
        const model = judgeNode(node({ memPercent: percent }), {
          prometheusOk: true,
          thresholds: served,
        }).conditions.mem;
        const meter = meterState(Number(percent), lines);
        const want = delta >= 0 ? 'warn' : 'ok';
        if (model !== want || meter !== want)
          wrong.push(`${percent} % by ${lines.warn} %: model ${model}, meter ${meter}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('a temperature reads as its reason says it, number and unit, on the default path (#299)', () => {
    const { status, cycle } = runScenario('thresholds', { now: NOW });
    expect(disagreements({ status, cycle }).map(describeFinding)).toEqual([]);
    const storage = status.entities.find((e) => e.id === 'nodes/storage');
    expect(storage.reason).toContain('Temperature 86 °C (critical above 85 °C)');
    const meter = meterIn(document, 'nodes/storage', 'temp');
    expect(meter.getAttribute('aria-valuetext')).toBe('86°C, critical above 85°C');
    expect(meter).toHaveTextContent('86°C');
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
