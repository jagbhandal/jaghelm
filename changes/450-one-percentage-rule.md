### Fixed
- A reading is written the same way everywhere: rounded down, so a disk at
  94.6 % reads "94 %" beside its 95 % line on the new Overview's meters, as it
  already did in the status and in push notifications, never "95 %". With a
  line set to a fraction under `pushThresholds` (`0.875`), the readings beside
  it show its decimals ("87.6 %" over an 87.5 % line, no longer "87 %"), and
  the UPS charge in a status reason or push is rounded down too.
- A reading exactly on a warning or critical line set with a decimal under
  `pushThresholds` (`0.913`, a 91.3 % line) now counts as on it. For about one
  such line in eight, rounding inside the server judged it just under, so no
  warning and no push.
