/*
 * Skeleton (spec §5.4, #286): a placeholder block where content is loading,
 * as the mock draws them: surface-3 with a 6px radius, sized by the caller
 * (`className="h-3 w-[70%]"`; `rounded-full` for an avatar, `rounded-lg` for a
 * control). It is still: no shimmer or pulse (§5.3 animates bars only), so
 * reduced motion changes nothing.
 *
 * Skeletons are hidden from assistive tech. The region that holds them says
 * what is loading, once: `aria-busy="true"` on it, and a line for screen
 * readers ("Loading services") in a `sr-only` element.
 */
import { cn } from './lib/utils.js';

function Skeleton({ className, ...props }) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('rounded-md bg-surface-3', className)}
      {...props}
    />
  );
}

export { Skeleton };
