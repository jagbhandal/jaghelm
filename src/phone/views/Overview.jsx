import React, { useMemo } from 'react';
// The status components are the shared library's (src/ui/), in the Android
// app's own look until Phase 4 (#326; src/ui/lib/status.js).
import { AttentionPanel } from '@ui/attention-panel';
import { SubsystemStrip } from '@ui/subsystem-strip';
import { IssueRow } from '@ui/issue-row';
import { EMPTY } from '@ui/lib/status.js';
import StatusBanner from '../components/StatusBanner.jsx';
import { FRESH, cellsOf, heroOf, issueRowsOf } from '../data/board.js';
import { issueRoute } from '../nav/issueRoute.js';

/**
 * The Overview, drawn from the status model (#325; data/board.js): the status
 * card (the board's state, its counts and the model's sentence, or the quiet
 * line, or an empty board's "Nothing monitored yet"), the strip (a cell per
 * subsystem that has anything, the Power cell with the UPS's readings) and the
 * model's issues, worst first.
 *
 * A stale status (#480) keeps its strip and issues as last known, each drawn
 * as no signal, and the card says "No signal", why and what it last knew.
 */
export default function Overview({ data, nav }) {
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
