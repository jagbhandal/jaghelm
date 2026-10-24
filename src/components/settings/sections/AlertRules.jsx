import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SettingRow, SettingRows, ToggleRow } from '@ui/appearance';
import { CauseRows, QuietTimes, SilencedRows } from '@ui/alert-rules';
import { Panel } from '@ui/panel';
import { Select } from '@ui/select';
import { SettingsPart } from '@ui/settings';
import { apiFetch, isReadOnlyServer } from '../../../api/client.js';
import { useConfig } from '../../../context/ConfigContext.jsx';
import {
  LABEL_MAX,
  MATCH_MAX,
  MAX_CAUSES,
  quietAt,
  resolveAlerts,
} from '../../../../server/push/alertRules.js';

/**
 * Settings → Notifications → Alert rules (#669): how alerts reach the phones,
 * beyond what pages them. All four are the display config's `alerts` key
 * (server/push/alertRules.js reads it, the sender follows it from its next
 * round, and this page draws the same rules the sender uses):
 *
 *  - Group a burst: alerts within a window of the first become one push.
 *  - Quiet hours: the time zone is the server's setting (America/Toronto
 *    unless `alerts.timezone` says otherwise); critical pages still ring, or
 *    none do, and what is held arrives as one summary when they end.
 *  - Known causes: a label added to an alert whose service or host name holds
 *    the text, on the push and on the Alerts page.
 *  - What is snoozed or acked from a notification, with a way to lift it.
 */

const part = (id) => ({ id, className: 'settings-anchor' });

const WINDOWS = [
  { value: '0', label: 'Off: each alert on its own' },
  { value: '30', label: '30 seconds' },
  { value: '60', label: '1 minute' },
  { value: '120', label: '2 minutes' },
  { value: '300', label: '5 minutes' },
];

const MODES = [
  { value: 'critical', label: 'Critical still rings' },
  { value: 'silent', label: 'Silent' },
];

const windowWords = (seconds) =>
  seconds === 0
    ? 'Each alert is sent as soon as it happens.'
    : `Alerts within ${seconds < 60 ? `${seconds} seconds` : seconds === 60 ? '1 minute' : `${seconds / 60} minutes`} of the first arrive as one push, such as “5 services down on apps”. A critical alert is never held, and a lone one waits no longer than that.`;

/** The server's view of what is held, snoozed and acked (GET /api/push/alerts). */
function useHeldAlerts() {
  const [state, setState] = useState({ data: null, error: false });
  const reload = useCallback(async () => {
    try {
      const r = await apiFetch('/api/push/alerts', { cache: 'no-store' });
      if (!r.ok) throw new Error('read');
      setState({ data: await r.json(), error: false });
    } catch {
      setState((s) => ({ data: s.data, error: true }));
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  const clear = useCallback(
    async (tag) => {
      try {
        await apiFetch('/api/push/alerts/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag }),
        });
      } finally {
        await reload();
      }
    },
    [reload]
  );
  return { ...state, reload, clear };
}

const clockOf = (ms, timezone) =>
  new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(ms);

export default function AlertRules() {
  const { config, update } = useConfig();
  const rules = useMemo(() => resolveAlerts(config.alerts), [config.alerts]);
  const held = useHeldAlerts();
  const readOnly = isReadOnlyServer();
  const seconds = rules.groupWindowMs / 1000;
  const q = rules.quiet;
  // The clock the sender uses, so "quiet now" is what push does this minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const quiet = quietAt(rules, now);
  const place = rules.timezone === 'America/Toronto' ? 'Toronto time' : rules.timezone;

  const quietStatus = !q.enabled
    ? 'Quiet hours are off: every alert is sent as it happens.'
    : quiet.quiet
      ? `Quiet now, until ${clockOf(quiet.endsAt, rules.timezone)}. ${
          q.mode === 'silent' ? 'Nothing rings' : 'Only critical alerts ring'
        }; the rest arrive as one summary${held.data ? ` (${held.data.held} held now)` : ''}.`
      : `Not quiet now. From ${q.start} to ${q.end} ${place}, ${
          q.mode === 'silent' ? 'nothing rings' : 'only critical alerts ring'
        } and the rest arrive as one summary.`;

  return (
    <SettingsPart>
      <Panel
        title="Alert rules"
        description="How alerts reach your phones: grouped, held for the night, and tagged with what usually causes them."
        {...part('alert-rules')}
      >
        <SettingRows>
          <SettingRow
            {...part('alert-grouping')}
            titleAs="h3"
            label="Group a burst of alerts"
            description={windowWords(seconds)}
            control={(ids) => (
              <Select
                {...ids}
                items={WINDOWS}
                value={String(seconds)}
                disabled={readOnly}
                onValueChange={(value) => update('alerts.groupWindowSeconds', Number(value))}
              />
            )}
          />
          <ToggleRow
            {...part('quiet-hours')}
            titleAs="h3"
            label="Quiet hours"
            description={quietStatus}
            checked={q.enabled}
            disabled={readOnly}
            onCheckedChange={(on) => update('alerts.quietHours.enabled', on)}
          >
            {q.enabled ? (
              <QuietTimes
                start={q.start}
                end={q.end}
                mode={q.mode}
                modes={MODES}
                disabled={readOnly}
                onStart={(v) => update('alerts.quietHours.start', v)}
                onEnd={(v) => update('alerts.quietHours.end', v)}
                onMode={(v) => update('alerts.quietHours.mode', v)}
              />
            ) : null}
          </ToggleRow>
        </SettingRows>
        <KnownCauses
          causes={causesShown(config.alerts, rules)}
          readOnly={readOnly}
          update={update}
        />
        <Silenced held={held} readOnly={readOnly} />
      </Panel>
    </SettingsPart>
  );
}

/**
 * The rows as edited: the config's own list, so a row still being typed stays
 * on screen (the server keeps only rows with both a name and a label), else
 * what the sender would use.
 */
function causesShown(alerts, rules) {
  const own = alerts?.knownCauses;
  return Array.isArray(own) ? own.filter((c) => c && typeof c === 'object') : rules.causes;
}

function KnownCauses({ causes, readOnly, update }) {
  const set = (next) => update('alerts.knownCauses', next);
  return (
    <CauseRows
      {...part('known-causes')}
      causes={causes}
      disabled={readOnly}
      canAdd={causes.length < MAX_CAUSES}
      matchMax={MATCH_MAX}
      labelMax={LABEL_MAX}
      onChange={(i, change) => set(causes.map((c, at) => (at === i ? { ...c, ...change } : c)))}
      onDelete={(i) => set(causes.filter((_, at) => at !== i))}
      onAdd={() => set([...causes, { match: '', label: '' }])}
    />
  );
}

function Silenced({ held, readOnly }) {
  const { data, error, clear } = held;
  const rows = [
    ...(data?.snoozed ?? []).map((s) => ({
      tag: s.tag,
      text: `Snoozed until ${new Date(s.until).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
    })),
    ...(data?.acked ?? []).map((a) => ({ tag: a.tag, text: 'Acknowledged until it recovers' })),
  ];
  return (
    <SilencedRows
      {...part('silenced-alerts')}
      rows={rows}
      error={Boolean(error && !data)}
      disabled={readOnly}
      onLift={clear}
    />
  );
}
