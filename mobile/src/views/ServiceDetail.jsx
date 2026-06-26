import React from 'react';
import StatusDot from '../components/StatusDot.jsx';
import BackHeader from '../components/BackHeader.jsx';
import UptimeLine from '../components/UptimeLine.jsx';
import { flattenServices } from '../data/derive.js';
import { openTarget } from '../open.js';

export default function ServiceDetail({ data, nav, params }) {
  const svc = flattenServices(data.servicesBody).find((s) => s.uid === params.uid);
  if (!svc) {
    return (
      <section className="mobile-view" aria-label="Service detail">
        <BackHeader title="Service" onBack={nav.pop} />
        <p className="mobile-view__todo">This service is no longer reported.</p>
      </section>
    );
  }
  return (
    <section className="mobile-view" aria-label="Service detail">
      <BackHeader title={svc.display_name} onBack={nav.pop} />
      <div className="detail-head">
        <StatusDot status={svc.status} />
        <span className="detail-head__node">{svc.nodeName}</span>
        {svc.ping != null && svc.ping > 0 && <span className="detail-head__ping">{svc.ping}ms</span>}
      </div>
      <UptimeLine uptime24={svc.uptime24} />
      {svc.docker && (
        <div className="detail-docker">
          {svc.docker.cpu != null && <span>CPU {svc.docker.cpu}%</span>}
          {svc.docker.memMB != null && <span>MEM {svc.docker.memMB} MB</span>}
        </div>
      )}
      {svc.url && <button type="button" className="open-btn" onClick={() => openTarget({ kind: 'service', uid: svc.uid, url: svc.url })}>Open</button>}
    </section>
  );
}
