import React from 'react';
import { Banner } from '@ui/banner';
import { Skeleton } from '@ui/skeleton';
import { StatusLamp } from '@ui/status-lamp';
import { StatusWord } from '@ui/status-word';
import { cn } from '@ui/lib/utils';
import { WORDS, lampName, toState } from '@ui/lib/status.js';
import BackHeader from './BackHeader.jsx';
import StatusBanner from './StatusBanner.jsx';
import { useSheetTitleId } from '../sheet.js';

/*
 * The parts of a detail screen's web look (#303), the Phone board's sheet:
 * its title and where it is, the status box, and the sheet while what it
 * shows is on its way or can't be read. The Android look draws its own
 * (BackHeader, the detail head).
 */

/** The title (it names the sheet), 22/28 at 800 as the mock's, over where the thing is. */
export function DetailTitle({ title, where }) {
  const id = useSheetTitleId();
  return (
    <div className="flex flex-col gap-0.5">
      <h2 id={id} className="text-title-lg wrap-anywhere">
        {title}
      </h2>
      {where && <p className="text-body-sm text-text-3">{where}</p>}
    </div>
  );
}

// The box takes its state's tint when it isn't healthy, as the strip's tiles
// do: a layer over surface-1, the pairing the contrast check holds its text-2
// and text-3 to (subsystem-strip.jsx).
const tint = {
  ok: '',
  warn: 'bg-linear-to-r from-warn-tint to-warn-tint',
  crit: 'bg-linear-to-r from-crit-tint to-crit-tint',
  unknown: 'bg-linear-to-r from-unknown-tint to-unknown-tint',
  maintenance: '',
};

/**
 * The status box: the lamp (16px, named by what it draws, as a row's), the
 * word in its colour, the model's reason under it, how long it has been so
 * (`since`, data/detail.js sinceLine's), and a caption (`note`: hosted services, readings)
 * under that.
 */
export function DetailStatus({ state, word, reason, since, note, shape }) {
  const s = toState(state);
  const said = word || WORDS[s];
  const named = lampName(s, said);
  return (
    <div
      data-slot="detail-status"
      data-state={s}
      className={cn('flex gap-3 rounded-xl border border-border bg-surface-1 p-3.5', tint[s])}
    >
      <StatusLamp
        state={s}
        shape={shape}
        size={16}
        label={named}
        decorative={named === said}
        className="mt-0.5"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <StatusWord state={s} word={said} className="font-extrabold" />
        {reason && <span className="text-text-2">{reason}</span>}
        {since && (
          <span data-slot="detail-since" className="text-caption text-text-3">
            {since}
          </span>
        )}
        {note && <span className="text-caption text-text-3">{note}</span>}
      </span>
    </div>
  );
}

/** The sheet while its thing is on its way: Back and its kind, "Loading…" as its title, placeholders under it. */
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

/**
 * The sheet when what it needs couldn't be read: with no status, "No signal"
 * and why (the Overview's banner); with no cards, the cards' read failing
 * (StatusBanner's). Never "no longer reported": nobody said so.
 */
export function DetailUnreachable({ kind, onBack, data }) {
  return (
    <>
      <BackHeader kind={kind} onBack={onBack} />
      <div className="flex flex-col gap-4 p-4">
        <DetailTitle title={kind} />
        {data.status ? (
          <StatusBanner loading={false} error={data.error ?? true} hasData={false} />
        ) : (
          <Banner tone="unknown" title="No signal" cause={data.freshness?.cause} />
        )}
      </div>
    </>
  );
}
