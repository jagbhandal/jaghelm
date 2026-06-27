import React from 'react';
import NodeCard from '../components/NodeCard.jsx';
import { groupByNode } from '../data/derive.js';

/**
 * Infra screen — the ONLY place per-node metric bars live (spec §7.4, Bug #10).
 * Renders a NodeCard per node with resource lamp + up/down count + CPU/MEM/third bars.
 */
export default function Infra({ data, nav }) {
  const nodes = groupByNode(data.servicesBody);
  if (nodes.length === 0) {
    return (
      <section className="mobile-view" aria-label="Infra">
        <h1>Infra</h1>
        <p className="mobile-view__empty">No nodes reported.</p>
      </section>
    );
  }
  return (
    <section className="mobile-view" aria-label="Infra">
      <h1>Infra</h1>
      <div className="node-grid">
        {nodes.map(({ nodeKey, node }) => (
          <NodeCard key={nodeKey} nodeKey={nodeKey} node={node} onTap={(k) => nav.push('node', { nodeKey: k })} />
        ))}
      </div>
    </section>
  );
}
