### Changed
- The sign-in page matches the rest of JagHelm: JagHelm's logo over one card,
  with labelled Username and Password fields. In the light theme the logo's
  text is darker, so it reads on the light background. Your own logo, when
  you've uploaded one, still replaces it.
  A wrong password is said under the password field and the cursor goes back
  to it, with the text selected so you can retype it, and the message goes as
  soon as you do; an empty field is named before anything is sent. While a sign-in is on its way the button says
  "Signing in…" and a second press does nothing.
- When the server refuses a sign-in for another reason, such as too many
  attempts, the page says the server's reason instead of "Invalid
  credentials"; when the server doesn't answer, it says so.

### Removed
- The title and subtitle under the logo on the sign-in page: the logo already
  says JagHelm and "Infrastructure Dashboard".
