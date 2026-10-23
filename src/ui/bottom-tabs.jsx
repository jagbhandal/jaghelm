/*
 * BottomTabs (spec §5.4, §7; #296): the phone's tab bar, below 768px, from
 * the signed-off mock's Phone board: one cell per tab, its icon over its
 * label, 64px tall (plus the phone's home-indicator inset) on surface-1 above
 * a subtle edge. The open tab's icon sits on an accent-tint pill and its
 * label is accent-text; the others are text-3.
 *
 * A tab is `{ id, label, short?, icon, href?, onClick?, current?, badge? }`:
 * `short` is the word drawn under the icon when `label` is too long for a
 * fifth of a 360px phone ("Infra" for Infrastructure, as the mock's), the tab
 * keeping `label` as its name, which starts with it. With
 * `href` it is a link, marked `aria-current="page"` when current; with
 * `onClick` a button, such as More, which opens a sheet (`expanded` says
 * whether it is open). `badge` is `{ count, state, label }`, as the sidebar's,
 * drawn in the state's solid.
 */
import { cn } from './lib/utils.js';
import { toState } from './lib/status.js';

// The count on a tab: the state's solid with its on-solid figure, as the
// mock's phone draws it, so it reads over the open tab's pill.
const badgeSolid = {
  ok: 'bg-ok-solid text-ok-on-solid',
  warn: 'bg-warn-solid text-warn-on-solid',
  crit: 'bg-crit-solid text-crit-on-solid',
  unknown: 'bg-unknown-solid text-unknown-on-solid',
  maintenance: 'bg-maintenance-solid text-maintenance-on-solid',
};

function TabCell({ tab, onNavigate }) {
  const { label, short, icon, href, onClick, current, badge, expanded } = tab;
  const name = [label, badge?.count > 0 && badge.label].filter(Boolean).join(', ');
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'relative flex h-7 w-12 items-center justify-center rounded-full [&_svg]:size-5 [&_svg]:stroke-[1.75]',
          current && 'bg-accent-tint'
        )}
      >
        {icon}
        {badge && badge.count > 0 && (
          <span
            data-slot="tab-badge"
            className={cn(
              'absolute -top-1 left-7 inline-flex h-4 min-w-4.5 items-center justify-center rounded-full px-1 text-caption font-extrabold',
              badgeSolid[toState(badge.state)]
            )}
          >
            {badge.count}
          </span>
        )}
      </span>
      <span aria-hidden="true" className="text-caption">
        {short ?? label}
      </span>
    </>
  );
  const className = cn(
    'flex min-w-0 cursor-pointer flex-col items-center justify-center gap-1 -outline-offset-4',
    current ? 'font-bold text-accent-text' : 'font-semibold text-text-3 hover:text-text-1'
  );
  if (href) {
    return (
      <a
        href={href}
        aria-label={name}
        aria-current={current ? 'page' : undefined}
        onClick={onNavigate ? (e) => onNavigate(e, href) : undefined}
        data-slot="bottom-tab"
        className={className}
      >
        {content}
      </a>
    );
  }
  return (
    <button
      type="button"
      aria-label={name}
      aria-haspopup="dialog"
      aria-expanded={expanded ?? false}
      onClick={onClick}
      data-slot="bottom-tab"
      data-current={current || undefined}
      className={className}
    >
      {content}
    </button>
  );
}

function BottomTabs({ tabs, onNavigate, label = 'Tabs', className, ...props }) {
  return (
    <nav
      aria-label={label}
      data-slot="bottom-tabs"
      className={cn(
        'grid h-[calc(4rem+env(safe-area-inset-bottom))] auto-cols-fr grid-flow-col border-t border-border bg-surface-1 pb-[env(safe-area-inset-bottom)]',
        className
      )}
      {...props}
    >
      {tabs.map((tab) => (
        <TabCell key={tab.id} tab={tab} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}

export { BottomTabs };
