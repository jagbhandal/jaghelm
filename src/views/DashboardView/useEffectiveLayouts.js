import { useMemo, useRef } from 'react';
import { MOBILE_PANEL_ORDER, STATIC_PANEL_KEYS } from './layouts';

/**
 * Reconciles the saved/default layout with the actual set of dynamic panels
 * (nodes + custom groups), enforces min-size constraints, and auto-generates
 * the mobile (sm) breakpoint when missing.
 *
 * Stability: returns the previous object reference whenever the layout
 * content is unchanged, preventing react-grid-layout's compactor from
 * re-running on every 30-second data refresh.
 */
export function useEffectiveLayouts(layouts, serviceData, customGroups, gridColumns) {
  const prevRef = useRef(null);

  return useMemo(() => {
    const nodeKeys = Object.keys(serviceData.nodes || {}).map((k) => `node-${k}`);
    const groupKeys = customGroups.map((g) => `group-${g.id}`);
    const allDynamicKeys = [...nodeKeys, ...groupKeys];
    const lgCols = gridColumns || 24;

    const result = {};

    // ── Process saved breakpoints (lg, md) ──
    for (const [bp, items] of Object.entries(layouts)) {
      const constrained = items.map((item) => ({
        ...item,
        minW: bp === 'sm' ? 1 : item.minW || 4,
        minH: item.minH || 3,
      }));

      const existingKeys = new Set(constrained.map((i) => i.i));
      const missingDynamic = allDynamicKeys.filter((k) => !existingKeys.has(k));
      const missingStatic = STATIC_PANEL_KEYS.filter((k) => !existingKeys.has(k));

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

      // Explicit-order keys first, then anything custom (groups, unknown nodes)
      const orderedKeys = [
        ...MOBILE_PANEL_ORDER.filter((k) => allKeys.includes(k)),
        ...allKeys.filter((k) => !MOBILE_PANEL_ORDER.includes(k)),
      ];

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
  }, [layouts, serviceData, customGroups, gridColumns]);
}
