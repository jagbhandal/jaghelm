/**
 * The Launch page (#301, spec §8 "Launch"): Quick Launch's link groups (every
 * group), Pipeline and the Checklist, at every width, at one URL (/launch), so
 * a bookmark, the sidebar's Tools and the phone's More sheet always find them.
 * From 1440px the Overview's rail shows the same panels (Utilities.jsx); this
 * page is where they live below that. It draws everything set up, whatever
 * the Overview's switches say: they are the Overview's. Quick Launch with no
 * link says where to add one; no Gitea, no Pipeline (spec §8). Its own chunk,
 * like the Alerts page. Weather, the clock and the web search come with #307.
 */
import { ShellPage } from '@ui/app-shell';
import { LaunchLayout } from '@ui/utilities';
import { useLinkGroups, usePipeline } from './utilities.js';
import { ChecklistPanel, PipelinePanel, QuickLaunchPanel } from './Utilities.jsx';

export default function LaunchPage() {
  const { groups, target } = useLinkGroups();
  const pipeline = usePipeline();
  return (
    <ShellPage title="Launch" description="Your links, recent commits and checklist.">
      <LaunchLayout
        quickLaunch={<QuickLaunchPanel groups={groups} target={target} withEmpty />}
        pipeline={pipeline.configured === true ? <PipelinePanel pipeline={pipeline} /> : null}
        checklist={<ChecklistPanel />}
      />
    </ShellPage>
  );
}
