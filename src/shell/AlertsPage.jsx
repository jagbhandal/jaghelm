/**
 * The Alerts page (#296): the status model's active issues, worst first, as
 * the attention panel and its issue rows draw them (ShellAttention, which the
 * Overview's top shares, #297). Its history (persisted events, #267) and
 * filters come with Phase 2 (#314). Rows open nothing yet: entity URLs are
 * Phase 2's (#309).
 *
 * Without a signal it says so, as a Banner, and still shows what the server
 * last said, so a blip doesn't blank the list.
 */
import { ShellPage } from '@ui/app-shell';
import { ShellAttention } from './ShellAttention.jsx';

export default function AlertsPage({ status, reach, updated }) {
  return (
    <ShellPage title="Alerts" description="What needs attention now, worst first.">
      <ShellAttention status={status} reach={reach} updated={updated} busyLabel="Loading alerts" />
    </ShellPage>
  );
}
