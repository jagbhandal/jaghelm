import { useMemo, useState } from 'react';
import { UiRoot } from '@ui/root';
import { CommandPalette as Palette } from '@ui/command-palette';
import { useConfig } from '../context/ConfigContext.jsx';
import { useEntityLink } from '../shell/entityNav.js';
import { paletteIndex, paletteSearch } from '../shell/paletteIndex.js';
import { SETTINGS_SECTIONS } from './settings/sections.js';

/**
 * ⌘K's command palette, wired (#315): src/ui/command-palette.jsx draws it,
 * src/shell/paletteIndex.js says what it finds. The current issues first
 * (worst first), then everything with an address (#309): the services, nodes,
 * the UPS, jobs, backups and integrations; the pages in the nav (`pages`,
 * `[{ id, label, href }]`); "Open <app>" for each embedded app (`apps`, the
 * same shape); Settings' sections; the Quick Launch links; and Log out
 * (`onLogout`, when there is a sign-in).
 *
 * An issue or an entity opens its detail over the page under the palette,
 * with the rows' own link (entityNav.js `useEntityLink`), so it is the same
 * URL a row on the page opens. A page, an app and a Settings section open
 * with `onNavigate(href)`; a Quick Launch link opens where Settings → Apps & links
 * says, as the panel's links do. No themes: the header's button and
 * Settings → Appearance switch them.
 *
 * `status` is the poll's (useStatus), `stale` whether it is out of date
 * (useStatusStale: every lamp drawn as no signal), `switches` the shell's
 * (its theme). Controlled by the parent (`open`, `onClose`), which owns the ⌘K
 * shortcut; the query starts empty on each open.
 */
export default function CommandPalette({ open, ...props }) {
  return open ? <OpenPalette {...props} /> : null;
}

function OpenPalette({
  onClose,
  switches,
  pages = [],
  apps = [],
  status = null,
  stale = false,
  onNavigate,
  onLogout = null,
}) {
  const { config } = useConfig();
  const entityLink = useEntityLink();
  const [query, setQuery] = useState('');
  const groups = useMemo(
    () =>
      paletteIndex({
        status,
        stale,
        pages,
        apps,
        sections: SETTINGS_SECTIONS,
        links: config?.links,
        linkTarget: config?.linkTarget,
        entityLink,
        navigate: onNavigate,
        onLogout,
      }),
    [
      status,
      stale,
      pages,
      apps,
      config?.links,
      config?.linkTarget,
      entityLink,
      onNavigate,
      onLogout,
    ]
  );
  const shown = useMemo(() => paletteSearch(groups, query), [groups, query]);
  return (
    <UiRoot {...switches}>
      <Palette open onClose={onClose} query={query} onQueryChange={setQuery} groups={shown} />
    </UiRoot>
  );
}
