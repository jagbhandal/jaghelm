/**
 * The reads an open detail makes beyond the status (#310): `wanted` (of
 * services, integrations, ups; entityExtras.js sourcesFor) as the detail
 * opens, then again each time the header's status poll answers (`updated`,
 * useStatus: a 304 too), and nothing while it is closed (`wanted` empty). The
 * poll pauses in a hidden tab, so these do too.
 *
 * The page may read the same addresses on its own tick (today's board reads
 * /api/services, /api/integrations and /api/ups on the Overview). A detail
 * then asks nothing: it takes the page's answer (useData.js lastAnswer) when
 * one came since its own last read, and within an interval and a half
 * (`intervalMs`, the refresh interval), so over a page that polls them it
 * costs no request. Over one that doesn't, per status tick: a node, a service
 * or a container 2 (/api/services, and /api/integrations when the model has
 * an integration), the UPS 1 (/api/ups), an integration 1, any other kind 0.
 * The phone's sheet has /api/services from its screens, so it asks only the
 * others. Its own read goes through fetchJson, with the last ETag, so a
 * steady board costs a 304.
 *
 * Returns, by source, `{ body, error }`: the last body read (null before
 * the first), and the last read's error (null once it answers again). A read
 * that fails keeps the body it had, for the detail to show as the last one
 * read, and say so. The state stays when the detail closes, so it closes as
 * it was drawn; a different set of reads starts afresh. A read that answers
 * after the detail closed, or went, is dropped.
 */
import { useEffect, useState } from 'react';
import {
  NOT_MODIFIED_NO_BODY,
  getAllIntegrations,
  getServices,
  getUPSStatus,
  lastAnswer,
} from '../../hooks/useData.js';

const READS = Object.freeze({
  services: { path: '/services', read: getServices },
  integrations: { path: '/integrations', read: getAllIntegrations },
  ups: { path: '/ups', read: getUPSStatus },
});

// A status answer this soon after the detail's own read of a source doesn't
// ask it again: the detail's first reads, and the poll's answer that may follow.
const AGAIN_AFTER_MS = 5_000;

/**
 * @param {string[]} wanted  the sources to read while open; [] when closed
 * @param {{ subscribe: (listener: () => void) => () => void } | null | undefined} updated
 * @param {{ intervalMs?: number }} [options]  the refresh interval
 */
export function useDetailSources(wanted, updated, { intervalMs = 30_000 } = {}) {
  const key = wanted.filter((name) => Object.hasOwn(READS, name)).join(',');
  const [state, setState] = useState(() => ({ key, read: {} }));
  // Another set of reads (another entity's kind) starts with none of the last one's.
  if (key && state.key !== key) setState({ key, read: {} });

  useEffect(() => {
    if (!key) return undefined;
    const names = key.split(',');
    const fresh = intervalMs * 1.5;
    let live = true;
    const own = new Map(); // source -> when its last own read answered
    const sent = new Map(); // source -> when its last own read was sent
    const inflight = new Set();
    const settle = (name, body, error) =>
      setState((s) => {
        const was = s.read[name];
        const kept =
          body === NOT_MODIFIED_NO_BODY || body === undefined ? (was?.body ?? null) : body;
        const next = { body: kept, error };
        if (was && was.body === next.body && was.error === next.error) return s;
        return { ...s, read: { ...s.read, [name]: next } };
      });
    const read = (name, first) => {
      if (inflight.has(name)) return;
      const { path, read: load } = READS[name];
      // The page's answer, when one came since this detail's own and is recent.
      const page = lastAnswer(path);
      if (page && page.at > (own.get(name) ?? -Infinity) && Date.now() - page.at < fresh) {
        settle(name, page.body, null);
        return;
      }
      const last = sent.get(name);
      if (!first && last != null && Date.now() - last < AGAIN_AFTER_MS) return;
      inflight.add(name);
      sent.set(name, Date.now());
      load()
        .then(
          (body) => {
            own.set(name, lastAnswer(path)?.at ?? Date.now());
            if (live) settle(name, body, null);
          },
          (err) => {
            if (!live) return;
            setState((s) => {
              const was = s.read[name];
              if (was?.error) return s;
              const error = String(err?.message || err || 'failed');
              return { ...s, read: { ...s.read, [name]: { body: was?.body ?? null, error } } };
            });
          }
        )
        .finally(() => inflight.delete(name));
    };
    for (const name of names) read(name, true);
    const stop = updated?.subscribe?.(() => {
      for (const name of names) read(name, false);
    });
    return () => {
      live = false;
      stop?.();
    };
  }, [key, updated, intervalMs]);

  return state.key === key || !key ? state.read : {};
}
