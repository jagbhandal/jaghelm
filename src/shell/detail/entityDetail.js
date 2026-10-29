/**
 * What the desktop's detail drawer says about one entity (#309, #310): the
 * model's state, word and reason, how long it has been so (from the header's
 * poll of /api/status), and what its kind adds from the reads the drawer
 * makes while it is open (entityExtras.js: a node's meters and Proxmox
 * lists, a service's numbers, container and integration stats, the UPS's
 * readings), then its links (detailLinks.js).
 *
 *   { status: 'loading' }       before the poll's first answer
 *   { status: 'unreachable' }   no status to read, and why (`cause`)
 *   { status: 'resolved' }      a failed monitoring source (`sources/…`)
 *                               the model no longer lists: it lists one
 *                               only while it fails, so it answers again
 *                               (#314: the Alerts page's History opens
 *                               one), as the phone's incident sheet says
 *   { status: 'gone', id }      the model has nothing by that id: it was
 *                               removed or renamed, or the link is old.
 *                               `id` is the URL's, which anyone can write:
 *                               cut to ID_MAX characters, and drawn only as
 *                               code, never as a title
 *   { status: 'found', … }      `eyebrow` (its kind), `title` (its name),
 *                               `where`, `state` (no signal while stale),
 *                               `word`, `reason`, `since`, `note` (a node's
 *                               hosted services), `meters`, `facts`,
 *                               `sections`, `unread`, `lastKnown`, `links`,
 *                               `beats`: a service's heartbeat strip
 *                               (#312), or null, and `chart`: what its
 *                               history charts read (#311), or null, and
 *                               `stack` (#642): a stack's lead as the stack
 *                               (its name, rollup state and containers), else null,
 *                               and `drives` (#728): a node's Drives block
 *                               (driveView.js), or null without drive data
 */
import { entityFor } from '../../phone/nav/entityRoute.js';
import { FRESH } from '../../phone/data/board.js';
import { sinceLine } from '../../phone/data/detail.js';
import { drawnState } from '../statusFreshness.js';
import { entityExtras } from './entityExtras.js';
import { entityLinks } from './detailLinks.js';
import { forgetTarget } from './forgetMissing.js';
import { driveTemps, driveView } from './driveView.js';

/** Each kind as the drawer's overline names it. */
const KIND = Object.freeze({
  service: 'Service',
  container: 'Container',
  node: 'Node',
  ups: 'UPS',
  job: 'Job',
  backup: 'Backup',
  integration: 'Integration',
  agent: 'Arcane agent',
  source: 'Monitoring source',
});

// services.yaml as a source (#505) is JagHelm's own configuration.
const PLACE = Object.freeze({ 'sources/config': 'Configuration' });

/** The longest an id from the URL is shown: a crafted link can't fill the drawer. */
export const ID_MAX = 64;

/**
 * A stack's detail (#642): the model's `stack` on the lead's entity, as the
 * panel draws it: `{ id, project, name, node, count, members }`, each member
 * `{ id, uid, container, name, state, word, reason, lead?, image?, where? }`.
 * `image` comes from the lead's card (/api/services), when that was read.
 */
export function stackView(entity, card, services, freshness) {
  const stack = entity.stack;
  if (!stack) return null;
  const extra = new Map((card?.stack?.members ?? []).map((m) => [m.uid, m]));
  const nodeName = services?.nodes?.[entity.node]?.display_name || entity.node;
  return {
    id: stack.id,
    project: stack.project,
    name: stack.name,
    node: entity.node,
    nodeName,
    count: stack.count,
    members: stack.members.map((m) => {
      const uid = m.id.slice('services/'.length);
      const more = extra.get(uid);
      return {
        id: m.id,
        uid,
        container: uid.slice(uid.indexOf(':') + 1),
        name: m.name,
        state: drawnState(m.state, freshness),
        word: m.word,
        reason: m.reason && m.reason !== m.word ? m.reason : null,
        ...(m.lead && { lead: true }),
        ...(more?.image && { image: more.image }),
        where: nodeName,
      };
    }),
  };
}

/** "3 of 4 containers running", or "All 4 containers running": what a stack's status adds. */
function stackNote(stack) {
  const up = stack.members.filter((m) => m.state === 'ok').length;
  return up === stack.count
    ? `All ${stack.count} containers running`
    : `${up} of ${stack.count} containers running`;
}

const capped = (id) => {
  const text = String(id ?? '');
  return text.length > ID_MAX ? `${text.slice(0, ID_MAX - 1)}…` : text;
};

/** Where the entity is, under its name: a node's host and what it is, else its node. */
function whereOf(entity, services) {
  if (entity.kind !== 'node') return entity.node ?? null;
  const subtitle = services?.nodes?.[entity.node]?.subtitle;
  return [entity.node, subtitle].filter(Boolean).join(' · ') || null;
}

/**
 * What an entity's history charts read (#311, historySeries.js): a node by
 * its key; a service or container with a container (/api/services' card) as
 * `<node>/<container>`, cAdvisor's name for it; else null, no charts.
 */
export function chartTarget(entity, card) {
  if (entity?.kind === 'node' && entity.node) {
    // A node with drive data also asks for its drives' temperatures (#728);
    // one without asks for what it always did.
    const drives = driveTemps(entity);
    return { kind: 'node', entity: entity.node, ...(drives ? { drives } : {}) };
  }
  if (
    (entity?.kind === 'service' || entity?.kind === 'container') &&
    entity.node &&
    card?.container
  ) {
    return { kind: 'container', entity: `${entity.node}/${card.container}` };
  }
  return null;
}

/**
 * @param {{ status: any, reach?: string, id: string | null, freshness?: any, at?: number | null,
 *   read?: Record<string, { body?: any, error?: string | null }>, config?: any }} args
 *   `read`: the drawer's reads (useDetailSources), `config`: the display config (its apps and links)
 */
export function entityDetail({
  status,
  reach,
  id,
  freshness = FRESH,
  at = null,
  read = {},
  config = null,
}) {
  if (!status) {
    if (reach === 'loading') return { status: 'loading' };
    return { status: 'unreachable', cause: freshness?.cause };
  }
  const entity = entityFor(status, id);
  if (!entity) {
    // A failed source is in the model only while it fails.
    if (typeof id === 'string' && id.startsWith('sources/')) return { status: 'resolved' };
    return { status: 'gone', id: capped(id) };
  }
  const services = read.services?.body ?? null;
  const extras = entityExtras({ status, entity, read, freshness, at });
  const stack = stackView(entity, extras.card, services, freshness);
  // A stack's lead is drawn as the stack: its name, its rollup's state, word
  // and reason (the model's), and its containers (#642).
  const roll = entity.stack?.rollup ?? entity;
  const named = stack ? { ...entity, name: stack.name } : entity;
  return {
    status: 'found',
    id: entity.id,
    eyebrow: stack
      ? `Stack · Compose project ${stack.project}`
      : (PLACE[entity.id] ?? KIND[entity.kind] ?? 'Entity'),
    title: named.name || entity.id,
    where: stack
      ? `${stack.nodeName === entity.node ? entity.node : `${stack.nodeName} (${entity.node})`} · ${stack.count} containers`
      : whereOf(entity, services),
    state: drawnState(roll.state, freshness),
    word: roll.word,
    // The reason, unless it only says the word again ("On mains").
    reason: roll.reason && roll.reason !== roll.word ? roll.reason : null,
    since: sinceLine(roll.since ?? entity.since, at, freshness),
    note: extras.note ?? (stack ? stackNote(stack) : null),
    meters: extras.meters,
    facts: extras.facts,
    sections: extras.sections,
    unread: extras.unread,
    lastKnown: extras.lastKnown,
    beats: extras.beats ?? null,
    beatsHistory: extras.beatsHistory ?? 'kuma',
    chart: chartTarget(entity, extras.card),
    // What a missing container's Remove acts on (#688), or null.
    forget: forgetTarget(entity, extras.card, services?.nodes?.[entity.node]),
    stack,
    // A node's drives (#728), null for any other entity or a node without drive data.
    drives: entity.kind === 'node' ? driveView(entity, freshness) : null,
    links: entityLinks({
      entity: named,
      status,
      card: extras.card,
      nodeName: extras.nodeName,
      proxmox: extras.proxmox,
      config,
    }),
  };
}
