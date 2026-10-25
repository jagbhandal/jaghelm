/**
 * The Backups section (#675), the Overview's section after Services (it moves
 * and hides in Edit layout like the others, `backupFreshness`) and the same
 * list on the phone's Overview. Its own chunk (lazyViews.js, loadBackups),
 * asked for through BackupsSlot when either Overview draws it; it reads
 * /api/backups itself (backups.js), so a page that never draws it never asks.
 *
 * Draws nothing until there is something to say (backupsView): not read yet,
 * no backup job marked and no B2 key. Read-only; nothing here alerts. The
 * drawing is the design system's (src/ui/backups.jsx).
 */
import { memo } from 'react';
import { Backups as BackupsView } from '@ui/backups';
import { useConfig } from '../context/ConfigContext.jsx';
import { backupsView, useBackups } from './backups.js';

export default memo(function Backups({ phone = false, margin = 16, active = true }) {
  const { config } = useConfig();
  const body = useBackups({ active });
  const view = backupsView(body, config);
  if (!view) return null;
  return <BackupsView view={view} phone={phone} margin={margin} />;
});
