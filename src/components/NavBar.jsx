import React, { useState, useEffect, useRef } from 'react';
import { getWeather, WEATHER_CODES, SEARCH_ENGINES } from '../hooks/useData';
import { useConfig } from '../context/ConfigContext.jsx';
import { THEMES } from './settings/themes.js';
import { safeUrl } from '../utils/safeUrl.js';

/**
 * matchLinks — find configured links whose name OR url contains the query.
 *
 * Single source of truth so the live dropdown and the Enter handler agree:
 * a url-only match shown in the dropdown is also the one Enter opens (it must
 * not fall through to a web search).
 *
 * @param {Record<string, Array<{name: string, url: string}>>|undefined} links
 * @param {string} query
 * @returns {Array<{name: string, url: string}>}
 */
function matchLinks(links, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  return Object.values(links || {})
    .flat()
    .filter(
      (l) =>
        (l.name || '').toLowerCase().includes(q) || (l.url || '').toLowerCase().includes(q)
    );
}

export default React.memo(function NavBar({
  tabs,
  activeTab,
  onTabChange,
  theme,
  setTheme,
  health,
  lastUpdated,
  onOpenSettings,
  onLogout,
  refreshKey,
}) {
  const { config } = useConfig();
  const [timeSince, setTimeSince] = useState('just now');
  const [clock, setClock] = useState('');
  const [weather, setWeather] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const searchRef = useRef(null);
  const menuRef = useRef(null);
  const menuBtnRef = useRef(null);
  const themeRef = useRef(null);
  const themeBtnRef = useRef(null);

  useEffect(() => {
    const u = () => {
      const d = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
      setTimeSince(d < 5 ? 'just now' : d < 60 ? `${d}s ago` : `${Math.floor(d / 60)}m ago`);
    };
    u();
    const id = setInterval(u, 1000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  useEffect(() => {
    const u = () =>
      setClock(
        new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) +
          ' · ' +
          new Date().toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          })
      );
    u();
    const id = setInterval(u, 10000);
    return () => clearInterval(id);
  }, []);

  // Fetch weather on mount, config change, and every refresh cycle (retries if first load failed)
  useEffect(() => {
    if (config?.showWeather !== false && config?.weatherLat && config?.weatherLon) {
      getWeather(config.weatherLat, config.weatherLon)
        .then(setWeather)
        .catch(() => {});
    }
  }, [config?.weatherLat, config?.weatherLon, config?.showWeather, refreshKey]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    const m = matchLinks(config?.links, searchQuery);
    setSearchResults(m);
    setShowResults(m.length > 0);
  }, [searchQuery, config?.links]);

  useEffect(() => {
    const h = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowResults(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Mobile nav menu: close on outside tap, and on Escape (returning focus to the
  // trigger so keyboard users aren't dropped at the top of the document).
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        menuBtnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Theme picker popover: close on outside tap and on Escape, returning focus to
  // the trigger so keyboard users aren't dropped at the top of the document.
  useEffect(() => {
    if (!themeOpen) return;
    const onPointer = (e) => {
      if (themeRef.current && !themeRef.current.contains(e.target)) setThemeOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setThemeOpen(false);
        themeBtnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [themeOpen]);

  const selectTheme = (id) => {
    setTheme(id);
    setThemeOpen(false);
    themeBtnRef.current?.focus();
  };

  const selectTab = (id) => {
    onTabChange(id);
    setMenuOpen(false);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    const match = matchLinks(config?.links, searchQuery)[0];
    const matchUrl = match && safeUrl(match.url);
    if (matchUrl) window.open(matchUrl, '_blank');
    else {
      const eng = SEARCH_ENGINES.find((s) => s.id === config?.searchEngine) || SEARCH_ENGINES[0];
      window.open(eng.url + encodeURIComponent(searchQuery), '_blank');
    }
    setSearchQuery('');
    setShowResults(false);
  };

  const hc = health === 'up' ? 'var(--green)' : health === 'down' ? 'var(--red)' : 'var(--amber)';
  const hl =
    health === 'up'
      ? 'All Systems Operational'
      : health === 'down'
        ? 'Service Disruption'
        : 'Degraded';
  const wc = weather?.current?.weather_code;
  const wInfo = WEATHER_CODES[wc] || { icon: '🌡', label: '' };
  const wTemp = weather?.current?.temperature_2m;

  return (
    <nav className="nav-bar">
      <div className="nav-brand">
        <div
          className="nav-health-dot"
          style={{ background: hc, boxShadow: `0 0 8px ${hc}` }}
          aria-hidden="true"
        />
        {config?.logoUrl ? (
          <img src={config.logoUrl} alt="" className="nav-logo-img" />
        ) : (
          <img src="/logo.svg" alt="" className="nav-logo-img" />
        )}
        <span className="nav-logo">{config?.title || 'JAG-NET'}</span>
        <span className="nav-health-label" role="status" aria-live="polite">
          {hl}
        </span>
      </div>
      <div className="nav-tabs" role="tablist" aria-label="Dashboard views">
        {tabs.map((t) => {
          const selected = activeTab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={selected}
              aria-current={selected ? 'page' : undefined}
              className={`nav-tab ${selected ? 'active' : ''}`}
              onClick={() => onTabChange(t.id)}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {/* Mobile-only tab switcher: .nav-tabs is hidden under 600px, so this
          menu is the only way to change tab on a phone. Hidden on desktop via CSS. */}
      <div className="nav-menu" ref={menuRef}>
        <button
          ref={menuBtnRef}
          type="button"
          className="icon-btn nav-menu-btn"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? 'nav-menu-dropdown' : undefined}
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          title="Menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          ☰
        </button>
        {menuOpen && (
          // Disclosure pattern (not role=menu): plain buttons Tab navigates;
          // Escape/outside-tap close and return focus. No arrow-key menu semantics.
          <div id="nav-menu-dropdown" className="nav-menu-dropdown" aria-label="Dashboard views">
            {tabs.map((t) => {
              const selected = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-current={selected ? 'page' : undefined}
                  className={`nav-menu-item ${selected ? 'active' : ''}`}
                  onClick={() => selectTab(t.id)}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {config?.showSearch !== false && (
        <div className="nav-search-wrap" ref={searchRef}>
          <form onSubmit={handleSearch}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowResults(true)}
              placeholder="Search services or web..."
              className="nav-search-input"
            />
          </form>
          {showResults && (
            <div className="nav-search-dropdown">
              {searchResults.map((r, i) => (
                <a
                  key={i}
                  href={safeUrl(r.url) || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="nav-search-result"
                  onClick={() => {
                    setSearchQuery('');
                    setShowResults(false);
                  }}
                >
                  <span>{r.icon}</span>
                  <span>{r.name}</span>
                  <span className="nav-search-result-url">{r.url.replace('https://', '')}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="nav-right">
        {config?.showWeather !== false && wTemp != null && (
          <div className="nav-weather">
            <span>{wInfo.icon}</span>
            <span className="nav-weather-temp">
              {(config?.tempUnit || 'F') === 'C'
                ? Math.round(((wTemp - 32) * 5) / 9)
                : Math.round(wTemp)}
              °{config?.tempUnit || 'F'}
            </span>
            <span className="nav-weather-city">{config.weatherCity || ''}</span>
          </div>
        )}
        <span className="nav-clock">{clock}</span>
        <span className="nav-updated">Updated {timeSince}</span>
        <button
          className="icon-btn"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
        >
          ⚙️
        </button>
        {/* Theme picker: 🎨 opens a popover of swatches so a specific theme is one
            click away (the old button blind-cycled all 10). Disclosure pattern —
            plain buttons, Escape/outside-tap close and return focus to the trigger. */}
        <div className="nav-theme" ref={themeRef}>
          <button
            ref={themeBtnRef}
            type="button"
            className="icon-btn"
            aria-haspopup="true"
            aria-expanded={themeOpen}
            aria-controls={themeOpen ? 'nav-theme-popover' : undefined}
            aria-label={
              themeOpen
                ? 'Close theme picker'
                : `Theme picker, current: ${THEMES.find((t) => t.id === theme)?.name || theme}`
            }
            title="Theme"
            onClick={() => setThemeOpen((o) => !o)}
          >
            🎨
          </button>
          {themeOpen && (
            <div
              id="nav-theme-popover"
              className="nav-theme-popover"
              role="group"
              aria-label="Choose theme"
            >
              <div className="nav-theme-grid">
                {THEMES.map((t) => {
                  const selected = theme === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`nav-theme-swatch ${selected ? 'active' : ''}`}
                      aria-current={selected ? 'true' : undefined}
                      title={t.name}
                      onClick={() => selectTheme(t.id)}
                    >
                      <span
                        className="nav-theme-chip"
                        style={{ background: t.preview, borderColor: t.accent }}
                        aria-hidden="true"
                      >
                        <span className="nav-theme-chip-bar" style={{ background: t.accent }} />
                      </span>
                      <span className="nav-theme-name">{t.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        {onLogout && (
          <button className="icon-btn" onClick={onLogout} aria-label="Log out" title="Log out">
            🚪
          </button>
        )}
      </div>
    </nav>
  );
});
