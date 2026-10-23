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
 * A step of 1, 2 or 5 times a power of ten, at least `raw`: never 2.5, whose
 * ticks (42.5 °C) a reading printed rounded down would misname.
 */
function niceStep(raw) {
  const power = 10 ** Math.floor(Math.log10(raw));
  const f = raw / power;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * power;
}

/**
 * A value axis for readings from `lo` to `hi`: `{ lo, hi, ticks }`, the
 * domain widened to whole steps (about `count` intervals) and its ticks.
 * `zero` starts it at 0 (a magnitude: memory, the CPU of containers); else it
 * fits the readings (a temperature). A flat line gets a step either side.
 */
export function valueAxis(lo, hi, { zero = false, count = 3 } = {}) {
  let min = zero ? Math.min(0, lo) : lo;
  let max = hi;
  if (!(max > min)) {
    const pad = Math.abs(max) > 0 ? Math.abs(max) * 0.1 : 1;
    max += pad;
    if (!zero) min -= pad;
  }
  const step = niceStep((max - min) / count);
  const from = Math.floor(min / step) * step;
  const to = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = from; v <= to + step / 2; v += step) ticks.push(round2(v));
  return { lo: from, hi: to, ticks };
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

/**
 * The time ticks whose labels fit across a plot `width` px wide: each `{ t,
 * x, text, edge }`, a label centred on its tick, or held inside the plot at
 * either end (`edge` 'start' or 'end'). A label that would come within `gap`
 * px of the one kept before it is left out, so a week's day names never run
 * into each other on a narrow chart. Widths are estimated at `charPx` a
 * character (12px figures and short words).
 */
export function fitTicks(ticks, { width, labelOf, charPx = 7, gap = 8, edgeWithin = 24 }) {
  const kept = [];
  let right = -Infinity;
  for (const { t, x } of ticks) {
    const text = labelOf(t);
    const w = text.length * charPx;
    const edge = x < edgeWithin ? 'start' : x > width - edgeWithin ? 'end' : 'middle';
    const left = edge === 'start' ? x : edge === 'end' ? x - w : x - w / 2;
    if (left < right + gap) continue;
    kept.push({ t, x, text, edge });
    right = left + w;
  }
  return kept;
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
