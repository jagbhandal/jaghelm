import React, { useState, useEffect, useCallback } from 'react';

/**
 * IntegrationsTab — Phase 3 Settings
 * 
 * Three views:
 * 1. Home — list of configured integrations + "Add Integration" button
 * 2. Gallery — browse 42 presets by category, search/filter
 * 3. Config — form for URL, credentials, test, save (works for both presets and custom)
 */

// ── Category definitions for the preset gallery ──
const CATEGORIES = [
  { id: 'all', label: 'All', icon: '📋' },
  { id: 'dns', label: 'DNS & Ad Blocking', icon: '🛡' },
  { id: 'proxy', label: 'Proxy & Networking', icon: '🌐' },
  { id: 'media-server', label: 'Media Servers', icon: '🎬' },
  { id: 'media-mgmt', label: 'Media Management', icon: '📺' },
  { id: 'downloads', label: 'Downloads', icon: '⬇' },
  { id: 'infra', label: 'Infrastructure', icon: '📊' },
  { id: 'files', label: 'Files & Docs', icon: '📁' },
  { id: 'security', label: 'Security', icon: '🔐' },
  { id: 'dev', label: 'Dev & Code', icon: '💻' },
  { id: 'home', label: 'Home & Notifications', icon: '🏠' },
];

// Map preset types to categories
const PRESET_CATEGORIES = {
  adguard: 'dns', pihole: 'dns', nextdns: 'dns',
  npm: 'proxy', traefik: 'proxy', cloudflare: 'proxy', tailscale: 'proxy', caddy: 'proxy',
  plex: 'media-server', jellyfin: 'media-server', emby: 'media-server', tautulli: 'media-server',
  sonarr: 'media-mgmt', radarr: 'media-mgmt', lidarr: 'media-mgmt', readarr: 'media-mgmt',
  prowlarr: 'media-mgmt', bazarr: 'media-mgmt', overseerr: 'media-mgmt',
  qbittorrent: 'downloads', transmission: 'downloads', sabnzbd: 'downloads', nzbget: 'downloads', deluge: 'downloads',
  grafana: 'infra', portainer: 'infra', proxmox: 'infra', speedtest: 'infra',
  nextcloud: 'files', photoprism: 'files', immich: 'files', paperless: 'files',
  vaultwarden: 'security', authentik: 'security',
  gitea: 'dev', gitlab: 'dev',
  homeassistant: 'home', frigate: 'home', gotify: 'home', ntfy: 'home', watchtower: 'home', mealie: 'home',
};

// Auth type labels and field requirements
const AUTH_LABELS = {
  none: 'No Authentication',
  basic: 'Basic Auth (Username + Password)',
  bearer: 'Bearer Token',
  header: 'API Key (Custom Header)',
  query: 'API Key (Query Parameter)',
  session: 'Session Login (Username + Password)',
};

// What credential fields each auth type needs
const AUTH_FIELDS = {
  none: [],
  basic: ['username', 'password'],
  bearer: ['token'],
  header: ['token'],
  query: ['token'],
  session: ['username', 'password'],
};

export default function IntegrationsTab() {
  // ── State ──
  const [view, setView] = useState('home'); // 'home' | 'gallery' | 'config'
  const [presets, setPresets] = useState([]);
  const [configured, setConfigured] = useState({});
  const [loading, setLoading] = useState(true);

  // Gallery state
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');

  // Config form state
  const [selectedPreset, setSelectedPreset] = useState(null); // null = custom builder
  const [editingType, setEditingType] = useState(null); // set when editing existing (storage key)
  const [formUrl, setFormUrl] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formToken, setFormToken] = useState('');
  const [formEnabled, setFormEnabled] = useState(true);
  const [formInstance, setFormInstance] = useState(''); // e.g. "primary", "secondary"
  const [formTarget, setFormTarget] = useState(''); // container UID e.g. "pi:adguard-home"
  const [allContainers, setAllContainers] = useState([]); // for target dropdown
  const [testStatus, setTestStatus] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);

  // ── Fetch presets + configured integrations ──
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [presetsRes, configRes, servicesRes] = await Promise.all([
        fetch('/api/integrations/presets').then(r => r.ok ? r.json() : []),
        fetch('/api/services/config').then(r => r.ok ? r.json() : {}),
        fetch('/api/services').then(r => r.ok ? r.json() : {}),
      ]);
      setPresets(presetsRes);
      setConfigured(configRes?.integrations || {});

      // Build flat list of containers with UIDs for the target dropdown
      const containers = [];
      for (const [nodeKey, node] of Object.entries(servicesRes.nodes || {})) {
        for (const svc of (node.services || [])) {
          containers.push({
            uid: svc.uid || `${nodeKey}:${svc.container}`,
            name: svc.name || svc.container,
            node: node.display_name || nodeKey,
          });
        }
      }
      containers.sort((a, b) => a.name.localeCompare(b.name));
      setAllContainers(containers);
    } catch {
      // Silently fail
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Filtered presets for gallery ──
  const filteredPresets = presets.filter(p => {
    if (category !== 'all' && PRESET_CATEGORIES[p.type] !== category) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.name.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.type.toLowerCase().includes(q);
    }
    return true;
  });

  // Count presets per category (for badges)
  const categoryCounts = {};
  for (const p of presets) {
    const cat = PRESET_CATEGORIES[p.type] || 'home';
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  }

  // ── Navigation helpers ──
  const openGallery = () => {
    setView('gallery');
    setSearch('');
    setCategory('all');
  };

  const openConfig = (preset, existingConfig = null, existingKey = null) => {
    setSelectedPreset(preset);
    setEditingType(existingKey || (existingConfig ? (preset?.type || null) : null));
    setFormUrl(existingConfig?.url || '');
    setFormUsername(existingConfig?.username || '');
    setFormPassword(''); // Never prefill passwords
    setFormToken(''); // Never prefill tokens
    setFormEnabled(existingConfig?.enabled !== false);
    setFormInstance(existingConfig?.instance || '');
    setFormTarget(existingConfig?.target || '');
    setTestStatus(null);
    setSaveStatus(null);
    setView('config');
  };

  const openCustomBuilder = () => {
    openConfig(null);
  };

  const goHome = () => {
    setView('home');
    setSelectedPreset(null);
    setEditingType(null);
    fetchData(); // Refresh configured list
  };

  // ── Test connection ──
  const handleTest = async () => {
    setTestStatus('testing');
    try {
      const body = {
        type: selectedPreset?.type || '_custom',
        url: formUrl,
      };
      if (formUsername) body.username = formUsername;
      if (formPassword) body.password = formPassword;
      if (formToken) body.token = formToken;

      const res = await fetch('/api/integrations/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setTestStatus(data);
    } catch (err) {
      setTestStatus({ ok: false, error: err.message });
    }
  };

  // ── Save integration ──
  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      const body = {
        type: selectedPreset?.type || editingType || '_custom',
        url: formUrl,
        enabled: formEnabled,
      };
      if (formInstance.trim()) body.instance = formInstance.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (formTarget) body.target = formTarget;
      if (formUsername) body.username = formUsername;
      if (formPassword) body.password = formPassword;
      if (formToken) body.token = formToken;

      const res = await fetch('/api/integrations/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setSaveStatus('saved');
        setTimeout(goHome, 800);
      } else {
        setSaveStatus({ error: data.error || 'Save failed' });
      }
    } catch (err) {
      setSaveStatus({ error: err.message });
    }
  };

  // ── Delete integration ──
  const handleDelete = async (type) => {
    if (!confirm(`Remove ${type} integration? This will delete stored credentials.`)) return;
    try {
      await fetch(`/api/integrations/${type}`, { method: 'DELETE' });
      fetchData();
    } catch {
      // Silently fail
    }
  };

  // ── Toggle enabled/disabled ──
  const handleToggle = async (type, currentConfig) => {
    try {
      const body = {
        type,
        url: currentConfig.url,
        enabled: currentConfig.enabled === false, // flip it
      };
      if (currentConfig.username) body.username = currentConfig.username;
      // Don't send password/token — they're already stored as $secret refs
      await fetch('/api/integrations/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      fetchData();
    } catch {
      // Silently fail
    }
  };

  // ══════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 32, color: 'var(--text-muted)' }}>
        <div className="skeleton" style={{ width: 20, height: 20, borderRadius: '50%' }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>Loading integrations...</span>
      </div>
    );
  }

  // ── HOME VIEW: Configured integrations list ──
  if (view === 'home') {
    const configEntries = Object.entries(configured);

    return (
      <div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
          Connect app APIs to show live stats on service cards. Credentials are encrypted with AES-256-GCM.
        </p>

        {/* Add buttons */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <button className="settings-btn-sm" onClick={openGallery}
            style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }}>
            + Add from Presets
          </button>
          <button className="settings-btn-sm" onClick={openCustomBuilder}>
            + Custom Integration
          </button>
        </div>

        {/* Configured integrations */}
        {configEntries.length === 0 ? (
          <div style={{
            padding: 40, textAlign: 'center', color: 'var(--text-muted)',
            background: 'var(--bg-card-inner)', borderRadius: 16,
            border: '1px dashed var(--border-color)',
          }}>
            <span style={{ fontSize: 36, display: 'block', marginBottom: 12 }}>🔌</span>
            <p style={{ fontSize: 14, marginBottom: 6 }}>No integrations configured yet</p>
            <p style={{ fontSize: 12 }}>Add a preset or create a custom integration to get started.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {configEntries.map(([storageKey, cfg]) => {
              // Find the preset by checking the preset field or the base type
              const presetType = cfg.preset || (storageKey.includes('_') ? storageKey.split('_')[0] : storageKey);
              const preset = presets.find(p => p.type === presetType);
              const isEnabled = cfg.enabled !== false;
              const displayName = cfg.instance
                ? `${preset?.name || presetType} (${cfg.instance})`
                : preset?.name || storageKey;

              return (
                <div key={storageKey} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px', borderRadius: 12,
                  background: 'var(--bg-card-inner)',
                  border: `1px solid ${isEnabled ? 'var(--border-color)' : 'var(--border-color)'}`,
                  opacity: isEnabled ? 1 : 0.55,
                  transition: 'all 0.2s',
                }}>
                  {/* Icon */}
                  <img
                    src={`https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/${preset?.icon || presetType}.svg`}
                    alt=""
                    style={{ width: 28, height: 28, borderRadius: 6 }}
                    onError={e => { e.target.style.display = 'none'; }}
                  />

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500 }}>
                      {displayName}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cfg.url}
                      {cfg.target && <span style={{ marginLeft: 8, color: 'var(--accent)' }}>→ {cfg.target}</span>}
                    </div>
                  </div>

                  {/* Status badge */}
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 8px',
                    borderRadius: 4, flexShrink: 0,
                    background: isEnabled ? 'var(--green-bg)' : 'var(--amber-bg)',
                    color: isEnabled ? 'var(--green)' : 'var(--amber)',
                    border: `1px solid ${isEnabled ? 'var(--green-border)' : 'var(--amber-border)'}`,
                  }}>
                    {isEnabled ? 'active' : 'disabled'}
                  </span>

                  {/* Toggle */}
                  <button
                    className="settings-btn-sm"
                    onClick={() => handleToggle(storageKey, cfg)}
                    style={{ padding: '4px 10px', fontSize: 11, color: isEnabled ? 'var(--amber)' : 'var(--green)' }}
                  >
                    {isEnabled ? 'Disable' : 'Enable'}
                  </button>

                  {/* Edit */}
                  <button
                    className="settings-btn-sm"
                    onClick={() => openConfig(preset || null, cfg, storageKey)}
                    style={{ padding: '4px 10px', fontSize: 11 }}
                  >
                    Edit
                  </button>

                  {/* Delete */}
                  <button
                    className="settings-btn-sm"
                    onClick={() => handleDelete(storageKey)}
                    style={{ padding: '4px 10px', fontSize: 11, color: 'var(--red)', borderColor: 'var(--red-border)' }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── GALLERY VIEW: Browse presets ──
  if (view === 'gallery') {
    return (
      <div>
        {/* Back button */}
        <button
          className="settings-btn-sm"
          onClick={goHome}
          style={{ marginBottom: 16, fontSize: 12 }}
        >
          ← Back to Integrations
        </button>

        {/* Search */}
        <input
          className="settings-input"
          placeholder="Search presets..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ marginBottom: 16 }}
        />

        {/* Category pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
          {CATEGORIES.map(cat => {
            const count = cat.id === 'all' ? presets.length : (categoryCounts[cat.id] || 0);
            const isActive = category === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '5px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                  fontFamily: 'var(--font-body)', fontWeight: 500,
                  border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border-color)'}`,
                  background: isActive ? 'var(--accent-glow)' : 'var(--bg-card-inner)',
                  color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: 13 }}>{cat.icon}</span>
                {cat.label}
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10,
                  opacity: 0.7, marginLeft: 2,
                }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Preset grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 10,
        }}>
          {filteredPresets.map(p => {
            const isConfigured = !!configured[p.type];
            return (
              <button
                key={p.type}
                onClick={() => openConfig(p, configured[p.type] || null)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  gap: 8, padding: '16px 12px', borderRadius: 12, cursor: 'pointer',
                  border: `1px solid ${isConfigured ? 'var(--green-border)' : 'var(--border-color)'}`,
                  background: isConfigured ? 'rgba(34,197,94,0.04)' : 'var(--bg-card-inner)',
                  color: 'var(--text-primary)',
                  textAlign: 'center',
                  transition: 'all 0.15s',
                  position: 'relative',
                }}
              >
                {isConfigured && (
                  <span style={{
                    position: 'absolute', top: 6, right: 8,
                    fontFamily: 'var(--font-mono)', fontSize: 9, padding: '1px 6px',
                    borderRadius: 4, background: 'var(--green-bg)', color: 'var(--green)',
                    border: '1px solid var(--green-border)',
                  }}>
                    configured
                  </span>
                )}
                <img
                  src={`https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/${p.icon}.svg`}
                  alt=""
                  style={{ width: 36, height: 36, borderRadius: 8 }}
                  onError={e => { e.target.style.display = 'none'; }}
                />
                <div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600 }}>
                    {p.name}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                    {p.description}
                  </div>
                </div>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9, padding: '2px 8px',
                  borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-muted)',
                  border: '1px solid var(--border-color)',
                }}>
                  {AUTH_LABELS[p.auth]?.split(' ')[0] || p.auth}
                </span>
              </button>
            );
          })}
        </div>

        {filteredPresets.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No presets match your search.
          </div>
        )}
      </div>
    );
  }

  // ── CONFIG VIEW: Configure an integration ──
  if (view === 'config') {
    const isPreset = !!selectedPreset;
    const authType = selectedPreset?.auth || 'bearer';
    const neededFields = AUTH_FIELDS[authType] || [];
    const presetName = selectedPreset?.name || 'Custom Integration';
    const isEditing = !!editingType;

    return (
      <div>
        {/* Back button */}
        <button
          className="settings-btn-sm"
          onClick={() => isEditing ? goHome() : setView('gallery')}
          style={{ marginBottom: 16, fontSize: 12 }}
        >
          ← {isEditing ? 'Back to Integrations' : 'Back to Gallery'}
        </button>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
          {isPreset && (
            <img
              src={`https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/${selectedPreset.icon}.svg`}
              alt=""
              style={{ width: 40, height: 40, borderRadius: 10 }}
              onError={e => { e.target.style.display = 'none'; }}
            />
          )}
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>
              {isEditing ? `Edit ${presetName}` : `Configure ${presetName}`}
            </div>
            {isPreset && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {selectedPreset.description} · Auth: {AUTH_LABELS[authType]}
              </div>
            )}
          </div>
        </div>

        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* URL */}
          <FieldGroup label="Base URL" hint="Protocol is auto-added if missing (e.g. adguard.local:3000 → http://adguard.local:3000)">
            <input
              className="settings-input"
              value={formUrl}
              onChange={e => setFormUrl(e.target.value)}
              placeholder={isPreset ? `e.g. http://your-server:port` : 'https://service.example.com'}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </FieldGroup>

          {/* Instance Name — for multiple instances of the same app */}
          {isPreset && (
            <FieldGroup label="Instance Name" hint="Optional. Use when running multiple instances (e.g. primary, secondary). Leave blank for single instances.">
              <input
                className="settings-input"
                value={formInstance}
                onChange={e => setFormInstance(e.target.value)}
                placeholder="e.g. primary"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </FieldGroup>
          )}

          {/* Target Container — scope stats to a specific container */}
          <FieldGroup label="Target Container" hint="Optional. When set, stats only show on this specific container. When blank, stats match any container with a similar name.">
            <select
              className="settings-input"
              value={formTarget}
              onChange={e => setFormTarget(e.target.value)}
              style={{ fontFamily: 'var(--font-mono)', cursor: 'pointer' }}
            >
              <option value="">Auto-match (by name)</option>
              {allContainers.map(c => (
                <option key={c.uid} value={c.uid}>{c.name} — {c.node}</option>
              ))}
            </select>
          </FieldGroup>

          {/* Username (if needed) */}
          {neededFields.includes('username') && (
            <FieldGroup label="Username">
              <input
                className="settings-input"
                value={formUsername}
                onChange={e => setFormUsername(e.target.value)}
                placeholder="admin"
                autoComplete="off"
              />
            </FieldGroup>
          )}

          {/* Password (if needed) */}
          {neededFields.includes('password') && (
            <FieldGroup label="Password" hint={isEditing ? 'Leave blank to keep existing' : undefined}>
              <input
                className="settings-input"
                type="password"
                value={formPassword}
                onChange={e => setFormPassword(e.target.value)}
                placeholder={isEditing ? '••••••••' : 'Enter password'}
                autoComplete="new-password"
              />
            </FieldGroup>
          )}

          {/* Token (if needed) */}
          {neededFields.includes('token') && (
            <FieldGroup
              label={authType === 'query' ? 'API Key' : authType === 'header' ? `API Key (${selectedPreset?.authHeader || 'X-API-Key'})` : 'API Token'}
              hint={isEditing ? 'Leave blank to keep existing' : undefined}
            >
              <input
                className="settings-input"
                type="password"
                value={formToken}
                onChange={e => setFormToken(e.target.value)}
                placeholder={isEditing ? '••••••••' : 'Enter API key or token'}
                autoComplete="new-password"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </FieldGroup>
          )}

          {/* No auth needed message */}
          {authType === 'none' && (
            <div style={{
              padding: '10px 14px', borderRadius: 10,
              background: 'var(--green-bg)', border: '1px solid var(--green-border)',
              fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--green)',
            }}>
              ✓ This integration requires no authentication — just provide the URL.
            </div>
          )}

          {/* Fields preview */}
          {isPreset && selectedPreset.fields?.length > 0 && (
            <FieldGroup label="Data Fields (from preset)">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {selectedPreset.fields.map(f => (
                  <span key={f.key} style={{
                    fontFamily: 'var(--font-mono)', fontSize: 11, padding: '3px 10px',
                    borderRadius: 6, background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)', color: 'var(--text-secondary)',
                  }}>
                    {f.label}
                  </span>
                ))}
              </div>
            </FieldGroup>
          )}

          {/* Enabled toggle */}
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={formEnabled}
              onChange={e => setFormEnabled(e.target.checked)}
            />
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 14 }}>
              Enabled — fetch data on dashboard refresh
            </span>
          </label>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Test */}
            <button
              className="settings-btn-sm"
              onClick={handleTest}
              disabled={!formUrl || testStatus === 'testing'}
              style={{
                padding: '8px 20px',
                opacity: !formUrl ? 0.5 : 1,
                cursor: !formUrl ? 'not-allowed' : 'pointer',
              }}
            >
              {testStatus === 'testing' ? 'Testing...' : '🔌 Test Connection'}
            </button>

            {/* Save */}
            <button
              className="settings-btn-sm"
              onClick={handleSave}
              disabled={!formUrl || saveStatus === 'saving'}
              style={{
                padding: '8px 20px',
                background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)',
                opacity: !formUrl ? 0.5 : 1,
                cursor: !formUrl ? 'not-allowed' : 'pointer',
              }}
            >
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? '✓ Saved!' : '💾 Save Integration'}
            </button>

            {/* Delete (only when editing) */}
            {isEditing && (
              <button
                className="settings-btn-sm"
                onClick={() => { handleDelete(editingType); goHome(); }}
                style={{ padding: '8px 20px', color: 'var(--red)', borderColor: 'var(--red-border)', marginLeft: 'auto' }}
              >
                🗑 Delete
              </button>
            )}
          </div>

          {/* Test result */}
          {testStatus && testStatus !== 'testing' && (
            <div style={{
              padding: '10px 14px', borderRadius: 10,
              background: testStatus.ok ? 'var(--green-bg)' : 'var(--red-bg)',
              border: `1px solid ${testStatus.ok ? 'var(--green-border)' : 'var(--red-border)'}`,
              fontFamily: 'var(--font-mono)', fontSize: 12,
              color: testStatus.ok ? 'var(--green)' : 'var(--red)',
            }}>
              {testStatus.ok
                ? `✓ Connection successful (HTTP ${testStatus.status})`
                : `✕ Connection failed: ${testStatus.error}`
              }
            </div>
          )}

          {/* Save error */}
          {saveStatus && typeof saveStatus === 'object' && saveStatus.error && (
            <div style={{
              padding: '10px 14px', borderRadius: 10,
              background: 'var(--red-bg)', border: '1px solid var(--red-border)',
              fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--red)',
            }}>
              Save error: {saveStatus.error}
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}

function FieldGroup({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: 0.5 }}>
        {label}
      </span>
      {children}
      {hint && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', opacity: 0.7 }}>
          {hint}
        </span>
      )}
    </div>
  );
}
