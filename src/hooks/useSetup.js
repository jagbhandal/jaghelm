import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';

/**
 * Whether this install still has its guided first run to do (#322, spec §8):
 * the server's `setup-pending` marker, asked once when the app opens. Null
 * until it answers (and for good if it can't be asked: no setup is offered,
 * never a wrong one). `done()` is Finish and Skip: it tells the server, which
 * clears the marker for every device, and the setup goes away at once.
 * `enabled` is false for the read-only demo, which has no setup to guide.
 */
export function useSetup({ enabled }) {
  const [pending, setPending] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const ctl = new AbortController();
    apiFetch('/api/setup', { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => setPending(body?.pending === true))
      .catch(() => {});
    return () => ctl.abort();
  }, [enabled]);

  const done = useCallback(async () => {
    // Gone at once: a failed save returns on the next open, never a wall.
    setPending(false);
    try {
      await apiFetch('/api/setup/done', { method: 'POST' });
    } catch {
      // the setup comes back at the next open
    }
  }, []);

  return { pending: pending === true, done };
}
