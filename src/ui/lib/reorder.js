/**
 * The row a pointer is over, for dragging a row through a list (LayoutEditor,
 * #330): `rects` is `[{ id, top, bottom }]` top to bottom. The pointer's row,
 * else the nearest end when it is above or below the list; -1 for no rows.
 */
export function indexAtY(rects, y) {
  if (rects.length === 0) return -1;
  const i = rects.findIndex((r) => y >= r.top && y < r.bottom);
  if (i >= 0) return i;
  return y < rects[0].top ? 0 : rects.length - 1;
}
