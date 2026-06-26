/**
 * Pure parser for the custom-scheme deep link (DESIGN line 307):
 *   jaghelm://incident/<fcmId>?type=<t>&node=<n>&severity=<s>
 * This is the PRIMARY OSS-build deep-link path (verified https App Links need a
 * per-self-hoster assetlinks.json). It reassembles the FCM `data` shape and
 * delegates to routeFromData so the SAME id-reconciler + fallback logic runs as
 * the pushNotificationActionPerformed (tray-tap) path.
 *
 * Defensive: anything that is not a jaghelm://incident/<id> link is a no-op.
 *
 * @param {string} url  the appUrlOpen url
 * @param {{ push: Function }} nav
 */
import { routeFromData } from './routeFromData.js';

const PREFIX = 'jaghelm://incident/';

export function routeFromUrl(url, nav) {
  if (typeof url !== 'string' || !url.startsWith(PREFIX)) return;
  const rest = url.slice(PREFIX.length); // "<id>?type=...&..."
  const qIdx = rest.indexOf('?');
  const idRaw = qIdx === -1 ? rest : rest.slice(0, qIdx);
  if (!idRaw) return;
  let id;
  try {
    id = decodeURIComponent(idRaw);
  } catch {
    id = idRaw;
  }
  const params = new URLSearchParams(qIdx === -1 ? '' : rest.slice(qIdx + 1));
  routeFromData(
    {
      type: params.get('type') || undefined,
      id,
      node: params.get('node') || undefined,
      severity: params.get('severity') || undefined,
    },
    nav,
  );
}
