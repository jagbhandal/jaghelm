import { useEffect, useMemo, useState } from 'react';
import { UiRoot } from '@ui/root';
import { CommandPalette as Palette } from '@ui/command-palette';
import { useConfig } from '../context/ConfigContext.jsx';
import { useEntityLink } from '../shell/entityNav.js';
import { loadCommandPaletteIndex } from '../lazyViews.js';
import { whenIdle } from '../shell/whenIdle.js';

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
 *
 * Only this shell is in the first load (#611): the trigger's state, the
 * dialog and its field. What it finds (CommandPaletteIndex.js, with
 * paletteIndex.js and Settings' search terms) is a chunk of its own, asked
 * for once the browser is idle, so ⌘K opens at once on a warm page. On one
 * that hasn't loaded it yet, the dialog opens with the field and "Loading…"
 * in the list, never an empty list that reads as no results, and fills in
 * when the chunk arrives; the words typed meanwhile are kept.
 */
/** The index's functions, once its chunk is in: kept for every later open. */
let index = null;

/**
 * Asks for the index's chunk: `then` gets its functions, `fail` the error. A
 * module without `paletteGroups` counts as failed: in a build, chunkReload.js
 * cancels the first preload error and the import resolves to undefined.
 * Nothing is kept on failure, so the next open asks again.
 */
function loadIndex(then, fail) {
  loadCommandPaletteIndex().then((module) => {
    if (typeof module?.paletteGroups !== 'function') {
      fail();
      return;
    }
    index = module;
    then?.(module);
  }, fail);
}

export default function CommandPalette({ open, ...props }) {
  // Once the browser is idle after the first screen, so the first ⌘K is instant.
  useEffect(() => whenIdle(() => loadIndex(null, () => {})), []);
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
  const [loaded, setLoaded] = useState(() => index);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!loaded) loadIndex(setLoaded, () => setFailed(true));
  }, [loaded]);
  const groups = useMemo(
    () =>
      loaded
        ? loaded.paletteGroups({
            status,
            stale,
            pages,
            apps,
            links: config?.links,
            linkTarget: config?.linkTarget,
            entityLink,
            navigate: onNavigate,
            onLogout,
          })
        : [],
    [
      loaded,
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
  const shown = useMemo(
    () => (loaded ? loaded.paletteSearch(groups, query) : groups),
    [loaded, groups, query]
  );
  return (
    <UiRoot {...switches}>
      <Palette
        open
        onClose={onClose}
        query={query}
        onQueryChange={setQuery}
        groups={shown}
        loading={!loaded && !failed}
        error={failed ? 'Search couldn’t load. Close it and try again.' : null}
      />
    </UiRoot>
  );
}
