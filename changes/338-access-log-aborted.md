### Fixed
- A request that your browser or a monitor gave up on before the answer was ready now
  shows in the access log (marked aborted, status 499) and in the request metrics
  and latency histogram, where before it left no trace. Error lines in the log now
  name the request path.
