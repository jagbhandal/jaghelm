/**
 * A job's Remove in its detail (#578): the old board's Scheduled Jobs panel's
 * Remove, behind the library's Confirm (DetailRemove) instead of the
 * browser's. It calls the same endpoint (useData.js deleteCronJob: DELETE
 * /api/cron/jobs/:node/:job; a job already gone is removed too; a read-only
 * server keeps it in this tab), takes the job off the lists at once
 * (removedJobs.js, before the model drops it), then `onRemoved()`, which
 * closes the detail. A Remove that fails says why, over the button, and
 * removes nothing.
 */
import { useEffect, useRef, useState } from 'react';
import { DetailRemove } from '@ui/entity-detail';
import { deleteCronJob } from '../../hooks/useData.js';
import { markRemoved } from '../removedJobs.js';
import { focusAfterRemove, removeError } from './removal.js';

/**
 * @param {{ entity: any, onRemoved?: (removed: { id: string, focus: Element | null }) => void }} props
 *   `entity`: the model's job or backup
 */
export function JobRemove({ entity, onRemoved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Another job's detail starts with no error of this one's.
  const [shownFor, setShownFor] = useState(entity.id);
  if (shownFor !== entity.id) {
    setShownFor(entity.id);
    setError(null);
  }

  const backup = entity.kind === 'backup';
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteCronJob(entity.node, entity.name);
    } catch (err) {
      if (mounted.current) {
        setBusy(false);
        setError(removeError(entity.name, err));
      }
      return;
    }
    // Where focus goes once it closes, read before the row leaves the page.
    const focus = focusAfterRemove(entity.id);
    markRemoved(entity.id, entity.lastRun);
    if (mounted.current) setBusy(false);
    onRemoved?.({ id: entity.id, focus });
  };

  return (
    <DetailRemove
      title={backup ? 'Remove this backup?' : 'Remove this job?'}
      name={entity.name}
      detail={entity.node ? `On ${entity.node}` : undefined}
      description="Its last runs go with it. It comes back the next time it reports."
      busy={busy}
      error={error}
      onConfirm={remove}
    />
  );
}
