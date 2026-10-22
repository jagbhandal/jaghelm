### Changed
- The sign-in page matches the rest of JagHelm: the helm mark and your
  instance's name over one card, with labelled Username and Password fields.
  A wrong password is said under the password field and the cursor goes back
  to it, with the text selected so you can retype it; an empty field is named
  before anything is sent. While a sign-in is on its way the button says
  "Signing in…" and a second press does nothing.
- When the server refuses a sign-in for another reason, such as too many
  attempts, the page says the server's reason instead of "Invalid
  credentials"; when the server doesn't answer, it says so.

### Removed
- The subtitle on the sign-in page.
