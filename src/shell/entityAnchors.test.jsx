import { describe, it, expect } from 'vitest';
import { entityAnchor } from './entityAnchors.js';

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
