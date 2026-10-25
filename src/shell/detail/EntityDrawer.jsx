/**
 * The desktop's detail drawer (#309, spec §8): from 768px, the entity the URL
 * names (`?entity=<id>`, entityNav.js) in the Drawer (src/ui, #286) over the
 * page it was opened from. The URL drives it: a row opens it by pushing its
 * entity's URL, and a reload, Back or Forward to that URL, or the URL opened
 * anywhere, draws it again. Escape, the close button or the scrim close it
 * as Back does (closeEntity: back to the page when it was opened here, else
 * the page's URL), and focus goes back to the row that opened it.
 *
 * What it shows is EntityDetail's (#310): the model's word and reason, and
 * what the entity's kind adds from the reads it makes while open
 * (useDetailSources: as it opens, then on each answer of the header's status
 * poll, taking the page's answer where the page reads the same; none while
 * closed), with links to the user's own apps and links
 * (Settings → Apps & links) and to Settings. A job or a backup adds its
 * Remove (#578, JobRemove.jsx): once it is removed the drawer closes, and
 * focus goes to the row after it in the Jobs section (or the one before),
 * the removed row having left. A container the model calls Missing adds its
 * Remove (#688, MissingRemove.jsx) the same way. A node or a container adds its history
 * charts (#311, HistoryCharts.jsx: 1 h, 24 h or 7 d from Prometheus), which
 * ride in this chunk. A service with a Kuma monitor adds its heartbeat strip
 * (#312, DetailHeartbeats: its last 50 checks, from the /api/services read).
 * A Compose stack's lead is drawn as the stack (#642): its rollup in the
 * status box and, after the facts, its containers with Set lead, Ungroup and
 * Split out (StackSection).
 * Its own chunk (lazyViews.js),
 * loaded when an entity is first opened; App keeps it mounted after, so it
 * can close as it opened.
 */
import { useMemo, useState } from 'react';
import { Drawer } from '@ui/drawer';
import { DetailHeartbeats } from '@ui/entity-detail';
import { ShellSection } from '@ui/app-shell';
import { useConfig } from '../../context/ConfigContext.jsx';
import { navigate } from '../../router/useRoute.js';
import { entityFor } from '../../phone/nav/entityRoute.js';
import { closeEntity, entityOpener, returnFocusTo } from '../entityNav.js';
import { isJob } from '../jobsView.js';
import { entityDetail } from './entityDetail.js';
import { EntityDetail } from './EntityDetail.jsx';
import { sourcesFor } from './entityExtras.js';
import { HistoryCharts } from './HistoryCharts.jsx';
import { JobRemove } from './JobRemove.jsx';
import { MissingRemove } from './MissingRemove.jsx';
import { RecentErrors } from './RecentErrors.jsx';
import { StackSection } from './StackSection.jsx';
import { useDetailSources } from './useDetailSources.js';
import { useStatusAt, useStatusFreshness } from '../statusFreshness.js';

// src/shell/ isn't scanned for Tailwind's classes (src/ui/tailwind.css).
const CONTENTS = { display: 'contents' };

const NONE = Object.freeze([]);

// Focus back on the row that opened it, when it is still on the page; else
// where the Drawer would put it.
const backToOpener = () => entityOpener() ?? true;

// After a Remove: focus where JobRemove says, then close as Back does.
const closeRemoved = ({ focus }) => {
  returnFocusTo(focus);
  closeEntity();
};

/**
 * The drawer's header, by what its body says: the model's name for what it
 * has, else fixed words, never the URL's id (anyone can write a link).
 */
function heading(view) {
  switch (view.status) {
    case 'found':
      return { eyebrow: view.eyebrow, title: view.title, description: view.where ?? undefined };
    case 'resolved':
      return { title: 'Incident' };
    case 'gone':
      return { title: 'No longer monitored' };
    case 'loading':
      return { title: 'Loading…' };
    default:
      return { title: 'No signal' };
  }
}

export default function EntityDrawer({ id, status, reach, updated, intervalMs }) {
  // The last entity stays drawn while the drawer closes.
  const [shown, setShown] = useState(id);
  if (id && id !== shown) setShown(id);
  const freshness = useStatusFreshness({ status, reach, updated });
  const at = useStatusAt(updated);
  const { config } = useConfig();
  // Only while it is open: a closed drawer reads nothing. A job's runs are
  // read again only when it reported since (its `lastRun`).
  const entity = id ? entityFor(status, id) : null;
  const wanted = entity ? sourcesFor(entity, status) : NONE;
  const read = useDetailSources(wanted, updated, { intervalMs, revision: entity?.lastRun });
  const view = useMemo(
    () => entityDetail({ status, reach, id: shown, freshness, at, read, config }),
    [status, reach, shown, freshness, at, read, config]
  );
  // A service's heartbeats (#312), a node's or a container's history (#311),
  // and a job's Remove while it is the one open (not while it closes).
  const slots = useMemo(
    () => ({
      heartbeats: (v) => (
        <DetailHeartbeats
          beats={v.beats}
          history={v.beatsHistory}
          of={v.stack?.members.find((m) => m.lead)?.name}
          stale={Boolean(v.lastKnown)}
        />
      ),
      chart: (v) => (v.chart ? <HistoryCharts target={v.chart} updated={updated} /> : null),
      logs: (v) => (v.chart ? <RecentErrors target={v.chart} updated={updated} /> : null),
      stack: (v) => (v.stack ? <StackSection stack={v.stack} /> : null),
      // A missing container's Remove (#688), while it is the one open.
      forget: (v) =>
        v.forget && v.id === id ? (
          <MissingRemove target={v.forget} onRemoved={closeRemoved} />
        ) : null,
      ...(isJob(entity) && {
        runs: () => <JobRemove entity={entity} onRemoved={closeRemoved} />,
      }),
    }),
    [entity, updated, id]
  );
  if (!shown) return null;
  const { eyebrow, title, description } = heading(view);
  return (
    // A root of the new UI for the drawer's portal, with no box of its own.
    <ShellSection style={CONTENTS}>
      <Drawer
        open={Boolean(id)}
        onOpenChange={(open) => {
          if (!open) closeEntity();
        }}
        eyebrow={eyebrow}
        title={title}
        description={description}
        finalFocus={backToOpener}
        data-entity={shown}
      >
        <EntityDetail
          view={view}
          slots={slots}
          target={config?.linkTarget || '_blank'}
          onOpen={navigate}
        />
      </Drawer>
    </ShellSection>
  );
}
