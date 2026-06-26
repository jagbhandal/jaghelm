import React from 'react';
import BackHeader from '../components/BackHeader.jsx';
import UsageBar from '../components/UsageBar.jsx';
import ServiceRow from '../components/ServiceRow.jsx';
import { sortProblemsFirst, parseMetricPct, thirdMetric } from '../data/derive.js';

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
  const m = node.metrics || {};
  const third = thirdMetric(m);
  const services = sortProblemsFirst((node.services || []).map((s) => ({ ...s, nodeKey: params.nodeKey, nodeName: node.display_name || params.nodeKey })));
  return (
    <section className="mobile-view" aria-label="Node detail">
      <BackHeader title={node.display_name} onBack={nav.pop} />
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
