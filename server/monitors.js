/**
 * JagHelm Monitor Matcher
 * Fetches monitors from Uptime Kuma and matches them to discovered containers.
 * Replaces the broken frontend fuzzy matcher with server-side matching.
 */

const KUMA_TIMEOUT = 8000;

let kumaUrl = null;
let cachedMonitors = null;
let cacheTime = 0;
const CACHE_TTL = 15000;

export function initMonitors(url) {
  kumaUrl = url;
  console.log('[monitors] Uptime Kuma URL: %s', kumaUrl);
}

/**
 * Fetch all monitors from Uptime Kuma's status page API.
 * Returns a map of { id: { id, name, status, ping, uptime24 } }
 */
export async function fetchMonitors() {
  if (!kumaUrl) return {};

  // Return cached if fresh
  if (cachedMonitors && Date.now() - cacheTime < CACHE_TTL) {
    return cachedMonitors;
  }

  try {
    const r = await fetch(`${kumaUrl}/api/status-page/default`, {
      signal: AbortSignal.timeout(KUMA_TIMEOUT),
    });
    if (!r.ok) return cachedMonitors || {};
    const data = await r.json();

    const monitors = {};
    if (data?.heartbeatList) {
      for (const [id, beats] of Object.entries(data.heartbeatList)) {
        const latest = beats[beats.length - 1];
        const pub = data.publicGroupList
          ?.flatMap(g => g.monitorList)
          ?.find(m => m.id === parseInt(id));

        monitors[id] = {
          id: parseInt(id),
          name: pub?.name || `Monitor ${id}`,
          status: latest?.status === 1 ? 'up' : latest?.status === 0 ? 'down' : 'unknown',
          ping: latest?.ping || 0,
          uptime24: data.uptimeList?.[`${id}_24`] || 0,
        };
      }
    }

    cachedMonitors = monitors;
    cacheTime = Date.now();
    return monitors;
  } catch (err) {
    console.error('[monitors] Failed to fetch Kuma monitors:', err.message);
    return cachedMonitors || {};
  }
}

/**
 * Get a flat array of all monitor names (for Settings UI dropdowns).
 */
export async function getMonitorNames() {
  const monitors = await fetchMonitors();
  return Object.values(monitors).map(m => m.name).sort();
}

/**
 * Match a container to an Uptime Kuma monitor.
 * 
 * Matching strategy (in priority order):
 * 1. Explicit mapping from services.yaml: services[container].monitor = "Exact Name"
 * 2. Normalized name match: strip non-alphanumeric, check if one contains the other
 * 3. No match: return null
 *
 * @param containerName - Docker container name (e.g. "nginx-proxy-manager")
 * @param explicitMonitor - Explicit monitor name from config (optional)
 * @param monitors - Map of monitors from fetchMonitors()
 * @returns Monitor data or null
 */
export function matchMonitor(containerName, explicitMonitor, monitors) {
  const monitorList = Object.values(monitors);

  // Strategy 1: Explicit mapping
  if (explicitMonitor) {
    const exact = monitorList.find(
      m => m.name.toLowerCase() === explicitMonitor.toLowerCase()
    );
    if (exact) return exact;
    // Explicit name didn't match any monitor — log warning, fall through to fuzzy
    console.warn('[monitors] Explicit monitor "%s" not found for container "%s"', explicitMonitor, containerName);
  }

  // Strategy 2: Normalized name matching
  const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const cn = normalize(containerName);
  if (!cn) return null;

  // Try exact normalized match first, then containment
  let best = null;
  let bestScore = 0;

  for (const m of monitorList) {
    const mn = normalize(m.name);
    if (!mn) continue;

    // Exact normalized match — highest confidence
    if (cn === mn) return m;

    // Containment match — prefer longer overlap
    if (mn.includes(cn) || cn.includes(mn)) {
      const score = Math.min(cn.length, mn.length);
      if (score > bestScore) {
        best = m;
        bestScore = score;
      }
    }
  }

  return best;
}
