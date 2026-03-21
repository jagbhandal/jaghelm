import React, { useState, useRef } from 'react';
import { HexColorPicker } from 'react-colorful';
import { uploadFile, SEARCH_ENGINES } from '../hooks/useData';

const THEMES = [
  { id: 'dark', name: 'Deep Navy', preview: '#0f1123' },
  { id: 'dracula', name: 'Dracula', preview: '#282a36' },
  { id: 'light', name: 'Light', preview: '#eef0f8' },
];

export default function SettingsPanel({ config, setConfig, theme, setTheme, onClose }) {
  const [tab, setTab] = useState('appearance');
  const [colorTarget, setColorTarget] = useState(null);
  const [colorValue, setColorValue] = useState('#6366f1');
  const logoRef = useRef();
  const bgRef = useRef();

  const update = (path, value) => {
    setConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const keys = path.split('.');
      let obj = next;
      for (let i = 0; i < keys.length - 1; i++) { if (!obj[keys[i]]) obj[keys[i]] = {}; obj = obj[keys[i]]; }
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  };

  const handleUpload = async (file, type) => {
    try { const r = await uploadFile(file, type); update(type === 'logo' ? 'logoUrl' : 'bgImage', r.url); }
    catch (e) { alert('Upload failed: ' + e.message); }
  };

  const openColor = (t, c) => { setColorTarget(t); setColorValue(c || '#6366f1'); };
  const applyColor = () => { if (colorTarget) update(colorTarget, colorValue); setColorTarget(null); };
  const addTab = () => update('tabs', [...(config.tabs || []), { id: `tab-${Date.now()}`, label: 'New Tab', type: 'iframe', url: 'https://' }]);
  const removeTab = (i) => { const t = [...(config.tabs || [])]; t.splice(i, 1); update('tabs', t); };
  const updateTab = (i, f, v) => { const t = JSON.parse(JSON.stringify(config.tabs || [])); t[i][f] = v; update('tabs', t); };
  const exportCfg = () => { const b = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'jaghelm-config.json'; a.click(); };
  const importCfg = (e) => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = (ev) => { try { setConfig(JSON.parse(ev.target.result)); } catch { alert('Invalid JSON'); } }; r.readAsText(f); };

  const tabs = [{ id: 'appearance', label: 'Theme' }, { id: 'layout', label: 'Layout' }, { id: 'sections', label: 'Sections' }, { id: 'tabs', label: 'Tabs' }, { id: 'widgets', label: 'Widgets' }, { id: 'links', label: 'Links' }];

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20 }}>Settings</span>
          <button className="icon-btn" onClick={onClose} style={{ width: 34, height: 34, fontSize: 15 }}>✕</button>
        </div>
        <div className="settings-tabs">
          {tabs.map(t => <button key={t.id} className={`settings-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
        </div>
        <div className="settings-content">
          {colorTarget && (
            <div style={{ marginBottom: 20, padding: 16, background: 'var(--bg-card-inner)', borderRadius: 14, border: '1px solid var(--border-color)' }}>
              <HexColorPicker color={colorValue} onChange={setColorValue} style={{ width: '100%', height: 150 }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input className="settings-input" value={colorValue} onChange={e => setColorValue(e.target.value)} style={{ flex: 1 }} />
                <button className="settings-btn" onClick={applyColor} style={{ flex: 0, padding: '10px 20px', background: colorValue, color: '#fff', border: 'none' }}>Apply</button>
                <button className="settings-btn" onClick={() => setColorTarget(null)} style={{ flex: 0, padding: '10px 14px' }}>Cancel</button>
              </div>
            </div>
          )}

          {tab === 'appearance' && (<>
            <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginBottom: 12 }}>Theme</h3>
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              {THEMES.map(t => (
                <button key={t.id} onClick={() => setTheme(t.id)} style={{
                  flex: 1, padding: '14px 12px', borderRadius: 12, cursor: 'pointer', textAlign: 'center',
                  border: theme === t.id ? '2px solid var(--accent)' : '1px solid var(--border-color)',
                  background: theme === t.id ? 'var(--accent-glow)' : 'var(--bg-card-inner)', color: 'var(--text-primary)',
                  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500,
                }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: t.preview, margin: '0 auto 8px', border: '1px solid rgba(255,255,255,0.1)' }} />
                  {t.name}
                </button>
              ))}
            </div>

            <Fld label="Logo">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {config.logoUrl && <img src={config.logoUrl} style={{ height: 34, borderRadius: 8 }} alt="" />}
                <button className="settings-btn" onClick={() => logoRef.current?.click()} style={{ padding: '8px 16px' }}>Upload</button>
                {config.logoUrl && <button className="settings-btn" onClick={() => update('logoUrl', '')} style={{ padding: '8px 16px' }}>Remove</button>}
                <input ref={logoRef} type="file" accept="image/*" hidden onChange={e => e.target.files[0] && handleUpload(e.target.files[0], 'logo')} />
              </div>
            </Fld>
            <Fld label="Background Image">
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="settings-btn" onClick={() => bgRef.current?.click()} style={{ padding: '8px 16px' }}>Upload</button>
                {config.bgImage && <button className="settings-btn" onClick={() => update('bgImage', '')} style={{ padding: '8px 16px' }}>Remove</button>}
                <input ref={bgRef} type="file" accept="image/*" hidden onChange={e => e.target.files[0] && handleUpload(e.target.files[0], 'bg')} />
              </div>
            </Fld>
            <Fld label={`Background Opacity: ${config.bgOpacity}`}><input type="range" min="0" max="1" step="0.05" value={config.bgOpacity ?? 0.3} onChange={e => update('bgOpacity', parseFloat(e.target.value))} className="settings-range" /></Fld>
            <Fld label={`Overlay Opacity: ${config.overlayOpacity}`}><input type="range" min="0" max="1" step="0.02" value={config.overlayOpacity ?? 0.75} onChange={e => update('overlayOpacity', parseFloat(e.target.value))} className="settings-range" /></Fld>
            <Fld label="Accent Color">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: config.accentColor || '#6366f1', cursor: 'pointer', border: '2px solid var(--border-glow)' }} onClick={() => openColor('accentColor', config.accentColor)} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)' }}>{config.accentColor}</span>
              </div>
            </Fld>
            <Fld label="Dashboard Title"><input className="settings-input" value={config.title || ''} onChange={e => update('title', e.target.value)} /></Fld>
            <Chk label="Show dot grid" checked={config.showDots !== false} onChange={v => update('showDots', v)} />
          </>)}

          {tab === 'layout' && (<>
            <Fld label={`Grid Columns: ${config.gridColumns || 12}`}><input type="range" min="4" max="16" step="1" value={config.gridColumns || 12} onChange={e => update('gridColumns', parseInt(e.target.value))} className="settings-range" /></Fld>
            <Fld label={`Refresh Interval: ${config.refreshInterval || 30}s`}><input type="range" min="10" max="120" step="5" value={config.refreshInterval || 30} onChange={e => update('refreshInterval', parseInt(e.target.value))} className="settings-range" /></Fld>
            <button className="settings-btn" onClick={() => { update('gridLayout', null); location.reload(); }} style={{ marginTop: 12, borderColor: 'var(--red)', color: 'var(--red)' }}>Reset Grid Layout</button>
          </>)}

          {tab === 'sections' && (<>
            {Object.entries(config.sections || {}).map(([k, s]) => (
              <div key={k} style={{ marginBottom: 12, padding: '14px 16px', background: 'var(--bg-card-inner)', borderRadius: 12, border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <input type="checkbox" checked={s.visible !== false} onChange={e => update(`sections.${k}.visible`, e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--accent)' }} />
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, flex: 1 }}>{s.title || k}</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div title="Border color" style={{ width: 26, height: 26, borderRadius: 6, background: s.borderColor || '#6366f1', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)' }}
                      onClick={() => openColor(`sections.${k}.borderColor`, s.borderColor)} />
                    <div title="Background color" style={{ width: 26, height: 26, borderRadius: 6, background: s.bgColor || 'transparent', cursor: 'pointer', border: '1px dashed rgba(255,255,255,0.2)' }}
                      onClick={() => openColor(`sections.${k}.bgColor`, s.bgColor || '#1a1c3a')} />
                  </div>
                </div>
                <Fld label="Title"><input className="settings-input" value={s.title || ''} onChange={e => update(`sections.${k}.title`, e.target.value)} placeholder={k} /></Fld>
                <Fld label="Subtitle"><input className="settings-input" value={s.subtitle || ''} onChange={e => update(`sections.${k}.subtitle`, e.target.value)} placeholder="Optional subtitle" /></Fld>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                  <span>Opacity: {((s.bgOpacity ?? 0) * 100).toFixed(0)}%</span>
                  <input type="range" min="0" max="1" step="0.05" value={s.bgOpacity ?? 0}
                    onChange={e => update(`sections.${k}.bgOpacity`, parseFloat(e.target.value))}
                    style={{ flex: 1, accentColor: s.borderColor || 'var(--accent)' }} />
                </div>
              </div>
            ))}
          </>)}

          {tab === 'tabs' && (<>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>Add iframe tabs to embed services.</p>
            {(config.tabs || []).map((t, i) => (
              <div key={t.id} style={{ marginBottom: 12, padding: 16, background: 'var(--bg-card-inner)', borderRadius: 12, border: '1px solid var(--border-color)' }}>
                <Fld label="Tab Name"><input className="settings-input" value={t.label} onChange={e => updateTab(i, 'label', e.target.value)} /></Fld>
                <Fld label="URL"><input className="settings-input" value={t.url} onChange={e => updateTab(i, 'url', e.target.value)} /></Fld>
                <button className="settings-btn" onClick={() => removeTab(i)} style={{ color: 'var(--red)', borderColor: 'var(--red-border)' }}>Remove</button>
              </div>
            ))}
            <button className="settings-btn" onClick={addTab} style={{ marginTop: 8 }}>+ Add Tab</button>
          </>)}

          {tab === 'widgets' && (<>
            <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginBottom: 12 }}>Search</h3>
            <Chk label="Show search bar" checked={config.showSearch !== false} onChange={v => update('showSearch', v)} />
            <Fld label="Search Engine">
              <select className="settings-input" value={config.searchEngine || 'google'} onChange={e => update('searchEngine', e.target.value)}>
                {SEARCH_ENGINES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Fld>
            <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginBottom: 12, marginTop: 20 }}>Weather</h3>
            <Chk label="Show weather" checked={config.showWeather !== false} onChange={v => update('showWeather', v)} />
            <Fld label="Temperature Unit">
              <div style={{ display: 'flex', gap: 8 }}>
                {['F', 'C'].map(u => (
                  <button key={u} onClick={() => update('tempUnit', u)} style={{
                    flex: 1, padding: '10px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                    border: (config.tempUnit || 'F') === u ? '2px solid var(--accent)' : '1px solid var(--border-color)',
                    background: (config.tempUnit || 'F') === u ? 'var(--accent-glow)' : 'var(--bg-card-inner)',
                    color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600,
                  }}>°{u}</button>
                ))}
              </div>
            </Fld>
            <Fld label="City"><input className="settings-input" value={config.weatherCity || ''} onChange={e => update('weatherCity', e.target.value)} /></Fld>
            <Fld label="Latitude"><input className="settings-input" value={config.weatherLat || ''} onChange={e => update('weatherLat', e.target.value)} /></Fld>
            <Fld label="Longitude"><input className="settings-input" value={config.weatherLon || ''} onChange={e => update('weatherLon', e.target.value)} /></Fld>
            <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginBottom: 12, marginTop: 20 }}>Services</h3>
            <Fld label="Service Card Detail Level">
              <div style={{ display: 'flex', gap: 6 }}>
                {['minimal', 'stats', 'full'].map(lv => (
                  <button key={lv} onClick={() => update('serviceDetailLevel', lv)} style={{
                    flex: 1, padding: '10px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                    border: (config.serviceDetailLevel || 'minimal') === lv ? '2px solid var(--accent)' : '1px solid var(--border-color)',
                    background: (config.serviceDetailLevel || 'minimal') === lv ? 'var(--accent-glow)' : 'var(--bg-card-inner)',
                    color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500,
                    textTransform: 'capitalize',
                  }}>{lv}</button>
                ))}
              </div>
            </Fld>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -6 }}>Minimal: status + latency · Stats: + CPU/MEM · Full: + per-service API data</p>
            <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginBottom: 12, marginTop: 20 }}>Features</h3>
            <Chk label="Show checklist" checked={config.showTodos !== false} onChange={v => update('showTodos', v)} />
          </>)}

          {tab === 'links' && (<>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>Export config, edit links in JSON, then import.</p>
            {Object.entries(config.links || {}).map(([g, links]) => (
              <div key={g} style={{ marginBottom: 16 }}>
                <h4 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>{g}</h4>
                {links.map((l, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 5 }}>
                    <span>{l.icon}</span><span style={{ flex: 1 }}>{l.name}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{l.url.replace('https://', '')}</span>
                  </div>
                ))}
              </div>
            ))}
          </>)}
        </div>
        <div className="settings-footer">
          <button className="settings-btn" onClick={exportCfg}>Export</button>
          <label className="settings-btn" style={{ cursor: 'pointer' }}>Import<input type="file" accept=".json" onChange={importCfg} hidden /></label>
          <button className="settings-btn" onClick={() => { onClose(); window.location.reload(); }}
            style={{ background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 600 }}>Apply Changes</button>
        </div>
      </div>
    </div>
  );
}

function Fld({ label, children }) { return <div className="settings-field"><span className="settings-label">{label}</span>{children}</div>; }
function Chk({ label, checked, onChange }) {
  return <div className="settings-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
    <span className="settings-label" style={{ margin: 0 }}>{label}</span>
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--accent)' }} />
  </div>;
}
