/**
 * The Monitoring page (#751, spec §5, §7), from 768px at /monitoring: the
 * lab's charts in sections whose headings say what they answer (Power and
 * cost, Capacity, Resources, Containers, Drives), under one range switch (1 h,
 * 24 h, 7 d, 30 d). The server owns the charts (GET /api/monitoring,
 * server/monitoring.js: a table of chart id, title, question and section); the
 * page draws each from its entry in DRAWINGS (monitoringDrawings.jsx) and sends a range
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
 * The banner above the charts (MonitoringBanner.jsx, #752) is drawn only when
 * the status model has an issue one of these charts answers, each with a
 * "View graph" link to /monitoring?focus=<chart-id>; the page scrolls to,
 * rings and tags that chart (useChartFocus.js), and a chart not drawn is
 * quietly left alone. The charts are never hidden when healthy.
 *
 * It reads once its range's step has passed on an answer of the header's
 * status poll (useMonitoring.js): the one extra request of tickBudget.js.
 * Its own chunk (lazyViews.js); below 768px the phone's page takes the
 * address (a later card, #755).
 */
import { useMemo, useState } from 'react';
import { MONITORING_SECTIONS } from '../../server/monitoringSections.js';
import { EmptyState } from '@ui/empty-state';
import { MonitoringNote, MonitoringSection, chartFocus } from '@ui/monitoring-section';
import { Panel } from '@ui/panel';
import { SegmentedControl } from '@ui/segmented-control';
import { ShellPage } from '@ui/app-shell';
import { DRAWINGS, MONITORING_RANGES, monitoringRangeOf } from './monitoring.js';
import { useMonitoring } from './useMonitoring.js';
import { MonitoringBanner } from './MonitoringBanner.jsx';
import { FocusTag } from './FocusTag.jsx';
import { useChartFocus } from './useChartFocus.js';

/** The sections the page has charts for: those the answer holds, else those the client can draw. */
function sectionsOf(body) {
  const ids = new Set(
    body
      ? body.charts.filter((c) => Object.hasOwn(DRAWINGS, c.id)).map((c) => c.section)
      : Object.values(DRAWINGS).map((d) => d.section)
  );
  return MONITORING_SECTIONS.filter((s) => ids.has(s.id));
}

/** One chart's Panel: its title and question are the server's; what is inside is its drawing's Body (monitoringDrawings.jsx). */
export function ChartPanel({ chart, range, busy, focus }) {
  const { Body } = DRAWINGS[chart.id];
  return (
    <Panel
      data-slot="monitoring-chart"
      data-chart={chart.id}
      title={chart.title}
      titleAs="h3"
      description={chart.question}
      {...chartFocus(Boolean(focus), focus?.tag)}
    >
      <Body chart={chart} range={range} busy={busy} />
    </Panel>
  );
}

export default function MonitoringPage({ updated, status, reach }) {
  const [rangeValue, setRangeValue] = useState(MONITORING_RANGES[0].value);
  const { body, range: answered, error, busy } = useMonitoring(rangeValue, updated);
  const sections = useMemo(() => sectionsOf(body), [body]);
  // The range an answer is of, for its ticks and its name, while a switch is read.
  const drawn = monitoringRangeOf(body ? answered : rangeValue);
  // The charts the page draws, for the banner's links and the focus (#752).
  const chartIds = useMemo(
    () =>
      new Set(
        (body ? body.charts.map((c) => c.id) : []).filter((id) => Object.hasOwn(DRAWINGS, id))
      ),
    [body]
  );
  const titles = useMemo(
    () => Object.fromEntries((body?.charts ?? []).map((c) => [c.id, c.title])),
    [body]
  );
  const focus = useChartFocus({ loaded: body !== null, status, charts: titles });

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
      {body && (
        <MonitoringBanner status={status} reach={reach} updated={updated} drawn={chartIds} />
      )}
      <span role="status" className="sr-only">
        {focus.announce}
      </span>
      {error && (
        <MonitoringNote data-slot="monitoring-error">
          {body
            ? `The last read of the charts failed (${error}); these are from the one before.`
            : `The charts couldn't be read (${error}).`}
        </MonitoringNote>
      )}
      {sections.map((section) => (
        <MonitoringSection
          key={section.id}
          data-section={section.id}
          title={section.title}
          question={section.question}
          loading={!body && !error}
        >
          {body &&
            body.charts
              .filter((c) => c.section === section.id && Object.hasOwn(DRAWINGS, c.id))
              .map((chart) => (
                <ChartPanel
                  key={chart.id}
                  chart={chart}
                  range={drawn}
                  busy={busy}
                  focus={
                    focus.active === chart.id
                      ? {
                          tag: focus.issue && (
                            <FocusTag
                              issue={focus.issue}
                              status={status}
                              reach={reach}
                              updated={updated}
                            />
                          ),
                        }
                      : null
                  }
                />
              ))}
        </MonitoringSection>
      ))}
      {body && sections.length === 0 && (
        <Panel>
          <EmptyState
            title="No charts yet"
            description="Nothing on this page has a chart to draw."
          />
        </Panel>
      )}
    </ShellPage>
  );
}
