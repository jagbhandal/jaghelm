### Added
- `LOGIN_TRUSTED_NETS`: networks whose addresses never wait on the shared
  sign-in budget during an attack, such as `192.168.68.0/22,100.64.0.0/10`
  for a LAN and a tailnet. Empty by default. Behind a reverse proxy it needs
  `TRUST_PROXY` set right, or anyone could claim such an address.

### Security
- Failed sign-ins no longer lock everyone out. Before, 50 failures from
  anywhere blocked every sign-in for 15 minutes, so anyone on the network could
  lock you out. Now failures slow down only the address they come from: after
  5 in a row it waits 30 seconds, doubling with each further failure up to 15
  minutes, and a sign-in clears it. Guesses from many addresses at once share
  one budget, at most 130 an hour. During such an attack a brand-new address
  can be kept waiting for as long as it lasts, and a restart doesn't help; the
  16 addresses you signed in from most recently, kept across restarts, and
  those in `LOGIN_TRUSTED_NETS` skip that wait. The sign-in page and the
  Android app say how long to wait.
