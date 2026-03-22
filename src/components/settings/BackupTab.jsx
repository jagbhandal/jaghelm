import React, { useState } from 'react';

export default function BackupTab({ config, setConfig }) {
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
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed || typeof parsed !== 'object') throw new Error('Invalid format');
        setConfig(parsed);
        setImportStatus({ ok: true, msg: 'Config imported successfully.' });
      } catch (err) {
        setImportStatus({ ok: false, msg: `Import failed: ${err.message}` });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="settings-section">
      <Card title="Export">
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Download your full display configuration as a JSON file. This includes theme, layout, sections, links, tabs, and all UI settings.
        </p>
        <button className="settings-btn-sm" onClick={exportConfig} style={{ background: 'var(--accent)', color: '#fff', border: 'none' }}>
          Export Config
        </button>
      </Card>

      <Card title="Import">
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Restore a previously exported configuration file. This will replace all current display settings.
        </p>
        <label className="settings-btn-sm" style={{ cursor: 'pointer', display: 'inline-block' }}>
          Choose File
          <input type="file" accept=".json" onChange={importConfig} hidden />
        </label>
        {importStatus && (
          <div style={{
            marginTop: 12, padding: '10px 14px', borderRadius: 8, fontSize: 13,
            background: importStatus.ok ? 'var(--green-bg)' : 'var(--red-bg)',
            color: importStatus.ok ? 'var(--green)' : 'var(--red)',
            border: `1px solid ${importStatus.ok ? 'var(--green-border)' : 'var(--red-border)'}`,
          }}>
            {importStatus.msg}
          </div>
        )}
      </Card>

      <Card title="Server Config">
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Infrastructure config (nodes, services, integrations) is stored server-side in <code style={{
            fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--bg-card-inner)',
            padding: '2px 6px', borderRadius: 4,
          }}>data/services.yaml</code> and persists across container rebuilds via the data volume.
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Display config is saved to <code style={{
            fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg-card-inner)',
            padding: '2px 4px', borderRadius: 3,
          }}>data/display-config.json</code> automatically. All changes save in real-time.
        </p>
      </Card>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="settings-card">
      {title && <h3 className="settings-card-title">{title}</h3>}
      {children}
    </div>
  );
}
