/**
 * The detail drawer's links (#310, spec §8: Open, Grafana, Kuma, and config
 * shortcuts). JagHelm keeps no address for a service, Grafana or Uptime
 * Kuma (services.yaml has none, and the monitoring sources' URLs are the
 * server's, not for a browser), so a link is one the user already has: an
 * embedded app (Settings → Tabs), which opens inside JagHelm, else a Quick
 * Launch link (Settings → Links), which opens as the others do. Each is
 * found by its name, or a link's icon, and a thing with none has no link.
 *
 *   Open <name>   a service's own app or link, by its name or its container's
 *   Proxmox       a Proxmox node's, when the node has a Proxmox integration
 *   Grafana       for a node, a service, a container and the UPS
 *   Uptime Kuma   for a service Kuma watches
 *   Settings      where the thing is set up ("Node settings"): its node, its
 *                 service, its integration or the UPS's section
 *
 * The primary button is the thing's own (Open, or Proxmox for a Proxmox
 * node), else the first of the others, as the mock's "Open in Grafana".
 */
import { pathTo } from '../../router/routes.js';
import { safeUrl } from '../../utils/safeUrl.js';
import { appsOf } from '../nav.js';

/** A name as it is compared: lower case, letters and digits only. */
const squash = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** The user's apps and Quick Launch links, each `{ name, icon, href, app }`. */
function linksOf(config) {
  const apps = appsOf(config?.tabs).map((a) => ({
    name: String(a.label || a.id),
    icon: String(a.icon ?? ''),
    href: pathTo('app', { id: String(a.id) }),
    app: true,
  }));
  const groups = config?.links;
  const quick =
    groups && typeof groups === 'object' && !Array.isArray(groups)
      ? Object.values(groups).flatMap((list) =>
          (Array.isArray(list) ? list : []).flatMap((link) => {
            const href = safeUrl(link?.url);
            if (!href || !link?.name) return [];
            return [{ name: String(link.name), icon: String(link.icon ?? ''), href, app: false }];
          })
        )
      : [];
  return [...apps, ...quick];
}

/**
 * The first app, else Quick Launch link, whose name is one of `names`
 * (squashed, so "Uptime Kuma" is "uptimekuma") or whose icon is one of `icons`.
 */
function find(all, names, icons = []) {
  const want = new Set(names.map(squash).filter(Boolean));
  const icon = new Set(icons);
  return all.find((l) => want.has(squash(l.name)) || icon.has(l.icon)) ?? null;
}

// Where each kind is set up, in Settings: the section, and the link's words.
const SETTINGS = Object.freeze({
  node: ['nodes', 'Node settings'],
  service: ['services', 'Service settings'],
  container: ['services', 'Service settings'],
  integration: ['integrations', 'Integration settings'],
  agent: ['integrations', 'Integration settings'],
  ups: ['sections', 'UPS settings'],
});

const GRAFANA = ['node', 'service', 'container', 'ups'];

/**
 * The links of `entity` (the model's): `{ primary, links, settings }`, each a
 * `{ key, label, href, app }` or null; `links` a list. `card` is its
 * /api/services card (a service's), `proxmox` whether the node has a Proxmox
 * integration, `config` the display config (its apps and links).
 */
export function entityLinks({ entity, card = null, proxmox = false, config = null }) {
  const none = { primary: null, links: [], settings: null };
  if (!entity) return none;
  const all = linksOf(config);
  const kind = entity.kind;
  const as = (key, label, link) => link && { key, label, href: link.href, app: link.app };

  const own =
    kind === 'service' || kind === 'container'
      ? as('open', `Open ${entity.name}`, find(all, [entity.name, card?.container]))
      : null;
  const pve =
    kind === 'node' && proxmox
      ? as('proxmox', 'Proxmox', find(all, ['Proxmox', 'Proxmox VE'], ['proxmox']))
      : null;
  const grafana = GRAFANA.includes(kind)
    ? as('grafana', 'Grafana', find(all, ['Grafana'], ['grafana']))
    : null;
  const kuma =
    kind === 'service' && card?.monitored !== false
      ? as(
          'kuma',
          'Uptime Kuma',
          find(all, ['Uptime Kuma', 'Kuma'], ['uptime-kuma', 'uptimekuma', 'kuma'])
        )
      : null;

  const found = [own, pve, grafana, kuma].filter(Boolean);
  // The same address twice (an app named for the service is also Grafana's) once.
  const seen = new Set();
  const unique = found.filter((l) => !seen.has(l.href) && seen.add(l.href));
  const [first, ...rest] = unique;
  const primary = first
    ? {
        ...first,
        label:
          first.key === 'grafana'
            ? 'Open in Grafana'
            : first.key === 'proxmox'
              ? 'Open Proxmox'
              : first.label,
      }
    : null;
  const [section, words] = SETTINGS[kind] ?? [];
  return {
    primary,
    links: rest,
    settings: section
      ? { key: 'settings', label: words, href: pathTo('settings', { section }), app: true }
      : null,
  };
}
