/**
 * Today's board, filtered to one subsystem from the Overview's strip (#298):
 * which of its panels each subsystem keeps. The board isn't restyled; the
 * panels a filter leaves out aren't drawn, and the ones it keeps rise into the
 * space left (filterLayouts), at the top of the board.
 *
 *   services      the panels that draw service cards: a node's card with any
 *                 service of its own (not moved into a group), and the
 *                 custom groups
 *   nodes         the node cards
 *   power         the UPS panel
 *   jobs, backups Scheduled Jobs, where the board lists backups as jobs
 *   integrations  nothing: the board has no section of its own for them (an
 *                 integration's numbers show on its service's card)
 *
 * A subsystem the board doesn't know keeps nothing. Pipeline, Checklist and
 * Quick Launch belong to no subsystem, so every filter leaves them out.
 */
import { compactUp } from '../../components/HelmGrid/gridMath.js';

const isNode = (key) => key.startsWith('node-');
const isGroup = (key) => key.startsWith('group-');

/**
 * Which panels (by grid key: `node-<key>`, `group-<id>`, `ups`, `cron-jobs`,
 * …) the board keeps for `subsystem`, as a predicate; null without a filter.
 * `nodesWithServices` holds the grid keys of the nodes that draw a service card.
 *
 * @param {string | null} subsystem
 * @param {{ nodesWithServices: Set<string> }} board
 * @returns {((key: string) => boolean) | null}
 */
export function boardSections(subsystem, { nodesWithServices }) {
  if (!subsystem) return null;
  switch (subsystem) {
    case 'services':
      return (key) => isGroup(key) || (isNode(key) && nodesWithServices.has(key));
    case 'nodes':
      return isNode;
    case 'power':
      return (key) => key === 'ups';
    case 'jobs':
    case 'backups':
      return (key) => key === 'cron-jobs';
    default:
      return () => false;
  }
}

/**
 * The layouts with only the panels in `keys`, at every breakpoint, each risen
 * into the space the others left (compactUp), so the filtered board has no
 * holes. It is only ever drawn: a filtered board can't be dragged or resized,
 * so this layout is never saved.
 *
 * @param {Record<string, Array<{ i: string }>>} layouts
 * @param {Set<string>} keys
 */
export function filterLayouts(layouts, keys) {
  const out = {};
  for (const [bp, items] of Object.entries(layouts)) {
    out[bp] = compactUp(items.filter((item) => keys.has(item.i)));
  }
  return out;
}
