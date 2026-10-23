/**
 * What a job's Remove says when it fails, and where focus goes after one
 * (#578, JobRemove.jsx): its row has left the page.
 */

/** Why a Remove failed, as the Banner says it. */
export function removeError(name, err) {
  const message = String(err?.message || '');
  const status = /^HTTP (\d{3})$/.exec(message)?.[1];
  return {
    title: `Couldn't remove ${name}`,
    cause: status
      ? `JagHelm answered HTTP ${status}. Nothing was removed.`
      : "JagHelm couldn't be reached. Nothing was removed.",
  };
}

// The rows that list jobs: the Overview's Jobs section and the phone's list.
const ROWS = '[data-slot="jobs-list"] [data-entity]';

/**
 * Where focus goes when the detail of job `id` closes after its Remove: the
 * row after its row in the list, else the one before it. Null when no list
 * on the page has its row (it was opened from elsewhere, and focus goes back
 * there), or it was the only one (the list goes with it).
 */
export function focusAfterRemove(id, root = document) {
  const rows = [...root.querySelectorAll(ROWS)];
  const i = rows.findIndex((el) => el.getAttribute('data-entity') === id);
  if (i === -1) return null;
  return rows[i + 1] ?? rows[i - 1] ?? null;
}
