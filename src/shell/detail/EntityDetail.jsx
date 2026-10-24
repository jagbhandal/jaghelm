/**
 * The detail drawer's body (#309, #310, spec §8): one entity as
 * entityDetail.js reads it, in the mock's drawer order: the phone's status
 * box (the model's word, its reason, how long it has been so, a node's hosted
 * services), then what its kind adds (a node's meters, the facts, the
 * sections: Proxmox's machines, pools and last backup, a container's
 * numbers, an integration's stats), a note when a read failed, and its links
 * (Open, Grafana, Uptime Kuma, Settings). A placeholder until the first
 * status, "No signal" without one, and, for an id the model doesn't have,
 * that it is no longer monitored.
 *
 * `slots` are where the cards after this one draw, each a function of the
 * view, drawn in its place when given: `heartbeats` (#312, Kuma's history)
 * and `chart` (#311, the history: 1 h / 24 h / 7 d, the drawer's
 * HistoryCharts for a view with a `chart` target) under the status box, as
 * the mock's; `logs` (#672, Recent errors from Loki), `stack` (#642, a Compose
 * stack's containers) and `runs` (#578, a job's last runs and Remove) after the
 * sections. Nothing stands in for one not given.
 *
 * It writes no class of its own: src/shell/ isn't scanned for Tailwind's
 * (src/ui/tailwind.css), so its parts are the library's (entity-detail.jsx)
 * and the phone's, laid out by the Drawer's body.
 */
import { Banner } from '@ui/banner';
import { EmptyState } from '@ui/empty-state';
import {
  DetailFacts,
  DetailLinks,
  DetailMeters,
  DetailSections,
  DetailUnread,
} from '@ui/entity-detail';
import { Skeleton } from '@ui/skeleton';
import { DetailStatus } from '../../phone/components/DetailParts.jsx';

// An id has no spaces to break at (src/shell/ writes no Tailwind class).
const BREAK_ANYWHERE = { overflowWrap: 'anywhere' };

const NO_SLOTS = Object.freeze({});

/**
 * @param {{ view: any, slots?: Record<string, (view: any) => import('react').ReactNode>,
 *   target?: string, onOpen?: (href: string) => void }} props
 *   `target`: where a link out opens (Settings → Apps & links); `onOpen`: opens a link inside JagHelm
 */
export function EntityDetail({ view, slots = NO_SLOTS, target, onOpen }) {
  switch (view.status) {
    case 'loading':
      return (
        <div data-slot="entity-drawer-body" aria-busy="true">
          <span className="sr-only">Loading</span>
          <Skeleton style={{ height: 76 }} />
        </div>
      );
    case 'unreachable':
      return <Banner tone="unknown" title="Nothing to show" cause={view.cause} />;
    case 'resolved':
      // A failed source the model no longer lists: it answers again (the
      // phone's incident sheet says the same).
      return <EmptyState data-resolved="" title="This incident has resolved." />;
    case 'gone':
      // The id is the URL's, which anyone can write: code, never a title.
      return (
        <EmptyState
          data-gone=""
          title="Nothing by this name now"
          description={
            <>
              It was removed or renamed, or the link is old:{' '}
              <code style={BREAK_ANYWHERE}>{view.id}</code>
            </>
          }
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
            note={view.note}
          />
          {slots.heartbeats?.(view)}
          {slots.chart?.(view)}
          <DetailMeters meters={view.meters} />
          <DetailFacts facts={view.facts} lastKnown={view.lastKnown} />
          <DetailSections sections={view.sections} muted={Boolean(view.lastKnown)} />
          {slots.logs?.(view)}
          {slots.stack?.(view)}
          {slots.runs?.(view)}
          <DetailUnread unread={view.unread} />
          <DetailLinks {...view.links} target={target} onOpen={onOpen} />
        </>
      );
  }
}
