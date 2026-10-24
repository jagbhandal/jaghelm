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
 * @param {any} entity  the model's entity
 * @param {any} card    /api/services' card for it, or null
 * @returns {{ id: string, node: string, container: string, name: string, mapped: string | null, kuma: string | null } | null}
 */
export function forgetTarget(entity, card) {
  // A stack's lead is drawn as the stack (#642): its members' own sheets carry Remove.
  if (entity?.stack || entity?.word !== 'Missing' || card?.source !== 'presence') return null;
  if (typeof entity.node !== 'string' || typeof card.container !== 'string') return null;
  return {
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

/** Why a Remove failed, as the Banner says it. */
export function forgetError(name, err) {
  const status = /^HTTP (\d{3})$/.exec(String(err?.message || ''))?.[1];
  const cause =
    {
      403: 'Remove is off until a dashboard password is set (DASH_PASS). Nothing was removed.',
      404: 'JagHelm no longer lists it as missing: reload and look again. Nothing was removed.',
      409: 'It is running now, so it is not missing. Nothing was removed.',
      429: 'Too many tries: wait a minute. Nothing was removed.',
    }[status] ??
    (status
      ? `JagHelm answered HTTP ${status}. Nothing was removed.`
      : "JagHelm couldn't be reached. Nothing was removed.");
  return { title: `Couldn't remove ${name}`, cause };
}

/** The toast after a Remove. */
export function forgotText(target) {
  return `Removed ${target.name} on ${target.node}. It comes back if the container returns.`;
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
