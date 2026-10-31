/**
 * The detail drawer's links (#310, spec §8: Open, Proxmox, Kuma, and config
 * shortcuts). JagHelm keeps no address for a service, Proxmox or Uptime
 * Kuma (services.yaml has none, and the monitoring sources' URLs are the
 * server's, not for a browser), so a link is one the user already has: an
 * embedded app (Settings → Apps & links), which opens inside JagHelm, or a
 * Quick Launch link (the same section's), which opens as the others do.
 *
 * A link is found by its name alone, matched exactly (letter case and spaces
 * aside), never by its icon: "Proxmox Backup Server" with Proxmox's icon is
 * not Proxmox. Every app and link of a name is
 * collected: two that reach different addresses give no link at all, since
 * either could be the wrong one (an app and a Quick Launch link to the same
 * address are one, and the app wins: it opens inside JagHelm). What is one
 * per node names its node, else it has no link:
 *
 *   Open <name>   a service's own: its name or its container's ("Immich");
 *                 when a service of that name runs on another node too
 *                 (cAdvisor on every node), the name with its node's
 *                 ("cAdvisor pi-1", "cAdvisor (Gateway)")
 *   Proxmox       a Proxmox node's: "Proxmox pve", "Proxmox (Hypervisor)",
 *                 by its key or its name, or a node named "Proxmox…" by that
 * *   Uptime Kuma   "Uptime Kuma" or "Kuma": for a service Kuma watches
 *   Settings      where the thing is set up ("Node settings"): its node, its
 *                 service, its integration or the UPS's section
 *
 * The primary button is the thing's own (Open, or Proxmox for a Proxmox
 * node), else the first of the others.
 */
import { pathTo } from '../../router/routes.js';
import { settingsHref } from '../../components/settings/sections.js';
import { SETTINGS_LINKS } from './settingsLinks.js';
import { safeUrl } from '../../utils/safeUrl.js';
import { appsOf } from '../nav.js';

/** A name as it is compared: lower case, its spaces trimmed and single. */
const nameKey = (text) =>
  String(text ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

/**
 * The user's apps and Quick Launch links, each `{ name, href, app, reaches }`:
 * `reaches` the address it opens, an app's own URL (its `href` is its page in
 * JagHelm).
 */
function linksOf(config) {
  const apps = appsOf(config?.tabs).map((a) => {
    const own = pathTo('app', { id: String(a.id) });
    // An app that opens in a new browser tab is an outside link (#362).
    const outside = a.newTab === true ? safeUrl(a.url) : null;
    return {
      name: String(a.label || a.id),
      href: outside || own,
      app: !outside,
      reaches: safeUrl(a.url) || own,
    };
  });
  const groups = config?.links;
  const quick =
    groups && typeof groups === 'object' && !Array.isArray(groups)
      ? Object.values(groups).flatMap((list) =>
          (Array.isArray(list) ? list : []).flatMap((link) => {
            const href = safeUrl(link?.url);
            if (!href || !link?.name) return [];
            return [{ name: String(link.name), href, app: false, reaches: href }];
          })
        )
      : [];
  return [...apps, ...quick];
}

/**
 * The one app or link named one of `names`, or null: none by those names, or
 * several that reach different addresses. Of an app and a link to the same
 * address, the app.
 */
function named(all, names) {
  const want = new Set(names.filter(Boolean).map(nameKey).filter(Boolean));
  const found = all.filter((l) => want.has(nameKey(l.name)));
  if (found.length === 0) return null;
  if (new Set(found.map((l) => l.reaches)).size > 1) return null;
  return found.find((l) => l.app) ?? found[0];
}

/** The names a per-node thing goes by with its node's: "cAdvisor pi-1", "cAdvisor (Gateway)". */
const withNode = (names, nodes) =>
  names
    .filter(Boolean)
    .flatMap((n) => nodes.filter(Boolean).flatMap((node) => [`${n} ${node}`, `${n} (${node})`]));

/** Whether another node runs a service of the same name or container as `entity`. */
function sharedName(status, entity, container) {
  const mine = new Set([nameKey(entity.name), nameKey(container)].filter(Boolean));
  return (status?.entities ?? []).some((e) => {
    if ((e.kind !== 'service' && e.kind !== 'container') || e.id === entity.id) return false;
    if (e.node === entity.node) return false;
    const theirs = e.id.slice(e.id.indexOf(':') + 1);
    return mine.has(nameKey(e.name)) || mine.has(nameKey(theirs));
  });
}

/**
 * The links of `entity` (the model's): `{ primary, links, settings }`, each a
 * `{ key, label, href, app }` or null; `links` a list. `status` is the model
 * (whether a service's name runs on another node too), `card` its
 * /api/services card and `nodeName` its node's name (a service's), `proxmox`
 * whether the node has a Proxmox integration, `config` the display config
 * (its apps and links).
 */
export function entityLinks({
  entity,
  status = null,
  card = null,
  nodeName = null,
  proxmox = false,
  config = null,
}) {
  const none = { primary: null, links: [], settings: null };
  if (!entity) return none;
  const all = linksOf(config);
  const kind = entity.kind;
  const as = (key, label, link) => link && { key, label, href: link.href, app: link.app };

  let own = null;
  if (kind === 'service' || kind === 'container') {
    const names = [entity.name, card?.container];
    const per = sharedName(status, entity, card?.container)
      ? withNode(names, [entity.node, nodeName])
      : names;
    own = as('open', `Open ${entity.name}`, named(all, per));
  }
  let pve = null;
  if (kind === 'node' && proxmox) {
    const names = withNode(['Proxmox'], [entity.node, entity.name]);
    if (/^proxmox\b/i.test(String(entity.name ?? '').trim())) names.push(entity.name);
    pve = as('proxmox', 'Proxmox', named(all, names));
  }
  const kuma =
    kind === 'service' && card?.monitored !== false
      ? as('kuma', 'Uptime Kuma', named(all, ['Uptime Kuma', 'Kuma']))
      : null;

  const found = [own, pve, kuma].filter(Boolean);
  // The same address twice (an app named for the service is also Proxmox's) once.
  const seen = new Set();
  const unique = found.filter((l) => !seen.has(l.href) && seen.add(l.href));
  const [first, ...rest] = unique;
  const primary = first
    ? {
        ...first,
        label: first.key === 'proxmox' ? 'Open Proxmox' : first.label,
      }
    : null;
  const [words, section, part] = SETTINGS_LINKS[kind] ?? [];
  return {
    primary,
    links: rest,
    settings: section
      ? { key: 'settings', label: words, href: settingsHref(section, part), app: true }
      : null,
  };
}
