/**
 * The reads an open detail makes beyond the status (#310): `wanted` (of
 * services, integrations, ups; entityExtras.js sourcesFor) as the detail
 * opens, then again each time the header's status poll answers
 * (`updated`, useStatus: a 304 too), and nothing while it is closed (`wanted`
 * empty). The poll pauses in a hidden tab, so these do too.
 *
 * Each read goes through fetchJson, with the ETag of the last answer for its
 * URL (whoever asked it), so a steady board costs a 304 and keeps the same
 * body. Per status tick while a detail is open: a node, a service or a
 * container 2 (/api/services, and /api/integrations when the model has an
 * integration), the UPS 1 (/api/ups), an integration 1; any other kind 0.
 * The phone's sheet already has /api/services, so it asks only the others.
 *
 * Returns, by source, `{ body, error }`: the last body read (null before
 * the first), and the last read's error (null once it answers again). A read
 * that fails keeps the body it had, for the detail to show as the last one
 * read, and say so. The state stays when the detail closes, so it closes as
 * it was drawn; a different set of reads starts afresh.
 */
import { useEffect, useState } from 'react';
import {
  NOT_MODIFIED_NO_BODY,
  getAllIntegrations,
  getServices,
  getUPSStatus,
} from '../../hooks/useData.js';

const READS = Object.freeze({
  services: getServices,
  integrations: getAllIntegrations,
  ups: getUPSStatus,
});

// A status answer this soon after a read of the same source doesn't ask it
// again: the detail's first reads, and the poll's answer that may follow.
const AGAIN_AFTER_MS = 5_000;

/**
 * @param {string[]} wanted  the sources to read while open; [] when closed
 * @param {{ subscribe: (listener: () => void) => () => void } | null | undefined} updated
 */
export function useDetailSources(wanted, updated) {
  const key = wanted.filter((name) => Object.hasOwn(READS, name)).join(',');
  const [state, setState] = useState(() => ({ key, read: {} }));
  // Another set of reads (another entity's kind) starts with none of the last one's.
  if (key && state.key !== key) setState({ key, read: {} });

  useEffect(() => {
    if (!key) return undefined;
    const names = key.split(',');
    let live = true;
    const asked = new Map(); // source -> when its read was sent
    const inflight = new Set();
    const read = (name, force) => {
      if (inflight.has(name)) return;
      const last = asked.get(name);
      if (!force && last != null && Date.now() - last < AGAIN_AFTER_MS) return;
      inflight.add(name);
      asked.set(name, Date.now());
      READS[name]()
        .then(
          (body) => {
            if (!live) return;
            setState((s) => {
              const was = s.read[name];
              const kept = body === NOT_MODIFIED_NO_BODY ? (was?.body ?? null) : body;
              if (was && was.body === kept && was.error === null) return s;
              return { ...s, read: { ...s.read, [name]: { body: kept, error: null } } };
            });
          },
          (err) => {
            if (!live) return;
            setState((s) =>
              s.read[name]?.error
                ? s
                : {
                    ...s,
                    read: {
                      ...s.read,
                      [name]: {
                        body: s.read[name]?.body ?? null,
                        error: String(err?.message || err || 'failed'),
                      },
                    },
                  }
            );
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
  }, [key, updated]);

  return state.key === key || !key ? state.read : {};
}
