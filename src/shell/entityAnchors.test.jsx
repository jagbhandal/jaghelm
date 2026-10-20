import { describe, it, expect, afterEach, vi } from 'vitest';
import { anchorsOf, entityAnchor, openAnchor, rowLink } from './entityAnchors.js';

// Where an issue row on the Overview leads (#297): the place on today's board
// that draws its entity, by the status model's id (docs/ARCHITECTURE.md §4.7).

/** A place on the board with the anchor of `entityId`, as the legacy board draws it. */
function place(entityId, attrs = {}) {
  const el = document.createElement('div');
  el.id = entityAnchor(entityId);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.append(el);
  return el;
}

afterEach(() => {
  document.body.replaceChildren();
});

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

describe('anchorsOf', () => {
  it('a service or container: its card, then its node’s card', () => {
    const service = { id: 'services/vm103:immich', kind: 'service', node: 'vm103' };
    expect(anchorsOf(service)).toEqual([
      entityAnchor('services/vm103:immich'),
      entityAnchor('nodes/vm103'),
    ]);
    expect(anchorsOf({ ...service, kind: 'container' })).toEqual(anchorsOf(service));
  });

  it('a node, the UPS and a job: its own place', () => {
    expect(anchorsOf({ id: 'nodes/pve', kind: 'node', node: 'pve' })).toEqual([
      entityAnchor('nodes/pve'),
    ]);
    expect(anchorsOf({ id: 'power/ups', kind: 'ups' })).toEqual([entityAnchor('power/ups')]);
    expect(
      anchorsOf({ id: 'jobs/apps:db-dump', kind: 'job', node: 'apps', name: 'db-dump' })
    ).toEqual([entityAnchor('jobs/apps:db-dump')]);
  });

  it('a backup: its job’s row, as the board lists backups as jobs', () => {
    expect(
      anchorsOf({
        id: 'backups/storage:nightly-backup',
        kind: 'backup',
        node: 'storage',
        name: 'nightly-backup',
      })
    ).toEqual([entityAnchor('jobs/storage:nightly-backup')]);
  });

  it('an integration, an Arcane agent or a monitoring source: nowhere on the board', () => {
    expect(anchorsOf({ id: 'integrations/adguard', kind: 'integration' })).toEqual([]);
    expect(anchorsOf({ id: 'integrations/arcane:vm103', kind: 'agent' })).toEqual([]);
    expect(anchorsOf({ id: 'sources/prometheus', kind: 'source' })).toEqual([]);
    expect(anchorsOf({ id: 'mystery/x', kind: 'mystery' })).toEqual([]);
    expect(anchorsOf(undefined)).toEqual([]);
  });
});

describe('openAnchor', () => {
  it('focuses the first place the page has and scrolls it into view', () => {
    const card = place('services/vm103:immich');
    const scroll = vi.spyOn(card, 'scrollIntoView');
    expect(openAnchor([entityAnchor('services/vm103:immich'), entityAnchor('nodes/vm103')])).toBe(
      true
    );
    expect(document.activeElement).toBe(card);
    // Focusable from code only: it joins no tab order.
    expect(card).toHaveAttribute('tabindex', '-1');
    expect(scroll).toHaveBeenCalledWith({ block: 'start' });
  });

  it('falls back to the next place when the first is not drawn', () => {
    const node = place('nodes/vm103');
    expect(openAnchor([entityAnchor('services/vm103:immich'), entityAnchor('nodes/vm103')])).toBe(
      true
    );
    expect(document.activeElement).toBe(node);
  });

  it('keeps a tabindex the place already has (a draggable card is in the tab order)', () => {
    const card = place('services/vm103:immich', { tabindex: '0' });
    openAnchor([entityAnchor('services/vm103:immich')]);
    expect(card).toHaveAttribute('tabindex', '0');
    expect(document.activeElement).toBe(card);
  });

  it('does nothing when no place is drawn', () => {
    expect(openAnchor([entityAnchor('nodes/gone')])).toBe(false);
    expect(openAnchor([])).toBe(false);
  });
});

describe('rowLink', () => {
  it('a row with a place: a link to its anchor that moves there', () => {
    const card = place('services/vm103:immich');
    const link = rowLink({ id: 'services/vm103:immich', kind: 'service', node: 'vm103' });
    expect(link.href).toBe('#entity-services/vm103:immich');
    link.onOpen();
    expect(document.activeElement).toBe(card);
  });

  it('a row with no place: nothing to open, so the row is plain content', () => {
    expect(rowLink({ id: 'sources/kuma', kind: 'source' })).toEqual({});
  });
});
