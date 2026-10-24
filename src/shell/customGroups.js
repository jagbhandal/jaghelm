/**
 * The custom groups of Settings → Nodes & Services (#517), read one way by Settings
 * and by the Overview's Services section (servicesView.js), which groups by
 * them.
 *
 * A group is `{ id, title, containers }` in the display config's
 * `customGroups`. `containers` lists the services it holds by uid, the key
 * the status model and /api/services give a service, `<node>:<name>`: so
 * `adguard-home` on two Pis is two services, `pi-1:adguard-home` and
 * `pi-2:adguard-home`, and a Kuma monitor no container answers to
 * (`pi-1:Home Assistant`) can be grouped too. The key keeps its old name, so
 * a tab still on an older build reads the groups as they are.
 *
 * Before #517, Settings saved bare container names (`adguard-home`). An entry
 * that is the uid of a service is that service; any other is a name, and
 * holds every service of that name, as it always did. Settings writes the
 * groups back as uids the next time it saves one (migrateGroups): each name
 * as the uids of the services it holds then, a name that holds none dropped.
 * An entry on a node the server knows stays as it is while no service has it
 * (a node with no signal). That needs the whole list: while any node's
 * containers went unread, a node is hidden in services.yaml, a source is down
 * or a list didn't come (groupChoices' `complete` false), a name stays as it
 * is beside the uids it holds, and an entry that holds nothing stays too, so
 * a save never loses a service it can't see.
 *
 * A group has no icon, colour or hidden flag any more (DEAD_GROUP_KEYS): the
 * icon and colour drew nothing since #295, and a hidden group could hide a
 * down service. They and the old board's `sections['group-<id>']` are left
 * out of every copy of the display config a device reads, and so out of its
 * next save (dropDeadGroupKeys, in useConfigPersistence), never counted as an
 * edit of its own: a device that only loads sends nothing, and can't undo
 * another device's group edit in a rebase (#547).
 */

const PREFIX = 'services/';
const SERVICE_KINDS = new Set(['service', 'container']);

/** A group's keys nothing reads: its icon and colour, and `hidden`. */
export const DEAD_GROUP_KEYS = Object.freeze(['icon', 'borderColor', 'hidden']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A group's saved entries, the strings of its `containers`. */
export function groupEntries(group) {
  const list = group?.containers;
  return Array.isArray(list) ? list.filter((e) => typeof e === 'string') : [];
}

/** Whether `node` (an /api/services node) had every reading this cycle. */
const allRead = (node) =>
  node?.reachable !== false && !(Array.isArray(node?.failedReads) && node.failedReads.length > 0);

/**
 * Whether the list is every service there is: the status and /api/services
 * came, Prometheus and Kuma answered, every node was read, and services.yaml
 * (`serverConfig`, /api/services/config) came with no node hidden or unlisted.
 */
function wholeList(entities, nodeMap, services, serverConfig) {
  if (!entities || !nodeMap) return false;
  if (services?.sources?.prometheus?.ok === false || services?.sources?.kuma?.ok === false)
    return false;
  if (!Object.values(nodeMap).every(allRead)) return false;
  const configured = serverConfig?.nodes;
  if (!isObject(configured)) return false;
  return Object.entries(configured).every(
    ([key, cfg]) => cfg?.visible !== false && Object.hasOwn(nodeMap, key)
  );
}

/**
 * The services a group can hold, the nodes the server knows, and whether that
 * is every service: `{ services: [{ uid, container, name, node, nodeName }],
 * nodes: Set, complete }`. Every service the status model has (a Kuma monitor
 * with no card too), in its order, then any card of /api/services the model
 * doesn't have; null when neither answered, so nothing is read or rewritten
 * against an empty list. `complete` (wholeList) is what lets a save drop a
 * name.
 *
 * @param {{ status?: any, services?: any, serverConfig?: any }} board
 */
export function groupChoices({ status = null, services = null, serverConfig = null }) {
  const entities = Array.isArray(status?.entities) ? status.entities : null;
  const nodeMap = isObject(services?.nodes) ? services.nodes : null;
  if (!entities && !nodeMap) return null;
  const nodeName = (key) => nodeMap?.[key]?.display_name || key || null;
  const cards = new Map();
  for (const [key, node] of Object.entries(nodeMap ?? {})) {
    for (const card of Array.isArray(node?.services) ? node.services : []) {
      if (card && typeof card.uid === 'string') cards.set(card.uid, { card, node: key });
    }
  }
  const list = [];
  const seen = new Set();
  for (const e of entities ?? []) {
    if (e?.subsystem !== 'services' || !SERVICE_KINDS.has(e.kind) || typeof e.id !== 'string')
      continue;
    const uid = e.id.startsWith(PREFIX) ? e.id.slice(PREFIX.length) : e.id;
    const card = cards.get(uid)?.card;
    seen.add(uid);
    list.push({
      uid,
      container: card?.container ?? uid.slice(uid.indexOf(':') + 1),
      name: String(e.name ?? uid),
      ...(e.monitorOnly === true || card?.source === 'monitor' ? { monitorOnly: true } : {}),
      node: e.node ?? null,
      nodeName: nodeName(e.node),
    });
  }
  for (const [uid, { card, node }] of cards) {
    if (seen.has(uid)) continue;
    list.push({
      uid,
      container: card.container ?? uid.slice(uid.indexOf(':') + 1),
      name: String(card.display_name || card.container || uid),
      ...(card.source === 'monitor' ? { monitorOnly: true } : {}),
      node,
      nodeName: nodeName(node),
    });
  }
  const nodes = new Set(Object.keys(nodeMap ?? {}));
  for (const e of entities ?? []) if (typeof e?.node === 'string') nodes.add(e.node);
  if (isObject(serverConfig?.nodes)) {
    for (const key of Object.keys(serverConfig.nodes)) nodes.add(key);
  }
  return {
    services: list,
    nodes,
    complete: wholeList(entities, nodeMap, services, serverConfig),
  };
}

/**
 * The services an entry holds: the one with that uid, else every one of that
 * name. An entry `<node>:<name>` that is no service's uid is, last, the Kuma
 * monitor of that name that no container carries, wherever it is now (#644:
 * such a monitor moves to another node, and its uid with it).
 */
function servicesOf(entry, services, uids) {
  if (uids.has(entry)) return [entry];
  const byName = services.filter((s) => s.container === entry).map((s) => s.uid);
  if (byName.length > 0) return byName;
  const i = entry.indexOf(':');
  if (i <= 0) return [];
  const name = entry.slice(i + 1);
  return services
    .filter((s) => s.monitorOnly === true && (s.uid.slice(s.uid.indexOf(':') + 1) === name || s.container === name))
    .map((s) => s.uid);
}

/**
 * The uids of the services `group` holds, of `services` (each `{ uid,
 * container }`): in the group's order, each once.
 */
export function heldUids(group, services) {
  const uids = new Set(services.map((s) => s.uid));
  const out = new Set();
  for (const entry of groupEntries(group)) {
    for (const uid of servicesOf(entry, services, uids)) out.add(uid);
  }
  return [...out];
}

/** The entries of `group` that hold no service of `services`. */
export function unmatchedEntries(group, services) {
  const uids = new Set(services.map((s) => s.uid));
  return groupEntries(group).filter((entry) => servicesOf(entry, services, uids).length === 0);
}

/** `group` without its dead keys, or the same object when it has none. */
function withoutDead(group) {
  if (!isObject(group) || !DEAD_GROUP_KEYS.some((k) => Object.hasOwn(group, k))) return group;
  const rest = { ...group };
  for (const k of DEAD_GROUP_KEYS) delete rest[k];
  return rest;
}

/** `groups` without their dead keys: the same array when none has one. */
export function withoutDeadGroupKeys(groups) {
  if (!Array.isArray(groups)) return groups;
  const next = groups.map(withoutDead);
  return next.some((g, i) => g !== groups[i]) ? next : groups;
}

/** The old board's panel settings for each of `groups`, `sections['group-<id>']`, that `sections` has. */
const groupPanelKeys = (sections, groups) =>
  !isObject(sections) || !Array.isArray(groups)
    ? []
    : groups
        .map((g) => (isObject(g) ? `group-${g.id}` : null))
        .filter((key) => key && Object.hasOwn(sections, key));

/**
 * The display config without a custom group's dead keys (DEAD_GROUP_KEYS) or
 * the old board's panel settings for a group (`sections['group-<id>']`, where
 * a group was hidden): the same object when it has none. useConfigPersistence
 * reads every copy through it (see the top).
 */
export function dropDeadGroupKeys(config) {
  if (!isObject(config)) return config;
  const groups = withoutDeadGroupKeys(config.customGroups);
  const panels = groupPanelKeys(config.sections, config.customGroups);
  if (groups === config.customGroups && panels.length === 0) return config;
  const next = { ...config };
  if (groups !== config.customGroups) next.customGroups = groups;
  if (panels.length > 0) {
    next.sections = { ...config.sections };
    for (const key of panels) delete next.sections[key];
  }
  return next;
}

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * `groups` as Settings saves them (see the top): each entry a uid, without
 * the dead keys; with a list that isn't `complete`, each name kept beside the
 * uids it holds, and an entry that holds nothing kept. The same array, and
 * each group unchanged the same object, when there is nothing to rewrite, so
 * a second pass changes nothing. With no choices (none read) or no node
 * known, the groups as they are.
 *
 * @param {Array<any>} groups
 * @param {{ services: Array<{ uid: string, container: string }>, nodes: Set<string>,
 *   complete: boolean } | null} choices
 */
export function migrateGroups(groups, choices) {
  if (!Array.isArray(groups) || !choices || choices.nodes.size === 0) return groups;
  const { services, nodes, complete } = choices;
  const uids = new Set(services.map((s) => s.uid));
  const onKnownNode = (entry) => {
    const i = entry.indexOf(':');
    return i > 0 && nodes.has(entry.slice(0, i));
  };
  const next = groups.map((group) => {
    if (!isObject(group)) return group;
    const out = new Set();
    for (const entry of groupEntries(group)) {
      const held = servicesOf(entry, services, uids);
      // A name stays while the list may be missing some of its services.
      if (!complete && !uids.has(entry)) out.add(entry);
      for (const uid of held) out.add(uid);
      if (held.length === 0 && onKnownNode(entry)) out.add(entry);
    }
    const containers = [...out];
    const live = withoutDead(group);
    const same = Array.isArray(group.containers) && sameList(group.containers, containers);
    if (same) return live;
    return { ...live, containers };
  });
  return next.some((g, i) => g !== groups[i]) ? next : groups;
}

/**
 * The uids `group` holds through a name (an entry that is no service's uid),
 * whether or not by their own uid too. While the list isn't complete the name
 * is kept (migrateGroups), so Settings can't take one of these out.
 */
export function heldByName(group, services) {
  const uids = new Set(services.map((s) => s.uid));
  const out = new Set();
  for (const entry of groupEntries(group)) {
    if (uids.has(entry)) continue;
    for (const uid of servicesOf(entry, services, uids)) out.add(uid);
  }
  return [...out];
}
