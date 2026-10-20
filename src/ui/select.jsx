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
 */
import { useCallback, useRef } from 'react';
import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from './lib/utils.js';
import { usePortalRoot } from './lib/portal.js';
import { useNoLabelElement } from './lib/field-context.js';

/** Select.Root's props (Base UI 1.x); `onOpenChange` is handled apart. */
const ROOT_PROPS = new Set([
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

// An object value stringifies like every other, so it is keyed by position.
const itemKey = (item, index) =>
  item.value !== null && typeof item.value === 'object' ? `#${index}` : String(item.value);

function Select({ items = [], placeholder, className, onOpenChange, ref, ...props }) {
  useNoLabelElement();
  const triggerRef = useRef(null);
  const setTriggerRef = useCallback(
    (node) => {
      triggerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref]
  );
  const [portalRoot, syncPortalRoot] = usePortalRoot(triggerRef);
  const openChange = (open, details) => {
    if (open) syncPortalRoot();
    onOpenChange?.(open, details);
  };
  // Only the props given: an explicit undefined would hide what a Field sets
  // on the trigger (its label, its description).
  const rootProps = {};
  const triggerProps = {};
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) (ROOT_PROPS.has(key) ? rootProps : triggerProps)[key] = value;
  }
  return (
    <SelectPrimitive.Root items={items} onOpenChange={openChange} {...rootProps}>
      <SelectPrimitive.Trigger
        {...triggerProps}
        ref={setTriggerRef}
        data-slot="select"
        className={cn(
          'inline-flex h-control w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-lg border border-border-strong bg-background pr-2 pl-2.5 text-left text-body-sm text-text-1 transition-colors focus-visible:outline-offset-1 data-disabled:cursor-not-allowed data-disabled:opacity-55 aria-invalid:border-crit-border',
          className
        )}
      >
        <SelectPrimitive.Value
          placeholder={placeholder}
          className="min-w-0 truncate data-placeholder:text-text-3"
        />
        <SelectPrimitive.Icon className="flex shrink-0 text-text-2">
          <ChevronDown className="size-4" strokeWidth={1.75} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal {...portalRoot}>
        <SelectPrimitive.Positioner
          alignItemWithTrigger={false}
          sideOffset={4}
          className="z-dialog"
        >
          <SelectPrimitive.Popup
            data-slot="select-popup"
            className="max-h-[var(--available-height)] min-w-[var(--anchor-width)] overflow-y-auto rounded-lg border border-border-strong bg-surface-2 p-1.5 text-body-sm text-text-1 shadow-pop transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0"
          >
            <SelectPrimitive.List>
              {items.map((item, index) => (
                <SelectPrimitive.Item
                  key={itemKey(item, index)}
                  value={item.value}
                  disabled={item.disabled}
                  className="flex h-control-sm cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 -outline-offset-2 select-none data-disabled:cursor-not-allowed data-disabled:opacity-55 data-highlighted:bg-row-hover"
                >
                  <SelectPrimitive.ItemText className="min-w-0 truncate">
                    {item.label}
                  </SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="flex shrink-0">
                    <Check className="size-4 text-accent-text" strokeWidth={2} />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export { Select };
