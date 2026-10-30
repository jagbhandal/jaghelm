/**
 * The Monitoring page's banner (#752, spec §4): the status model's issues that
 * have a chart on this page, each with a "View graph" link to
 * `/monitoring?focus=<chart-id>`, and, under them, "N other issues" with a
 * link to Alerts when there are issues no chart here answers (a node down, a
 * service down).
 *
 * It is ShellAttention over the header's poll (the same status, ages and stale
 * rule as the Overview's panel, ADR 0006's one severity table), kept to the
 * issues `chartOfIssue` maps to a chart the page draws (`drawn`, a Set of
 * chart ids). Healthy, or with issues none of whose charts is drawn, it draws
 * nothing at all: the page is just the charts. It also draws nothing before a
 * status has come: the header says the poll's failures.
 */
import { buttonVariants } from '@ui/button';
import { cn } from '@ui/lib/utils';
import { MonitoringBannerFrame, MonitoringOther } from '@ui/monitoring-section';
import { chartOfIssue, focusHref } from '../../server/monitoringFocus.js';
import { followLink, navigate } from '../router/useRoute.js';
import { pathTo } from '../router/routes.js';
import { ShellAttention } from './ShellAttention.jsx';

const ALERTS = pathTo('alerts');

/** The chart id issue `entity` opens, if the page draws it; else null. */
const chartHere = (entity, drawn) => {
  const id = chartOfIssue(entity);
  return id !== null && drawn.has(id) ? id : null;
};

const LINK = cn(buttonVariants({ variant: 'ghost', size: 'sm', tone: 'accent' }));

export function MonitoringBanner({ status, reach, updated, drawn }) {
  const all = status?.issues ?? [];
  const here = all.filter((i) => chartHere(i, drawn) !== null);
  if (here.length === 0) return null;
  const other = all.length - here.length;
  return (
    <MonitoringBannerFrame>
      <ShellAttention
        status={status}
        reach={reach}
        updated={updated}
        titleAs="h2"
        only={(issue) => chartHere(issue, drawn) !== null}
        linkOf={(issue) => {
          const href = focusHref(chartHere(issue, drawn), issue.id);
          return {
            action: { label: 'View graph', href, onOpen: () => navigate(href, { scroll: false }) },
          };
        }}
      />
      {other > 0 && (
        <MonitoringOther>
          <span>{other === 1 ? '1 other issue' : `${other} other issues`}</span>
          <a href={ALERTS} className={LINK} onClick={(e) => followLink(e, ALERTS)}>
            Alerts<span aria-hidden="true"> →</span>
          </a>
        </MonitoringOther>
      )}
    </MonitoringBannerFrame>
  );
}
