/**
 * The Alerts page (#296): the status model's active issues, worst first, as
 * the attention panel and its issue rows draw them. Its history (persisted
 * events, #267) and filters come with Phase 2 (#314). Rows open nothing yet:
 * entity URLs are Phase 2's (#309).
 *
 * Without a signal it says so, as a Banner, and still shows what the server
 * last said, so a blip doesn't blank the list.
 */
import { useSyncExternalStore } from 'react';
import { AttentionPanel } from '@ui/attention-panel';
import { agoText, NO_SIGNAL } from '@ui/app-header';
import { Banner } from '@ui/banner';
import { ShellPage } from '@ui/app-shell';
import { Skeleton } from '@ui/skeleton';
import { countsText, issueRows } from './statusView.js';

export default function AlertsPage({ status, reach, updated }) {
  // Re-render on each answer, so the ages move with the clock.
  const at = useSyncExternalStore(updated.subscribe, updated.get);
  const now = at ?? Date.now();
  const issues = issueRows(status, now);
  const quiet = issues.length === 0;
  return (
    <ShellPage title="Alerts" description="What needs attention now, worst first.">
      {reach !== 'ok' && reach !== 'loading' && (
        <Banner
          tone="unknown"
          title="No signal"
          cause={NO_SIGNAL[reach] ?? NO_SIGNAL.down}
          detail={status && at != null ? `This is what it said ${agoText(Date.now() - at)}.` : undefined}
        />
      )}
      {reach === 'loading' && (
        <div aria-busy="true">
          <span className="sr-only">Loading alerts</span>
          <Skeleton style={{ height: 80 }} />
        </div>
      )}
      {status && (
        <AttentionPanel
          titleAs="h2"
          state={status.overall.state}
          counts={quiet ? status.overall.sentence : countsText(status.issues)}
          subline={quiet ? undefined : status.overall.sentence}
          issues={issues}
        />
      )}
    </ShellPage>
  );
}
