/*
 * LayoutEditor (#330, spec §8 "Edit layout mode"): the panel that arranges the
 * Overview, drawn above its sections while the mode is on. A Panel titled
 * "Edit layout" (its icon in the accent chip), a row with "Reset order and
 * pins" (ghost) and "Done" (primary), then:
 *
 *  - Sections: a bordered list, a row each, in the Overview's order. A
 *    movable row has a grip, Move up and Move down (IconButtons, disabled at
 *    the ends) and a Switch, "Show <name>"; a row that can't move
 *    (`movable: false`: Needs attention, the strip, the rail) has no grip or
 *    buttons, only its hint under the name, and a locked one a disabled
 *    Switch.
 *  - Services: a "New group name" Input with "Add group"; "Pinned, in order",
 *    a list of the pinned services, each with its grip, Move up and Move
 *    down, a Select for its group and Unpin; then "All services", a search
 *    Input and the rest, each with its group Select and Pin.
 *
 * Presentational: the shell (OverviewEditor) holds the arrangement and passes
 * what each row is and what a control does. Nothing is pointer-only: Move up
 * and Move down do what the grip's drag does, and after a move, a pin or an
 * unpin, focus is on the moved row's own button (the other of the pair when
 * that one is disabled now), so a keyboard user keeps their place. One polite
 * live region says each change (`message`). The grip is decorative to
 * assistive technology (aria-hidden, no tab stop): its drag uses window
 * pointer listeners, since a row React moves in the DOM would lose a
 * pointer capture. Escape anywhere in the panel calls `onDone` (not Escape
 * in a Select's list, which closes the list); the panel takes focus when it
 * opens, so a keyboard user lands in it.
 *
 * `sections` is `[{ id, label, hint?, shown, locked?, movable? }]` in order;
 * `onSectionMove(id, delta)` for the buttons, `onSectionReorder(id, index)`
 * for a drag (index among the movable rows), `onSectionShown(id, on)`.
 * `pinned` and `services` are `[{ id, name, where?, group, groupDisabled? }]`;
 * `groups` the Select's `[{ value, label }]`, whose `groupNone` value is "No
 * group"; `onPin`, `onUnpin`, `onPinnedMove`, `onPinnedReorder`, `onGroup(id,
 * value)`; `groupName`, `onGroupName`, `onAddGroup` for the new group;
 * `query`, `onQuery` and `servicesEmpty` (what the list says when it is
 * empty) for the search; `servicesNote` a line over the Services block.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, LayoutPanelTop, Pin, PinOff } from 'lucide-react';
import { Button } from './button.jsx';
import { IconButton } from './icon-button.jsx';
import { Input } from './input.jsx';
import { Panel } from './panel.jsx';
import { Select } from './select.jsx';
import { Switch } from './switch.jsx';
import { indexAtY } from './lib/reorder.js';

/** The group Select's value for "No group". */
export const GROUP_NONE = '__none__';

const ROW =
  'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border px-panel py-2 last:border-b-0 data-[dragging]:bg-accent-tint';
const LIST = 'rounded-lg border border-border';

/**
 * Pointer dragging for a list: a row's grip, held, moves the row through the
 * list as the pointer crosses its neighbours (`onMove(id, toIndex)`). Returns
 * the dragged id and the grip's handler.
 */
function useDrag(listRef, onMove) {
  const [dragging, setDragging] = useState(null);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const start = (event, id) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    setDragging(id);
    const over = (e) => {
      const rows = [...(listRef.current?.querySelectorAll(':scope > [data-edit-item]') ?? [])];
      const rects = rows.map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.dataset.editItem, top: r.top, bottom: r.bottom };
      });
      const to = indexAtY(rects, e.clientY);
      if (to >= 0 && rects[to].id !== id) moveRef.current?.(id, to);
    };
    const end = () => {
      window.removeEventListener('pointermove', over);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setDragging(null);
    };
    window.addEventListener('pointermove', over);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  return [dragging, start];
}

/** The pointer's grip: decorative to a keyboard (Move up and Move down are its way). */
function Grip({ label, onPointerDown }) {
  return (
    <span
      aria-hidden="true"
      data-slot="edit-grip"
      title={`Drag ${label}`}
      onPointerDown={onPointerDown}
      className="inline-flex size-control-sm shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-text-3 hover:bg-surface-2 active:cursor-grabbing"
    >
      <GripVertical className="size-4" />
    </span>
  );
}

/** Move up and Move down for the row `id` named `label`, at `index` of `count`. */
function MoveButtons({ id, label, index, count, onBy }) {
  return (
    <>
      <IconButton
        size="sm"
        label={`Move ${label} up`}
        data-move={`${id}:up`}
        disabled={index <= 0}
        onClick={() => onBy(id, -1)}
      >
        <ArrowUp />
      </IconButton>
      <IconButton
        size="sm"
        label={`Move ${label} down`}
        data-move={`${id}:down`}
        disabled={index >= count - 1}
        onClick={() => onBy(id, 1)}
      >
        <ArrowDown />
      </IconButton>
    </>
  );
}

/** A service's name, and where it is. */
function ServiceName({ service }) {
  return (
    <span className="min-w-0 flex-1 basis-36 text-body-sm break-words">
      {service.name}
      {service.where && <span className="text-text-3"> · {service.where}</span>}
    </span>
  );
}

function LayoutEditor({
  sections = [],
  onSectionShown,
  onSectionMove,
  onSectionReorder,
  pinned = [],
  services = [],
  groups = [],
  onPin,
  onUnpin,
  onPinnedMove,
  onPinnedReorder,
  onGroup,
  groupName = '',
  onGroupName,
  onAddGroup,
  query = '',
  onQuery,
  servicesEmpty,
  servicesNote,
  message = '',
  onReset,
  resetDisabled = false,
  onDone,
  ...props
}) {
  const rootRef = useRef(null);
  const headingRef = useRef(null);
  const sectionList = useRef(null);
  const pinnedList = useRef(null);
  // The button to focus once the change has drawn: "<id>\0<try>\0<try>".
  const focusAfter = useRef(null);
  const [draggingSection, dragSection] = useDrag(sectionList, onSectionReorder);
  const [draggingPin, dragPin] = useDrag(pinnedList, onPinnedReorder);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  useLayoutEffect(() => {
    const want = focusAfter.current;
    if (!want) return;
    focusAfter.current = null;
    const [id, ...tries] = want.split('\u0000');
    for (const t of tries) {
      const el = rootRef.current?.querySelector(`[data-move="${CSS.escape(`${id}:${t}`)}"]`);
      if (el && !el.disabled && !el.hasAttribute('data-disabled')) {
        el.focus();
        return;
      }
    }
  });

  const moved = (delta) => (delta < 0 ? 'up\u0000down' : 'down\u0000up');
  const moveSection = (id, delta) => {
    focusAfter.current = `${id}\u0000${moved(delta)}`;
    onSectionMove?.(id, delta);
  };
  const movePinned = (id, delta) => {
    focusAfter.current = `${id}\u0000${moved(delta)}`;
    onPinnedMove?.(id, delta);
  };
  const pin = (id) => {
    focusAfter.current = `${id}\u0000unpin`;
    onPin?.(id);
  };
  const unpin = (id) => {
    focusAfter.current = `${id}\u0000pin`;
    onUnpin?.(id);
  };

  const movable = sections.filter((s) => s.movable !== false);
  const groupSelect = (item) => (
    <Select
      aria-label={`Group for ${item.name}`}
      items={groups}
      value={item.group ?? GROUP_NONE}
      disabled={item.groupDisabled || groups.length <= 1}
      onValueChange={(value) => onGroup?.(item.id, value)}
      className="w-40"
    />
  );

  return (
    <Panel
      ref={rootRef}
      data-slot="layout-editor"
      icon={<LayoutPanelTop />}
      title="Edit layout"
      description="Arrange the Overview. Changes show at once and are kept on every device."
      onKeyDown={(e) => {
        // Escape in a Select's list (drawn in a portal) closes the list, not the mode.
        if (e.key === 'Escape' && e.currentTarget.contains(e.target)) onDone?.();
      }}
      {...props}
    >
      <span ref={headingRef} tabIndex={-1} className="sr-only">
        Edit layout is on. Escape or Done leaves it.
      </span>
      <div className="sr-only" role="status" aria-live="polite" data-slot="edit-announce">
        {message}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="ghost" disabled={resetDisabled} onClick={onReset}>
          Reset order and pins
        </Button>
        <Button size="sm" variant="primary" onClick={() => onDone?.()}>
          Done
        </Button>
      </div>

      <h3 className="text-overline text-text-2 uppercase">Sections</h3>
      <ul ref={sectionList} aria-label="Sections" className={LIST}>
        {sections.map((section) => {
          const canMove = section.movable !== false;
          const index = movable.indexOf(section);
          return (
            <li
              key={section.id}
              data-edit-item={canMove ? section.id : undefined}
              data-dragging={draggingSection === section.id ? '' : undefined}
              className={ROW}
            >
              {canMove ? (
                <Grip label={section.label} onPointerDown={(e) => dragSection(e, section.id)} />
              ) : (
                <span aria-hidden="true" className="size-control-sm shrink-0" />
              )}
              <span className="min-w-0 flex-1 basis-32 text-body-sm font-semibold">
                {section.label}
                {section.hint && (
                  <span className="block text-caption font-normal text-text-3">{section.hint}</span>
                )}
              </span>
              {canMove && (
                <MoveButtons
                  id={section.id}
                  label={section.label}
                  index={index}
                  count={movable.length}
                  onBy={moveSection}
                />
              )}
              <Switch
                aria-label={`Show ${section.label}`}
                checked={section.shown}
                disabled={section.locked}
                onCheckedChange={(on) => onSectionShown?.(section.id, on)}
              />
            </li>
          );
        })}
      </ul>

      <h3 className="text-overline text-text-2 uppercase">Services</h3>
      {servicesNote && <p className="text-caption text-text-3">{servicesNote}</p>}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onAddGroup?.();
        }}
      >
        <Input
          aria-label="New group name"
          placeholder="New group name"
          value={groupName}
          onChange={(e) => onGroupName?.(e.target.value)}
          className="max-w-64"
          maxLength={60}
        />
        <Button size="sm" type="submit" disabled={groupName.trim() === ''}>
          Add group
        </Button>
        <span className="text-caption text-text-3">
          {'Groups are the custom groups of Settings → Nodes & Services.'}
        </span>
      </form>

      <h4 className="text-body-sm font-semibold">Pinned, in order</h4>
      {pinned.length === 0 ? (
        <p className="text-caption text-text-3">Nothing pinned: pin a service below.</p>
      ) : (
        <ul ref={pinnedList} aria-label="Pinned" className={LIST}>
          {pinned.map((item, i) => (
            <li
              key={item.id}
              data-edit-item={item.id}
              data-dragging={draggingPin === item.id ? '' : undefined}
              className={ROW}
            >
              <Grip label={item.name} onPointerDown={(e) => dragPin(e, item.id)} />
              <ServiceName service={item} />
              <MoveButtons
                id={item.id}
                label={item.name}
                index={i}
                count={pinned.length}
                onBy={movePinned}
              />
              {groupSelect(item)}
              <IconButton
                size="sm"
                label={`Unpin ${item.name}`}
                data-move={`${item.id}:unpin`}
                onClick={() => unpin(item.id)}
              >
                <PinOff />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <h4 className="text-body-sm font-semibold">All services</h4>
      <Input
        aria-label="Find a service"
        type="search"
        placeholder="Find a service"
        value={query}
        onChange={(e) => onQuery?.(e.target.value)}
        className="max-w-64"
      />
      <ul aria-label="Services to pin" className={`${LIST} max-h-96 overflow-y-auto`}>
        {services.length === 0 && (
          <li className={ROW}>
            <span className="text-caption text-text-3">{servicesEmpty}</span>
          </li>
        )}
        {services.map((item) => (
          <li key={item.id} className={ROW}>
            <ServiceName service={item} />
            {groupSelect(item)}
            <IconButton
              size="sm"
              label={`Pin ${item.name}`}
              data-move={`${item.id}:pin`}
              onClick={() => pin(item.id)}
            >
              <Pin />
            </IconButton>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export { LayoutEditor };
