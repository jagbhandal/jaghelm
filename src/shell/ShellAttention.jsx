/**
 * The status model's attention panel, wired (#296, #297): what the Alerts page
 * and the top of the Overview both show, from the header's poll (useStatus's
 * `status`, `reach` and `updated`), so neither asks /api/status again.
 *
 * With issues, the panel: the status word and the counts ("Critical · 2
 * critical, 1 warning"), the model's sentence under them, and its issues,
 * worst first, as rows aged against the last answer. With none, the quiet
 * line with the model's sentence ("All systems normal · All 32 services up ·
 * 6 nodes healthy"); on an empty board, "Nothing monitored yet" (#449).
 *
 * Without a signal it says so, as a Banner, and still shows what the server
 * last said, so a blip doesn't blank the panel. Before the first answer, a
 * placeholder.
 *
 *   titleAs   the panel's heading element: h2 under the page's own h1
 *   action    the panel's top-right element (the Overview's "All alerts")
 *   linkOf    entity -> { href, onOpen } for its row, or {} for a row that
 *             opens nothing; rows open nothing without it
 *   busyLabel what the placeholder says to a screen reader
 */
import { useSyncExternalStore } from 'react';
import { AttentionPanel } from '@ui/attention-panel';
import { agoText, NO_SIGNAL } from '@ui/app-header';
import { Banner } from '@ui/banner';
import { Skeleton } from '@ui/skeleton';
import { countsText, issueRows } from './statusView.js';

export function ShellAttention({
  status,
  reach,
  updated,
  titleAs = 'h2',
  action,
  linkOf,
  busyLabel = 'Loading status',
}) {
  // Re-render on each answer, so the ages move with the clock.
  const at = useSyncExternalStore(updated.subscribe, updated.get);
  const now = at ?? Date.now();
  const rows = issueRows(status, now);
  const issues = linkOf ? rows.map((row, i) => ({ ...row, ...linkOf(status.issues[i]) })) : rows;
  const quiet = issues.length === 0;
  return (
    <>
      {reach !== 'ok' && reach !== 'loading' && (
        <Banner
          tone="unknown"
          title="No signal"
          cause={NO_SIGNAL[reach] ?? NO_SIGNAL.down}
          detail={
            status && at != null ? `This is what it said ${agoText(Date.now() - at)}.` : undefined
          }
        />
      )}
      {reach === 'loading' && (
        <div aria-busy="true">
          <span className="sr-only">{busyLabel}</span>
          <Skeleton style={{ height: 80 }} />
        </div>
      )}
      {status && (
        <AttentionPanel
          titleAs={titleAs}
          state={status.overall.state}
          counts={quiet ? status.overall.sentence : countsText(status.issues)}
          subline={quiet ? undefined : status.overall.sentence}
          action={action}
          issues={issues}
        />
      )}
    </>
  );
}
