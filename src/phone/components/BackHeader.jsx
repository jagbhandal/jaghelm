import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { IconButton } from '@ui/icon-button';

/**
 * A detail screen's header (#303), the Phone board's sheet: a 44px Back
 * over the screen's top left and the kind of thing it shows (`kind`,
 * "Service") in an overline, on a bar that stays at the top while the sheet
 * scrolls; the screen draws its title under it.
 */
export default function BackHeader({ kind, onBack }) {
  return (
    <div
      data-slot="sheet-bar"
      className="sticky top-0 z-sticky flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-2"
    >
      <IconButton label="Back" onClick={onBack} className="size-11">
        <ChevronLeft aria-hidden="true" className="size-5" />
      </IconButton>
      {kind && <span className="text-overline text-text-3 uppercase">{kind}</span>}
    </div>
  );
}
