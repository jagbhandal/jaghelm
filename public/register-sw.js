// Service worker registration. Externalized from an inline <script> in index.html
// so the Content-Security-Policy can use `script-src 'self'` (no 'unsafe-inline').
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
