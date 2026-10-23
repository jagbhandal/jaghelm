/*
 * The Infrastructure section's nodes (#299), from the model and the board's
 * readings: every expectation is read from /api/status as the server's own
 * model builds it (the demo's boards, the cross-client fixtures), never from
 * numbers written here by hand.
 */
import { describe, it, expect } from 'vitest';
import {
  infrastructureCount,
  infrastructureNodes,
  READINGS,
  servicesText,
} from './infrastructureView.js';
import { entityAnchor } from './entityAnchors.js';
import { demoBoard, nasDiskIncident } from '../testing/statusFixtures.js';
import { cycles, inputs, node } from '../../server/testing/statusFixtures.js';
import { runScenario } from '../../server/testing/statusScenarios.js';
import { readingLines, shownReading } from '../../server/status/readings.js';
import { resolveThresholds } from '../../server/status/thresholds.js';

const NOW = Date.parse('2026-10-20T09:00:00Z');

/** A scenario as a client gets it: the status, and the /api/services it was built from. */
function scenario(name) {
  const { status, cycle } = runScenario(name, { now: NOW });
  return JSON.parse(JSON.stringify({ status, services: cycle.caches.getCached('services') }));
}

const reading = (n, key) => n.readings.find((r) => r.key === key);
const nodeEntities = (status) => status.entities.filter((e) => e.kind === 'node');

describe('the Infrastructure section, from the model', () => {
  it("healthy: a node per node entity, in services.yaml's order, each the model's state and word", () => {
    const { status, services, history } = demoBoard({ scenario: 'healthy', now: NOW });
    const nodes = infrastructureNodes({ status, services, history });
    expect(nodes.map((n) => n.key)).toEqual(Object.keys(services.nodes));
    for (const n of nodes) {
      const e = status.entities.find((x) => x.id === n.id);
      expect(n).toMatchObject({
        id: e.id,
        anchor: entityAnchor(e.id),
        name: e.name,
        host: e.node,
        subtitle: services.nodes[e.node].subtitle,
        colour: services.nodes[e.node].border_color,
        state: e.state,
        word: e.word,
      });
      // Healthy says nothing more than its lamp.
      expect(n.reason).toBeNull();
    }
    expect(infrastructureCount(nodes)).toBe(`${nodes.length} nodes`);
  });

  it("each reading: its value from /api/services, its state the model's condition, its lines the served ones", () => {
    const { status, services, history } = demoBoard({ scenario: 'healthy', now: NOW });
    for (const n of infrastructureNodes({ status, services, history })) {
      const e = status.entities.find((x) => x.id === n.id);
      const metrics = services.nodes[n.key].metrics;
      for (const { key, field } of READINGS) {
        const r = reading(n, key);
        if (metrics[field] == null && e.conditions[key] == null) {
          // A node with no such sensor (a VM's temperature) has no meter for it.
          expect(r, `${n.key} ${key}`).toBeUndefined();
          continue;
        }
        const lines = readingLines(status.thresholds, key);
        expect(r, `${n.key} ${key}`).toMatchObject({
          value: Number(metrics[field]),
          state: e.conditions[key],
          ...lines,
          shown: `${shownReading(Number(metrics[field]), lines)}${key === 'temp' ? '°C' : '%'}`,
        });
      }
    }
  });

  // #495: with a stale status, no level from it is drawn as current.
  it('stale: every node and meter no signal, the words, reasons and readings kept, the count how old', () => {
    const { status, services, history } = nasDiskIncident({ now: NOW });
    const fresh = infrastructureNodes({ status, services, history });
    const freshness = { stale: true, note: 'No signal · last known 3 min ago' };
    const stale = infrastructureNodes({ status, services, history, freshness });
    expect(stale.map((n) => n.state)).toEqual(fresh.map(() => 'unknown'));
    for (const [i, n] of stale.entries()) {
      expect(n).toMatchObject({
        word: fresh[i].word,
        reason: fresh[i].reason,
        services: fresh[i].services,
        uptime: fresh[i].uptime,
      });
      for (const [j, r] of n.readings.entries()) {
        const was = fresh[i].readings[j];
        // A reading keeps its number and lines, drawn as no signal.
        expect(r).toEqual({ ...was, state: was.state == null ? null : 'unknown' });
      }
    }
    const nas = stale.find((n) => n.key === 'storage');
    expect(nas).toMatchObject({ word: 'Warning', reason: 'Disk 94 % (warning above 90 %)' });
    expect(reading(nas, 'disk')).toMatchObject({ value: 94.6, state: 'unknown', shown: '94%' });
    expect(infrastructureCount(stale, freshness)).toBe(
      '3 nodes · No signal · last known 3 min ago'
    );
    // Fresh again: the model's levels.
    const levels = (nodes) => nodes.map((n) => [n.state, ...n.readings.map((r) => r.state)]);
    expect(
      levels(infrastructureNodes({ status, services, history, freshness: { stale: false } }))
    ).toEqual(levels(fresh));
  });

  it('the incident: the NAS at 94.6 % disk is a warning, its meter warn, and it reads 94', () => {
    const { status, services, history } = nasDiskIncident({ now: NOW });
    const nas = infrastructureNodes({ status, services, history }).find((n) => n.key === 'storage');
    const e = status.entities.find((x) => x.id === 'nodes/storage');
    expect([e.state, e.word, e.reason]).toEqual([
      'warn',
      'Warning',
      'Disk 94 % (warning above 90 %)',
    ]);
    expect(nas).toMatchObject({ state: 'warn', word: 'Warning', reason: e.reason });
    expect(reading(nas, 'disk')).toMatchObject({ value: 94.6, state: 'warn', shown: '94%' });
    // The others stay as the model judged them: below their lines, ok.
    for (const key of ['cpu', 'mem', 'temp']) expect(reading(nas, key).state).toBe('ok');
    expect(infrastructureCount(infrastructureNodes({ status, services }))).toBe(
      '3 nodes · 1 warning'
    );
  });

  it("the thresholds fixture: on, over and under each line, and held in its band, as the model's conditions", () => {
    const { status, services } = scenario('thresholds');
    const nodes = infrastructureNodes({ status, services });
    const seen = new Set();
    for (const e of nodeEntities(status)) {
      const n = nodes.find((x) => x.id === e.id);
      for (const [key, level] of Object.entries(e.conditions)) {
        if (key.startsWith('pool:')) continue;
        expect(reading(n, key).state, `${e.id} ${key}`).toBe(level);
        seen.add(level);
      }
    }
    // The fixture reaches every level a reading has.
    expect([...seen].sort()).toEqual(['crit', 'ok', 'warn']);
    // Memory held at warn inside its band (87 %, line 90 %, clear 85 %): the
    // meter keeps the model's level, as the word and the reason do.
    const edge = nodes.find((n) => n.key === 'edge');
    expect(reading(edge, 'mem')).toMatchObject({ value: 87, state: 'warn', shown: '87%' });
    expect(edge.reason).toMatch(/until below 85 %/);
  });

  it("with pushThresholds moving the lines: each meter's lines are the ones /api/status serves", () => {
    const pushThresholds = { disk: 0.8, mem: 0.85 };
    const { status, services } = nasDiskIncident({ now: NOW, pushThresholds });
    expect(status.thresholds).toEqual(
      JSON.parse(JSON.stringify(resolveThresholds(pushThresholds)))
    );
    const nas = infrastructureNodes({ status, services }).find((n) => n.key === 'storage');
    expect(reading(nas, 'disk')).toMatchObject({ warn: 80, crit: 95, band: 5, state: 'warn' });
    expect(reading(nas, 'mem')).toMatchObject({ warn: 85, band: 5 });
  });

  it('a node with no signal shows that: no reading drawn as current, no trend, no uptime', () => {
    const { status } = scenario('source-down');
    // The board's last readings, still in the browser from before the failure.
    const { services, history } = demoBoard({ scenario: 'healthy', now: NOW });
    const nodes = infrastructureNodes({ status, services, history });
    // Prometheus failing keeps the nodes, unknown, with the source's reason.
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      const e = status.entities.find((x) => x.id === n.id);
      expect([n.state, n.word, n.reason]).toEqual(['unknown', 'No signal', e.reason]);
      expect(n.readings.map((r) => r.value)).toEqual(n.readings.map(() => null));
      expect(n.readings.map((r) => r.shown)).toEqual(n.readings.map(() => null));
      expect([n.trend, n.uptime]).toEqual([null, null]);
    }
  });

  it('an unreachable node: its word and reason, and no readings, even with numbers in /api/services', () => {
    const { status, services } = scenario('every-state');
    // Numbers for it in the payload, as a client may still hold from before.
    const held = demoBoard({ scenario: 'healthy', now: NOW }).services.nodes.edge.metrics;
    const board = {
      ...services,
      nodes: { ...services.nodes, edge: { ...services.nodes.edge, metrics: held } },
    };
    const edge = infrastructureNodes({ status, services: board }).find((n) => n.key === 'edge');
    const e = status.entities.find((x) => x.id === 'nodes/edge');
    expect([edge.state, edge.word, edge.reason]).toEqual(['crit', e.word, e.reason]);
    expect(held.cpu).toBeTruthy();
    expect(edge.readings.every((r) => r.value === null)).toBe(true);
    expect([edge.uptime, edge.trend]).toEqual([null, null]);
  });

  it('a reading whose query failed, or with no value this cycle, has no value; the rest stay', () => {
    // The hottest sensor at 78 °C, then a cycle it doesn't answer (#462).
    const board = (temp) => inputs({ nodes: { n1: node({ temp }) } });
    const [, status] = cycles([board('78.0'), board(null)]);
    const n1 = infrastructureNodes({ status, services: board(null).services })[0];
    expect(reading(n1, 'temp')).toMatchObject({ value: null, state: 'unknown' });
    expect(reading(n1, 'disk')).toMatchObject({ value: 50, state: 'ok' });
    expect(n1.reason).toBe('Temperature: no reading (warning held until below 70 °C)');

    // A failed disk query, with a number still in the payload.
    const failed = inputs({ nodes: { n1: node({}, { failedReads: ['disk'] }) } });
    const [one] = cycles([failed]);
    const n = infrastructureNodes({ status: one, services: failed.services })[0];
    expect(reading(n, 'disk')).toMatchObject({ value: null, state: 'unknown' });
    expect(reading(n, 'cpu').value).toBe(10);
  });

  it('a node with no temperature sensor has no temperature meter', () => {
    const board = inputs({ nodes: { vm: node({ temp: null }) } });
    const [status] = cycles([board]);
    const vm = infrastructureNodes({ status, services: board.services })[0];
    expect(vm.readings.map((r) => r.key)).toEqual(['cpu', 'mem', 'disk']);
  });

  it("the temperature is the model's °C, the number and unit its reason gives, whatever Settings' unit", () => {
    const board = (temp) => inputs({ nodes: { n1: node({ temp }) } });
    for (const [temp, level, shown, reason] of [
      ['74.6', 'ok', '74°C', 'Healthy'],
      ['75.0', 'warn', '75°C', 'Temperature 75 °C (warning above 75 °C)'],
      ['86.0', 'crit', '86°C', 'Temperature 86 °C (critical above 85 °C)'],
    ]) {
      const [status] = cycles([board(temp)]);
      // The weather's unit is Settings' (`tempUnit`); the node's stays the model's (#494).
      const n1 = infrastructureNodes({ status, services: board(temp).services, tempUnit: 'F' })[0];
      const t = reading(n1, 'temp');
      expect(t, temp).toMatchObject({ unit: '°C', state: level, warn: 75, crit: 85, band: 5 });
      expect(t.shown, temp).toBe(shown);
      expect(status.entities[0].reason, temp).toBe(reason);
      if (level !== 'ok') expect(reason.replace(' °C', '°C'), temp).toContain(shown);
    }
  });

  it('services: up and down counts of what the node hosts, from the model', () => {
    const { status, services } = demoBoard({ scenario: 'incident', now: NOW });
    const nodes = infrastructureNodes({ status, services });
    for (const n of nodes) {
      const hosted = status.entities.filter(
        (e) => (e.kind === 'service' || e.kind === 'container') && e.node === n.key
      );
      const up = hosted.filter((e) => e.state === 'ok').length;
      const down = hosted.filter((e) => e.state === 'crit').length;
      expect(n.serviceCounts, n.key).toEqual({ total: hosted.length, up, down });
      expect(n.services, n.key).toBe(servicesText({ total: hosted.length, up, down }));
    }
    // The incident's down service (Jellyfin) is on the apps node.
    const apps = nodes.find((n) => n.key === 'apps');
    expect(apps.serviceCounts.down).toBe(1);
    expect(apps.services).toBe(
      `${apps.serviceCounts.up} / ${apps.serviceCounts.total} services up · 1 down`
    );
    expect(servicesText({ total: 0, up: 0, down: 0 })).toBe('No services');
    expect(servicesText({ total: 1, up: 1, down: 0 })).toBe('1 / 1 service up');
  });

  it("the trend: the node's CPU over the last hour, printed by the rule", () => {
    const { status, services, history } = demoBoard({ scenario: 'healthy', now: NOW });
    const apps = infrastructureNodes({ status, services, history }).find((n) => n.key === 'apps');
    // Every node's hour of CPU in one answer (#311): this node's line, each point timed.
    const cpu = history.series.find((x) => x.series === 'node.cpu');
    const line = cpu.lines.find((l) => l.entity === 'apps').values;
    expect(apps.trend.points.map((p) => p.value)).toEqual(line);
    expect(apps.trend.points[0].time).toBe(cpu.startMs);
    expect(apps.trend.points.at(-1).time).toBe(cpu.startMs + (line.length - 1) * cpu.stepMs);
    expect(apps.trend.label).toBe('CPU, last hour');
    const lines = readingLines(status.thresholds, 'cpu');
    expect(apps.trend.formatValue(94.6)).toBe(`${shownReading(94.6, lines)}%`);
    expect(apps.trend.formatValue(94.6)).toBe('94%');
    expect(apps.uptime).toBe(`Up ${services.nodes.apps.metrics.uptime}`);
  });

  it('leaves out a node hidden in Settings, and draws one /api/services has yet to list', () => {
    const { status, services } = demoBoard({ scenario: 'healthy', now: NOW });
    const sections = { edge: { visible: false } };
    expect(infrastructureNodes({ status, services, sections }).map((n) => n.key)).toEqual(
      Object.keys(services.nodes).filter((k) => k !== 'edge')
    );
    const { storage, ...rest } = services.nodes;
    const fewer = infrastructureNodes({ status, services: { ...services, nodes: rest } });
    expect(fewer.map((n) => n.key)).toEqual([...Object.keys(rest), 'storage']);
    expect(fewer.at(-1).readings.every((r) => r.value === null)).toBe(true);
    expect(storage).toBeTruthy();
  });

  it('nothing before the first status, and nothing on a board with no nodes', () => {
    expect(infrastructureNodes({ status: null, services: null })).toEqual([]);
    expect(infrastructureNodes(scenario('first-run'))).toEqual([]);
  });
});
