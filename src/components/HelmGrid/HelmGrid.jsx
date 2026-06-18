import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
}) {
  // ── Container width ──
  const containerRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
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

  // ── Breakpoint ──
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

  // ── Working layout ──
  const [workingLayout, setWorkingLayout] = useState([]);
  const layoutRef = useRef(workingLayout);
  layoutRef.current = workingLayout;

  // ── Content heights — measured by GridItem, used for auto-grow ──
  const [contentHeights, setContentHeights] = useState({}); // itemId → pixels
  const contentHeightsRef = useRef({});
  const pendingHeightsRef = useRef(null); // batched updates

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
        }
      });
    }
    pendingHeightsRef.current[itemId] = px;
  }, []);

  // Sync from props with column clamping and overlap resolution
  const lastSyncedLayout = useRef(null);
  useEffect(() => {
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

  // ── Refs for grid params ──
  const gridRef = useRef({ cellWidth, rowHeight, margin, activeCols });
  gridRef.current = { cellWidth, rowHeight, margin, activeCols };

  // ── Child map ──
  const childMap = useMemo(() => {
    const map = {};
    React.Children.forEach(children, (child) => {
      if (child && child.key != null) {
        map[String(child.key).replace(/^\.\$/, '')] = child;
      }
    });
    return map;
  }, [children]);

  // ── Effective layout — expand h to fit content where needed, then resolve overlaps ──
  const effectiveLayout = useMemo(() => {
    const expanded = workingLayout.map(item => {
      const contentPx = contentHeights[item.i];
      if (!contentPx) return item;
      const contentRows = pxToRows(contentPx, rowHeight, margin);
      if (contentRows > item.h) {
        return { ...item, h: contentRows };
      }
      return item;
    });
    // Re-resolve overlaps after height expansion to prevent panels from overlapping
    return resolveOverlaps(expanded);
  }, [workingLayout, contentHeights, rowHeight, margin]);

  // Effective layout ref for handlers
  const effectiveRef = useRef(effectiveLayout);
  effectiveRef.current = effectiveLayout;

  // ── Content-aware minH for resize ──
  const getContentMinH = useCallback((itemId) => {
    const contentPx = contentHeightsRef.current[itemId];
    if (!contentPx) return 3; // fallback
    return pxToRows(contentPx, rowHeight, margin);
  }, [rowHeight, margin]);

  // ── Interaction state ──
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

  // ── Commit layout ──
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

  // ── Drag ───────────────────────────────────────────────────────────────────

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

  // ── Resize ─────────────────────────────────────────────────────────────────

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

  // ── Keyboard move / resize ───────────────────────────────────────────────────
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

  // ── Render ─────────────────────────────────────────────────────────────────

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

  return (
    <div
      ref={containerRef}
      className={`helmgrid ${className}`}
      style={{ position: 'relative', height: containerHeight }}
    >
      {effectiveLayout.map((item) => {
        const child = childMap[item.i];
        if (!child) return null;

        const isDragging = dragId === item.i;
        const isResizing = resizeId === item.i;

        let style;
        if (isDragging && interaction.pixelPos) {
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
        } else if (isResizing && interaction.pixelSize) {
          // Active resize — fresh style every frame
          const pos = gridToPixel(item.x, item.y, item.w, item.h, cellWidth, rowHeight, margin);
          style = {
            position: 'absolute',
            left: interaction.handle === 'sw' ? interaction.pixelSize.left : pos.left,
            top: pos.top,
            width: interaction.pixelSize.width,
            height: interaction.pixelSize.height,
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
