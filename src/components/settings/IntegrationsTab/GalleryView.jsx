import React from 'react';
import { cachedIconUrl } from '../../../hooks/useData';
import { CATEGORIES, PRESET_CATEGORIES, AUTH_LABELS } from './constants.js';

/**
 * GalleryView — browseable preset gallery (search + category pills + grid).
 *
 * Filtering and per-category counts are derived from props on each render. The
 * search/category state is owned by the orchestrator so that round-tripping
 * gallery → config → gallery preserves the user's filter state (matches
 * pre-refactor behavior).
 *
 * Props:
 *   presets        — array of all available presets
 *   configured     — { storageKey: configObject } map (drives "configured" badge)
 *   search         — current search string
 *   setSearch      — search setter
 *   category       — current category filter id
 *   setCategory    — category setter
 *   onPresetClick  — (preset, existingConfig) => void
 *   onBack         — () => void
 */
export default function GalleryView({
  presets,
  configured,
  search,
  setSearch,
  category,
  setCategory,
  onPresetClick,
  onBack,
}) {
  // Filter presets by category + search
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

  return (
    <div>
      {/* Back button */}
      <button
        className="settings-btn-sm"
        onClick={onBack}
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
      <div className="settings-preset-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        {filteredPresets.map(p => {
          const isConfigured = !!configured[p.type];
          return (
            <button
              key={p.type}
              onClick={() => onPresetClick(p, configured[p.type] || null)}
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
                src={cachedIconUrl(`https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/${p.icon}.svg`)}
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
        <div className="settings-loading" style={{ justifyContent: 'center', fontSize: 13 }}>
          No presets match your search.
        </div>
      )}
    </div>
  );
}
