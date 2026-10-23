/**
 * The phone's More sheet (#296): the Apps and Tools groups in a Drawer, which
 * the More tab opens, and with `onLogout`, Log out at the end of Tools (#569:
 * the phone's header holds only the brand and the theme toggle). Its own
 * chunk, loaded on the first open: the Drawer's dialog and focus trap stay
 * out of the first paint, which only a phone ever needs them after.
 */
import { LogOut } from 'lucide-react';
import { Drawer } from '@ui/drawer';
import { NavGroups } from '@ui/side-nav';
import { followLink } from '../router/useRoute.js';
import { moreGroups } from './nav.js';

/** The sheet's groups: More's, Tools ending with Log out when `logout` is given. */
function sheetGroups(groups, logout) {
  const more = moreGroups(groups);
  if (!logout) return more;
  const item = {
    id: 'logout',
    label: 'Log out',
    icon: <LogOut aria-hidden="true" />,
    onClick: logout,
  };
  return more.map((g) => (g.id === 'tools' ? { ...g, items: [...g.items, item] } : g));
}

export default function MoreSheet({ groups, open, onOpenChange, onLogout }) {
  const go = (event, href) => {
    if (followLink(event, href)) onOpenChange(false);
  };
  const logout = onLogout
    ? () => {
        onOpenChange(false);
        onLogout();
      }
    : undefined;
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="More">
      <NavGroups groups={sheetGroups(groups, logout)} onNavigate={go} />
    </Drawer>
  );
}
