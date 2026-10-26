### Fixed
- A request that your browser or a monitor gave up on before the answer was ready now
  shows in the access log (marked aborted, status 499) and in the request metrics
  and latency histogram, where before it left no trace. Error lines in the log now
  name the request path.

- Saving the checklist now refuses a malformed body (a todo with a missing or
  oversized field, or more than 500 todos) with a 400 and writes nothing. Lists
  already saved, including older numeric ids, load and save as before.
