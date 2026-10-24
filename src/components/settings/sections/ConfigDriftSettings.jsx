import React, { useState } from 'react';
import {
  DRIFT_STALE_DEFAULT_HOURS,
  DRIFT_STALE_LIMITS,
  staleHours,
} from '../../../../server/driftReports.js';
import { useConfig } from '../../../context/ConfigContext.jsx';
import Field from '../Field.jsx';
import { Card, UiButton } from '../primitives.jsx';

/**
 * Settings → Nodes & Services → Config drift (#674): how many hours without
 * any report from the hosts before the Overview's Config drift row stops
 * reading "No drift" and reads "Unknown" (amber). It only changes how the
 * pushed reports are judged, so a change shows at once. A value that is not
 * whole hours in range is said, and not saved.
 */
export default function ConfigDriftSettings() {
  const { config, update } = useConfig();
  const hours = staleHours(config?.driftStaleHours);
  const [draft, setDraft] = useState(null); // as typed, while it isn't usable
  const { min, max } = DRIFT_STALE_LIMITS;
  const shown = draft ?? String(hours);
  const change = (e) => {
    const v = e.target.value;
    if (/^\d+$/.test(v) && Number(v) >= min && Number(v) <= max) {
      setDraft(null);
      update('driftStaleHours', Number(v));
    } else {
      setDraft(v);
    }
  };
  return (
    <Card>
      <p className="settings-hint-block">
        Hosts push the result of their drift check to JagHelm. The Overview's Config drift row is
        green only while the newest report is fresher than this; a host that is switched off
        keeps its last report, with its age shown, and is not an alert. It sends no alert.
      </p>
      <Field
        label="Unknown after (hours without a report)"
        error={draft === null ? undefined : `Whole hours, ${min} to ${max}. Not saved.`}
      >
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step="1"
          value={shown}
          onChange={change}
        />
      </Field>
      <UiButton
        variant="secondary"
        size="sm"
        disabled={draft === null && config?.driftStaleHours === undefined}
        onClick={() => {
          setDraft(null);
          update('driftStaleHours', undefined);
        }}
      >
        Reset to {DRIFT_STALE_DEFAULT_HOURS} hours
      </UiButton>
    </Card>
  );
}
