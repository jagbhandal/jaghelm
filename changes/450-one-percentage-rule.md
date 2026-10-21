### Fixed
- A reading is written the same way everywhere: rounded down, so a disk at
  94.6 % reads "94 %" beside its 95 % line on the new Overview's meters, as it
  already did in the status and in push notifications, never "95 %". With a
  line set to a fraction under `pushThresholds` (`0.875`), the readings beside
  it show its decimals ("87.6 %" over an 87.5 % line, no longer "87 %"), and
  the UPS charge in a status reason or push is rounded down too.
