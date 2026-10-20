/*
 * AppShell (spec §5.4, §7; #296): the frame every page lives in. The header
 * runs the full width at the top and stays there; under it, from 768px, the
 * sidebar, sticky, the height of the window, scrolling on its own; below
 * 768px the bottom tabs instead, fixed to the bottom edge. The page is
 * `<main>`, between them.
 *
 * Each piece of chrome is its own UiRoot (a `.jh-ui` root) with the screen's
 * `switches` (theme, accent, density, typeface), and the page area is not
 * one: until the last old screen is rebuilt, a page may be one of today's
 * views, which the new stack's reset and type must not reach (docs/
 * ARCHITECTURE.md, "UI stack"). So the shell's own element carries layout
 * only, no colour, and a new page brings its own root: ShellPage.
 *
 *   ShellPage  a page of the new UI inside the shell: its own UiRoot with the
 *              shell's switches, the page's gutter (16, 24, 32px by width),
 *              its title (h1) and what goes under it.
 *   ShellApps  where the embedded apps are drawn (AppFrames): a region named
 *              by the open app, whose frames fill the window under the
 *              header (and above the bottom tabs on a phone).
 */
import { createContext, useContext } from 'react';
import { UiRoot } from './root.jsx';
import { cn } from './lib/utils.js';

const ShellSwitches = createContext({});

function AppShell({ switches = {}, header, sidebar, tabs, className, children, ...props }) {
  return (
    <ShellSwitches.Provider value={switches}>
      <div data-slot="app-shell" className={cn('flex min-h-dvh flex-col', className)} {...props}>
        <UiRoot {...switches} className="sticky top-0 z-header">
          {header}
        </UiRoot>
        <div className="flex flex-1">
          {sidebar && (
            <UiRoot
              {...switches}
              data-slot="app-shell-sidebar"
              className="sticky top-12 hidden h-[calc(100dvh-3rem)] shrink-0 md:block"
            >
              {sidebar}
            </UiRoot>
          )}
          <main
            id="main"
            data-slot="app-shell-main"
            className="flex min-w-0 flex-1 flex-col max-md:pb-[calc(4rem+env(safe-area-inset-bottom))]"
          >
            {children}
          </main>
        </div>
        {tabs && (
          <UiRoot
            {...switches}
            data-slot="app-shell-tabs"
            className="fixed inset-x-0 bottom-0 z-header md:hidden"
          >
            {tabs}
          </UiRoot>
        )}
      </div>
    </ShellSwitches.Provider>
  );
}

function ShellPage({ title, description, actions, className, children, ...props }) {
  const switches = useContext(ShellSwitches);
  return (
    <UiRoot
      {...switches}
      data-slot="shell-page"
      className={cn('flex-1 px-4 py-6 md:px-6 xl:px-8', className)}
      {...props}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        {(title || actions) && (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              {title && <h1 className="text-title">{title}</h1>}
              {description && <p className="text-text-2">{description}</p>}
            </div>
            {actions}
          </div>
        )}
        {children}
      </div>
    </UiRoot>
  );
}

function ShellApps({ label, className, children, ...props }) {
  return (
    <section
      aria-label={label || undefined}
      data-slot="shell-apps"
      className={cn(
        '[&_iframe]:h-[calc(100dvh-3rem)] max-md:[&_iframe]:h-[calc(100dvh-7rem-env(safe-area-inset-bottom))]',
        className
      )}
      {...props}
    >
      {children}
    </section>
  );
}

export { AppShell, ShellPage, ShellApps };
