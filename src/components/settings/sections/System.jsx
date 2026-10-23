import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useConfig } from '../../../context/ConfigContext.jsx';
import Field from '../Field';
import { Card, Group } from '../primitives.jsx';
import SecurityTab from '../SecurityTab.jsx';
import BackupTab from '../BackupTab.jsx';

/**
 * Settings → System (#317): your account, backups and how often JagHelm
 * reads its sources. What was Security and Backup, and the refresh interval
 * (Layout's), moved as they were.
 */
export default function System() {
  return (
    <div className="settings-section">
      <Group title="Password and sessions" id="password">
        <SecurityTab />
      </Group>
      <Group title="Backup" id="backup">
        <BackupTab />
      </Group>
      <RefreshCard />
    </div>
  );
}

System.icon = <ShieldCheck />;

/** How often the board asks for new numbers. */
function RefreshCard() {
  const { config, update } = useConfig();
  return (
    <Card title="Data refresh" id="data-refresh">
      <Field label={`Auto-refresh Interval: ${config.refreshInterval || 30}s`}>
        <input
          type="range"
          min="10"
          max="120"
          step="5"
          value={config.refreshInterval || 30}
          onChange={(e) => update('refreshInterval', parseInt(e.target.value))}
          className="settings-range"
        />
        <div className="settings-range-labels">
          <span>10s (fast)</span>
          <span>120s (slow)</span>
        </div>
      </Field>
    </Card>
  );
}
