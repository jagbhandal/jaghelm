/**
 * The utilities, wired (#301, spec §8 item 5): Quick Launch, Pipeline and the
 * Checklist, each one component (src/ui/utilities.jsx) fed from utilities.js,
 * and today's extras (#307): weather and the clock (WeatherClock), and the web
 * search, fed from extras.js. Drawn in two places:
 *
 *   OverviewLayout  the Overview, with its utilities rail beside its sections
 *                   from 1440px (`RAIL_WIDTH`, @ui/app-shell): weather and
 *                   the clock at its top, then the three. Narrower, the
 *                   rail isn't rendered at all (not hidden by CSS), so nothing
 *                   is drawn twice or polled off screen. The rail keeps the
 *                   panels' switches (Settings → Sections: a panel switched
 *                   off stays off) and draws a panel only when its source is
 *                   set up: no links, no Quick Launch; no Gitea, no Pipeline;
 *                   no place, no weather. Settings → Appearance → Overview
 *                   sections can switch the whole rail off (`rail`,
 *                   overviewSections.js). Its Pipeline and weather read on
 *                   the App's refresh tick (`tick`, tickBudget.js).
 *   LaunchPage      /launch (LaunchPage.jsx): weather and the clock, the web
 *                   search, and the three, at every width: the one place a
 *                   phone or a narrow window finds them.
 *
 * The Overview's sections keep their place in the tree whether the rail shows
 * or not (the wrapper only changes its class), so crossing 1440px never
 * remounts them. The split's gutters are in global.css (`.overview-split`),
 * in line with the sections.
 */
import { useMemo } from 'react';
import { Banner } from '@ui/banner';
import { Button, buttonVariants } from '@ui/button';
import { EmptyState } from '@ui/empty-state';
import { RAIL_WIDTH, ShellSection } from '@ui/app-shell';
import {
  Checklist,
  Pipeline,
  QuickLaunch,
  UtilitiesRail,
  WeatherClock,
  WebSearch,
} from '@ui/utilities';
import { cn } from '@ui/lib/utils';
import { useConfig } from '../context/ConfigContext.jsx';
import { followLink } from '../router/useRoute.js';
import { pathTo } from '../router/routes.js';
import { shortcutLabel } from './shortcut.js';
import { useMediaQuery } from './useMediaQuery.js';
import { useLinkGroups, usePipeline, useTodos } from './utilities.js';
import {
  clockShown,
  extrasShown,
  searchEngine,
  useClock,
  useWeather,
  webSearchUrl,
} from './extras.js';
import { sectionShown } from './overviewSections.js';

const LINKS_SETTINGS = pathTo('settings', { section: 'links' });
const ADD_LINKS = cn(buttonVariants({ variant: 'secondary', size: 'sm' }));

/**
 * Quick Launch. `withEmpty` (the Launch page) says where to add links when
 * there are none; the rail draws no panel then.
 */
export function QuickLaunchPanel({ groups, target, withEmpty = false }) {
  const hint = useMemo(() => `in ${shortcutLabel()} too`, []);
  const empty = withEmpty ? (
    <EmptyState
      title="No links yet"
      description="Add the apps you open most in Settings → Links."
      action={
        <a
          href={LINKS_SETTINGS}
          className={ADD_LINKS}
          onClick={(e) => followLink(e, LINKS_SETTINGS)}
        >
          Add links
        </a>
      }
    />
  ) : null;
  return <QuickLaunch groups={groups} target={target} hint={hint} empty={empty} />;
}

/** Pipeline, from usePipeline's answer; a Banner over the last rows when the read failed. */
export function PipelinePanel({ pipeline }) {
  const banner = pipeline.failed ? (
    <Banner
      tone="unknown"
      title="Pipeline isn't updating"
      cause={
        pipeline.failed === 'HTTP 502' ? "Gitea didn't answer JagHelm" : "JagHelm didn't answer"
      }
      detail={pipeline.rows.length > 0 ? 'These are the last commits it had' : undefined}
    />
  ) : null;
  return <Pipeline items={pipeline.rows} banner={banner} />;
}

/** The Checklist, with its own /api/todos (useTodos). */
export function ChecklistPanel() {
  const { todos, failed, retry, add, toggle, remove } = useTodos();
  const banner =
    failed && todos == null ? (
      <Banner
        tone="unknown"
        title="Couldn't load the checklist"
        cause="JagHelm didn't answer"
        action={
          <Button variant="secondary" size="sm" onClick={retry}>
            Retry
          </Button>
        }
      />
    ) : null;
  return (
    <Checklist todos={todos} onAdd={add} onToggle={toggle} onRemove={remove} banner={banner} />
  );
}

/**
 * Weather and the clock (#307), each as Settings → Widgets says: the weather
 * read while it is drawn (useWeather; on the Overview, on the App's `tick`),
 * the clock on the minute.
 */
export function WeatherClockPanel({ tick = null }) {
  const { config } = useConfig();
  const clock = clockShown(config);
  const weather = useWeather({ tick });
  const now = useClock(clock);
  return <WeatherClock weather={weather} now={clock ? now : null} />;
}

/**
 * The web search (#307): the words go to Settings → Widgets' engine, in a new
 * tab, as the old header's box sent them, with no opener.
 */
export function WebSearchPanel() {
  const { config } = useConfig();
  const engine = searchEngine(config);
  const search = (words) =>
    window.open(webSearchUrl(engine, words), '_blank', 'noopener,noreferrer');
  return <WebSearch engine={engine.name} onSearch={search} />;
}

/** Which panels the rail draws: their switches, and a source set up. */
function railPanels(config, groups, pipeline) {
  const on = (key) => config?.sections?.[key]?.visible !== false;
  return {
    extras: extrasShown(config),
    quickLaunch: on('quicklaunch') && groups.length > 0,
    pipeline: on('pipeline') && pipeline.configured === true,
    checklist: on('todos'),
  };
}

/**
 * The Overview's frame: its sections (`children`), and from 1440px, while the
 * Overview is open (`open`) and its rail isn't switched off (Settings →
 * Appearance → Overview sections), the utilities rail beside them. `tick` is
 * the App's refresh tick, which times the rail's Pipeline and weather.
 */
export function OverviewLayout({ open, tick = null, children }) {
  const wide = useMediaQuery(RAIL_WIDTH);
  const { config } = useConfig();
  const { groups, target } = useLinkGroups();
  const shown = open && wide && sectionShown(config, 'rail');
  const pipeline = usePipeline({
    active: shown && config?.sections?.pipeline?.visible !== false,
    tick,
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
            <UtilitiesRail>
              {panels.extras ? <WeatherClockPanel tick={tick} /> : null}
              {panels.quickLaunch ? <QuickLaunchPanel groups={groups} target={target} /> : null}
              {panels.pipeline ? <PipelinePanel pipeline={pipeline} /> : null}
              {panels.checklist ? <ChecklistPanel /> : null}
            </UtilitiesRail>
          </ShellSection>
        </div>
      ) : null}
    </div>
  );
}
