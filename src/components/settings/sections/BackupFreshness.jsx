import React, { useState } from 'react';
import {
  BACKUP_AGE_DEFAULT,
  BACKUP_AGE_LIMITS,
  backupAgeLines,
} from '../../../../server/backupAgeLines.js';
import { useConfig } from '../../../context/ConfigContext.jsx';
import { StatusLamp } from '@ui/status-lamp';
import { AGE_WORD, ageState } from '../../../shell/backups.js';
import Field from '../Field.jsx';
import { Card, UiButton } from '../primitives.jsx';

/**
 * Settings → Nodes & Services → Backup freshness (#675): the two lines the
 * Overview's Backups section colours "last good run N h ago" by. Amber from the
 * first, red from the second (amber at most for a host that may be off). They
 * only change how the age is drawn, so a change shows at once. A pair that
 * makes no sense (red not over amber) is said, and not saved.
 */
export default function BackupFreshness() {
  const { config, update } = useConfig();
  const lines = backupAgeLines(config?.backupAgeHours);
  const [edited, setEdited] = useState('crit');
  const [draft, setDraft] = useState(null); // { warn, crit } as typed, while it isn't a pair
  const shown = draft ?? { warn: String(lines.warn), crit: String(lines.crit) };
  const { min, max } = BACKUP_AGE_LIMITS;

  const whole = (v) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;
  const errors = (next, edited) => {
    const out = {};
    const words = `Whole hours, ${min} to ${max}. Not saved.`;
    if (!whole(next.warn)) out.warn = words;
    if (!whole(next.crit)) out.crit = words;
    if (!out.warn && !out.crit && Number(next.crit) <= Number(next.warn)) {
      out[edited] =
        edited === 'crit'
          ? 'Red has to be more hours than amber. Not saved.'
          : 'Amber has to be fewer hours than red. Not saved.';
    }
    return out;
  };
  const change = (key) => (e) => {
    const next = { ...shown, [key]: e.target.value };
    if (Object.keys(errors(next, key)).length) {
      setDraft(next);
      setEdited(key);
    } else {
      setDraft(null);
      update('backupAgeHours', { warn: Number(next.warn), crit: Number(next.crit) });
    }
  };
  const problem = draft ? errors(draft, edited) : {};
  // What the three colours look like with these lines.
  const samples = [Math.max(1, lines.warn - 1), lines.warn, lines.crit].map((hours) => {
    const state = ageState(hours, lines);
    return { state, hours, text: `${AGE_WORD[state]} · last good run ${hours} h ago` };
  });
  const isDefault =
    !draft && lines.warn === BACKUP_AGE_DEFAULT.warn && lines.crit === BACKUP_AGE_DEFAULT.crit;
  return (
    <Card>
      <p className="settings-hint-block">
        The Overview's Backups section shows how long ago each backup last ran well. It turns amber
        and red at these ages. A backup that last reported a failure is red whatever its age, and
        a host that is not reachable now is amber at most. It only colours the section; it sends no
        alert.
      </p>
      <Field label="Amber from (hours since the last good run)" error={problem.warn}>
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
      <Field label="Red from (hours since the last good run)" error={problem.crit}>
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
      <ul
        style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 24px', listStyle: 'none', padding: 0 }}
        data-slot="backup-age-preview"
      >
        {samples.map((s) => (
          <li key={s.state} data-state={s.state} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <StatusLamp state={s.state} label={AGE_WORD[s.state]} decorative />
            <span>{s.text}</span>
          </li>
        ))}
      </ul>
      <UiButton
        variant="secondary"
        size="sm"
        disabled={isDefault}
        onClick={() => {
          setDraft(null);
          update('backupAgeHours', undefined);
        }}
      >
        Reset to {BACKUP_AGE_DEFAULT.warn} and {BACKUP_AGE_DEFAULT.crit} hours
      </UiButton>
    </Card>
  );
}
