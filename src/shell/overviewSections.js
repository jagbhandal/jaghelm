/**
 * The Overview's sections a user can hide (#307, spec §8 "Today's extras keep
 * a home": a simple show/hide setting until Edit layout, Phase 5, brings
 * reordering). One switch each, in Settings → Appearance → Overview sections,
 * kept in the display config (`overviewSections`, `{ strip: false }`), which
 * the server holds (/api/display-config), so a section hidden on one device
 * is hidden on every other after its next load.
 *
 *   attention       never hidden: it shows only when something is wrong (and
 *                   one quiet line when all is well), so hiding it would hide
 *                   an incident. Settings shows its switch on and locked; a
 *                   hand-edited `attention: false` is ignored.
 *   strip           the subsystem strip, under the attention panel
 *   infrastructure  the nodes, as cards or a table
 *   power           the UPS (#306), its place on mains too
 *   jobs            every scheduled job and backup (#578)
 *   services        every service in one list
 *   rail            the utilities rail beside the sections from 1440px:
 *                   weather, the clock, Quick Launch, Pipeline, the Checklist.
 *                   The Launch page keeps them all, whatever this says.
 *
 * Only `false` hides a section, so a missing key, or a value no switch saves,
 * shows it.
 */

export const OVERVIEW_SECTIONS = [
  {
    id: 'attention',
    label: 'Needs attention',
    description: 'Always shown when something is wrong; one quiet line when all is well',
    locked: true,
  },
  {
    id: 'strip',
    label: 'Subsystem strip',
    description: 'Services, Nodes, Power, Jobs, Backups, Integrations',
  },
  { id: 'infrastructure', label: 'Infrastructure', description: 'The nodes, as cards or a table' },
  { id: 'power', label: 'Power', description: 'The UPS, with its charge' },
  { id: 'jobs', label: 'Jobs', description: 'Every scheduled job and backup, with its last run' },
  { id: 'services', label: 'Services', description: 'Every service in one list' },
  {
    id: 'rail',
    label: 'Utilities rail',
    description:
      'Weather, the clock, Quick Launch, Pipeline and the Checklist beside the sections, from 1440px wide. The Launch page always has them.',
  },
];

const LOCKED = new Set(OVERVIEW_SECTIONS.filter((s) => s.locked).map((s) => s.id));

/** Whether the Overview draws section `id`, by the display config's switches. */
export function sectionShown(config, id) {
  if (LOCKED.has(id)) return true;
  const switches = config?.overviewSections;
  return !(switches && typeof switches === 'object' && switches[id] === false);
}

/** The section each subsystem's filter keeps (#298, #306), by the section's id. */
export const SECTION_OF = Object.freeze({
  nodes: 'infrastructure',
  power: 'power',
  jobs: 'jobs',
  backups: 'jobs',
  services: 'services',
});

/**
 * Why the Overview filtered to `subsystem` draws no section, or null when it
 * draws one: `{ why: 'off', section }` when that section is switched off
 * (`section` its label), `{ why: 'none' }` for a subsystem with no section of
 * its own (Integrations, and any the strip may show later).
 *
 * @param {string | null} subsystem
 * @param {any} config the display config (its `overviewSections`)
 */
export function emptyFilterReason(subsystem, config) {
  if (!subsystem) return null;
  const id = SECTION_OF[subsystem];
  if (!id) return { why: 'none' };
  if (sectionShown(config, id)) return null;
  return { why: 'off', section: OVERVIEW_SECTIONS.find((s) => s.id === id)?.label ?? id };
}

// Keys an older JagHelm saved that nothing reads: Settings → Widgets' "Show
// checklist panel on dashboard" (`showTodos`), which nothing drawn ever read,
// so the Checklist showed whatever it said (its switch is Settings → Sections',
// `sections.todos.visible`), and `showDockerStats`, which no panel used. And
// the old grid board's (#306): its saved layout and column count, Settings →
// Widgets' "Show scheduled jobs panel" (the Jobs section's switch is here),
// Settings → Layout's "Collapsible sections", which nothing read, and
// Settings → Typography's font sizes, which sized only its panels.
const DEAD_KEYS = [
  'showTodos',
  'showDockerStats',
  'gridLayout',
  'gridColumns',
  'showCronJobs',
  'collapsibleSections',
  'fontSizes',
];

// The old board's panels in `sections`: the UPS panel's whole entry (the
// Power section's switch is here: a UPS panel switched off becomes the Power
// section switched off, unless that is already set), and the look of the
// three the utilities show (title, subtitle, icon and colours, which no panel
// draws now; Settings map, spec §15), keeping their `visible`, which the rail
// reads.
const OLD_PANELS = ['pipeline', 'quicklaunch', 'todos'];
const KEPT_PANEL_KEYS = new Set(['visible']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** `sections` without the old board's keys, or the same object when it has none. */
function liveSections(sections) {
  if (!isObject(sections)) return sections;
  const dead = (key) =>
    isObject(sections[key]) && Object.keys(sections[key]).some((k) => !KEPT_PANEL_KEYS.has(k));
  if (!Object.hasOwn(sections, 'ups') && !OLD_PANELS.some(dead)) return sections;
  const next = { ...sections };
  delete next.ups;
  for (const key of OLD_PANELS.filter(dead)) {
    next[key] = Object.fromEntries(
      Object.entries(sections[key]).filter(([k]) => KEPT_PANEL_KEYS.has(k))
    );
  }
  return next;
}

/** Whether `config` hid the old board's UPS panel and has no Power switch of its own. */
function upsHidden(config) {
  const switches = config.overviewSections;
  return (
    config.sections?.ups?.visible === false &&
    !(isObject(switches) && Object.hasOwn(switches, 'power'))
  );
}

/**
 * The display config without the keys nothing reads, or the same object when
 * it has none. Nothing else changes: a stored `showTodos: false` hides no
 * Checklist, since it never did, and `sections.todos.visible` stays as it is;
 * a UPS panel switched off becomes the Power section switched off.
 * Every copy is read without them (useConfigPersistence: the server's, the
 * one kept in this browser, and this device's own), so dropping one is never
 * an edit: a load alone sends nothing, and the server's copy loses them the
 * next time the display config is saved.
 */
export function dropDeadKeys(config) {
  if (!isObject(config)) return config;
  const sections = liveSections(config.sections);
  const keys = DEAD_KEYS.filter((key) => Object.hasOwn(config, key));
  if (keys.length === 0 && sections === config.sections) return config;
  const rest = { ...config };
  for (const key of keys) delete rest[key];
  if (upsHidden(config)) {
    const switches = isObject(config.overviewSections) ? config.overviewSections : {};
    rest.overviewSections = { ...switches, power: false };
  }
  if (sections !== config.sections) rest.sections = sections;
  return rest;
}
