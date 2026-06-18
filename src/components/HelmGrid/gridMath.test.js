import test from 'node:test';
import assert from 'node:assert/strict';

import {
  gridToPixel,
  pixelToGrid,
  pixelSizeToGrid,
  pxToRows,
  calcCellWidth,
  collides,
  resolveOverlaps,
  getBottom,
  autoFitWidth,
  layoutsEqual,
  nudge,
  grow,
  autoArrange,
} from './gridMath.js';

// Shared fixtures. gap is [horizontal, vertical] in px.
const GAP = [16, 16];
const CELL_W = 50;
const ROW_H = 36;

// ── gridToPixel ⇄ pixelToGrid round-trips ──────────────────────────────────

test('gridToPixel places the origin cell offset by one gap', () => {
  const px = gridToPixel(0, 0, 1, 1, CELL_W, ROW_H, GAP);
  assert.equal(px.left, GAP[0]);
  assert.equal(px.top, GAP[1]);
  // width = w*(cellW+gap) - gap  => 1*(66) - 16 = 50
  assert.equal(px.width, CELL_W);
  assert.equal(px.height, ROW_H);
});

test('gridToPixel scales width/height with span', () => {
  const px = gridToPixel(0, 0, 3, 2, CELL_W, ROW_H, GAP);
  // width = 3*(50+16) - 16 = 198 - 16 = 182
  assert.equal(px.width, 3 * (CELL_W + GAP[0]) - GAP[0]);
  assert.equal(px.height, 2 * (ROW_H + GAP[1]) - GAP[1]);
});

test('pixelToGrid inverts gridToPixel for the top-left corner', () => {
  for (const [x, y] of [[0, 0], [1, 0], [3, 2], [5, 4]]) {
    const px = gridToPixel(x, y, 1, 1, CELL_W, ROW_H, GAP);
    const cell = pixelToGrid(px.left, px.top, CELL_W, ROW_H, GAP, 24);
    assert.deepEqual(cell, { x, y }, `round-trip failed for (${x},${y})`);
  }
});

test('pixelToGrid clamps x to [0, cols-1] and y to >= 0', () => {
  const cols = 12;
  // Far right of the grid snaps to the last column, not past it.
  const far = pixelToGrid(100000, 100000, CELL_W, ROW_H, GAP, cols);
  assert.equal(far.x, cols - 1);
  assert.ok(far.y >= 0);
  // Negative pixels clamp to 0.
  const neg = pixelToGrid(-500, -500, CELL_W, ROW_H, GAP, cols);
  assert.deepEqual(neg, { x: 0, y: 0 });
});

test('pixelToGrid clamps x even when cols is 1', () => {
  const cell = pixelToGrid(9999, 0, CELL_W, ROW_H, GAP, 1);
  assert.equal(cell.x, 0); // cols-1 = 0
});

// ── pixelSizeToGrid ────────────────────────────────────────────────────────

test('pixelSizeToGrid inverts gridToPixel width/height', () => {
  const px = gridToPixel(0, 0, 4, 3, CELL_W, ROW_H, GAP);
  const size = pixelSizeToGrid(px.width, px.height, CELL_W, ROW_H, GAP);
  assert.deepEqual(size, { w: 4, h: 3 });
});

test('pixelSizeToGrid enforces a 1-cell minimum', () => {
  const size = pixelSizeToGrid(0, 0, CELL_W, ROW_H, GAP);
  assert.deepEqual(size, { w: 1, h: 1 });
  const neg = pixelSizeToGrid(-200, -200, CELL_W, ROW_H, GAP);
  assert.deepEqual(neg, { w: 1, h: 1 });
});

// ── pxToRows ───────────────────────────────────────────────────────────────

test('pxToRows rounds UP so content is never clipped', () => {
  // Exactly one row tall.
  assert.equal(pxToRows(ROW_H, ROW_H, GAP), 1);
  // One pixel over a row boundary bumps to the next row.
  assert.equal(pxToRows(ROW_H + GAP[1] + 1, ROW_H, GAP), 2);
});

test('pxToRows returns at least 1 row for tiny heights', () => {
  assert.equal(pxToRows(1, ROW_H, GAP), 1);
});

// ── calcCellWidth ──────────────────────────────────────────────────────────

test('calcCellWidth subtracts the inter-column gaps', () => {
  const cols = 4;
  const containerWidth = 4 * CELL_W + (cols + 1) * GAP[0]; // exact fit
  assert.equal(calcCellWidth(containerWidth, cols, GAP), CELL_W);
});

test('calcCellWidth scales inversely with column count', () => {
  const w = 1000;
  const wide = calcCellWidth(w, 6, GAP);
  const narrow = calcCellWidth(w, 12, GAP);
  assert.ok(wide > narrow, 'fewer columns => wider cells');
});

// ── collides ───────────────────────────────────────────────────────────────

test('collides is false for an item against itself (same i)', () => {
  const a = { i: 'a', x: 0, y: 0, w: 2, h: 2 };
  assert.equal(collides(a, { ...a }), false);
});

test('collides detects overlapping boxes', () => {
  const a = { i: 'a', x: 0, y: 0, w: 2, h: 2 };
  const b = { i: 'b', x: 1, y: 1, w: 2, h: 2 };
  assert.equal(collides(a, b), true);
});

test('collides treats edge-adjacent boxes as non-overlapping', () => {
  const a = { i: 'a', x: 0, y: 0, w: 2, h: 2 };
  const right = { i: 'b', x: 2, y: 0, w: 2, h: 2 }; // touches a's right edge
  const below = { i: 'c', x: 0, y: 2, w: 2, h: 2 }; // touches a's bottom edge
  assert.equal(collides(a, right), false);
  assert.equal(collides(a, below), false);
});

// ── resolveOverlaps (overlap pushdown) ──────────────────────────────────────

test('resolveOverlaps pushes the lower item below the upper one', () => {
  const layout = [
    { i: 'a', x: 0, y: 0, w: 2, h: 2 },
    { i: 'b', x: 0, y: 1, w: 2, h: 2 }, // overlaps a
  ];
  const out = resolveOverlaps(layout);
  const a = out.find((it) => it.i === 'a');
  const b = out.find((it) => it.i === 'b');
  assert.equal(a.y, 0); // anchor unchanged
  assert.equal(b.y, a.y + a.h); // pushed to just below a
  // No pair collides after resolution.
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      assert.equal(collides(out[i], out[j]), false);
    }
  }
});

test('resolveOverlaps leaves a non-overlapping layout collision-free', () => {
  const layout = [
    { i: 'a', x: 0, y: 0, w: 2, h: 2 },
    { i: 'b', x: 2, y: 0, w: 2, h: 2 },
    { i: 'c', x: 0, y: 2, w: 4, h: 1 },
  ];
  const out = resolveOverlaps(layout);
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      assert.equal(collides(out[i], out[j]), false);
    }
  }
});

test('resolveOverlaps does not mutate the input array or items', () => {
  const layout = [
    { i: 'a', x: 0, y: 0, w: 2, h: 2 },
    { i: 'b', x: 0, y: 1, w: 2, h: 2 },
  ];
  const snapshot = JSON.parse(JSON.stringify(layout));
  resolveOverlaps(layout);
  assert.deepEqual(layout, snapshot, 'input must be untouched');
});

test('resolveOverlaps cascades a stack of overlapping items downward', () => {
  const layout = [
    { i: 'a', x: 0, y: 0, w: 2, h: 1 },
    { i: 'b', x: 0, y: 0, w: 2, h: 1 },
    { i: 'c', x: 0, y: 0, w: 2, h: 1 },
  ];
  const out = resolveOverlaps(layout);
  const ys = out.map((it) => it.y).sort((m, n) => m - n);
  assert.deepEqual(ys, [0, 1, 2], 'three unit items stack at y=0,1,2');
});

// ── getBottom ───────────────────────────────────────────────────────────────

test('getBottom returns the lowest y+h, 0 for empty/missing layouts', () => {
  assert.equal(getBottom([]), 0);
  assert.equal(getBottom(null), 0);
  assert.equal(getBottom(undefined), 0);
  assert.equal(
    getBottom([
      { i: 'a', x: 0, y: 0, w: 2, h: 2 },
      { i: 'b', x: 0, y: 3, w: 2, h: 4 }, // bottom = 7
    ]),
    7
  );
});

// ── autoFitWidth (column clamping) ──────────────────────────────────────────

test('autoFitWidth leaves an in-bounds item unchanged (same reference)', () => {
  const item = { i: 'a', x: 0, y: 0, w: 4, h: 2, minW: 2 };
  const out = autoFitWidth(item, 12);
  assert.equal(out, item); // returns the same object, no copy
});

test('autoFitWidth shrinks an overflowing item to the remaining columns', () => {
  const item = { i: 'a', x: 10, y: 0, w: 6, h: 2, minW: 2 }; // x+w = 16 > 12
  const out = autoFitWidth(item, 12);
  assert.equal(out.w, 12 - 10); // clamp to 2 remaining cols
  assert.notEqual(out, item); // produces a new object
});

test('autoFitWidth respects minW when clamping near the right edge', () => {
  const item = { i: 'a', x: 11, y: 0, w: 6, h: 2, minW: 3 }; // only 1 col left
  const out = autoFitWidth(item, 12);
  assert.equal(out.w, 3); // minW wins over the 1-col remainder
});

test('autoFitWidth defaults minW to 2 when unset', () => {
  const item = { i: 'a', x: 11, y: 0, w: 6, h: 2 }; // no minW, 1 col remains
  const out = autoFitWidth(item, 12);
  assert.equal(out.w, 2); // default minW
});

// ── layoutsEqual (position-only compare) ────────────────────────────────────

test('layoutsEqual is true for the same positions in different order', () => {
  const a = [
    { i: 'a', x: 0, y: 0, w: 2, h: 2 },
    { i: 'b', x: 2, y: 0, w: 2, h: 2 },
  ];
  const b = [
    { i: 'b', x: 2, y: 0, w: 2, h: 2 },
    { i: 'a', x: 0, y: 0, w: 2, h: 2 },
  ];
  assert.equal(layoutsEqual(a, b), true);
});

test('layoutsEqual is false when any position differs', () => {
  const a = [{ i: 'a', x: 0, y: 0, w: 2, h: 2 }];
  const b = [{ i: 'a', x: 1, y: 0, w: 2, h: 2 }];
  assert.equal(layoutsEqual(a, b), false);
});

test('layoutsEqual ignores non-position fields (minW, minH, extras)', () => {
  const a = [{ i: 'a', x: 0, y: 0, w: 2, h: 2, minW: 2, minH: 1, foo: 1 }];
  const b = [{ i: 'a', x: 0, y: 0, w: 2, h: 2, minW: 9, minH: 9, foo: 2 }];
  assert.equal(layoutsEqual(a, b), true);
});

test('layoutsEqual is false for different lengths or nullish inputs', () => {
  const a = [{ i: 'a', x: 0, y: 0, w: 2, h: 2 }];
  assert.equal(layoutsEqual(a, [...a, { i: 'b', x: 2, y: 0, w: 2, h: 2 }]), false);
  assert.equal(layoutsEqual(null, a), false);
  assert.equal(layoutsEqual(a, null), false);
  assert.equal(layoutsEqual(undefined, undefined), false);
});

test('layoutsEqual is false when ids differ even if positions match', () => {
  const a = [{ i: 'a', x: 0, y: 0, w: 2, h: 2 }];
  const b = [{ i: 'z', x: 0, y: 0, w: 2, h: 2 }];
  assert.equal(layoutsEqual(a, b), false);
});

// nudge — keyboard move clamp (cols = 24)
test('nudge moves by the delta when there is room', () => {
  assert.deepEqual(nudge({ x: 4, y: 2, w: 3 }, 1, 0, 24), { x: 5, y: 2 });
  assert.deepEqual(nudge({ x: 4, y: 2, w: 3 }, 0, 1, 24), { x: 4, y: 3 });
  assert.deepEqual(nudge({ x: 4, y: 2, w: 3 }, -1, -1, 24), { x: 3, y: 1 });
});

test('nudge clamps x so the item never overflows the columns or goes negative', () => {
  // At the right edge (x + w === cols): moving right is clamped to the same x.
  assert.deepEqual(nudge({ x: 21, y: 0, w: 3 }, 1, 0, 24), { x: 21, y: 0 });
  // At the left edge: moving left is clamped to 0.
  assert.deepEqual(nudge({ x: 0, y: 5, w: 3 }, -1, 0, 24), { x: 0, y: 5 });
});

test('nudge clamps y at the top but allows unbounded downward movement', () => {
  assert.deepEqual(nudge({ x: 2, y: 0, w: 3 }, 0, -1, 24), { x: 2, y: 0 });
  assert.deepEqual(nudge({ x: 2, y: 0, w: 3 }, 0, 9, 24), { x: 2, y: 9 });
});

// grow — keyboard resize clamp (cols = 24)
test('grow changes size by the delta when within bounds', () => {
  assert.deepEqual(grow({ x: 2, w: 4, h: 3, minW: 2 }, 1, 0, 24, 2), { w: 5, h: 3 });
  assert.deepEqual(grow({ x: 2, w: 4, h: 3, minW: 2 }, 0, 1, 24, 2), { w: 4, h: 4 });
});

test('grow clamps width to [minW, cols - x] and height to >= minH', () => {
  // Width can't exceed the remaining columns (x=20, cols=24 → max w=4).
  assert.deepEqual(grow({ x: 20, w: 4, h: 3, minW: 2 }, 5, 0, 24, 2), { w: 4, h: 3 });
  // Width can't drop below minW.
  assert.deepEqual(grow({ x: 2, w: 2, h: 3, minW: 2 }, -5, 0, 24, 2), { w: 2, h: 3 });
  // Height can't shrink below the content minimum (minH = 3 here).
  assert.deepEqual(grow({ x: 2, w: 4, h: 3, minW: 2 }, 0, -5, 24, 3), { w: 4, h: 3 });
});

test('grow defaults minW to 2 when the item omits it', () => {
  assert.deepEqual(grow({ x: 0, w: 2, h: 4 }, -1, 0, 24, 1), { w: 2, h: 4 });
});

// autoArrange — "tidy up": priority order + gapless shelf packing (cols = 24)
test('autoArrange packs nodes, then widgets, then groups; left-to-right, wrapping rows', () => {
  const items = [
    { i: 'todos', x: 5, y: 9, w: 6, h: 4 },
    { i: 'group-a', x: 0, y: 0, w: 6, h: 4 },
    { i: 'node-b', x: 2, y: 2, w: 12, h: 4 },
    { i: 'node-a', x: 0, y: 0, w: 12, h: 4 },
  ];
  const byId = Object.fromEntries(autoArrange(items, 24).map((o) => [o.i, o]));
  // node-a, node-b fill row 0 (12+12=24); todos wraps to y=4; group-a follows it.
  assert.deepEqual([byId['node-a'].x, byId['node-a'].y], [0, 0]);
  assert.deepEqual([byId['node-b'].x, byId['node-b'].y], [12, 0]);
  assert.deepEqual([byId['todos'].x, byId['todos'].y], [0, 4]);
  assert.deepEqual([byId['group-a'].x, byId['group-a'].y], [6, 4]);
});

test('autoArrange clamps a panel wider than the grid to full width', () => {
  const out = autoArrange([{ i: 'node-x', x: 0, y: 0, w: 30, h: 3 }], 24);
  assert.equal(out[0].w, 24);
  assert.deepEqual([out[0].x, out[0].y], [0, 0]);
});

test('autoArrange preserves size/min fields, leaves no overlaps, and handles empty input', () => {
  assert.deepEqual(autoArrange([], 24), []);
  assert.deepEqual(autoArrange(undefined, 24), []);
  const items = [
    { i: 'a', x: 3, y: 7, w: 8, h: 5, minW: 4 },
    { i: 'b', x: 0, y: 0, w: 8, h: 3 },
    { i: 'c', x: 0, y: 0, w: 10, h: 4 },
  ];
  const out = autoArrange(items, 24);
  const byId = Object.fromEntries(out.map((o) => [o.i, o]));
  assert.equal(byId['a'].h, 5);
  assert.equal(byId['a'].minW, 4); // non-position fields preserved
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      assert.equal(collides(out[i], out[j]), false);
    }
  }
});
