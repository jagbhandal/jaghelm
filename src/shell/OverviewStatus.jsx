/**
 * The top of the Overview (#297, spec §8 item 1): is anything wrong, what and
 * where, from the header's poll. With issues, the attention panel, its rows
 * leading to each entity's place on today's board below, when the board
 * draws it (entityAnchors.js), and "All alerts" to the Alerts page; with none, the quiet line. It shares
 * the wiring with the Alerts page (ShellAttention): no signal is a Banner over
 * the last status, and the first load a placeholder.
 *
 * It is the new UI over today's board, which later cards rebuild (#298–#300):
 * a root of its own (ShellSection) inside a wrapper that lines it up with the
 * board's cards (`.overview-status`, global.css). Memoised on the poll, so the
 * board's tick doesn't re-render it; each answer re-renders only its ages, and
 * a place coming onto the board or leaving it, only its links.
 */
import { memo } from 'react';
import { ShellSection } from '@ui/app-shell';
import { buttonVariants } from '@ui/button';
import { cn } from '@ui/lib/utils';
import { followLink } from '../router/useRoute.js';
import { pathTo } from '../router/routes.js';
import { ShellAttention } from './ShellAttention.jsx';
import { useRowLink } from './entityAnchors.js';

const ALERTS = pathTo('alerts');
// The panel's action, the mock's "All alerts →": a link drawn as an accent
// ghost button. Through cn, as Button does, so the accent text wins over the
// ghost's text-2.
const LINK = cn(buttonVariants({ variant: 'ghost', size: 'sm', tone: 'accent' }));

const allAlerts = (
  <a href={ALERTS} className={LINK} onClick={(e) => followLink(e, ALERTS)}>
    All alerts<span aria-hidden="true"> →</span>
  </a>
);

export const OverviewStatus = memo(function OverviewStatus({ status, reach, updated }) {
  const linkOf = useRowLink();
  return (
    <div className="overview-status" data-slot="overview-status">
      <ShellSection>
        <ShellAttention
          status={status}
          reach={reach}
          updated={updated}
          action={allAlerts}
          linkOf={linkOf}
        />
      </ShellSection>
    </div>
  );
});
