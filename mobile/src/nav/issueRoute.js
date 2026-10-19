/**
 * Where an Overview issue row leads: a nav-stack entry { screen, params } for
 * the detail screen of what the row refers to, or null when there is nothing
 * to open (the row then renders as plain, non-interactive content).
 *
 * Identity comes from what deriveIncidents carries, never from display text:
 * the target's kind plus its key (service uid, node key), or the incident id,
 * which deriveIncidents builds from kind + key (`cron:{node}:{job}`). Two
 * services or jobs that share a name therefore open their own detail.
 *
 * - service (down or tracked-unknown) → Service detail, by uid
 * - node → Node detail, by node key. deriveIncidents emits no node rows today
 *   (a hot node shows only in the hero and the Nodes cell); this is here so a
 *   node row opens the screen that exists for it.
 * - UPS, cron → Incident detail, by incident id. The app has no UPS or cron job
 *   screen; Incident detail is the screen Alerts opens for the same incident,
 *   and it shows the cause the compact row leaves out.
 */
export function issueRoute(incident) {
  const target = incident && incident.target;
  if (!target) return null;
  switch (target.kind) {
    case 'service':
      return target.uid ? { screen: 'serviceDetail', params: { uid: target.uid } } : null;
    case 'node':
      return target.nodeKey ? { screen: 'node', params: { nodeKey: target.nodeKey } } : null;
    case 'ups':
    case 'cron':
      return incident.id ? { screen: 'incident', params: { id: incident.id } } : null;
    default:
      return null;
  }
}
