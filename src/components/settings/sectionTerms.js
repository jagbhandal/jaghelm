import { SETTINGS_SECTIONS } from './sections.js';

/**
 * What Settings' search finds each part of a section by (#317, #611): the
 * names of its controls, the tab it came from before #317 and other words
 * for them, by section id and then the part's name (sections.js). The search
 * matches each word of a query at the start of a word (settingsSearch.js; the
 * command palette's own rule is the same).
 *
 * Apart from sections.js so the first screen, which only needs the sections'
 * names and addresses, doesn't carry them: Settings' chunk and the palette's
 * index (src/components/CommandPaletteIndex.js) import them from here.
 */
export const WORDS = Object.freeze({
  nodes: {
    Nodes:
      'nodes node hosts machines servers infrastructure rename display name subtitle role prometheus label colour color border visible hidden containers auto-discover discovery',
    Services:
      'services service containers docker monitor monitors uptime kuma mapping override display name icon hide show',
    'Custom groups': 'groups grouping custom group sections',
  },
  integrations: {
    Integrations:
      'integration api key token password credentials connect preset presets gallery add test custom json apps stats',
  },
  apps: {
    'Embedded apps': 'apps app tabs tab iframe embed embedded sidebar add url',
    'Quick Launch links': 'links bookmarks quick launch groups favourites favorites',
    'Where links open': 'link target open links new tab same tab layout',
    'Web search': 'search engine web google duckduckgo bing brave launch page widgets',
  },
  notifications: {
    Thresholds:
      'thresholds threshold lines warning critical alerts cpu memory ram disk storage pools temperature celsius °c limits levels hysteresis',
    'What pages the phones':
      'push categories alerts pages paging services hosts ups cron jobs updates arcane recoveries',
    Devices:
      'devices phones phone android registered remove test push send notifications fcm firebase delivery delivered',
  },
  appearance: {
    Theme: 'theme themes dark light system mode colour color scheme look',
    Accent: 'accent accents colour color violet purple fuchsia pink cyan highlight',
    Density: 'density compact comfortable spacing rows padding',
    'Font family': 'font fonts typeface typography text preset',
    Branding: 'title name instance subtitle dashboard general',
    Logo: 'logo image icon brand upload general',
    Background: 'background wallpaper image opacity overlay card blur layout',
    'Dot grid': 'dot grid dots effects',
    'Overview sections':
      'sections show hide attention subsystem strip infrastructure power jobs services rail',
    Weather: 'weather location latitude longitude city place widgets',
    Clock: 'clock time widgets',
    Utilities: 'quick launch pipeline checklist todos to-dos rail widgets sections',
    'Temperature unit': 'temperature unit units celsius fahrenheit °c °f layout widgets',
  },
  system: {
    'Password and sessions':
      'password security login sign in sign-in authentication session sessions account',
    Backup: 'backup export import restore json file config',
    'Data refresh': 'refresh auto-refresh interval polling seconds data layout',
  },
});

/**
 * Settings' sections as the search reads them: sections.js's, each part with
 * its `words`.
 */
export const SEARCHABLE_SECTIONS = Object.freeze(
  SETTINGS_SECTIONS.map((s) =>
    Object.freeze({
      ...s,
      settings: Object.freeze(
        s.settings.map((p) => Object.freeze({ ...p, words: WORDS[s.id]?.[p.name] }))
      ),
    })
  )
);
