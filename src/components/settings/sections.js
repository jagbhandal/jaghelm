import { pathTo } from '../../router/routes.js';

/**
 * Settings' sections (#317, spec §7), in the index's order, each at
 * /settings/<id>: its name, a one-line description, and what Settings'
 * search finds it by. The one list: the Settings index and the command
 * palette (#315) read it, so it stays out of Settings' own chunk. What each
 * section draws is its module's (src/components/settings/sections/).
 *
 * `settings` are its parts, in its page's order: each `{ name, anchor, words }`,
 * `name` its heading on the page, `anchor` that part's id there (a link to
 * `/settings/<id>#<anchor>` opens the section at it), and `words` what it
 * holds, the names of its controls, the tab it came from before #317 and
 * other words for them. The search matches each word of a query at the start
 * of a word (settingsSearch.js; the palette's own rule is the same).
 *
 * Sources joins when its card builds it (#318), first, in the spec's order.
 */
const part = (name, anchor, words) => Object.freeze({ name, anchor, words });

export const SETTINGS_SECTIONS = Object.freeze(
  [
    {
      id: 'nodes',
      label: 'Nodes & Services',
      desc: 'Node names and roles, services and their monitors, custom groups.',
      settings: [
        part(
          'Nodes',
          'nodes',
          'nodes node hosts machines servers infrastructure rename display name subtitle role prometheus label colour color border visible hidden containers auto-discover discovery'
        ),
        part(
          'Services',
          'services',
          'services service containers docker monitor monitors uptime kuma mapping override display name icon hide show'
        ),
        part('Custom groups', 'custom-groups', 'groups grouping custom group sections'),
      ],
    },
    {
      id: 'integrations',
      label: 'Integrations',
      desc: 'Apps JagHelm reads stats from: add, configure and test them.',
      settings: [
        part(
          'Integrations',
          null,
          'integration api key token password credentials connect preset presets gallery add test custom json apps stats'
        ),
      ],
    },
    {
      id: 'apps',
      label: 'Apps & links',
      desc: 'Embedded apps, Quick Launch links, where links open, the web search.',
      settings: [
        part(
          'Embedded apps',
          'embedded-apps',
          'apps app tabs tab iframe embed embedded sidebar add url'
        ),
        part(
          'Quick Launch links',
          'quick-launch-links',
          'links bookmarks quick launch groups favourites favorites'
        ),
        part('Where links open', 'link-target', 'link target open links new tab same tab layout'),
        part(
          'Web search',
          'web-search',
          'search engine web google duckduckgo bing brave launch page widgets'
        ),
      ],
    },
    {
      id: 'notifications',
      label: 'Notifications',
      desc: 'Warning and critical thresholds, what pages your phones, the phones and a test push.',
      settings: [
        part(
          'Thresholds',
          'thresholds',
          'thresholds threshold lines warning critical alerts cpu memory ram disk storage pools temperature celsius °c limits levels hysteresis'
        ),
        part(
          'What pages the phones',
          'categories',
          'push categories alerts pages paging services hosts ups cron jobs updates arcane recoveries'
        ),
        part(
          'Devices',
          'devices',
          'devices phones phone android registered remove test push send notifications fcm firebase delivery delivered'
        ),
      ],
    },
    {
      id: 'appearance',
      label: 'Appearance',
      desc: 'Theme, font, branding, Overview sections, weather and clock.',
      settings: [
        part('Theme', 'theme', 'theme themes dark light system mode colour color scheme look'),
        part('Font Family', 'font', 'font fonts typeface typography text preset'),
        part(
          'Temperature',
          'temperature',
          'temperature unit units celsius fahrenheit °c °f layout'
        ),
        part(
          'Overview sections',
          'overview-sections',
          'sections show hide attention subsystem strip infrastructure power jobs services rail'
        ),
        part(
          'Utilities',
          'utilities',
          'quick launch pipeline checklist todos to-dos rail widgets sections'
        ),
        part('Weather', 'weather', 'weather location latitude longitude city place widgets'),
        part('Clock', 'clock', 'clock time widgets'),
        part('Branding', 'branding', 'title name instance subtitle dashboard general'),
        part('Logo', 'logo', 'logo image icon brand upload general'),
        part(
          'Background',
          'background',
          'background wallpaper image opacity overlay card blur layout'
        ),
        part('Effects', 'effects', 'dot grid effects'),
      ],
    },
    {
      id: 'system',
      label: 'System',
      desc: 'Password, backup and restore, data refresh.',
      settings: [
        part(
          'Password and sessions',
          'password',
          'password security login sign in sign-in authentication session sessions account'
        ),
        part('Backup', 'backup', 'backup export import restore json file config'),
        part(
          'Data refresh',
          'data-refresh',
          'refresh auto-refresh interval polling seconds data layout'
        ),
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
