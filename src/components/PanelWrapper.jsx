import React, { useRef, useState, useEffect, useCallback } from 'react';

/**
 * PanelWrapper — Measures actual content height inside a panel and reports
 * the minimum grid rows needed back to DashboardView.
 * 
 * Measurement strategy:
 * The .node-card is a flexbox column with height:100% (stretched by RGL).
 * Its scrollHeight equals the container height, NOT the content height.
 * So we sum the offsetHeight of each direct child of .node-card plus
 * the card's padding and gaps. This gives the true natural content height
 * regardless of how tall RGL makes the container.
 */
export default function PanelWrapper({ panelKey, onMinH, rowHeight = 36, margin = 16, children }) {
  const wrapperRef = useRef(null);
  const [minRows, setMinRows] = useState(2);

  const calculate = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const card = wrapper.querySelector('.node-card');
    if (!card) return;

    // Sum the heights of all direct children of the card
    let contentPx = 0;
    const children = card.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      // offsetHeight includes the element's border and padding but not margin
      const style = window.getComputedStyle(child);
      const marginTop = parseFloat(style.marginTop) || 0;
      const marginBottom = parseFloat(style.marginBottom) || 0;
      contentPx += child.offsetHeight + marginTop + marginBottom;
    }

    // Add card padding (top + bottom)
    const cardStyle = window.getComputedStyle(card);
    const paddingTop = parseFloat(cardStyle.paddingTop) || 0;
    const paddingBottom = parseFloat(cardStyle.paddingBottom) || 0;
    contentPx += paddingTop + paddingBottom;

    // Add border from the glass-card parent (top border is 2px accent)
    contentPx += 4; // 2px top border + 2px safety

    if (contentPx <= 0) return;

    // Convert pixel height to grid rows
    // Grid item height = (rowHeight * h) + (margin * (h - 1))
    // Solving for h: h = ceil((contentPx + margin) / (rowHeight + margin))
    const rows = Math.ceil((contentPx + margin) / (rowHeight + margin));
    const clamped = Math.max(2, rows);
    if (clamped !== minRows) {
      setMinRows(clamped);
    }
  }, [rowHeight, margin, minRows]);

  useEffect(() => {
    if (onMinH) {
      onMinH(panelKey, minRows);
    }
  }, [panelKey, minRows, onMinH]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // Initial measurement after content renders
    const timer = setTimeout(calculate, 200);

    // Re-measure when the wrapper resizes (panel width change causes card reflow)
    const ro = new ResizeObserver(() => {
      calculate();
    });
    ro.observe(wrapper);

    // Also observe the inner card for content changes
    const card = wrapper.querySelector('.node-card');
    if (card) {
      ro.observe(card);
    }

    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, [calculate]);

  return (
    <div ref={wrapperRef} style={{ height: '100%' }}>
      {children}
    </div>
  );
}
