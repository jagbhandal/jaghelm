import React from 'react';
import { LayoutGrid } from 'lucide-react';
import { SEARCH_ENGINES } from '../../../hooks/useData';
import { useConfig } from '../../../context/ConfigContext.jsx';
import Field from '../Field';
import { Card, ChoiceGroup, Group, Toggle } from '../primitives.jsx';
import TabsTab from '../TabsTab.jsx';
import LinksTab from '../LinksTab.jsx';

/**
 * Settings → Apps & links (#317, added to the spec's six by Jag, §15): what
 * opens inside JagHelm and the links one click away. What was Tabs and Links,
 * where links open (Layout's) and the Launch page's web search (Widgets'),
 * moved as they were; #362 rebuilds it (an embedding check, reordering).
 */
export default function AppsLinks() {
  return (
    <div className="settings-section">
      <Group title="Embedded apps" id="embedded-apps">
        <TabsTab />
      </Group>
      <Group title="Quick Launch links" id="quick-launch-links">
        <LinksTab />
      </Group>
      <LinkTargetCard />
      <WebSearchCard />
    </div>
  );
}

AppsLinks.icon = <LayoutGrid />;

/** Where Quick Launch links and service links open. */
function LinkTargetCard() {
  const { config, update } = useConfig();
  return (
    <Card title="Where links open" id="link-target">
      <Field label="Link Target">
        <ChoiceGroup
          ariaLabel="Link Target"
          value={config.linkTarget || '_blank'}
          options={[
            { value: '_blank', label: 'New Tab' },
            { value: '_self', label: 'Same Tab' },
          ]}
          onChange={(value) => update('linkTarget', value)}
        />
        <div className="settings-hint-block">Where Quick Launch links and service links open</div>
      </Field>
    </Card>
  );
}

/** The Launch page's web search (#307): its switch and its engine. */
function WebSearchCard() {
  const { config, update } = useConfig();
  return (
    <Card title="Web search" id="web-search">
      <Toggle
        label="Show the web search on the Launch page"
        checked={config.showSearch !== false}
        onChange={(v) => update('showSearch', v)}
      />
      <Field label="Search Engine">
        <select
          className="settings-input"
          value={config.searchEngine || 'google'}
          onChange={(e) => update('searchEngine', e.target.value)}
        >
          {SEARCH_ENGINES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
    </Card>
  );
}
