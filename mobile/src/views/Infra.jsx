import React from 'react';
import NodeCard from '../components/NodeCard.jsx';
import { groupByNode } from '../data/derive.js';

export default function Infra({ data, nav }) {
  const nodes = groupByNode(data.servicesBody);
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
