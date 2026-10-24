/*
 * UiRoot (#286): the root of a screen of the new UI. It renders the `.jh-ui`
 * element with the screen's switches (docs/design-system.md, "Switches"):
 * `theme` (dark, light), `accent` (violet, fuchsia, cyan), `density`
 * (comfortable, compact) and `typeface` (manrope, plus-jakarta-sans,
 * montserrat). A default sets no attribute, as tokens.css reads none as the
 * default.
 *
 * It also gives them to everything portalled from the screen (lib/portal.js),
 * which would otherwise fall back to the dark defaults, wrong in light or
 * compact: a toast or a dialog opened from code has no control to read, and an
 * overlay opened from another overlay would read its parent's portal root.
 * Every portal root reads them again when they change, so an open dialog, and
 * a list open inside it, follows the screen into light.
 *
 * It holds the screen's toasts (toast.jsx; `useToast()` anywhere inside) and
 * the tooltips' shared timing (once one tooltip is open, the next opens at
 * once). `toastManager` (createToastManager()) lets code outside React queue
 * toasts here. A custom theme (#331) arrives as `themeVars`, its colours as
 * custom properties (`{ '--jh-bg': 'oklch(...)' }`, written by
 * server/themes.js's validator), set on the root's style and handed to the
 * portals like a switch. Roots can nest, in any theme (a gallery of states in light and
 * dark): one inside another shares the outer one's toasts and tooltip timing,
 * and a page shows one toast viewport however many roots it holds. Any other
 * prop goes to the element.
 */
import { useContext, useMemo } from 'react';
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { ToastProvider } from './toast.jsx';
import { cn } from './lib/utils.js';
import { ROOT_CLASS, RootSwitchesContext, switchAttributes } from './lib/portal.js';

function UiRoot({
  theme,
  accent,
  density,
  typeface,
  themeVars,
  toastManager,
  className,
  style,
  children,
  ...props
}) {
  const nested = useContext(RootSwitchesContext) != null;
  const attributes = useMemo(
    () => switchAttributes({ theme, accent, density, typeface }),
    [theme, accent, density, typeface]
  );
  const switches = useMemo(() => ({ ...attributes, themeVars }), [attributes, themeVars]);
  const rootStyle = useMemo(
    () => (themeVars || style ? { ...style, ...themeVars } : undefined),
    [style, themeVars]
  );
  const root = (
    <div
      data-slot="ui-root"
      {...props}
      {...attributes}
      style={rootStyle}
      className={cn(ROOT_CLASS, className)}
    >
      {children}
    </div>
  );
  return (
    <RootSwitchesContext.Provider value={switches}>
      <ToastProvider toastManager={toastManager}>
        {nested ? root : <TooltipPrimitive.Provider>{root}</TooltipPrimitive.Provider>}
      </ToastProvider>
    </RootSwitchesContext.Provider>
  );
}

export { UiRoot };
