import React, { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  ENERGY_CURRENCY_DEFAULT,
  ENERGY_CURRENCY_MAX,
  ENERGY_MAX_PER_KWH,
  ENERGY_MAX_RATES,
  validDay,
} from '../../../../server/energy.js';
import { useConfig } from '../../../context/ConfigContext.jsx';
import Field from '../Field.jsx';
import { Card, EmptyState, UiButton } from '../primitives.jsx';
import { draftOf, energyProblems, energyValue } from './energyRates.js';

/**
 * Settings → System → Energy cost (Monitoring A2, #743): the currency symbol
 * and the rate history the cost chart prices the power in. The display config's
 * `energy` key (server/energy.js reads it): a list of rates, each the day it
 * starts on and a price per kWh; the newest is the current rate.
 *
 * The server drops a row that breaks a rule, so this says each rule where the
 * row is and saves nothing while any row or the currency is wrong (the saved
 * rates stay as they were) instead of losing a row without a word. It also
 * drops the whole key when no rate is valid, so a currency alone is never
 * saved: it is kept with the first rate, and the editor says so.
 *
 * `initial` is a draft to open with (the gallery shows a row with a problem).
 */
export default function EnergyCost({ initial = null }) {
  const { config, update } = useConfig();
  const [draft, setDraft] = useState(() => initial ?? draftOf(config.energy));
  const nextKey = useRef(draft.rates.length);
  // What this editor last put in the config (or read from it), so a change
  // from elsewhere (an import in Backup) replaces the draft and our own does not.
  const pushed = useRef(JSON.stringify(config.energy ?? null));
  useEffect(() => {
    const now = JSON.stringify(config.energy ?? null);
    if (now === pushed.current) return;
    pushed.current = now;
    setDraft(draftOf(config.energy));
  }, [config.energy]);

  const problems = energyProblems(draft);
  const clean = !problems.currency && problems.rates.every((p) => !p.from && !p.price);

  // Every change goes through here: keep the draft, and save it only when it
  // is all valid (or empty, which clears the key).
  const change = (next) => {
    setDraft(next);
    const p = energyProblems(next);
    if (p.currency || p.rates.some((r) => r.from || r.price)) return;
    const value = energyValue(next);
    pushed.current = JSON.stringify(value ?? null);
    update('energy', value);
  };
  const setRate = (key, patch) =>
    change({ ...draft, rates: draft.rates.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  const add = () =>
    change({
      ...draft,
      rates: [...draft.rates, { key: nextKey.current++, from: today(), price: '' }],
    });
  const remove = (key) => change({ ...draft, rates: draft.rates.filter((r) => r.key !== key) });

  // The newest valid start day is the current rate.
  const days = draft.rates.map((r) => r.from).filter(validDay);
  const newest = days.length ? days.reduce((a, b) => (a > b ? a : b)) : null;
  const currentKey = draft.rates.find((r) => r.from === newest)?.key;
  const full = draft.rates.length >= ENERGY_MAX_RATES;

  return (
    <Card>
      <p className="settings-hint-block">
        Add a rate for each time the price changed. Each applies from its date, and the newest is
        the current one. A day before the first date uses the first rate.
      </p>
      <Field
        label="Currency symbol"
        error={problems.currency}
        hint={
          draft.rates.length === 0
            ? 'Used once you add a rate: it is saved together with the first rate.'
            : `Just the symbol, such as ${ENERGY_CURRENCY_DEFAULT}. Default ${ENERGY_CURRENCY_DEFAULT}`
        }
      >
        <input
          type="text"
          autoComplete="off"
          value={draft.currency}
          onChange={(e) => change({ ...draft, currency: e.target.value })}
          style={{ maxWidth: 120 }}
        />
      </Field>

      {draft.rates.length === 0 ? (
        <EmptyState>
          No rates yet. Add the price per kWh from your bill to see what your power costs.
        </EmptyState>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
          {draft.rates.map((rate, i) => (
            <li key={rate.key}>
              <div
                role="group"
                aria-label={`Rate ${i + 1}`}
                data-slot="energy-rate"
                data-current={rate.key === currentKey ? 'true' : undefined}
                style={{
                  border: '1px solid var(--glass-border)',
                  borderRadius: 12,
                  padding: 12,
                  display: 'grid',
                  gap: 10,
                }}
              >
                <div className="settings-row-spread">
                  <span className="settings-item-subtitle">
                    Rate {i + 1}
                    {rate.key === currentKey && (
                      <strong style={{ marginLeft: 8, color: 'var(--text-primary)' }}>
                        Current
                      </strong>
                    )}
                  </span>
                  <UiButton
                    variant="secondary"
                    size="sm"
                    aria-label={`Remove rate ${i + 1}`}
                    onClick={() => remove(rate.key)}
                  >
                    Remove
                  </UiButton>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gap: 12,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  }}
                >
                  <Field label="Effective from" error={problems.rates[i].from}>
                    <input
                      type="date"
                      value={rate.from}
                      onChange={(e) => setRate(rate.key, { from: e.target.value })}
                    />
                  </Field>
                  <Field
                    label={`Price per kWh (${draft.currency.trim() || ENERGY_CURRENCY_DEFAULT})`}
                    error={problems.rates[i].price}
                  >
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0.14"
                      value={rate.price}
                      onChange={(e) => setRate(rate.key, { price: e.target.value })}
                    />
                  </Field>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <UiButton variant="secondary" size="sm" disabled={full} onClick={add}>
          <Plus aria-hidden="true" /> Add a rate
        </UiButton>
        {full && (
          <span className="settings-hint">
            At most {ENERGY_MAX_RATES} rates. Remove one to add another.
          </span>
        )}
      </div>
      {!clean && (
        <p className="settings-hint-block" role="status">
          Not saved yet: fix what is marked above. Until then the last good rates stay in use.
        </p>
      )}
      <p className="settings-hint-block">
        A price per kWh is above 0 and at most {ENERGY_MAX_PER_KWH}. Each date can be used once.
      </p>
    </Card>
  );
}

/** Today as YYYY-MM-DD in this browser's own zone, the new row's start day. */
function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
