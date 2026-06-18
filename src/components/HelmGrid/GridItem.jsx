import React, { useEffect, useRef } from 'react';

// Arrow key → [dx, dy] in grid cells. Hoisted to module scope so it isn't
// re-allocated on every render of this memo'd component.
const ARROW_DELTAS = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

/**
 * GridItem — wraps a single grid cell. Two responsibilities:
 *   1. Measure natural content height via ResizeObserver, report up via onContentHeight.
 *      Skips measurement during active resize (the user is controlling height directly,
 *      and measuring mid-resize creates expensive reflow cascades).
 *   2. Render the cell with optional drag handle + SE/SW resize handles + a
 *      keyboard move/resize handle.
 */
const GridItem = React.memo(function GridItem({
  itemId,
  style,
  className,
  dragHandle,
  draggable,
  resizable,
  isDragging,
  isResizing,
  onDragStart,
  onResizeStart,
  onContentHeight,
  gridX,
  gridY,
  gridW,
  gridH,
  gridLabel,
  onKeyboardMove,
  onKeyboardResize,
  children,
}) {
  const ref = useRef(null);
  const onContentHeightRef = useRef(onContentHeight);
  onContentHeightRef.current = onContentHeight;
  const isResizingRef = useRef(false);
  isResizingRef.current = isResizing;

  // Measure the natural content height (without flex stretch)
  // NOTE: deps intentionally exclude children — ResizeObserver handles content changes.
  // Skips measurement while this item is actively being resized — the user is controlling
  // height directly, and measuring mid-resize creates expensive reflow cascades.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let rafId = null;

    const measure = () => {
      if (isResizingRef.current) return; // Skip during active resize
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

  // Keyboard equivalent of pointer drag/resize: arrows move the panel by a cell,
  // Shift+arrows resize it. Lives on a dedicated handle button (below) so it
  // can't steal arrow keys from focusable content inside the panel.
  const onHandleKeyDown = (e) => {
    const delta = ARROW_DELTAS[e.key];
    if (!delta) return;
    e.preventDefault();
    const [d1, d2] = delta;
    if (e.shiftKey) {
      if (resizable) onKeyboardResize(itemId, d1, d2);
    } else {
      onKeyboardMove(itemId, d1, d2);
    }
  };

  const panelName = gridLabel || 'this panel';

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
      {draggable && gridX != null && (
        // Keyboard move/resize handle — visually hidden until focused (mouse
        // users drag the section header instead), so this adds no visual chrome.
        <button
          type="button"
          className="helmgrid-move-handle"
          aria-label={`Reposition ${panelName} — column ${gridX + 1}, row ${gridY + 1}, ${gridW} by ${gridH} cells. Arrow keys move${resizable ? '; Shift plus arrow keys resize' : ''}.`}
          aria-keyshortcuts={`ArrowUp ArrowDown ArrowLeft ArrowRight${resizable ? ' Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight' : ''}`}
          onKeyDown={onHandleKeyDown}
        >
          <span aria-hidden="true">⠿</span>
        </button>
      )}
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
});

export default GridItem;
