import React, { useState, useEffect, useRef } from 'react';
import { getWeather, WEATHER_CODES, SEARCH_ENGINES } from '../hooks/useData';

export default function NavBar({ tabs, activeTab, onTabChange, theme, setTheme, onToggleTheme, health, lastUpdated, config, onOpenSettings, refreshKey }) {
  const [timeSince, setTimeSince] = useState('just now');
  const [clock, setClock] = useState('');
  const [weather, setWeather] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => {
    const u = () => { const d = Math.floor((Date.now() - lastUpdated.getTime()) / 1000); setTimeSince(d < 5 ? 'just now' : d < 60 ? `${d}s ago` : `${Math.floor(d/60)}m ago`); };
    u(); const id = setInterval(u, 1000); return () => clearInterval(id);
  }, [lastUpdated]);

  useEffect(() => {
    const u = () => setClock(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) + ' · ' + new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
    u(); const id = setInterval(u, 10000); return () => clearInterval(id);
  }, []);

  // Fetch weather on mount, config change, and every refresh cycle (retries if first load failed)
  useEffect(() => {
    if (config?.showWeather !== false && config?.weatherLat && config?.weatherLon) {
      getWeather(config.weatherLat, config.weatherLon).then(setWeather).catch(() => {});
    }
  }, [config?.weatherLat, config?.weatherLon, config?.showWeather, refreshKey]);

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); setShowResults(false); return; }
    const q = searchQuery.toLowerCase();
    const all = Object.values(config?.links || {}).flat();
    const m = all.filter(l => l.name.toLowerCase().includes(q) || l.url.toLowerCase().includes(q));
    setSearchResults(m); setShowResults(m.length > 0);
  }, [searchQuery, config?.links]);

  useEffect(() => {
    const h = (e) => { if (searchRef.current && !searchRef.current.contains(e.target)) setShowResults(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);

  const handleSearch = (e) => {
    e.preventDefault(); if (!searchQuery.trim()) return;
    const all = Object.values(config?.links || {}).flat();
    const match = all.find(l => l.name.toLowerCase().includes(searchQuery.toLowerCase()));
    if (match) window.open(match.url, '_blank');
    else { const eng = SEARCH_ENGINES.find(s => s.id === config?.searchEngine) || SEARCH_ENGINES[0]; window.open(eng.url + encodeURIComponent(searchQuery), '_blank'); }
    setSearchQuery(''); setShowResults(false);
  };

  const hc = health === 'up' ? 'var(--green)' : health === 'down' ? 'var(--red)' : 'var(--amber)';
  const hl = health === 'up' ? 'All Systems Operational' : health === 'down' ? 'Service Disruption' : 'Degraded';
  const wc = weather?.current?.weather_code;
  const wInfo = WEATHER_CODES[wc] || { icon: '🌡', label: '' };
  const wTemp = weather?.current?.temperature_2m;

  return (
    <nav className="nav-bar">
      <div className="nav-brand">
        <div className="nav-health-dot" style={{ background: hc, boxShadow: `0 0 8px ${hc}` }} />
        {config?.logoUrl
          ? <img src={config.logoUrl} alt="" className="nav-logo-img" />
          : <img src="/logo.svg" alt="" className="nav-logo-img" />
        }
        <span className="nav-logo">{config?.title || 'JAG-NET'}</span>
        <span className="nav-health-label">{hl}</span>
      </div>
      <div className="nav-tabs">
        {tabs.map(t => <button key={t.id} className={`nav-tab ${activeTab === t.id ? 'active' : ''}`} onClick={() => onTabChange(t.id)}>{t.label}</button>)}
      </div>
      {config?.showSearch !== false && (
        <div className="nav-search-wrap" ref={searchRef}>
          <form onSubmit={handleSearch}><input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onFocus={() => searchResults.length > 0 && setShowResults(true)} placeholder="Search services or web..." className="nav-search-input" /></form>
          {showResults && <div className="nav-search-dropdown">{searchResults.map((r, i) => (
            <a key={i} href={r.url} target="_blank" rel="noopener noreferrer" className="nav-search-result" onClick={() => { setSearchQuery(''); setShowResults(false); }}>
              <span>{r.icon}</span><span>{r.name}</span><span className="nav-search-result-url">{r.url.replace('https://','')}</span>
            </a>
          ))}</div>}
        </div>
      )}
      <div className="nav-right">
        {config?.showWeather !== false && wTemp != null && (
          <div className="nav-weather">
            <span>{wInfo.icon}</span>
            <span className="nav-weather-temp">
              {(config?.tempUnit || 'F') === 'C' ? Math.round((wTemp - 32) * 5 / 9) : Math.round(wTemp)}°{config?.tempUnit || 'F'}
            </span>
            <span className="nav-weather-city">{config.weatherCity || ''}</span>
          </div>
        )}
        <span className="nav-clock">{clock}</span>
        <span className="nav-updated">Updated {timeSince}</span>
        <button className="icon-btn" onClick={onOpenSettings}>⚙️</button>
        <button className="icon-btn" onClick={onToggleTheme}>{theme === 'dark' ? '☀️' : theme === 'light' ? '🧛' : '🌙'}</button>
      </div>
    </nav>
  );
}
