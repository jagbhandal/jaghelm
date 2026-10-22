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
 * Without a signal (a failed poll, or a status past its TTL), it follows the
 * one rule for a stale status (statusFreshness.js, #480): what the server
 * last said stays, so a blip doesn't blank the panel, but none of it in its
 * colour. The panel's lamp is the steel ring, its heading "No signal · last
 * known 20 min ago: Critical · 2 critical" (the header says the same words),
 * the line under it why ("Can't reach JagHelm"), and its rows keep their
 * words, reasons and ages, each with the steel ring. The age runs on the one
 * clock (useAgo), since nothing else changes while the polls fail. With no
 * status to show, a Banner says "No signal" and why. Before the first answer,
 * a placeholder.
 *
 *   titleAs   the panel's heading element: h2 under the page's own h1
 *   action    the panel's top-right element (the Overview's "All alerts")
 *   linkOf    entity -> { href, onOpen } for its row, or {} for a row that
 *             opens nothing; rows open nothing without it
 *   filter    a subsystem's id (the Overview's strip, #298): the rows are
 *             that subsystem's alone, and the panel says "Showing Nodes only"
 *             with Clear (`onClearFilter`); the heading and sentence stay
 *             the whole board's
 *   busyLabel what the placeholder says to a screen reader
 */
import { useSyncExternalStore } from 'react';
import { AttentionPanel } from '@ui/attention-panel';
import { Banner } from '@ui/banner';
import { Skeleton } from '@ui/skeleton';
import { countsText, issueRows, lastKnownLine } from './statusView.js';
import { drawnState, useStatusFreshness } from './statusFreshness.js';

export function ShellAttention({
  status,
  reach,
  updated,
  titleAs = 'h2',
  action,
  linkOf,
  filter = null,
  onClearFilter,
  busyLabel = 'Loading status',
}) {
  // Re-render on each answer, so the ages move with the clock.
  const at = useSyncExternalStore(updated.subscribe, updated.get);
  const freshness = useStatusFreshness({ status, reach, updated });
  const now = at ?? Date.now();
  const all = status?.issues ?? [];
  const shown = filter ? all.filter((i) => i.subsystem === filter) : all;
  const rows = issueRows({ issues: shown }, now).map((row) => ({
    ...row,
    state: drawnState(row.state, freshness),
  }));
  const issues = linkOf ? rows.map((row, i) => ({ ...row, ...linkOf(shown[i]) })) : rows;
  // Quiet is the whole board's, not the filter's.
  const quiet = all.length === 0;
  const filterName = filter
    ? (status?.subsystems?.find((s) => s.id === filter)?.name ?? filter)
    : undefined;
  const said = status
    ? freshness.stale
      ? {
          state: drawnState(status.overall.state, freshness),
          counts: lastKnownLine(freshness, status),
          subline: freshness.cause,
        }
      : {
          state: status.overall.state,
          counts: quiet ? status.overall.sentence : countsText(status.issues),
          subline: quiet ? undefined : status.overall.sentence,
        }
    : null;
  return (
    <>
      {freshness.stale && !status && (
        <Banner tone="unknown" title="No signal" cause={freshness.cause} />
      )}
      {reach === 'loading' && (
        <div aria-busy="true">
          <span className="sr-only">{busyLabel}</span>
          <Skeleton style={{ height: 80 }} />
        </div>
      )}
      {said && (
        <AttentionPanel
          titleAs={titleAs}
          state={said.state}
          counts={said.counts}
          subline={said.subline}
          action={action}
          issues={issues}
          filter={filterName}
          onClearFilter={filter ? onClearFilter : undefined}
        />
      )}
    </>
  );
}
