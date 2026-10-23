import { describe, it, expect } from 'vitest';
import { OVERVIEW_SECTIONS, dropDeadKeys, sectionShown } from './overviewSections.js';

// #307: a show/hide switch per Overview section, in the shared display config,
// and the dead keys an older JagHelm saved dropped.
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

describe('dropDeadKeys: the keys nothing reads', () => {
  // Widgets' "Show checklist panel" (showTodos) was never read by anything
  // drawn: the Checklist showed whatever it said, so dropping it hides nothing.
  it('drops a saved showTodos and leaves the Checklist’s own switch as it is', () => {
    const config = { showTodos: false, sections: { ups: { visible: false } }, title: 'Lab' };
    const next = dropDeadKeys(config);
    expect(next).toEqual({ sections: { ups: { visible: false } }, title: 'Lab' });
    expect(next.sections.todos).toBeUndefined();
    expect(config.showTodos).toBe(false);
    expect(dropDeadKeys({ showTodos: true })).toEqual({});
  });

  it('never overrides an explicit visible: a Checklist switched on stays on', () => {
    const next = dropDeadKeys({ showTodos: false, sections: { todos: { visible: true } } });
    expect(next).toEqual({ sections: { todos: { visible: true } } });
    const off = dropDeadKeys({ showTodos: true, sections: { todos: { visible: false } } });
    expect(off).toEqual({ sections: { todos: { visible: false } } });
  });

  it('drops showDockerStats, which no panel reads', () => {
    expect(dropDeadKeys({ showDockerStats: false, theme: 'dark' })).toEqual({ theme: 'dark' });
  });

  it('returns the same config when there is nothing to drop', () => {
    const config = { sections: {}, showWeather: true };
    expect(dropDeadKeys(config)).toBe(config);
    expect(dropDeadKeys(null)).toBe(null);
  });
});
