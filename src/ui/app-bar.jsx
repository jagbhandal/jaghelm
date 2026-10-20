/*
 * AppBar (spec §8; #296): the strip over an embedded app open in the shell,
 * from the mock's Main board (an app open from the sidebar). 44px on
 * surface-1 above a subtle edge: the app's chip and name, its URL in mono
 * text-3, cut short (from 768px), "Stays loaded when you switch away" (from
 * 1024px), then Reload, which reloads that app's frame alone, and "Open in
 * new tab".
 *
 *   name      the app's name
 *   monogram  its chip's two letters (appMonogram(name) by default)
 *   url       the address it shows
 *   href      where "Open in new tab" goes (a safe URL; none, no link)
 *   onReload  Reload's handler; none, no button
 *
 * The frame and its loading, slow and blocked notices sit under it
 * (ShellApps).
 */
import { ExternalLink, RotateCw } from 'lucide-react';
import { buttonVariants } from './button.jsx';
import { IconButton } from './icon-button.jsx';
import { AppChip, appMonogram } from './side-nav.jsx';
import { Tooltip } from './tooltip.jsx';
import { cn } from './lib/utils.js';

function AppBar({ name, monogram, url, href, onReload, className, ...props }) {
  return (
    <div
      data-slot="app-bar"
      className={cn(
        'flex h-11 items-center gap-3 border-b border-border bg-surface-1 px-4 md:pl-6',
        className
      )}
      {...props}
    >
      <AppChip text={monogram ?? appMonogram(name)} />
      <span className="min-w-0 truncate font-bold max-md:flex-1">{name}</span>
      <span className="hidden min-w-0 flex-1 truncate font-mono text-caption text-text-3 md:block">
        {url}
      </span>
      <span className="hidden shrink-0 text-caption whitespace-nowrap text-text-3 lg:block">
        Stays loaded when you switch away
      </span>
      {onReload && (
        <Tooltip content={`Reload ${name}`}>
          <IconButton size="sm" label={`Reload ${name}`} onClick={onReload} className="shrink-0">
            <RotateCw aria-hidden="true" />
          </IconButton>
        </Tooltip>
      )}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'shrink-0')}
        >
          Open in new tab
          <ExternalLink aria-hidden="true" />
        </a>
      )}
    </div>
  );
}

export { AppBar };
