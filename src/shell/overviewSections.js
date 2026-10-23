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
 *   services        every service in one list
 *   rail            the utilities rail beside the sections from 1440px:
 *                   weather, the clock, Quick Launch, Pipeline, the Checklist.
 *                   The Launch page keeps them all, whatever this says.
 *
 * Only `false` hides a section, so a missing key, or a value no switch saves,
 * shows it.
 */
import { withoutDeadGroupKeys } from './customGroups.js';

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

// Keys an older JagHelm saved that nothing reads: Settings → Widgets' "Show
// checklist panel on dashboard" (`showTodos`), which nothing drawn ever read,
// so the Checklist showed whatever it said (its switch is Settings → Sections',
// `sections.todos.visible`), and `showDockerStats`, which no panel used.
const DEAD_KEYS = ['showTodos', 'showDockerStats'];

/**
 * The old board's settings for a custom group's panel, `sections['group-<id>']`
 * (its `visible: false` hid the group), for each of `groups`: since #300 a
 * group is no panel, and since #517 no group is hidden (customGroups.js).
 */
const groupPanelKeys = (sections, groups) =>
  !sections || typeof sections !== 'object' || !Array.isArray(groups)
    ? []
    : groups
        .map((g) => (g && typeof g === 'object' ? `group-${g.id}` : null))
        .filter((key) => key && Object.hasOwn(sections, key));

/**
 * The display config without the keys nothing reads, or the same object when
 * it has none: `showTodos` and `showDockerStats`; a custom group's icon,
 * colour and `hidden` (DEAD_GROUP_KEYS, #517); and the old board's panel
 * settings for a group. Nothing else changes: a stored `showTodos: false`
 * hides no Checklist, since it never did, and `sections.todos` stays as it is.
 * The server's copy loses them the next time the display config is saved.
 */
export function dropDeadKeys(config) {
  if (!config || typeof config !== 'object') return config;
  const groups = withoutDeadGroupKeys(config.customGroups);
  const panels = groupPanelKeys(config.sections, config.customGroups);
  const dead = DEAD_KEYS.filter((key) => Object.hasOwn(config, key));
  if (dead.length === 0 && groups === config.customGroups && panels.length === 0) return config;
  const rest = { ...config };
  for (const key of dead) delete rest[key];
  if (groups !== config.customGroups) rest.customGroups = groups;
  if (panels.length > 0) {
    rest.sections = { ...config.sections };
    for (const key of panels) delete rest.sections[key];
  }
  return rest;
}
