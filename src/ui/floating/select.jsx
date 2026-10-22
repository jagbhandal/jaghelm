/*
 * The Select's Base UI part, in the floating layer (lib/floating.jsx). The
 * component, its look and its behaviour are documented in ../select.jsx,
 * which draws the trigger until this loads.
 */
import { useCallback, useRef } from 'react';
import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Check } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { usePortalRoot } from '../lib/portal.js';
import { ICON_CLASS, TRIGGER_CLASS, VALUE_CLASS, chevron, splitProps } from '../select.jsx';
import { useHandoff } from './handoff.js';

// An object value stringifies like every other, so it is keyed by position.
const itemKey = (item, index) =>
  item.value !== null && typeof item.value === 'object' ? `#${index}` : String(item.value);

/** Opens the list from the keyboard, as the arrow key that asked for it would. */
function openFromKeyboard(trigger) {
  trigger?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true })
  );
}

function SelectLayer({
  items = [],
  placeholder,
  className,
  onOpenChange,
  triggerRef: ref,
  handoff,
  ...props
}) {
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
  useHandoff(handoff, triggerRef, () => openFromKeyboard(triggerRef.current));
  const [rootProps, triggerProps] = splitProps(props);
  return (
    <SelectPrimitive.Root items={items} onOpenChange={openChange} {...rootProps}>
      <SelectPrimitive.Trigger
        {...triggerProps}
        ref={setTriggerRef}
        data-slot="select"
        className={cn(TRIGGER_CLASS, className)}
      >
        <SelectPrimitive.Value placeholder={placeholder} className={VALUE_CLASS} />
        <SelectPrimitive.Icon className={ICON_CLASS}>{chevron}</SelectPrimitive.Icon>
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

export { SelectLayer };
