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
 *   Pipeline     the newest commits, each its message over "repo · sha" and
 *                its age ("12 m"); `banner` over them when the source is
 *                failing; "No recent commits" when there are none.
 *   Checklist    the to-dos: a field to add one (a due day is optional), and
 *                each one's box, words, due day ("overdue" in warn's word
 *                colour once it has passed) and Delete. `todos` null is still
 *                loading: placeholder lines, and nothing to add to yet, so an
 *                add can't save over a list that never came.
 *
 * UtilitiesRail is the rail's column, the panels 16px apart; LaunchLayout the
 * Launch page's: Quick Launch across the top, Pipeline and the Checklist under
 * it, side by side from 672px of its own width.
 */
import { useId, useState } from 'react';
import { GitBranch, ListChecks, Plus, Rocket, X } from 'lucide-react';
import { Panel } from './panel.jsx';
import { EmptyState } from './empty-state.jsx';
import { Input } from './input.jsx';
import { Button } from './button.jsx';
import { IconButton } from './icon-button.jsx';
import { Checkbox } from './checkbox.jsx';
import { Skeleton } from './skeleton.jsx';
import { AppChip } from './side-nav.jsx';
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
              className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2.5"
            >
              <span className="flex min-w-0 flex-col">
                <span className="line-clamp-2 text-body-sm font-semibold break-words text-text-1">
                  {item.title}
                </span>
                <span className="truncate text-caption text-text-3">
                  {item.repo} · <span className="font-mono">{item.sha}</span>
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
          <form onSubmit={add} className="flex flex-wrap gap-2">
            <Input
              aria-label="New task"
              placeholder="Add a task"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-auto flex-[1_1_10rem]"
            />
            <Input
              type="date"
              aria-label="Due day (optional)"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="w-auto flex-[1_1_8rem]"
            />
            <Button type="submit" variant="secondary">
              <Plus />
              Add
            </Button>
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

function LaunchLayout({ quickLaunch = null, pipeline = null, checklist = null, className }) {
  return (
    <div data-slot="launch-layout" className={cn('@container', className)}>
      <div className="grid grid-cols-1 items-start gap-6 @2xl:grid-cols-2">
        {quickLaunch ? <div className="min-w-0 @2xl:col-span-2">{quickLaunch}</div> : null}
        {pipeline}
        {checklist}
      </div>
    </div>
  );
}

export { QuickLaunch, Pipeline, Checklist, UtilitiesRail, LaunchLayout };
