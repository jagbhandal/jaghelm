import React, { useState } from 'react';
import {
  DISK_FORECAST_DEFAULT,
  DISK_FORECAST_LIMITS,
} from '../../../../server/diskForecastLines.js';
import { useConfig } from '../../../context/ConfigContext.jsx';
import { MeterNote } from '@ui/metric-meter';
import { daysLeftText, forecastLinesOf, forecastState } from '../../../shell/diskForecast.js';
import Field from '../Field.jsx';
import { Card, UiButton } from '../primitives.jsx';

/**
 * Settings → Nodes & Services → Disk forecast (#670): the two lines the
 * Infrastructure page and the phone's node cards colour "N days left" by.
 * Amber under the first, red under the second. They only change how the
 * server's forecast is drawn, so a change shows at once. A pair that makes
 * no sense (red not under amber) is said, and not saved.
 */
export default function DiskForecast() {
  const { config, update } = useConfig();
  const lines = forecastLinesOf(config);
  const [draft, setDraft] = useState(null); // { warn, crit } as typed, while it isn't a pair
  const shown = draft ?? { warn: String(lines.warn), crit: String(lines.crit) };
  const { min, max } = DISK_FORECAST_LIMITS;

  const whole = (v) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;
  const error = (next) =>
    !whole(next.warn) || !whole(next.crit)
      ? `Each line is a whole number of days, ${min} to ${max}. Not saved.`
      : Number(next.crit) >= Number(next.warn)
        ? 'The red line has to be fewer days than the amber line. Not saved.'
        : null;
  const change = (key) => (e) => {
    const next = { ...shown, [key]: e.target.value };
    if (error(next)) setDraft(next);
    else {
      setDraft(null);
      update('diskForecastDays', { warn: Number(next.warn), crit: Number(next.crit) });
    }
  };
  const problem = draft ? error(draft) : null;
  // What the three colours look like with these lines.
  const samples = [lines.warn, lines.crit, 0.5].map((days) => ({
    state: forecastState(days, lines),
    text: daysLeftText(days),
  }));
  const isDefault =
    !draft &&
    lines.warn === DISK_FORECAST_DEFAULT.warn &&
    lines.crit === DISK_FORECAST_DEFAULT.crit;
  return (
    <Card>
      <p className="settings-hint-block">
        Infrastructure and the phone's node cards show how many days are left before a node's disk
        fills, from a line fitted to the last week. It turns amber and red under these lines. It
        only colours the forecast; it sends no alert.
      </p>
      <Field label="Amber under (days left)" error={problem}>
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step="1"
          value={shown.warn}
          onChange={change('warn')}
        />
      </Field>
      <Field label="Red under (days left)">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step="1"
          value={shown.crit}
          onChange={change('crit')}
        />
      </Field>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 24px' }}
        data-slot="forecast-preview"
      >
        {samples.map((note) => (
          <MeterNote key={note.text} note={note} />
        ))}
      </div>
      <UiButton
        variant="secondary"
        size="sm"
        disabled={isDefault}
        onClick={() => {
          setDraft(null);
          update('diskForecastDays', undefined);
        }}
      >
        Reset to {DISK_FORECAST_DEFAULT.warn} and {DISK_FORECAST_DEFAULT.crit} days
      </UiButton>
    </Card>
  );
}
