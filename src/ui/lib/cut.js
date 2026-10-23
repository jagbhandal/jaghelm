/*
 * Whether a line drawn in one row is cut short (#578): an EntityRow's detail
 * ends in an ellipsis when it is longer than its column, and only then keeps
 * its whole line in a `title`, so the words are there to read under the
 * pointer and the e2e no-hiding sweep finds them. One ResizeObserver for every
 * line watched: a line is checked when it is first watched, and again each
 * time its box changes size (the window resized, a column given more room).
 * The title is the line's own attribute, set and removed here, never in the
 * component's markup: a line that fits has none.
 */

/** element -> its whole line */
const watched = new Map();
let observer = null;

// An element, or its text inside, wider than its box.
const SLACK = 1;
function isCut(el) {
  const inner = el.querySelector('[data-slot="entity-detail-text"]');
  return [el, inner].some((e) => e && e.scrollWidth > e.clientWidth + SLACK);
}

function check(el) {
  const text = watched.get(el);
  if (text == null) return;
  if (isCut(el)) el.setAttribute('title', text);
  else el.removeAttribute('title');
}

/**
 * Watches `el` (a row's detail) and gives it `text` as its title while it is
 * cut short. Returns what stops watching it.
 *
 * @param {HTMLElement} el
 * @param {string} text
 */
export function watchCut(el, text) {
  watched.set(el, text);
  if (typeof ResizeObserver !== 'undefined') {
    observer ??= new ResizeObserver((entries) => {
      for (const entry of entries) check(entry.target);
    });
    observer.observe(el);
  }
  check(el);
  return () => {
    watched.delete(el);
    observer?.unobserve(el);
    el.removeAttribute('title');
  };
}
