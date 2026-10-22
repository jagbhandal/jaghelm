import React from 'react';
import NodeCard from '../components/NodeCard.jsx';
import { FRESH, nodeCardsOf } from '../data/board.js';

/**
 * Infra screen — the ONLY place per-node metric bars live (spec §7.4, Bug #10).
 * A NodeCard per node the status model has (#325), in services.yaml's order:
 * the model's lamp and word, its hosted services count, CPU/MEM/third bars.
 */
export default function Infra({ data, nav }) {
  const nodes = data.status
    ? nodeCardsOf({ status: data.status, servicesBody: data.servicesBody, freshness: data.freshness ?? FRESH })
    : [];
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
        {nodes.map((node) => (
          <NodeCard key={node.key} node={node} onTap={(k) => nav.push('node', { nodeKey: k })} />
        ))}
      </div>
    </section>
  );
}
