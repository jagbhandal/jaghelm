/**
 * The Monitoring page (#751, spec §5, §7), from 768px at /monitoring: the
 * lab's charts in sections whose headings say what they answer (Power and
 * cost, Capacity, Resources, Containers, Drives), under one range switch (1 h,
 * 24 h, 7 d, 30 d). The server owns the charts (GET /api/monitoring,
 * server/monitoring.js: a table of chart id, title, question and section); the
 * page draws each from its entry in DRAWINGS (monitoring.js) and sends a range
 * and nothing else.
 *
 *  - Before the first answer each section that has a drawing shows a
 *    placeholder where its charts will be (aria-busy, announced once).
 *  - A chart Prometheus could not answer says so in its own fixed sentence
 *    (the server's, failureWords.js), never an empty line that looks healthy;
 *    the others draw as they are. A read that fails as a whole says so over
 *    the last answer, or in place of one.
 *  - A section with no chart yet is not drawn: the charts arrive a card at a
 *    time (#734), and the page is hidden in routes.js until they are enough.
 *
 * It reads once its range's step has passed on an answer of the header's
 * status poll (useMonitoring.js): the one extra request of tickBudget.js.
 * Its own chunk (lazyViews.js); below 768px the phone's page takes the
 * address (a later card, #755).
 */
import { useId, useMemo, useState } from 'react';
import { MONITORING_SECTIONS } from '../../server/monitoringSections.js';
import { Chart } from '@ui/chart';
import { EmptyState } from '@ui/empty-state';
import { Panel } from '@ui/panel';
import { SegmentedControl } from '@ui/segmented-control';
import { ShellPage } from '@ui/app-shell';
import { Skeleton } from '@ui/skeleton';
import { DRAWINGS, MONITORING_RANGES, monitoringRangeOf } from './monitoring.js';
import { useMonitoring } from './useMonitoring.js';

/** The sections the page has charts for: those the answer holds, else those the client can draw. */
function sectionsOf(body) {
  const ids = new Set(
    body
      ? body.charts.filter((c) => Object.hasOwn(DRAWINGS, c.id)).map((c) => c.section)
      : Object.values(DRAWINGS).map((d) => d.section)
  );
  return MONITORING_SECTIONS.filter((s) => ids.has(s.id));
}

function ChartPanel({ chart, range, busy }) {
  const drawing = DRAWINGS[chart.id];
  const ok = chart.ok === true;
  return (
    <Panel
      data-slot="monitoring-chart"
      data-chart={chart.id}
      title={chart.title}
      titleAs="h3"
      description={chart.question}
    >
      <Chart
        label={`${chart.title}, ${range.words}`}
        state={ok ? 'ready' : 'failed'}
        failedText={ok ? undefined : chart.error}
        busy={busy}
        tickEvery={range.tickEvery}
        formatTick={range.tick}
        formatTime={range.time}
        {...(ok ? drawing.props(chart) : {})}
      />
    </Panel>
  );
}

/** A section's placeholder before the first answer. */
function SectionSkeleton({ title }) {
  return (
    <div data-slot="monitoring-skeleton" aria-busy="true">
      <span className="sr-only">Loading {title}</span>
      <Skeleton className="h-52 w-full rounded-xl" />
    </div>
  );
}

export default function MonitoringPage({ updated }) {
  const [rangeValue, setRangeValue] = useState(MONITORING_RANGES[0].value);
  const range = monitoringRangeOf(rangeValue);
  const { body, range: answered, error, busy } = useMonitoring(rangeValue, updated);
  const sections = useMemo(() => sectionsOf(body), [body]);
  const noteId = useId();
  // The range an answer is of, for its ticks and its name, while a switch is read.
  const drawn = monitoringRangeOf(body ? answered : rangeValue);

  return (
    <ShellPage
      data-slot="monitoring-page"
      title="Monitoring"
      description="How the lab is doing over time, from Prometheus."
      actions={
        <SegmentedControl
          aria-label="Range"
          options={MONITORING_RANGES.map(({ value, label }) => ({ value, label }))}
          value={rangeValue}
          onValueChange={setRangeValue}
        />
      }
    >
      {error && (
        <p
          id={noteId}
          role="status"
          data-slot="monitoring-error"
          className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-caption text-text-2"
        >
          {body
            ? `The last read of the charts failed (${error}); these are from the one before.`
            : `The charts couldn't be read (${error}).`}
        </p>
      )}
      {sections.map((section) => {
        const charts = body
          ? body.charts.filter((c) => c.section === section.id && Object.hasOwn(DRAWINGS, c.id))
          : [];
        return (
          <section
            key={section.id}
            data-slot="monitoring-section"
            data-section={section.id}
            aria-labelledby={`monitoring-${section.id}`}
            className="flex min-w-0 flex-col gap-3"
          >
            <div className="flex flex-col gap-0.5">
              <h2 id={`monitoring-${section.id}`} className="text-title-xs text-text-1">
                {section.title}
              </h2>
              <p className="text-caption text-text-3">{section.question}</p>
            </div>
            {body ? (
              charts.map((chart) => (
                <ChartPanel key={chart.id} chart={chart} range={drawn} busy={busy} />
              ))
            ) : error ? null : (
              <SectionSkeleton title={section.title} />
            )}
          </section>
        );
      })}
      {body && sections.length === 0 && (
        <Panel>
          <EmptyState title="No charts yet" description="Nothing on this page has a chart to draw." />
        </Panel>
      )}
    </ShellPage>
  );
}
