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
  withHidden,
  withMonitor,
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
 * The row's tag follows the monitor the container really carries
 * (`svc.monitored`, which the server sets only when a monitor is attached),
 * never its own state: a running container with no monitor reads "no monitor".
 */

// The Select's value for Auto-match: a Select has no empty choice of its own.
const AUTO_ITEM = '__auto__';

const LAMP = { up: ['ok', 'Up'], down: ['crit', 'Down'] };
const lampOf = (status) => LAMP[status] ?? ['unknown', 'No signal'];

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

  const nodeVMs = Object.entries(nodes).map(([nodeKey, node]) => {
    const nodeName = node.display_name || nodeKey;
    const services = (node.services || []).map((svc) => {
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

      let tag;
      if (choice === NO_MONITOR) tag = { kind: 'opted-out' };
      else if (svc.monitored === true) {
        tag = { kind: 'monitored', monitor: seen?.attached ?? (choice !== AUTO_MATCH ? choice : null) };
      } else tag = { kind: 'none' };

      let editor = null;
      if (editing === id) {
        const items = [
          {
            value: AUTO_ITEM,
            label: seen?.suggested ? `Auto-match (${seen.suggested})` : 'Auto-match',
          },
          { value: NO_MONITOR, label: 'No monitor' },
          ...(monitorNames || []).map((m) => ({ value: m, label: m })),
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
          candidates: seen?.candidates ?? [],
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
      onRemoveOverrides={(id) => {
        save(withoutOverrides(serverConfig, row(id).container));
        setEditing(null);
      }}
    />
  );
}
