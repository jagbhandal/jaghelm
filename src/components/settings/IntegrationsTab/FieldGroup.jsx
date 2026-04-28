import React from 'react';

/**
 * FieldGroup — small label + optional hint wrapper used by ConfigView form rows.
 */
export default function FieldGroup({ label, hint, children }) {
  return (
    <div className="settings-stack-sm" style={{ gap: 6 }}>
      <span className="settings-item-subtitle" style={{ letterSpacing: 0.5 }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="settings-item-subtitle" style={{ fontSize: 10, opacity: 0.7 }}>
          {hint}
        </span>
      )}
    </div>
  );
}
