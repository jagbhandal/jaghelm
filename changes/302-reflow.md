### Fixed
- The Overview no longer jumps as it loads on a phone. The sections under the
  status used to be drawn first and then pushed down by the status when it
  arrived; now the page fills in from the top. On a phone the board's panels
  are drawn at their own height from the first frame, instead of at a saved
  height and then grown; on wider screens each panel keeps the room it took
  last time while its content comes in.
- A word too long for a tile of the subsystem strip ("maintenance", with six
  tiles in a row) breaks onto the next line instead of being hidden under the
  tile beside it.
