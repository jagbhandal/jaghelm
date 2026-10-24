import React, { useMemo, useState } from 'react';
import { Bell } from 'lucide-react';
import { ShellSection } from '@ui/app-shell';
import { PushCategories, PushDevices } from '@ui/push-devices';
import { WebPushDevice } from '@ui/web-push';
import { ThresholdTable } from '@ui/threshold-table';
import {
  METRIC_WORDS,
  draftErrors,
  draftOf,
  sameDraft,
  tableOf,
  useThresholds,
  usePushDevices,
} from './notificationsData.js';
import { useWebPush } from './webPushData.js';

/**
 * Settings → Notifications (#320, spec §6.1, §7; closes #268): the lines the
 * status model judges every node by, so push too (Thresholds); what kinds of
 * event page the phones (What pages the phones); and the phones push sends
 * to, with a test push to prove it works end to end (Devices).
 *
 * The thresholds are the server's (GET/PUT /api/thresholds): saved over the
 * version read, judged by from the next refresh, by the board and push
 * alike. A row is checked here as the server checks it, and the server's
 * refusal, when it has one, shows on its row. The categories are each
 * phone's own, chosen in the Android app (#539): listed here read-only,
 * with what each phone chose on its row. No token is ever on this page: a
 * phone is its fingerprint (notificationsData.js, src/ui/push-devices.jsx).
 * Alerts on this device (#653) turns on Web Push for the browser or installed
 * app in front of you (webPushData.js, src/ui/web-push.jsx): a browser is a
 * device in the list below like a phone, and never shows its endpoint.
 */
export default function Notifications() {
  // One read of the phones: the categories' defaults and the devices draw from it.
  const devices = usePushDevices();
  return (
    <ShellSection>
      <ThresholdsPart />
      <PushCategories id="categories" className={ANCHOR} defaults={devices.data?.defaults} />
      <ThisDevicePart devices={devices} />
      <DevicesPart {...devices} />
    </ShellSection>
  );
}

Notifications.icon = <Bell />;

// A part a link opens at stops under the header (global.css).
const ANCHOR = 'settings-anchor';

function ThresholdsPart() {
  const { rows, loading, error, readOnly, reload, save } = useThresholds();
  // The fields' text as edited; null: as read.
  const [edited, setEdited] = useState(null);
  const [serverError, setServerError] = useState(null); // { metric, text }
  // Where the page's own check speaks: rows focus has left, or all after a Save.
  const [touched, setTouched] = useState(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  // A new read (the first, a save's answer, a reload after a conflict) starts the edits over.
  const [readRows, setReadRows] = useState(rows);
  if (rows !== readRows) {
    setReadRows(rows);
    setEdited(null);
    setTouched(new Set());
    setAttempted(false);
  }

  const saved = useMemo(() => (rows ? draftOf(rows) : null), [rows]);
  const defaults = useMemo(() => (rows ? draftOf(rows, { defaults: true }) : null), [rows]);
  const draft = edited ?? saved;
  const problems = useMemo(() => (rows && draft ? draftErrors(rows, draft) : {}), [rows, draft]);
  // A row still as read isn't an error, whatever is on disk: a notice, until it is edited.
  const untouched = (metric) =>
    !edited || sameDraft({ [metric]: draft[metric] }, { [metric]: saved[metric] });
  const errors = Object.fromEntries(Object.entries(problems).filter(([m]) => !untouched(m)));
  const dirty = Boolean(saved && draft && !sameDraft(draft, saved));
  const setDraft = (change) => setEdited((d) => change(d ?? saved));

  const onChange = (metric, field, value) => {
    setDraft((d) => ({ ...d, [metric]: { ...d[metric], [field]: value } }));
    setServerError(null);
    setStatus(null);
  };
  const onReset = (metric) => {
    setDraft((d) => ({ ...d, [metric]: defaults[metric] }));
    setServerError(null);
    setStatus(null);
  };
  const onSave = async () => {
    setAttempted(true);
    if (Object.keys(errors).length > 0) {
      setStatus({ tone: 'error', text: 'Fix the lines marked above first.' });
      return;
    }
    setSaving(true);
    const out = await save(tableOf(rows, draft));
    setSaving(false);
    if (out.ok) {
      setStatus({
        tone: 'info',
        text: 'Saved. The board and push judge by these from the next refresh.',
      });
    } else if (out.conflict) {
      setStatus({
        tone: 'error',
        text: 'The thresholds changed on another device since this page read them. These are the saved ones now: make your change again.',
      });
    } else if (out.metric) {
      setServerError({ metric: out.metric, text: out.error });
    } else {
      setStatus({ tone: 'error', text: out.error });
    }
  };

  const view =
    rows && draft
      ? rows.map((r) => ({
          metric: r.metric,
          label: METRIC_WORDS[r.metric]?.label ?? r.metric,
          hint: METRIC_WORDS[r.metric]?.hint ?? null,
          unit: r.unit,
          warn: draft[r.metric].warn,
          crit: draft[r.metric].crit,
          defaults: r.defaults,
          custom: !sameDraft({ [r.metric]: draft[r.metric] }, { [r.metric]: defaults[r.metric] }),
          // The page's own check speaks once focus has left the row, or on Save.
          error:
            (touched.has(r.metric) || attempted ? errors[r.metric] : null) ??
            (serverError?.metric === r.metric ? serverError.text : null),
          notice:
            untouched(r.metric) && problems[r.metric]
              ? `As set on the host: ${problems[r.metric]}. Change a line to fix it.`
              : null,
        }))
      : [];

  return (
    <ThresholdTable
      id="thresholds"
      className={ANCHOR}
      description={describe(rows)}
      rows={view}
      onChange={onChange}
      onReset={onReset}
      onRowBlur={(metric) => setTouched((t) => new Set(t).add(metric))}
      dirty={dirty}
      saving={saving}
      status={
        readOnly ? { tone: 'info', text: 'This is a read-only demo: nothing is saved.' } : status
      }
      onSave={onSave}
      onDiscard={() => {
        setEdited(null);
        setServerError(null);
        setStatus(null);
        setTouched(new Set());
        setAttempted(false);
      }}
      readOnly={readOnly}
      unread={rows ? null : { loading, error, onRetry: reload }}
    />
  );
}

/** The panel's line: the hysteresis in force (each row's `band`), not a number of its own. */
function describe(rows) {
  const lead = 'The board and push judge every node by these lines.';
  const percent = rows?.find((r) => r.unit === '%')?.band;
  const celsius = rows?.find((r) => r.unit === '°C')?.band;
  if (percent == null || celsius == null) return lead;
  const points = percent === 1 ? '1 point' : `${percent} points`;
  return `${lead} A level holds until the reading falls ${points} (${celsius} °C) under its line.`;
}

/**
 * Alerts on this device (#653): Web Push for the browser this page is open in.
 * The device list below follows what turning it on or off does, and its test
 * alert is the list's own test push for this device's row.
 */
function ThisDevicePart({ devices }) {
  const web = useWebPush();
  const { reload } = devices;
  const mine = web.id ? devices.data?.test?.results?.find((r) => r.device === web.id) : null;
  const onEnable = async () => {
    await web.enable();
    reload();
  };
  const onDisable = async () => {
    await web.disable();
    reload();
  };
  return (
    <WebPushDevice
      id="this-device"
      className={ANCHOR}
      state={web.state}
      reason={web.reason}
      detail={web.detail}
      name={web.name}
      busy={web.busy || devices.busy}
      notice={web.notice ?? (devices.notice?.tone === 'error' && web.id ? devices.notice : null)}
      test={mine?.sentence ?? null}
      onEnable={onEnable}
      onDisable={onDisable}
      onTest={() => devices.test(web.id)}
      readOnly={web.readOnly}
    />
  );
}

function DevicesPart({ data, loading, error, busy, notice, readOnly, now, reload, remove, test }) {
  return (
    <PushDevices
      id="devices"
      className={ANCHOR}
      enabled={Boolean(data?.enabled)}
      stalled={data?.stalled?.sentence ?? null}
      devices={data?.devices ?? []}
      test={data?.test ?? null}
      now={now}
      busy={busy}
      notice={notice}
      onTest={test}
      onRemove={remove}
      readOnly={readOnly}
      unread={data ? null : { loading, error, onRetry: reload }}
    />
  );
}
