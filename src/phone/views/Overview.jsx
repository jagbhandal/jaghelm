import React, { useId, useMemo, useSyncExternalStore } from 'react';
// The status components are the shared library's (src/ui/), in the Android
// app's own look until Phase 4 (#326; src/ui/lib/status.js).
import { AttentionPanel } from '@ui/attention-panel';
import { SubsystemStrip } from '@ui/subsystem-strip';
import { IssueRow } from '@ui/issue-row';
import { EntityRow } from '@ui/entity-row';
import { Banner } from '@ui/banner';
import { UpdatedAgo } from '@ui/app-header';
import { EMPTY } from '@ui/lib/status.js';
import StatusBanner from '../components/StatusBanner.jsx';
import ServiceRow from '../components/ServiceRow.jsx';
import { FRESH, cellsOf, heroOf, issueRowsOf, nodeCardsOf, serviceRowsOf } from '../data/board.js';
import { issueRoute } from '../nav/issueRoute.js';
import { countsText, issueRows, lastKnownLine } from '../../shell/statusView.js';
import { lastKnownCaption, statusBuiltAt } from '../../shell/statusFreshness.js';

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
 * The web look (#303) is the Phone board's Overview, from the shared parts:
 * the attention panel split around the strip (the status card, its word and
 * counts, the model's sentence and "Updated 12 s ago"; the strip; "Needs
 * attention · 5" over the issue rows, each opening its detail), then the
 * Services and Infrastructure as lists, worst first, each row opening its
 * service or node. The words are the ones the Android look draws (the
 * cross-client suite holds both to the model). A stale status is drawn as
 * the Android card orders it: "No signal", why, and what it last knew.
 */
export default function Overview(props) {
  if (__ANDROID_LOOK__) return <AndroidOverview {...props} />;
  return <WebOverview {...props} />;
}

const NO_CLOCK = { subscribe: () => () => {}, get: () => null };

/** The time of the status shown (when the server built it, else when it came), or null. */
function useStatusAt(updated) {
  const store = updated ?? NO_CLOCK;
  return useSyncExternalStore(store.subscribe, () => (updated ? statusBuiltAt(updated) : null));
}

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

function WebOverview({ data, nav }) {
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
      ? // As the Android card orders it: "No signal", why, then what it last knew.
        { state: 'unknown', subline: freshness.cause, meta: lastKnownLine(freshness, status) }
      : {
          state: status.overall.state,
          counts: quiet ? status.overall.sentence : countsText(status.issues),
          subline: quiet ? undefined : status.overall.sentence,
        }
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

function AndroidOverview({ data, nav }) {
  const { status, servicesBody, ups, loading, error } = data;
  const freshness = data.freshness ?? FRESH;

  const hero = useMemo(() => heroOf({ status, freshness }), [status, freshness]);
  const cells = useMemo(() => cellsOf({ status, freshness, ups }), [status, freshness, ups]);
  const incidents = useMemo(() => issueRowsOf({ status, freshness }), [status, freshness]);

  // What to say with no issue to list, while the status is current.
  const settled = status && !freshness.stale && incidents.length === 0;
  const state = status?.overall?.state;
  const quiet = settled && (state === 'ok' || state === 'maintenance');
  const calm = settled && !quiet && state !== EMPTY;

  return (
    <section className="mobile-view" aria-label="Overview">
      <AttentionPanel
        state={hero.state}
        headline={hero.headline}
        word={hero.word}
        subline={hero.subline}
        counts={hero.counts}
      />

      <SubsystemStrip cells={cells} />

      <section className="overview-issues" aria-label="Active issues">
        <h2 className="overview-issues__title">Active issues</h2>
        <StatusBanner loading={loading} error={error} hasData={!!servicesBody} />

        {!loading && incidents.length > 0 && (
          <div className="overview-issues__list">
            {/* A row opens the detail screen of what it refers to (#279); a
                row with nothing to open renders as plain content. */}
            {incidents.map((inc) => {
              const route = issueRoute(inc);
              return (
                <IssueRow
                  key={inc.id}
                  incident={inc}
                  onOpen={route ? () => nav.push(route.screen, route.params) : undefined}
                />
              );
            })}
          </div>
        )}

        {!loading && quiet && (
          <div className="overview-clear">
            <p className="overview-clear__msg">🌙 Nothing on fire.</p>
            {/* Honest numbers: the snapshot has no last-incident time, so we
                render the no-data token (—), never a synthesized "3 days ago". */}
            <p className="overview-clear__sub">last incident · —</p>
          </div>
        )}

        {!loading && calm && <p className="overview-issues__empty">No active issues.</p>}
      </section>
    </section>
  );
}
