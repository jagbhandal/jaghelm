/**
 * The phone's More sheet (#296): the Apps and Tools groups in a Drawer, which
 * the More tab opens. Its own chunk, loaded on the first open: the Drawer's
 * dialog and focus trap stay out of the first paint, which only a phone ever
 * needs them after.
 */
import { Drawer } from '@ui/drawer';
import { NavGroups } from '@ui/side-nav';
import { followLink } from '../router/useRoute.js';
import { moreGroups } from './nav.js';

export default function MoreSheet({ groups, open, onOpenChange }) {
  const go = (event, href) => {
    if (followLink(event, href)) onOpenChange(false);
  };
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="More">
      <NavGroups groups={moreGroups(groups)} onNavigate={go} />
    </Drawer>
  );
}
