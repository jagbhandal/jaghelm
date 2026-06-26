import React from 'react';
import UsageBar from './UsageBar.jsx';
import { nodeUpDown, parseMetricPct, thirdMetric } from '../data/derive.js';

/**
 * Compact node card. Shows CPU + MEM always; the third bar is TEMP when the node
 * reports a temperature (the Pi), else DISK. Tap → onTap(nodeKey).
 */
export default function NodeCard({ nodeKey, node, onTap }) {
  const { up, down } = nodeUpDown(node);
  const m = node.metrics || {};
  const third = thirdMetric(m);
  return (
    <button type="button" className="node-card" onClick={() => onTap(nodeKey)} aria-label={`${node.display_name} detail`}>
      <div className="node-card__head">
        <span className="node-card__name">{node.display_name}</span>
        {node.subtitle ? <span className="node-card__type">{node.subtitle}</span> : null}
      </div>
      <div className="node-card__count">{up} up{down ? ` / ${down} down` : ''}</div>
      <div className="node-card__bars">
        <UsageBar label="CPU" value={m.cpu} unit="%" percent={parseMetricPct(m.cpu)} />
        <UsageBar label="MEM" value={m.memPercent} unit="%" percent={parseMetricPct(m.memPercent)} />
        <UsageBar label={third.label} value={third.value} unit={third.unit} percent={third.percent} />
      </div>
    </button>
  );
}
