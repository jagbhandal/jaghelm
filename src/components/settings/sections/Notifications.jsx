import React, { useMemo, useState } from 'react';
import { Bell } from 'lucide-react';
import { ShellSection } from '@ui/app-shell';
import { PushCategories, PushDevices } from '@ui/push-devices';
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
 */
export default function Notifications() {
  // One read of the phones: the categories' defaults and the devices draw from it.
  const devices = usePushDevices();
  return (
    <ShellSection>
      <ThresholdsPart />
      <PushCategories id="categories" className={ANCHOR} defaults={devices.data?.defaults} />
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
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  // A new read (the first, a save's answer, a reload after a conflict) starts the edits over.
  const [readRows, setReadRows] = useState(rows);
  if (rows !== readRows) {
    setReadRows(rows);
    setEdited(null);
  }

  const saved = useMemo(() => (rows ? draftOf(rows) : null), [rows]);
  const defaults = useMemo(() => (rows ? draftOf(rows, { defaults: true }) : null), [rows]);
  const draft = edited ?? saved;
  const errors = useMemo(() => (rows && draft ? draftErrors(rows, draft) : {}), [rows, draft]);
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
          error: errors[r.metric] ?? (serverError?.metric === r.metric ? serverError.text : null),
        }))
      : [];

  return (
    <ThresholdTable
      id="thresholds"
      className={ANCHOR}
      description="The board and push judge every node by these lines. A level holds until the reading falls 5 points (5 °C) under its line."
      rows={view}
      onChange={onChange}
      onReset={onReset}
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
      }}
      readOnly={readOnly}
      unread={rows ? null : { loading, error, onRetry: reload }}
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
