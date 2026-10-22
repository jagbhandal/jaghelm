import React, { useEffect, useRef } from 'react';

// GridItem's own controls in the item, beside the panel: not its content.
const HANDLES = '.helmgrid-move-handle, .helmgrid-resize-handle';

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
 *   1. Measure natural content height and report it up via onContentHeight
 *      whenever the content or the width changes (ResizeObserver on every
 *      element in the panel, MutationObserver on its DOM). Skips measurement
 *      during an active resize (the user is controlling height directly, and
 *      measuring mid-resize creates expensive reflow cascades), and measures
 *      when it ends.
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
  const scheduleRef = useRef(null);

  // Measure the content's natural height (the item at height: auto, without
  // the flex stretch) and report it, after every change that can change it.
  //
  // The panel's own box can't say when that is: it is stretched to the item's
  // grid height (flex: 1), so when only its content gets shorter or taller the
  // box stays the same and a ResizeObserver on it is silent. The web fonts
  // swapping in after the last measure left a node panel a row too tall for
  // good (#498). So the observer watches every element in the panel: their
  // boxes change with the content (text rewrapped in a new font, an image
  // loaded, new data drawn), and the panel's with its width. A
  // MutationObserver re-measures on any change to the panel's DOM (a line
  // removed from a stretched card resizes no box) and keeps the watched
  // elements current. A measure skipped during a resize runs when it ends.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let rafId = null;
    let pending = false;

    const measure = () => {
      pending = false;
      if (isResizingRef.current) return; // the user sets the height; measured when they let go
      const savedHeight = el.style.height;
      el.style.height = 'auto';
      const natural = el.scrollHeight;
      el.style.height = savedHeight;
      if (natural > 0) onContentHeightRef.current(itemId, natural);
    };

    // One measure a frame, after every change before it.
    const schedule = () => {
      if (pending) return;
      pending = true;
      rafId = requestAnimationFrame(measure);
    };
    scheduleRef.current = schedule;

    const ro = new ResizeObserver(schedule);
    const watch = (node) => {
      if (node.nodeType !== Node.ELEMENT_NODE || node.matches(HANDLES)) return;
      ro.observe(node);
      for (const inner of node.querySelectorAll('*')) ro.observe(inner);
    };
    const unwatch = (node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      ro.unobserve(node);
      for (const inner of node.querySelectorAll('*')) ro.unobserve(inner);
    };
    // The panel, not the keyboard move handle that comes first in a draggable
    // item: watching only the 1 px handle missed every change after the first
    // measure (#248).
    for (const child of el.children) watch(child);

    const mo = new MutationObserver((records) => {
      let changed = false;
      for (const record of records) {
        const target =
          record.target.nodeType === Node.ELEMENT_NODE
            ? record.target
            : record.target.parentElement;
        // The item's own style (the layout, and the measure's height: auto)
        // and its handles' labels are not its content.
        if (target === el ? record.type === 'attributes' : target?.closest(HANDLES)) continue;
        for (const node of record.removedNodes) unwatch(node);
        for (const node of record.addedNodes) watch(node);
        changed = true;
      }
      if (changed) schedule();
    });
    mo.observe(el, { subtree: true, childList: true, characterData: true, attributes: true });

    schedule(); // the first measure, after paint

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      mo.disconnect();
      scheduleRef.current = null;
    };
  }, [itemId]);

  // The resize ended: measure, as the ones during it were skipped.
  const wasResizingRef = useRef(isResizing);
  useEffect(() => {
    if (wasResizingRef.current && !isResizing) scheduleRef.current?.();
    wasResizingRef.current = isResizing;
  }, [isResizing]);

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
