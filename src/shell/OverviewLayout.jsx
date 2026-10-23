/**
 * The Overview's frame (#301): its sections, and from 1440px (`RAIL_WIDTH`,
 * @ui/app-shell) the utilities rail beside them: weather and the clock at
 * its top, then Quick Launch, Pipeline and the Checklist (OverviewRail.jsx).
 * Narrower, the rail isn't rendered at all (not hidden by CSS), so nothing is
 * drawn twice or polled off screen. The rail keeps the board's switches
 * (Settings → Sections: a panel switched off stays off) and draws a panel
 * only when its source is set up: no links, no Quick Launch; no Gitea, no
 * Pipeline; no place, no weather. Settings → Appearance → Overview sections
 * can switch the whole rail off (`rail`, overviewSections.js). The Launch
 * page (LaunchPage.jsx) draws the same panels at every width.
 *
 * The rail's panels are a chunk of their own (#532), asked for when the rail
 * is first drawn: a phone never draws it, so its first load doesn't carry
 * them. Its column is laid out at once, the panels in it once the chunk is
 * in, so the sections beside it never move.
 *
 * The Overview's sections keep their place in the tree whether the rail shows
 * or not (the wrapper only changes its class), so crossing 1440px never
 * remounts today's board. The split's gutters are in global.css
 * (`.overview-split`), in line with the board's cards.
 */
import { RAIL_WIDTH, ShellSection } from '@ui/app-shell';
import { useConfig } from '../context/ConfigContext.jsx';
import { loadOverviewRail } from '../lazyViews.js';
import { extrasShown } from './extras.js';
import { sectionShown } from './overviewSections.js';
import { useChunk } from './useChunk.js';
import { useMediaQuery } from './useMediaQuery.js';
import { useLinkGroups, usePipeline } from './utilities.js';

/** Which panels the rail draws: the board's switches, and a source set up. */
function railPanels(config, groups, pipeline) {
  const on = (key) => config?.sections?.[key]?.visible !== false;
  return {
    extras: extrasShown(config),
    quickLaunch: on('quicklaunch') && groups.length > 0,
    pipeline: on('pipeline') && pipeline.configured === true,
    checklist: on('todos'),
  };
}

/** The rail's panels from their chunk (useChunk): nothing until it is in. */
function Rail(props) {
  const [OverviewRail] = useChunk(loadOverviewRail);
  return OverviewRail ? <OverviewRail {...props} /> : null;
}

/**
 * The Overview's frame: its sections (`children`), and from 1440px, while the
 * Overview is open (`open`) and its rail isn't switched off (Settings →
 * Appearance → Overview sections), the utilities rail beside them.
 */
export function OverviewLayout({ open, children }) {
  const wide = useMediaQuery(RAIL_WIDTH);
  const { config } = useConfig();
  const { groups, target } = useLinkGroups();
  const shown = open && wide && sectionShown(config, 'rail');
  const pipeline = usePipeline({
    active: shown && config?.sections?.pipeline?.visible !== false,
  });
  const panels = railPanels(config, groups, pipeline);
  const rail =
    shown && (panels.extras || panels.quickLaunch || panels.pipeline || panels.checklist);
  return (
    <div data-slot="overview-layout" className={rail ? 'overview-split' : undefined}>
      <div className="overview-main">{children}</div>
      {rail ? (
        <div className="overview-rail">
          <ShellSection>
            <Rail panels={panels} groups={groups} target={target} pipeline={pipeline} />
          </ShellSection>
        </div>
      ) : null}
    </div>
  );
}
