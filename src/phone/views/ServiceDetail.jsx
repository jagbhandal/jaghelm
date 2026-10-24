import React from 'react';
import BackHeader from '../components/BackHeader.jsx';
import {
  DetailLoading,
  DetailStatus,
  DetailTitle,
  DetailUnreachable,
} from '../components/DetailParts.jsx';
import { detailLoading, sinceLine } from '../data/detail.js';
import { Button } from '@ui/button';
import { DetailFacts, DetailHeartbeats, DetailSections, DetailUnread } from '@ui/entity-detail';
import { FRESH, serviceEntity, serviceRowsOf } from '../data/board.js';
import { uptimePct } from '../data/derive.js';
import { lastSeenLabel } from '../../util/relativeTime.js';
import { usePhonePlatform } from '../platform.js';
import { useStatusAt } from '../../shell/statusFreshness.js';
import IncidentDetail from './IncidentDetail.jsx';

/** A tapped push's service the cards don't have: Incident detail, by its entity id. */
function PushedElsewhere({ data, nav, params }) {
  return (
    <IncidentDetail data={data} nav={nav} params={{ ...params, id: `services/${params.uid}` }} />
  );
}

/**
 * ServiceDetail — full detail for one service within the current snapshot,
 * its lamp, word and reason the status model's (#325).
 *
 * Honest numbers (§7.6): this screen NEVER synthesizes a time. `ping` is
 * LATENCY (header `{ping}ms`), never reinterpreted as an age. The only "X ago"
 * line shown is a presence breadcrumb's real `lastSeenAt`; absent that, the
 * line is omitted entirely.
 *
 * The Phone board's sheet (#303): Back and "Service" over its
 * name and node, the status box (the model's word, unless it is up its
 * reason, and how long it has been so, from the model's `since`), the facts
 * it shows (latency, the 24 h uptime, the breadcrumb's last
 * seen, the CPU and memory Docker reads while up, the node), and Open as the
 * primary button. The sheet shows what the desktop's drawer does
 * (#310, `data.extras`, src/shell/PhoneDetail.jsx): the same facts, then
 * Docker's CPU, memory and network rates while it runs, and the stats of
 * its integration. Drawn before the status and the cards have answered (a
 * reload with the sheet open, its URL opened, #309), it waits for them; a
 * service they don't have is "no longer monitored", and with no cards to
 * read, it says so. *
 * A service with a Kuma monitor shows its heartbeat strip under
 * the status box (#312, `data.extras.beats`): its last 30 checks, the Phone
 * board's "Heartbeats · last 30", in the sheet's large beats.
 *
 * `charts` (#602): the history of a service Docker runs, the drawer's CPU
 * and Memory charts (1 h / 24 h / 7 d), as its screen gives them (PhoneDetail.jsx):
 * under the status box, as the drawer draws them.
 *
 * Opened by a tapped push (#309, its `type` in the params) for a service the
 * cards don't have (a monitor with no card, #390, or one removed since), it
 * is Incident detail: the model's issue for it, else the push's own event.
 */
export default function ServiceDetail({ data, nav, params, charts = null, logs = null, stack = null }) {
  const { openTarget } = usePhonePlatform();
  const at = useStatusAt(data.updated);
  if (detailLoading(data)) return <DetailLoading kind="Service" onBack={nav.pop} />;
  if (!data.servicesBody) return <DetailUnreachable kind="Service" onBack={nav.pop} data={data} />;
  const freshness = data.freshness ?? FRESH;
  // A service folded into a stack has a sheet of its own (#642).
  const svc = serviceRowsOf({
    status: data.status,
    servicesBody: data.servicesBody,
    freshness,
    withFolded: true,
  }).find((s) => s.uid === params.uid);
  if (!svc && params.type) return <PushedElsewhere data={data} nav={nav} params={params} />;
  if (!svc) {
    return (
      <>
        <BackHeader kind="Service" onBack={nav.pop} />
        <div className="flex flex-col gap-4 p-4">
          <DetailTitle title="Service" />
          <p className="text-text-2">This service is no longer monitored.</p>
        </div>
      </>
    );
  }
  const healthy = svc.modelState === 'ok';
  const extras = data.extras ?? null;
  const facts =
    extras?.facts ??
    [
      svc.ping != null &&
        svc.ping > 0 && { key: 'latency', label: 'Latency', value: `${svc.ping} ms` },
      svc.uptime24 != null && {
        key: 'uptime',
        label: 'Uptime · 24 h',
        value: `${uptimePct(svc.uptime24)} %`,
      },
      svc.source === 'presence' &&
        svc.lastSeenAt != null && {
          key: 'seen',
          label: 'Last seen',
          value: lastSeenLabel(svc.lastSeenAt).replace(/^last seen /, ''),
        },
      healthy &&
        svc.docker?.cpu != null && { key: 'cpu', label: 'CPU', value: `${svc.docker.cpu} %` },
      healthy &&
        svc.docker?.memMB != null && {
          key: 'mem',
          label: 'Memory',
          value: `${svc.docker.memMB} MB`,
        },
      { key: 'node', label: 'Node', value: svc.nodeName },
    ].filter(Boolean);
  return (
    <>
      <BackHeader kind={svc.stack ? 'Stack' : 'Service'} onBack={nav.pop} />
      <div className="flex flex-col gap-4 p-4">
        <DetailTitle title={svc.display_name} where={svc.nodeName} />
        <DetailStatus
          state={svc.state}
          word={svc.word}
          reason={healthy ? null : svc.reason}
          since={sinceLine(
            serviceEntity(data.status, svc.uid)?.stack?.rollup?.since ??
              serviceEntity(data.status, svc.uid)?.since,
            at,
            freshness
          )}
        />
        <DetailHeartbeats
          beats={extras?.beats}
          of={
            svc.stack
              ? serviceEntity(data.status, svc.uid)?.stack?.members.find((m) => m.lead)?.name
              : undefined
          }
          count={30}
          size="lg"
          stale={Boolean(extras?.lastKnown)}
        />
        {charts}
        <DetailFacts facts={facts} lastKnown={extras?.lastKnown} />
        <DetailSections sections={extras?.sections} muted={Boolean(extras?.lastKnown)} />
        {logs}
        {stack}
        <DetailUnread unread={extras?.unread} />
        {svc.url && (
          <Button
            variant="primary"
            className="mt-1 h-12 w-full"
            onClick={() => openTarget({ kind: 'service', uid: svc.uid, url: svc.url })}
          >
            Open {svc.display_name}
          </Button>
        )}
      </div>
    </>
  );
}
