/**
 * Settings' sections (#317, spec §7), in the index's order, each at
 * /settings/<id>: its name and a one-line description. The one list: the
 * Settings index and the command palette (#315) read it, so it stays out of
 * Settings' own chunk. What each section holds, its icon and the words its
 * search finds are its module's (src/components/settings/sections/).
 *
 * Sources and Notifications join when their cards build them (#318, #320),
 * in the spec's order: Sources first, Notifications after Apps & links.
 */
export const SETTINGS_SECTIONS = Object.freeze(
  [
    {
      id: 'nodes',
      label: 'Nodes & Services',
      desc: 'Node names and roles, services and their monitors, custom groups.',
    },
    {
      id: 'integrations',
      label: 'Integrations',
      desc: 'Apps JagHelm reads stats from: add, configure and test them.',
    },
    {
      id: 'apps',
      label: 'Apps & links',
      desc: 'Embedded apps, Quick Launch links, where links open, the web search.',
    },
    {
      id: 'appearance',
      label: 'Appearance',
      desc: 'Theme, font, branding, Overview sections, weather and clock.',
    },
    {
      id: 'system',
      label: 'System',
      desc: 'Password, backup and restore, data refresh.',
    },
  ].map((s) => Object.freeze(s))
);

/**
 * The 13 tabs Settings had before #317, each to the section that holds its
 * settings now, so an old address (a bookmark, a link) still lands. A tab
 * whose settings split goes to the section that holds most of them: Layout's
 * refresh is System's (its link target is Apps & links', its units and card
 * blur Appearance's), Sections' custom groups are Nodes & Services' (its
 * utilities' switches Appearance's), Widgets' weather and clock are
 * Appearance's (its web search Apps & links').
 */
export const MOVED_SECTIONS = Object.freeze({
  general: 'appearance',
  typography: 'appearance',
  layout: 'system',
  sections: 'nodes',
  services: 'nodes',
  links: 'apps',
  widgets: 'appearance',
  tabs: 'apps',
  security: 'system',
  backup: 'system',
});

/**
 * The section `id` opens: its own, or the one an old tab's settings moved to
 * (MOVED_SECTIONS); null for none.
 *
 * @param {string | null | undefined} id
 * @returns {string | null}
 */
export function settingsSectionFor(id) {
  if (id == null) return null;
  if (SETTINGS_SECTIONS.some((s) => s.id === id)) return id;
  return Object.hasOwn(MOVED_SECTIONS, id) ? MOVED_SECTIONS[id] : null;
}
