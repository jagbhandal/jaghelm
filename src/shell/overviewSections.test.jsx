import { describe, it, expect } from 'vitest';
import {
  OVERVIEW_SECTIONS,
  SECTION_OF,
  dropDeadKeys,
  emptyFilterReason,
  sectionShown,
} from './overviewSections.js';

// #307: a show/hide switch per Overview section, in the shared display config,
// and the dead keys an older JagHelm saved dropped.
describe('the Overview sections a user can hide', () => {
  it('lists the attention panel (locked), the strip, Infrastructure, Power, Jobs, Services, the pending host steps, the backups, config drift and the rail', () => {
    expect(OVERVIEW_SECTIONS.map((s) => [s.id, Boolean(s.locked)])).toEqual([
      ['attention', true],
      ['strip', false],
      ['infrastructure', false],
      ['power', false],
      ['jobs', false],
      ['services', false],
      ['hostActions', false],
      ['backupFreshness', false],
      ['configDrift', false],
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
    expect(sectionShown(config, 'jobs')).toBe(true);
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
    const config = { showTodos: false, sections: { edge: { visible: false } }, title: 'Lab' };
    const next = dropDeadKeys(config);
    expect(next).toEqual({ sections: { edge: { visible: false } }, title: 'Lab' });
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

  it('turns the old tempUnit into the one units setting (#322), unless units is set', () => {
    expect(dropDeadKeys({ tempUnit: 'F', theme: 'dark' })).toEqual({
      units: 'imperial',
      theme: 'dark',
    });
    expect(dropDeadKeys({ tempUnit: 'C' })).toEqual({ units: 'metric' });
    expect(dropDeadKeys({ tempUnit: 'F', units: 'metric' })).toEqual({ units: 'metric' });
    expect(dropDeadKeys({ tempUnit: 'warm' })).toEqual({});
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

describe('dropDeadKeys: the old grid board’s keys (#306)', () => {
  it('drops its layout, its columns, the scheduled jobs panel’s switch and Collapsible sections', () => {
    const config = {
      gridLayout: { lg: [{ i: 'node-pve', x: 0, y: 0, w: 12, h: 8 }] },
      gridColumns: 24,
      showCronJobs: false,
      collapsibleSections: true,
      refreshInterval: 30,
    };
    expect(dropDeadKeys(config)).toEqual({ refreshInterval: 30 });
  });

  it('drops the UPS panel’s settings and the panels’ looks, keeping each utility’s switch and the nodes’', () => {
    const config = {
      sections: {
        ups: { visible: false, title: 'Power', borderColor: '#f00' },
        pipeline: { visible: false, title: 'CI', icon: '🔄', bgColor: '#000', bgOpacity: 0.2 },
        quicklaunch: { title: 'Links', subtitle: 'mine' },
        todos: { visible: true },
        edge: { visible: false, borderColor: '#0f0' },
      },
    };
    expect(dropDeadKeys(config)).toEqual({
      sections: {
        pipeline: { visible: false },
        quicklaunch: {},
        todos: { visible: true },
        edge: { visible: false, borderColor: '#0f0' },
      },
      // The UPS panel was off: so is the Power section.
      overviewSections: { power: false },
    });
    // Only `visible` left: nothing to drop, the same object.
    const clean = { sections: { todos: { visible: false }, edge: { visible: true } } };
    expect(dropDeadKeys(clean)).toBe(clean);
  });
});

describe('dropDeadKeys: the welcome message (#317)', () => {
  it('drops it: nothing has drawn it since the old header, and Settings no longer offers it', () => {
    const config = { title: 'Homelab', welcomeMessage: { enabled: true, text: 'Ahoy' } };
    expect(dropDeadKeys(config)).toEqual({ title: 'Homelab' });
  });
});

describe('a filter with no section of its own (#306)', () => {
  it('says why: its section switched off, or none for its subsystem', () => {
    const off = { overviewSections: { power: false, jobs: false } };
    expect(emptyFilterReason(null, off)).toBeNull();
    expect(emptyFilterReason('power', off)).toEqual({ why: 'off', section: 'Power' });
    expect(emptyFilterReason('backups', off)).toEqual({ why: 'off', section: 'Jobs' });
    expect(emptyFilterReason('nodes', off)).toBeNull();
    expect(emptyFilterReason('services', {})).toBeNull();
    expect(emptyFilterReason('integrations', {})).toEqual({ why: 'none' });
    expect(SECTION_OF).toEqual({
      nodes: 'infrastructure',
      power: 'power',
      jobs: 'jobs',
      backups: 'jobs',
      services: 'services',
    });
  });
});

describe('dropDeadKeys: Typography’s font sizes, and a UPS hidden on the old board (#306)', () => {
  it('drops the font sizes, which sized only the old board', () => {
    expect(dropDeadKeys({ fontSizes: { sectionTitle: 20 }, fontFamily: 'clean' })).toEqual({
      fontFamily: 'clean',
    });
  });

  it('a UPS panel switched off keeps the UPS hidden: the Power section off, unless already set', () => {
    expect(dropDeadKeys({ sections: { ups: { visible: false } } })).toEqual({
      sections: {},
      overviewSections: { power: false },
    });
    expect(
      dropDeadKeys({
        sections: { ups: { visible: false } },
        overviewSections: { strip: false },
      })
    ).toEqual({ sections: {}, overviewSections: { strip: false, power: false } });
    // A choice already made in Appearance stands.
    expect(
      dropDeadKeys({ sections: { ups: { visible: false } }, overviewSections: { power: true } })
    ).toEqual({ sections: {}, overviewSections: { power: true } });
    // A UPS panel that was on, or never switched, says nothing.
    expect(dropDeadKeys({ sections: { ups: { visible: true } } })).toEqual({ sections: {} });
    expect(dropDeadKeys({ sections: { ups: { title: 'APC' } } })).toEqual({ sections: {} });
  });

  it('is the same whichever copy it reads: run twice, nothing more changes', () => {
    const once = dropDeadKeys({ sections: { ups: { visible: false } }, fontSizes: {} });
    expect(dropDeadKeys(once)).toBe(once);
  });
});
