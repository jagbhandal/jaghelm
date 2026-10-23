/**
 * The UPS as the Overview's Power section draws it (#306), from the status
 * model alone (/api/status, docs/ARCHITECTURE.md §4.7): the UPS's entity
 * (`power/ups`, kind `ups`) carries its state, word and reason, its charge
 * (`metric`) and, on battery, the minutes it has left (`runtimeMinutes`,
 * #549). The client judges nothing (spec §6).
 *
 * The section is the UPS's place on the Overview at every state: on battery
 * its issue row opens its detail too, but on mains there is no issue, and
 * the old board's UPS panel was the only place it showed. Its row opens the
 * UPS's detail (#309, #310: the charge, load, model and runtime).
 *
 * A row, in the section's one group ("UPS"): its lamp, its name (the UPS's
 * model, or "UPS"), the charge while it is well ("100 % charge"), else the
 * model's reason ("On battery (82 % charge)"), and on battery the minutes
 * left as the meta. With a stale status (statusFreshness.js, #480), the row
 * is drawn as no signal, its words kept as last known, and no countdown is
 * drawn from it.
 */
import { drawnState } from './statusFreshness.js';

/** Whether `entity` is a UPS. */
export const isUps = (entity) => entity?.kind === 'ups';

/** Whether the model has a UPS. */
export function hasPower(status) {
  return (status?.entities ?? []).some(isUps);
}

/** The charge as the row says it, "100 % charge", from the model's metric; or null. */
function chargeOf(entity) {
  const m = entity?.metric;
  return m?.name === 'charge' && Number.isFinite(m.value) ? `${m.value} % charge` : null;
}

/**
 * The model's UPSes as rows: `{ id, name, where, level, state, word, detail,
 * meta, muted }`. `level` is the model's state, `state` the one drawn (no
 * signal while stale).
 *
 * @param {{ status: any, freshness?: { stale?: boolean } | null }} args
 */
export function powerRows({ status, freshness = null }) {
  const stale = !!freshness?.stale;
  return (status?.entities ?? []).filter(isUps).map((e) => {
    const well = e.state === 'ok';
    const left =
      !stale && !well && Number.isFinite(e.runtimeMinutes) ? `${e.runtimeMinutes} min left` : null;
    return {
      id: e.id,
      name: e.name || 'UPS',
      where: null,
      level: e.state,
      state: drawnState(e.state, freshness),
      word: e.word,
      detail: well ? (chargeOf(e) ?? e.reason) : e.reason,
      meta: left ?? '—',
      muted: true,
    };
  });
}

/**
 * The section's count: the Power subsystem's own words ("On mains", "On
 * battery"), or with a stale status how old they are ("No signal · last
 * known 3 min ago").
 */
export function powerCount(status, freshness = null) {
  if (freshness?.stale) return freshness.note ?? null;
  return status?.subsystems?.find((s) => s.id === 'power')?.detail ?? null;
}
