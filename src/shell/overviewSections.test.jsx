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
    const grouped = {
      customGroups: [{ id: 'g', title: 'G', containers: ['pi-1:adguard-home'] }],
      sections: { 'pi-1': { visible: false } },
    };
    expect(dropDeadKeys(grouped)).toBe(grouped);
  });

  // #517: a custom group's icon and colour do nothing since #295, and a hidden
  // group (the old board's `sections['group-<id>'].visible`) could hide a down
  // service, so the option went; the Overview's show/hide is Appearance's.
  it("drops a custom group's icon, colour and hidden, and the old board's panel settings for it", () => {
    const config = {
      customGroups: [
        {
          id: 'custom-1',
          title: 'DNS',
          icon: '📂',
          borderColor: '#7c5cff',
          hidden: true,
          containers: ['adguard-home'],
        },
        { id: 'custom-2', title: 'Media', containers: ['apps:jellyfin'] },
      ],
      sections: {
        'group-custom-1': { visible: false, title: 'DNS' },
        ups: { visible: false },
        'pi-1': { visible: true },
      },
    };
    const next = dropDeadKeys(config);
    expect(next).toEqual({
      customGroups: [
        { id: 'custom-1', title: 'DNS', containers: ['adguard-home'] },
        { id: 'custom-2', title: 'Media', containers: ['apps:jellyfin'] },
      ],
      sections: { ups: { visible: false }, 'pi-1': { visible: true } },
    });
    // The group untouched is the same object, and the stored config is unchanged.
    expect(next.customGroups[1]).toBe(config.customGroups[1]);
    expect(config.customGroups[0].icon).toBe('📂');
    expect(dropDeadKeys(next)).toBe(next);
  });
});
