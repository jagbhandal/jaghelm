/*
 * Tabs (spec §5.4, #285): views of one thing, one at a time, such as a
 * drawer's sections. The mock draws none, so they follow §5.2's accent rule:
 * the active tab's label is accent-text over a 2px accent bar that sits on the
 * list's subtle bottom edge; the others are text-2, text-1 under the pointer.
 * Tabs are h-control tall (34px, 30 in compact), and their focus ring is inset
 * so it stays clear of the neighbouring tab.
 *
 * Base UI's Tabs give the tabs pattern: the arrow keys, Home and End move
 * between tabs (skipping disabled ones), Tab moves on to the panel, and ARIA
 * ties each tab to its panel. A tab shows its panel as soon as it has focus;
 * pass activateOnFocus={false} to TabList to wait for Enter or Space, for
 * panels that load something.
 */
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from './lib/utils.js';

function Tabs({ className, ...props }) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-4', className)}
      {...props}
    />
  );
}

function TabList({ className, activateOnFocus = true, ...props }) {
  return (
    <TabsPrimitive.List
      data-slot="tab-list"
      activateOnFocus={activateOnFocus}
      className={cn('flex items-center gap-1 border-b border-border', className)}
      {...props}
    />
  );
}

function Tab({ className, ...props }) {
  return (
    <TabsPrimitive.Tab
      data-slot="tab"
      className={cn(
        'relative inline-flex h-control cursor-pointer items-center gap-2 rounded-md px-3 text-body-sm font-semibold whitespace-nowrap text-text-2 transition-colors -outline-offset-2 after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full not-data-active:not-data-disabled:hover:text-text-1 data-active:text-accent-text data-active:after:bg-accent data-disabled:cursor-not-allowed data-disabled:opacity-55 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.75]',
        className
      )}
      {...props}
    />
  );
}

function TabPanel({ className, ...props }) {
  return (
    <TabsPrimitive.Panel data-slot="tab-panel" className={cn('min-w-0', className)} {...props} />
  );
}

export { Tabs, TabList, Tab, TabPanel };
