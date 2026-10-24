/**
 * Edit layout (#330, spec §8): the panel that arranges the Overview, shown
 * above its sections while the mode is on. It is a chunk of its own
 * (loadOverviewEditor), asked for when the mode is entered, so no first load
 * carries it, and the Overview reads only the stored arrangement
 * (overviewLayout.js).
 *
 * What it edits, all live (every change draws on the Overview behind it at
 * once and is saved by the same versioned path as any setting, #233):
 *
 *   Sections   reorder Infrastructure, Power, Jobs and Services, and show or
 *              hide any section but "Needs attention", which stays on and
 *              first. The switches are the display config's
 *              `overviewSections.<id>`: the very keys Settings → Appearance →
 *              Overview sections edits, so either place changes both.
 *   Services   pin a service (a stack is one pinned row) to the top of the
 *              Services section, reorder the pinned ones, and put any service
 *              in a custom group, which the section then groups by. Groups
 *              are the custom groups of Settings → Nodes & Services: this
 *              adds a group by name and assigns services to it; renaming and
 *              deleting stay in Settings.
 *
 * The panel itself is the design system's LayoutEditor (@ui/layout-editor); this
 * holds the arrangement and says what each row and control does.
 *
 * No move is pointer-only: every row has Move up and Move down, focus stays
 * on the moved row's button, and each change is announced from one polite
 * live region. Dragging a row's grip is the pointer's way to the same move.
 * Escape or Done leaves the mode.
 */
import { useMemo, useRef, useState } from 'react';
import { ShellSection } from '@ui/app-shell';
import { GROUP_NONE, LayoutEditor } from '@ui/layout-editor';
import { useConfig } from '../context/ConfigContext.jsx';
import {
  assignGroup,
  groupOf,
  isDefaultLayout,
  layoutValue,
  moveBy,
  moveTo,
  pin,
  placeOf,
  pruneLayout,
  readLayout,
  serviceGone,
  unpin,
} from './overviewLayout.js';
import { OVERVIEW_SECTIONS, sectionShown } from './overviewSections.js';
import { heldByName, heldUids } from './customGroups.js';
import { serviceRows, useServicesGrouping } from './servicesView.js';

const NOTE = { margin: '0 16px' };
const LABELS = Object.fromEntries(OVERVIEW_SECTIONS.map((s) => [s.id, s]));
// What the sections that can't be moved say under their name.
const HINTS = {
  attention: 'Always on, always first',
  strip: 'Stays under Needs attention',
  rail: 'Beside the sections, from 1440px',
};

export default function OverviewEditor({ status, services, sections, customGroups = [], onDone }) {
  const { config, update } = useConfig();
  const stored = config.overviewLayout;
  const layout = useMemo(() => readLayout({ overviewLayout: stored }), [stored]);
  const gone = useMemo(() => serviceGone(status, services), [status, services]);
  const rows = useMemo(
    () => serviceRows({ status, services, sections }),
    [status, services, sections]
  );
  const [, setGrouping] = useServicesGrouping();
  const [message, say] = useState('');
  const [query, setQuery] = useState('');
  const [groupName, setGroupName] = useState('');

  const save = (next) => update('overviewLayout', layoutValue(pruneLayout(next, gone)));
  const nameOfSection = (id) => LABELS[id]?.label ?? id;
  const nameOfService = (uid) => byUidRef.current.get(uid)?.name ?? uid.slice(uid.indexOf(':') + 1);
  const byUidRef = useRef(new Map());

  // Sections: the ones that always come first, then the movable in their order, then the rail.
  const moveSection = (id, delta) => {
    const order = moveBy(layout.order, id, delta);
    if (order === layout.order) return;
    save({ ...layout, order });
    say(`${nameOfSection(id)} moved to ${placeOf(order, id)}`);
  };
  const reorderSection = (id, to) => {
    const order = moveTo(layout.order, id, to);
    if (order !== layout.order) save({ ...layout, order });
  };
  const setShown = (id, on) => {
    update(`overviewSections.${id}`, on);
    say(`${nameOfSection(id)} ${on ? 'shown' : 'hidden'}`);
  };
  const sectionItems = ['attention', 'strip', ...layout.order, 'rail'].map((id) => ({
    id,
    label: LABELS[id].label,
    hint: HINTS[id],
    shown: sectionShown(config, id),
    locked: LABELS[id].locked,
    movable: layout.order.includes(id),
  }));

  // Services: every pin is listed, in order. One whose service has no row now
  // (its node is down, it is folded into a stack, or it is gone) is listed as
  // "not shown now" so it can still be moved and unpinned; it is pruned only
  // when it is really gone (serviceGone), at the next save.
  const byUid = useMemo(() => new Map(rows.map((r) => [r.uid, r])), [rows]);
  byUidRef.current = byUid;
  const movePinned = (uid, delta) => {
    const moved = moveBy(layout.pinned, uid, delta);
    if (moved === layout.pinned) return;
    save({ ...layout, pinned: moved });
    say(`${nameOfService(uid)} moved to ${placeOf(moved, uid)} of the pinned`);
  };
  const reorderPinned = (uid, to) => {
    const moved = moveTo(layout.pinned, uid, to);
    if (moved !== layout.pinned) save({ ...layout, pinned: moved });
  };
  const pinService = (uid) => {
    save({ ...layout, pinned: pin(layout.pinned, uid) });
    say(`${nameOfService(uid)} pinned to the top of Services`);
  };
  const unpinService = (uid) => {
    save({ ...layout, pinned: unpin(layout.pinned, uid) });
    say(`${nameOfService(uid)} unpinned`);
  };
  const reset = () => {
    update('overviewLayout', undefined);
    say('Order and pins reset');
  };

  // Groups are the custom groups of Settings.
  const pool = useMemo(() => [...rows, ...rows.flatMap((r) => r.folded ?? [])], [rows]);
  const groupItems = [
    { value: GROUP_NONE, label: 'No group' },
    ...customGroups.map((g) => ({ value: g.id, label: g.title || 'Group' })),
  ];
  const addGroup = () => {
    const title = groupName.trim();
    if (!title) return;
    if (customGroups.some((g) => (g.title ?? '').trim().toLowerCase() === title.toLowerCase())) {
      say(`A group named ${title} already exists.`);
      return;
    }
    update('customGroups', [
      ...customGroups,
      { id: `custom-${Date.now()}`, title, containers: [] },
    ]);
    setGroupName('');
    say(`Group ${title} added. Put a service in it to see it.`);
  };
  const setGroup = (uid, value) => {
    const row = byUid.get(uid);
    const to = value === GROUP_NONE ? null : value;
    update('customGroups', assignGroup(customGroups, uid, to));
    if (to) {
      setGrouping('group');
      const title = customGroups.find((g) => g.id === to)?.title || 'the group';
      say(`${row.name} put in ${title}. Services are grouped by group.`);
    } else {
      say(`${row.name} taken out of its group`);
    }
  };
  const itemOf = (row) => {
    const { group, byName } = groupOf(
      customGroups,
      row.uid,
      (g) => heldUids(g, pool),
      (g) => heldByName(g, pool)
    );
    return {
      id: row.uid,
      name: row.name,
      where: row.nodeName,
      group: group ? group.id : GROUP_NONE,
      groupDisabled: byName,
    };
  };

  // A pin with no row: its uid's name and node, kept so it can be unpinned.
  const missingItem = (uid) => {
    const at = uid.indexOf(':');
    return {
      id: uid,
      name: at > 0 ? uid.slice(at + 1) : uid,
      where: at > 0 ? uid.slice(0, at) : undefined,
      group: GROUP_NONE,
      missing: true,
    };
  };
  const pinnedItems = layout.pinned.map((uid) =>
    byUid.has(uid) ? itemOf(byUid.get(uid)) : missingItem(uid)
  );
  const pinnedIds = new Set(layout.pinned);

  const needle = query.trim().toLowerCase();
  const others = rows.filter(
    (r) =>
      !pinnedIds.has(r.uid) &&
      (needle === '' || `${r.name} ${r.nodeName ?? ''} ${r.uid}`.toLowerCase().includes(needle))
  );

  return (
    <div data-slot="overview-editor" style={NOTE}>
      <ShellSection>
        <LayoutEditor
          sections={sectionItems}
          onSectionShown={setShown}
          onSectionMove={moveSection}
          onSectionReorder={reorderSection}
          pinned={pinnedItems}
          services={others.map(itemOf)}
          groups={groupItems}
          onPin={pinService}
          onUnpin={unpinService}
          onPinnedMove={movePinned}
          onPinnedReorder={reorderPinned}
          onGroup={setGroup}
          groupName={groupName}
          onGroupName={setGroupName}
          onAddGroup={addGroup}
          query={query}
          onQuery={setQuery}
          servicesEmpty={needle ? 'No service matches.' : 'Every service is pinned.'}
          servicesNote={
            sectionShown(config, 'services')
              ? undefined
              : 'The Services section is hidden: pins and groups show when it is on again.'
          }
          message={message}
          onReset={reset}
          resetDisabled={isDefaultLayout(layout)}
          onDone={onDone}
        />
      </ShellSection>
    </div>
  );
}
