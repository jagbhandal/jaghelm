### Changed
- Fonts are now served by JagHelm itself instead of Google Fonts, so the
  dashboard no longer contacts Google (which saw each visitor's address), no
  longer waits on Google's stylesheet before it first draws, and keeps its fonts
  offline and on networks without internet access. Today's screens look exactly
  as before, in every Typography preset. The Typography settings now preview each
  preset in its own font. The redesign's typefaces ship too, Manrope by default
  with Plus Jakarta Sans and Montserrat to choose from later, along with its type
  sizes; nothing on screen uses them yet.

### Security
- The Content Security Policy no longer allows stylesheets or fonts from Google
  Fonts: both now load from JagHelm's own address only.
