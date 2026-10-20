/*
 * EmptyState (spec §5.4, #286): what a list or panel shows when it has
 * nothing, saying why and, where there is one, what to do next ("No
 * integrations yet" and an Add button). Not for failures: a source that
 * failed is a Banner, which names the cause.
 *
 * At md (the default) it is centred: `icon` in the mock's 32px Settings chip
 * (surface-3, text-1, 8px radius), the title in 15px bold text-1, the
 * description in 13px text-2, at most 44 characters a line, and `action`
 * under them. At sm it is the command palette's one line, "Nothing matches
 * …": 13px text-3, 16px by 10px of padding, for a list that filters to
 * nothing; it shows the title only.
 */
import { cn } from './lib/utils.js';

function EmptyState({ icon, title, description, action, size = 'md', className, ...props }) {
  if (size === 'sm') {
    return (
      <div
        data-slot="empty-state"
        className={cn('px-2.5 py-4 text-body-sm text-text-3', className)}
        {...props}
      >
        {title}
      </div>
    );
  }
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center gap-2 px-6 py-10 text-center text-body-sm text-text-2',
        className
      )}
      {...props}
    >
      {icon != null ? (
        <span
          aria-hidden="true"
          className="mb-1 inline-flex size-8 items-center justify-center rounded-lg bg-surface-3 text-text-1 [&_svg]:size-4 [&_svg]:stroke-[1.75]"
        >
          {icon}
        </span>
      ) : null}
      <p className="text-title-xs text-text-1">{title}</p>
      {description != null ? <p className="max-w-[44ch]">{description}</p> : null}
      {action != null ? (
        <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}

export { EmptyState };
