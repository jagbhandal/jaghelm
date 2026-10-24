import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleCheck, Compass } from 'lucide-react';
import { ShellPage } from '@ui/app-shell';
import { Button } from '@ui/button';
import { Panel } from '@ui/panel';
import { SourceList } from '@ui/source-list';
import ConfigReadError from '../components/settings/ConfigReadError.jsx';
import Integrations from '../components/settings/sections/Integrations.jsx';
import NodesTab from '../components/settings/NodesTab.jsx';
import { useServerConfig } from '../components/settings/serverConfig.js';
import { sourceRows } from '../components/settings/sections/sourcesView.js';
import { settingsHref } from '../components/settings/sections.js';
import { followLink } from '../router/useRoute.js';
import { useStatusAt, useStatusFreshness } from '../shell/statusFreshness.js';

/**
 * The guided first run (#322, spec §8): connect Prometheus, pick nodes,
 * optionally add Kuma, NUT and integrations, and finish on a populated
 * Overview, without editing a file by hand.
 *
 * It is a path through Settings' own pieces, not forms of its own: the
 * sources' rows (Settings → Sources, sourcesView.js and SourceList), the
 * nodes' editor (Settings → Nodes & Services, NodesTab) and the whole
 * Integrations section. The addresses of Prometheus, Kuma and NUT are JagHelm's
 * .env, which the app doesn't write, so those steps show their live state
 * (from the header's status poll, no request of their own) and say what to set
 * when one isn't. Every step can be passed over, and Skip ends the whole
 * setup. It shows only while the server's `setup-pending` marker is there
 * (hooks/useSetup.js), on the Overview's address, and lives in its own chunk.
 *
 * While the first boot still waits for Prometheus to report a node (no
 * services.yaml yet), nothing here may save: a save writes the file and ends
 * the wait (firstBoot.js). So the nodes step says it is waiting, and
 * Integrations opens once the first node is in.
 *
 * `onDone` is Finish and Skip alike (App.jsx: it clears the marker and the
 * Overview comes back).
 */
const STEPS = [
  { id: 'prometheus', name: 'Prometheus' },
  { id: 'nodes', name: 'Nodes' },
  { id: 'optional', name: 'Kuma and NUT' },
  { id: 'integrations', name: 'Integrations' },
];

// Inline, not utility classes: this page sits beside today's screens, whose class names
// may not collide with Tailwind's (scripts/ui-stack.test.mjs).
const STEPS_LIST = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '4px 20px',
  listStyle: 'none',
  margin: 0,
  padding: 0,
  fontSize: 13,
  color: 'var(--jh-text-3, var(--text-muted))',
};
const CURRENT_STEP = { fontWeight: 600, color: 'var(--jh-text-1, var(--text-primary))' };
const ACTIONS = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 };
const NOTE = { margin: 0, color: 'var(--jh-text-2, var(--text-secondary))' };

// Visually hidden, announced: inline for the same reason.
const SR_ONLY = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
const STEP_HEADING = { margin: 0, fontSize: 15, fontWeight: 600, outline: 'none' };

const nodesIn = (status) => (status?.entities ?? []).filter((e) => e.kind === 'node').length;

export default function SetupWizard({ status = null, reach = 'loading', updated = null, onDone }) {
  const [at, setAt] = useState(0);
  const step = STEPS[at];
  // A step change moves focus to the step's heading and says so, once the
  // first step has been left (the page's own load needs neither).
  const heading = useRef(null);
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current) heading.current?.focus();
    moved.current = true;
  }, [at]);
  const last = at === STEPS.length - 1;
  const freshness = useStatusFreshness({ status, reach, updated });
  const when = useStatusAt(updated);
  const rows = useMemo(() => sourceRows({ status, freshness, at: when }), [status, freshness, when]);
  const rowsOf = (...ids) => rows.filter((r) => ids.includes(r.id));
  const nodes = nodesIn(status);
  const prometheus = rows.find((r) => r.id === 'prometheus');
  const answering = prometheus?.word === 'Answering';

  return (
    <ShellPage
      data-slot="setup"
      title="Set up JagHelm"
      description="Connect your monitoring and pick what to watch. Every step can wait: you can do all of it later in Settings."
      actions={
        <Button variant="ghost" size="sm" onClick={onDone}>
          Skip setup
        </Button>
      }
    >
      <h2 ref={heading} tabIndex={-1} style={STEP_HEADING} data-slot="setup-step">
        Step {at + 1} of {STEPS.length}: {step.name}
      </h2>
      <div role="status" aria-live="polite" style={SR_ONLY}>
        {at > 0 ? `Step ${at + 1} of ${STEPS.length}: ${step.name}` : ''}
      </div>
      <ol style={STEPS_LIST} aria-label="Steps">
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            aria-current={i === at ? 'step' : undefined}
            style={i === at ? CURRENT_STEP : undefined}
          >
            {i + 1}. {s.name}
          </li>
        ))}
      </ol>

      {step.id === 'prometheus' && (
        <>
          <SourceList
            title="Connect Prometheus"
            description="JagHelm reads your nodes' CPU, memory, disk and temperature from Prometheus."
            rows={rowsOf('prometheus')}
            onNavigate={followLink}
          />
          {!answering && (
            <Panel title="Prometheus isn't answering yet" titleAs="h3">
              <p style={NOTE}>
                Its address is JagHelm's <code>PROMETHEUS_URL</code> in .env, which the app can't
                change. Set it, restart JagHelm, and this page turns green on its own. You can
                carry on meanwhile.
              </p>
            </Panel>
          )}
        </>
      )}

      {step.id === 'nodes' && <NodesStep key={nodes} />}

      {step.id === 'optional' && (
        <SourceList
          title="Uptime Kuma and your UPS"
          description="Optional. Kuma adds service checks and the UPS adds a Power section; leave either out and its panel is simply not drawn."
          rows={rowsOf('kuma', 'nut')}
          onNavigate={followLink}
        />
      )}

      {step.id === 'integrations' &&
        (nodes === 0 ? (
          <Panel title="Integrations">
            <p style={NOTE}>
              They open once JagHelm has found your first node. Add them later in{' '}
              <a href={settingsHref('integrations')} onClick={(e) => followLink(e, settingsHref('integrations'))}>
                Settings → Integrations
              </a>
              .
            </p>
          </Panel>
        ) : (
          <div className="settings-section" data-slot="setup-integrations">
            <Integrations status={status} reach={reach} updated={updated} />
          </div>
        ))}

      <div style={ACTIONS}>
        <Button variant="secondary" onClick={() => setAt(at - 1)} disabled={at === 0}>
          Back
        </Button>
        {last ? (
          <Button variant="primary" onClick={onDone}>
            <CircleCheck aria-hidden="true" size={16} style={{ marginRight: 6 }} />
            Finish and open the Overview
          </Button>
        ) : (
          <Button variant="primary" onClick={() => setAt(at + 1)}>
            {step.id === 'prometheus' && !answering ? 'Continue anyway' : 'Next'}
          </Button>
        )}
      </div>
    </ShellPage>
  );
}

/** The nodes step: Settings' nodes editor, or why it has none to edit yet. */
function NodesStep() {
  const server = useServerConfig();
  // Only the first boot's wait (no services.yaml yet) fills the nodes in by
  // itself. A file with no nodes is the user's: NodesTab, with Find nodes (#572).
  const waiting = server.live?.discovery === 'waiting';
  if (server.error) return <ConfigReadError message={server.error} onRetry={server.retry} />;
  if (waiting && server.live) {
    return (
      <Panel
        icon={<Compass />}
        title="Waiting for your first node"
        description="JagHelm has no services.yaml yet and asks Prometheus for nodes every refresh. They appear here by themselves as soon as it scrapes a host."
      >
        <p style={NOTE}>
          Nothing is saved while it waits. You can carry on, and add nodes later in{' '}
          <a href={settingsHref('nodes')} onClick={(e) => followLink(e, settingsHref('nodes'))}>
            Settings → Nodes & Services
          </a>
          .
        </p>
      </Panel>
    );
  }
  return (
    <Panel
      title="Pick your nodes"
      description="Name each one, set its colour, and switch off any you don't want on the Overview."
    >
      <div className="settings-section">
        {server.config ? (
          <NodesTab
            serverConfig={server.config}
            onSave={server.save}
            saving={server.saving}
            discovery={server.live?.discovery}
          />
        ) : (
          <p style={NOTE}>Loading your nodes…</p>
        )}
      </div>
    </Panel>
  );
}
