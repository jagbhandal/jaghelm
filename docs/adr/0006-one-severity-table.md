# ADR 0006 — One severity table, on the server

**Status:** accepted (#290; the table is spec §6.1 of the overhaul design,
`docs/superpowers/specs/2026-10-18-jaghelm-overhaul-design.md`)

## Context

Three places judged the same readings, each with its own numbers, and they
disagreed:

| Where | Disk | CPU | Memory | Temperature |
| --- | --- | --- | --- | --- |
| Web dashboard, `src/utils/thresholds.js` | amber above 70 %, red above 90 % | same | same | not judged |
| Android, `mobile/src/data/derive.js` | not judged, except `DISK_HOT = 90`, which only swaps the card's third bar from TEMP to DISK | amber at 90 % (`CPU_HOT`) | not judged | amber at 75 °C (`TEMP_HOT`) |
| Push, `DEFAULT_PUSH_THRESHOLDS` in `server/refresh.js` | warning at 90 %, cleared below 85 % | same | same | not judged |

So one disk at 92 % was red on the web, unmarked on Android and a warning
push. Comment 8437 on #290 asked the status model to settle the web's 70/90
against spec §6.1's 90/95, and to let Android drop its `DISK_HOT` literal.

## Decision

- **One table, spec §6.1's**, in one server config, `server/status/thresholds.js`
  (`DEFAULT_THRESHOLDS`): disk and storage pools warn at 90 % and are critical
  at 95 %; memory warns at 90 %; CPU warns at 90 % held for 2 cycles; the
  hottest sensor warns at 75 °C and is critical at 85 °C; a level holds until
  the reading falls 5 points (5 °C) below its line. There is no amber at 70 %.
- **Push's line is the table's line.** It keeps push's 90 % (so paging barely
  changes), and `display-config.json`'s hand-edited `pushThresholds` moves the
  model's lines. Since #292 push has no lines of its own: it sends what the
  model judges (each reading's level in the node's `conditions`), so the two
  can't disagree, and a test feeds the same readings through the model and the
  real push cycle to show it (`server/status/thresholds.test.js`).
  `getPushThresholds()`, `pushThresholdsOf()` and `DEFAULT_PUSH_THRESHOLDS` are
  gone.
- **The server judges; clients render.** The model gives every node entity a
  `conditions` map, the state of each reading (`{ disk: 'warn', cpu: 'ok', … }`,
  hysteresis applied), and the reason and status word for the entity. A meter
  is coloured by its condition, so no client needs a threshold of its own.

## Consequences

- The web's disk colours change when the web moves onto the model (Phase 1):
  amber from 90 %, red from 95 %, nothing at 70 %. Until then the old screens
  keep their own colours.
- When the clients read the model (#292 serves it at `/api/status`; the web
  moves in Phase 1, Android in Phase 1 and Phase 4), delete:
  - `src/utils/thresholds.js` (`USAGE_WARN`, `USAGE_CRITICAL` and their helpers);
  - in `mobile/src/data/derive.js`, `DISK_HOT` and its comment, `CPU_HOT`,
    `TEMP_HOT` and `nodeSeverity`.
- Push took the model's timing with #292: it alerts on CPU after 2 cycles over
  the line, as the model warns, and its hysteresis is the model's held level
  (#361 fixed by construction), so a reading that drifts down through the
  5-point band sends its "back to normal" and one that dips into the band and
  rises again doesn't alert twice. Temperature and storage pools page too, and
  a disk reaching 95 % sends a second, critical alert. A restart keeps each held
  level: the model starts from the levels the push snapshot file holds.
- Changing a number is one edit, in one file, covered by the table tests
  (`server/status/severityTable.test.js`). Settings → Notifications edits the
  table from Phase 3.
