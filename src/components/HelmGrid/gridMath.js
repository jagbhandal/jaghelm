/**
 * Pure grid math for HelmGrid. No React, no DOM, no state.
 *
 * Layout items have shape: { i, x, y, w, h, minW, minH }
 *   x, y, w, h are in grid cells (not pixels).
 *
 * `gap` parameters are [horizontal, vertical] pixel margins.
 */

/** Convert a grid cell box {x, y, w, h} to pixel coordinates. */
export function gridToPixel(x, y, w, h, cellW, rowH, gap) {
  return {
    left:   Math.round(x * (cellW + gap[0]) + gap[0]),
    top:    Math.round(y * (rowH  + gap[1]) + gap[1]),
    width:  Math.round(w * (cellW + gap[0]) - gap[0]),
    height: Math.round(h * (rowH  + gap[1]) - gap[1]),
  };
}

/** Snap pixel coordinates to a grid cell {x, y}, clamped to column count. */
export function pixelToGrid(px, py, cellW, rowH, gap, cols) {
  return {
    x: Math.max(0, Math.min(Math.round((px - gap[0]) / (cellW + gap[0])), cols - 1)),
    y: Math.max(0, Math.round((py - gap[1]) / (rowH + gap[1]))),
  };
}

/** Snap pixel size to grid {w, h}, with a 1-cell minimum. */
export function pixelSizeToGrid(pw, ph, cellW, rowH, gap) {
  return {
    w: Math.max(1, Math.round((pw + gap[0]) / (cellW + gap[0]))),
    h: Math.max(1, Math.round((ph + gap[1]) / (rowH + gap[1]))),
  };
}

/** Convert pixel height to grid rows (round UP so content isn't clipped). */
export function pxToRows(px, rowH, gap) {
  return Math.ceil((px + gap[1]) / (rowH + gap[1]));
}

/** Compute the per-cell pixel width given container width, column count, and gap. */
export function calcCellWidth(containerWidth, cols, gap) {
  return (containerWidth - gap[0] * (cols + 1)) / cols;
}

/** Returns true if two layout items overlap. Items with the same `i` never collide. */
export function collides(a, b) {
  if (a.i === b.i) return false;
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Push down any item that overlaps with one above it.
 * Sort by (y, x) so we resolve top-down, left-to-right.
 */
export function resolveOverlaps(layout) {
  const sorted = [...layout].sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (collides(sorted[i], sorted[j])) {
        sorted[j] = { ...sorted[j], y: sorted[i].y + sorted[i].h };
      }
    }
  }
  return sorted;
}

/** Bottom row of the layout (y + h of the lowest item), or 0 for empty layouts. */
export function getBottom(layout) {
  if (!layout || !layout.length) return 0;
  return Math.max(...layout.map(it => it.y + it.h));
}

/** Shrink an item's width if it would overflow the column count. */
export function autoFitWidth(item, cols) {
  if (item.x + item.w > cols) {
    return { ...item, w: Math.max(item.minW || 2, cols - item.x) };
  }
  return item;
}

/**
 * Nudge an item by (dx, dy) grid cells, clamped to the grid: x stays within
 * [0, cols - w] so the item never overflows a column, and y never goes negative.
 * Returns the new {x, y}; identical to the input when the move is fully clamped
 * (so callers can detect a no-op). Pure — the keyboard move handler builds on it.
 */
export function nudge(item, dx, dy, cols) {
  const x = Math.max(0, Math.min(item.x + dx, cols - item.w));
  const y = Math.max(0, item.y + dy);
  return { x, y };
}

/**
 * Grow/shrink an item by (dw, dh) grid cells, clamped: width to
 * [minW, cols - x] (can't exceed the remaining columns or drop below minW) and
 * height to >= minH (can't shrink below its content). Returns the new {w, h};
 * identical to the input when fully clamped. Pure — the keyboard resize handler
 * builds on it.
 */
export function grow(item, dw, dh, cols, minH) {
  const minW = item.minW || 2;
  const w = Math.max(minW, Math.min(item.w + dw, cols - item.x));
  const h = Math.max(minH, item.h + dh);
  return { w, h };
}

/**
 * Deep-equal layout comparison, order-independent.
 * Used to skip no-op syncs when props change but the resolved layout is the same.
 */
export function layoutsEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const sA = [...a].sort((x, y) => x.i.localeCompare(y.i));
  const sB = [...b].sort((x, y) => x.i.localeCompare(y.i));
  return sA.every((it, i) =>
    it.i === sB[i].i && it.x === sB[i].x && it.y === sB[i].y && it.w === sB[i].w && it.h === sB[i].h
  );
}
