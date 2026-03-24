import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * HelmGrid v4 — Custom grid layout engine for JagHelm
 *
 * Content-aware panels: each panel auto-grows to fit its content.
 * User can make panels taller but not shorter than content.
 * Drag-to-reorder with snap-to-grid. Resize from SE/SW handles.
 *
 * Layout format: { lg: [{ i, x, y, w, h, minW, minH }], md: [...], sm: [...] }
 */

// ─── Grid Math ───────────────────────────────────────────────────────────────

function gridToPixel(x, y, w, h, cellW, rowH, gap) {
  return {
    left:   Math.round(x * (cellW + gap[0]) + gap[0]),
    top:    Math.round(y * (rowH  + gap[1]) + gap[1]),
    width:  Math.round(w * (cellW + gap[0]) - gap[0]),
    height: Math.round(h * (rowH  + gap[1]) - gap[1]),
  };
}

function pixelToGrid(px, py, cellW, rowH, gap, cols) {
  return {
    x: Math.max(0, Math.min(Math.round((px - gap[0]) / (cellW + gap[0])), cols - 1)),
    y: Math.max(0, Math.round((py - gap[1]) / (rowH + gap[1]))),
  };
}

function pixelSizeToGrid(pw, ph, cellW, rowH, gap) {
  return {
    w: Math.max(1, Math.round((pw + gap[0]) / (cellW + gap[0]))),
    h: Math.max(1, Math.round((ph + gap[1]) / (rowH + gap[1]))),
  };
}

/** Convert pixel height to grid rows (round UP so content isn't clipped) */
function pxToRows(px, rowH, gap) {
  return Math.ceil((px + gap[1]) / (rowH + gap[1]));
}

function calcCellWidth(containerWidth, cols, gap) {
  return (containerWidth - gap[0] * (cols + 1)) / cols;
}

function collides(a, b) {
  if (a.i === b.i) return false;
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function resolveOverlaps(layout) {
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

function getBottom(layout) {
  if (!layout || !layout.length) return 0;
  return Math.max(...layout.map(it => it.y + it.h));
}

function autoFitWidth(item, cols) {
  if (item.x + item.w > cols) {
    return { ...item, w: Math.max(item.minW || 2, cols - item.x) };
  }
  return item;
}

function layoutsEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const sA = [...a].sort((x, y) => x.i.localeCompare(y.i));
  const sB = [...b].sort((x, y) => x.i.localeCompare(y.i));
  return sA.every((it, i) =>
    it.i === sB[i].i && it.x === sB[i].x && it.y === sB[i].y && it.w === sB[i].w && it.h === sB[i].h
  );
}

// ─── GridItem — measures content and reports height ──────────────────────────

function GridItem({ itemId, style, className, dragHandle, draggable, resizable, isDragging, isResizing, onDragStart, onResizeStart, onContentHeight, children }) {
  const ref = useRef(null);
  const onContentHeightRef = useRef(onContentHeight);
  onContentHeightRef.current = onContentHeight;

  // Measure the natural content height (without flex stretch)
  // NOTE: deps intentionally exclude children — ResizeObserver handles content changes.
  // Including children caused the entire effect (including RO setup) to re-run on every
  // data refresh, which cascaded into setContentHeights → re-render → RO fires again.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let rafId = null;

    const measure = () => {
      const savedHeight = el.style.height;
      el.style.height = 'auto';
      const natural = el.scrollHeight;
      el.style.height = savedHeight;
      if (natural > 0) onContentHeightRef.current(itemId, natural);
    };

    const debouncedMeasure = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    };

    // Initial measure after paint
    rafId = requestAnimationFrame(measure);

    // Re-measure when children resize (e.g. service cards load, data refreshes)
    const ro = new ResizeObserver(debouncedMeasure);
    const content = el.firstElementChild;
    if (content) ro.observe(content);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={ref}
      className={className}
      style={style}
      onPointerDown={(e) => {
        if (!draggable) return;
        if (!e.target.closest(dragHandle)) return;
        e.preventDefault();
        onDragStart(e, itemId);
      }}
    >
      {children}
      {resizable && !isDragging && (
        <>
          <div
            className="helmgrid-resize-handle helmgrid-resize-handle-se"
            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onResizeStart(e, itemId, 'se'); }}
          />
          <div
            className="helmgrid-resize-handle helmgrid-resize-handle-sw"
            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onResizeStart(e, itemId, 'sw'); }}
          />
        </>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

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
    const bpLayout = layouts?.[breakpoint] || layouts?.lg || [];
    const clamped = bpLayout.map(item => {
      let { x, w } = item;
      if (w > activeCols) w = activeCols;
      if (x + w > activeCols) x = Math.max(0, activeCols - w);
      return (x !== item.x || w !== item.w) ? { ...item, x, w } : item;
    });
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

  // ── Effective layout — expand h to fit content where needed ──
  const effectiveLayout = useMemo(() => {
    return workingLayout.map(item => {
      const contentPx = contentHeights[item.i];
      if (!contentPx) return item;
      const contentRows = pxToRows(contentPx, rowHeight, margin);
      if (contentRows > item.h) {
        return { ...item, h: contentRows };
      }
      return item;
    });
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

    const onMove = (me) => {
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
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
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

    const onMove = (me) => {
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
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
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

  // ── Render ─────────────────────────────────────────────────────────────────

  const containerHeight = useMemo(() => {
    return getBottom(effectiveLayout) * (rowHeight + margin[1]) + margin[1];
  }, [effectiveLayout, rowHeight, margin]);

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
        const pos = gridToPixel(item.x, item.y, item.w, item.h, cellWidth, rowHeight, margin);

        const style = {
          position: 'absolute',
          left: pos.left, top: pos.top, width: pos.width, height: pos.height,
          transition: (isDragging || isResizing)
            ? 'none'
            : 'left 200ms ease, top 200ms ease, width 200ms ease, height 200ms ease',
        };

        if (isDragging && interaction.pixelPos) {
          Object.assign(style, {
            left: interaction.pixelPos.left,
            top: interaction.pixelPos.top,
            zIndex: 10, opacity: 0.85,
            boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
            cursor: 'grabbing', pointerEvents: 'none',
          });
        }

        if (isResizing && interaction.pixelSize) {
          style.width = interaction.pixelSize.width;
          style.height = interaction.pixelSize.height;
          if (interaction.handle === 'sw') style.left = interaction.pixelSize.left;
          style.zIndex = 10;
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
    </div>
  );
}
