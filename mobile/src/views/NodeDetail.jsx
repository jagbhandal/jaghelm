import React from 'react';
import BackHeader from '../components/BackHeader.jsx';
import UsageBar from '../components/UsageBar.jsx';
import ServiceRow from '../components/ServiceRow.jsx';
import StatusLamp from '../components/StatusLamp.jsx';
import StatusWord from '../components/StatusWord.jsx';
import { nodeSeverity, nodeUpDown, sortProblemsFirst, parseMetricPct, thirdMetric, severityToShape, nodeSeverityWord } from '../data/derive.js';

/**
 * NodeDetail — status header (resource lamp + word + up/down count) + 3 metric
 * bars (CPU / MEM / TEMP-or-DISK via thirdMetric) + worst-first service list.
 * Missing node → "This node is no longer reported."
 */
export default function NodeDetail({ data, nav, params }) {
  const node = data.servicesBody?.nodes?.[params.nodeKey];
  if (!node) {
    return (
      <section className="mobile-view" aria-label="Node detail">
        <BackHeader title="Node" onBack={nav.pop} />
        <p className="mobile-view__todo">This node is no longer reported.</p>
      </section>
    );
  }
  const sev = nodeSeverity(node);
  const shape = severityToShape(sev);
  const sevWord = nodeSeverityWord(sev);
  const { up, down } = nodeUpDown(node);
  const m = node.metrics || {};
  const third = thirdMetric(m);
  const services = sortProblemsFirst((node.services || []).map((s) => ({ ...s, nodeKey: params.nodeKey, nodeName: node.display_name || params.nodeKey })));
  return (
    <section className="mobile-view" aria-label="Node detail">
      <BackHeader title={node.display_name} onBack={nav.pop} />
      <div className="node-detail__head">
        <StatusLamp shape={shape} severity={sev} label={sevWord} size={18} />
        <StatusWord word={sevWord} severity={sev} />
        <span className="node-detail__count">
          {up} up{down > 0 && ' / '}{down > 0 && (
            <span className="node-detail__down-count" style={{ color: 'var(--red)' }}>{down} down</span>
          )}
        </span>
      </div>
      <div className="node-detail__bars">
        <UsageBar label="CPU" value={m.cpu} unit="%" percent={parseMetricPct(m.cpu)} />
        <UsageBar label="MEM" value={m.memPercent} unit="%" percent={parseMetricPct(m.memPercent)} />
        <UsageBar label={third.label} value={third.value} unit={third.unit} percent={third.percent} />
      </div>
      <div className="svc-list">
        {services.map((s) => (
          <ServiceRow key={s.uid} service={s} onTap={() => nav.push('serviceDetail', { uid: s.uid })} />
        ))}
      </div>
    </section>
  );
}
