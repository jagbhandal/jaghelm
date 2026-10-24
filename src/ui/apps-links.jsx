/*
 * Settings → Apps & links' lists (#362, spec §7), as the mock's Settings board
 * draws them; src/components/settings/sections/AppsLinks.jsx wires them to the
 * display config.
 *
 *   OrderedRows  rows in an order the user sets, as the mock's Apps table:
 *                a grip, then each row's `lead` (its chip), `title` and
 *                `subtitle`, a `status` word and its `actions`. The order is
 *                set by dragging a row by the pointer or, for the keyboard
 *                and touch, by the Move up and Move down buttons on each row,
 *                which say where the row went in a polite status line. A row
 *                with an `editor` shows it under itself.
 *   AppIcon      an app's or link's chip, 28px: its icon image (`src`) or the
 *                two letters (`text`) the sidebar's chip has.
 *   CheckWord    an embedding check's answer, in words, in its tone's colour:
 *                ok, warn, or neutral for "Checking…" and "Could not check".
 *
 * The layout pieces the section's forms and groups are put together from (the
 * section's own files keep to these and the controls, never a utility class):
 *   Tray, FormStack, Column, FieldRow, IconSlot, ToggleLine, Actions, Note, Announce,
 *   MonoInput, InlineForm, Grow, GroupBox, GroupHead.
 *
 * Every row is named by its `name`, so its buttons say whom they are for
 * ("Move Grafana up", "Remove Grafana").
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { IconButton } from './icon-button.jsx';
import { Input } from './input.jsx';
import { cn } from './lib/utils.js';

const TONE = {
  ok: 'text-ok-fg',
  warn: 'text-warn-fg',
  neutral: 'text-text-3',
};

function CheckWord({ tone = 'neutral', className, children }) {
  return (
    <span
      data-slot="check-word"
      data-tone={tone}
      className={cn('text-body-sm font-semibold', TONE[tone] ?? TONE.neutral, className)}
    >
      {children}
    </span>
  );
}

function AppIcon({ src, text, className }) {
  return src ? (
    <img
      src={src}
      alt=""
      data-slot="app-icon"
      className={cn('size-7 shrink-0 rounded-md object-contain', className)}
    />
  ) : (
    <span
      aria-hidden="true"
      data-slot="app-chip"
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-3 text-caption font-extrabold text-text-1',
        className
      )}
    >
      {text}
    </span>
  );
}

/**
 * @param {{ items: Array<{ id: string, name: string, lead?: import('react').ReactNode,
 *   title: import('react').ReactNode, subtitle?: import('react').ReactNode,
 *   status?: import('react').ReactNode, actions?: import('react').ReactNode,
 *   editor?: import('react').ReactNode }>, label: string,
 *   onMove: (id: string, delta: -1 | 1) => void,
 *   onReorder: (from: string, to: string) => void }} props
 */
function OrderedRows({ items, label, onMove, onReorder, className, ...props }) {
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  const [said, setSaid] = useState('');
  const rows = useRef(new Map()); // id → the row's <li>
  const pending = useRef(null); // { kind: 'move', id, delta } | 'added' | 'removed'
  const before = useRef(items.map((x) => x.id));

  // After the rows change, put focus where the user is: on the moved row's
  // Move button (the other when it can't move that way any more), on a row
  // just added, or on the row that took a removed one's place.
  useLayoutEffect(() => {
    const ids = items.map((x) => x.id);
    const was = before.current;
    before.current = ids;
    const buttons = (id) =>
      rows.current.get(id)?.querySelectorAll('[data-slot="row-buttons"] button');
    const todo = pending.current;
    pending.current = null;
    if (todo?.kind === 'move') {
      const i = ids.indexOf(todo.id);
      const b = buttons(todo.id);
      if (i >= 0 && b) {
        const want = todo.delta < 0 ? 0 : 1;
        const off = (el) => el.disabled || el.hasAttribute('data-disabled');
        const target = off(b[want]) ? b[1 - want] : b[want];
        target.focus();
      }
      return;
    }
    const added = ids.find((id) => !was.includes(id));
    if (added !== undefined && was.length < ids.length) {
      buttons(added)?.[2]?.focus();
    } else if (ids.length < was.length && ids.length > 0) {
      const gone = was.findIndex((id) => !ids.includes(id));
      buttons(ids[Math.min(gone, ids.length - 1)])?.[2]?.focus();
    }
  });

  const move = (item, index, delta) => {
    pending.current = { kind: 'move', id: item.id, delta };
    onMove(item.id, delta);
    setSaid(`Moved ${item.name} to position ${index + delta + 1} of ${items.length}.`);
  };
  const end = () => {
    setDragging(null);
    setOver(null);
  };

  return (
    <div className={cn('min-w-0', className)} {...props}>
      <ul
        data-slot="ordered-rows"
        aria-label={label}
        className="flex flex-col divide-y divide-border border-t border-border empty:border-t-0"
      >
        {items.map((item, index) => (
          <li
            key={item.id}
            ref={(el) => {
              if (el) rows.current.set(item.id, el);
              else rows.current.delete(item.id);
            }}
            data-slot="ordered-row"
            data-over={over === item.id && dragging !== item.id ? '' : undefined}
            className={cn(
              'flex flex-col data-over:bg-accent-tint',
              dragging === item.id && 'opacity-55'
            )}
            onDragOver={(e) => {
              if (dragging == null) return;
              e.preventDefault();
              setOver(item.id);
            }}
            onDrop={(e) => {
              if (dragging == null) return;
              e.preventDefault();
              if (dragging !== item.id) {
                onReorder(dragging, item.id);
                const to = items.findIndex((x) => x.id === item.id);
                setSaid(`Moved to position ${to + 1} of ${items.length}.`);
              }
              end();
            }}
          >
            <div
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', item.id);
                setDragging(item.id);
              }}
              onDragEnd={end}
              className="flex min-h-row flex-wrap items-center gap-x-3 gap-y-1 px-panel py-2"
            >
              <span
                aria-hidden="true"
                title="Drag to reorder"
                data-slot="grip"
                className="inline-flex shrink-0 cursor-grab text-text-3 active:cursor-grabbing [&_svg]:size-4"
              >
                <GripVertical />
              </span>
              {item.lead}
              <div className="flex min-w-0 flex-1 basis-36 flex-col">
                <span className="truncate text-body-sm font-semibold text-text-1">
                  {item.title}
                </span>
                {item.subtitle != null ? (
                  <span className="truncate font-mono text-caption text-text-3">
                    {item.subtitle}
                  </span>
                ) : null}
              </div>
              {item.status != null ? (
                <div className="min-w-0 basis-40 sm:basis-56">{item.status}</div>
              ) : null}
              <div data-slot="row-buttons" className="flex shrink-0 items-center gap-1">
                <IconButton
                  size="sm"
                  label={`Move ${item.name} up`}
                  disabled={index === 0}
                  onClick={() => move(item, index, -1)}
                >
                  <ChevronUp aria-hidden="true" />
                </IconButton>
                <IconButton
                  size="sm"
                  label={`Move ${item.name} down`}
                  disabled={index === items.length - 1}
                  onClick={() => move(item, index, 1)}
                >
                  <ChevronDown aria-hidden="true" />
                </IconButton>
                {item.actions}
              </div>
            </div>
            {item.editor != null ? (
              <div className="border-t border-border bg-surface-2 px-panel py-3">{item.editor}</div>
            ) : null}
          </li>
        ))}
      </ul>
      <p role="status" className="sr-only">
        {said}
      </p>
    </div>
  );
}

/** A tinted strip inside a panel for a form: `edge` is the rule it has, "bottom" or "top". */
function Tray({ edge = 'bottom', className, ...props }) {
  return (
    <div
      data-slot="tray"
      className={cn(
        'bg-surface-2 px-panel py-4',
        edge === 'bottom' ? 'border-b border-border' : 'border-t border-border',
        className
      )}
      {...props}
    />
  );
}

/** A form's fields, stacked. */
function FormStack({ className, ...props }) {
  return <form noValidate className={cn('flex flex-col gap-4', className)} {...props} />;
}

/** Name, address and icon side by side from 640px; stacked on a phone. */
function FieldRow({ className, ...props }) {
  return <div className={cn('grid gap-3 sm:grid-cols-[1fr_1fr_auto]', className)} {...props} />;
}

/** The icon picker under a label, as a Field's. */
function IconSlot({ label = 'Icon', children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-body-sm font-semibold text-text-1">{label}</span>
      {children}
    </div>
  );
}

/** A switch with its words beside it, one label. */
function ToggleLine({ children }) {
  return <label className="flex items-center gap-2 text-body-sm text-text-1">{children}</label>;
}

/** Its children stacked. */
function Column({ className, ...props }) {
  return <div className={cn('flex flex-col gap-3', className)} {...props} />;
}

/** A row of buttons. */
function Actions({ className, ...props }) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)} {...props} />;
}

/** A line of help or a warning, `tone="warn"` in the warning's word colour. */
function Note({ tone, inset = false, className, ...props }) {
  return (
    <p
      className={cn(
        'text-body-sm',
        tone === 'warn' ? 'text-warn-fg' : 'text-text-3',
        inset && 'px-panel pb-panel',
        className
      )}
      {...props}
    />
  );
}

/** Words for a screen reader only, a polite status line. */
function Announce({ children }) {
  return (
    <p role="status" className="sr-only">
      {children}
    </p>
  );
}

/** An Input for an address. */
function MonoInput({ className, ...props }) {
  return <Input className={cn('font-mono', className)} {...props} />;
}

/** A short form on one line that wraps: its fields, then its button. */
function InlineForm({ className, ...props }) {
  return <form noValidate className={cn('flex flex-wrap items-end gap-3', className)} {...props} />;
}

/** A field that takes the room the line has. */
function Grow({ children }) {
  return <div className="min-w-48 flex-1">{children}</div>;
}

/** A Quick Launch group: a bordered box named by its title. */
function GroupBox({ title, ...props }) {
  return (
    <section
      aria-label={title}
      data-slot="link-group"
      className="flex flex-col gap-2 rounded-lg border border-border"
      {...props}
    />
  );
}

/** A group's head: its title and link count, its buttons at the end. */
function GroupHead({ title, count, children }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
      <h3 className="flex-1 text-body-sm font-bold text-text-1">
        {title}{' '}
        <span className="font-normal text-text-3">
          · {count} link{count === 1 ? '' : 's'}
        </span>
      </h3>
      {children}
    </div>
  );
}

export {
  Actions,
  Announce,
  AppIcon,
  CheckWord,
  Column,
  FieldRow,
  FormStack,
  GroupBox,
  GroupHead,
  Grow,
  IconSlot,
  InlineForm,
  MonoInput,
  Note,
  OrderedRows,
  ToggleLine,
  Tray,
};
