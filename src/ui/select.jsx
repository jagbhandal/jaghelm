/*
 * Select (spec §5.4, #285): one choice from a list. Base UI's Select gives the
 * listbox pattern: Enter, Space or the arrow keys open it, the arrows and
 * typing move through it, Enter picks, Escape closes, and focus returns to the
 * trigger. The trigger is drawn like the Input (the mock's .field select). The
 * list is a popover: surface-2 inside a strong edge, shadow-pop, 6px around
 * 8px-radius options, the highlighted one tinted row-hover (the mock's command
 * palette rows), the chosen one ticked in accent-text; under the keyboard each
 * option also shows the focus ring, inset. It is portalled to the end of
 * <body> as a `.jh-ui` root with the screen's switches (lib/portal.js), and
 * opens below the trigger rather than over it.
 *
 * `items` is [{ value, label, disabled? }]. The props Base UI's Select.Root
 * takes (value, onValueChange, name, disabled...) go to it; every other prop,
 * `ref` included, goes to the trigger, the element that takes focus: style,
 * data-*, ARIA, title and focus handlers. Inside a Field the trigger takes the
 * field's label, which the Field renders as a <div> (a <label> would open the
 * list when clicked; lib/field-context.js), and Base UI focuses the trigger
 * from it.
 *
 * Base UI's part loads with the floating layer (lib/floating.jsx;
 * floating/select.jsx), which a Select asks for as it mounts: its trigger is
 * the control. Until it is in, the trigger is drawn here as Base UI draws it
 * (the chosen label or the placeholder, the Field's label and help text in
 * its name and description), and a click or an arrow key on it opens the
 * list as soon as the layer is in.
 */
import { useContext } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './lib/utils.js';
import { FieldContext, useNoLabelElement } from './lib/field-context.js';
import { useFloatingTrigger } from './lib/floating.jsx';

/** Select.Root's props (Base UI 1.x); `onOpenChange` is handled apart. */
export const ROOT_PROPS = new Set([
  'value',
  'defaultValue',
  'onValueChange',
  'open',
  'defaultOpen',
  'onOpenChangeComplete',
  'name',
  'form',
  'id',
  'required',
  'readOnly',
  'disabled',
  'multiple',
  'modal',
  'inputRef',
  'autoComplete',
  'highlightItemOnHover',
  'actionsRef',
  'itemToStringLabel',
  'itemToStringValue',
  'isItemEqualToValue',
]);

/**
 * `props` split between Select.Root and the trigger. Only the props given: an
 * explicit undefined would hide what a Field sets on the trigger (its label,
 * its description).
 */
export function splitProps(props) {
  const root = {};
  const trigger = {};
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) (ROOT_PROPS.has(key) ? root : trigger)[key] = value;
  }
  return [root, trigger];
}

/** The trigger's, its value's and its icon's classes, drawn alike by both. */
export const TRIGGER_CLASS =
  'inline-flex h-control w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-lg border border-border-strong bg-background pr-2 pl-2.5 text-left text-body-sm text-text-1 transition-colors focus-visible:outline-offset-1 data-disabled:cursor-not-allowed data-disabled:opacity-55 aria-invalid:border-crit-border';
export const VALUE_CLASS = 'min-w-0 truncate data-placeholder:text-text-3';
export const ICON_CLASS = 'flex shrink-0 text-text-2';

/** The chevron in the trigger. */
export const chevron = <ChevronDown className="size-4" strokeWidth={1.75} />;

/** The arrow keys open the list, as a click (Enter, Space) does. */
const opensList = (event) =>
  event.type === 'click' ||
  (event.type === 'keydown' && (event.key === 'ArrowDown' || event.key === 'ArrowUp'));

function Select({ items = [], placeholder, className, onOpenChange, ref, ...props }) {
  useNoLabelElement();
  const field = useContext(FieldContext);
  const { layer, handoff, light } = useFloatingTrigger({ now: true, opens: opensList });
  if (layer) {
    return (
      <layer.SelectLayer
        items={items}
        placeholder={placeholder}
        className={className}
        onOpenChange={onOpenChange}
        triggerRef={ref}
        handoff={handoff}
        {...props}
      />
    );
  }
  const [root, trigger] = splitProps(props);
  const value = 'value' in root ? root.value : root.defaultValue;
  const same = root.isItemEqualToValue ?? Object.is;
  const chosen = value == null ? undefined : items.find((item) => same(item.value, value));
  const empty = chosen === undefined ? '' : undefined;
  const disabled = root.disabled ?? field?.disabled;
  const named = trigger['aria-label'] != null || trigger['aria-labelledby'] != null;
  const element = (
    <button
      type="button"
      role="combobox"
      aria-expanded={false}
      aria-haspopup="listbox"
      aria-labelledby={named ? undefined : field?.labelId}
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid || undefined}
      disabled={disabled || undefined}
      data-disabled={disabled ? '' : undefined}
      data-placeholder={empty}
      id={root.id}
      {...trigger}
      ref={ref}
      data-slot="select"
      className={cn(TRIGGER_CLASS, className)}
    >
      <span data-placeholder={empty} className={VALUE_CLASS}>
        {chosen === undefined ? placeholder : chosen.label}
      </span>
      <span aria-hidden="true" className={ICON_CLASS}>
        {chevron}
      </span>
    </button>
  );
  return light(element);
}

export { Select };
