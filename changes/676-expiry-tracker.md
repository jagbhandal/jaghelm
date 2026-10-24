### Added
- An Expiry section on the Overview and the phone's Overview lists the TLS
  certificates and Tailscale node keys you track, soonest first, with the days
  left. Amber under 21 days and red under 7 (Settings → Nodes & Services →
  Expiry changes both lines), always with an icon and words. A host that can't
  be reached, a failed handshake or an unknown date is never shown as fine, and
  an expired certificate is read and reported as expired. The section is absent
  until you add a host or set up a Tailscale key; Appearance and Edit layout can
  hide or move it. Nothing sends an alert yet.
- Settings → Nodes & Services → Expiry has a list of hosts to watch (`host` or
  `host:port`, up to 30) with Add and Remove, and offers the https hosts in your
  integration URLs as one-click suggestions. The server makes a TLS handshake
  with each about a minute after it starts and every 6 hours, and sends nothing
  else. JAGHELM_BLOCK_PRIVATE_NETWORKS=true refuses private addresses here too.
- With `JAGHELM_TAILSCALE_API_KEY` set (the Tailscale integration's API access
  token, which expires in 90 days at most), the section lists each Tailscale device's node key expiry, read every
  6 hours. Devices with key expiry off are one line. A refused key is said, not
  hidden. `JAGHELM_TAILNET` names the tailnet if the token's own isn't wanted.
