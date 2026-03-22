import React, { useRef, useState, useEffect, useCallback } from 'react';

/**
 * PanelWrapper — Wraps any dashboard panel to measure its content height
 * and report the required minH (in grid rows) back to DashboardView.
 * 
 * Measurement strategy: We look at the first child element (the glass-card)
 * and measure its scrollHeight — this is the full content height even when
 * the card has overflow:hidden/auto. We convert this to grid rows.
 * 
 * Props:
 *   panelKey   — the grid layout key (e.g. 'node-gateway', 'ups', 'todos')
 *   onMinH     — callback: (panelKey, minRows) => void
 *   rowHeight  — RGL rowHeight (default 36)
 *   margin     — RGL margin (default 16)
 *   children   — the actual panel content
 */
export default function PanelWrapper({ panelKey, onMinH, rowHeight = 36, margin = 16, children }) {
  const wrapperRef = useRef(null);
  const [minRows, setMinRows] = useState(2);

  const calculate = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    // Find the inner content container — the node-card div that has the actual content
    // node-card uses flexbox column layout, so we need to measure the combined height
    // of all its children to know the true content height
    const card = wrapper.querySelector('.node-card');
    if (card) {
      const contentPx = card.scrollHeight;
      if (contentPx <= 0) return;
      // Convert pixel height to grid rows
      // Grid item height = (rowHeight * h) + (margin * (h - 1))
      // Solving for h: h = ceil((contentPx + margin) / (rowHeight + margin))
      const rows = Math.ceil((contentPx + margin) / (rowHeight + margin));
      const clamped = Math.max(2, rows);
      if (clamped !== minRows) {
        setMinRows(clamped);
      }
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
    const timer = setTimeout(calculate, 150);

    // Watch the wrapper for size changes (card reflow when panel is resized)
    const ro = new ResizeObserver(() => {
      calculate();
    });
    ro.observe(wrapper);

    // Also observe the inner card if it exists (content changes)
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
