import { describe, it, expect } from 'vitest';
import { OVERVIEW_SECTIONS, migrateDisplayConfig, sectionShown } from './overviewSections.js';

// #307: a show/hide switch per Overview section, in the shared display config,
// and the dead switches it supersedes moved to where they work.
describe('the Overview sections a user can hide', () => {
  it('lists the attention panel (locked), the strip, Infrastructure, Services and the rail', () => {
    expect(OVERVIEW_SECTIONS.map((s) => [s.id, Boolean(s.locked)])).toEqual([
      ['attention', true],
      ['strip', false],
      ['infrastructure', false],
      ['services', false],
      ['rail', false],
    ]);
  });

  it('shows every section until it is switched off', () => {
    for (const { id } of OVERVIEW_SECTIONS) {
      expect(sectionShown({}, id)).toBe(true);
      expect(sectionShown(null, id)).toBe(true);
      expect(sectionShown({ overviewSections: { [id]: true } }, id)).toBe(true);
    }
    const config = { overviewSections: { strip: false, services: false } };
    expect(sectionShown(config, 'strip')).toBe(false);
    expect(sectionShown(config, 'services')).toBe(false);
    expect(sectionShown(config, 'infrastructure')).toBe(true);
    expect(sectionShown(config, 'rail')).toBe(true);
  });

  it('only false hides one: a hand-edited "no" or 0 is not a choice', () => {
    expect(sectionShown({ overviewSections: { rail: 'no' } }, 'rail')).toBe(true);
    expect(sectionShown({ overviewSections: { rail: 0 } }, 'rail')).toBe(true);
    expect(sectionShown({ overviewSections: 'rail' }, 'rail')).toBe(true);
  });

  it('never hides the attention panel, whatever the config says', () => {
    expect(sectionShown({ overviewSections: { attention: false } }, 'attention')).toBe(true);
  });
});

describe('migrateDisplayConfig: the dead Widgets → "Show checklist panel" switch', () => {
  it('moves a saved "hidden" to the Checklist’s own switch, so the choice is kept', () => {
    const config = { showTodos: false, sections: { ups: { visible: false } }, title: 'Lab' };
    const next = migrateDisplayConfig(config);
    expect(next).toEqual({
      sections: { ups: { visible: false }, todos: { visible: false } },
      title: 'Lab',
    });
    expect(config.showTodos).toBe(false);
  });

  it('keeps the Checklist’s other settings when it moves the switch', () => {
    const next = migrateDisplayConfig({
      showTodos: false,
      sections: { todos: { title: 'Jobs', borderColor: '#fff' } },
    });
    expect(next.sections.todos).toEqual({ title: 'Jobs', borderColor: '#fff', visible: false });
  });

  it('drops a saved "shown": the Checklist’s own switch already says what to do', () => {
    const off = { showTodos: true, sections: { todos: { visible: false } } };
    expect(migrateDisplayConfig(off)).toEqual({ sections: { todos: { visible: false } } });
    expect(migrateDisplayConfig({ showTodos: true })).toEqual({});
  });

  it('returns the same config when there is nothing to move', () => {
    const config = { sections: {}, showWeather: true };
    expect(migrateDisplayConfig(config)).toBe(config);
    expect(migrateDisplayConfig(null)).toBe(null);
  });
});
