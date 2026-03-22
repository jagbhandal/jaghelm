import React from 'react';
import { useDroppable } from '@dnd-kit/core';

/**
 * DroppablePanel — Wraps a panel to make it a drop target for service cards.
 * 
 * Shows a visual indicator when a card is being dragged over this panel.
 * 
 * Props:
 *   panelId   — string identifying this panel (e.g. 'node-production', 'group-abc')
 *   children  — the panel content
 *   disabled  — if true, panel is not a drop target
 */
export default function DroppablePanel({ panelId, children, disabled }) {
  const { isOver, setNodeRef, active } = useDroppable({
    id: `panel-${panelId}`,
    data: { panelId },
    disabled: disabled || false,
  });

  // Only show drop indicator if something is being dragged AND it's not from this panel
  const sourcePanel = active?.data?.current?.sourcePanel;
  const showIndicator = isOver && active && sourcePanel !== panelId;

  return (
    <div
      ref={setNodeRef}
      style={{
        height: '100%',
        position: 'relative',
        transition: 'outline 0.15s',
        outline: showIndicator ? '2px dashed var(--accent)' : '2px dashed transparent',
        outlineOffset: -2,
        borderRadius: 'var(--card-radius)',
      }}
    >
      {children}
      {showIndicator && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(99, 102, 241, 0.06)',
          borderRadius: 'var(--card-radius)',
          pointerEvents: 'none',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--accent)',
            background: 'var(--bg-card)',
            padding: '4px 12px',
            borderRadius: 8,
            border: '1px solid var(--accent)',
          }}>
            Drop here
          </span>
        </div>
      )}
    </div>
  );
}
