import React from 'react';

/** Detail-screen header: a bottom-reachable back button + a title. */
export default function BackHeader({ title, onBack }) {
  return (
    <div className="back-header">
      <button type="button" className="back-header__btn" onClick={onBack} aria-label="Back">‹ Back</button>
      <h1 className="back-header__title">{title}</h1>
    </div>
  );
}
