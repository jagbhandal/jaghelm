import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { drawnAnchors, entityAnchor, usePlace, usePlaces } from './entityAnchors.js';

// The anchors of the places on the Overview that draw an entity (#297), by
// the status model's id (docs/ARCHITECTURE.md §4.7). Issue rows open the
// entity's URL since #309 (entityNav.js).

describe('entityAnchor', () => {
  it("is the model's id behind a prefix, safe as an HTML id and a URL fragment", () => {
    expect(entityAnchor('services/apps:jellyfin')).toBe('entity-services/apps:jellyfin');
    expect(entityAnchor('power/ups')).toBe('entity-power/ups');
    // A monitor placed by its name may carry spaces and brackets (refresh.js placeMonitor).
    const odd = entityAnchor('services/vm103:My monitor (12)');
    expect(odd).toMatch(/^[\w.:/-]+$/);
    expect(odd).not.toBe(entityAnchor('services/vm103:My_monitor_(12)'));
    expect(entityAnchor('jobs/a:b_c')).not.toBe(entityAnchor('jobs/a:b c'));
  });
});

// The board says which places it draws: each puts its anchor on the list while
// it is mounted, so the rows follow whatever hides one.
describe('the places drawn', () => {
  function Card({ id, shown }) {
    return <div id={usePlace(id, shown)} />;
  }
  function Jobs({ ids }) {
    usePlaces(ids);
    return null;
  }

  it('a place is on the list while it is mounted and shown, and its id is its anchor', () => {
    const { container, rerender, unmount } = render(<Card id="nodes/pve" />);
    expect(container.firstChild).toHaveAttribute('id', entityAnchor('nodes/pve'));
    expect(drawnAnchors().has(entityAnchor('nodes/pve'))).toBe(true);
    rerender(<Card id="nodes/pve" shown={false} />);
    expect(container.firstChild).not.toHaveAttribute('id');
    expect(drawnAnchors().has(entityAnchor('nodes/pve'))).toBe(false);
    rerender(<Card id="nodes/pve" />);
    unmount();
    expect(drawnAnchors().size).toBe(0);
  });

  it('a list of places follows what is drawn; one anchor drawn twice stays until both go', () => {
    const { rerender, unmount } = render(
      <>
        <Jobs ids={['jobs/a:x', 'jobs/a:y']} />
        <Card id="jobs/a:x" />
      </>
    );
    expect([...drawnAnchors()].sort()).toEqual([
      entityAnchor('jobs/a:x'),
      entityAnchor('jobs/a:y'),
    ]);
    rerender(<Jobs ids={['jobs/a:y']} />);
    expect([...drawnAnchors()]).toEqual([entityAnchor('jobs/a:y')]);
    unmount();
    expect(drawnAnchors().size).toBe(0);
  });
});
