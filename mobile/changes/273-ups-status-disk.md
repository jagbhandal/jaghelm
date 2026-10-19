### Changed
- The node detail screen shows both TEMP and DISK for a node that reports both,
  such as the Pi, so you can see its temperature and how full its disk is.

### Fixed
- The UPS cell no longer shows MAINS while the UPS is on battery. It reads the
  UPS status the way push and the web dashboard do: on battery and low battery
  show ON BATTERY with an alert, and an unknown status shows NO SIGNAL instead
  of a battery alarm.
- A node card shows DISK instead of TEMP once its disk is 90 % full or more, so
  a nearly full disk on a node that reports its temperature is no longer hidden.
