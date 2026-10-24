import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  EXPIRY_DEFAULT,
  EXPIRY_LIMITS,
  MAX_TLS_TARGETS,
  cleanTargets,
  expiryLines,
  parseTarget,
} from '../../../../server/expiryTargets.js';
import { useConfig } from '../../../context/ConfigContext.jsx';
import { MeterNote } from '@ui/metric-meter';
import { rowNote, useExpiry } from '../../../shell/expiry.js';
import Field from '../Field.jsx';
import { Card, UiButton } from '../primitives.jsx';

/** How often this page asks the server again (a new target's result shows within it). */
const SETTINGS_POLL_MS = 10_000;

/**
 * Settings → Nodes & Services → Expiry (#676): the TLS certificates the server
 * reads (a list you add to and remove from, one-click suggestions from the
 * https hosts in your integration URLs), the Tailscale node keys (set up with
 * an environment variable, not here: this says whether it is), and the two
 * lines in days where an item turns amber and red. Targets are read by the
 * server every 6 hours, and at once when one is added; the lines only change
 * how the result is drawn. Nothing here sends an alert.
 */
export default function Expiry() {
  const { config, update } = useConfig();
  const body = useExpiry({ intervalMs: SETTINGS_POLL_MS });
  const tracked = cleanTargets(config.expiry?.tls);
  const lines = expiryLines(config);
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState(null);
  const [edited, setEdited] = useState('crit');
  const [draft, setDraft] = useState(null); // { warn, crit } as typed, while it isn't a pair
  const shown = draft ?? { warn: String(lines.warn), crit: String(lines.crit) };
  const { min, max } = EXPIRY_LIMITS;

  const save = (list) => update('expiry', list.length ? { tls: list } : undefined);
  const add = (text) => {
    const t = parseTarget(text);
    if (!t) {
      setProblem(
        'A host name or address, with a port if it is not 443 (nas.example.com or 192.168.1.5:8443). No https://, path or user name. Not added.'
      );
      return false;
    }
    if (tracked.includes(t.key)) {
      setProblem(`${t.key} is already tracked.`);
      return false;
    }
    if (tracked.length >= MAX_TLS_TARGETS) {
      setProblem(`At most ${MAX_TLS_TARGETS} targets. Remove one first.`);
      return false;
    }
    setProblem(null);
    save([...tracked, t.key]);
    return true;
  };
  const remove = (key) => save(tracked.filter((k) => k !== key));

  const results = new Map((body?.items ?? []).filter((i) => i.source === 'tls').map((i) => [i.name, i]));
  const suggestions = (body?.suggestions ?? []).filter((s) => !tracked.includes(s));
  const ts = body?.tailscale;

  const whole = (v) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;
  const errors = (next, which) => {
    const out = {};
    const words = `Whole days, ${min} to ${max}. Not saved.`;
    if (!whole(next.warn)) out.warn = words;
    if (!whole(next.crit)) out.crit = words;
    if (!out.warn && !out.crit && Number(next.crit) >= Number(next.warn)) {
      out[which] =
        which === 'crit'
          ? 'Red has to be fewer days than amber. Not saved.'
          : 'Amber has to be more days than red. Not saved.';
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
      update('expiryWarnDays', Number(next.warn));
      update('expiryCritDays', Number(next.crit));
    }
  };
  const lineProblem = draft ? errors(draft, edited) : {};
  const samples = [lines.warn + 5, lines.warn - 1, lines.crit - 1].map((days) => ({
    days,
    ...rowNote({ state: 'ok', daysLeft: days }, lines),
  }));
  const isDefault = !draft && lines.warn === EXPIRY_DEFAULT.warn && lines.crit === EXPIRY_DEFAULT.crit;

  return (
    <>
      <Card title="TLS certificates">
        <p className="settings-hint-block">
          JagHelm makes a TLS handshake with each of these every 6 hours and reads the certificate's
          end date and issuer; it sends nothing else and follows no redirect. An expired or
          self-signed certificate is read and reported, not trusted. Private addresses are fine
          unless JAGHELM_BLOCK_PRIVATE_NETWORKS is on, which refuses them.
        </p>
        {tracked.length === 0 ? (
          <p className="settings-hint-block" data-slot="expiry-empty">
            Nothing tracked yet. The Overview shows an Expiry section once there is a target here
            or a Tailscale key.
          </p>
        ) : (
          <ul
            aria-label="Tracked TLS targets"
            style={{ listStyle: 'none', margin: '8px 0', padding: 0, display: 'grid', gap: 6 }}
          >
            {tracked.map((key) => {
              const found = results.get(key);
              const note = found ? rowNote(found, lines) : null;
              return (
                <li
                  key={key}
                  className="settings-item-row"
                  style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
                >
                  <span className="settings-mono" style={{ flex: '1 1 12rem', minWidth: 0 }}>
                    {key}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {note ? note.text : 'Not checked yet'}
                  </span>
                  <button
                    type="button"
                    className="settings-btn-danger settings-btn-compact"
                    aria-label={`Stop tracking ${key}`}
                    onClick={() => remove(key)}
                  >
                    <X aria-hidden="true" size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (add(typed)) setTyped('');
          }}
          style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 8 }}
        >
          <div style={{ flex: '1 1 14rem' }}>
            <Field label="Add a host" error={problem}>
              <input
                className="settings-input"
                value={typed}
                placeholder="nas.example.com or 192.168.1.5:8443"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setTyped(e.target.value)}
              />
            </Field>
          </div>
          <UiButton type="submit" variant="secondary" size="sm" disabled={typed.trim() === ''}>
            <Plus aria-hidden="true" /> Track
          </UiButton>
        </form>
        {suggestions.length > 0 && (
          <div data-slot="expiry-suggestions">
            <span className="settings-item-subtitle">From your integration URLs (https)</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
              {suggestions.map((s) => (
                <UiButton
                  key={s}
                  variant="ghost"
                  size="sm"
                  tone="accent"
                  aria-label={`Track ${s}`}
                  onClick={() => add(s)}
                >
                  <Plus aria-hidden="true" /> {s}
                </UiButton>
              ))}
            </div>
          </div>
        )}
      </Card>
      <Card title="Tailscale node keys">
        <p className="settings-hint-block" data-slot="expiry-tailscale">
          {ts?.configured
            ? ts.state === 'rejected'
              ? 'Tailscale rejected the key. API access tokens last 90 days at most: make a new one and set it as JAGHELM_TAILSCALE_API_KEY.'
              : ts.state === 'ok'
                ? 'A Tailscale API key is set; each device\'s key expiry is read every 6 hours and listed in Expiry. Devices with key expiry off are one line.'
                : "A Tailscale API key is set, but Tailscale isn't answering or the answer can't be read."
            : 'Not set up. Set JAGHELM_TAILSCALE_API_KEY (a read-only API access token from the Keys page of the Tailscale admin console) on the server to list each device\'s node key expiry. Restart JagHelm after setting it.'}
        </p>
      </Card>
      <Card title="Warning lines">
        <p className="settings-hint-block">
          An item turns amber and red under these lines, in days left. It only colours the list; it
          sends no alert.
        </p>
        <Field label="Amber under (days left)" error={lineProblem.warn}>
          <input
            className="settings-input"
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step="1"
            value={shown.warn}
            onChange={change('warn')}
          />
        </Field>
        <Field label="Red under (days left)" error={lineProblem.crit}>
          <input
            className="settings-input"
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step="1"
            value={shown.crit}
            onChange={change('crit')}
          />
        </Field>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 24px' }} data-slot="expiry-preview">
          {samples.map((s) => (
            <MeterNote key={s.days} note={{ state: s.state, text: s.text, said: s.said }} />
          ))}
        </div>
        <UiButton
          variant="secondary"
          size="sm"
          disabled={isDefault}
          onClick={() => {
            setDraft(null);
            update('expiryWarnDays', undefined);
            update('expiryCritDays', undefined);
          }}
        >
          Reset to {EXPIRY_DEFAULT.warn} and {EXPIRY_DEFAULT.crit} days
        </UiButton>
      </Card>
    </>
  );
}
