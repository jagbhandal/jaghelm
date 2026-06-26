import React, { useState, useMemo } from 'react';
import SubsystemStrip from '../components/SubsystemStrip.jsx';
import IncidentCard from '../components/IncidentCard.jsx';
import UsageBar from '../components/UsageBar.jsx';
import StatusBanner from '../components/StatusBanner.jsx';
import { deriveSubsystems, deriveIncidents, groupByNode, nodeUpDown, parseMetricPct } from '../data/derive.js';
import { openTarget } from '../open.js';

const DEFAULT_EXPANDED = 2;

export default function Overview({ data, nav }) {
  const { servicesBody, ups, cron, loading, error } = data;
  const [showAll, setShowAll] = useState(false);
  const cells = useMemo(() => deriveSubsystems({ services: servicesBody, ups, cron }), [servicesBody, ups, cron]);
  const incidents = useMemo(() => deriveIncidents({ services: servicesBody, ups, cron }), [servicesBody, ups, cron]);
  const shown = showAll ? incidents : incidents.slice(0, DEFAULT_EXPANDED);
  const extra = incidents.length - shown.length;
  const nodes = useMemo(() => groupByNode(servicesBody), [servicesBody]);

  return (
    <section className="mobile-view" aria-label="Overview">
      <h1>Overview</h1>
      <StatusBanner loading={loading} error={error} hasData={!!servicesBody} />
      <SubsystemStrip cells={cells} />

      {incidents.length > 0 && (
        <div className="overview-incidents">
          {shown.map((inc) => (
            <IncidentCard key={inc.id} incident={inc} onOpen={openTarget} />
          ))}
          {!showAll && extra > 0 && (
            <button type="button" className="overview-more" onClick={() => setShowAll(true)}>
              +{extra} more
            </button>
          )}
        </div>
      )}

      <div className="overview-nodes">
        {nodes.map(({ nodeKey, node }) => {
          const { up, down } = nodeUpDown(node);
          return (
            <button key={nodeKey} type="button" className="node-row" onClick={() => nav.push('node', { nodeKey })}>
              <div className="node-row__head">
                <span className="node-row__name">{node.display_name}</span>
                <span className="node-row__count">{up} up{down ? ` / ${down} down` : ''}</span>
              </div>
              <div className="node-row__bars">
                <UsageBar label="CPU" value={node.metrics?.cpu} unit="%" percent={parseMetricPct(node.metrics?.cpu)} />
                <UsageBar label="MEM" value={node.metrics?.memPercent} unit="%" percent={parseMetricPct(node.metrics?.memPercent)} />
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
