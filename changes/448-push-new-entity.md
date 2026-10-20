### Fixed
- The phone now alerts for a node that is already in trouble when JagHelm first
  sees it, such as one just added to `services.yaml`: unreachable, or with a
  reading over its line, it sends one alert. A new node that is healthy sends
  nothing, where it used to send "Host recovered".
- The phone now alerts when the UPS goes on battery even if JagHelm had never
  read its state before, for example because the NUT exporter had been quiet
  since JagHelm started. A quiet exporter during a power cut still sends no
  second alert and no false "back on mains".
- When JagHelm starts without its saved alert state (a first run, or a missing
  or damaged file), the phone now gets one alert for each problem that is
  already open, instead of none.
