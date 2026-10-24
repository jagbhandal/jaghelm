### Added
- Alerts now reach the installed dashboard. In Settings → Notifications,
  Enable alerts on this device turns on push for this browser or installed app
  (the browser asks for permission when you tap it), and Send test alert
  proves it works. Alerts arrive with the screen off, without the Android app
  and without Tailscale; a tap opens the service or host in question. Each
  browser is listed with the phones and can be removed there. It needs three
  settings on the server (a key pair from `node scripts/vapid-keys.mjs`, see the
  getting-started guide); without them Settings says so and how to fix it, and
  the Android app's push is unchanged.
- When a Cloudflare Access sign-in has ended, the dashboard says "Sign in
  again" with a Reload button, instead of staying blank or asking for a
  JagHelm password that was not the problem. The first check no longer waits
  forever for a server that does not answer.
