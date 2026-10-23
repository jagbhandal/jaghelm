/**
 * The desktop's detail drawer (#309, spec §8): from 768px, the entity the URL
 * names (`?entity=<id>`, entityNav.js) in the Drawer (src/ui, #286) over the
 * page it was opened from. The URL drives it: a row opens it by pushing its
 * entity's URL, and a reload, Back or Forward to that URL, or the URL opened
 * anywhere, draws it again. Escape, the close button or the scrim close it
 * as Back does (closeEntity: back to the page when it was opened here, else
 * the page's URL), and focus goes back to the row that opened it.
 *
 * What it shows is EntityDetail's (the model's word, reason and facts), for
 * #310 to replace. Its own chunk (lazyViews.js), loaded when an entity is
 * first opened; App keeps it mounted after, so it can close as it opened.
 */
import { useMemo, useState } from 'react';
import { Drawer } from '@ui/drawer';
import { ShellSection } from '@ui/app-shell';
import { closeEntity, entityOpener } from '../entityNav.js';
import { entityDetail } from './entityDetail.js';
import { EntityDetail } from './EntityDetail.jsx';
import { useStatusAt, useStatusFreshness } from '../statusFreshness.js';

// src/shell/ isn't scanned for Tailwind's classes (src/ui/tailwind.css).
const CONTENTS = { display: 'contents' };

// Focus back on the row that opened it, when it is still on the page; else
// where the Drawer would put it.
const backToOpener = () => entityOpener() ?? true;

/** The drawer's header, by what its body says. */
function heading(view, id) {
  switch (view.status) {
    case 'found':
      return { eyebrow: view.eyebrow, title: view.title, description: view.where ?? undefined };
    case 'gone':
      return { title: 'No longer monitored' };
    case 'loading':
      return { title: 'Loading…' };
    default:
      return { title: id };
  }
}

export default function EntityDrawer({ id, status, reach, updated }) {
  // The last entity stays drawn while the drawer closes.
  const [shown, setShown] = useState(id);
  if (id && id !== shown) setShown(id);
  const freshness = useStatusFreshness({ status, reach, updated });
  const at = useStatusAt(updated);
  const view = useMemo(
    () => entityDetail({ status, reach, id: shown, freshness, at }),
    [status, reach, shown, freshness, at]
  );
  if (!shown) return null;
  const { eyebrow, title, description } = heading(view, shown);
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
        <EntityDetail view={view} />
      </Drawer>
    </ShellSection>
  );
}
