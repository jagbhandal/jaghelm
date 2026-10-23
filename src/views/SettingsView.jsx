import React, { useEffect, useMemo, useState } from 'react';
import { ShellPage } from '@ui/app-shell';
import { SettingsIndex, SettingsNav, SettingsSectionPage } from '@ui/settings';
import {
  MOVED_ANCHORS,
  SETTINGS_SECTIONS,
  isSettingsAnchor,
  settingsHref,
  settingsSectionFor,
} from '../components/settings/sections.js';
import { SECTION_VIEWS } from '../components/settings/sections/index.js';
import { searchSettings } from '../components/settings/settingsSearch.js';
import { followLink } from '../router/useRoute.js';
import { pathTo } from '../router/routes.js';

/**
 * Settings (#317, spec §7). /settings is an index of its sections, a card
 * each, which the search narrows by what they hold (settingsSearch.js: "font"
 * finds Appearance); /settings/<section> opens one, its module's page
 * (components/settings/sections/) beside the list of sections. The sections
 * are sections.js's, the one list (the command palette reads it too). A card
 * found by its settings opens the section at the first of them
 * (`#<anchor>`, its part on the page): "clock" opens Appearance at its Clock.
 *
 * `section` is the route's (/settings/:section?). An old tab's address
 * (/settings/links, from a bookmark) opens the section its settings moved to,
 * at the part it held, and the address becomes that section's
 * (/settings/apps#quick-launch-links); an address no section has becomes the
 * index's. `onSectionChange(id)` replaces the address (App.jsx); without
 * it the view keeps its own section, starting at `section`, and its links
 * open sections in place (the tests, the gallery). The search's words stay
 * while Settings is open, so Back from a section finds them.
 *
 * `status`, `reach` and `updated` are the header's status poll (useStatus,
 * App.jsx), which Sources draws its live health from (#318): no request of
 * its own.
 *
 * Changes apply to the board as they are made: there is no preview (#306,
 * spec M10).
 */
// What the reader does to scroll the page themselves.
const READER_SCROLLS = ['wheel', 'touchmove', 'keydown', 'pointerdown'];

export default function SettingsView({
  theme,
  setTheme,
  section,
  onSectionChange,
  status = null,
  reach = 'loading',
  updated = null,
}) {
  const routed = onSectionChange != null;
  const [ownSection, setOwnSection] = useState(section ?? null);
  const [ownAnchor, setOwnAnchor] = useState(null);
  const asked = routed ? (section ?? null) : ownSection;
  const open = settingsSectionFor(asked);
  const moved = open != null && asked !== open ? (MOVED_ANCHORS[asked] ?? null) : null;
  // The part to open at: an old address's, or the URL's #anchor (this view's
  // own, unrouted), when the section has it.
  const wanted = moved ?? (routed ? window.location.hash.slice(1) : ownAnchor);
  const anchor = open != null && isSettingsAnchor(open, wanted) ? wanted : null;
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!routed || asked == null || open === asked) return;
    onSectionChange(open ?? undefined);
    if (open != null && anchor != null) {
      const { pathname, search } = window.location;
      window.history.replaceState(window.history.state, '', `${pathname}${search}#${anchor}`);
    }
  }, [routed, asked, open, anchor, onSectionChange]);

  // Open at the part: under the header (its scroll-margin), once drawn. A part
  // under content still on its way (Nodes & Services reads services.yaml)
  // moves down as it lands, so the page follows it while the section grows,
  // for a few seconds or until the reader scrolls.
  useEffect(() => {
    if (anchor == null) return undefined;
    const scroll = () => document.getElementById(anchor)?.scrollIntoView?.({ block: 'start' });
    scroll();
    const body = document.getElementById(anchor)?.closest('[data-slot="settings-section-body"]');
    if (!body || typeof ResizeObserver === 'undefined') return undefined;
    let height = body.offsetHeight;
    const observer = new ResizeObserver(() => {
      if (body.offsetHeight === height) return;
      height = body.offsetHeight;
      scroll();
    });
    observer.observe(body);
    const stop = () => {
      observer.disconnect();
      clearTimeout(timer);
      for (const type of READER_SCROLLS) window.removeEventListener(type, stop);
    };
    const timer = setTimeout(stop, 4000);
    for (const type of READER_SCROLLS) window.addEventListener(type, stop, { passive: true });
    return stop;
  }, [open, anchor]);

  const sections = useMemo(
    () =>
      SETTINGS_SECTIONS.map((s) => ({
        ...s,
        description: s.desc,
        icon: SECTION_VIEWS[s.id].icon,
        href: settingsHref(s.id),
      })),
    []
  );
  // A card found by its settings opens the section at the first of them.
  const found = useMemo(
    () =>
      searchSettings(sections, query).map((s) => {
        const at = s.settings.find((p) => s.hits.includes(p.name) && p.anchor != null);
        return at ? { ...s, href: settingsHref(s.id, at.anchor) } : s;
      }),
    [sections, query]
  );

  // A link to the index or a section: the router's, or this view's own.
  const go = (event, href) => {
    if (routed) {
      followLink(event, href);
      return;
    }
    event.preventDefault();
    const [path, hash = null] = href.split('#');
    setOwnSection(path.split('/')[2] ?? null);
    setOwnAnchor(hash);
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
      <View
        key={open}
        theme={theme}
        setTheme={setTheme}
        status={status}
        reach={reach}
        updated={updated}
      />
    </SettingsSectionPage>
  );
}
