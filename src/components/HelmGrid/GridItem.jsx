import React, { useEffect, useRef } from 'react';

/**
 * GridItem — wraps a single grid cell. Two responsibilities:
 *   1. Measure natural content height via ResizeObserver, report up via onContentHeight.
 *      Skips measurement during active resize (the user is controlling height directly,
 *      and measuring mid-resize creates expensive reflow cascades).
 *   2. Render the cell with optional drag handle + SE/SW resize handles.
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
});

export default GridItem;
