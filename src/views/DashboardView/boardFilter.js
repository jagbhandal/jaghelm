/**
 * Today's board, filtered to one subsystem from the Overview's strip (#298):
 * which of its panels each subsystem keeps. The board isn't restyled; the
 * panels a filter leaves out aren't drawn, and the ones it keeps rise into the
 * space left (filterLayouts), at the top of the board.
 *
 *   services      nothing: the Services section above the board is theirs
 *                 (#300), and no panel draws a service any more
 *   nodes         the node cards (their Proxmox lists), and a saved node's
 *                 placeholder while it loads
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

/**
 * Which panels (by grid key: `node-<key>`, `ups`, `cron-jobs`, …) the board
 * keeps for `subsystem`, as a predicate; null without a filter.
 *
 * @param {string | null} subsystem
 * @returns {((key: string) => boolean) | null}
 */
export function boardSections(subsystem) {
  if (!subsystem) return null;
  switch (subsystem) {
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

/**
 * Why a filter keeps no panel on the board, for the note in its place. The
 * filter only ever names a subsystem the status model has something in, so
 * the note never says it isn't set up:
 *
 *   loading  its panel's source hasn't answered yet: a placeholder, no words
 *   off      its panel is switched off in Settings (`panel` names it)
 *   unread   its source answered, but gave the board nothing to draw (the UPS
 *            read failed, or found no UPS): the note says so, with the
 *            model's own detail for it
 *   none     today's board has no panel for it (Integrations)
 *
 * @param {string} subsystem
 * @param {{ upsHidden: boolean, upsAnswered: boolean, cronShown: boolean,
 *   servicesLoaded: boolean }} board
 * @returns {{ why: 'loading' | 'off' | 'unread' | 'none', panel?: string }}
 */
export function emptyBoardReason(subsystem, board) {
  switch (subsystem) {
    case 'power':
      if (board.upsHidden) return { why: 'off', panel: 'The UPS panel' };
      return { why: board.upsAnswered ? 'unread' : 'loading' };
    case 'jobs':
    case 'backups':
      return board.cronShown ? { why: 'unread' } : { why: 'off', panel: 'Scheduled Jobs' };
    case 'services':
    case 'nodes':
      return { why: board.servicesLoaded ? 'unread' : 'loading' };
    default:
      return { why: 'none' };
  }
}
