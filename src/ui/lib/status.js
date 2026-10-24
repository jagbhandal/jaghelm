/*
 * What the status components share (spec §5.2, §6; #287): the five states, the
 * word each one reads as when no other is given, and which look they draw.
 *
 * States are the server status model's: ok, warn, crit, unknown (no signal)
 * and maintenance. A component takes either `state` or `severity` (the old
 * severities: healthy, caution, critical, unknown), `toState` reading both.
 * They are drawn as the signed-off mock's look, from the role tokens.
 */

/** The five states, as the status model lists them (spec §6). */
export const STATES = Object.freeze(['ok', 'warn', 'crit', 'unknown', 'maintenance']);

/**
 * The overall state of an empty board (#449): with nothing set up, the status
 * model's `overall.state` is this, named as server/status/summary.js names it.
 * It is the board's alone, none of the five: no entity has it, so it has no
 * lamp, word or colour. AttentionPanel and AppHeader draw it as their quiet
 * line, saying the model's sentence ("Nothing monitored yet"); anywhere else
 * `toState` reads it as no signal, as it reads any value it doesn't know.
 */
export const EMPTY = 'empty';

/** What an empty board says when the caller gives no sentence: the model's. */
export const EMPTY_SENTENCE = 'Nothing monitored yet';

/**
 * Why there is no signal: the server can't be reached; it has no status yet
 * (a 503 before its first check); or the status it had is past its TTL (a 503
 * after one, #480).
 */
export const NO_SIGNAL = Object.freeze({
  down: "Can't reach JagHelm",
  waiting: 'Waiting for the first check',
  expired: "JagHelm's status is out of date",
});

/** The word a state reads as when the caller gives none (the mock's Tokens board). */
export const WORDS = Object.freeze({
  ok: 'OK',
  warn: 'Warning',
  crit: 'Critical',
  unknown: 'No signal',
  maintenance: 'Maintenance',
});

// The old severities, as states.
const FROM_SEVERITY = { healthy: 'ok', caution: 'warn', critical: 'crit', unknown: 'unknown' };

/**
 * The state for a `state` or an old `severity`. Anything else is no
 * signal: never green, never red (spec §6).
 */
export function toState(value) {
  if (STATES.includes(value)) return value;
  return FROM_SEVERITY[value] ?? 'unknown';
}

// A screen reader spells an abbreviated word out, so TalkBack doesn't read
// "UNKN" letter by letter. The word on screen stays as it is.
const SPOKEN = { UNKN: 'unknown' };

/** `word` as a screen reader should say it. */
export function spoken(word) {
  return SPOKEN[word] ?? word;
}

/**
 * What a lamp is named: what it draws. A lamp drawn as no signal is "No
 * signal" beside any word but one for no signal ("No signal", or "UNKN"): under a stale status (#480) the word is what was
 * last known ("Healthy", "Down"), and the lamp is what is known now. Any
 * other lamp is its word, or its state's. Where the word beside a lamp says
 * the same, the lamp is decorative; where it doesn't, the lamp is named, and
 * a row's or a tile's name says it before the word.
 */
export function lampName(state, word) {
  const s = toState(state);
  const noSignal = !word || word === WORDS.unknown || spoken(word) === 'unknown';
  return s === 'unknown' && !noSignal ? WORDS.unknown : word || WORDS[s];
}
