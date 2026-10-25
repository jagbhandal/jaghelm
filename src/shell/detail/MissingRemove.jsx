/**
 * A missing container's Remove in its detail (#688), behind the library's
 * Confirm (DetailRemove): it forgets the container from JagHelm's registry
 * (POST /api/containers/forget) so its "Missing" card leaves now instead of
 * after 24 h, and the board is no longer degraded by it. It changes nothing in
 * Docker, Kuma or services.yaml, and says so when a monitor still names it.
 * The server refuses a container that is running. On success the board is
 * read again at once (refreshNow.js), a toast says what happened, and
 * `onRemoved()` closes the detail. A Remove that fails says why, over the
 * button, and removes nothing. A read-only server (the public demo) gets no
 * button.
 */
import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Banner } from '@ui/banner';
import { DetailRemove } from '@ui/entity-detail';
import { isReadOnlyServer } from '../../api/client.js';
import { useToast } from '../../context/OverlayContext.jsx';
import { forgetContainer } from '../../hooks/useData.js';
import { refreshNow } from '../../refreshNow.js';
import {
  focusAfterForget,
  forgetDescription,
  forgetError,
  forgotText,
  NOT_REPORTING,
} from './forgetMissing.js';

/**
 * @param {{ target: ReturnType<typeof import('./forgetMissing.js').forgetTarget>,
 *   onRemoved?: (removed: { id: string, focus: Element | null }) => void }} props
 */
export function MissingRemove({ target, onRemoved }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Another container's detail starts with no error of this one's.
  const [shownFor, setShownFor] = useState(target.id);
  if (shownFor !== target.id) {
    setShownFor(target.id);
    setError(null);
  }
  if (isReadOnlyServer()) return null;
  if (!target.reporting) {
    return <Banner tone="unknown" title={NOT_REPORTING.title} cause={NOT_REPORTING.cause} />;
  }

  const remove = async () => {
    setBusy(true);
    setError(null);
    let answer;
    try {
      answer = await forgetContainer(target.node, target.container);
    } catch (err) {
      if (mounted.current) {
        setBusy(false);
        setError(forgetError(target.name, err));
      }
      return;
    }
    // Where focus goes once it closes, read before the row leaves the page.
    const focus = focusAfterForget(target.id);
    const refreshed = answer?.refreshed !== false;
    toast(forgotText(target, refreshed), 'success');
    refreshNow();
    // The server's cycle did not finish in time: read again a little later too.
    if (!refreshed) setTimeout(refreshNow, 3000);
    if (mounted.current) setBusy(false);
    onRemoved?.({ id: target.id, focus });
  };

  return (
    <DetailRemove
      title="Remove this missing container?"
      name={target.name}
      detail={`On ${target.node}`}
      description={forgetDescription(target)}
      busy={busy}
      error={error}
      icon={<Trash2 aria-hidden="true" />}
      onConfirm={remove}
    />
  );
}
