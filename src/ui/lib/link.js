/**
 * A link the page opens itself (#309): a row, a card's name or a table's
 * cell given an `href` and an `onOpen` (an entity's URL, which the page opens
 * as its detail over itself). A plain click, or Enter, calls `onOpen` instead
 * of the browser loading the link; a click with a modifier key or the middle
 * button is the browser's (the link in a new tab or window), so it never
 * moves this page.
 *
 * @param {MouseEvent | import('react').MouseEvent} event
 * @param {() => void} onOpen
 */
export function openHere(event, onOpen) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  onOpen();
}
