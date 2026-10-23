import React from 'react';
import { Skeleton } from '@ui/skeleton';
import BackHeader from './BackHeader.jsx';
import { useSheetTitleId } from '../sheet.js';

/**
 * A detail's web look while what it shows is on its way (#303): Back and its
 * kind, "Loading…" as its title (it names the sheet), placeholders under it.
 * A module of its own (DetailParts.jsx re-exports it): the phone screens draw
 * it while the detail screens' chunk loads (src/shell/PhoneView.jsx, #309), so
 * a sheet never opens blank, with nothing to focus.
 */
export function DetailLoading({ kind, onBack }) {
  const id = useSheetTitleId();
  return (
    <>
      <BackHeader kind={kind} onBack={onBack} />
      <div data-slot="detail-loading" aria-busy="true" className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-0.5">
          <h2 id={id} className="text-title-lg text-text-3">
            Loading…
          </h2>
          <Skeleton className="h-4.5 w-36" />
        </div>
        <Skeleton className="h-19 rounded-xl" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
      </div>
    </>
  );
}
