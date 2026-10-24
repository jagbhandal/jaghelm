import React, { useEffect, useState } from 'react';
import { Server } from 'lucide-react';
import { BackupJobList } from '@ui/service-mapping';
import { SettingsPart } from '@ui/settings';
import { useConfig } from '../../../context/ConfigContext.jsx';
import { getCronStatus } from '../../../hooks/useData.js';
import { Group } from '../primitives.jsx';
import NodesTab from '../NodesTab.jsx';
import ServicesTab from '../ServicesTab.jsx';
import CustomGroups from '../CustomGroups.jsx';
import ConfigReadError from '../ConfigReadError.jsx';
import { useServerConfig } from '../serverConfig.js';
import { backupRows, withBackup } from './backupJobs.js';
import DiskForecast from './DiskForecast.jsx';
import { savedOrder } from '../../../shell/nodeOrder.js';

/**
 * Settings → Nodes & Services (#317, #319): what JagHelm calls each machine
 * and service, which monitor watches each service, which cron jobs are
 * backups, and the custom groups. Nodes and Services edit services.yaml
 * (serverConfig.js): while it can't be read, why, in place of both. The
 * services map their monitors on purpose (ServicesTab.jsx): each shows the
 * monitor Auto-match would pick and why, to accept or override. The backup
 * jobs are marked in the display config's `backupJobs`, the key the status
 * model has always read. The custom groups are the display config's, listing
 * the services this page read.
 */
export default function NodesServices() {
  const server = useServerConfig();
  const { config, setConfig, refresh } = useConfig();
  // Read the server's copy again, then set the order (the display config's
  // `nodeOrder`, #667), as Appearance does for the themes.
  const reorder = async (keys) => {
    try {
      await refresh?.();
    } catch {
      // Unreadable now: the save rebases onto the server's copy later.
    }
    setConfig((prev) => ({ ...prev, nodeOrder: savedOrder(keys) }));
  };
  return (
    <div className="settings-section">
      {server.error ? (
        <ConfigReadError message={server.error} onRetry={server.retry} />
      ) : (
        <>
          <Group title="Nodes" id="nodes">
            {server.config ? (
              <NodesTab
                serverConfig={server.config}
                onSave={server.save}
                saving={server.saving}
                discovery={server.live?.discovery}
                order={config.nodeOrder}
                onOrder={reorder}
              />
            ) : (
              <LoadingState />
            )}
          </Group>
          <SettingsPart>
            <ServicesTab
              serverConfig={server.config}
              liveServices={server.live}
              monitorNames={server.monitorNames}
              mapping={server.mapping}
              onSave={server.save}
              saving={server.saving}
            />
          </SettingsPart>
        </>
      )}
      {/* The backup jobs are the display config's: they show whatever services.yaml is doing. */}
      <SettingsPart>
        <BackupJobs />
      </SettingsPart>
      <DiskForecastGroup />
      <Group
        title="Custom groups"
        id="custom-groups"
        description="Group services from any node. The Overview's Services section can list them by these groups."
      >
        <CustomGroups services={server.live} serverConfig={server.config} />
      </Group>
    </div>
  );
}

NodesServices.icon = <Server />;

/** The disk forecast's lines (#670): the display config's, they colour a number the server computes. */
function DiskForecastGroup() {
  return (
    <Group
      title="Disk forecast"
      id="disk-forecast"
      description="When the days left before a disk fills turn amber and red."
    >
      <DiskForecast />
    </Group>
  );
}

/** Backup jobs (#319, spec §6.2): the cron jobs that reported, each markable as a backup. */
function BackupJobs() {
  const { config, update } = useConfig();
  const [statuses, setStatuses] = useState(undefined); // undefined: reading; null: unread
  useEffect(() => {
    let live = true;
    getCronStatus(true)
      .then((body) => live && setStatuses(Array.isArray(body) ? body : null))
      .catch(() => live && setStatuses(null));
    return () => {
      live = false;
    };
  }, []);
  const marked = config?.backupJobs;
  return (
    <BackupJobList
      id="backups"
      className="settings-anchor"
      rows={backupRows(statuses, marked)}
      loading={statuses === undefined}
      unread={statuses === null}
      onToggle={(key, on) => update('backupJobs', withBackup(marked, key, on))}
    />
  );
}

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
