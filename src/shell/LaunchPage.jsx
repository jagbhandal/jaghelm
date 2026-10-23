/**
 * The Launch page (#301, spec §8 "Launch"): Quick Launch's link groups (every
 * group), Pipeline and the Checklist, at every width, at one URL (/launch), so
 * a bookmark, the sidebar's Tools and the phone's More sheet always find them.
 * From 1440px the Overview's rail shows the same panels (OverviewRail.jsx); this
 * page is where they live below that. It draws everything set up, whatever
 * the Overview's switches say: they are the Overview's. Quick Launch with no
 * link says where to add one; no Gitea, no Pipeline (spec §8). Its own chunk,
 * like the Alerts page.
 *
 * At its top (#307), weather and the clock, as the rail has them, and the web
 * search, each when Settings has it on (Appearance, Apps & links; and the
 * weather a place).
 */
import { ShellPage } from '@ui/app-shell';
import { LaunchLayout } from '@ui/utilities';
import { useConfig } from '../context/ConfigContext.jsx';
import { useLinkGroups, usePipeline } from './utilities.js';
import { extrasShown, searchShown } from './extras.js';
import {
  ChecklistPanel,
  PipelinePanel,
  QuickLaunchPanel,
  WeatherClockPanel,
  WebSearchPanel,
} from './Utilities.jsx';

export default function LaunchPage() {
  const { config } = useConfig();
  const { groups, target } = useLinkGroups();
  const pipeline = usePipeline();
  return (
    <ShellPage
      title="Launch"
      description="Search the web, open your links, and see recent commits and your checklist."
    >
      <LaunchLayout
        extras={extrasShown(config) ? <WeatherClockPanel /> : null}
        search={searchShown(config) ? <WebSearchPanel /> : null}
        quickLaunch={<QuickLaunchPanel groups={groups} target={target} withEmpty />}
        pipeline={pipeline.configured === true ? <PipelinePanel pipeline={pipeline} /> : null}
        checklist={<ChecklistPanel />}
      />
    </ShellPage>
  );
}
