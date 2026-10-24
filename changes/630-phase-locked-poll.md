### Fixed
- The board and the header's "Updated" age now follow the server's refresh
  cycle: the browser asks just after the server has built new numbers instead
  of on its own 30 s clock, so what you see is about one cycle old, not up to
  a minute. Changing Settings → System → Data refresh moves both together.
