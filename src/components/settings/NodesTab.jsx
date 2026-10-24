import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { FieldRow } from './Field';
import ColorPickerPopover, { DEFAULT_COLOR } from './ColorPickerPopover.jsx';
import { UiButton } from './primitives.jsx';
import { apiFetch, isReadOnlyServer } from '../../api/client.js';
import { moveKey, orderNodes } from '../../shell/nodeOrder.js';

/**
 * NodesTab — Phase 2 Settings
 * 
 * Manages node definitions from services.yaml.
 * Each node maps to a Prometheus node label and controls:
 * - Display name, subtitle (the node's role), border color. No icon: the
 *   Overview marks a node by its name, its role and its colour (#306, Jag);
 *   a node's old `icon` is dropped at the next save (SettingsView.jsx).
 * - Visibility toggle
 * - Auto-discover toggle
 * - Hide list (containers to exclude from this node)
 * - Find nodes (#572): asks Prometheus now and adds the nodes the file lacks
 *   (never removing or changing one) through `onSave`. The guided first run
 *   reuses this tab, so it has the button whenever it shows the tab (not
 *   while the first boot still waits for nodes, SetupWizard's NodesStep).
 *
 * - Order (#667): Move up / Move down on each row, when `onOrder` is given
 *   (Settings; the guided first run has no display config to save it in).
 *   `order` is the saved `nodeOrder`; the rows show the order every screen
 *   uses (orderNodes), and `onOrder(key, step)` is asked to move that node a place
 *   (-1 up, 1 down) from the order as it is when the move runs. The
 *   first row can't move up, the last can't move down; each move is said in
 *   a polite live region ("Proxmox moved to position 1 of 6").
 *
 * `discovery` is the live services payload's (#566): 'waiting' while the
 * first boot, with no services.yaml yet, asks Prometheus for nodes each
 * refresh. It picks the words shown with no nodes (NoNodes).
 */
export default function NodesTab({ serverConfig, onSave, saving, discovery, order, onOrder }) {
  const nodes = serverConfig?.nodes || {};
  const keys = orderNodes(Object.keys(nodes), order);
  const [moved, setMoved] = useState('');
  const refocus = useRef(null); // { key, step }: the button just used
  const rows = useRef(null);
  const [editNode, setEditNode] = useState(null);
  const [colorPicking, setColorPicking] = useState(null);

  const updateNode = (nodeKey, field, value) => {
    const updated = {
      ...serverConfig,
      nodes: {
        ...serverConfig.nodes,
        [nodeKey]: {
          ...serverConfig.nodes[nodeKey],
          [field]: value,
        },
      },
    };
    onSave(updated);
  };

  const removeHideItem = (nodeKey, item) => {
    const node = serverConfig.nodes[nodeKey];
    const updated = (node.hide || []).filter(h => h !== item);
    updateNode(nodeKey, 'hide', updated);
  };

  const addHideItem = (nodeKey, item) => {
    if (!item.trim()) return;
    const node = serverConfig.nodes[nodeKey];
    const current = node.hide || [];
    if (current.includes(item.trim())) return;
    updateNode(nodeKey, 'hide', [...current, item.trim()]);
  };

  const applyColor = (color) => {
    if (colorPicking) {
      updateNode(colorPicking, 'border_color', color);
      setColorPicking(null);
    }
  };

  // A move keeps focus on the row's button. Reordering the rows moves their
  // DOM nodes and Chromium drops focus to the page, so once the order has
  // changed the button just used gets it back; a row that has reached an end
  // has that button off, so focus goes to the other.
  const signature = keys.join('\n');
  useEffect(() => {
    const asked = refocus.current;
    if (!asked) return;
    refocus.current = null;
    const row = rows.current?.querySelector(`[data-node-row="${CSS.escape(asked.key)}"]`);
    const same = row?.querySelector(`[data-move="${asked.step}"]`);
    (same && !same.disabled ? same : row?.querySelector(`[data-move="${-asked.step}"]`))?.focus();
  }, [signature]);

  const move = (key, step) => {
    const next = moveKey(keys, key, step);
    if (!next) return;
    onOrder(key, step);
    const at = next.indexOf(key) + 1;
    refocus.current = { key, step };
    setMoved(`${nodes[key]?.display_name || key} moved to position ${at} of ${next.length}`);
  };

  return (
    <div>
      <p className="settings-desc" style={{ marginBottom: 16 }}>
        Nodes are auto-discovered from Prometheus. Customize how each node appears on the dashboard.
      </p>

      {saving && (
        <div className="settings-saving" style={{ marginBottom: 12 }}>
          Saving...
        </div>
      )}

      <FindNodes serverConfig={serverConfig} onSave={onSave} />

      {colorPicking && (
        <div style={{ marginBottom: 20, padding: 16, background: 'var(--bg-card-inner)', borderRadius: 14, border: '1px solid var(--border-color)' }}>
          <ColorPickerPopover
            value={nodes[colorPicking]?.border_color || DEFAULT_COLOR}
            onApply={applyColor}
            onCancel={() => setColorPicking(null)}
          />
        </div>
      )}

      <div ref={rows}>
      {keys.map((key, at) => { const node = nodes[key]; return (
        <div key={key} data-node-row={key} style={{
          marginBottom: 12, padding: '16px 18px',
          background: 'var(--bg-card-inner)', borderRadius: 14,
          border: `1px solid ${editNode === key ? 'var(--accent)' : 'var(--border-color)'}`,
          borderLeft: `3px solid ${node.border_color || DEFAULT_COLOR}`,
          transition: 'border-color 0.2s',
        }}>
          {/* Node header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: editNode === key ? 14 : 0 }}>
            <input
              type="checkbox"
              checked={node.visible !== false}
              onChange={e => updateNode(key, 'visible', e.target.checked)}
              className="settings-checkbox"
            />
            <div className="flex-1">
              <div className="settings-item-title" style={{ fontSize: 15 }}>
                {node.display_name || key}
              </div>
              <div className="settings-item-subtitle">
                {node.subtitle || ''} · prometheus: {node.prometheus_node || key}
              </div>
            </div>
            <div
              className="settings-color-swatch"
              style={{ width: 26, height: 26, borderRadius: 6, background: node.border_color || DEFAULT_COLOR }}
              onClick={() => setColorPicking(key)}
              title="Border color"
            />
            {onOrder && (
              <>
                <UiButton
                  variant="ghost"
                  size="sm"
                  data-move="-1"
                  aria-label={`Move ${node.display_name || key} up`}
                  title="Move up"
                  disabled={at === 0}
                  onClick={() => move(key, -1)}
                >
                  <ChevronUp size={16} aria-hidden="true" />
                </UiButton>
                <UiButton
                  variant="ghost"
                  size="sm"
                  data-move="1"
                  aria-label={`Move ${node.display_name || key} down`}
                  title="Move down"
                  disabled={at === keys.length - 1}
                  onClick={() => move(key, 1)}
                >
                  <ChevronDown size={16} aria-hidden="true" />
                </UiButton>
              </>
            )}
            <UiButton
              variant="ghost"
              size="sm"
              tone="accent"
              onClick={() => setEditNode(editNode === key ? null : key)}
            >
              {editNode === key ? 'Close' : 'Edit'}
            </UiButton>
          </div>

          {/* Expanded edit form */}
          {editNode === key && (
            <div className="settings-stack" style={{ gap: 10 }}>
              <FieldRow label="Display Name">
                <input
                  className="settings-input"
                  value={node.display_name || ''}
                  onChange={e => updateNode(key, 'display_name', e.target.value)}
                  placeholder={key}
                />
              </FieldRow>
              <FieldRow label="Subtitle">
                <input
                  className="settings-input"
                  value={node.subtitle || ''}
                  onChange={e => updateNode(key, 'subtitle', e.target.value)}
                  placeholder="e.g. Raspberry Pi 5"
                />
              </FieldRow>
              <FieldRow label="Prometheus Node Label">
                <input
                  className="settings-input mono"
                  value={node.prometheus_node || ''}
                  onChange={e => updateNode(key, 'prometheus_node', e.target.value)}
                  placeholder={key}
                />
              </FieldRow>

              <label className="settings-checkbox-label" style={{ gap: 12 }}>
                <input
                  type="checkbox"
                  checked={node.auto_discover !== false}
                  onChange={e => updateNode(key, 'auto_discover', e.target.checked)}
                  className="settings-checkbox"
                  style={{ width: 16, height: 16 }}
                />
                <span className="settings-checkbox-text" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  Auto-discover new containers
                </span>
              </label>

              {/* Hide list */}
              <div>
                <span className="settings-item-subtitle" style={{ letterSpacing: 0.5 }}>
                  HIDDEN CONTAINERS
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {(node.hide || []).map((h, i) => (
                    <span key={i} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '4px 10px', borderRadius: 6, fontSize: 12,
                      fontFamily: 'var(--font-mono)',
                      background: 'var(--red-bg)', color: 'var(--red)',
                      border: '1px solid var(--red-border)',
                    }}>
                      {h}
                      <span
                        style={{ cursor: 'pointer', opacity: 0.7, marginLeft: 2 }}
                        onClick={() => removeHideItem(key, h)}
                      >✕</span>
                    </span>
                  ))}
                  <AddChip onAdd={(val) => addHideItem(key, val)} placeholder="+ container name" />
                </div>
              </div>
            </div>
          )}
        </div>
      ); })}
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {moved}
      </span>

      {Object.keys(nodes).length === 0 && <NoNodes discovery={discovery} />}
    </div>
  );
}

/**
 * What Nodes says with no nodes, true either way (#566). While the first
 * boot waits, the nodes come by themselves once Prometheus has some.
 * Otherwise nothing is discovering: services.yaml is there (a save in
 * Settings, a hand edit), so its nodes are the user's, or the first boot
 * couldn't ask (PROMETHEUS_URL refused), which only a fix and a restart mend.
 */
function NoNodes({ discovery }) {
  return (
    <div className="settings-loading" style={{ justifyContent: 'center', fontSize: 13 }}>
      {discovery === 'waiting'
        ? 'No nodes yet. JagHelm asks Prometheus again every refresh and adds them as soon as it has some: make sure Prometheus is reachable and scraping your hosts.'
        : 'No nodes. Find nodes asks Prometheus for them now. JagHelm otherwise discovers them only when it starts with no services.yaml: add them to services.yaml by hand, or, if PROMETHEUS_URL is wrong, fix it and restart.'}
    </div>
  );
}

/** Whether `nodes` already has a node for Prometheus label `key`: keyed by it, or mapped to it (hidden ones count). */
const hasNodeFor = (nodes, key) =>
  Object.hasOwn(nodes, key) || Object.values(nodes).some((n) => n?.prometheus_node === key);

const plural = (n) => `${n} node${n === 1 ? '' : 's'}`;

/**
 * Find nodes (#572): the file's nodes are the user's once saved, so a first
 * boot that saved none (Settings saved during its wait) leaves discovery
 * never to run again. This asks the server to look (POST
 * /api/services/nodes/find; nothing is written by it), lists the nodes the
 * file lacks, and on Add saves them with the tab's ordinary `onSave` over the
 * version Settings read: a file that moved is the usual refused save and
 * reload. It adds only; no node is removed, renamed or edited.
 */
function FindNodes({ serverConfig, onSave }) {
  // null; { looking }; { found: {key: node} }; { message, bad? }
  const [state, setState] = useState(null);
  const nodes = serverConfig?.nodes || {};
  const box = useRef(null);
  // Add and Cancel unmount the button that has focus: put it back on Find nodes.
  const refocus = () => box.current?.querySelector('button')?.focus();

  const find = async () => {
    if (isReadOnlyServer()) {
      setState({ message: 'No new nodes (this is a read-only demo)' });
      return;
    }
    setState({ looking: true });
    try {
      const r = await apiFetch('/api/services/nodes/find', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(20_000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const hint = data?.code === 'prometheus_unset' ? '. Set PROMETHEUS_URL in .env and restart JagHelm.' : '';
        setState({ message: (data?.error || `Couldn't look for nodes (HTTP ${r.status})`) + hint, bad: true });
        return;
      }
      const found = Object.fromEntries(
        Object.entries(data?.nodes || {}).filter(([key, n]) => !hasNodeFor(nodes, key) && !hasNodeFor(nodes, n?.prometheus_node ?? key))
      );
      setState(Object.keys(found).length ? { found } : { message: 'No new nodes' });
    } catch (err) {
      const slow = err?.name === 'TimeoutError';
      setState({ message: slow ? "JagHelm didn't answer in time." : "Couldn't reach JagHelm to look for nodes.", bad: true });
    }
  };

  const add = () => {
    // Against the screen as it is now: a node added meanwhile is not added twice.
    const fresh = Object.entries(state.found).filter(([key, n]) => !hasNodeFor(nodes, key) && !hasNodeFor(nodes, n?.prometheus_node ?? key));
    setState(fresh.length ? { message: `Added ${plural(fresh.length)}` } : null);
    if (fresh.length) onSave({ ...serverConfig, nodes: { ...nodes, ...Object.fromEntries(fresh) } });
    refocus();
  };

  const count = state?.found ? Object.keys(state.found).length : 0;
  return (
    <div style={{ marginBottom: 16 }} ref={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <UiButton variant="secondary" size="sm" onClick={find} disabled={!!state?.looking}>
          Find nodes
        </UiButton>
        <span className="settings-item-subtitle" role="status" aria-live="polite" style={state?.bad ? { color: 'var(--red)' } : undefined}>
          {state?.looking && 'Asking Prometheus...'}
          {state?.message}
          {state?.found && `Found ${plural(count)}: ${Object.keys(state.found).join(', ')}`}
        </span>
        {state?.found && (
          <>
            <UiButton variant="primary" size="sm" onClick={add}>
              Add {plural(count)}
            </UiButton>
            <UiButton variant="ghost" size="sm" onClick={() => { setState(null); refocus(); }}>
              Cancel
            </UiButton>
          </>
        )}
      </div>
    </div>
  );
}

function AddChip({ onAdd, placeholder }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  if (!editing) {
    return (
      <span
        onClick={() => setEditing(true)}
        style={{
          display: 'inline-flex', alignItems: 'center',
          padding: '4px 10px', borderRadius: 6, fontSize: 12,
          fontFamily: 'var(--font-mono)', cursor: 'pointer',
          background: 'var(--bg-card-inner)', color: 'var(--text-muted)',
          border: '1px dashed var(--border-color)',
        }}
      >
        {placeholder}
      </span>
    );
  }

  return (
    <input
      autoFocus
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter' && value.trim()) { onAdd(value.trim()); setValue(''); setEditing(false); }
        if (e.key === 'Escape') { setValue(''); setEditing(false); }
      }}
      onBlur={() => { if (value.trim()) onAdd(value.trim()); setValue(''); setEditing(false); }}
      style={{
        padding: '4px 10px', borderRadius: 6, fontSize: 12,
        fontFamily: 'var(--font-mono)', width: 140,
        background: 'var(--bg-card-inner)', color: 'var(--text-primary)',
        border: '1px solid var(--accent)', outline: 'none',
      }}
      placeholder="container name"
    />
  );
}
