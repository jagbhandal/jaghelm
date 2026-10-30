/*
 * The line charts' shared geometry (#311): what the Chart (chart.jsx, the
 * drawer's history) and its sparkline variant (sparkline.jsx, a node card's
 * hour of CPU) both draw from, so a gap, a point and a line mean the same in
 * each. Pure: no React, no DOM.
 */

/** A reading: a finite number. Anything else is a gap. */
export const isReading = (v) => typeof v === 'number' && Number.isFinite(v);

/** Rounded to hundredths, so an SVG path stays short and stable. */
export const round2 = (n) => Math.round(n * 100) / 100;

/**
 * `points` as `{ time, value }`: numbers, or `{ time, value }` (time in ms or
 * a Date); a missing or non-numeric value as null, a gap.
 */
export function normalise(points) {
  return (points ?? []).map((p) =>
    p != null && typeof p === 'object' && !(p instanceof Date)
      ? { time: p.time ?? null, value: isReading(p.value) ? p.value : null }
      : { time: null, value: isReading(p) ? p : null }
  );
}

/**
 * The path of a line through `xy` (`{ x, y }`, y null for a gap): one run
 * per stretch of readings between the gaps, a run of one point drawing
 * nothing, so a missing reading breaks the line and is never bridged.
 * Returns `{ line, runs }`: the `d` of the line, and the runs it drew.
 */
export function linePath(xy) {
  const runs = [];
  let run = [];
  for (const p of xy) {
    if (p.y == null) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push(p);
  }
  if (run.length) runs.push(run);
  const drawn = runs.filter((r) => r.length > 1);
  const line = drawn.map((r) => r.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('')).join('');
  return { line, runs: drawn };
}

/**
 * The shaded band between a line and the ceiling over it (#746: the max band
 * behind an average line). `top` and `bottom` are `{ x, y }` per time (y null
 * for a gap in either), `top` the higher on the page (a smaller y; one that
 * sits lower is lifted onto the line, so a band never twists). One closed
 * shape per stretch of readings between the gaps, a stretch of one point
 * drawing nothing, as `linePath` does. Returns the `d` ('' for none).
 */
export function bandPath(top, bottom) {
  const runs = [];
  let run = [];
  top.forEach((t, i) => {
    const b = bottom[i];
    if (t.y == null || b?.y == null) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push({ x: t.x, hi: Math.min(t.y, b.y), lo: b.y });
  });
  if (run.length) runs.push(run);
  return runs
    .filter((r) => r.length > 1)
    .map((r) => {
      const out = r.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.hi}`).join('');
      const back = [...r]
        .reverse()
        .map((p) => `L${p.x} ${p.lo}`)
        .join('');
      return `${out}${back}Z`;
    })
    .join('');
}

/**
 * Where a reference line is crossed (#746): the stretches of consecutive
 * indices where `breached(i)` holds, as `[{ from, to }]` (inclusive). A
 * single breached reading is a stretch of one.
 */
export function breachRuns(count, breached) {
  const runs = [];
  let from = null;
  for (let i = 0; i < count; i += 1) {
    if (breached(i)) from ??= i;
    else if (from != null) {
      runs.push({ from, to: i - 1 });
      from = null;
    }
  }
  if (from != null) runs.push({ from, to: count - 1 });
  return runs;
}

/**
 * The closed shape under (or over) each of `runs` (linePath's runs of
 * `{ x, y }`), down or up to the height `base`: one `M..L..Z` per run, so a
 * gap in the readings leaves a gap in the area, never a bridge or a drop to
 * zero (#747). Returns the `d` of the area.
 */
export function areaPath(runs, base) {
  return runs
    .map(
      (r) =>
        `${r.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('')}L${r.at(-1).x} ${base}L${r[0].x} ${base}Z`
    )
    .join('');
}

/** The index of the entry of `xs` nearest `x` (0 for none). */
export function nearestIndex(xs, x) {
  let nearest = 0;
  xs.forEach((px, i) => {
    if (Math.abs(px - x) < Math.abs(xs[nearest] - x)) nearest = i;
  });
  return nearest;
}

/**
 * A step of 1, 2 or 5 times a power of ten, at least `raw`: never 2.5, whose
 * ticks (42.5 °C) a reading printed rounded down would misname.
 */
function niceStep(raw) {
  const power = 10 ** Math.floor(Math.log10(raw));
  const f = raw / power;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * power;
}

/** The axis from `min` to `max` at `step`: whole steps either side, and its ticks. */
function axisAt(min, max, step) {
  const from = Math.floor(min / step) * step;
  const to = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = from; v <= to + step / 2; v += step) ticks.push(round2(v));
  return { lo: from, hi: to, ticks };
}

/** Whether no two of `labels` are the same. */
const distinct = (labels) => new Set(labels).size === labels.length;

/**
 * A value axis for readings from `lo` to `hi`: `{ lo, hi, ticks }`, the
 * domain widened to whole steps (about `count` intervals) and its ticks.
 * `zero` starts it at 0 (a magnitude: memory, the CPU of containers); else it
 * fits the readings (a temperature). A flat line gets a step either side,
 * never under 0 for readings of 0 or more.
 *
 * `format` (#602), how the chart prints a value: the step moves up to the
 * next nice one (1, 2, 5 times a power of ten) until no two ticks print the
 * same, so a formatter coarser than the step (whole °C rounded down, one
 * decimal of a percent, whole MB) never labels an axis "47, 47, 48, 48 °C".
 * The labels stay the formatter's own, never rounded up to tell them apart.
 */
export function valueAxis(lo, hi, { zero = false, count = 3, format } = {}) {
  let min = zero ? Math.min(0, lo) : lo;
  let max = hi;
  if (!(max > min)) {
    const pad = Math.abs(max) > 0 ? Math.abs(max) * 0.1 : 1;
    max += pad;
    // Readings of 0 or more never get an axis under 0, which no reading prints (#602).
    if (!zero) min = lo >= 0 ? Math.max(0, min - pad) : min - pad;
  }
  let step = niceStep((max - min) / count);
  let axis = axisAt(min, max, step);
  // Each try is one nice step coarser; twelve reach from hundredths to millions.
  for (let tries = 0; format && tries < 12 && !distinct(axis.ticks.map(format)); tries += 1) {
    step = niceStep(step * 1.5);
    axis = axisAt(min, max, step);
  }
  return axis;
}

/**
 * A symmetric value axis for two magnitudes drawn either side of zero (a
 * network's in above, out below; #747): `{ lo, hi, ticks }` with `lo` the
 * negative of `hi` and the ticks the same either side of 0, from 0 up to
 * `max`. `format` prints a tick's magnitude, as valueAxis takes it, so no
 * two ticks of a side print the same.
 */
export function mirroredAxis(max, { count = 2, format } = {}) {
  const { hi, ticks } = valueAxis(0, max, { zero: true, count, format });
  const up = ticks.filter((t) => t > 0);
  return { lo: -hi, hi, ticks: [...up.map((t) => -t).reverse(), 0, ...up] };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Time ticks across `[from, to]` (ms), in local time: every `every` ms on
 * the local clock's whole minutes and hours (15 minutes, 6 hours), or each
 * local midnight with `every` a day.
 */
export function timeTicks(from, to, every) {
  const ticks = [];
  const t = new Date(from);
  if (every >= 24 * HOUR) {
    t.setHours(0, 0, 0, 0);
    if (t.getTime() < from) t.setDate(t.getDate() + 1);
    for (; t.getTime() <= to; t.setDate(t.getDate() + 1)) ticks.push(t.getTime());
    return ticks;
  }
  if (every >= HOUR) {
    const hours = every / HOUR;
    t.setMinutes(0, 0, 0);
    if (t.getTime() < from) t.setHours(t.getHours() + 1);
    t.setHours(Math.ceil(t.getHours() / hours) * hours);
  } else {
    const minutes = every / MINUTE;
    t.setSeconds(0, 0);
    if (t.getTime() < from) t.setMinutes(t.getMinutes() + 1);
    t.setMinutes(Math.ceil(t.getMinutes() / minutes) * minutes);
  }
  for (let at = t.getTime(); at <= to; at += every) if (at >= from) ticks.push(at);
  return ticks;
}

const DAY = 24 * HOUR;

/** A tick's place on the local clock, counted in `every` from a fixed day: the same for every chart. */
function clockIndex(t, every) {
  const d = new Date(t);
  const day = Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
  if (every >= DAY) return Math.round(day / (every / DAY));
  const minutes = d.getHours() * 60 + d.getMinutes();
  return day * (DAY / every) + Math.floor(minutes / (every / MINUTE));
}

/**
 * The time ticks a plot `width` px wide labels: every `stride`-th of
 * `ticks` (timeTicks' every `every` ms over `span` ms), the smallest stride
 * whose labels clear each other by `gap` px, counted on the local clock (so
 * every other day is the same days, every half hour the hour and the half),
 * each label centred on its tick and left out where it would run past
 * either end of the plot. Two charts of the same range and width get the
 * same ticks, evenly spaced. Widths are estimated at `charPx` a character
 * (12px figures and short words). Returns `[{ t, x, text }]`.
 */
export function evenTicks(ticks, { width, every, span, labelOf, charPx = 7, gap = 12 }) {
  if (!ticks.length || !(width > 0) || !(span > 0)) return [];
  const labelled = ticks.map(({ t, x }) => ({ t, x, text: labelOf(t) }));
  const widest = Math.max(...labelled.map((l) => l.text.length)) * charPx;
  const perTick = (width * every) / span;
  const stride = Math.max(1, Math.ceil((widest + gap) / perTick));
  return labelled.filter(({ t, x, text }) => {
    const half = (text.length * charPx) / 2;
    return clockIndex(t, every) % stride === 0 && x - half >= 0 && x + half <= width;
  });
}

/**
 * Labels at the right end of a chart's lines (`{ key, y }`, y their last
 * reading's height), moved apart so none overlaps the next by less than
 * `gap` px, inside `[top, bottom]`. Returns each label's `y` by key; a label
 * moved off its line's end gets a leader to it (the Chart draws that).
 */
export function spreadLabels(labels, { gap, top, bottom }) {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  const ys = sorted.map((l) => Math.min(Math.max(l.y, top), bottom));
  for (let i = 1; i < ys.length; i += 1) ys[i] = Math.max(ys[i], ys[i - 1] + gap);
  // Pushed past the bottom: walk back up.
  if (ys.length && ys.at(-1) > bottom) {
    ys[ys.length - 1] = bottom;
    for (let i = ys.length - 2; i >= 0; i -= 1) ys[i] = Math.min(ys[i], ys[i + 1] - gap);
  }
  return Object.fromEntries(sorted.map((l, i) => [l.key, round2(ys[i])]));
}
