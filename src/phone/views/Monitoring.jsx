/**
 * Monitoring on a phone (#755, spec §5 and §7): the page at /monitoring below
 * 768px, reached from the More sheet (the five tabs stay). One column under the
 * phone's 16px gutter: the title and the range switch (1 h, 24 h, 7 d, 30 d,
 * 44px segments), the banner with its "View graph", then the sections of the
 * wide page, each chart in a Panel. Its own lazy chunk (lazyViews.js).
 *
 * It reads and judges exactly as the wide page does (src/shell/MonitoringPage.jsx):
 * the same read (useMonitoring: one request a step, on the status poll's
 * answers), the same banner, focus ring and tag (useChartFocus). Only the
 * drawing differs: each chart's phone Body from PHONE_DRAWINGS
 * (shell/monitoringPhone.jsx), list rows where the wide page has small
 * multiples; a chart with none says it is on a larger screen in words. The
 * banner counts only the charts drawn here, so "View graph" never lands on
 * that row.
 */
import { useMemo, useState } from 'react';
import { MONITORING_SECTIONS } from '../../../server/monitoringSections.js';
import { EmptyState } from '@ui/empty-state';
import { MonitoringNote, MonitoringSection, chartFocus } from '@ui/monitoring-section';
import { Panel } from '@ui/panel';
import { SegmentedControl } from '@ui/segmented-control';
import { DRAWINGS, MONITORING_RANGES, monitoringRangeOf } from '../../shell/monitoring.js';
import { PHONE_DRAWINGS, PhoneNotYet } from '../../shell/monitoringPhone.jsx';
import { useMonitoring } from '../../shell/useMonitoring.js';
import { MonitoringBanner } from '../../shell/MonitoringBanner.jsx';
import { FocusTag } from '../../shell/FocusTag.jsx';
import { useChartFocus } from '../../shell/useChartFocus.js';
import { PhonePage } from '../components/PhoneSheet.jsx';

const drawnHere = (id) => Object.hasOwn(PHONE_DRAWINGS, id);

/** The sections that have a chart the page draws: those the answer holds, else those the client can draw. */
function sectionsOf(body) {
  const ids = new Set(
    body
      ? body.charts.filter((c) => Object.hasOwn(DRAWINGS, c.id)).map((c) => c.section)
      : Object.values(DRAWINGS).map((d) => d.section)
  );
  return MONITORING_SECTIONS.filter((s) => ids.has(s.id));
}

/** One chart's Panel on the phone: its title and question are the server's, what is inside its phone Body (or the words that it is on a larger screen). */
export function PhoneChartPanel({ chart, range, busy, focus }) {
  const Body = PHONE_DRAWINGS[chart.id]?.Body ?? PhoneNotYet;
  return (
    <Panel
      data-slot="monitoring-chart"
      data-chart={chart.id}
      title={chart.title}
      titleAs="h3"
      description={chart.question}
      {...chartFocus(Boolean(focus), focus?.tag)}
    >
      <Body chart={chart} range={range} busy={busy} focus={focus} />
    </Panel>
  );
}

export default function Monitoring({ status, reach, updated }) {
  const [rangeValue, setRangeValue] = useState(MONITORING_RANGES[0].value);
  const { body, range: answered, error, busy } = useMonitoring(rangeValue, updated);
  const sections = useMemo(() => sectionsOf(body), [body]);
  const drawn = monitoringRangeOf(body ? answered : rangeValue);
  // The charts with a phone drawing: the banner's links and the focus go only to these.
  const chartIds = useMemo(
    () => new Set((body?.charts ?? []).map((c) => c.id).filter(drawnHere)),
    [body]
  );
  const titles = useMemo(
    () =>
      Object.fromEntries(
        (body?.charts ?? []).filter((c) => drawnHere(c.id)).map((c) => [c.id, c.title])
      ),
    [body]
  );
  const focus = useChartFocus({ loaded: body !== null, status, charts: titles });

  return (
    <PhonePage>
      <div data-slot="monitoring-phone" className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <h1 className="text-title">Monitoring</h1>
          <SegmentedControl
            aria-label="Range"
            size="touch"
            options={MONITORING_RANGES.map(({ value, label }) => ({ value, label }))}
            value={rangeValue}
            onValueChange={setRangeValue}
          />
        </div>
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
                .map((chart) => {
                  // The node the issue is of (#757) and a temperature issue's drill-down (#756), as on the wide page.
                  const focused =
                    focus.active === chart.id
                      ? {
                          node: focus.issue?.node,
                          drill: focus.issue?.metric?.name === 'temp',
                          tag: focus.issue && (
                            <FocusTag
                              issue={focus.issue}
                              status={status}
                              reach={reach}
                              updated={updated}
                            />
                          ),
                        }
                      : null;
                  return (
                    <PhoneChartPanel
                      key={chart.id}
                      chart={chart}
                      range={drawn}
                      busy={busy}
                      focus={focused}
                    />
                  );
                })}
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
      </div>
    </PhonePage>
  );
}
