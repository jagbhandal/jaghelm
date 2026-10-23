import React, { useId } from 'react';
import BackHeader from '../components/BackHeader.jsx';
import {
  DetailLoading,
  DetailStatus,
  DetailTitle,
  DetailUnreachable,
} from '../components/DetailParts.jsx';
import { detailLoading, sinceLine } from '../data/detail.js';
import { AndroidLoading } from '../components/AndroidLoading.jsx';
import UsageBar from '../components/UsageBar.jsx';
import ServiceRow from '../components/ServiceRow.jsx';
import { MetricMeter } from '@ui/metric-meter';
import { DetailFacts, DetailSections, DetailUnread } from '@ui/entity-detail';
import { StatusLamp } from '@ui/status-lamp';
import { StatusWord } from '@ui/status-word';
import { FRESH, colourOf, nodeCardsOf, serviceRowsOf } from '../data/board.js';
import { useStatusAt } from '../../shell/statusFreshness.js';
import IncidentDetail from './IncidentDetail.jsx';

/**
 * NodeDetail — the node as the status model has it (#325): its lamp and word,
 * its hosted services counted by the model (the down count red, steel while
 * the status is stale), its reason when it isn't healthy,
 * the metric bars (CPU, MEM, TEMP when the node has a temperature, DISK), each
 * coloured by the model's level for it, and its services, worst first. The
 * card has room for three bars and swaps TEMP for DISK when the disk is over
 * a line (data/board.js); this screen shows all four, so the temperature
 * behind an amber lamp is never hidden (#273).
 * A node the model doesn't have → "This node is no longer reported." (the
 * web look: "no longer monitored", as the web's drawer says it, #309).
 *
 * The web look (#303), the Phone board's sheet: Back and "Node" over its
 * name and where it is, the status box (the model's word, its reason when it
 * isn't healthy, how long it has been so, the hosted services), a meter for
 * every reading the model judged, two to a row, as the node's card draws
 * them, then its services as the shared rows, each opening the service over
 * this sheet. On the web, under the meters, what the desktop's drawer adds
 * (#310, `data.extras`, src/shell/PhoneDetail.jsx): the uptime, memory and
 * disk in units, and on a Proxmox node its virtual machines, storage pools
 * and last backup. Drawn before the status and the cards have answered, it
 * waits for them; with no status to read, it says why.
 *
 * `charts` (#602): the node's history, the drawer's charts (Usage and
 * Temperature, 1 h / 24 h / 7 d), as its screen gives them (the web's
 * PhoneDetail.jsx, the Android app's DetailHistory.jsx), drawn as the drawer
 * draws them: on the web under the status box; on Android under the bars,
 * above the services.
 */
export default function NodeDetail(props) {
  if (__ANDROID_LOOK__) return <AndroidNodeDetail {...props} />;
  return <WebNodeDetail {...props} />;
}

/**
 * A tapped push's node (#309, its `type` in the params) the model doesn't
 * have: Incident detail, the push's own event, as before #309.
 */
function PushedElsewhere({ data, nav, params }) {
  return (
    <IncidentDetail data={data} nav={nav} params={{ ...params, id: `nodes/${params.nodeKey}` }} />
  );
}

function WebNodeDetail({ data, nav, params, charts = null }) {
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

function AndroidNodeDetail({ data, nav, params, charts = null }) {
  if (detailLoading(data)) return <AndroidLoading label="Node detail" title="Node" nav={nav} />;
  const freshness = data.freshness ?? FRESH;
  const node = data.status
    ? nodeCardsOf({ status: data.status, servicesBody: data.servicesBody, freshness }).find(
        (n) => n.key === params.nodeKey
      )
    : null;
  if (!node && params.type) return <PushedElsewhere data={data} nav={nav} params={params} />;
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
                <span
                  className="node-detail__down-count"
                  style={{ color: colourOf(node.downState) }}
                >
                  {down} down
                </span>
              )}
            </>
          )}
        </span>
      </div>
      {node.reason && <p className="detail-cause">{node.reason}</p>}
      <div className="node-detail__bars">
        {node.detailBars.map((bar) => (
          <UsageBar
            key={bar.key}
            label={bar.label}
            shown={bar.shown}
            percent={bar.percent}
            state={bar.state}
          />
        ))}
      </div>
      {charts && <div className="detail-history">{charts}</div>}
      <div className="svc-list">
        {services.map((s) => (
          <ServiceRow
            key={s.uid}
            service={s}
            onTap={() => nav.push('serviceDetail', { uid: s.uid })}
          />
        ))}
      </div>
    </section>
  );
}
