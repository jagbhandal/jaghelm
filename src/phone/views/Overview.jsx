import React, { useId, useMemo } from 'react';
import { AttentionPanel } from '@ui/attention-panel';
import { SubsystemStrip } from '@ui/subsystem-strip';
import { EntityRow } from '@ui/entity-row';
import { Banner } from '@ui/banner';
import { UpdatedAgo } from '@ui/app-header';
import StatusBanner from '../components/StatusBanner.jsx';
import ServiceRow from '../components/ServiceRow.jsx';
import { FRESH, cellsOf, issueRowsOf, nodeCardsOf, serviceRowsOf } from '../data/board.js';
import { issueRoute } from '../nav/issueRoute.js';
import { issueRows, lastKnownLine } from '../../shell/statusView.js';
import { lastKnownCaption, useStatusAt } from '../../shell/statusFreshness.js';

/** A list section of the phone's Overview: an overline heading, a count, and a card of rows. */
function ListSection({ title, count, children }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={id} className="text-overline text-text-3 uppercase">
          {title}
        </h2>
        {count && <span className="text-caption text-text-3">{count}</span>}
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-1">
        {children}
      </ul>
    </section>
  );
}

/** A subsystem's count as the section heads it ("11 / 12 up"), or how old a stale one is. */
function countOf(status, id, freshness) {
  if (freshness.stale) return lastKnownCaption(freshness);
  return status?.subsystems?.find((s) => s.id === id && s.counts?.total > 0)?.detail;
}

/**
 * The Overview, drawn from the status model (#325; data/board.js): the status
 * card (the board's state, its counts and the model's sentence, or the quiet
 * line, or an empty board's "Nothing monitored yet"), the strip (a cell per
 * subsystem that has anything, the Power cell with the UPS's readings) and the
 * model's issues, worst first.
 *
 * A stale status (#480) keeps its strip and issues as last known, each drawn
 * as no signal, and the card says "No signal", why and what it last knew.
 *
 * The page (#303) is the Phone board's Overview, from the shared parts:
 * the attention panel split around the strip (the status card, its word
 * alone, as the mock's, the model's sentence and "Updated 12 s ago"; the
 * strip; "Needs attention · 5" over the issue rows, each opening its
 * detail), then the Services and Infrastructure as lists, worst first, each
 * row opening its service or node. The cross-client suites hold the words
 * to the model. A stale status is drawn "No signal", why, and what it last
 * knew.
 */
export default function Overview({ data, nav }) {
  const { status, servicesBody, ups, loading } = data;
  const freshness = data.freshness ?? FRESH;
  const at = useStatusAt(data.updated);

  const cells = useMemo(() => cellsOf({ status, freshness, ups }), [status, freshness, ups]);
  // The rows as the web's attention panel draws them (aged against the
  // status's time), each opening what the phone opens for it.
  const issues = useMemo(() => {
    const opens = issueRowsOf({ status, freshness });
    return issueRows(status, at ?? Date.now()).map((row, i) => {
      const route = issueRoute(opens[i]);
      return {
        ...row,
        state: opens[i].state,
        onOpen: route ? () => nav.push(route.screen, route.params) : undefined,
      };
    });
  }, [status, freshness, at, nav]);
  // The lists come with the status and the cards both in, under the status
  // card, so nothing drawn moves when they come (#243).
  const services = useMemo(
    () => (status && servicesBody ? serviceRowsOf({ status, servicesBody, freshness }) : []),
    [status, servicesBody, freshness]
  );
  const nodes = useMemo(
    () => (status && servicesBody ? nodeCardsOf({ status, servicesBody, freshness }) : []),
    [status, servicesBody, freshness]
  );

  const quiet = (status?.issues ?? []).length === 0;
  const said = status
    ? freshness.stale
      ? // "No signal", why, then what it last knew.
        { state: 'unknown', subline: freshness.cause, meta: lastKnownLine(freshness, status) }
      : quiet
        ? // The healthy card: "All systems normal" over the model's sentence.
          { state: status.overall.state, counts: status.overall.sentence }
        : // The Phone board's card: the word alone, the model's sentence under it.
          { state: status.overall.state, subline: status.overall.sentence }
    : null;
  const strip = cells.length > 0 && <SubsystemStrip cells={cells} />;
  const updatedAgo = at != null && !freshness.stale ? <UpdatedAgo at={at} /> : undefined;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Overview</h1>
      {freshness.stale && !status && (
        <Banner tone="unknown" title="No signal" cause={freshness.cause} />
      )}
      {said ? (
        <AttentionPanel
          split
          titleAs="h2"
          state={said.state}
          counts={said.counts}
          subline={said.subline}
          meta={said.meta ?? updatedAgo}
          issues={issues}
          between={strip}
          className="gap-4"
        />
      ) : (
        strip
      )}
      {data.error && <StatusBanner loading={loading} error={data.error} hasData={!!servicesBody} />}
      {services.length > 0 && (
        <ListSection title="Services" count={countOf(status, 'services', freshness)}>
          {services.map((s) => (
            <li key={s.uid}>
              <ServiceRow service={s} onTap={() => nav.push('serviceDetail', { uid: s.uid })} />
            </li>
          ))}
        </ListSection>
      )}
      {nodes.length > 0 && (
        <ListSection title="Infrastructure" count={countOf(status, 'nodes', freshness)}>
          {nodes.map((n) => (
            <li key={n.key}>
              <EntityRow
                state={n.state}
                word={n.word}
                name={n.name}
                detail={n.reason ?? n.services}
                onOpen={() => nav.push('node', { nodeKey: n.key })}
              />
            </li>
          ))}
        </ListSection>
      )}
    </div>
  );
}
