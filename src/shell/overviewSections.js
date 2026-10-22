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

/**
 * The display config with the switches an older JagHelm saved moved to where
 * they work now, or the same object when there is none. Settings → Widgets'
 * "Show checklist panel on dashboard" (`showTodos`) stopped doing anything with
 * the new shell (#301): the Checklist has its own switch in Settings → Sections
 * (`sections.todos.visible`), which the board and the rail read. A saved
 * "hidden" becomes that switch off, so nobody's choice is lost; either way
 * `showTodos` goes.
 */
export function migrateDisplayConfig(config) {
  if (!config || typeof config !== 'object' || !Object.hasOwn(config, 'showTodos')) return config;
  const { showTodos, ...rest } = config;
  if (showTodos !== false) return rest;
  const sections = rest.sections && typeof rest.sections === 'object' ? rest.sections : {};
  return {
    ...rest,
    sections: { ...sections, todos: { ...sections.todos, visible: false } },
  };
}
