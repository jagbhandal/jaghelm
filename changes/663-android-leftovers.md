### Removed
- The `CSP_CONNECT_EXTRA` setting. It only widened the Content-Security-Policy for the retired Android app; the server now always sends the same strict policy, and a leftover `CSP_CONNECT_EXTRA` line in `.env` is ignored.
