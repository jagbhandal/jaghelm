/**
 * The config drift row (#674), the Overview's section after Services (it moves
 * and hides in Edit layout like the others, `configDrift`) and the same row on
 * the phone's Overview. Its own chunk (lazyViews.js, loadConfigDrift), asked for
 * through ConfigDriftSlot; it reads /api/drift itself (drift.js), so a page that
 * never draws it never asks.
 *
 * Draws nothing when the feature is off (no JAGHELM_CRON_SECRET on the server) or
 * before the first answer. Read-only; nothing here alerts. The drawing is the
 * design system's (src/ui/config-drift.jsx).
 */
import { memo } from 'react';
import { ConfigDrift as ConfigDriftView } from '@ui/config-drift';
import { useConfig } from '../context/ConfigContext.jsx';
import { driftView, useDrift } from './drift.js';

export default memo(function ConfigDrift({ phone = false, margin = 16, active = true }) {
  const { config } = useConfig();
  const got = useDrift({ active });
  const view = got && driftView(got.body, config, got.serverNow + (Date.now() - got.localAt));
  if (!view) return null;
  return <ConfigDriftView view={view} phone={phone} margin={margin} />;
});
