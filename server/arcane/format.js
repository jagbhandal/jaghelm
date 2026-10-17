// Pure builders: Arcane poll results -> push events. No I/O.

const join = (names) => names.join(', ');

/** Update digest for one environment. */
export function buildUpdatePush({ env, updated, failed }) {
  const parts = [];
  if (updated.length) parts.push(`${updated.length} updated: ${join(updated)}`);
  if (failed.length) parts.push(`${failed.length} failed: ${join(failed)}`);
  return {
    type: 'arcane_update',
    id: `arcane:${env}:update`,
    node: env,
    title: `Updates · ${env}`,
    body: parts.join(' · '),
    severity: failed.length ? 'warning' : 'info',
  };
}

/** Newly held-back updates (transition only). */
export function buildHeldBackPush({ env, heldBack }) {
  return {
    type: 'arcane_heldback',
    id: `arcane:${env}:heldback`,
    node: env,
    title: `Updates · ${env}`,
    body: `${heldBack.length} update${heldBack.length === 1 ? '' : 's'} held back: ${join(heldBack)}`,
    severity: 'info',
  };
}

/** Recovery: previously held-back containers are caught up. */
export function buildClearedPush({ env, cleared }) {
  return {
    type: 'arcane_cleared',
    id: `arcane:${env}:cleared`,
    node: env,
    title: `Updates · ${env}`,
    body: `${cleared.length} caught up: ${join(cleared)}`,
    severity: 'info',
  };
}

export function buildAgentOfflinePush({ env }) {
  return {
    type: 'arcane_agent_offline',
    id: `arcane:${env}:agent`,
    node: env,
    title: `Arcane · ${env}`,
    body: `Agent disconnected; Arcane cannot manage ${env}`,
    severity: 'warning',
  };
}

/** Recovery: agent is back. */
export function buildAgentRecoveredPush({ env }) {
  return {
    type: 'arcane_agent_recovered',
    id: `arcane:${env}:agent`,
    node: env,
    title: `Arcane · ${env}`,
    body: 'Agent reconnected',
    severity: 'info',
  };
}

export function buildReleasePush({ current, newest }) {
  return {
    type: 'arcane_release',
    id: 'arcane:release',
    node: 'arcane',
    title: `Arcane ${newest} available`,
    body: `Running ${current}. Upgrade by PR: bump the pinned tag.`,
    severity: 'info',
  };
}
