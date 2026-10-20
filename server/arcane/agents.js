/**
 * The Arcane agents the status model shows (spec §6.2, #291): each Arcane
 * environment's agent as `{ env, state }`, `state` being envHealth's ('up',
 * 'down' or 'unknown') from the environment list the Arcane poller last read.
 * The model makes an offline agent a warning in Integrations.
 *
 * A seam of its own, so the background loop (refresh.js) reads the agents
 * without importing the Arcane wiring (index.js, which starts the poller and
 * imports the demo). startArcane() points it at its poller and stopArcane()
 * clears it. null (Arcane not set up, demo mode, or stopped) means no agents.
 */

let source = null;

/** @param {(() => Array<{ env: string, state: string }> | null) | null} fn */
export function setArcaneAgentsSource(fn) {
  source = typeof fn === 'function' ? fn : null;
}

/** @returns {Array<{ env: string, state: string }> | null} */
export function getArcaneAgents() {
  return source ? source() : null;
}
