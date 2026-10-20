/*
 * UiRoot (#286): the root of a screen of the new UI. It renders the `.jh-ui`
 * element with the screen's switches (docs/design-system.md, "Switches"):
 * `theme` (dark, light), `accent` (violet, fuchsia, cyan), `density`
 * (comfortable, compact) and `typeface` (manrope, plus-jakarta-sans,
 * montserrat). A default sets no attribute, as tokens.css reads none as the
 * default.
 *
 * It also gives them to everything portalled from the screen (lib/portal.js):
 * an overlay opened from a control copies the root around that control, but
 * a toast, or a dialog opened from code or from outside the new UI, has no
 * control to read, and would otherwise fall back to the dark defaults, wrong
 * in light or compact. Every portal root reads them again when they change,
 * so an open dialog follows the screen into light.
 *
 * It holds the screen's toasts (toast.jsx; `useToast()` anywhere inside) and
 * the tooltips' shared timing (once one tooltip is open, the next opens at
 * once). `toastManager` (createToastManager()) lets code outside React queue
 * toasts here. Any other prop goes to the element.
 */
import { useMemo } from 'react';
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { ToastProvider } from './toast.jsx';
import { cn } from './lib/utils.js';
import { ROOT_CLASS, RootSwitchesContext, switchAttributes } from './lib/portal.js';

function UiRoot({ theme, accent, density, typeface, toastManager, className, children, ...props }) {
  const switches = useMemo(
    () => switchAttributes({ theme, accent, density, typeface }),
    [theme, accent, density, typeface]
  );
  return (
    <RootSwitchesContext.Provider value={switches}>
      <TooltipPrimitive.Provider>
        <ToastProvider toastManager={toastManager}>
          <div data-slot="ui-root" {...props} {...switches} className={cn(ROOT_CLASS, className)}>
            {children}
          </div>
        </ToastProvider>
      </TooltipPrimitive.Provider>
    </RootSwitchesContext.Provider>
  );
}

export { UiRoot };
