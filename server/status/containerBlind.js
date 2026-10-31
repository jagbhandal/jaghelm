// @ts-check
/**
 * A node with no container readings, as a source of its own (#838): cAdvisor
 * stopped reporting a node's containers, so the restart-loop and
 * Missing-container pages for it go quiet (push/snapshot.js holds them). The
 * model lists it as the source `containers-source:<node>`, a `warn` issue the
 * push pages like any monitoring source (one source_down after two failed
 * cycles, one source_recovered when readings return), in place of Grafana's
 * Monitoring gap rule for cAdvisor. Pure: no clock, no I/O, so the status
 * model stays a function of its inputs and the client bundle may import it.
 *
 * Which nodes (`silentNodes` and `blindNodes` of containerEvents.js
 * readContainerEvents):
 *
 *   silent   read earlier in the last hour, none for four minutes: listed
 *   blind    no reading in the whole hour: listed only while it was listed
 *            before (it was silent, and the hour has since passed). A node
 *            cAdvisor never covers (MS-S1) is only ever blind, so it
 *            never pages (vm-101 is scraped but left out of the read)
 *
 * A read that did not answer (no read yet, Prometheus down, no container
 * reading anywhere, every node that read gone quiet at once) cannot say, so what was listed stays listed.
 */

/** The source name of a node's container readings: `containers-source:<node>`. */
export const CONTAINERS_SOURCE = 'containers-source:';

/** The name its issue (and its push) gives it. */
export const containerBlindName = (/** @type {string} */ name) => `Container readings on ${name}`;

/** The reason it gives, and the push body. */
export const containerBlindReason = (/** @type {string} */ name) =>
  `No container readings, so container alerts for ${name} are blind`;

/**
 * The node keys whose container readings are missing this cycle.
 *
 * @param {any} read  the `containerEvents` cache value, or null
 * @param {Iterable<string>} held  the node keys listed last cycle
 * @returns {string[]}
 */
export function containerBlindNodes(read, held) {
  const before = [...held];
  if (!read || typeof read !== 'object' || read.state !== 'ok' || read.silentGap === true) return before;
  const silent = Array.isArray(read.silentNodes) ? read.silentNodes : [];
  const blind = Array.isArray(read.blindNodes) ? read.blindNodes : [];
  return [...new Set([...silent, ...before.filter((k) => blind.includes(k))])].filter(
    (k) => typeof k === 'string'
  );
}
