import React, { useEffect, useMemo, useState } from 'react';
import { ShellPage } from '@ui/app-shell';
import { SettingsIndex, SettingsNav, SettingsSectionPage } from '@ui/settings';
import { SETTINGS_SECTIONS, settingsSectionFor } from '../components/settings/sections.js';
import { SECTION_VIEWS } from '../components/settings/sections/index.js';
import { searchSettings } from '../components/settings/settingsSearch.js';
import { followLink } from '../router/useRoute.js';
import { pathTo } from '../router/routes.js';

/**
 * Settings (#317, spec §7). /settings is an index of its sections, a card
 * each, which the search narrows by what they hold (settingsSearch.js: "font"
 * finds Appearance); /settings/<section> opens one, its module's page
 * (components/settings/sections/) beside the list of sections. The sections
 * are sections.js's, the one list (the command palette reads it too).
 *
 * `section` is the route's (/settings/:section?). An old tab's address
 * (/settings/links, from a bookmark) opens the section its settings moved to
 * and the address becomes that section's; an address no section has becomes
 * the index's. `onSectionChange(id)` replaces the address (App.jsx); without
 * it the view keeps its own section, starting at `section`, and its links
 * open sections in place (the tests, the gallery). The search's words stay
 * while Settings is open, so Back from a section finds them.
 *
 * Changes apply to the board as they are made: there is no preview (#306,
 * spec M10).
 */
export default function SettingsView({ theme, setTheme, section, onSectionChange }) {
  const routed = onSectionChange != null;
  const [ownSection, setOwnSection] = useState(section ?? null);
  const asked = routed ? (section ?? null) : ownSection;
  const open = settingsSectionFor(asked);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (routed && asked != null && open !== asked) onSectionChange(open ?? undefined);
  }, [routed, asked, open, onSectionChange]);

  const sections = useMemo(
    () =>
      SETTINGS_SECTIONS.map((s) => ({
        ...s,
        description: s.desc,
        icon: SECTION_VIEWS[s.id].icon,
        settings: SECTION_VIEWS[s.id].settings,
        href: pathTo('settings', { section: s.id }),
      })),
    []
  );
  const found = useMemo(() => searchSettings(sections, query), [sections, query]);

  // A link to the index or a section: the router's, or this view's own.
  const go = (event, href) => {
    if (routed) {
      followLink(event, href);
      return;
    }
    event.preventDefault();
    setOwnSection(href.split('/')[2] ?? null);
  };

  if (open == null) {
    return (
      <ShellPage title="Settings" description="Find a setting by its name, or open a section.">
        <SettingsIndex query={query} onQueryChange={setQuery} sections={found} onNavigate={go} />
      </ShellPage>
    );
  }

  const current = sections.find((s) => s.id === open);
  const View = SECTION_VIEWS[open];
  return (
    <SettingsSectionPage
      title={current.label}
      description={current.desc}
      indexHref={pathTo('settings')}
      onNavigate={go}
      nav={<SettingsNav sections={sections} current={open} onNavigate={go} />}
    >
      <View key={open} theme={theme} setTheme={setTheme} />
    </SettingsSectionPage>
  );
}
