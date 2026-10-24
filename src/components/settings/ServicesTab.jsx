import React, { useState } from 'react';
import { ServiceMap } from '@ui/service-mapping';
import { SettingsIcon } from './primitives.jsx';
import {
  AUTO_MATCH,
  NO_MONITOR,
  defaultName,
  effectiveText,
  isHidden,
  isPerNode,
  monitorChoice,
  monitorNodeSetting,
  withHidden,
  withMonitor,
  withMonitorNode,
  withNodeMonitor,
  withNodeText,
  withText,
  withoutOverrides,
} from './servicesConfig.js';

/**
 * Settings → Nodes & Services' services (#319, on src/ui/service-mapping.jsx):
 * every discovered container by node, where each can be renamed, given an
 * icon, hidden, and mapped to an Uptime Kuma monitor on purpose.
 *
 * Data: `serverConfig` (services.yaml, the overrides), `liveServices`
 * (/api/services, the containers found now), `monitorNames`
 * (/api/services/monitors, Kuma's monitors) and `mapping`
 * (/api/services/monitor-mapping, #319): per container the monitor it carries,
 * the one Auto-match would pick and how, and similar names. Every edit is the
 * whole config handed to `onSave` (servicesConfig.js says how each is made).
 *
 * A Kuma monitor that no container carries (`mapping.monitorOnly`, #644: the
 * cAdvisor monitors, whose containers the board hides) is a row on the node it
 * is shown on, with a Node choice that writes `monitor_nodes` in services.yaml;
 * the row moves as soon as it is chosen, before the next refresh confirms it.
 *
 * The row's tag follows the monitor the container really carries
 * (`svc.monitored`, which the server sets only when a monitor is attached),
 * never its own state: a running container with no monitor reads "no monitor".
 */

// The Select's value for Auto-match: a Select has no empty choice of its own.
const AUTO_ITEM = '__auto__';

const LAMP = { up: ['ok', 'Up'], down: ['crit', 'Down'] };
const lampOf = (status) => LAMP[status] ?? ['unknown', 'No signal'];

// How the server chose the node of a monitor no container carries (refresh.js placeMonitor).
const PLACED_BY = {
  setting: 'as set here',
  owner: 'where the container it belonged to stopped',
  'last-seen': 'where it was last seen',
  target: 'from the address it checks',
  name: 'from its name',
  first: 'the first node, as nothing says otherwise',
};

export default function ServicesTab({
  serverConfig,
  liveServices,
  monitorNames,
  mapping = null,
  onSave,
  saving,
}) {
  const [openNode, setOpenNode] = useState(null);
  const [editing, setEditing] = useState(null);
  // Containers written per node in this visit: they stay per-node when the
  // last entry is cleared while the other node is offline (#636).
  const [sticky, setSticky] = useState(() => new Set());
  const markPerNode = (c) => setSticky((s) => (s.has(c) ? s : new Set(s).add(c)));

  // Until both are read the panel is there, reading.
  const loading = !serverConfig || !liveServices;
  const nodes = loading ? {} : liveServices.nodes || {};
  const overrides = serverConfig?.services || {};
  const found = mapping?.services || {};

  // Every row by its id, for the handlers.
  const rows = new Map();

  // The monitors no container carries, each on the node it is shown on: the
  // one services.yaml names (at once, before the next refresh), else the one
  // the last refresh chose.
  const monitorOnly = mapping?.monitorOnly || [];
  const monitorOnlyUids = new Set(monitorOnly.map((m) => m.uid));
  const nodeOfMonitor = (m) => {
    const set = monitorNodeSetting(serverConfig, m.monitor);
    return set && nodes[set] ? set : m.node;
  };

  const nodeVMs = Object.entries(nodes).map(([nodeKey, node]) => {
    const nodeName = node.display_name || nodeKey;
    const shown = (node.services || []).filter((svc) => !(svc.source === 'monitor' && monitorOnlyUids.has(svc.uid)));
    const containerServices = shown.map((svc) => {
      const container = svc.container;
      const id = `${nodeKey}:${container}`;
      rows.set(id, { nodeKey, container, nodeName });
      const override = overrides[container] || {};
      const perNode = isPerNode(serverConfig, liveServices, sticky, container);
      const choice = monitorChoice(serverConfig, container, nodeKey, perNode);
      const seen = found[svc.uid ?? `${nodeKey}:${container}`] || null;
      const [state, stateWord] = lampOf(svc.status);
      const name =
        (perNode ? effectiveText(serverConfig, container, nodeKey, 'display_name') : override.display_name) ||
        svc.display_name;

      // The tag follows the monitor the container carries by the matcher's own
      // answer (kept current after each save), else the board's `monitored`,
      // which is true only when a monitor is attached.
      let tag;
      if (choice === NO_MONITOR) tag = { kind: 'opted-out' };
      else if (seen) {
        tag = seen.attached
          ? { kind: seen.paused ? 'paused' : 'monitored', monitor: seen.attached }
          : { kind: 'none' };
      } else if (svc.monitored === true) {
        tag = { kind: 'monitored', monitor: choice !== AUTO_MATCH ? choice : null };
      } else tag = { kind: 'none' };

      const nameOfNode = (key) => nodes[key]?.display_name || key;
      const held = seen?.held || {};

      let editor = null;
      if (editing === id) {
        const items = [
          {
            value: AUTO_ITEM,
            label: seen?.suggested ? `Auto-match (${seen.suggested})` : 'Auto-match',
          },
          { value: NO_MONITOR, label: 'No monitor' },
          // A monitor another container's mapping holds can't be pinned twice.
          ...(monitorNames || []).map((m) =>
            held[m] && m !== choice
              ? { value: m, label: `${m} (mapped to ${held[m].container} on ${nameOfNode(held[m].node)})`, disabled: true }
              : { value: m, label: m }
          ),
        ];
        // A mapping to a monitor Kuma doesn't have still shows, as what it is.
        if (choice !== AUTO_MATCH && choice !== NO_MONITOR && !items.some((i) => i.value === choice)) {
          items.push({ value: choice, label: `${choice} (not in Uptime Kuma)` });
        }
        editor = {
          name: perNode
            ? effectiveText(serverConfig, container, nodeKey, 'display_name')
            : override.display_name || '',
          namePlaceholder: perNode ? defaultName(container) : svc.display_name,
          icon: perNode ? effectiveText(serverConfig, container, nodeKey, 'icon') : override.icon || '',
          monitor: choice === AUTO_MATCH ? AUTO_ITEM : choice,
          monitorItems: items,
          hint: perNode
            ? `This container runs on several nodes: the monitor is set for ${nodeName} only, and so are the display name and icon.`
            : undefined,
          suggestion: seen ? { monitor: seen.suggested, why: seen.why } : null,
          candidates: (seen?.candidates ?? []).map((c) =>
            held[c.name] ? { ...c, heldBy: { container: held[c.name].container, node: nameOfNode(held[c.name].node) } } : c
          ),
        };
      }
      return {
        id,
        sub: container,
        name,
        state,
        stateWord,
        hidden: isHidden(serverConfig, nodeKey, container),
        overridden: Object.keys(override).length > 0,
        tag,
        editing: editing === id,
        editor,
      };
    });

    const monitorRows = monitorOnly
      .filter((m) => nodeOfMonitor(m) === nodeKey)
      .map((m) => {
        const id = `monitor:${m.monitor}`;
        rows.set(id, { nodeKey, monitor: m.monitor, monitorOnly: true });
        const set = monitorNodeSetting(serverConfig, m.monitor);
        const [state, stateWord] = lampOf(m.status);
        let editor = null;
        if (editing === id) {
          const items = [
            { value: AUTO_ITEM, label: 'Automatic' },
            ...Object.entries(nodes).map(([key, n]) => ({ value: key, label: n.display_name || key })),
          ];
          // A node that is no longer on the board still shows, as what it is.
          if (set && !nodes[set]) items.push({ value: set, label: `${set} (not on the board)` });
          const placed = set && nodes[set] ? 'as set here' : (PLACED_BY[m.by] ?? PLACED_BY.first);
          editor = {
            node: {
              value: set ?? AUTO_ITEM,
              items,
              hint: `No container carries this monitor. Shown on ${nodeName}, ${placed}. Automatic looks at the address it checks, then its name.`,
            },
          };
        }
        return {
          id,
          sub: 'no container',
          name: m.monitor,
          state,
          stateWord,
          hidden: false,
          overridden: Boolean(set),
          tag: { kind: 'monitor-only' },
          editing: editing === id,
          editor,
          monitorOnly: true,
        };
      });
    const services = [...containerServices, ...monitorRows];
    return {
      key: nodeKey,
      name: nodeName,
      icon: <SettingsIcon value={node.icon} fallback="🖥" size={20} />,
      color: node.border_color,
      count: services.length,
      open: openNode === nodeKey,
      services,
    };
  });

  const save = (config) => onSave(config);
  const row = (id) => rows.get(id);

  const setMonitor = (id, value) => {
    const { nodeKey, container } = row(id);
    const choice = value === AUTO_ITEM ? AUTO_MATCH : value;
    if (isPerNode(serverConfig, liveServices, sticky, container)) {
      markPerNode(container);
      save(withNodeMonitor(serverConfig, liveServices, container, nodeKey, choice));
    } else {
      save(withMonitor(serverConfig, container, choice));
    }
  };

  const setNode = (id, value) => {
    const { monitor } = row(id);
    save(withMonitorNode(serverConfig, monitor, value === AUTO_ITEM ? null : value));
  };

  const setText = (id, field, value) => {
    const { nodeKey, container } = row(id);
    if (isPerNode(serverConfig, liveServices, sticky, container)) {
      markPerNode(container);
      save(withNodeText(serverConfig, liveServices, container, nodeKey, field, value));
    } else {
      save(withText(serverConfig, container, field, value));
    }
  };

  return (
    <ServiceMap
      id="services"
      className="settings-anchor"
      nodes={nodeVMs}
      saving={saving}
      loading={loading}
      onToggleNode={(key) => setOpenNode((k) => (k === key ? null : key))}
      onHide={(id) => {
        const { nodeKey, container } = row(id);
        save(withHidden(serverConfig, nodeKey, container));
      }}
      onEdit={(id) => setEditing((e) => (e === id ? null : id))}
      onName={(id, value) => setText(id, 'display_name', value)}
      onIcon={(id, value) => setText(id, 'icon', value)}
      onMonitor={setMonitor}
      onNode={setNode}
      onRemoveOverrides={(id) => {
        save(withoutOverrides(serverConfig, row(id).container));
        setEditing(null);
      }}
    />
  );
}
