import { describe, it, expect } from 'vitest';
import { SETTINGS_SECTIONS } from './sections.js';
import { SEARCHABLE_SECTIONS, WORDS } from './sectionTerms.js';
import { searchSettings } from './settingsSearch.js';

// WORDS is keyed by part name, so renaming a part in sections.js would
// silently drop its words from the search (#611).
describe('Settings search words', () => {
  it('every WORDS key is a real section and part', () => {
    for (const [id, parts] of Object.entries(WORDS)) {
      const section = SETTINGS_SECTIONS.find((s) => s.id === id);
      expect(section, `section ${id}`).toBeDefined();
      const names = section.settings.map((p) => p.name);
      for (const name of Object.keys(parts)) expect(names, `${id}: ${name}`).toContain(name);
    }
  });

  it('every part outside Sources has words', () => {
    for (const s of SEARCHABLE_SECTIONS) {
      if (s.id === 'sources') continue;
      for (const p of s.settings) expect(p.words, `${s.id}: ${p.name}`).toBeTruthy();
    }
  });
});

// Settings → System → Energy cost (#743) is found by what someone would type.
describe('Energy cost in the search', () => {
  it.each(['electricity', 'kWh', 'rate', 'cost', 'power'])('"%s" finds it in System', (q) => {
    const found = searchSettings(SEARCHABLE_SECTIONS, q);
    expect(found.find((s) => s.id === 'system')?.hits).toContain('Energy cost');
  });
});
