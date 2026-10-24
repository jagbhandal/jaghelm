/**
 * A stack's containers in its detail (#642, the drawer's and the phone
 * sheet's): the library's DetailStack with its edits wired to services.yaml
 * (stackEdits.js) and its Details opening the container's own detail over the
 * stack's, so Back and Close return to the stack and focus goes back to the
 * row that opened it. It rides in the detail's chunk.
 */
import { useEffect, useRef, useState } from 'react';
import { DetailStack } from '@ui/stack-panel';
import { useToast } from '../../context/OverlayContext.jsx';
import { entityOpener, openEntity, returnFocusTo } from '../entityNav.js';
import { stackEdit } from './stackEdits.js';

/** @param {{ stack: any, open?: (member: any) => void }} props  `open`: how Details opens a container (the phone's sheet pushes its own) */
export function StackSection({ stack, open }) {
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
  // Another stack's detail starts with no error of this one's.
  const [shownFor, setShownFor] = useState(stack.id);
  if (shownFor !== stack.id) {
    setShownFor(stack.id);
    setError(null);
  }

  const run = async (edit, done) => {
    setBusy(true);
    setError(null);
    try {
      await edit();
      toast(done, 'success');
    } catch (err) {
      if (mounted.current) setError(err.message);
    }
    if (mounted.current) setBusy(false);
  };
  const saved = 'Saved. The board changes at its next refresh.';

  return (
    <DetailStack
      stack={stack}
      busy={busy}
      error={error}
      onDetails={(member) => {
        if (open) return open(member);
        // Focus still goes back to the row that opened the stack.
        const row = entityOpener();
        openEntity(member.id);
        returnFocusTo(row);
      }}
      onSetLead={(member) =>
        run(() => stackEdit.lead(stack.node, stack.project, member.container), saved)
      }
      onUngroup={() => run(() => stackEdit.ungroup(stack.node, stack.project), saved)}
      onSplit={(member) =>
        run(() => stackEdit.split(stack.node, stack.project, member.container), saved)
      }
    />
  );
}
