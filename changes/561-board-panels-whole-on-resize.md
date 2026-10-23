### Fixed
- Widening or narrowing the window, or turning a tablet, no longer shows the
  board's panels cut short for a moment: each panel is drawn at its content's
  height in the first frame at the new width, not at its saved height or the
  height it had at the old width. Panels still glide to a new place, but take
  a new size at once.
