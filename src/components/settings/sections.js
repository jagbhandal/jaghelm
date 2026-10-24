import { pathTo } from '../../router/routes.js';

/**
 * Settings' sections (#317, spec §7), in the index's order, each at
 * /settings/<id>: its name and a one-line description. The one list: the
 * Settings index and the command palette (#315) read it, and so do the links
 * that open a section at a part, so it stays small and out of Settings' own
 * chunk.
 *
 * `settings` are its parts, in its page's order: each `{ name, anchor }`,
 * `name` its heading on the page and `anchor` that part's id there (a link to
 * `/settings/<id>#<anchor>` opens the section at it). What each part is found
 * by, its `words`, is in sectionTerms.js, which loads with Settings' chunk and
 * the palette's index, not with the first screen (#611).
 *
 * Sources (#318) is first and Notifications (#320) after Apps & links, in the
 * spec's order. Sources is a part per source, its row on the page.
 */
const part = (name, anchor) => Object.freeze({ name, anchor });

export const SETTINGS_SECTIONS = Object.freeze(
  [
    {
      id: 'sources',
      label: 'Sources',
      desc: "Each monitoring source's live health: Prometheus, Uptime Kuma, NUT, Gitea, cron reporters.",
      // A source's name is what it is found by.
      settings: [
        part('Prometheus', 'prometheus'),
        part('Uptime Kuma', 'kuma'),
        part('NUT (UPS)', 'nut'),
        part('Gitea', 'gitea'),
        part('Cron reporters', 'cron-reporters'),
      ],
    },
    {
      id: 'nodes',
      label: 'Nodes & Services',
      desc: 'Node names and roles, services and the monitors that watch them, backup jobs, the disk forecast, certificate and key expiry, custom groups.',
      settings: [
        part('Nodes', 'nodes'),
        part('Services', 'services'),
        part('Backup jobs', 'backups'),
        part('Disk forecast', 'disk-forecast'),
        part('Expiry', 'expiry'),
        part('Custom groups', 'custom-groups'),
      ],
    },
    {
      id: 'integrations',
      label: 'Integrations',
      desc: 'Apps JagHelm reads stats from: add, configure, test and remove them.',
      settings: [part('Connected', 'connected'), part('Add an integration', 'add')],
    },
    {
      id: 'apps',
      label: 'Apps & links',
      desc: 'Embedded apps, Quick Launch links, where links open, the web search.',
      settings: [
        part('Embedded apps', 'embedded-apps'),
        part('Quick Launch links', 'quick-launch-links'),
        part('Where links open', 'link-target'),
        part('Web search', 'web-search'),
      ],
    },
    {
      id: 'notifications',
      label: 'Notifications',
      desc: 'Warning and critical thresholds, what pages your phones, the phones and a test push.',
      settings: [
        part('Thresholds', 'thresholds'),
        part('What pages the phones', 'categories'),
        part('Alert rules', 'alert-rules'),
        part('Group a burst of alerts', 'alert-grouping'),
        part('Quiet hours', 'quiet-hours'),
        part('Known causes', 'known-causes'),
        part('Snoozed and acknowledged', 'silenced-alerts'),
        part('Devices', 'devices'),
      ],
    },
    {
      id: 'appearance',
      label: 'Appearance',
      desc: 'Theme, custom themes, accent, density, font, branding, Overview sections, widgets.',
      settings: [
        part('Theme', 'theme'),
        part('Custom themes', 'custom-themes'),
        part('Accent', 'accent'),
        part('Density', 'density'),
        part('Font family', 'font'),
        part('Branding', 'branding'),
        part('Logo', 'logo'),
        part('Background', 'background'),
        part('Dot grid', 'effects'),
        part('Overview sections', 'overview-sections'),
        part('Weather', 'weather'),
        part('Clock', 'clock'),
        part('Utilities', 'utilities'),
        part('Units', 'units'),
        part('Dates and times', 'locale'),
      ],
    },
    {
      id: 'system',
      label: 'System',
      desc: 'Password, backup and restore, data refresh.',
      settings: [
        part('Password and sessions', 'password'),
        part('Backup', 'backup'),
        part('Data refresh', 'data-refresh'),
      ],
    },
  ].map((s) => Object.freeze({ ...s, settings: Object.freeze(s.settings) }))
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
 * The part of its section an old tab's address opens at (an anchor of its
 * `settings`): what it held there. Appearance, Nodes and Integrations keep
 * their own address, so they open at the top.
 */
export const MOVED_ANCHORS = Object.freeze({
  general: 'branding',
  typography: 'font',
  layout: 'data-refresh',
  sections: 'custom-groups',
  services: 'services',
  links: 'quick-launch-links',
  widgets: 'weather',
  tabs: 'embedded-apps',
  security: 'password',
  backup: 'backup',
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

/** Whether `anchor` is a part of section `id`. */
export function isSettingsAnchor(id, anchor) {
  const section = SETTINGS_SECTIONS.find((s) => s.id === id);
  return Boolean(section?.settings.some((p) => p.anchor != null && p.anchor === anchor));
}

/**
 * The address of section `id`, at its part `anchor` when given:
 * `/settings/nodes#custom-groups`. Throws on a section or part Settings
 * doesn't have, as pathTo does on a route: a link to nowhere is a bug.
 *
 * @param {string} id
 * @param {string} [anchor]
 */
export function settingsHref(id, anchor) {
  if (!SETTINGS_SECTIONS.some((s) => s.id === id)) throw new Error(`No Settings section "${id}"`);
  if (anchor == null) return pathTo('settings', { section: id });
  if (!isSettingsAnchor(id, anchor))
    throw new Error(`No part "${anchor}" in the Settings section "${id}"`);
  return `${pathTo('settings', { section: id })}#${anchor}`;
}
