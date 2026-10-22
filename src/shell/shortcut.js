/** "⌘K" on Apple platforms, "Ctrl K" elsewhere: the header's and Quick Launch's (#301). */
export function shortcutLabel() {
  const platform = globalThis.navigator?.userAgentData?.platform ?? globalThis.navigator?.platform;
  return /mac|iphone|ipad/i.test(platform ?? '') ? '⌘K' : 'Ctrl K';
}
