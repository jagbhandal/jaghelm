/**
 * An edit of services.yaml's `stacks:` made from a stack's detail (#642): the
 * panel's Set lead, Ungroup and Split out. The same file Settings → Nodes &
 * Services writes, by the same pure functions (servicesConfig.js), but one edit
 * at a time and sent at once: read the config, change it, save it over the
 * version read (If-Match, #423). A config changed elsewhere meanwhile refuses
 * the save, which says so, and nothing is lost. The board takes the new
 * grouping at its next refresh.
 */
import { apiFetch, isReadOnlyServer } from '../../api/client.js';
import { readServerConfig } from '../../components/settings/readServerConfig.js';
import {
  withStackLead,
  withStackSplit,
  withStackUngroup,
} from '../../components/settings/servicesConfig.js';

const TIMEOUT_MS = 15_000;

/**
 * Applies `change` to the stored config and saves it. Resolves when saved;
 * rejects with an Error whose message is in words for the screen.
 *
 * @param {(config: any) => any} change
 */
export async function editStacks(change) {
  if (isReadOnlyServer()) throw new Error('This server is read-only, so it keeps no change.');
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const got = await readServerConfig({ signal });
  if ('error' in got) throw new Error(got.error);
  const headers = { 'Content-Type': 'application/json' };
  if (got.version) headers['If-Match'] = got.version;
  let r;
  try {
    r = await apiFetch('/api/services/config', {
      method: 'POST',
      headers,
      body: JSON.stringify(change(got.config)),
      signal,
    });
  } catch (err) {
    throw new Error(
      err?.name === 'TimeoutError'
        ? "The server didn't answer in time."
        : String(err?.message ?? err)
    );
  }
  if (r.ok) return;
  const data = await r.json().catch(() => ({}));
  if (r.status === 409 && data?.stale === true) {
    throw new Error('Settings changed elsewhere. Try again.');
  }
  throw new Error(data?.error || `HTTP ${r.status}`);
}

/** The container name of a service uid, `<node>:<container>`. */
export const containerOf = (uid) => uid.slice(uid.indexOf(':') + 1);

/** The edits the panel makes, for a stack of `node` and `project`. */
export const stackEdit = {
  lead: (node, project, container) => editStacks((c) => withStackLead(c, node, project, container)),
  ungroup: (node, project) => editStacks((c) => withStackUngroup(c, node, project, true)),
  split: (node, project, container) =>
    editStacks((c) => withStackSplit(c, node, project, container, true)),
};
