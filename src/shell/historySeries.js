/**
 * The detail drawer's history charts (#311): GET /api/history's answer
 * (server/promHistory.js) made into the Chart's series, over 1 h, 24 h or
 * 7 d. Its lines are read by historyLines.js, which the Overview's node
 * cards (an hour of CPU) use alone, so this stays in the drawer's chunk.
 *
 *   node       "Usage": CPU, memory and disk, three lines on one 0–100 % axis
 *              (chart slots 1 to 3, the same on every node), and
 *              "Temperature" in °C on its own axis, when the node has a sensor
 *   container  "CPU" (% of one core) and "Memory" (MB, or GB from 1 GB up),
 *              each on its own axis
 *
 * One axis per chart: readings of different units never share one. Each
 * series that Prometheus didn't answer is drawn as its failure, never as an
 * empty line.
 */
import { shownReading } from '../../server/status/readings.js';
import { pointsOf, seriesIn } from './historyLines.js';
import { dateTimeFormat } from '../util/format.js';

export { pointsOf, seriesIn };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const hm = {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
};
const dayHm = {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
};
const dateHm = {
  weekday: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
};
const date = { weekday: 'short', day: 'numeric' };
// Options, not formatters: the locale is a setting (util/format.js), so the
// formatter is asked for when a tick is printed.
const fmt = (options) => (t) => dateTimeFormat(options).format(new Date(t));

/**
 * The ranges, as the drawer's switch offers them: `label` on the switch,
 * `words` in a chart's name, a time tick every `tickEvery` ms, `tick` and
 * `time` (the tooltip's) to print them, and `stepMs`, the server's step,
 * how often a newer answer can exist.
 */
export const HISTORY_RANGES = Object.freeze([
  Object.freeze({
    value: '1h',
    label: '1 h',
    words: 'last hour',
    tickEvery: 15 * MINUTE,
    tick: fmt(hm),
    time: fmt(hm),
    stepMs: MINUTE,
  }),
  Object.freeze({
    value: '24h',
    label: '24 h',
    words: 'last 24 hours',
    tickEvery: 6 * HOUR,
    tick: fmt(hm),
    time: fmt(dayHm),
    stepMs: 5 * MINUTE,
  }),
  Object.freeze({
    value: '7d',
    label: '7 d',
    words: 'last 7 days',
    tickEvery: DAY,
    tick: fmt(date),
    time: fmt(dateHm),
    stepMs: 30 * MINUTE,
  }),
]);

export const rangeOf = (value) =>
  HISTORY_RANGES.find((r) => r.value === value) ?? HISTORY_RANGES[0];

/** A short number: one decimal under 10, whole from 10 up. */
const short = (v) => String(Math.abs(v) < 10 ? Math.round(v * 10) / 10 : Math.round(v));

/** A usage percentage as the node's meters print it (rounded down, #450). */
export const percentText = (v) => `${shownReading(v)} %`;

const MiB = 1024 * 1024;

/** Each chart a kind draws: its key, title, series (in slot order) and axis. */
const CHARTS = Object.freeze({
  node: [
    {
      key: 'usage',
      title: 'Usage',
      series: [
        ['node.cpu', 'CPU'],
        ['node.memory', 'Memory'],
        ['node.disk', 'Disk'],
      ],
      domain: [0, 100],
      format: () => percentText,
    },
    {
      key: 'temperature',
      title: 'Temperature',
      series: [['node.temperature', 'Temperature']],
      domain: 'auto',
      optional: true,
      // In whole degrees, rounded down, as the node's meter prints them (#450).
      format: () => (v) => `${shownReading(v)} °C`,
    },
  ],
  container: [
    {
      key: 'cpu',
      title: 'CPU',
      series: [['container.cpu', 'CPU']],
      domain: 'zero',
      format: () => (v) => `${short(v)} %`,
    },
    {
      key: 'memory',
      title: 'Memory',
      series: [['container.memory', 'Memory']],
      domain: 'zero',
      // In MB, or GB once the highest reading reaches 1 GB (MiB and GiB, as
      // the container's facts print them).
      scale: (max) => (max >= 1024 * MiB ? 1024 * MiB : MiB),
      format: (scale) => (v) => (scale === MiB ? `${Math.round(v)} MB` : `${short(v)} GB`),
    },
  ],
});

/** The series names a kind's charts read, for one request. */
export const seriesFor = (kind) =>
  (CHARTS[kind] ?? []).flatMap((c) => c.series.map(([name]) => name));

/**
 * The charts of `target` (`{ kind, entity }`) from an answer: each `{ key,
 * title, label, series, domain, formatValue, state, detail }`, the Chart's
 * props, and `note`. `state` is 'loading' before the first answer, 'failed'
 * when every series of the chart failed (`detail`: Prometheus's error) or
 * the read itself did (`failedText` says so), else 'ready' (an empty one
 * says it has no reading; `note` names a line Prometheus didn't answer). An `optional` chart with no line
 * (a node without a sensor) is left out once answered.
 *
 * @param {{ kind: string, entity: string }} target
 * @param {any} body  /api/history's answer, or null before one
 * @param {{ range: string, error?: string | null }} options  `error`: why the read failed
 */
export function chartsOf(target, body, { range, error = null }) {
  const r = rangeOf(range);
  return (CHARTS[target?.kind] ?? []).flatMap((chart) => {
    const label = `${chart.title}, ${r.words}`;
    const base = { key: chart.key, title: chart.title, label, domain: chart.domain };
    if (!body) {
      return error
        ? [
            {
              ...base,
              series: [],
              state: 'failed',
              failedText: "Couldn't read the history",
              detail: error,
              formatValue: chart.format(MiB),
            },
          ]
        : [{ ...base, series: [], state: 'loading', formatValue: chart.format(MiB) }];
    }
    const answered = chart.series.map(([name, words]) => ({
      name,
      words,
      s: seriesIn(body, name),
    }));
    const failed = answered.filter((a) => a.s && a.s.ok === false);
    if (failed.length === answered.length) {
      return [
        {
          ...base,
          series: [],
          state: 'failed',
          detail: failed[0].s.error,
          formatValue: chart.format(MiB),
        },
      ];
    }
    const lines = answered
      .map((a) => ({ ...a, points: pointsOf(a.s, target.entity) }))
      .filter((a) => a.points);
    if (chart.optional && lines.length === 0 && failed.length === 0) return [];
    const max = Math.max(0, ...lines.flatMap((l) => l.points.map((p) => p.value ?? 0)));
    const scale = chart.scale ? chart.scale(max) : 1;
    return [
      {
        ...base,
        state: 'ready',
        // A line Prometheus didn't answer, beside ones it did.
        note: failed.length
          ? `No data from Prometheus for ${failed.map((a) => a.words).join(' and ')}`
          : null,
        formatValue: chart.format(scale),
        series: lines.map((l) => ({
          key: l.name,
          name: l.words,
          points:
            scale === 1
              ? l.points
              : l.points.map((p) => ({
                  time: p.time,
                  value: p.value == null ? null : p.value / scale,
                })),
        })),
      },
    ];
  });
}
