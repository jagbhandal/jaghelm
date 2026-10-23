/*
 * The utilities (spec §8 item 5, #301): Quick Launch, Pipeline and the
 * Checklist, the mock's right-hand column. Each is one Panel, drawn the same
 * in the Overview's rail (from 1440px, UtilitiesRail) and on the Launch page
 * (at every width, LaunchLayout); src/shell/ feeds the same component to
 * both. They show what they are given and fetch nothing.
 *
 *   QuickLaunch  the link groups, each an overline over its links, as many
 *                to a row as the room allows (two in the rail, links of at
 *                least 10rem once a group has 32rem); a link is the app's
 *                monogram chip (AppChip, the sidebar's) and its name. `hint`
 *                ("in Ctrl K too") at the header's end. With no group it
 *                shows `empty` (the Launch page's EmptyState), and no hint.
 *   Pipeline     the newest commits, each its CI lamp (#532), its message
 *                over "repo · branch · sha" and its age ("12 m"); `banner`
 *                over them when the source is failing; "No recent commits"
 *                when there are none. The lamp is the row's state, named by
 *                its word ("Failed"), as the mock draws it; a row with no CI
 *                result has none, and with none on any row there is no lamp
 *                column.
 *   Checklist    the to-dos: a row to add one (a due day is optional; one
 *                row from 24rem of its own, else the task over the day and
 *                Add, as in the rail), and
 *                each one's box, words, due day ("overdue" in warn's word
 *                colour once it has passed) and Delete. `todos` null is still
 *                loading: placeholder lines, and nothing to add to yet, so an
 *                add can't save over a list that never came.
 *
 *   WeatherClock the weather and the clock (#307, the mock's "Weather and
 *                time" card): the reading's icon, "48°F · Overcast" over its
 *                place, and at the row's end the time over the day, both in
 *                the browser's locale. Either can be left out; with neither,
 *                nothing. The weather is `{ temperature, condition, code,
 *                place }`, or `{ loading }` (a placeholder) or `{ failed }`
 *                ("No weather reading") before a reading came.
 *   WebSearch    a search box for the web (#307): the words, trimmed, go to
 *                `onSearch`, and the field empties; empty words do nothing.
 *
 * UtilitiesRail is the rail's column, the panels 16px apart; LaunchLayout the
 * Launch page's: weather and the clock, then the web search, across the top
 * (side by side when there is room), Quick Launch under them, and Pipeline and
 * the Checklist under it, side by side from 672px of its own width.
 */
import { useId, useState } from 'react';
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  GitBranch,
  ListChecks,
  Plus,
  Rocket,
  Search,
  Snowflake,
  Sun,
  Thermometer,
  X,
} from 'lucide-react';
import { Panel } from './panel.jsx';
import { EmptyState } from './empty-state.jsx';
import { Input } from './input.jsx';
import { Button } from './button.jsx';
import { IconButton } from './icon-button.jsx';
import { Checkbox } from './checkbox.jsx';
import { Skeleton } from './skeleton.jsx';
import { AppChip } from './side-nav.jsx';
import { StatusLamp } from './status-lamp.jsx';
import { cn } from './lib/utils.js';

/** How long ago `ms` was, as the mock's Pipeline says it: "now", "12 m", "3 h", "4 d". */
export function shortAgo(ms) {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

function LinkGroup({ group, target }) {
  const titleId = useId();
  return (
    <div data-slot="link-group" className="@container flex flex-col gap-1.5">
      <h3 id={titleId} className="text-overline text-text-3 uppercase">
        {group.title}
      </h3>
      <ul
        aria-labelledby={titleId}
        className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-1.5 @lg:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]"
      >
        {group.links.map((link) => (
          <li key={link.id} className="min-w-0">
            <a
              href={link.href}
              target={target}
              rel="noopener noreferrer"
              title={link.name}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-body-sm font-medium text-text-1 transition-colors hover:bg-row-hover"
            >
              <AppChip text={link.monogram} />
              <span className="truncate">{link.name}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuickLaunch({ groups, target = '_blank', hint, empty = null, className, ...props }) {
  return (
    <Panel
      data-slot="quick-launch"
      title="Quick Launch"
      icon={<Rocket />}
      actions={
        hint != null && groups.length > 0 ? (
          <span className="font-mono text-caption text-text-3">{hint}</span>
        ) : null
      }
      className={className}
      {...props}
    >
      {groups.length === 0
        ? empty
        : groups.map((group) => <LinkGroup key={group.key} group={group} target={target} />)}
    </Panel>
  );
}

function Pipeline({ items, banner = null, now = Date.now(), className, ...props }) {
  const lamps = items.some((item) => item.state != null);
  return (
    <Panel
      data-slot="pipeline"
      title="Pipeline"
      icon={<GitBranch />}
      className={className}
      {...props}
    >
      {banner}
      {items.length > 0 ? (
        <ul className="flex flex-col gap-2.5">
          {items.map((item) => (
            <li
              key={item.id}
              data-slot="pipeline-row"
              className={cn(
                'grid items-start gap-2.5',
                lamps ? 'grid-cols-[10px_minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)_auto]'
              )}
            >
              {lamps ? (
                // On the title's first line.
                <span className="flex h-[18px] items-center">
                  {item.state != null ? <StatusLamp state={item.state} label={item.word} /> : null}
                </span>
              ) : null}
              <span className="flex min-w-0 flex-col">
                <span className="line-clamp-2 text-body-sm font-semibold break-words text-text-1">
                  {item.title}
                </span>
                <span className="truncate text-caption text-text-3">
                  {item.repo} · {item.ref ? `${item.ref} · ` : null}
                  <span className="font-mono">{item.sha}</span>
                </span>
              </span>
              {item.at != null ? (
                <time
                  dateTime={new Date(item.at).toISOString()}
                  className="text-caption whitespace-nowrap text-text-3"
                >
                  {shortAgo(now - item.at)}
                  <span className="sr-only"> ago</span>
                </time>
              ) : null}
            </li>
          ))}
        </ul>
      ) : banner ? null : (
        <EmptyState size="sm" title="No recent commits" className="px-0 py-1" />
      )}
    </Panel>
  );
}

function TodoRow({ todo, onToggle, onRemove }) {
  return (
    <li data-slot="todo" data-done={todo.done ? '' : undefined} className="flex items-center gap-2">
      <label className="flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-body-sm text-text-1">
        <Checkbox checked={todo.done} onCheckedChange={() => onToggle(todo.id)} />
        <span className={cn('min-w-0 break-words', todo.done && 'text-text-3 line-through')}>
          {todo.text}
        </span>
      </label>
      {todo.dueLabel ? (
        <span
          className={cn(
            'text-caption whitespace-nowrap',
            todo.overdue ? 'font-semibold text-warn-fg' : 'text-text-3'
          )}
        >
          {todo.dueLabel}
          {todo.overdue ? ' · overdue' : null}
        </span>
      ) : null}
      <IconButton label={`Delete “${todo.text}”`} size="sm" onClick={() => onRemove(todo.id)}>
        <X />
      </IconButton>
    </li>
  );
}

function Checklist({ todos, onAdd, onToggle, onRemove, banner = null, className, ...props }) {
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const loading = todos == null;
  const open = loading ? null : todos.filter((t) => !t.done).length;
  const add = (event) => {
    event.preventDefault();
    const words = text.trim();
    if (!words || loading) return;
    onAdd({ text: words, due: due || null });
    setText('');
    setDue('');
  };
  return (
    <Panel
      data-slot="checklist"
      title="Checklist"
      icon={<ListChecks />}
      actions={open != null ? <span className="text-caption text-text-3">{open} open</span> : null}
      aria-busy={loading && !banner ? true : undefined}
      className={className}
      {...props}
    >
      {banner}
      {loading ? (
        banner ? null : (
          <div className="flex flex-col gap-2.5">
            <span className="sr-only">Loading the checklist</span>
            <Skeleton className="h-control" />
            <Skeleton className="h-4" />
            <Skeleton className="h-4" />
          </div>
        )
      ) : (
        <>
          <form onSubmit={add} className="@container">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 @sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
              <Input
                aria-label="New task"
                placeholder="Add a task"
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="col-span-2 @sm:col-span-1"
              />
              <Input
                type="date"
                aria-label="Due day (optional)"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
              <Button type="submit" variant="secondary">
                <Plus />
                Add
              </Button>
            </div>
          </form>
          {todos.length > 0 ? (
            <ul aria-label="Tasks" className="flex flex-col gap-0.5">
              {todos.map((todo) => (
                <TodoRow key={todo.id} todo={todo} onToggle={onToggle} onRemove={onRemove} />
              ))}
            </ul>
          ) : (
            <EmptyState size="sm" title="Nothing on the list" className="px-0 py-1" />
          )}
        </>
      )}
    </Panel>
  );
}

// A WMO weather code's icon (open-meteo's `weather_code`): clear, partly
// cloudy, overcast, fog, drizzle, rain, snow, thunder; any other, a thermometer.
function weatherIcon(code) {
  if (code === 0) return Sun;
  if (code === 1 || code === 2) return CloudSun;
  if (code === 3) return Cloud;
  if (code === 45 || code === 48) return CloudFog;
  if (code >= 51 && code <= 57) return CloudDrizzle;
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return CloudRain;
  if (code === 75 || code === 86) return Snowflake;
  if ((code >= 71 && code <= 77) || code === 85) return CloudSnow;
  if (code >= 95 && code <= 99) return CloudLightning;
  return Thermometer;
}

const CLOCK_TIME = { hour: '2-digit', minute: '2-digit' };
const CLOCK_DAY = { weekday: 'short', day: 'numeric', month: 'short' };

function WeatherPart({ weather }) {
  const reading = weather.temperature != null;
  const Icon = reading ? weatherIcon(weather.code) : Thermometer;
  return (
    <div data-slot="weather" className="flex min-w-0 flex-1 items-center gap-3">
      {weather.loading ? (
        <div className="flex flex-1 flex-col gap-1.5">
          <span className="sr-only">Loading the weather</span>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      ) : (
        <>
          <Icon aria-hidden="true" className="size-5 shrink-0 stroke-[1.75] text-text-2" />
          <span className="flex min-w-0 flex-col">
            <span className="text-body font-bold text-text-1">
              {reading
                ? `${weather.temperature}${weather.condition ? ` · ${weather.condition}` : ''}`
                : 'No weather reading'}
            </span>
            {weather.place ? (
              <span className="truncate text-caption text-text-3">{weather.place}</span>
            ) : null}
          </span>
        </>
      )}
    </div>
  );
}

function ClockPart({ now }) {
  const at = new Date(now);
  return (
    <span data-slot="clock" className="ml-auto flex shrink-0 flex-col items-end">
      <time dateTime={at.toISOString()} className="text-title-sm text-text-1 tabular-nums">
        {at.toLocaleTimeString(undefined, CLOCK_TIME)}
      </time>
      <span className="text-caption text-text-3">
        {at.toLocaleDateString(undefined, CLOCK_DAY)}
      </span>
    </span>
  );
}

function WeatherClock({ weather = null, now = null, className, ...props }) {
  if (weather == null && now == null) return null;
  const name = weather && now != null ? 'Weather and time' : weather ? 'Weather' : 'Time';
  return (
    <Panel
      data-slot="weather-clock"
      aria-label={name}
      aria-busy={weather?.loading ? true : undefined}
      className={cn('px-4 py-3.5', className)}
      {...props}
    >
      <div className="flex items-center gap-3">
        {weather ? <WeatherPart weather={weather} /> : null}
        {now != null ? <ClockPart now={now} /> : null}
      </div>
    </Panel>
  );
}

function WebSearch({ engine, onSearch, className, ...props }) {
  const [words, setWords] = useState('');
  const search = (event) => {
    event.preventDefault();
    const query = words.trim();
    if (!query) return;
    onSearch(query);
    setWords('');
  };
  return (
    <form
      role="search"
      aria-label="Web search"
      data-slot="web-search"
      onSubmit={search}
      className={cn('flex min-w-0 items-center gap-2', className)}
      {...props}
    >
      <div className="relative min-w-0 flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 stroke-[1.75] text-text-3"
        />
        <Input
          type="search"
          enterKeyHint="search"
          aria-label={`Search the web with ${engine}`}
          placeholder={`Search ${engine}`}
          value={words}
          onChange={(e) => setWords(e.target.value)}
          className="pl-8"
        />
      </div>
      <Button type="submit" variant="secondary">
        Search
      </Button>
    </form>
  );
}

function UtilitiesRail({ className, children, ...props }) {
  return (
    <section
      aria-label="Utilities"
      data-slot="utilities-rail"
      className={cn('flex min-w-0 flex-col gap-4', className)}
      {...props}
    >
      {children}
    </section>
  );
}

function LaunchLayout({
  extras = null,
  search = null,
  quickLaunch = null,
  pipeline = null,
  checklist = null,
  className,
}) {
  return (
    <div data-slot="launch-layout" className={cn('@container', className)}>
      <div className="grid grid-cols-1 items-start gap-6 @2xl:grid-cols-2">
        {extras || search ? (
          <div
            data-slot="launch-top"
            className="flex min-w-0 flex-wrap items-center gap-4 @2xl:col-span-2"
          >
            {extras ? <div className="min-w-0 flex-[1_1_16rem]">{extras}</div> : null}
            {search ? <div className="min-w-0 flex-[2_1_20rem]">{search}</div> : null}
          </div>
        ) : null}
        {quickLaunch ? <div className="min-w-0 @2xl:col-span-2">{quickLaunch}</div> : null}
        {pipeline}
        {checklist}
      </div>
    </div>
  );
}

export { QuickLaunch, Pipeline, Checklist, WeatherClock, WebSearch, UtilitiesRail, LaunchLayout };
