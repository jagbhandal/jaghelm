/**
 * Projects a raw discovered service `s` (under node `nodeKey`) into the flat
 * card shape consumed by NodeCard / custom-group panels.
 *
 * Augments the service with its Tier-3 app-data (integration metrics) when
 * available, looked up by container name in `appDataByContainer`.
 *
 * Note: this does NOT apply the "claimed by a custom group" filter — callers
 * that need it (e.g. NodePanel) filter the service list before projecting.
 */
export function toServiceCard(nodeKey, s, appDataByContainer = {}) {
  return {
    name: s.display_name,
    container: s.container,
    uid: `${nodeKey}:${s.container}`,
    node: nodeKey,
    status: s.status,
    monitored: s.monitored,
    source: s.source,
    lastSeenAt: s.lastSeenAt,
    uptime: s.uptime24,
    ping: s.ping,
    icon: s.icon,
    docker: s.docker,
    appData: appDataByContainer[s.container] || null,
  };
}
