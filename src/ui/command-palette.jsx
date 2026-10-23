/*
 * CommandPalette (#315, spec UX audit m8): ⌘K's "Search or jump to", the
 * mock's palette. A field over grouped results, each group under its heading,
 * each result a row: its lamp when it has a state (an issue, an entity), its
 * name over a 12px line of where it is and what it says, and its kind at the
 * end. What it lists and what each row opens is the caller's
 * (src/shell/paletteIndex.js); this draws them and runs the keys.
 *
 * The mock's frame, the Dialog's look: surface-1 inside a strong edge, a 12px
 * radius, shadow-pop over the scrim, 96px from the top and centred, 600px or
 * the screen less 16px a side. The field is the whole 52px row at the top,
 * the search icon and the mock's Esc button over its ends, so its focus ring
 * traces the row's edge; the results scroll inside 380px; a footer says the
 * keys.
 *
 * It is portalled to the end of <body> as a `.jh-ui` root with the screen's
 * switches (lib/portal.js), so it opens over any open layer, the detail
 * drawer too: it comes after the drawer's portal, at the same layer, and the
 * drawer, opened before it, leaves it out of what it hides. Escape closes the
 * palette alone, never the drawer under it.
 *
 * The combobox and listbox pattern: focus stays in the field. ArrowUp and
 * ArrowDown move the highlighted row (aria-activedescendant), Enter opens it,
 * Escape, the Esc button or a click on the scrim closes the palette, and focus
 * goes back to whatever had it before. Typing starts again from the first row.
 * The highlighted row is held by its id, so rows that move (a status that
 * changed) keep it, and Enter opens the row it shows; a row that goes leaves
 * the first one highlighted.
 * The results are a listbox of groups, each named by its heading; each row is
 * an option named by its name, kind, state word, where and detail together.
 *
 * A row with an `href` is a link. With an `onOpen` too (an entity, a page),
 * a plain click or Enter closes the palette and calls `onOpen`, the way a row
 * of the page opens it (lib/link.js); a click with Ctrl, ⌘ or Shift, or the
 * middle button, is the browser's: the same address in a new tab, the
 * palette left open. Without one (a Quick Launch link) it is the plain link,
 * with its `target` and no opener, as Quick Launch draws it: a click follows
 * it and closes the palette, and Enter clicks it. A row with neither is a
 * command (`onOpen` only: Log out).
 *
 *   open           drawn or not
 *   onClose        closes it; the caller sets `open` back
 *   query          the field's words, and onQueryChange(words) as they change
 *   groups         [{ id, heading, rows }], each row { id, label, kind, where,
 *                  detail, state, word, href, onOpen, target }
 *   label          the dialog's name ("Search or jump to")
 *   placeholder    the field's
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { StatusLamp } from './status-lamp.jsx';
import { cn } from './lib/utils.js';
import { openHere } from './lib/link.js';
import { lampName, spoken } from './lib/status.js';
import { usePortalRoot } from './lib/portal.js';

/** A row's line under its name: where it is, then what it says. */
const lineOf = (row) => [row.where, row.detail].filter((v) => v != null && v !== '').join(' · ');

/**
 * What a row is named: its name, its kind, its lamp's word, where it is and
 * its detail, each once (an entity's detail is its word).
 */
export function rowName(row) {
  const said = row.state ? spoken(lampName(row.state, row.word)) : null;
  const parts = [row.label, row.kind, said, row.where];
  if (row.detail != null && row.detail !== '' && row.detail !== row.word) parts.push(row.detail);
  return parts.filter((v) => v != null && v !== '').join(', ');
}

function CommandPalette({ open, ...props }) {
  return open ? <OpenPalette {...props} /> : null;
}

function OpenPalette({
  onClose,
  query = '',
  onQueryChange,
  groups = [],
  label = 'Search or jump to',
  placeholder = 'Search services, nodes, issues, settings and links',
  className,
  ...props
}) {
  const id = useId();
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const restoreRef = useRef(null);
  const [portalRoot] = usePortalRoot();
  const rows = groups.flatMap((g) => g.rows);
  // The highlighted row, by its id: the first row's to begin with, and again
  // for each new query, or when the one it held goes.
  const [activeId, setActiveId] = useState(() => rows[0]?.id ?? null);
  const [queryShown, setQueryShown] = useState(query);
  let current = rows.findIndex((r) => r.id === activeId);
  if (query !== queryShown) {
    setQueryShown(query);
    setActiveId(rows[0]?.id ?? null);
    current = rows.length > 0 ? 0 : -1;
  } else if (current < 0 && rows.length > 0) {
    setActiveId(rows[0].id);
    current = 0;
  }
  const setActive = (i) => setActiveId(rows[i]?.id ?? null);
  const optionId = (i) => `${id}-opt-${i}`;

  // On open, remember what had focus, and focus the field. If the palette
  // goes without closing itself (⌘K again), focus still goes back.
  useLayoutEffect(() => {
    restoreRef.current = document.activeElement;
    const dialog = dialogRef.current;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      const now = document.activeElement;
      if (!now || now === document.body || dialog?.contains(now)) restoreRef.current?.focus?.();
    };
  }, []);

  // The highlighted row stays in view.
  useEffect(() => {
    if (current >= 0)
      document.getElementById(`${id}-opt-${current}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [id, current]);

  const close = () => {
    onClose();
    restoreRef.current?.focus?.();
  };

  // A row's click: a plain one opens it here, any other is the browser's.
  const clicked = (event, row) => {
    if (row.onOpen && row.href) {
      openHere(event, () => {
        close();
        row.onOpen();
      });
      return;
    }
    if (row.onOpen) {
      close();
      row.onOpen();
      return;
    }
    // The plain link: the browser follows it.
    const plain =
      event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    if (plain) close();
  };

  const openAt = (i) => {
    const row = rows[i];
    if (!row) return;
    if (row.onOpen) {
      close();
      row.onOpen();
    } else {
      // The link itself, so it opens as a click on it does.
      document.getElementById(optionId(i))?.click();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      // The palette's alone: a drawer under it stays open.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(current + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(current - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openAt(current);
    } else if (e.key === 'Tab') {
      // The field is the one stop: focus stays on it.
      e.preventDefault();
    }
  };

  const q = query.trim();
  let index = -1;
  return createPortal(
    <div {...portalRoot} data-slot="command-palette-root">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close search"
        data-slot="command-palette-scrim"
        onClick={close}
        className="fixed inset-0 z-dialog cursor-default bg-scrim"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-slot="command-palette"
        className={cn(
          'fixed top-24 left-1/2 z-dialog flex max-h-[calc(100dvh-8rem)] w-[600px] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border-strong bg-surface-1 text-body text-text-1 shadow-pop',
          className
        )}
        {...props}
      >
        <div className="relative h-13 shrink-0 border-b border-border">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Search"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={current >= 0 ? optionId(current) : undefined}
            placeholder={placeholder}
            value={query}
            onChange={(e) => onQueryChange?.(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
            className="size-full rounded-t-xl bg-transparent pr-16 pl-10 text-title-xs font-normal text-text-1 -outline-offset-2 placeholder:text-text-3"
          />
          <Search
            aria-hidden="true"
            strokeWidth={1.75}
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-3"
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label="Esc to close"
            onClick={close}
            className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer rounded-md px-2 py-0.5 text-caption text-text-3 transition-colors hover:bg-row-hover hover:text-text-1"
          >
            Esc
          </button>
        </div>
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label="Results"
          className="max-h-[380px] min-h-0 overflow-y-auto overscroll-contain p-1.5"
        >
          {groups.map((group) => (
            <div
              key={group.id}
              role="group"
              aria-labelledby={`${id}-${group.id}`}
              data-slot="command-palette-group"
            >
              <div
                role="presentation"
                id={`${id}-${group.id}`}
                className="px-2.5 pt-2 pb-1 text-overline text-text-3 uppercase"
              >
                {group.heading}
              </div>
              {group.rows.map((row) => {
                index += 1;
                const i = index;
                const Tag = row.href ? 'a' : 'div';
                const line = lineOf(row);
                return (
                  <Tag
                    key={row.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === current}
                    aria-label={rowName(row)}
                    tabIndex={-1}
                    href={row.href}
                    target={row.href && row.target ? row.target : undefined}
                    rel={row.href && !row.onOpen ? 'noopener noreferrer' : undefined}
                    data-slot="command-palette-row"
                    onMouseMove={() => i !== current && setActive(i)}
                    onMouseDown={(e) => e.button === 0 && e.preventDefault()}
                    onClick={(e) => clicked(e, row)}
                    className="grid cursor-pointer grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2.5 py-2 text-text-1 aria-selected:bg-row-hover"
                  >
                    <span className="flex justify-center">
                      {row.state ? <StatusLamp state={row.state} decorative /> : null}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold">{row.label}</span>
                      {line ? (
                        <span className="truncate text-caption text-text-3">{line}</span>
                      ) : null}
                    </span>
                    <span className="text-overline text-text-3 uppercase">{row.kind}</span>
                  </Tag>
                );
              })}
            </div>
          ))}
        </div>
        {/* Outside the listbox, whose children are its groups. */}
        {rows.length === 0 ? (
          <div role="status" className="px-4 pt-2.5 pb-5.5 text-body-sm text-text-3">
            {q ? `Nothing matches “${q}”.` : 'Nothing to show.'}
          </div>
        ) : null}
        <div
          aria-hidden="true"
          className="flex shrink-0 gap-4 border-t border-border px-3.5 py-2 text-caption text-text-3"
        >
          <span className="shrink-0 whitespace-nowrap">
            <span className="font-mono">↑↓</span> move
          </span>
          <span className="shrink-0 whitespace-nowrap">
            <span className="font-mono">↵</span> open
          </span>
          <span className="ml-auto min-w-0 truncate">
            Apps and Quick Launch links are searchable here
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}

export { CommandPalette };
