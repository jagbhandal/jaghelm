import React, { useState, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { prefs } from '../../storage/index.js';
import GridItem from './GridItem.jsx';
import {
  gridToPixel,
  pixelToGrid,
  pixelSizeToGrid,
  pxToRows,
  calcCellWidth,
  resolveOverlaps,
  getBottom,
  autoFitWidth,
  layoutsEqual,
  nudge,
  grow,
} from './gridMath.js';

/**
 * HelmGrid v4 — Custom grid layout engine for JagHelm
 *
 * Content-aware panels: each panel auto-grows to fit its content.
 * User can make panels taller but not shorter than content.
 * Drag-to-reorder with snap-to-grid. Resize from SE/SW handles.
 *
 * Layout format: { lg: [{ i, x, y, w, h, minW, minH }], md: [...], sm: [...] }
 *
 * Architecture:
 *   - Pure grid math lives in ./gridMath.js
 *   - Per-item rendering + content-height measurement lives in ./GridItem.jsx
 *   - This file owns the lifecycle: container measurement, breakpoint resolution,
 *     working/effective layout state, drag and resize interactions, and render.
 *
 * No frame is drawn before it knows its width (#243): the container is
 * measured, and the layout for its breakpoint chosen, in layout effects, so
 * the first frame the browser paints is at the real width, never the `lg`
 * layout squeezed into a phone. At `sm`, one column, when the board can't be
 * dragged or resized (a phone, a filtered board), the panels are in the
 * page's flow at their own height, in the layout's order (`flowOrder`):
 * nothing to measure, and nothing drawn at a saved height and then grown.
 * Otherwise, while `reserve` is on (the board's data still coming in), a panel
 * keeps the room it last took at that width (`HEIGHTS_PREF`, per browser), so
 * a reload draws the board at its size rather than at the saved rows, then
 * growing it; when it goes off each panel takes its own height, in one step.
 * Only heights measured with `reserve` off are kept, never a placeholder's.
 */
export default function HelmGrid({
  children,
  layouts,
  cols = { lg: 24, md: 20, sm: 1 },
  breakpoints = { lg: 1200, md: 768, sm: 480 },
  rowHeight = 36,
  margin = [16, 16],
  draggable = true,
  dragHandle = '.section-header',
  resizable = true,
  onLayoutChange,
  onDrag,
  onDragStop,
  onResizeStop,
  labels = {},
  className = '',
  reserve = false,
}) {
  const containerRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [mounted, setMounted] = useState(false);

  // Before the first paint: the first frame drawn is at the real width.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) { setWidth(w); setMounted(true); }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const breakpoint = useMemo(() => {
    if (!width) return 'lg';
    const sorted = Object.entries(breakpoints).sort((a, b) => b[1] - a[1]);
    for (const [bp, min] of sorted) {
      if (width >= min) return bp;
    }
    return sorted[sorted.length - 1][0];
  }, [width, breakpoints]);

  const activeCols = cols[breakpoint] || cols.lg || 24;
  const cellWidth = width > 0 ? calcCellWidth(width, activeCols, margin) : 0;

  const [workingLayout, setWorkingLayout] = useState([]);
  const layoutRef = useRef(workingLayout);
  layoutRef.current = workingLayout;

  // Measured by GridItem, used for auto-grow.
  const [contentHeights, setContentHeights] = useState({}); // itemId → pixels
  const contentHeightsRef = useRef({});
  const pendingHeightsRef = useRef(null); // batched updates
  // The last height each panel measured, at its width then, in this browser's
  // earlier visits: the room a panel keeps while `reserve` is on.
  const [lastKnown] = useState(readLastHeights);
  const reserveRef = useRef(reserve);
  reserveRef.current = reserve;

  const handleContentHeight = useCallback((itemId, px) => {
    if (contentHeightsRef.current[itemId] === px) return; // No change
    contentHeightsRef.current[itemId] = px;

    // Batch: collect all height updates, flush in one microtask
    if (!pendingHeightsRef.current) {
      pendingHeightsRef.current = {};
      Promise.resolve().then(() => {
        const batch = pendingHeightsRef.current;
        pendingHeightsRef.current = null;
        if (batch && Object.keys(batch).length > 0) {
          setContentHeights(prev => ({ ...prev, ...batch }));
          if (!reserveRef.current) keepLastHeights(batch, effectiveRef.current, gridRef.current);
        }
      });
    }
    pendingHeightsRef.current[itemId] = px;
  }, []);

  // Sync from props with column clamping and overlap resolution, before the
  // paint, so no frame shows another breakpoint's layout.
  const lastSyncedLayout = useRef(null);
  useLayoutEffect(() => {
    const hasOwnLayout = !!layouts?.[breakpoint];
    const bpLayout = layouts?.[breakpoint] || layouts?.lg || [];
    const forceStack = breakpoint === 'sm' || (breakpoint === 'md' && !hasOwnLayout);

    let clamped;
    if (forceStack) {
      // Sort by original position (top-to-bottom, left-to-right) then stack sequentially
      const sorted = [...bpLayout].sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);
      let stackY = 0;
      clamped = sorted.map(item => {
        const entry = { ...item, x: 0, w: activeCols, y: stackY };
        stackY += item.h;
        return entry;
      });
    } else {
      clamped = bpLayout.map(item => {
        let { x, w } = item;
        if (w > activeCols) w = activeCols;
        if (x + w > activeCols) x = Math.max(0, activeCols - w);
        return (x !== item.x || w !== item.w) ? { ...item, x, w } : item;
      });
    }

    const resolved = resolveOverlaps(clamped);
    if (!layoutsEqual(resolved, lastSyncedLayout.current)) {
      lastSyncedLayout.current = resolved;
      layoutRef.current = resolved;
      setWorkingLayout(resolved);
    }
  }, [layouts, breakpoint, activeCols]);

  const gridRef = useRef({ cellWidth, rowHeight, margin, activeCols });
  gridRef.current = { cellWidth, rowHeight, margin, activeCols };

  const childMap = useMemo(() => {
    const map = {};
    React.Children.forEach(children, (child) => {
      if (child && child.key != null) {
        map[String(child.key).replace(/^\.\$/, '')] = child;
      }
    });
    return map;
  }, [children]);

  // Expand h to fit content where needed, then resolve overlaps. While the
  // board comes in, a panel is at least as tall as it last was at this width.
  const effectiveLayout = useMemo(() => {
    const expanded = workingLayout.map(item => {
      const measured = contentHeights[item.i];
      const kept = reserve ? lastKnownHeight(lastKnown, item, cellWidth, margin) : undefined;
      const contentPx = Math.max(measured ?? 0, kept ?? 0);
      if (!contentPx) return item;
      const contentRows = pxToRows(contentPx, rowHeight, margin);
      if (contentRows > item.h) {
        return { ...item, h: contentRows };
      }
      return item;
    });
    // Re-resolve overlaps after height expansion to prevent panels from overlapping
    return resolveOverlaps(expanded);
  }, [workingLayout, contentHeights, reserve, lastKnown, cellWidth, rowHeight, margin]);

  // Effective layout ref for handlers
  const effectiveRef = useRef(effectiveLayout);
  effectiveRef.current = effectiveLayout;

  // The data is in: keep the heights measured so far (the measures while it
  // came in weren't kept), each panel's from now on as it measures.
  useLayoutEffect(() => {
    if (!reserve && Object.keys(contentHeightsRef.current).length)
      keepLastHeights(contentHeightsRef.current, effectiveRef.current, gridRef.current);
  }, [reserve]);

  // Content-aware minH for resize.
  const getContentMinH = useCallback((itemId) => {
    const contentPx = contentHeightsRef.current[itemId];
    if (!contentPx) return 3; // fallback
    return pxToRows(contentPx, rowHeight, margin);
  }, [rowHeight, margin]);

  const interactionRef = useRef(null);
  const [interaction, setInteraction] = useState(null);

  // Screen-reader announcement for keyboard move/resize (the pointer drag has
  // visual feedback; the keyboard path needs a polite live region instead). A
  // live region only re-speaks when its text changes, so we toggle a trailing
  // space — invisible on screen and ignored by AT — to force an identical
  // message (e.g. pressing into the same boundary twice) to announce again.
  const [announceText, setAnnounceText] = useState('');
  const announceTick = useRef(0);
  const announce = useCallback((msg) => {
    announceTick.current += 1;
    setAnnounceText(announceTick.current % 2 ? `${msg} ` : msg);
  }, []);

  const commitLayout = useCallback((newLayout) => {
    const resolved = resolveOverlaps(newLayout);
    layoutRef.current = resolved;
    lastSyncedLayout.current = resolved;
    setWorkingLayout(resolved);
    if (onLayoutChange) {
      const all = { ...layouts, [breakpoint]: resolved };
      setTimeout(() => onLayoutChange(resolved, all), 0);
    }
    return resolved;
  }, [onLayoutChange, layouts, breakpoint]);

  const startDrag = useCallback((e, itemId) => {
    const layout = effectiveRef.current;
    const g = gridRef.current;
    const item = layout.find(l => l.i === itemId);
    if (!item) return;

    const pos = gridToPixel(item.x, item.y, item.w, item.h, g.cellWidth, g.rowHeight, g.margin);

    interactionRef.current = {
      type: 'drag', itemId, item: { ...item },
      startPxX: pos.left, startPxY: pos.top,
      startMouseX: e.clientX, startMouseY: e.clientY,
      startScrollY: window.scrollY,
    };
    setInteraction({
      type: 'drag', itemId,
      pixelPos: { left: pos.left, top: pos.top },
      placeholder: { x: item.x, y: item.y, w: item.w, h: item.h },
    });

    let dragRAF = null;
    const onMove = (me) => {
      const s = interactionRef.current;
      if (!s || s.type !== 'drag') return;
      // Throttle to animation frame — at most one React update per screen refresh
      if (dragRAF) return;
      dragRAF = requestAnimationFrame(() => {
        dragRAF = null;
        const s = interactionRef.current;
        if (!s || s.type !== 'drag') return;
        const g = gridRef.current;

        const left = s.startPxX + (me.clientX - s.startMouseX);
        const top = s.startPxY + (me.clientY - s.startMouseY) + (window.scrollY - s.startScrollY);

        const snap = pixelToGrid(left, top, g.cellWidth, g.rowHeight, g.margin, g.activeCols);
        let pw = s.item.w;
        const maxW = g.activeCols - Math.max(0, Math.min(snap.x, g.activeCols - 1));
        if (pw > maxW) pw = Math.max(s.item.minW || 2, maxW);

        const cx = Math.max(0, Math.min(snap.x, g.activeCols - pw));
        const cy = Math.max(0, snap.y);

        setInteraction({
          type: 'drag', itemId: s.itemId,
          pixelPos: { left, top },
          placeholder: { x: cx, y: cy, w: pw, h: s.item.h },
        });

        if (onDrag) onDrag(layoutRef.current, s.item, { ...s.item, x: cx, y: cy }, null, me);
      });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (dragRAF) { cancelAnimationFrame(dragRAF); dragRAF = null; }
      const s = interactionRef.current;
      if (!s || s.type !== 'drag') return;
      interactionRef.current = null;

      setInteraction(cur => {
        if (!cur || cur.type !== 'drag') return null;
        const ph = cur.placeholder;
        const updated = layoutRef.current.map(l =>
          l.i === s.itemId ? autoFitWidth({ ...l, x: ph.x, y: ph.y, w: ph.w }, gridRef.current.activeCols) : l
        );
        commitLayout(updated);
        if (onDragStop) setTimeout(() => onDragStop(), 0);
        return null;
      });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [onDrag, onDragStop, commitLayout]);

  const startResize = useCallback((e, itemId, handle) => {
    const layout = effectiveRef.current;
    const g = gridRef.current;
    const item = layout.find(l => l.i === itemId);
    if (!item) return;

    const pos = gridToPixel(item.x, item.y, item.w, item.h, g.cellWidth, g.rowHeight, g.margin);

    interactionRef.current = {
      type: 'resize', itemId, handle, item: { ...item },
      startW: pos.width, startH: pos.height, startLeft: pos.left,
      startMouseX: e.clientX, startMouseY: e.clientY,
    };
    setInteraction({
      type: 'resize', itemId, handle,
      pixelSize: { width: pos.width, height: pos.height, left: pos.left },
      placeholder: { x: item.x, y: item.y, w: item.w, h: item.h },
    });

    let resizeRAF = null;
    const onMove = (me) => {
      const s = interactionRef.current;
      if (!s || s.type !== 'resize') return;
      if (resizeRAF) return;
      resizeRAF = requestAnimationFrame(() => {
        resizeRAF = null;
        const s = interactionRef.current;
        if (!s || s.type !== 'resize') return;
        const g = gridRef.current;

        const dx = me.clientX - s.startMouseX;
        const dy = me.clientY - s.startMouseY;

        let w = s.startW, h = s.startH + dy, left = s.startLeft;
        if (s.handle === 'se') w = s.startW + dx;
        else if (s.handle === 'sw') { w = s.startW - dx; left = s.startLeft + dx; }

        // Pixel minimums — use content-aware minH
        const contentMinH = getContentMinH(s.itemId);
        const minWpx = (s.item.minW || 2) * (g.cellWidth + g.margin[0]) - g.margin[0];
        const minHpx = contentMinH * (g.rowHeight + g.margin[1]) - g.margin[1];
        // Cap the LIVE box at the grid bounds too. The placeholder already clamps
        // to the columns (below), so without this the dragged panel + its resize
        // handle run PAST the grid edge and then snap back on release — the "ghost
        // you can drag further than the panel" bug.
        if (s.handle === 'sw') {
          if (left < g.margin[0]) left = g.margin[0]; // left edge can't pass column 0
          w = s.startLeft + s.startW - left; // the right edge stays anchored
        } else {
          const maxWpx = (g.activeCols - s.item.x) * (g.cellWidth + g.margin[0]) - g.margin[0];
          w = Math.min(w, maxWpx);
        }
        w = Math.max(w, minWpx);
        h = Math.max(h, minHpx);

        // Snap
        const snap = pixelSizeToGrid(w, h, g.cellWidth, g.rowHeight, g.margin);
        let nx = s.item.x;
        if (s.handle === 'sw') {
          const posSnap = pixelToGrid(left, 0, g.cellWidth, g.rowHeight, g.margin, g.activeCols);
          nx = Math.max(0, posSnap.x);
          snap.w = (s.item.x + s.item.w) - nx;
          if (snap.w < (s.item.minW || 2)) { snap.w = s.item.minW || 2; nx = s.item.x + s.item.w - snap.w; }
        }
        snap.w = Math.min(snap.w, g.activeCols - nx);
        snap.w = Math.max(snap.w, s.item.minW || 2);
        snap.h = Math.max(snap.h, contentMinH);

        setInteraction({
          type: 'resize', itemId: s.itemId, handle: s.handle,
          pixelSize: { width: w, height: h, left },
          placeholder: { x: nx, y: s.item.y, w: snap.w, h: snap.h },
        });
      });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (resizeRAF) { cancelAnimationFrame(resizeRAF); resizeRAF = null; }
      const s = interactionRef.current;
      if (!s || s.type !== 'resize') return;
      interactionRef.current = null;

      setInteraction(cur => {
        if (!cur || cur.type !== 'resize') return null;
        const ph = cur.placeholder;
        const updated = layoutRef.current.map(l =>
          l.i === s.itemId ? { ...l, x: ph.x, y: ph.y, w: ph.w, h: ph.h } : l
        );
        commitLayout(updated);
        if (onResizeStop) setTimeout(() => onResizeStop(), 0);
        return null;
      });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [onResizeStop, commitLayout, getContentMinH]);

  // Keyboard move / resize.
  // The pointer path (startDrag/startResize) has no keyboard equivalent, so a
  // panel was unreachable without a mouse. These commit through the same
  // commitLayout chokepoint (overlap-resolved + persisted) using the pure
  // nudge/grow clamps. Both read the EFFECTIVE layout (what the user sees, incl.
  // content-driven height) like the pointer handlers do — so a shrink at the
  // content floor is a true no-op — and announce the FINAL resolved position
  // (post overlap-resolution), or a boundary message when fully clamped.

  const keyboardMove = useCallback((itemId, dx, dy) => {
    const item = effectiveRef.current.find((l) => l.i === itemId);
    if (!item) return;
    const { x, y } = nudge(item, dx, dy, gridRef.current.activeCols);
    if (x === item.x && y === item.y) {
      announce(dx > 0 ? 'At the right edge' : dx < 0 ? 'At the left edge' : 'At the top');
      return;
    }
    const resolved = commitLayout(
      layoutRef.current.map((l) => (l.i === itemId ? { ...l, x, y } : l))
    );
    const f = resolved.find((l) => l.i === itemId) || { x, y };
    announce(`Moved to column ${f.x + 1}, row ${f.y + 1}`);
  }, [commitLayout, announce]);

  const keyboardResize = useCallback((itemId, dw, dh) => {
    const item = effectiveRef.current.find((l) => l.i === itemId);
    if (!item) return;
    const { w, h } = grow(item, dw, dh, gridRef.current.activeCols, getContentMinH(itemId));
    if (w === item.w && h === item.h) {
      announce(dw < 0 || dh < 0 ? 'At minimum size' : 'At maximum width');
      return;
    }
    const resolved = commitLayout(
      layoutRef.current.map((l) => (l.i === itemId ? { ...l, w, h } : l))
    );
    const f = resolved.find((l) => l.i === itemId) || { w, h };
    announce(`Resized to ${f.w} by ${f.h}`);
  }, [commitLayout, getContentMinH, announce]);

  const containerHeight = useMemo(() => {
    return getBottom(effectiveLayout) * (rowHeight + margin[1]) + margin[1];
  }, [effectiveLayout, rowHeight, margin]);

  // Cache styles for non-interacting items so React.memo can skip re-renders.
  // Only the actively dragged/resized item gets a new style object each frame.
  const styleCache = useRef({});

  if (!mounted || width === 0) {
    return <div ref={containerRef} className={`helmgrid ${className}`} />;
  }

  const dragId = interaction?.type === 'drag' ? interaction.itemId : null;
  const resizeId = interaction?.type === 'resize' ? interaction.itemId : null;

  // One column that can't be dragged or resized (a phone, a filtered board):
  // the panels in the page's flow, each at its own height. The same items
  // either way, so a change between the two keeps every panel mounted.
  const flow = breakpoint === 'sm' && !draggable && !resizable;

  return (
    <div
      ref={containerRef}
      className={`helmgrid${flow ? ' helmgrid-flow' : ''} ${className}`}
      style={
        flow
          ? {
              display: 'flex',
              flexDirection: 'column',
              gap: margin[1],
              padding: `${margin[1]}px ${margin[0]}px`,
            }
          : { position: 'relative', height: containerHeight }
      }
    >
      {(flow ? flowOrder(workingLayout) : effectiveLayout).map((item) => {
        const child = childMap[item.i];
        if (!child) return null;

        const isDragging = dragId === item.i;
        const isResizing = resizeId === item.i;

        let style;
        if (flow) {
          style = undefined;
        } else if (isDragging && interaction.pixelPos) {
          // Active drag — fresh style every frame (not cached)
          const pos = gridToPixel(item.x, item.y, item.w, item.h, cellWidth, rowHeight, margin);
          style = {
            position: 'absolute',
            left: interaction.pixelPos.left,
            top: interaction.pixelPos.top,
            width: pos.width, height: pos.height,
            transition: 'none',
            zIndex: 10, opacity: 0.85,
            boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
            cursor: 'grabbing', pointerEvents: 'none',
          };
        } else if (isResizing && interaction.placeholder) {
          // Render the live panel at the SNAPPED placeholder rect — the exact
          // same rectangle the dotted guideline draws — so the card, its resize
          // handle, and the guideline are always one shape and snap together
          // cell-by-cell. (Rendering the raw mouse-driven pixel size instead let
          // the guideline run past the panel.)
          const ph = gridToPixel(
            interaction.placeholder.x,
            interaction.placeholder.y,
            interaction.placeholder.w,
            interaction.placeholder.h,
            cellWidth,
            rowHeight,
            margin
          );
          style = {
            position: 'absolute',
            left: ph.left,
            top: ph.top,
            width: ph.width,
            height: ph.height,
            transition: 'none',
            zIndex: 10,
          };
        } else {
          // Static item — use cached style if position unchanged
          const pos = gridToPixel(item.x, item.y, item.w, item.h, cellWidth, rowHeight, margin);
          const key = `${item.i}-${pos.left}-${pos.top}-${pos.width}-${pos.height}`;
          if (!styleCache.current[item.i] || styleCache.current[item.i]._key !== key) {
            styleCache.current[item.i] = {
              _key: key,
              position: 'absolute',
              left: pos.left, top: pos.top, width: pos.width, height: pos.height,
              transition: 'left 150ms ease, top 150ms ease, width 150ms ease, height 150ms ease',
            };
          }
          style = styleCache.current[item.i];
        }

        return (
          <GridItem
            key={item.i}
            itemId={item.i}
            className={`helmgrid-item${isDragging ? ' helmgrid-dragging' : ''}${isResizing ? ' helmgrid-resizing' : ''}`}
            style={style}
            dragHandle={dragHandle}
            draggable={draggable}
            resizable={resizable}
            isDragging={isDragging}
            isResizing={isResizing}
            onDragStart={startDrag}
            onResizeStart={startResize}
            onContentHeight={handleContentHeight}
            measuring={!flow}
            gridX={item.x}
            gridY={item.y}
            gridW={item.w}
            gridH={item.h}
            gridLabel={labels[item.i]}
            onKeyboardMove={keyboardMove}
            onKeyboardResize={keyboardResize}
          >
            {child}
          </GridItem>
        );
      })}

      {interaction?.placeholder && (
        <div
          className="helmgrid-placeholder"
          style={{
            position: 'absolute',
            ...gridToPixel(
              interaction.placeholder.x, interaction.placeholder.y,
              interaction.placeholder.w, interaction.placeholder.h,
              cellWidth, rowHeight, margin
            ),
            transition: 'left 100ms ease, top 100ms ease, width 100ms ease, height 100ms ease',
          }}
        />
      )}

      {/* Polite live region: announces keyboard move/resize results to AT. */}
      <div className="sr-only" role="status" aria-live="polite">
        {announceText}
      </div>
    </div>
  );
}

/** The order of a one-column board, top to bottom: by row, then by column. */
function flowOrder(layout) {
  return [...layout].sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
}

/**
 * Where each panel's last measured height is kept, per browser: `{ [id]:
 * [width, height] }` in pixels, the height its content took at that width.
 */
export const HEIGHTS_PREF = 'jaghelm-grid-heights';

function readLastHeights() {
  try {
    const kept = JSON.parse(prefs.get(HEIGHTS_PREF, '{}'));
    return kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : {};
  } catch {
    return {};
  }
}

/** The height `item` last measured, when it is drawn at the same width now. */
function lastKnownHeight(lastKnown, item, cellWidth, margin) {
  const kept = lastKnown[item.i];
  if (!Array.isArray(kept) || !(cellWidth > 0)) return undefined;
  const width = Math.round(item.w * (cellWidth + margin[0]) - margin[0]);
  return kept[0] === width && kept[1] > 0 ? kept[1] : undefined;
}

/** Keeps the heights just measured (`batch`, id → px), each with its panel's width. */
function keepLastHeights(batch, layout, grid) {
  if (!(grid.cellWidth > 0)) return;
  const kept = readLastHeights();
  for (const [id, px] of Object.entries(batch)) {
    const item = layout.find((l) => l.i === id);
    if (!item) continue;
    const width = Math.round(item.w * (grid.cellWidth + grid.margin[0]) - grid.margin[0]);
    kept[id] = [width, px];
  }
  prefs.set(HEIGHTS_PREF, JSON.stringify(kept));
}
