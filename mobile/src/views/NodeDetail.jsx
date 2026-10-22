import React from 'react';
import BackHeader from '../components/BackHeader.jsx';
import UsageBar from '../components/UsageBar.jsx';
import ServiceRow from '../components/ServiceRow.jsx';
import { StatusLamp } from '@ui/status-lamp';
import { StatusWord } from '@ui/status-word';
import { FRESH, colourOf, nodeCardsOf, serviceRowsOf } from '../data/board.js';

/**
 * NodeDetail — the node as the status model has it (#325): its lamp and word,
 * its hosted services counted by the model (the down count red, steel while
 * the status is stale), its reason when it isn't healthy,
 * the metric bars (CPU, MEM, TEMP when the node has a temperature, DISK), each
 * coloured by the model's level for it, and its services, worst first. The
 * card has room for three bars and swaps TEMP for DISK when the disk is over
 * a line (data/board.js); this screen shows all four, so the temperature
 * behind an amber lamp is never hidden (#273).
 * A node the model doesn't have → "This node is no longer reported."
 */
export default function NodeDetail({ data, nav, params }) {
  const freshness = data.freshness ?? FRESH;
  const node = data.status
    ? nodeCardsOf({ status: data.status, servicesBody: data.servicesBody, freshness }).find(
        (n) => n.key === params.nodeKey
      )
    : null;
  if (!node) {
    return (
      <section className="mobile-view" aria-label="Node detail">
        <BackHeader title="Node" onBack={nav.pop} />
        <p className="mobile-view__todo">This node is no longer reported.</p>
      </section>
    );
  }
  const { total, up, down } = node.serviceCounts;
  const services = serviceRowsOf({
    status: data.status,
    servicesBody: data.servicesBody,
    freshness,
    nodeKey: params.nodeKey,
  });
  return (
    <section className="mobile-view" aria-label="Node detail">
      <BackHeader title={node.name} onBack={nav.pop} />
      <div className="node-detail__head">
        <StatusLamp state={node.state} label={node.word} size={18} />
        <StatusWord word={node.word} state={node.state} />
        <span className="node-detail__count">
          {total === 0 ? (
            node.services
          ) : (
            <>
              {up} / {total} {total === 1 ? 'service' : 'services'} up
              {down > 0 && ' · '}
              {down > 0 && (
                <span className="node-detail__down-count" style={{ color: colourOf(node.downState) }}>{down} down</span>
              )}
            </>
          )}
        </span>
      </div>
      {node.reason && <p className="detail-cause">{node.reason}</p>}
      <div className="node-detail__bars">
        {node.detailBars.map((bar) => (
          <UsageBar key={bar.key} label={bar.label} shown={bar.shown} percent={bar.percent} state={bar.state} />
        ))}
      </div>
      <div className="svc-list">
        {services.map((s) => (
          <ServiceRow key={s.uid} service={s} onTap={() => nav.push('serviceDetail', { uid: s.uid })} />
        ))}
      </div>
    </section>
  );
}
