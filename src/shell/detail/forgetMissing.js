/**
 * What a missing container's Remove (#688, MissingRemove.jsx) says and does
 * around the request: whether the detail gets one, the sentence in its
 * confirm, what a refusal says, and where focus goes once the card has left.
 */

/**
 * What Remove acts on, or null when the entity gets none. Only a container the
 * model judges Missing, drawn from a presence breadcrumb, and not drawn as a
 * stack (its members' sheets get it) (the card of
 * /api/services that says so: `source: 'presence'`). `mapped` and `kuma` are
 * the monitor names that still name it, from the card.
 *
 * `reporting` is whether its node is: reachable, with at least one card for
 * something observed. A node that is off, or whose cAdvisor is blind, draws
 * every container it remembers as Missing, and the server refuses Remove there
 * (409), so the detail says so instead of offering it.
 *
 * @param {any} entity  the model's entity
 * @param {any} card    /api/services' card for it, or null
 * @param {any} [node]  /api/services' entry for the entity's node
 * @returns {{ reporting: boolean, id: string, node: string, container: string, name: string, mapped: string | null, kuma: string | null } | null}
 */
export function nodeReporting(node) {
  return node?.reachable === true && (node.services ?? []).some((c) => c?.source !== 'presence');
}

export function forgetTarget(entity, card, node) {
  // A stack's lead is drawn as the stack (#642): its members' own sheets carry Remove.
  if (entity?.stack || entity?.word !== 'Missing' || card?.source !== 'presence') return null;
  if (typeof entity.node !== 'string' || typeof card.container !== 'string') return null;
  return {
    reporting: nodeReporting(node),
    id: entity.id,
    node: entity.node,
    container: card.container,
    name: entity.name || card.display_name || card.container,
    mapped: typeof card.mapped === 'string' ? card.mapped : null,
    kuma: typeof card.kuma === 'string' ? card.kuma : null,
  };
}

/** The confirm's sentence: what Remove does, and what stays. */
export function forgetDescription(target) {
  const parts = [`Forget ${target.name} on ${target.node}. It comes back if the container returns.`];
  if (target.mapped) {
    parts.push(
      `services.yaml still maps it to Kuma monitor "${target.mapped}"; that stays until you edit it.`
    );
  } else if (target.kuma) {
    parts.push(`Kuma monitor "${target.kuma}" still names it; Kuma is not changed.`);
  }
  return parts.join(' ');
}

/** Said in place of Remove while its node is not reporting. */
export const NOT_REPORTING = {
  title: 'Remove is not offered yet',
  cause: 'Remove is offered once the node is reporting: until then "missing" may only mean it cannot be seen.',
};

/** Why a Remove failed, as the Banner says it. */
export function forgetError(name, err) {
  const status = /^HTTP (\d{3})$/.exec(String(err?.message || ''))?.[1];
  const cause =
    {
      403: 'Remove is off until a dashboard password is set (DASH_PASS). Nothing was removed.',
      404: 'JagHelm no longer lists it as missing: reload and look again. Nothing was removed.',
      409: 'It is running now, or its node is not reporting. Nothing was removed.',
      429: 'Too many tries: wait a minute. Nothing was removed.',
    }[status] ??
    (status
      ? `JagHelm answered HTTP ${status}. Nothing was removed.`
      : "JagHelm didn't answer, so it may or may not have been removed: reload to see.");
  return { title: `Couldn't remove ${name}`, cause };
}

/** The toast after a Remove; `refreshed` false: the board follows on its next refresh. */
export function forgotText(target, refreshed = true) {
  return `Removed ${target.name} on ${target.node}. ${
    refreshed ? 'It comes back if the container returns.' : 'It leaves the board on the next refresh.'
  }`;
}

/**
 * Where focus goes once the detail of `id` closes after its Remove, its row
 * having left the list: the next row of the same list, else the one before,
 * else null (it was opened from elsewhere, and focus goes back there).
 */
export function focusAfterForget(id, root = document) {
  const row = [...root.querySelectorAll('[data-entity]')].find(
    (el) => el.getAttribute('data-entity') === id && !el.closest('[role="dialog"]')
  );
  const list = row?.closest('ul, ol, tbody');
  if (!row || !list) return null;
  const near = [...list.querySelectorAll('[data-entity]')];
  const i = near.indexOf(row);
  return near[i + 1] ?? near[i - 1] ?? null;
}
