/**
 * The expiry tracker (#676), the Overview's section after Services (it moves
 * and hides in Edit layout like the others, `expiry`) and the same list on the
 * phone's Overview. Its own chunk (lazyViews.js, loadExpiry), asked for through
 * ExpirySlot when either Overview draws it; it reads /api/expiry itself
 * (expiry.js), so a page that never draws it never asks.
 *
 * Draws nothing until there is something to say (expiryView): no TLS target
 * and no Tailscale key set up, or not read yet. Read-only; nothing here alerts
 * or changes a status. The drawing is the design system's (src/ui/expiry.jsx).
 */
import { memo } from 'react';
import { Expiry as ExpiryView } from '@ui/expiry';
import { useConfig } from '../context/ConfigContext.jsx';
import { expiryLines, expiryView, useExpiry } from './expiry.js';

// The phone's list is short: four rows, then a button for the rest.
const PHONE_ROWS = 4;
const DESKTOP_ROWS = 10;

/**
 * `phone`: the phone Overview's list section; otherwise the desktop section
 * (lined up with the others by `margin`).
 */
export default memo(function Expiry({ phone = false, margin = 16, active = true }) {
  const { config } = useConfig();
  const body = useExpiry({ active });
  const view = expiryView(body, expiryLines(config));
  if (!view) return null;
  return (
    <ExpiryView view={view} phone={phone} margin={margin} limit={phone ? PHONE_ROWS : DESKTOP_ROWS} />
  );
});
