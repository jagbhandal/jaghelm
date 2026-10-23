/**
 * What the desktop's detail drawer says about one entity (#309), from the
 * header's poll of /api/status alone: what the phone's detail screen leads
 * with, the model's state, word and reason, how long it has been so, and its
 * facts (where it is, the reading it was judged by, the UPS's runtime). The
 * full drawer, with links, charts and stats, is #310's, which replaces
 * EntityDetail.jsx; the drawer and its URL stay.
 *
 *   { status: 'loading' }       before the poll's first answer
 *   { status: 'unreachable' }   no status to read, and why (`cause`)
 *   { status: 'gone', id }      the model has nothing by that id: it was
 *                               removed or renamed, or the link is old.
 *                               `id` is the URL's, which anyone can write:
 *                               cut to ID_MAX characters, and drawn only as
 *                               code, never as a title
 *   { status: 'found', … }      `eyebrow` (its kind), `title` (its name),
 *                               `where`, `state` (no signal while stale),
 *                               `word`, `reason`, `since`, `facts`
 */
import { entityFor } from '../../phone/nav/entityRoute.js';
import { FRESH, upsReadingsOf } from '../../phone/data/board.js';
import { sinceLine } from '../../phone/data/detail.js';
import { drawnState } from '../statusFreshness.js';

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

// A judged reading's name (status/rules.js: node metrics, pools, the UPS's charge).
const READING = Object.freeze({
  cpu: 'CPU',
  mem: 'Memory',
  disk: 'Disk',
  temp: 'Temperature',
  charge: 'Charge',
});

function readingFact(metric) {
  if (!metric || metric.value == null) return null;
  const name = String(metric.name ?? '');
  const label = name.startsWith('pool:')
    ? `Storage pool ${name.slice('pool:'.length)}`
    : (READING[name] ?? name);
  const unit = metric.unit ? ` ${metric.unit}` : '';
  return { key: 'reading', label, value: `${metric.value}${unit}` };
}

/** The longest an id from the URL is shown: a crafted link can't fill the drawer. */
export const ID_MAX = 64;

const capped = (id) => {
  const text = String(id ?? '');
  return text.length > ID_MAX ? `${text.slice(0, ID_MAX - 1)}…` : text;
};

/**
 * @param {{ status: any, reach?: string, id: string | null, freshness?: any, at?: number | null }} args
 */
export function entityDetail({ status, reach, id, freshness = FRESH, at = null }) {
  if (!status) {
    if (reach === 'loading') return { status: 'loading' };
    return { status: 'unreachable', cause: freshness?.cause };
  }
  const entity = entityFor(status, id);
  if (!entity) return { status: 'gone', id: capped(id) };
  const where = entity.kind === 'node' ? null : (entity.node ?? null);
  const facts = [
    where && { key: 'node', label: 'Node', value: where },
    entity.kind === 'ups'
      ? (() => {
          const runtime = upsReadingsOf({ status, freshness });
          return runtime && { key: 'runtime', label: 'Runtime', value: runtime };
        })()
      : null,
    readingFact(entity.metric),
  ].filter(Boolean);
  return {
    status: 'found',
    id: entity.id,
    eyebrow: PLACE[entity.id] ?? KIND[entity.kind] ?? 'Entity',
    title: entity.name || entity.id,
    where,
    state: drawnState(entity.state, freshness),
    word: entity.word,
    // The reason, unless it only says the word again ("On mains").
    reason: entity.reason && entity.reason !== entity.word ? entity.reason : null,
    since: sinceLine(entity.since, at, freshness),
    facts,
  };
}
