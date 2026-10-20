/*
 * Panel (spec §5.4, #286): a titled section of a screen, as the mock draws its
 * attention panel, its utility cards and its Settings sections: surface-1
 * inside a subtle edge, a 12px radius, flat (no shadow; design-system rule 7).
 * Its padding is the density's (`p-panel`: 20px comfortable, 16px compact).
 *
 * The header is optional: `icon` in the mock's 28px accent chip (accent-tint,
 * accent-text, an accent-border ring), the title (15px bold, an h2 unless
 * `titleAs` says otherwise), `description` under it in 12px text-3, and
 * `actions` at the end of the row. The section is named by its title.
 *
 * `flush` lays the children edge to edge under a subtle rule, for rows and
 * tables that bring their own padding (the mock's Settings lists); otherwise
 * they sit inside the padding, 12px under the header.
 */
import { useId } from 'react';
import { cn } from './lib/utils.js';

function Panel({
  title,
  description,
  icon,
  actions,
  flush = false,
  titleAs = 'h2',
  className,
  children,
  ...props
}) {
  const Title = titleAs;
  const titleId = useId();
  const hasHeader = title != null || actions != null;
  return (
    <section
      data-slot="panel"
      aria-labelledby={title != null ? titleId : undefined}
      className={cn(
        'flex min-w-0 flex-col rounded-xl border border-border bg-surface-1 text-text-1',
        flush ? 'overflow-hidden' : 'gap-3 p-panel',
        className
      )}
      {...props}
    >
      {hasHeader ? (
        <div
          data-slot="panel-header"
          className={cn('flex items-center gap-2.5', flush && 'px-panel pt-panel pb-3')}
        >
          {icon != null ? (
            <span
              aria-hidden="true"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent-text inset-ring inset-ring-accent-border [&_svg]:size-3.5 [&_svg]:stroke-[1.75]"
            >
              {icon}
            </span>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {title != null ? (
              <Title id={titleId} className="text-title-xs text-text-1">
                {title}
              </Title>
            ) : null}
            {description != null ? <p className="text-caption text-text-3">{description}</p> : null}
          </div>
          {actions != null ? (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      {flush ? (
        <div data-slot="panel-body" className={cn(hasHeader && 'border-t border-border')}>
          {children}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

export { Panel };
