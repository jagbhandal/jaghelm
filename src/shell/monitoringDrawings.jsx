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
import { Chart } from '@ui/chart';
import { DailyBars } from '@ui/daily-bars';
import { EmptyState } from '@ui/empty-state';
import { ChartBody, ChartLink, ChartNote } from '@ui/chart-body';
import { StatTile, StatTiles } from '@ui/stat-tile';
import { settingsHref } from '../components/settings/sections.js';
import { followLink } from '../router/useRoute.js';
import { shownReading } from '../../server/status/readings.js';
import { dateTimeFormat } from '../util/format.js';
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
    <ChartBody>
      {ok && (
        <StatTiles>
          <StatTile
            label="UPS runtime"
            value={runtimeWords(chart.runtimeMinutes)}
            note="at the current load"
          />
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
          {`Lowest ${watts(stats.minWatts)}, highest ${watts(stats.maxWatts)} ${range.words}.`}
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
/** A rate per kWh as set: "$0.16" or "$0.1475", no padding zeros beyond 2 decimals. */
export const rateWords = (currency, rate) => `${currency}${Number(rate.toFixed(4))}/kWh`;
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
function MonthlyCostBody({ chart }) {
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
    <ChartBody>
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
              href={settingsHref('system')}
              onClick={(e) => followLink(e, settingsHref('system'))}
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

/**
 * Each chart the page can draw: see the shape at the top of this file.
 */
export const DRAWINGS = Object.freeze({
  'cpu-overview': lineDrawing('resources', (chart) =>
    perNodeLines(chart, (v) => `${shownReading(v)} %`, [0, 100])
  ),
  'power-draw': Object.freeze({ section: 'power-cost', Body: PowerDrawBody }),
  'monthly-cost': Object.freeze({ section: 'power-cost', Body: MonthlyCostBody }),
});
