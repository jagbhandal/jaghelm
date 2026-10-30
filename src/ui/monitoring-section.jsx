/*
 * MonitoringSection (#751, Monitoring spec §5 "Layout"): a part of the
 * Monitoring page, named by a plain-language heading that says what its charts
 * answer ("Resources", under it "Is any node short of CPU, memory or
 * bandwidth?"). The heading is an h2 at `text-title-xs`, the question under it
 * in 12px text-3; the section is a region named by the heading, and its charts
 * (Panels, each with its own h3) are stacked 12px under it.
 *
 * `loading` stands a placeholder where the charts will be until the first
 * answer: one still block (Skeleton), the section `aria-busy`, and a line for
 * screen readers ("Loading Resources") said once. Skeletons are hidden from
 * assistive tech, so this line is what names it.
 *
 * MonitoringNote is the page's one-line notice over its sections, such as "The
 * charts couldn't be read": a polite status in 12px text-2 on surface-1 in a
 * subtle edge. A chart that failed says so in its own Chart, never here.
 */
import { useId } from 'react';
import { Skeleton } from './skeleton.jsx';
import { cn } from './lib/utils.js';

function MonitoringSection({ title, question, loading = false, className, children, ...props }) {
  const id = useId();
  return (
    <section
      data-slot="monitoring-section"
      aria-labelledby={id}
      aria-busy={loading ? 'true' : undefined}
      className={cn('flex min-w-0 flex-col gap-3', className)}
      {...props}
    >
      <div className="flex flex-col gap-0.5">
        <h2 id={id} className="text-title-xs text-text-1">
          {title}
        </h2>
        {question != null && <p className="text-caption text-text-3">{question}</p>}
      </div>
      {loading ? (
        <>
          <span className="sr-only">Loading {title}</span>
          <Skeleton data-slot="monitoring-skeleton" className="h-52 w-full rounded-xl" />
        </>
      ) : (
        children
      )}
    </section>
  );
}

function MonitoringNote({ className, children, ...props }) {
  return (
    <p
      role="status"
      data-slot="monitoring-note"
      className={cn(
        'rounded-lg border border-border bg-surface-1 px-3 py-2 text-caption text-text-2',
        className
      )}
      {...props}
    >
      {children}
    </p>
  );
}

export { MonitoringSection, MonitoringNote };
