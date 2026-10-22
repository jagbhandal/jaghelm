/**
 * Where an issue row leads, and which issue an id names (#279, #325).
 *
 * An issue is one of the status model's (/api/status `issues`), named by its
 * entity id (docs/ARCHITECTURE.md §4.7): `services/<uid>`, `nodes/<key>`,
 * `power/ups`, `jobs/<node>:<job>`, `backups/<node>:<job>`, `integrations/…`,
 * `sources/<name>`. Identity is that id, never display text, so two services
 * or jobs that share a name open their own detail.
 *
 * Dependency-free: the server's cross-client suite imports it to check that a
 * tapped push opens the entity it is about (server/status/crossClient.test.js).
 */

/**
 * The nav-stack entry `{ screen, params }` for a row (board.js issueRowsOf),
 * or null when there is nothing to open (the row then renders as plain,
 * non-interactive content):
 *
 * - a service or container → Service detail, by uid
 * - a node → Node detail, by node key
 * - anything else the model ranks (the UPS, a job, a backup, an integration,
 *   an Arcane agent, a failed source) → Incident detail, by the entity id:
 *   the app has no screen of their own, and Incident detail shows the
 *   model's word and reason for them.
 */
export function issueRoute(incident) {
  const target = incident && incident.target;
  if (!target) return null;
  switch (target.kind) {
    case 'service':
      return target.uid ? { screen: 'serviceDetail', params: { uid: target.uid } } : null;
    case 'node':
      return target.nodeKey ? { screen: 'node', params: { nodeKey: target.nodeKey } } : null;
    case 'incident':
      return incident.id ? { screen: 'incident', params: { id: incident.id } } : null;
    default:
      return null;
  }
}

/**
 * The model's issue named `id`, or null when it isn't one now (resolved, or
 * never was). A job's id finds it filed as a backup too: a push about a job
 * names it `jobs/<node>:<job>` whether or not the model counts it as a backup
 * (`backupJobs`, #291), since the push's data doesn't say.
 *
 * @param {{ issues?: Array<{ id: string }> } | null | undefined} status
 * @param {string | null | undefined} id
 */
export function issueFor(status, id) {
  if (typeof id !== 'string' || id === '') return null;
  const issues = status?.issues ?? [];
  const found = issues.find((i) => i.id === id);
  if (found) return found;
  if (id.startsWith('jobs/')) {
    const backup = `backups/${id.slice('jobs/'.length)}`;
    return issues.find((i) => i.id === backup) ?? null;
  }
  return null;
}
