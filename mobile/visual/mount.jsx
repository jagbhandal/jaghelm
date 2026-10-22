// Dev tool visual harness mount — NOT imported by the app or build.
// Reads ?state=<name> from URL and renders the matching screen with canned fixture data.
import React from 'react';
import { createRoot } from 'react-dom/client';
// The app's stylesheets, as mobile/src/main.jsx loads them.
import '../src/styles/legacy.css';
import '@ui/tailwind.css';
import * as fx from './fixtures.js';
import Overview from '../src/views/Overview.jsx';
import Services from '../src/views/Services.jsx';
import Infra from '../src/views/Infra.jsx';
import Alerts from '../src/views/Alerts.jsx';
import ServiceDetail from '../src/views/ServiceDetail.jsx';
import NodeDetail from '../src/views/NodeDetail.jsx';
import IncidentDetail from '../src/views/IncidentDetail.jsx';
// The screens draw the server's status model (#325): build it from the
// fixture, as the server would, with the model's own code (browser-safe).
import { inputs, once } from '../../server/testing/statusFixtures.js';

// Map state name → { Screen, fixture, params }
const STATES = {
  'overview-calm':      { Screen: Overview,       fixture: fx.calm,            params: {} },
  'overview-degraded':  { Screen: Overview,       fixture: fx.degradedSubsystem, params: {} },
  'overview-multi':     { Screen: Overview,       fixture: fx.multiIncident,   params: {} },
  'services-down':      { Screen: Services,       fixture: fx.downService,     params: {} },
  'node-detail':        { Screen: NodeDetail,     fixture: fx.nodeDetail,      params: { nodeKey: 'vm-101' } },
  'incident-detail':    { Screen: IncidentDetail, fixture: fx.incidentDetail,  params: { id: 'services/vm-101:gitea' } },
  'alerts-multi':       { Screen: Alerts,         fixture: fx.multiIncident,   params: {} },
  'infra-calm':         { Screen: Infra,          fixture: fx.calm,            params: {} },
};

const qs = new URLSearchParams(location.search);
const stateName = qs.get('state') || 'overview-calm';
const entry = STATES[stateName] || STATES['overview-calm'];
const { Screen, fixture, params } = entry;

// The fixture's cards, read as the refresh leaves them: each node reachable,
// each card's state its Kuma monitor's.
const servicesBody = {
  nodes: Object.fromEntries(
    Object.entries(fixture.services.nodes).map(([key, node]) => [
      key,
      {
        reachable: true,
        failedReads: [],
        ...node,
        services: node.services.map((svc) => ({ monitored: true, source: 'container', ...svc })),
      },
    ])
  ),
};
const status = once(
  inputs({
    nodes: servicesBody.nodes,
    ups: { ok: true, configured: true, model: 'UPS', ...fixture.ups },
    cron: fixture.cron,
  })
);

const data = {
  status,
  servicesBody,
  reach: 'ok',
  freshness: { stale: false },
  loading: false,
  error: null,
};

// Minimal nav stub — visual pass only; interactions not needed.
const nav = {
  push() {},
  pop() {},
  reset() {},
  canPop: false,
  current: { screen: stateName, params: {} },
};

createRoot(document.getElementById('root')).render(
  <Screen data={data} nav={nav} params={params} />
);
