/**
 * The phone's jobs list on the web (#578): under the nodes on the
 * Infrastructure tab, every scheduled job and backup as the desktop's Jobs
 * section lists them (jobsView.js, from the status alone), each row opening
 * its detail sheet. A job a Remove took off leaves at once (removedJobs.js).
 * Its own chunk (lazyViews.js), asked for when the tab draws, so the phone's
 * first screen doesn't carry it; it is the last thing on the tab, so it moves
 * nothing as it comes. The Android app draws none.
 */
import { useMemo } from 'react';
import { JobsList } from '@ui/jobs-section';
import { entityRoute } from '../phone/nav/entityRoute.js';
import { jobGroups, jobRows, jobsCount } from './jobsView.js';
import { useRemovedJobs, wasRemoved } from './removedJobs.js';
import { useStatusAt } from './statusFreshness.js';

export default function PhoneJobs({ data, nav }) {
  // The poll's freshness, as PhoneView judges it (statusFreshness.js).
  const freshness = data.freshness ?? null;
  const at = useStatusAt(data.updated);
  const held = useRemovedJobs(data.status);
  const { groups, count } = useMemo(() => {
    const rows = jobRows({
      status: data.status,
      freshness,
      at,
      hidden: (e) => wasRemoved(held, e),
    }).map((row) => ({
      ...row,
      onOpen: () => {
        const route = entityRoute(row.id);
        if (route) nav.push(route.screen, route.params);
      },
    }));
    return { groups: jobGroups(rows, { status: data.status }), count: jobsCount(rows, freshness) };
  }, [data.status, freshness, at, held, nav]);
  if (groups.length === 0) return null;
  return <JobsList data-slot="phone-jobs" groups={groups} count={count} />;
}
