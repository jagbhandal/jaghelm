/**
 * Where an entity id leads (#309): the status model's ids
 * (docs/ARCHITECTURE.md §4.7) are the entities' addresses. The web's URL
 * names one (`?entity=<id>`, src/shell/entityNav.js), a push names one (its
 * `entity` field, server/push/androidPayload.js), and a row opens one; each
 * lands on the same detail:
 *
 *   services/<uid>   Service detail, by the card's uid (a monitored service or
 *                    a container)
 *   nodes/<key>      Node detail, by the node's key
 *   anything else    Incident detail, by the id: the UPS (`power/ups`), a job
 *                    (`jobs/<node>:<job>`), a backup (`backups/<node>:<job>`),
 *                    an integration or Arcane agent (`integrations/…`), a
 *                    failed source (`sources/<name>`). It shows the model's
 *                    word and reason for any of them, an issue or not.
 *
 * Dependency-free, as issueRoute.js: the Android app, the web and the
 * server's cross-client suite import it.
 */

/** An id is `<subsystem>/<key>`, both parts there. */
const SHAPE = /^[a-z]+\/./;

/**
 * The nav-stack entry `{ screen, params }` that shows entity `id`, or null
 * for what is no entity id (empty, or no `<subsystem>/` before its key).
 *
 * @param {string | null | undefined} id
 */
export function entityRoute(id) {
  if (typeof id !== 'string' || !SHAPE.test(id)) return null;
  const slash = id.indexOf('/');
  const subsystem = id.slice(0, slash);
  const key = id.slice(slash + 1);
  if (subsystem === 'services') return { screen: 'serviceDetail', params: { uid: key } };
  if (subsystem === 'nodes') return { screen: 'node', params: { nodeKey: key } };
  return { screen: 'incident', params: { id } };
}

/**
 * The entity id a nav-stack entry shows, the way back from entityRoute: null
 * for a screen that shows no entity (a tab, Notification settings) or an
 * entry without its key.
 *
 * @param {{ screen?: string, params?: Record<string, any> } | null | undefined} entry
 */
export function entityOfRoute(entry) {
  const params = entry?.params ?? {};
  const named = (value) => typeof value === 'string' && value !== '';
  switch (entry?.screen) {
    case 'serviceDetail':
      return named(params.uid) ? `services/${params.uid}` : null;
    case 'node':
      return named(params.nodeKey) ? `nodes/${params.nodeKey}` : null;
    case 'incident':
      return named(params.id) ? params.id : null;
    default:
      return null;
  }
}

/**
 * The model's entity `id` names, or null when the status has none by it (it
 * was removed or renamed, or the link is old). An entity is in `entities`; a
 * failed source is an issue only (`sources/<name>`). A job's id finds it filed
 * as a backup too, as issueFor does: an older server's push names every cron
 * job `jobs/<node>:<job>`.
 *
 * @param {{ entities?: Array<{ id: string }>, issues?: Array<{ id: string }> } | null | undefined} status
 * @param {string | null | undefined} id
 */
export function entityFor(status, id) {
  if (typeof id !== 'string' || id === '' || !status) return null;
  const find = (want) =>
    (status.entities ?? []).find((e) => e.id === want) ??
    (status.issues ?? []).find((e) => e.id === want) ??
    null;
  const found = find(id);
  if (found) return found;
  return id.startsWith('jobs/') ? find(`backups/${id.slice('jobs/'.length)}`) : null;
}
