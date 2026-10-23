/*
 * Settings' index and a section's frame (#317, spec §7), as the mock's
 * Settings board draws them. src/views/SettingsView.jsx feeds them; what a
 * section holds is its own (src/components/settings/sections/).
 *
 *   SettingsIndex        the index: a search field, then a card for each
 *                        section the query finds (every one with no query),
 *                        three across from 1024px, two from 640px, one on a
 *                        phone. A card is a link: the section's icon in its
 *                        accent chip, its name, its one-line description and,
 *                        when its settings matched, "Matches: Font family,
 *                        Logo". None found: "No setting matches …". Under
 *                        them, that every change applies at once (no preview,
 *                        spec M10).
 *   SettingsSectionPage  a section's page: "Settings / <name>" (a link back to
 *                        the index), its name as the h1 and its description,
 *                        then `nav` (SettingsNav) beside its content from
 *                        768px; on a phone only the content, the index being
 *                        the way between sections. The content is today's
 *                        Settings markup until each section's card rebuilds
 *                        it, so it sits outside any root, and the head and
 *                        the nav are roots of their own: the shell's
 *                        switches, or those of the UiRoot around the page
 *                        (the gallery).
 *   SettingsNav          the sections as links, the open one marked
 *                        (aria-current), as the sidebar marks its page.
 *   SettingsPart         a root of its own for a rebuilt section's content
 *                        (Appearance, #321), with the switches the head and
 *                        the nav have, its children stacked 24px apart.
 *
 * Each section is `{ id, label, description, icon, href }`; the index's also
 * has `hits` (its settings' names the query found). A link calls
 * `onNavigate(event, href)` (the router's followLink), so a modified click
 * still opens a new tab.
 */
import { useContext, useId } from 'react';
import { Search } from 'lucide-react';
import { ShellSection } from './app-shell.jsx';
import { Input } from './input.jsx';
import { UiRoot } from './root.jsx';
import { RootSwitchesContext, SWITCHES } from './lib/portal.js';
import { cn } from './lib/utils.js';

const CHIP =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent-text inset-ring inset-ring-accent-border [&_svg]:size-4 [&_svg]:stroke-[1.75]';

function IndexCard({ section, onNavigate }) {
  const id = useId();
  const hits = section.hits ?? [];
  return (
    <li className="flex">
      <a
        href={section.href}
        onClick={onNavigate ? (e) => onNavigate(e, section.href) : undefined}
        aria-labelledby={`${id}-name`}
        aria-describedby={hits.length > 0 ? `${id}-desc ${id}-hits` : `${id}-desc`}
        data-slot="settings-card"
        className="flex min-w-0 flex-1 flex-col gap-2.5 rounded-xl border border-border bg-surface-1 p-panel text-text-1 transition-colors hover:border-border-strong hover:bg-surface-2"
      >
        <span className="flex items-center gap-3">
          <span aria-hidden="true" className={CHIP}>
            {section.icon}
          </span>
          <span id={`${id}-name`} className="text-title-xs">
            {section.label}
          </span>
        </span>
        <span id={`${id}-desc`} className="text-body-sm text-text-2">
          {section.description}
        </span>
        {hits.length > 0 ? (
          <span id={`${id}-hits`} className="text-caption font-semibold text-accent-text">
            Matches: {hits.join(', ')}
          </span>
        ) : null}
      </a>
    </li>
  );
}

function SettingsIndex({
  query = '',
  onQueryChange,
  sections = [],
  onNavigate,
  className,
  ...props
}) {
  const words = query.trim();
  return (
    <div data-slot="settings-index" className={cn('flex flex-col gap-5', className)} {...props}>
      <div role="search" aria-label="Settings" className="relative w-full max-w-sm">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 stroke-[1.75] text-text-3"
        />
        <Input
          type="search"
          aria-label="Search settings"
          placeholder="Search settings: font, password, links…"
          value={query}
          onChange={(e) => onQueryChange?.(e.target.value)}
          className="pl-8"
        />
      </div>
      {sections.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <IndexCard key={s.id} section={s} onNavigate={onNavigate} />
          ))}
        </ul>
      ) : (
        <p role="status" className="text-body text-text-3">
          No setting matches “{words}”.
        </p>
      )}
      <p className="text-caption text-text-3">
        Every change saves and applies to the board straight away. There is no separate preview.
      </p>
    </div>
  );
}

function SettingsNav({ sections = [], current, onNavigate, className, ...props }) {
  return (
    <nav
      aria-label="Settings sections"
      data-slot="settings-nav"
      className={cn('w-52', className)}
      {...props}
    >
      <ul className="flex flex-col gap-0.5">
        {sections.map((s) => {
          const on = s.id === current;
          return (
            <li key={s.id}>
              <a
                href={s.href}
                aria-current={on ? 'page' : undefined}
                onClick={onNavigate ? (e) => onNavigate(e, s.href) : undefined}
                className={cn(
                  'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-body-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.75]',
                  on
                    ? 'bg-accent-tint font-semibold text-text-1 [&_svg]:text-accent-text'
                    : 'font-medium text-text-2 hover:bg-surface-2 hover:text-text-1'
                )}
              >
                <span aria-hidden="true" className="inline-flex">
                  {s.icon}
                </span>
                <span className="min-w-0 truncate">{s.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * A root of its own for a part of the section's page: the switches of the
 * UiRoot around the page when there is one (the gallery draws it inside its
 * own), otherwise the shell's, as ShellSection gives them.
 */
function PartRoot({ className, children }) {
  const around = useContext(RootSwitchesContext);
  if (!around) return <ShellSection className={className}>{children}</ShellSection>;
  const switches = Object.fromEntries(
    Object.entries(SWITCHES).map(([name, { attribute }]) => [name, around[attribute]])
  );
  return (
    <UiRoot {...switches} className={cn('flex flex-col gap-6 bg-transparent', className)}>
      {children}
    </UiRoot>
  );
}

function SettingsSectionPage({
  title,
  description,
  indexHref = '/settings',
  onNavigate,
  nav,
  className,
  children,
  ...props
}) {
  return (
    <div
      data-slot="settings-section-page"
      className={cn('flex-1 px-4 py-6 md:px-6 xl:px-8', className)}
      {...props}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PartRoot className="gap-1">
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-2 text-body-sm text-text-3">
              <li>
                <a
                  href={indexHref}
                  onClick={onNavigate ? (e) => onNavigate(e, indexHref) : undefined}
                  className="font-semibold text-accent-text hover:underline"
                >
                  Settings
                </a>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="min-w-0 truncate text-text-2">
                {title}
              </li>
            </ol>
          </nav>
          <h1 className="text-title">{title}</h1>
          {description ? <p className="text-text-2">{description}</p> : null}
        </PartRoot>
        <div className="flex items-start gap-8">
          {nav ? <PartRoot className="sticky top-16 shrink-0 max-md:hidden">{nav}</PartRoot> : null}
          <div data-slot="settings-section-body" className="min-w-0 max-w-3xl flex-1">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export { SettingsIndex, SettingsNav, SettingsSectionPage, PartRoot as SettingsPart };
