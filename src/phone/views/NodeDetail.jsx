import React, { useId } from 'react';
import BackHeader from '../components/BackHeader.jsx';
import {
  DetailLoading,
  DetailStatus,
  DetailTitle,
  DetailUnreachable,
} from '../components/DetailParts.jsx';
import { detailLoading, sinceLine } from '../data/detail.js';
import ServiceRow from '../components/ServiceRow.jsx';
import { MetricMeter } from '@ui/metric-meter';
import { DetailFacts, DetailSections, DetailUnread } from '@ui/entity-detail';
import { FRESH, nodeCardsOf, serviceRowsOf } from '../data/board.js';
import { useStatusAt } from '../../shell/statusFreshness.js';
import IncidentDetail from './IncidentDetail.jsx';

/**
 * A tapped push's node (#309, its `type` in the params) the model doesn't
 * have: Incident detail, the push's own event, as before #309.
 */
function PushedElsewhere({ data, nav, params }) {
  return (
    <IncidentDetail data={data} nav={nav} params={{ ...params, id: `nodes/${params.nodeKey}` }} />
  );
}

/**
 * NodeDetail — the node as the status model has it (#325): its lamp and word,
 * its hosted services counted by the model (the down count red, steel while
 * the status is stale), its reason when it isn't healthy,
 * the metric bars (CPU, MEM, TEMP when the node has a temperature, DISK), each
 * coloured by the model's level for it, and its services, worst first. The
 * card has room for three bars and swaps TEMP for DISK when the disk is over
 * a line (data/board.js); this screen shows all four, so the temperature
 * behind an amber lamp is never hidden (#273).
 * A node the model doesn't have → "This node is no longer monitored.", as
 * the web's drawer says it (#309).
 *
 * The Phone board's sheet (#303): Back and "Node" over its
 * name and where it is, the status box (the model's word, its reason when it
 * isn't healthy, how long it has been so, the hosted services), a meter for
 * every reading the model judged, two to a row, as the node's card draws
 * them, then its services as the shared rows, each opening the service over
 * this sheet. Under the meters, what the desktop's drawer adds
 * (#310, `data.extras`, src/shell/PhoneDetail.jsx): the uptime, memory and
 * disk in units, and on a Proxmox node its virtual machines, storage pools
 * and last backup. Drawn before the status and the cards have answered, it
 * waits for them; with no status to read, it says why.
 *
 * `charts` (#602): the node's history, the drawer's charts (Usage and
 * Temperature, 1 h / 24 h / 7 d), as its screen gives them (PhoneDetail.jsx),
 * drawn as the drawer draws them, under the status box.
 */
export default function NodeDetail({ data, nav, params, charts = null, logs = null }) {
  const listId = useId();
  const at = useStatusAt(data.updated);
  if (detailLoading(data)) return <DetailLoading kind="Node" onBack={nav.pop} />;
  if (!data.status) return <DetailUnreachable kind="Node" onBack={nav.pop} data={data} />;
  const freshness = data.freshness ?? FRESH;
  const node = nodeCardsOf({
    status: data.status,
    servicesBody: data.servicesBody,
    freshness,
  }).find((n) => n.key === params.nodeKey);
  if (!node && params.type) return <PushedElsewhere data={data} nav={nav} params={params} />;
  if (!node) {
    return (
      <>
        <BackHeader kind="Node" onBack={nav.pop} />
        <div className="flex flex-col gap-4 p-4">
          <DetailTitle title="Node" />
          <p className="text-text-2">This node is no longer monitored.</p>
        </div>
      </>
    );
  }
  const services = serviceRowsOf({
    status: data.status,
    servicesBody: data.servicesBody,
    freshness,
    nodeKey: params.nodeKey,
  });
  const where = [node.host, node.subtitle].filter(Boolean).join(' · ');
  return (
    <>
      <BackHeader kind="Node" onBack={nav.pop} />
      <div className="flex flex-col gap-4 p-4">
        <DetailTitle title={node.name} where={where} />
        <DetailStatus
          state={node.state}
          word={node.word}
          reason={node.reason}
          since={sinceLine(
            data.status.entities.find((e) => e.id === node.id)?.since,
            at,
            freshness
          )}
          note={node.services}
        />
        {charts}
        {node.readings.length > 0 && (
          <div data-slot="node-meters" className="grid grid-cols-2 gap-x-4 gap-y-3">
            {node.readings.map((r) => (
              <MetricMeter
                key={r.key}
                data-reading={r.key}
                label={r.label}
                value={r.value}
                unit={r.unit}
                max={r.max}
                state={r.state ?? undefined}
                warn={r.warn}
                crit={r.crit}
                band={r.band}
              />
            ))}
          </div>
        )}
        <DetailFacts facts={data.extras?.facts} lastKnown={data.extras?.lastKnown} />
        <DetailSections sections={data.extras?.sections} muted={Boolean(data.extras?.lastKnown)} />
        {logs}
        <DetailUnread unread={data.extras?.unread} />
        {services.length > 0 && (
          <section aria-labelledby={listId} className="flex flex-col gap-2">
            <h3 id={listId} className="text-overline text-text-3 uppercase">
              Services
            </h3>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-1">
              {services.map((s) => (
                <li key={s.uid}>
                  <ServiceRow service={s} onTap={() => nav.push('serviceDetail', { uid: s.uid })} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
