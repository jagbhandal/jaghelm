import React from 'react';
import { StatusLamp } from '@ui/status-lamp';
import { StatusWord } from '@ui/status-word';
import { cn } from '@ui/lib/utils';
import { WORDS, lampName, toState } from '@ui/lib/status.js';
import { useSheetTitleId } from '../sheet.js';

/*
 * The parts of a detail screen's web look (#303), the Phone board's sheet:
 * its title and where it is, and the status box. The Android look draws its
 * own (BackHeader, the detail head).
 */

/** The title (it names the sheet) over where the thing is. */
export function DetailTitle({ title, where }) {
  const id = useSheetTitleId();
  return (
    <div className="flex flex-col gap-0.5">
      <h2 id={id} className="text-headline wrap-anywhere">
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
 * The status box: the lamp (named by what it draws, as a row's), the word in
 * its colour, the model's reason under it, and a caption (`note`: hosted
 * services, readings) under that.
 */
export function DetailStatus({ state, word, reason, note, shape }) {
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
        size="lg"
        label={named}
        decorative={named === said}
        className="mt-0.75"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <StatusWord state={s} word={said} className="font-extrabold" />
        {reason && <span className="text-text-2">{reason}</span>}
        {note && <span className="text-caption text-text-3">{note}</span>}
      </span>
    </div>
  );
}
