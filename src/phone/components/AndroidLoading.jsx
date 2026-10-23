import React from 'react';
import BackHeader from './BackHeader.jsx';

/**
 * A detail screen's Android look while what it shows is on its way (#309): a
 * push tapped as the app starts opens its detail before the first poll has
 * answered, so the screen says "Loading…" until it has, never that the thing
 * is gone (data/detail.js detailLoading). The web look has its own
 * (DetailParts.jsx DetailLoading).
 */
export function AndroidLoading({ label, title, nav }) {
  return (
    <section className="mobile-view" aria-label={label} aria-busy="true">
      <BackHeader title={title} onBack={nav.pop} />
      <p className="mobile-view__todo">Loading…</p>
    </section>
  );
}
