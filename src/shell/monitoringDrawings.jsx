/**
 * How each chart of GET /api/monitoring (server/monitoring.js) is drawn on the
 * Monitoring page (#751, #753): `DRAWINGS`, one entry per chart id.
 *
 * THE SHAPE (keep it small; later cards add entries against it):
 *
 *   DRAWINGS[id] = { section, Body }
 *
 *   section   the id of the section the chart sits in (server/monitoringSections.js);
 *             monitoring.test.jsx holds it equal to the server table's.
 *   Body      a component, `({ chart, range, busy }) => node`: what goes inside
 *             the chart's Panel (the Panel, its title and its question are the
 *             page's, from the server's table). `chart` is the server's answer
 *             as it came, ok or not; `range` the range it is of (the switch's
 *             entry in monitoring.js: `words`, `tickEvery`, `tick`, `time`);
 *             `busy` true while the next range is read, to draw the last
 *             answer dimmed. The Body draws a failed chart (`chart.ok ===
 *             false`, `chart.error` the server's own sentence) and any other
 *             state of its own, in words, never an empty plot that looks
 *             healthy. It may use hooks (it is a component).
 *
 * `lineDrawing(section, propsOf)` builds the Body of a plain line chart
 * from `propsOf(chart)`, the Chart's series, domain and formatters. A chart
 * with more to it (bars, tiles, an event strip) writes its own Body from
 * src/ui parts, as the two power charts below do.
 */
import { useState } from 'react';
import { AreaChart } from '@ui/area-chart';
import { Chart } from '@ui/chart';
import { Select } from '@ui/select';
import { DailyBars } from '@ui/daily-bars';
import { EventStrip } from '@ui/event-strip';
import { EmptyState } from '@ui/empty-state';
import { RankedBars } from '@ui/ranked-bars';
import { ChartBody, ChartLink, ChartNote } from '@ui/chart-body';
import { StatTile, StatTiles } from '@ui/stat-tile';
import { settingsHref } from '../components/settings/sections.js';
import { followLink } from '../router/useRoute.js';
import { shownReading } from '../../server/status/readings.js';
import { dateTimeFormat } from '../util/format.js';
import { DiskRunwayBody } from './DiskRunwayBody.jsx';
import { pointsOf } from './historyLines.js';
import { MAX_SERIES } from '../ui/chart.jsx';

/** The Chart's range props: its label, state and axes, from the range the answer is of. */
function chartFrame(chart, range, busy) {
  const ok = chart.ok === true;
  return {
    label: `${chart.title}, ${range.words}`,
    state: ok ? 'ready' : 'failed',
    failedText: ok ? undefined : chart.error,
    busy,
    tickEvery: range.tickEvery,
    formatTick: range.tick,
    formatTime: range.time,
  };
}

/** A Body for a plain line chart: `propsOf(chart)` is the Chart's series, domain and formatters. */
function lineDrawing(section, propsOf) {
  function Body({ chart, range, busy }) {
    return <Chart {...chartFrame(chart, range, busy)} {...(chart.ok === true ? propsOf(chart) : {})} />;
  }
  return Object.freeze({ section, Body });
}

/**
 * A line chart of one line per node, by the node's key, in the order the
 * server gave them (services.yaml's), one chart slot each. More than the
 * chart's six are said in a note, not drawn.
 */
export function perNodeLines(chart, format, domain) {
  const lines = (Array.isArray(chart.lines) ? chart.lines : []).filter(
    (l) => typeof l?.entity === 'string'
  );
  const drawn = lines.slice(0, MAX_SERIES);
  return {
    series: drawn.map((l) => ({
      key: l.entity,
      name: l.entity,
      points: pointsOf(chart, l.entity),
    })),
    domain,
    formatValue: format,
    legendNote:
      lines.length > drawn.length ? `+${lines.length - drawn.length} more nodes, not drawn` : null,
  };
}

// ── Power and cost (#753) ────────────────────────────────────────────────

/** Said under both power charts (spec §5): what the figure covers, and that it is not metered. */
export const POWER_FOOTNOTE =
  'Covers only what is plugged into the UPS. It is the UPS’s load percentage times its nominal watts, not a metered reading.';

const NO_UPS_WORDS =
  'No UPS is set up, or its exporter reported nothing in this range. Power and cost need a UPS.';

const toPoints = (chart, values) =>
  values.map((value, i) => ({ time: chart.startMs + i * chart.stepMs, value }));

const watts = (v) => `${Math.round(v)} W`;

/** "41 min", "1 h 5 min": a runtime as the UPS panel says it. */
export function runtimeWords(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const m = minutes % 60;
  return `${Math.floor(minutes / 60)} h${m ? ` ${m} min` : ''}`;
}

function Footnote() {
  return (
    <ChartNote data-slot="power-footnote">{POWER_FOOTNOTE}</ChartNote>
  );
}

/** Chart 1: the lab's draw in watts, one line, the max band on 7 d and 30 d. */
function PowerDrawBody({ chart, range, busy }) {
  if (chart.ok === true && chart.state === 'no-ups') {
    return <EmptyState data-slot="power-no-ups" title="No UPS data" description={NO_UPS_WORDS} />;
  }
  const ok = chart.ok === true;
  const band =
    ok && Array.isArray(chart.maxValues)
      ? { name: 'Highest in each step', points: toPoints(chart, chart.maxValues) }
      : undefined;
  const stats = ok ? chart.stats : null;
  return (
    <ChartBody busy={busy}>
      {ok && (
        <StatTiles>
          {'runtimeMinutes' in chart && (
            <StatTile
              label="UPS runtime"
              value={runtimeWords(chart.runtimeMinutes)}
              note="at the current load"
            />
          )}
          <StatTile
            label="Average draw"
            value={stats ? watts(stats.avgWatts) : null}
            note={range.words}
          />
        </StatTiles>
      )}
      <Chart
        {...chartFrame(chart, range, busy)}
        {...(ok
          ? {
              series: [{ key: 'watts', name: 'Power draw', points: toPoints(chart, chart.values) }],
              band,
              domain: 'auto',
              formatValue: watts,
            }
          : {})}
      />
      {stats && (
        <ChartNote data-slot="power-stats">
          {`Lowest ${chart.maxValues ? 'average ' : ''}${watts(stats.minWatts)}, highest ${watts(stats.maxWatts)} ${range.words}.`}
        </ChartNote>
      )}
      {ok && <Footnote />}
    </ChartBody>
  );
}

const DAY_SHORT = { weekday: 'short', day: 'numeric', timeZone: 'UTC' };
const DAY_LONG = { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' };
const dayTick = (t) => dateTimeFormat(DAY_SHORT).format(new Date(t));
const dayLong = (t) => dateTimeFormat(DAY_LONG).format(new Date(t));

/** `$` and 2 decimals: "$0.29". The symbol is the user's, up to 3 characters. */
export const moneyOf = (currency, v) => `${currency}${v.toFixed(2)}`;
/** A rate per kWh as set: "$0.10/kWh", "$0.1425/kWh": two decimals at least, four at most. */
export const rateWords = (currency, rate) => {
  const four = rate.toFixed(4);
  return `${currency}${four.endsWith('00') ? rate.toFixed(2) : four.replace(/0$/, '')}/kWh`;
};
const kwhWords = (v) => `${v.toFixed(1)} kWh`;

/** "2nd", "23rd": the day of a YYYY-MM-DD as the tile says it ("since the 2nd"). */
export function ordinalDay(day) {
  const n = Number(String(day).slice(8, 10));
  const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
  return `${n}${tail}`;
}

/** The bars' days: local midnight as UTC (the labels are the server's calendar, not the browser's zone), the day's money, a hover note. */
export function costDays(chart) {
  const c = chart.currency;
  return chart.days.map((d) => {
    const parts = [];
    if (d.ratePerKwh != null) parts.push(`Rate ${rateWords(c, d.ratePerKwh)}`);
    if (d.kWh != null) parts.push(kwhWords(d.kWh));
    if (d.kWh != null && d.coverage < 0.99) {
      parts.push(`${Math.round(d.coverage * 100)} % of the hours read`);
    }
    const [y, m, day] = d.day.split('-').map(Number);
    return {
      key: d.day,
      time: Date.UTC(y, m - 1, day),
      value: d.cost,
      note: parts.join(', '),
    };
  });
}

/** Chart 2: what the lab costs per day, with the month's two figures as tiles. */
function MonthlyCostBody({ chart, busy }) {
  if (chart.ok !== true) {
    return (
      <DailyBars
        label="Monthly cost, per day"
        state="failed"
        failedText={chart.error}
        height={96}
      />
    );
  }
  if (chart.state === 'no-ups') {
    return <EmptyState data-slot="cost-no-ups" title="No UPS data" description={NO_UPS_WORDS} />;
  }
  const { month } = chart;
  const c = chart.currency;
  const money = c != null && chart.currentRatePerKwh != null;
  const last = chart.days.at(-1);
  const projected = month.projected;
  const mtd = money ? month.cost : month.kWh;
  const show = (v) => (v == null ? null : money ? moneyOf(c, v) : kwhWords(v));
  return (
    <ChartBody busy={busy}>
      <StatTiles>
        <StatTile
          label="Month to date"
          value={show(mtd)}
          note={month.since ? `since the ${ordinalDay(month.since)}` : 'so far'}
        />
        <StatTile
          label="Projected month"
          value={show(money ? projected?.cost : projected?.kWh)}
          emptyText="Not enough days yet"
          note={
            projected
              ? `${money ? `at ${rateWords(c, chart.currentRatePerKwh)}, ` : ''}from the last ${projected.basisDays} days`
              : undefined
          }
        />
      </StatTiles>
      {money ? (
        <DailyBars
          label="Monthly cost, per day"
          days={costDays(chart)}
          partial={last?.partial === true}
          formatValue={(v) => moneyOf(c, v)}
          formatTick={dayTick}
          formatDay={dayLong}
          height={96}
        />
      ) : (
        <EmptyState
          data-slot="cost-no-rate"
          title="No electricity rate set"
          description="Costs show in money once you add your price per kWh. Until then the tiles show kWh."
          action={
            <ChartLink
              href={settingsHref('system', 'energy-cost')}
              onClick={(e) => followLink(e, settingsHref('system', 'energy-cost'))}
            >
              Settings → System → Energy cost
            </ChartLink>
          }
        />
      )}
      <Footnote />
    </ChartBody>
  );
}

// ── Network (#758) ───────────────────────────────────────────────────────

/** A traffic rate in bytes per second: "640 B/s", "12.4 KB/s", "1.1 MB/s", "2.3 GB/s" (1024 steps, as the container facts say it). */
export function bytesPerSecond(v) {
  if (!Number.isFinite(v)) return '';
  if (Math.round(v) < 1024) return `${Math.round(v)} B/s`;
  const units = ['KB/s', 'MB/s', 'GB/s'];
  let n = v / 1024;
  let i = 0;
  // 1023.7 KB is "1.0 MB", not "1024 KB".
  while (Math.round(n) >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/**
 * Chart 9: one node's traffic as a mirrored area, in above the zero line and
 * out below it. One node at a time, chosen from a list that starts on the
 * first (services.yaml's order); a node that is no longer in the answer falls
 * back to the first. No node with a reading is said in words, never an empty plot.
 */
function NetworkBody({ chart, range, busy }) {
  const [picked, setPicked] = useState(null);
  const nodes = chart.ok === true && Array.isArray(chart.nodes) ? chart.nodes : [];
  if (chart.ok === true && nodes.length === 0) {
    return (
      <EmptyState
        data-slot="network-empty"
        title="No network readings"
        description="Prometheus has no traffic readings for any node in this range."
      />
    );
  }
  const node = nodes.find((n) => n.entity === picked) ?? nodes[0];
  const ok = chart.ok === true;
  return (
    <ChartBody busy={busy}>
      {nodes.length > 1 && (
        <Select
          aria-label="Node"
          items={nodes.map((n) => ({ value: n.entity, label: n.entity }))}
          value={node.entity}
          onValueChange={setPicked}
        />
      )}
      <AreaChart
        {...chartFrame(chart, range, busy)}
        label={`${chart.title}${node ? `, ${node.entity}` : ''}, ${range.words}`}
        {...(ok
          ? {
              mirrored: true,
              series: [
                { key: 'rx', name: 'In', points: toPoints(chart, node.rx) },
                { key: 'tx', name: 'Out', points: toPoints(chart, node.tx) },
              ],
              formatValue: bytesPerSecond,
            }
          : {})}
      />
      {ok && <ChartNote data-slot="network-note">In is above the line, out below it. Real network interfaces only.</ChartNote>}
    </ChartBody>
  );
}

// ── Restarts and OOM kills (#761) ────────────────────────────────────────

/** Rows the strip draws at most; the containers with the most events first, the rest said in a note. */
export const MAX_STRIP_ROWS = 12;

/** "1 minute", "5 minutes", "30 minutes", "2 hours": a step as the chart's note says it. */
export function stepWords(stepMs) {
  const minutes = Math.round(stepMs / 60_000);
  if (minutes >= 60 && minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  }
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/**
 * The strip's rows from the server's flat events: one row per container
 * (named with its node only when two nodes run the same name), the busiest
 * MAX_STRIP_ROWS containers, in name order. Also how many containers were left out.
 */
export function stripRows(events) {
  const byContainer = new Map();
  for (const e of events) {
    const key = `${e.node}/${e.name}`;
    const row = byContainer.get(key) ?? { key, name: e.name, node: e.node, events: [] };
    row.events.push({
      key: `${e.time}:${e.kind}`,
      time: e.time,
      kind: e.kind,
      detail:
        e.kind === 'oom'
          ? `${e.count > 1 ? `${e.count} OOM kills` : 'OOM kill'} on ${e.node}`
          : `${e.how ?? 'restarted'} on ${e.node}`,
    });
    byContainer.set(key, row);
  }
  const all = [...byContainer.values()];
  const shared = new Set(all.filter((r, i) => all.findIndex((o) => o.name === r.name) !== i).map((r) => r.name));
  const kept = [...all]
    .sort((a, b) => b.events.length - a.events.length || a.key.localeCompare(b.key))
    .slice(0, MAX_STRIP_ROWS)
    .sort((a, b) => a.name.localeCompare(b.name) || a.node.localeCompare(b.node))
    .map((r) => ({ ...r, name: shared.has(r.name) ? `${r.name} (${r.node})` : r.name }));
  return { rows: kept, left: all.length - kept.length };
}

/** Chart 7: what restarted or was OOM-killed, as an event strip with the limits of the source said under it. */
function RestartsBody({ chart, range, busy }) {
  const label = `${chart.title}, ${range.words}`;
  if (chart.ok !== true) {
    return <EventStrip label={label} state="failed" failedText={chart.error} />;
  }
  if (chart.state === 'no-containers') {
    return (
      <EmptyState
        data-slot="restarts-no-containers"
        title="No container readings"
        description="cAdvisor reported no containers in this range, so whether anything restarted is unknown. This is not a quiet spell."
      />
    );
  }
  const { rows, left } = stripRows(chart.events ?? []);
  const blind = Array.isArray(chart.blindNodes) ? chart.blindNodes : [];
  const notes = [];
  if (blind.length) {
    notes.push(`No container readings from ${blind.join(', ')} in this range, so restarts there are not shown.`);
  }
  if (chart.oomCounter === false) {
    notes.push('cAdvisor exports no OOM counter here, so OOM kills are not shown.');
  }
  if (left > 0) notes.push(`${left} more ${left === 1 ? 'container' : 'containers'} had events, not drawn.`);
  if (chart.truncated) notes.push('So many events that only the latest are drawn.');
  return (
    <ChartBody busy={busy}>
      <EventStrip
        label={label}
        rows={rows}
        from={chart.startMs}
        to={chart.endMs}
        tickEvery={range.tickEvery}
        formatTick={range.tick}
        formatTime={range.time}
        emptyText={`No restarts or OOM kills seen in the ${range.words}`}
      />
      {notes.map((text) => (
        <ChartNote key={text} data-slot="restarts-note">
          {text}
        </ChartNote>
      ))}
      <ChartNote data-slot="restarts-limit">
        {`Read from cAdvisor through Prometheus, to the nearest ${stepWords(chart.stepMs)}. A container recreated or one whose CPU counter starts over shows as a restart; a plain docker restart is not always visible.`}
      </ChartNote>
    </ChartBody>
  );
}

// ── Container memory growers (#760) ──────────────────────────────────────

/** "+1.0 GB", "+240 MB": growth in bytes, decimal units as the rest of the app says sizes. */
export function growthWords(bytes) {
  if (!Number.isFinite(bytes)) return null;
  const abs = Math.abs(bytes);
  const [n, unit] = abs >= 1e9 ? [abs / 1e9, 'GB'] : abs >= 1e6 ? [abs / 1e6, 'MB'] : [abs / 1e3, 'kB'];
  return `${bytes < 0 ? '−' : '+'}${n >= 100 ? Math.round(n) : n.toFixed(1)} ${unit}`;
}

/** Why the chart has nothing to rank, by the state the server answered (spec §10: said, never an empty list). */
export const GROWERS_UNAVAILABLE = Object.freeze({
  'no-rule':
    'Not available: Prometheus has container memory but no series from the recording rule homelab:container_mem_growth_7d_bytes. The rule is missing from its config, or was added less than a day ago.',
  'no-cadvisor':
    'Not available: Prometheus has no container memory series (cAdvisor) and no series from the recording rule homelab:container_mem_growth_7d_bytes.',
});

/** The ranked rows: biggest growth first as the server sent them; a trend where the server had one. */
export function growerRows(chart) {
  return chart.rows.map((r) => ({
    key: r.key,
    name: `${r.name} (${r.node})`,
    value: r.growthBytes,
    valueText: growthWords(r.growthBytes),
    points: Array.isArray(r.trend)
      ? r.trend.map((value, i) => ({ time: chart.trendStartMs + i * chart.trendStepMs, value }))
      : undefined,
    formatPoint: (v) => `${Math.round(v / 1e6)} MB`,
  }));
}

/** Chart 6: the ten containers whose memory grew most in 7 days, a week of working set beside each. */
function MemoryGrowersBody({ chart, busy }) {
  if (chart.ok !== true) {
    return (
      <RankedBars label="Container memory growth, 7 days" state="failed" failedText={chart.error} />
    );
  }
  if (chart.state !== 'ok') {
    return (
      <EmptyState
        data-slot="growers-unavailable"
        title="Not available"
        description={GROWERS_UNAVAILABLE[chart.state] ?? GROWERS_UNAVAILABLE['no-rule']}
      />
    );
  }
  return (
    <ChartBody busy={busy}>
      <RankedBars
        label="Container memory growth, 7 days"
        rows={growerRows(chart)}
        formatValue={growthWords}
        emptyText="No container grew over the last 7 days"
      />
      <ChartNote data-slot="growers-note">
        Working set now against 7 days ago, the last 7 days whatever the range above. Containers with no reading 7 days ago are not ranked.
      </ChartNote>
    </ChartBody>
  );
}

/**
 * Each chart the page can draw: see the shape at the top of this file.
 */
export const DRAWINGS = Object.freeze({
  'cpu-overview': lineDrawing('resources', (chart) =>
    perNodeLines(chart, (v) => `${shownReading(v)} %`, [0, 100])
  ),
  'power-draw': Object.freeze({ section: 'power-cost', Body: PowerDrawBody }),
  'monthly-cost': Object.freeze({ section: 'power-cost', Body: MonthlyCostBody }),
  network: Object.freeze({ section: 'resources', Body: NetworkBody }),
  'disk-runway': Object.freeze({ section: 'capacity', Body: DiskRunwayBody }),
  restarts: Object.freeze({ section: 'containers', Body: RestartsBody }),
  // Added by #760 (E1).
  'container-growth': Object.freeze({ section: 'resources', Body: MemoryGrowersBody }),
});
