import React from 'react';
import { Server } from 'lucide-react';
import { Group } from '../primitives.jsx';
import NodesTab from '../NodesTab.jsx';
import ServicesTab from '../ServicesTab.jsx';
import CustomGroups from '../CustomGroups.jsx';
import ConfigReadError from '../ConfigReadError.jsx';
import { useServerConfig } from '../serverConfig.js';

/**
 * Settings → Nodes & Services (#317): what JagHelm calls each machine and
 * service, and which monitor watches it. What was Nodes, Services and
 * Sections' custom groups, moved as they were; #319 rebuilds it (monitor
 * mapping with suggestions). Nodes and Services edit services.yaml
 * (serverConfig.js): while it can't be read, why, in place of both. The
 * custom groups are the display config's, listing the services this page
 * read.
 */
export default function NodesServices() {
  const server = useServerConfig();
  return (
    <div className="settings-section">
      {server.error ? (
        <ConfigReadError message={server.error} onRetry={server.retry} />
      ) : (
        <>
          <Group title="Nodes">
            {server.config ? (
              <NodesTab
                serverConfig={server.config}
                onSave={server.save}
                saving={server.saving}
                discovery={server.live?.discovery}
              />
            ) : (
              <LoadingState />
            )}
          </Group>
          <Group title="Services">
            {server.config && server.live ? (
              <ServicesTab
                serverConfig={server.config}
                liveServices={server.live}
                monitorNames={server.monitorNames}
                onSave={server.save}
                saving={server.saving}
              />
            ) : (
              <LoadingState />
            )}
          </Group>
        </>
      )}
      <Group
        title="Custom groups"
        description="Group services from any node. The Overview's Services section can list them by these groups."
      >
        <CustomGroups services={server.live} serverConfig={server.config} />
      </Group>
    </div>
  );
}

NodesServices.icon = <Server />;

/** What Settings' search finds Nodes & Services by (settingsSearch.js). */
NodesServices.settings = Object.freeze([
  {
    name: 'Nodes',
    words:
      'nodes node hosts machines servers display name rename subtitle role prometheus label colour color border visible hidden containers auto-discover discovery',
  },
  {
    name: 'Services',
    words:
      'services service containers docker monitor monitors uptime kuma mapping override display name icon hide show',
  },
  { name: 'Custom groups', words: 'groups grouping custom group' },
]);

function LoadingState() {
  return (
    <div className="settings-loading">
      <div className="skeleton" style={{ width: 20, height: 20, borderRadius: '50%' }} />
      <span className="text-mono" style={{ fontSize: 13 }}>
        Loading server config...
      </span>
    </div>
  );
}
