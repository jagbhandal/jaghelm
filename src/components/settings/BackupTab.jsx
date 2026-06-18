import React, { useState } from 'react';
import { useConfig } from '../../context/ConfigContext.jsx';
import { useConfirm, useToast } from '../../context/OverlayContext.jsx';
import { Card } from './primitives.jsx';

// Top-level keys that must never be carried in from an imported file — assigning
// to these can poison the prototype chain. A valid config never contains them.
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

// Sanity-check a parsed import: it must be a plain, non-null, non-array object
// and must not try to set a dangerous top-level key. Unknown keys are tolerated
// (the config shape evolves), so this is a guard, not a strict schema.
function isPlausibleConfig(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  for (const key of FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) return false;
  }
  return true;
}

export default function BackupTab() {
  const { config, setConfig } = useConfig();
  const confirm = useConfirm();
  const toast = useToast();
  const [importStatus, setImportStatus] = useState(null);

  const exportConfig = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jaghelm-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importConfig = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      let parsed;
      try {
        parsed = JSON.parse(ev.target.result);
      } catch {
        const msg = 'Import failed: file is not valid JSON.';
        setImportStatus({ ok: false, msg });
        toast(msg, 'error');
        return;
      }
      if (!isPlausibleConfig(parsed)) {
        const msg = "Import failed: file isn't a valid configuration object.";
        setImportStatus({ ok: false, msg });
        toast(msg, 'error');
        return;
      }
      // Destructive: this overwrites every current setting. Confirm first, then
      // apply. The handler is async but we don't await it — the FileReader
      // callback can't be async and there's nothing after this to sequence.
      confirm({
        title: 'Replace your entire configuration?',
        body: 'This overwrites all current settings.',
        confirmLabel: 'Replace Config',
        danger: true,
      }).then((ok) => {
        if (!ok) {
          setImportStatus(null);
          return;
        }
        setConfig(parsed);
        setImportStatus({ ok: true, msg: 'Config imported successfully.' });
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="settings-section">
      <Card title="Export">
        <p className="settings-desc" style={{ marginBottom: 12 }}>
          Download your full display configuration as a JSON file. This includes theme, layout,
          sections, links, tabs, and all UI settings.
        </p>
        <button className="settings-btn-primary" onClick={exportConfig}>
          Export Config
        </button>
      </Card>

      <Card title="Import">
        <p className="settings-desc" style={{ marginBottom: 12 }}>
          Restore a previously exported configuration file. This will replace all current display
          settings.
        </p>
        <label className="settings-btn-sm" style={{ cursor: 'pointer', display: 'inline-block' }}>
          Choose File
          <input type="file" accept=".json" onChange={importConfig} hidden />
        </label>
        {importStatus && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: 13,
              background: importStatus.ok ? 'var(--green-bg)' : 'var(--red-bg)',
              color: importStatus.ok ? 'var(--green)' : 'var(--red)',
              border: `1px solid ${importStatus.ok ? 'var(--green-border)' : 'var(--red-border)'}`,
            }}
          >
            {importStatus.msg}
          </div>
        )}
      </Card>

      <Card title="Server Config">
        <p className="settings-desc" style={{ marginBottom: 12 }}>
          Infrastructure config (nodes, services, integrations) is stored server-side in{' '}
          <code
            className="settings-mono"
            style={{
              fontSize: 12,
              background: 'var(--bg-card-inner)',
              padding: '2px 6px',
              borderRadius: 4,
            }}
          >
            data/services.yaml
          </code>{' '}
          and persists across container rebuilds via the data volume.
        </p>
        <p className="settings-hint-block">
          Display config is saved to{' '}
          <code
            className="settings-mono"
            style={{
              fontSize: 11,
              background: 'var(--bg-card-inner)',
              padding: '2px 4px',
              borderRadius: 3,
            }}
          >
            data/display-config.json
          </code>{' '}
          automatically. All changes save in real-time.
        </p>
      </Card>
    </div>
  );
}
