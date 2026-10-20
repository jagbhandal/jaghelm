import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useConfig } from '../context/ConfigContext.jsx';
import { THEMES } from './settings/themes.js';
import { safeUrl } from '../utils/safeUrl.js';

/**
 * ⌘K command palette — jump to a page or an app, pick a theme, open a link,
 * or log out.
 *
 * Combobox/listbox pattern: focus stays in the input, ArrowUp/Down move a
 * highlighted index (aria-activedescendant), Enter runs it. Escape / backdrop
 * close and restore focus. No backend — every command is something already
 * controllable app-wide (the pages, the embedded apps, themes, the link list,
 * logout).
 *
 * `pages` (`[{ id, label, href }]`) are the shell's pages in the nav, under
 * "Go to"; `apps` (`[{ id, label, href }]`) the embedded apps, each "Open
 * <app>" (#296). `onNavigate(href)` opens one.
 *
 * Controlled by the parent (`open`/`onClose`) which owns the ⌘K shortcut.
 */
export default function CommandPalette({
  open,
  onClose,
  pages = [],
  apps = [],
  onNavigate,
  theme,
  setTheme,
  onLogout,
}) {
  const { config } = useConfig();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const restoreRef = useRef(null);

  const commands = useMemo(() => {
    const cmds = [];
    for (const p of pages) {
      cmds.push({ id: `page:${p.id}`, group: 'Go to', label: p.label, run: () => onNavigate(p.href) });
    }
    for (const a of apps) {
      cmds.push({
        id: `app:${a.id}`,
        group: 'App',
        label: `Open ${a.label}`,
        hint: 'inside JagHelm',
        run: () => onNavigate(a.href),
      });
    }
    for (const th of THEMES) {
      cmds.push({
        id: `theme:${th.id}`,
        group: 'Theme',
        label: th.name,
        hint: theme === th.id ? 'current' : undefined,
        run: () => setTheme(th.id),
      });
    }
    for (const links of Object.values(config?.links || {})) {
      for (const l of links || []) {
        if (!l?.url) continue;
        cmds.push({
          id: `link:${l.url}`,
          group: 'Open link',
          label: l.name || l.url,
          hint: l.url.replace(/^https?:\/\//, ''),
          run: () => { const u = safeUrl(l.url); if (u) window.open(u, '_blank', 'noopener,noreferrer'); },
        });
      }
    }
    if (onLogout) cmds.push({ id: 'action:logout', group: 'Action', label: 'Log out', run: onLogout });
    return cmds;
  }, [pages, apps, config?.links, theme, onNavigate, setTheme, onLogout]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      `${c.label} ${c.group} ${c.hint || ''}`.toLowerCase().includes(q)
    );
  }, [commands, query]);

  // On open: remember focus, reset state, focus the input. Restore focus on close.
  useEffect(() => {
    if (!open) return undefined;
    restoreRef.current = document.activeElement;
    setQuery('');
    setActive(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (open) document.getElementById(`cmdk-opt-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;

  const close = () => {
    onClose();
    restoreRef.current?.focus?.();
  };
  const runAt = (i) => {
    const cmd = filtered[i];
    if (!cmd) return;
    close();
    cmd.run();
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAt(active);
    } else if (e.key === 'Tab') {
      // Single focusable in the dialog — keep focus trapped on the input.
      e.preventDefault();
    }
  };

  return (
    <div
      className="cmdk-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          className="cmdk-input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-list"
          aria-activedescendant={filtered[active] ? `cmdk-opt-${active}` : undefined}
          placeholder="Search pages, apps, themes, links…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        <ul className="cmdk-list" id="cmdk-list" role="listbox" aria-label="Commands">
          {filtered.length === 0 && (
            <li className="cmdk-empty" role="presentation">
              No matches
            </li>
          )}
          {filtered.map((c, i) => (
            <li
              key={c.id}
              id={`cmdk-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={`cmdk-item${i === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                runAt(i);
              }}
            >
              <span className="cmdk-item-group">{c.group}</span>
              <span className="cmdk-item-label">{c.label}</span>
              {c.hint && <span className="cmdk-item-hint">{c.hint}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
