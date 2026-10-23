/**
 * The shell's navigation, as data (#296): the sidebar's groups and the phone's
 * tabs, from the open route, the embedded apps and the status. Only routes
 * whose page exists are listed (routes.js).
 *
 *   Monitor  Overview, Services, Infrastructure (#313, the mock's order),
 *            Alerts (with the issue count)
 *   Apps     one entry per embedded app (Settings → Tabs), its dot while it is
 *            loaded and not open, Unload on it; then "Add app", to Settings'
 *            Tabs section, until Settings → Apps & links (#362)
 *   Tools    Launch (Quick Launch, Pipeline, the Checklist, #301), Settings
 *
 * Phones get the spec's five tabs (§7, #303): Overview, Services,
 * Infrastructure, Alerts and More; More holds Apps and Tools. Below 768px the
 * first four are the shared phone screens (src/phone/), at the same addresses
 * as the wide pages.
 */
import { createElement as h } from 'react';
import {
  Activity,
  Bell,
  Ellipsis,
  LayoutDashboard,
  Plus,
  Rocket,
  Server,
  SlidersHorizontal,
} from 'lucide-react';
import { appMonogram } from '@ui/side-nav';
import { pathTo } from '../router/routes.js';

const icon = (Icon) => h(Icon, { 'aria-hidden': 'true' });

/** Where "Add app" goes: Settings' Tabs section, today's editor of embedded apps. */
export const ADD_APP_PATH = pathTo('settings', { section: 'tabs' });

/** The embedded apps: the config's `iframe` tabs. */
export function appsOf(tabs) {
  return (tabs || []).filter((t) => t && t.type === 'iframe' && t.id != null);
}

/**
 * The sidebar's groups.
 *
 * @param {{ routeId: string, appId?: string | null, apps: object[], loaded: Set<string>,
 *   onUnload: (id: string) => void, badge: object | null }} at
 */
export function navGroups({ routeId, appId = null, apps, loaded, onUnload, badge }) {
  const appItems = apps.map((app) => {
    const id = String(app.id);
    const current = routeId === 'app' && appId === id;
    const isLoaded = !current && loaded.has(id);
    return {
      id: `app:${id}`,
      label: app.label || id,
      href: pathTo('app', { id }),
      monogram: appMonogram(app.label || id),
      current,
      loaded: isLoaded,
      onUnload: isLoaded ? () => onUnload(app.id) : undefined,
    };
  });
  return [
    {
      id: 'monitor',
      label: 'Monitor',
      items: [
        {
          id: 'overview',
          label: 'Overview',
          href: pathTo('overview'),
          icon: icon(LayoutDashboard),
          current: routeId === 'overview',
        },
        {
          id: 'services',
          label: 'Services',
          href: pathTo('services'),
          icon: icon(Activity),
          current: routeId === 'services',
        },
        {
          id: 'infrastructure',
          label: 'Infrastructure',
          href: pathTo('infrastructure'),
          icon: icon(Server),
          current: routeId === 'infrastructure',
        },
        {
          id: 'alerts',
          label: 'Alerts',
          href: pathTo('alerts'),
          icon: icon(Bell),
          current: routeId === 'alerts',
          badge,
        },
      ],
    },
    {
      id: 'apps',
      label: 'Apps',
      items: [
        ...appItems,
        { id: 'add-app', label: 'Add app', href: ADD_APP_PATH, icon: icon(Plus), minor: true },
      ],
    },
    {
      id: 'tools',
      label: 'Tools',
      items: [
        {
          id: 'launch',
          label: 'Launch',
          href: pathTo('launch'),
          icon: icon(Rocket),
          current: routeId === 'launch',
        },
        {
          id: 'settings',
          label: 'Settings',
          href: pathTo('settings'),
          icon: icon(SlidersHorizontal),
          current: routeId === 'settings',
        },
      ],
    },
  ];
}

/** The groups the phone's More sheet holds: everything but Monitor, which has its own tabs. */
export function moreGroups(groups) {
  return groups.filter((g) => g.id !== 'monitor');
}

/** The routes the phone's tabs open (the rest are More's). */
export const PHONE_TABS = Object.freeze(['overview', 'services', 'infrastructure', 'alerts']);

/**
 * The phone's tabs, as the mock's Phone board draws them: Overview, Services,
 * Infrastructure (shown as "Infra", the board's, so five fit a 360px phone;
 * its name stays whole), Alerts, and More, which opens the sheet and is the
 * current tab on any page it holds.
 */
export function phoneTabs({ routeId, badge, onMore, moreOpen }) {
  return [
    {
      id: 'overview',
      label: 'Overview',
      href: pathTo('overview'),
      icon: icon(LayoutDashboard),
      current: routeId === 'overview',
    },
    {
      id: 'services',
      label: 'Services',
      href: pathTo('services'),
      icon: icon(Activity),
      current: routeId === 'services',
    },
    {
      id: 'infrastructure',
      label: 'Infrastructure',
      short: 'Infra',
      href: pathTo('infrastructure'),
      icon: icon(Server),
      current: routeId === 'infrastructure',
    },
    {
      id: 'alerts',
      label: 'Alerts',
      href: pathTo('alerts'),
      icon: icon(Bell),
      current: routeId === 'alerts',
      badge,
    },
    {
      id: 'more',
      label: 'More',
      icon: icon(Ellipsis),
      onClick: onMore,
      expanded: moreOpen,
      current: !PHONE_TABS.includes(routeId),
    },
  ];
}
