import React from 'react';
import UsageBar from './UsageBar.jsx';
import StatusLamp from './StatusLamp.jsx';
import { nodeSeverity, nodeUpDown, parseMetricPct, thirdMetric, severityToShape, nodeSeverityWord } from '../data/derive.js';

/**
 * Compact node card. Header: node name (Outfit) + subtitle (mono) + resource
 * StatusLamp. Up/down count (down count red when > 0). CPU + MEM + third bar
 * (TEMP when the node reports temperature, else DISK). Tap → onTap(nodeKey).
 *
 * The lamp reflects RESOURCE-ONLY severity (cpu ≥ 90 or temp ≥ 75 → amber;
 * cool resources → green; no metrics → steel). A node hosting a down service
 * shows a red down-count but its lamp stays resource-colored — never red.
 */
export default function NodeCard({ nodeKey, node, onTap }) {
  const sev = nodeSeverity(node);
  const shape = severityToShape(sev);
  const sevWord = nodeSeverityWord(sev);
  const { up, down } = nodeUpDown(node);
  const m = node.metrics || {};
  const third = thirdMetric(m);
  return (
    <button type="button" className="node-card" onClick={() => onTap(nodeKey)} aria-label={`${node.display_name} detail`}>
      <div className="node-card__head">
        <span className="node-card__name">{node.display_name}</span>
        {node.subtitle ? <span className="node-card__type">{node.subtitle}</span> : null}
        <span className="node-card__lamp">
          <StatusLamp shape={shape} severity={sev} label={sevWord} size={14} />
        </span>
      </div>
      <div className="node-card__count">
        {up} up{down > 0 && ' / '}{down > 0 && (
          <span className="node-card__down-count" style={{ color: 'var(--red)' }}>{down} down</span>
        )}
      </div>
      <div className="node-card__bars">
        <UsageBar label="CPU" value={m.cpu} unit="%" percent={parseMetricPct(m.cpu)} />
        <UsageBar label="MEM" value={m.memPercent} unit="%" percent={parseMetricPct(m.memPercent)} />
        <UsageBar label={third.label} value={third.value} unit={third.unit} percent={third.percent} />
      </div>
    </button>
  );
}
