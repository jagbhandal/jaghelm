// Pure builders: Arcane poll results -> push events. No I/O.

// Names come from Arcane (untrusted) and FCM rejects bodies over 4 KB, which the
// sender treats as a dead token: cap each name and the list length.
const NAME_MAX = 64;
const LIST_MAX = 10;
const capName = (n) => (n.length > NAME_MAX ? `${n.slice(0, NAME_MAX - 1)}…` : n);
const join = (names) => {
  const shown = names.slice(0, LIST_MAX).map(capName).join(', ');
  const more = names.length - LIST_MAX;
  return more > 0 ? `${shown} +${more} more` : shown;
};

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

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const topLabel = ({ name, critical, high }) => {
  const counts = [critical ? `${critical}C` : '', high ? `${high}H` : ''].filter(Boolean);
  return `${capName(name)} ${counts.join(' ')}`;
};

/**
 * Weekly vulnerability digest for one environment (vulnDerive buildDigest). New
 * critical/high findings first, then KEV, fixed and scan health.
 */
export function buildVulnDigestPush({ env, digest }) {
  const { newCritical, newHigh, images, top, kev, kevNew, fixed, stale, failed } = digest;
  const parts = [];
  if (newCritical + newHigh > 0) {
    const counts = [];
    if (newCritical) counts.push(`${newCritical} new critical`);
    if (newHigh) counts.push(`${newHigh} new high`);
    parts.push(`${counts.join(', ')} (fix available)`);
    parts.push(plural(images, 'image', 'images'));
    if (top.length) parts.push(`top: ${top.map(topLabel).join(', ')}`);
  }
  if (kev > 0) parts.push(kevNew > 0 ? `KEV ${kev} (${kevNew} new)` : `KEV ${kev}`);
  if (fixed > 0) parts.push(`${fixed} fixed`);
  if (stale.length) {
    parts.push(`${plural(stale.length, 'image', 'images')} not scanned in 9 days: ${join(stale)}`);
  }
  if (failed.length) {
    parts.push(`${plural(failed.length, 'scan', 'scans')} failed: ${join(failed)}`);
  }
  return {
    type: 'arcane_vulns',
    id: `arcane:${env}:vulns`,
    node: env,
    title: `Vulnerabilities · ${env}`,
    body: parts.join(' · '),
    severity: digest.severity,
  };
}
