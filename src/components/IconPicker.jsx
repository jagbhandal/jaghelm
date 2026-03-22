import React, { useState, useEffect, useRef, useCallback } from 'react';

/**
 * IconPicker — Reusable icon search & selection component
 * 
 * Searches the JagHelm icon index (homarr-labs/dashboard-icons, selfhst/icons, simple-icons)
 * via GET /api/icons?q=search&limit=60
 * 
 * Props:
 *   value     — current icon value (URL string or slug)
 *   onChange  — callback(iconUrl) when an icon is selected
 *   onClear   — optional callback when cleared
 *   label     — optional label text
 *   compact   — if true, shows as a small button that opens a dropdown
 */
export default function IconPicker({ value, onChange, onClear, label, compact = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Fetch icons with debounced search
  const fetchIcons = useCallback(async (q) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      params.set('limit', '60');
      const res = await fetch(`/api/icons?${params}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
        setTotalCount(data.count || 0);
      }
    } catch {
      // silently fail
    }
    setLoading(false);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchIcons(query), 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, open, fetchIcons]);

  // Load initial icons when opening
  useEffect(() => {
    if (open) fetchIcons(query);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (icon) => {
    onChange(icon.url);
    setOpen(false);
    setQuery('');
  };

  const handleClear = () => {
    if (onClear) onClear();
    else onChange('');
  };

  // Try to extract current icon display
  const currentIconUrl = value || '';
  const hasIcon = currentIconUrl && !isEmoji(currentIconUrl);
  const isEmojiVal = currentIconUrl && isEmoji(currentIconUrl);

  // ── Compact mode: small button with icon preview ──
  if (compact) {
    return (
      <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          style={{
            width: 40, height: 40, borderRadius: 10,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-card-inner)',
            cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            transition: 'border-color 0.15s',
            ...(open ? { borderColor: 'var(--accent)' } : {}),
          }}
        >
          {hasIcon ? (
            <img src={currentIconUrl} alt="" style={{ width: 24, height: 24, borderRadius: 4 }} />
          ) : isEmojiVal ? (
            <span style={{ fontSize: 20 }}>{currentIconUrl}</span>
          ) : (
            <span style={{ fontSize: 18, opacity: 0.4 }}>🔍</span>
          )}
        </button>

        {open && (
          <PickerDropdown
            query={query}
            setQuery={setQuery}
            results={results}
            totalCount={totalCount}
            loading={loading}
            onSelect={handleSelect}
            onClear={value ? handleClear : null}
            style={{ position: 'absolute', top: '100%', left: 0, zIndex: 1000, marginTop: 4 }}
          />
        )}
      </div>
    );
  }

  // ── Full mode: inline field with label ──
  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {label && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>
          {label}
        </span>
      )}

      {/* Current icon + trigger */}
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px', borderRadius: 10, cursor: 'pointer',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border-color)'}`,
          background: 'var(--bg-card-inner)',
          transition: 'border-color 0.15s',
        }}
      >
        {hasIcon ? (
          <img src={currentIconUrl} alt="" style={{ width: 24, height: 24, borderRadius: 4, flexShrink: 0 }} />
        ) : isEmojiVal ? (
          <span style={{ fontSize: 20, flexShrink: 0 }}>{currentIconUrl}</span>
        ) : (
          <span style={{ fontSize: 18, opacity: 0.4, flexShrink: 0 }}>🔍</span>
        )}
        <span style={{
          fontFamily: 'var(--font-body)', fontSize: 13, color: value ? 'var(--text-primary)' : 'var(--text-muted)',
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {hasIcon ? extractSlug(currentIconUrl) : isEmojiVal ? 'Emoji icon' : 'Choose an icon...'}
        </span>
        {value && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleClear(); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 2,
              color: 'var(--text-muted)', fontSize: 14, flexShrink: 0,
            }}
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <PickerDropdown
          query={query}
          setQuery={setQuery}
          results={results}
          totalCount={totalCount}
          loading={loading}
          onSelect={handleSelect}
          onClear={value ? handleClear : null}
          style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000, marginTop: 4 }}
        />
      )}
    </div>
  );
}

// ── Dropdown panel with search + grid ──
function PickerDropdown({ query, setQuery, results, totalCount, loading, onSelect, onClear, style }) {
  const inputRef = useRef(null);

  useEffect(() => {
    // Focus search on open
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--accent)',
      borderRadius: 12,
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
      padding: 12,
      minWidth: 320,
      maxWidth: 420,
      maxHeight: 400,
      display: 'flex',
      flexDirection: 'column',
      ...style,
    }}>
      {/* Search input */}
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={`Search ${totalCount.toLocaleString()} icons...`}
          style={{
            width: '100%', padding: '8px 12px', borderRadius: 8,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-card-inner)', color: 'var(--text-primary)',
            fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Also allow pasting a direct URL */}
      <div style={{ marginBottom: 8 }}>
        <input
          type="text"
          placeholder="Or paste a URL to any image..."
          onKeyDown={e => {
            if (e.key === 'Enter' && e.target.value.trim()) {
              onSelect({ url: e.target.value.trim(), name: 'Custom URL', slug: 'custom' });
            }
          }}
          style={{
            width: '100%', padding: '6px 10px', borderRadius: 6,
            border: '1px dashed var(--border-color)',
            background: 'transparent', color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)', fontSize: 11, outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Icon grid */}
      <div style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(48px, 1fr))',
        gap: 4,
      }}>
        {loading && results.length === 0 && (
          <div style={{
            gridColumn: '1 / -1', textAlign: 'center', padding: 20,
            color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)',
          }}>
            Loading icons...
          </div>
        )}

        {!loading && results.length === 0 && query && (
          <div style={{
            gridColumn: '1 / -1', textAlign: 'center', padding: 20,
            color: 'var(--text-muted)', fontSize: 12,
          }}>
            No icons match "{query}"
          </div>
        )}

        {results.map(icon => (
          <button
            key={`${icon.repo}-${icon.slug}`}
            title={`${icon.name} (${icon.repoLabel})`}
            onClick={() => onSelect(icon)}
            style={{
              width: '100%', aspectRatio: '1', borderRadius: 8,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-card-inner)',
              cursor: 'pointer', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              padding: 6, transition: 'all 0.1s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-glow)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.background = 'var(--bg-card-inner)'; }}
          >
            <img
              src={icon.url}
              alt={icon.name}
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 4 }}
              onError={e => { e.target.style.display = 'none'; }}
            />
          </button>
        ))}
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-color)',
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
          {results.length} shown · {totalCount.toLocaleString()} total
        </span>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--red)',
            }}
          >
            Clear icon
          </button>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──
function isEmoji(str) {
  if (!str || typeof str !== 'string') return false;
  // Check if it's a URL
  if (str.startsWith('http') || str.startsWith('/')) return false;
  return /^[\u{1F000}-\u{1FFFF}]|^[\u{2600}-\u{27BF}]|^[\u{FE00}-\u{FEFF}]|^[\u00A0-\u00FF]|^[\u2000-\u3300]/u.test(str);
}

function extractSlug(url) {
  if (!url) return '';
  try {
    const parts = url.split('/');
    const last = parts[parts.length - 1];
    return last.replace(/\.(svg|png|webp)$/, '');
  } catch {
    return url;
  }
}
