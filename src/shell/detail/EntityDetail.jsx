/**
 * The detail drawer's body (#309): one entity as entityDetail.js reads it from
 * the status, the phone's status box (the model's word, its reason, how long
 * it has been so) over its facts. A placeholder until the first status, "No
 * signal" without one, and, for an id the model doesn't have, that it is no
 * longer monitored. #310 replaces this component with the full drawer (links,
 * charts, stats); EntityDrawer.jsx, which draws it, stays.
 *
 * It writes no class of its own: src/shell/ isn't scanned for Tailwind's
 * (src/ui/tailwind.css), so its parts are the library's and the phone's,
 * laid out by the Drawer's body.
 */
import { Banner } from '@ui/banner';
import { EmptyState } from '@ui/empty-state';
import { FactList } from '@ui/fact-list';
import { Skeleton } from '@ui/skeleton';
import { DetailStatus } from '../../phone/components/DetailParts.jsx';

export function EntityDetail({ view }) {
  switch (view.status) {
    case 'loading':
      return (
        <div data-slot="entity-drawer-body" aria-busy="true">
          <span className="sr-only">Loading</span>
          <Skeleton style={{ height: 76 }} />
        </div>
      );
    case 'unreachable':
      return <Banner tone="unknown" title="No signal" cause={view.cause} />;
    case 'gone':
      return (
        <EmptyState
          data-gone=""
          title={view.id}
          description="JagHelm doesn’t watch anything by this name now: it was removed or renamed, or the link is old."
        />
      );
    default:
      return (
        <>
          <DetailStatus
            state={view.state}
            word={view.word}
            reason={view.reason}
            since={view.since}
          />
          <FactList facts={view.facts} />
        </>
      );
  }
}
