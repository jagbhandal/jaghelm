import React from 'react';

/**
 * InlineError — a small themed, dismissible error region used in place of a
 * blocking alert(). role="alert" so assistive tech announces it immediately.
 */
export default function InlineError({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--red-bg)', border: '1px solid var(--red-border)',
        borderRadius: 10, padding: '8px 12px', marginBottom: 10,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
      <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--red)' }}>
        {message}
      </span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 2,
            color: 'var(--red)', fontSize: 14, flexShrink: 0, lineHeight: 1,
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
