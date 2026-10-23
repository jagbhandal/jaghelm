/**
 * Test-only (#605): what no client field may carry when a source fails: an
 * errno or undici code, a URL, an IP address, a host and port, a `.lan` or
 * `.example` host name, fetch's own "fetch failed", or a stack frame. A
 * source's failure goes out in words (failureWords.js); its raw detail is for
 * the server log.
 */
export const RAW_DETAIL =
  /\bE[A-Z_]{3,}\b|UND_ERR|\bCERT_|https?:|\d+\.\d+\.\d+\.\d+|::1|[a-z]:\d{2,5}\b|localhost|\.lan\b|\.example\b|fetch failed|\bat \S+:\d+/;
