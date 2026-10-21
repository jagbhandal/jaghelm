### Fixed
- A node reading that misses a cycle, such as a temperature sensor that answers
  only some of the time, no longer ends its alert and starts a new one: a
  temperature at 78 °C, then no reading, then 73 °C and 76 °C sends one alert
  and no "back to normal". While there is no reading, the node keeps its
  warning, and its reason says there is no reading instead of showing a number.
  CPU's two cycles over its line also count across a missed cycle. A reading
  that never comes back keeps its warning until it is read again, the node is
  removed from `services.yaml`, or 24 hours pass.
