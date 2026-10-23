/**
 * The utilities, wired (#301, spec §8 item 5): Quick Launch, Pipeline and the
 * Checklist, each one component (src/ui/utilities.jsx) fed from utilities.js,
 * and today's extras (#307): weather and the clock (WeatherClock), and the web
 * search, fed from extras.js. Drawn in two places, each a chunk of its own,
 * so a phone's first load carries none of them (#532):
 *
 *   OverviewRail    the Overview's utilities rail beside its sections from
 *                   1440px (OverviewLayout.jsx decides when, and loads it):
 *                   weather and the clock at its top, then the three.
 *   LaunchPage      /launch (LaunchPage.jsx): weather and the clock, the web
 *                   search, and the three, at every width: the one place a
 *                   phone or a narrow window finds them.
 */
import { useMemo } from 'react';
import { Banner } from '@ui/banner';
import { Button, buttonVariants } from '@ui/button';
import { EmptyState } from '@ui/empty-state';
import { Checklist, Pipeline, QuickLaunch, WeatherClock, WebSearch } from '@ui/utilities';
import { cn } from '@ui/lib/utils';
import { useConfig } from '../context/ConfigContext.jsx';
import { followLink } from '../router/useRoute.js';
import { pathTo } from '../router/routes.js';
import { shortcutLabel } from './shortcut.js';
import { useTodos } from './utilities.js';
import { clockShown, searchEngine, useClock, useWeather, webSearchUrl } from './extras.js';

const LINKS_SETTINGS = pathTo('settings', { section: 'apps' });
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
      description="Add the apps you open most in Settings → Apps & links."
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
 * Weather and the clock (#307), each as Settings → Appearance says: the weather
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
 * The web search (#307): the words go to Settings → Apps & links' engine, in a new
 * tab, as the old header's box sent them, with no opener.
 */
export function WebSearchPanel() {
  const { config } = useConfig();
  const engine = searchEngine(config);
  const search = (words) =>
    window.open(webSearchUrl(engine, words), '_blank', 'noopener,noreferrer');
  return <WebSearch engine={engine.name} onSearch={search} />;
}
