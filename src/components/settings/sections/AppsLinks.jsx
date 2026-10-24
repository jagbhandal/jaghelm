import React from 'react';
import { LayoutGrid } from 'lucide-react';
import { SettingRow, SettingRows, ToggleRow } from '@ui/appearance';
import { Panel } from '@ui/panel';
import { SegmentedControl } from '@ui/segmented-control';
import { Select } from '@ui/select';
import { SettingsPart } from '@ui/settings';
import { checkEmbedUrl } from '../../../api/embedCheck.js';
import { SEARCH_ENGINES } from '../../../hooks/useData';
import { useConfig } from '../../../context/ConfigContext.jsx';
import AppsPanel from './AppsPanel.jsx';
import QuickLaunchPanel from './QuickLaunchPanel.jsx';

/**
 * Settings → Apps & links (#317, #362; added to the spec's six by Jag, §15):
 * what opens inside JagHelm and the links one click away, in the design
 * system (src/ui/apps-links.jsx and the controls). Embedded apps (the
 * config's `tabs`: name, address, icon, order, open in a new browser tab, and
 * an embedding check before one is added); Quick Launch links (`links`,
 * groups and links); where links open (`linkTarget`); and the Launch page's
 * web search (`showSearch`, `searchEngine`). A change applies at once, as the
 * rest of Settings does. What was the Tabs and Links tabs carries over as it
 * was saved: nothing in `tabs` or `links` is rewritten but what is edited.
 *
 * `checkEmbed` is the check of an address that is not saved (checkEmbedUrl) and
 * `checkSaved` that of a saved app (`(url, id)`), here to be replaced in tests and
 * the gallery, which also passes `initial` (AppsPanel's).
 */
export default function AppsLinks({
  checkEmbed = checkEmbedUrl,
  checkSaved = undefined,
  initial = null,
}) {
  return (
    <SettingsPart>
      <AppsPanel checkEmbed={checkEmbed} checkSaved={checkSaved} initial={initial} />
      <QuickLaunchPanel />
      <LinkTargetPanel />
      <WebSearchPanel />
    </SettingsPart>
  );
}

AppsLinks.icon = <LayoutGrid />;

// A part a link opens at stops under the header (global.css).
const part = (id) => ({ id, className: 'settings-anchor' });

const TARGETS = [
  { value: '_blank', label: 'New tab' },
  { value: '_self', label: 'Same tab' },
];

/** Where Quick Launch links and service links open. */
function LinkTargetPanel() {
  const { config, update } = useConfig();
  return (
    <Panel flush title="Where links open" {...part('link-target')}>
      <SettingRows>
        <SettingRow
          label="Open links in"
          description="Where Quick Launch links and service links open"
          control={(ids) => (
            <SegmentedControl
              {...ids}
              aria-label="Open links in"
              options={TARGETS}
              value={config.linkTarget || '_blank'}
              onValueChange={(value) => update('linkTarget', value)}
            />
          )}
        />
      </SettingRows>
    </Panel>
  );
}

const ENGINES = SEARCH_ENGINES.map((s) => ({ value: s.id, label: s.name }));

/** The Launch page's web search (#307): its switch and its engine. */
function WebSearchPanel() {
  const { config, update } = useConfig();
  return (
    <Panel flush title="Web search" {...part('web-search')}>
      <SettingRows>
        <ToggleRow
          label="Show the web search on the Launch page"
          checked={config.showSearch !== false}
          onCheckedChange={(on) => update('showSearch', on)}
        />
        <SettingRow
          label="Search engine"
          description="What the Launch page’s search box asks"
          control={(ids) => (
            <Select
              {...ids}
              aria-label="Search engine"
              items={ENGINES}
              value={config.searchEngine || 'google'}
              onValueChange={(value) => update('searchEngine', value)}
            />
          )}
        />
      </SettingRows>
    </Panel>
  );
}
