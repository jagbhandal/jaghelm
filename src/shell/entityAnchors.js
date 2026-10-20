/**
 * Where an issue row on the Overview leads (#297), until entities have URLs of
 * their own (#309): an in-page anchor on today's board, the legacy dashboard
 * under the attention panel. A place on the board carries, as its `id`, the
 * anchor of the entity it draws, by the status model's id (docs/ARCHITECTURE.md
 * §4.7):
 *
 *   services/<node>:<container>   a service card (DraggableServiceCard)
 *   nodes/<key>                   a node's card (NodePanel)
 *   power/ups                     the UPS panel (UPSCard)
 *   jobs/<node>:<job>             a job's row in Scheduled Jobs (CronJobs)
 *
 * An issue's row leads to the first of its places the board draws: a service
 * to its card, else its node's card (a pending monitor has no card of its
 * own); a backup to its job's row, since the board lists backups as jobs.
 * Integrations, Arcane agents and monitoring sources have no place of their
 * own on the board, so their rows lead nowhere and are plain content.
 */

/**
 * The anchor of the place that draws `entityId`: the id behind a prefix, every
 * character but letters, digits and `. : / -` written as `_<hex>_`, so it is a
 * valid HTML id and URL fragment, and two ids never share one.
 */
export function entityAnchor(entityId) {
  const safe = String(entityId).replace(
    /[^A-Za-z0-9.:/-]/gu,
    (c) => `_${c.codePointAt(0).toString(16)}_`
  );
  return `entity-${safe}`;
}

/** The anchors an issue's row may lead to, best first; none for a kind with no place. */
export function anchorsOf(entity) {
  switch (entity?.kind) {
    case 'service':
    case 'container':
      return [entityAnchor(entity.id), entity.node && entityAnchor(`nodes/${entity.node}`)].filter(
        Boolean
      );
    case 'node':
    case 'ups':
    case 'job':
      return [entityAnchor(entity.id)];
    case 'backup':
      return [entityAnchor(`jobs/${entity.node}:${entity.name}`)];
    default:
      return [];
  }
}

/**
 * Moves to the first of `anchors` the page draws: focus on it, so the keyboard
 * carries on from there (only from code: a place gets `tabindex="-1"` unless it
 * has one), and its top into view, under the header (`scroll-padding-top` on
 * the page, global.css). Returns whether there was one.
 */
export function openAnchor(anchors) {
  for (const id of anchors) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'start' });
    return true;
  }
  return false;
}

/**
 * An issue row's link on the Overview: `href` to its entity's anchor and
 * `onOpen` to move there, or nothing for an entity with no place on the board.
 */
export function rowLink(entity) {
  const anchors = anchorsOf(entity);
  if (anchors.length === 0) return {};
  return { href: `#${anchors[0]}`, onOpen: () => openAnchor(anchors) };
}
