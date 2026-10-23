/**
 * The Overview's utilities rail (#301, #307): weather and the clock at its
 * top, then Quick Launch, Pipeline and the Checklist, each drawn when
 * OverviewLayout.jsx says (`panels`). A chunk of its own (lazyViews.js
 * loadOverviewRail, #532): only a window from 1440px draws the rail, so a
 * phone's first load doesn't carry the utilities' components.
 */
import { UtilitiesRail } from '@ui/utilities';
import {
  ChecklistPanel,
  PipelinePanel,
  QuickLaunchPanel,
  WeatherClockPanel,
} from './Utilities.jsx';

export default function OverviewRail({ panels, groups, target, pipeline }) {
  return (
    <UtilitiesRail>
      {panels.extras ? <WeatherClockPanel /> : null}
      {panels.quickLaunch ? <QuickLaunchPanel groups={groups} target={target} /> : null}
      {panels.pipeline ? <PipelinePanel pipeline={pipeline} /> : null}
      {panels.checklist ? <ChecklistPanel /> : null}
    </UtilitiesRail>
  );
}
