/**
 * What a job's Remove says when it fails, and where focus goes after one
 * (#578, JobRemove.jsx): its row has left the page.
 */

/** Why a Remove failed, as the Banner says it. */
export function removeError(name, err) {
  const message = String(err?.message || '');
  const status = /^HTTP (\d{3})$/.exec(message)?.[1];
  if (err?.code === 'DOT_NAME') {
    return {
      title: `Couldn't remove ${name}`,
      cause:
        'A job or node named "." or ".." can\'t be removed from a browser. Nothing was removed.',
    };
  }
  return {
    title: `Couldn't remove ${name}`,
    cause: status
      ? `JagHelm answered HTTP ${status}. Nothing was removed.`
      : "JagHelm couldn't be reached. Nothing was removed.",
  };
}

// The rows that list jobs: the Overview's Jobs section and the phone's list.
const ROWS = '[data-slot="jobs-list"] [data-entity]';
const SECTIONS = '[data-slot="jobs-section"], [data-slot="jobs-list-section"]';

/**
 * Where focus goes when the detail of job `id` closes after its Remove: the
 * row after its row in the list, else the one before it, else (it was the
 * only one) the list's heading, which stays while the model still has the
 * job. Null when no list on the page has its row: it was opened from
 * elsewhere, and focus goes back there.
 */
export function focusAfterRemove(id, root = document) {
  const rows = [...root.querySelectorAll(ROWS)];
  const i = rows.findIndex((el) => el.getAttribute('data-entity') === id);
  if (i === -1) return null;
  const list = rows[i].closest('[data-slot="jobs-list"]');
  const near = rows.filter((el) => el.closest('[data-slot="jobs-list"]') === list);
  const j = near.indexOf(rows[i]);
  return (
    near[j + 1] ??
    near[j - 1] ??
    list?.closest(SECTIONS)?.querySelector('[data-slot="jobs-title"]') ??
    null
  );
}
