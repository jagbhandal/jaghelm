/*
 * The floating layer (#444): every Base UI popup in src/ui/, in one chunk that
 * lib/floating.jsx loads on first use. Each export is the Base UI part of the
 * component in src/ui/ that draws until this loads: ../tooltip.jsx,
 * ../popover.jsx, ../select.jsx, ../dialog.jsx, ../drawer.jsx, ../confirm.jsx
 * and ../sparkline.jsx, and the UptimeBar's tooltip and keys (../uptime-bar.jsx,
 * #312). A new floating component joins it here
 * (docs/design-system.md, "The floating layer").
 */
export { TooltipLayer } from './tooltip.jsx';
export { PopoverLayer, PopoverClose } from './popover.jsx';
export { SelectLayer } from './select.jsx';
export { DialogLayer, DialogClose } from './dialog.jsx';
export { DrawerLayer } from './drawer.jsx';
export { ConfirmLayer } from './confirm.jsx';
export { SparklineTip } from './sparkline-tip.jsx';
export { UptimeBarTips } from './uptime-bar-tips.jsx';
