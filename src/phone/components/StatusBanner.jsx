import React from 'react';
import { Banner } from '@ui/banner';
import { Skeleton } from '@ui/skeleton';

/**
 * Non-interactive status banner: shows a loading paragraph when loading and
 * no data yet, an error banner when the backend is unreachable, or nothing
 * when all is well. Token-styled with var(--red*) for errors.
 *
 * A placeholder (#303) while the cards are on their way, and a
 * Banner in the no-signal tone when their read fails, over the last cards it
 * had, or with none.
 */
export default function StatusBanner({ loading, error, hasData }) {
  if (loading && !hasData) {
    return (
      <div aria-busy="true">
        <span className="sr-only">Loading</span>
        <Skeleton className="h-14 rounded-xl" />
      </div>
    );
  }
  if (!error) return null;
  return (
    <Banner
      role="alert"
      tone="unknown"
      title="Couldn't reach JagHelm"
      cause={hasData ? 'Showing last known data' : 'Nothing to show until it answers'}
    />
  );
}
