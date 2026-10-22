/**
 * The status model, as the Android screens draw it (#325, spec §6, §9). The
 * server judges every state: /api/status's overall state and sentence, its
 * subsystems, its ranked issues and each entity's state, word and reason.
 * Nothing here judges one again. These only pick what each screen shows,
 * mostly through the web's own helpers (src/shell/statusView.js,
 * statusFreshness.js, infrastructureView.js), so the phone and the web say the
 * same words; the cross-client suite holds them to it (mobile/src/crossClient.test.jsx).
 *
 * A stale status (`freshness`, the web's rule, src/shell/statusFreshness.js,
 * #480) keeps its words, counts and reasons as last known, but every state
 * drawn from it is no signal: the steel ring, never green, amber or red.
 *
 * Pure: no React, no I/O.
 */
import { EMPTY, EMPTY_SENTENCE, WORDS, toState } from '@ui/lib/status.js';
import {
  headlineOf,
  lastKnownLine,
  subsystemCells,
  whereOf,
} from '@shared/shell/statusView.js';
import { drawnState } from '@shared/shell/statusFreshness.js';
import { infrastructureNodes } from '@shared/shell/infrastructureView.js';
import { shownReading } from '../../../server/status/readings.js';
import { flattenServices } from './derive.js';

/** A fresh status: nothing to say (statusFreshness.js's own, for a screen given none). */
export const FRESH = Object.freeze({ stale: false });

/** The overall states that keep the quiet line: maintenance never breaks it (spec §6.1). */
const QUIET = new Set(['ok', 'maintenance']);

/** What the status bar says before the first answer. */
export const CONNECTING = 'Connecting…';

/**
 * Each state's colour on the Android look (MobileApp.css's palette): what a
 * ring, a count or a fill is drawn in for the model's state, no signal for
 * any value it doesn't know.
 */
const COLOUR = Object.freeze({
  ok: 'var(--green)',
  warn: 'var(--amber)',
  crit: 'var(--red)',
  unknown: 'var(--steel)',
  maintenance: 'var(--jh-maintenance-fg)',
});

/** The colour token for a state the model (or a stale status) gives. */
export function colourOf(state) {
  return Object.hasOwn(COLOUR, state) ? COLOUR[state] : COLOUR.unknown;
}

/**
 * What the phone says of a server with no /api/status (a 404, useDashboard's
 * reach 'old'): one from before the status model, which the web, always
 * served by its own server, never meets.
 */
export const OLD_SERVER = 'This JagHelm server is older than 3.0.0: update it';

/**
 * The web's freshness (statusFreshness.js), with the one cause the phone has
 * of its own: the web's rule reads reach 'old' as "Can't reach JagHelm",
 * which would say so for as long as the server isn't updated.
 */
export function withServerCause(freshness, reach) {
  return reach === 'old' && freshness.stale ? { ...freshness, cause: OLD_SERVER } : freshness;
}

/**
 * The Overview's status card (the Android look of AttentionPanel), as the
 * web's attention panel words it: `{ state, headline, word, subline, counts }`.
 *
 *  - issues: the model's word for the board's state and the issues' counts,
 *    "Critical · 1 critical, 1 warning" (headlineOf), its word coloured, and
 *    the model's sentence under it;
 *  - quiet (ok, or only maintenance): "All systems normal", no coloured word,
 *    and the sentence ("All 12 services up · 3 nodes healthy");
 *  - an empty board (#449): the model's sentence, "Nothing monitored yet", and
 *    nothing else: it is neither healthy nor no signal;
 *  - stale: "No signal", why ("Can't reach JagHelm") and what it last knew
 *    ("last known 3 min ago: All systems normal");
 *  - no status yet: "No signal", and "Connecting…" while the first round runs.
 */
export function heroOf({ status, freshness = FRESH }) {
  if (!status || freshness.stale) {
    return {
      state: 'unknown',
      headline: WORDS.unknown,
      word: WORDS.unknown,
      subline: freshness.stale ? freshness.cause : CONNECTING,
      counts: (status && lastKnownLine(freshness, status)) || undefined,
    };
  }
  const { state, sentence } = status.overall;
  const issues = status.issues ?? [];
  if (state === EMPTY && issues.length === 0) {
    return { state: EMPTY, headline: sentence || EMPTY_SENTENCE };
  }
  const quiet = issues.length === 0 && QUIET.has(state);
  return {
    state: toState(state),
    headline: headlineOf(status),
    word: quiet ? undefined : WORDS[toState(state)],
    subline: sentence,
  };
}

/**
 * The status bar's lamp and sentence: the model's overall state (or `empty`,
 * drawn with no lamp) and its sentence; stale, no signal and why.
 */
export function annunciatorOf({ status, freshness = FRESH }) {
  if (freshness.stale) return { state: 'unknown', sentence: freshness.cause };
  if (!status) return { state: null, sentence: null };
  return { state: status.overall.state, sentence: status.overall.sentence };
}

/**
 * The UPS's readings the model doesn't carry, from /api/ups (`ups`), for
 * display only: on battery (the model has the UPS crit or warn, as the bolt
 * goes by), the runtime left, the model's reason already giving the charge
 * ("On battery (47 % charge)"); on mains (ok), its charge, by the model's one
 * rule for a reading. Null with no UPS in the model, no answer from /api/ups,
 * or nothing to add.
 */
export function upsReadingsOf({ status, ups }) {
  const e = status?.entities?.find((x) => x.id === 'power/ups');
  if (!e || !ups || ups.ok === false) return null;
  if (e.state === 'crit' || e.state === 'warn') {
    return Number.isFinite(ups.runtime) ? `${Math.round(ups.runtime / 60)} min left` : null;
  }
  if (e.state === 'ok' && Number.isFinite(ups.charge)) return `${shownReading(ups.charge)}% charge`;
  return null;
}

/**
 * The subsystem strip's cells: the web's (statusView.js subsystemCells), one
 * per subsystem with anything; the Power cell also carries the UPS's readings
 * (upsReadingsOf), on a line of their own under the model's detail.
 */
export function cellsOf({ status, freshness = FRESH, ups = null }) {
  const readings = upsReadingsOf({ status, ups });
  return subsystemCells(status, freshness).map((cell) =>
    cell.key === 'power' && readings ? { ...cell, readings } : cell
  );
}

/** Where a model entity opens on the phone (nav/issueRoute.js reads it). */
function targetOf(entity) {
  if (entity.kind === 'service' || entity.kind === 'container') {
    return { kind: 'service', uid: entity.id.slice('services/'.length) };
  }
  if (entity.kind === 'node') return { kind: 'node', nodeKey: entity.node };
  return { kind: 'incident' };
}

/**
 * The model's issues, ranked as it ranks them, as the Android IssueRow's
 * `incident`s: its state (no signal while stale), word, name, where it is
 * ("Service · vm103", whereOf), its reason, and where it opens. A UPS on
 * battery keeps the app's bolt.
 */
export function issueRowsOf({ status, freshness = FRESH }) {
  return (status?.issues ?? []).map((e) => {
    const state = drawnState(e.state, freshness);
    return {
      id: e.id,
      kind: e.kind,
      state,
      word: e.word,
      title: e.name,
      readout: whereOf(e) ?? '',
      cause: e.reason,
      shape: e.kind === 'ups' && (state === 'warn' || state === 'crit') ? 'bolt' : undefined,
      target: targetOf(e),
    };
  });
}

/** The model's entity for a service card (`services/<uid>`), or undefined. */
export function serviceEntity(status, uid) {
  return status?.entities?.find((e) => e.id === `services/${uid}`);
}

/**
 * Cards, worst first by the model's own ranking: those that are issues in the
 * order of its issue list (crit, warn, then no signal), then the rest as
 * listed. No order of the app's own.
 */
function problemsFirst(rows, status) {
  const rank = new Map((status?.issues ?? []).map((e, i) => [e.id, i]));
  const at = (row) => rank.get(`services/${row.uid}`) ?? Infinity;
  return rows
    .map((row, i) => [row, i])
    .sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1])
    .map(([row]) => row);
}

/**
 * Service cards as the Services list and Node detail draw them: each card of
 * /api/services (tagged with its node), with its entity's `state` (no signal
 * while stale) and `word`, and `modelState`, the model's own, for filtering.
 * A card the model hasn't judged yet (no status) is no signal. Worst first.
 */
export function serviceRowsOf({ status, servicesBody, freshness = FRESH, nodeKey }) {
  const cards = flattenServices(servicesBody).filter((s) => !nodeKey || s.nodeKey === nodeKey);
  const rows = cards.map((svc) => {
    const e = serviceEntity(status, svc.uid);
    const modelState = e ? e.state : 'unknown';
    return {
      ...svc,
      modelState,
      state: drawnState(modelState, freshness),
      word: e ? e.word : WORDS.unknown,
      reason: e?.reason ?? null,
    };
  });
  return problemsFirst(rows, status);
}

// The Android card's labels for the web's readings (infrastructureView.js READINGS).
const BAR_LABEL = { cpu: 'CPU', mem: 'MEM', disk: 'DISK', temp: 'TEMP' };

/** A reading as the Android UsageBar draws it. */
const barOf = (r) => ({
  key: r.key,
  label: BAR_LABEL[r.key],
  state: r.state,
  shown: r.shown,
  percent: r.value,
});

/**
 * Each node the model has, as the Infra card and Node detail draw it: the
 * web's Infrastructure cards (infrastructureView.js infrastructureNodes), so
 * the state, word, reason, hosted counts and each reading's level are the
 * model's, and each number is printed by its one rule. Then the Android
 * card's three bars (CPU, MEM and TEMP, or DISK when the node has no
 * temperature or the model has its disk over a line, so a filling disk is
 * never hidden behind the temperature, #273) and the detail screen's four.
 * `services` is the web card's line: "4 / 5 services up · 1 down", or "No
 * services" for a node with none, never "0 up"; `downState` is how its down
 * count is drawn: the model's crit, no signal while stale.
 */
export function nodeCardsOf({ status, servicesBody, freshness = FRESH }) {
  return infrastructureNodes({ status, services: servicesBody, freshness }).map((n) => {
    const entity = status.entities.find((e) => e.id === n.id);
    const byKey = Object.fromEntries(n.readings.map((r) => [r.key, r]));
    const diskOver = ['warn', 'crit'].includes(entity?.conditions?.disk);
    const third = byKey.temp && !diskOver ? byKey.temp : byKey.disk;
    return {
      ...n,
      downState: drawnState('crit', freshness),
      bars: [byKey.cpu, byKey.mem, third].filter(Boolean).map(barOf),
      detailBars: [byKey.cpu, byKey.mem, byKey.temp, byKey.disk].filter(Boolean).map(barOf),
    };
  });
}
