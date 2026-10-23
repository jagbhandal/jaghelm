import React, { useId } from 'react';
import NodeCard from '../components/NodeCard.jsx';
import StatusBanner from '../components/StatusBanner.jsx';
import { FRESH, nodeCardsOf } from '../data/board.js';
import { lastKnownCaption } from '../../shell/statusFreshness.js';

/**
 * Infra screen — the ONLY place per-node metric bars live (spec §7.4, Bug #10).
 * A NodeCard per node the status model has (#325), in services.yaml's order:
 * the model's lamp and word, its hosted services count, CPU/MEM/third bars.
 *
 * The web look (#303): the page's title, "Infrastructure" as the spec names
 * it, and the shared node cards one under another, each opening the node; a
 * placeholder until the status and the cards are in.
 */
export default function Infra(props) {
  if (__ANDROID_LOOK__) return <AndroidInfra {...props} />;
  return <WebInfra {...props} />;
}

function WebInfra({ data, nav }) {
  const headingId = useId();
  const freshness = data.freshness ?? FRESH;
  // The Nodes subsystem's count ("3 / 3 healthy"), or how old a stale one is.
  const count = freshness.stale
    ? lastKnownCaption(freshness)
    : data.status?.subsystems?.find((x) => x.id === 'nodes')?.detail;
  const nodes = data.status
    ? nodeCardsOf({
        status: data.status,
        servicesBody: data.servicesBody,
        freshness: data.freshness ?? FRESH,
      })
    : [];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-title">Infrastructure</h1>
      <StatusBanner
        loading={data.loading || (!data.status && data.reach === 'loading')}
        error={data.error}
        hasData={!!data.servicesBody}
      />
      {nodes.length === 0 ? (
        data.status && !data.loading && <p className="text-text-2">No nodes reported.</p>
      ) : (
        <section aria-labelledby={headingId} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id={headingId} className="text-overline text-text-3 uppercase">
              Nodes
            </h2>
            {count && <span className="text-caption text-text-3">{count}</span>}
          </div>
          <div className="flex flex-col gap-3">
            {nodes.map((node) => (
              <NodeCard
                key={node.key}
                node={node}
                onTap={(k) => nav.push('node', { nodeKey: k })}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AndroidInfra({ data, nav }) {
  const nodes = data.status
    ? nodeCardsOf({
        status: data.status,
        servicesBody: data.servicesBody,
        freshness: data.freshness ?? FRESH,
      })
    : [];
  if (nodes.length === 0) {
    return (
      <section className="mobile-view" aria-label="Infra">
        <h1>Infra</h1>
        <p className="mobile-view__empty">No nodes reported.</p>
      </section>
    );
  }
  return (
    <section className="mobile-view" aria-label="Infra">
      <h1>Infra</h1>
      <div className="node-grid">
        {nodes.map((node) => (
          <NodeCard key={node.key} node={node} onTap={(k) => nav.push('node', { nodeKey: k })} />
        ))}
      </div>
    </section>
  );
}
