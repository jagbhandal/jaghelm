### Security
- Failed sign-ins no longer lock everyone out. Before, 50 failures from
  anywhere blocked every sign-in for 15 minutes, so anyone on the network could
  lock you out. Now failures slow down only the address they come from: after
  5 in a row it waits 30 seconds, doubling with each further failure up to 15
  minutes, and a sign-in clears it. Guesses from many addresses at once are
  held to at most 130 an hour in all; a sign-in from a new address may then
  wait up to 30 seconds, while the addresses you signed in from most recently
  skip that wait. The sign-in page and the Android app say how long to wait.
  Restarting JagHelm clears every wait, and you stay signed in.
