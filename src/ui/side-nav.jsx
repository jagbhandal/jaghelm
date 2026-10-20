/*
 * SideNav and NavGroups (spec §5.4, §7; #296): the grouped sidebar, from the
 * signed-off mock's Main board, at 768px and wider. Each group has an
 * overline label and its entries: an icon, or an app's two-letter chip, then
 * the label. The open page's entry is `aria-current="page"`, tinted with the
 * accent, its icon in accent-text (§5.2: purple means selected). The others
 * are text-2, surface-2 under the pointer.
 *
 * An entry is `{ id, label, href, icon?, monogram?, current?, badge?,
 * loaded?, onUnload?, minor? }`:
 *
 *   icon      a Lucide icon element, drawn 16px in currentColor
 *   monogram  an app's chip instead of an icon: two letters (appMonogram)
 *   badge     `{ count, state, label }`: a count on the state's tint (Alerts'
 *             issues); `label` says it in words ("5 issues")
 *   loaded    an app still loaded, not open: the mock's grey dot
 *   onUnload  an "Unload" button on the entry, shown under the pointer or on
 *             keyboard focus (always, on a touch screen); focus returns to
 *             the entry after
 *   minor     the mock's quieter "Add app": 32px and 13px
 *
 * `collapsed` draws icons only, 64px wide: each label stays the entry's name
 * for screen readers and shows as a tooltip; group labels are for screen
 * readers only; Unload is left to the expanded sidebar. `onCollapsedChange`
 * adds the toggle at the bottom. The caller keeps the choice (per browser).
 *
 * NavGroups is the list alone, which the phone's More sheet reuses.
 * `onNavigate(event, href)` handles a link's click (the router's followLink).
 */
import { useId, useRef } from 'react';
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { IconButton } from './icon-button.jsx';
import { Tooltip } from './tooltip.jsx';
import { cn } from './lib/utils.js';
import { toState } from './lib/status.js';

/** A count badge's colours, by state: the state's word colour on its tint. */
const badgeTone = {
  ok: 'bg-ok-tint text-ok-fg',
  warn: 'bg-warn-tint text-warn-fg',
  crit: 'bg-crit-tint text-crit-fg',
  unknown: 'bg-unknown-tint text-unknown-fg',
  maintenance: 'bg-maintenance-tint text-maintenance-fg',
};

/** An app's two-letter chip: the initials of its first two words, or its first two letters. */
export function appMonogram(label) {
  const words = String(label ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  const [first = '', second = ''] = Array.from(words[0]);
  return first.toUpperCase() + second.toLowerCase();
}

/** The accessible name of an entry: its label, its badge and whether it is loaded. */
function entryName({ label, badge, loaded }) {
  return [label, badge?.label, loaded && 'still loaded'].filter(Boolean).join(', ');
}

function CountBadge({ count, state, collapsed }) {
  return (
    <span
      aria-hidden="true"
      data-slot="nav-badge"
      className={cn(
        'inline-flex h-5 min-w-5.5 shrink-0 items-center justify-center rounded-full px-1.5 text-caption font-bold',
        badgeTone[toState(state)],
        collapsed && 'absolute -top-0.5 right-1 h-4 min-w-4 px-1'
      )}
    >
      {count}
    </span>
  );
}

function AppChip({ text, current }) {
  return (
    <span
      aria-hidden="true"
      data-slot="app-chip"
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-md text-caption font-extrabold',
        current ? 'bg-accent text-on-accent' : 'bg-surface-3 text-text-1'
      )}
    >
      {text}
    </span>
  );
}

function NavItem({ item, collapsed, onNavigate }) {
  const { label, href, icon, monogram, current, badge, loaded, onUnload, minor } = item;
  const linkRef = useRef(null);
  const name = entryName(item);
  const link = (
    <a
      ref={linkRef}
      href={href}
      aria-label={name}
      aria-current={current ? 'page' : undefined}
      onClick={onNavigate ? (e) => onNavigate(e, href) : undefined}
      data-slot="nav-item"
      className={cn(
        'relative flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 transition-colors [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.75]',
        minor ? 'h-8 text-body-sm' : 'h-9 text-body',
        current
          ? 'bg-accent-tint font-semibold text-text-1 [&_svg]:text-accent-text'
          : 'font-medium text-text-2 hover:bg-surface-2 hover:text-text-1',
        collapsed && 'justify-center px-0'
      )}
    >
      {monogram != null ? <AppChip text={monogram} current={current} /> : icon}
      <span aria-hidden="true" className={cn('min-w-0 flex-1 truncate', collapsed && 'sr-only')}>
        {label}
      </span>
      {badge && badge.count > 0 && <CountBadge {...badge} collapsed={collapsed} />}
      {loaded && (
        <span
          aria-hidden="true"
          data-slot="nav-loaded"
          className={cn(
            'size-1.5 shrink-0 rounded-full bg-text-3',
            collapsed && 'absolute right-2.5 bottom-1.5'
          )}
        />
      )}
    </a>
  );
  return (
    <div className="group/item relative flex items-center">
      {collapsed ? (
        <Tooltip content={name} side="right">
          {link}
        </Tooltip>
      ) : (
        link
      )}
      {onUnload && !collapsed && (
        <IconButton
          size="sm"
          label={`Unload ${label}`}
          onClick={() => {
            onUnload();
            linkRef.current?.focus();
          }}
          className="absolute top-1/2 right-1 size-7 -translate-y-1/2 bg-sidebar opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        >
          <X aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}

function NavGroups({ groups, collapsed = false, onNavigate, className }) {
  const id = useId();
  return (
    <div data-slot="nav-groups" className={cn('flex flex-col gap-4', className)}>
      {groups.map((group) => (
        <div
          key={group.id}
          role="group"
          aria-labelledby={`${id}-${group.id}`}
          data-slot="nav-group"
          className="flex flex-col gap-1.5"
        >
          <span
            id={`${id}-${group.id}`}
            className={cn('px-2.5 text-overline text-text-3 uppercase', collapsed && 'sr-only')}
          >
            {group.label}
          </span>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <li key={item.id}>
                <NavItem item={item} collapsed={collapsed} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function SideNav({
  groups,
  collapsed = false,
  onCollapsedChange,
  onNavigate,
  label = 'Main',
  className,
  ...props
}) {
  const toggle = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  return (
    <nav
      aria-label={label}
      data-slot="side-nav"
      data-collapsed={collapsed || undefined}
      className={cn(
        'flex h-full flex-col gap-5 overflow-y-auto border-r border-border bg-sidebar py-4',
        collapsed ? 'w-16 px-2' : 'w-58 px-3',
        className
      )}
      {...props}
    >
      <NavGroups groups={groups} collapsed={collapsed} onNavigate={onNavigate} />
      {onCollapsedChange && (
        <div className={cn('mt-auto flex', collapsed ? 'justify-center' : 'justify-end')}>
          <Tooltip content={toggle} side={collapsed ? 'right' : 'top'}>
            <IconButton label={toggle} onClick={() => onCollapsedChange(!collapsed)}>
              {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
            </IconButton>
          </Tooltip>
        </div>
      )}
    </nav>
  );
}

export { SideNav, NavGroups, AppChip };
