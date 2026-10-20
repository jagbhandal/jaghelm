import { useMemo, useRef } from 'react';
import { STATIC_PANEL_KEYS, orderForMobile } from './layouts';

const NONE = [];

/**
 * Reconciles the saved/default layout with the actual set of dynamic panels
 * (nodes + custom groups), enforces min-size constraints, and auto-generates
 * the mobile (sm) breakpoint when missing.
 *
 * `hidden` lists the panels not shown: switched off in Settings, or source-fed
 * (#272) with a source not known to be set up. They are not added to a layout
 * that lacks them, so they hold no slot in the grid (#248), and a saved layout
 * that has one keeps its place while it is off or its source can't say.
 * `dropped`, source-fed panels only, lists the ones the server says are not
 * set up: they are taken out of the layout too, so the space they held is free
 * for other panels (and a stacked phone layout has no gap), and the next drag
 * or resize saves the layout without them.
 *
 * Stability: returns the previous object reference whenever the layout
 * content is unchanged, preventing react-grid-layout's compactor from
 * re-running on every 30-second data refresh.
 */
export function useEffectiveLayouts(
  layouts,
  serviceData,
  customGroups,
  gridColumns,
  hidden = NONE,
  dropped = NONE
) {
  const prevRef = useRef(null);

  return useMemo(() => {
    const nodeKeys = Object.keys(serviceData.nodes || {}).map((k) => `node-${k}`);
    const groupKeys = customGroups.map((g) => `group-${g.id}`);
    const allDynamicKeys = [...nodeKeys, ...groupKeys];
    const lgCols = gridColumns || 24;

    const result = {};

    // ── Process saved breakpoints (lg, md) ──
    for (const [bp, items] of Object.entries(layouts)) {
      const constrained = items
        .filter((item) => !dropped.includes(item.i))
        .map((item) => ({
          ...item,
          minW: bp === 'sm' ? 1 : item.minW || 4,
          minH: item.minH || 3,
        }));

      const existingKeys = new Set(constrained.map((i) => i.i));
      const missingDynamic = allDynamicKeys.filter((k) => !existingKeys.has(k));
      const missingStatic = STATIC_PANEL_KEYS.filter(
        (k) => !existingKeys.has(k) && !hidden.includes(k)
      );

      let maxY = constrained.reduce((max, i) => Math.max(max, i.y + i.h), 0);
      const newItems = [...missingDynamic, ...missingStatic].map((k) => ({
        i: k,
        x: 0,
        y: maxY++,
        w: bp === 'lg' ? lgCols : bp === 'md' ? Math.min(lgCols, 20) : 1,
        h: k === 'cron-jobs' ? 7 : 5,
        minW: bp === 'sm' ? 1 : 4,
        minH: 3,
      }));
      result[bp] = [...constrained, ...newItems];
    }

    // ── Auto-generate mobile (sm) breakpoint ──
    if (!result.sm) {
      const lgItems = result.lg || result.md || [];
      const allKeys = lgItems.map((i) => i.i);

      // MOBILE_PANEL_ORDER first (nodes in desktop order), then custom groups.
      const orderedKeys = orderForMobile(allKeys);

      const heightByKey = {};
      for (const item of lgItems) heightByKey[item.i] = item.h || 4;

      let smY = 0;
      result.sm = orderedKeys.map((k) => {
        const h = heightByKey[k] || 4;
        const entry = { i: k, x: 0, y: smY, w: 1, h, minW: 1, minH: 3 };
        smY += h;
        return entry;
      });
    }

    // ── Stable reference: return prev if content is identical ──
    const prev = prevRef.current;
    if (prev) {
      const same = Object.keys(result).every((bp) => {
        const a = result[bp];
        const b = prev[bp];
        if (!b || a.length !== b.length) return false;
        return a.every(
          (item, idx) =>
            item.i === b[idx].i &&
            item.x === b[idx].x &&
            item.y === b[idx].y &&
            item.w === b[idx].w &&
            item.h === b[idx].h &&
            item.minH === b[idx].minH
        );
      });
      if (same) return prev;
    }

    prevRef.current = result;
    return result;
  }, [layouts, serviceData, customGroups, gridColumns, hidden, dropped]);
}
