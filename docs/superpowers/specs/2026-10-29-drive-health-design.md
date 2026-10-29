# Drive health — design

- **Date:** 2026-10-29
- **Status:** Draft. Design only; no code. Sign-off on §12 before a plan is written.
- **Inputs:** Jag's decisions in the 2026-10-29 session (listed in §2); ADR 0006 (one severity table); `docs/ARCHITECTURE.md` 4.7 (status model, push, alert history); `docs/design-system.md` (rules, chart colours); `server/diskForecast.js` (the pattern for a Prometheus-backed source); `server/status/{model,rules,thresholds,readings}.js`; `src/ui/{node-card,entity-detail,detail-charts,status-lamp}.jsx`; the exporter PR in homelab-infra (#973), which defines the metric contract in §4.

## 1. Problem

Nothing in JagHelm knows whether a drive is dying. The Overview judges CPU, memory, disk *capacity* and temperature per node, but a node whose NVMe reports a critical warning, or whose RAID member is growing bad sectors, still shows green. The lab's only drive-health signal today is the NAS vendor's own "bad sector" notification, which is late by design and lives outside JagHelm. JagHelm is where alerts reach the phone, so drive health has to be judged and pushed here.

## 2. Goals and non-goals

**Decided by Jag (2026-10-29):**
- A push for any SMART warning: the drive's own flags, plus temperature. Wear milestones are not alerts.
- Drives live inside the node, not in a new Overview section: the node's side panel shows them, **placed directly under the status card** (mock option A).
- A drive problem makes its node non-green, and the node card says why.
- Existing Alerts page and Needs-attention panel carry the alerts; no new alert surface.
- Drive temperatures join the temperature chart as extra lines.
- It must be an **optional module**: JagHelm is a public app, and an install without drive data looks and behaves exactly as it does today.
- The UI must feel native: same tokens, lamps, panel anatomy and chart rules as the rest of JagHelm.

**Goals.** Judge each drive once, on the server, in the existing status model. Roll drive state into its node. Push through the existing rules. Be correct by construction when data is missing or stale.

**Non-goals.** No SMART polling by JagHelm itself (it reads Prometheus only; see §4). No drive management, self-test triggering or spin control. No wear forecast or "days left" in this phase. No new alert channel, database or poller process. No standalone Drives page or Overview section.

## 3. How this fits ADR 0006 and the status model

ADR 0006 puts every judgement in one server table and has clients render the verdict. Drive health follows it exactly: a new input to `buildStatus`, new rows in the threshold table, a per-node condition, and a reason string. The web and the push read the same verdict, so they cannot disagree. Nothing client-side judges a drive.

A drive is a **sub-entity of its node**, not a card: it has a state and a reason but no tile of its own. **Each drive is its own condition key, `drive:<node>:<device>`** (the precedent is `pool:<name>`, a Proxmox storage pool): its own level, hysteresis, push grouping, snapshot entry, alert subject ("sdb on nas") and deep link. A single per-node key would let a second failing drive go unpushed and one drive's recovery mask another's. The node's state is the worst of its existing readings and its drives; the node-level `drives` roll-up is **derived** for the lamp and the reason line, never keyed or pushed itself.

## 4. Data source: a metric contract

JagHelm does not talk to disks. It reads `smartctl_exporter` series from the Prometheus it already uses, the way `diskForecast.js` reads filesystem series (a cached range or instant read shared by all readers; a failed read is cached briefly). The lab runs `prometheuscommunity/smartctl-exporter` (pinned v0.15.0, homelab-infra #973). The contract, checked against v0.15.0's source, with labels `device` (`sda`, `nvme0`) and `node` (set by the scrape job, **the same `node` label every JagHelm node already needs**, docs/CONFIGURATION.md):

| Series | Use |
|---|---|
| `smartctl_device_smart_status` | 1 = the drive's own health check passed; 0 = failed |
| `smartctl_device_critical_warning` | NVMe critical-warning bitmask; non-zero is a flag |
| `smartctl_device_available_spare`, `…_available_spare_threshold` | NVMe spare, percent; at or below the threshold is a flag |
| `smartctl_device_media_errors` | counter, NVMe media and data-integrity errors |
| `smartctl_device_attribute{attribute_id="5\|197\|198", attribute_value_type="raw"}` | SATA reallocated, pending and offline-uncorrectable sector counts |
| `smartctl_device_temperature{temperature_type="current"}` | °C, for the temperature lines and the chart |
| `smartctl_device_percentage_used` | NVMe wear; shown, never alerted (Jag) |
| `smartctl_devices` | present while the exporter answers; used for the blind check |
| `smartctl_device_smartctl_exit_status` | non-zero when the last smartctl read failed; feeds the blind check |
| `smartctl_device_power_on_seconds`, `smartctl_device_rotation_rate`, `smartctl_device{model_name,…}` | display: power-on time, spinning versus solid state, the model name |

**Verified on real output (NAS, 2026-10-29, three IronWolf HDDs on exporter v0.15.0):** the info series `smartctl_device{device, model_name, model_family, serial_number, interface, protocol, …}` carries the model name (so the display name is `model_name`; **`serial_number` sits on the same series and must never be displayed, logged or grouped by**). `smartctl_device_rotation_rate` tells a spinning drive from an SSD, `smartctl_device_power_on_seconds` gives power-on time, `smartctl_device_error_log_count` gives the ATA error-log count, and `smartctl_device_smartctl_exit_status` reports whether the last smartctl read failed (a better blind/failed-read signal than series absence). The `smartctl_device_attribute` family carries 84 attributes per drive; the design reads only ids 5, 197 and 198. **Verified on pve's NVMe (2026-10-29, same exporter):** `critical_warning`, `available_spare`, `available_spare_threshold`, `percentage_used`, `media_errors`, `power_on_seconds`, `smartctl_exit_status` and the info series (`model_name`, `protocol="NVMe"`) are all present, and an NVMe drive's error count is `smartctl_device_num_err_log_entries` (an ATA drive's is `smartctl_device_error_log_count`). **`smartctl_device_temperature` carries a `temperature_type` label with several values** (`current`, plus the drive's own `op_limit_max` 83 and `critical_limit_max` 85 on this NVMe), so every temperature read must filter `temperature_type="current"`. The drive's own limits are an option for the temperature lines' defaults on NVMe (a candidate for §12, not decided). The drive type for temperature lines is therefore: NVMe by `protocol`/`device` prefix, otherwise spinning versus solid state by `rotation_rate`. Phase 0 of the build still captures a sanitised sample (serial numbers removed) as the test fixture.

**The exporter caches.** It reads SMART at most every 10 minutes in the lab's setup and a drive in standby is not woken, so Prometheus keeps receiving the last cached values for a sleeping drive. JagHelm cannot tell that from a fresh reading. This is accepted and stated in the UI (see §8, standby).

## 5. Judging a drive

A drive has a level (`ok`, `warn`, `crit`) from these conditions; the worst wins:

| Condition | Level |
|---|---|
| health check failed (`smart_status` = 0) | crit |
| NVMe `critical_warning` non-zero | crit |
| NVMe media errors grew over the window | crit |
| SATA reallocated, pending or offline-uncorrectable count grew over the window | warn |
| NVMe `available_spare` at or below its threshold | warn |
| temperature at or over the warn line (crit line: crit) | warn / crit |

**Counters only rise, so "above zero" would alarm forever.** The design therefore judges *growth over a window* (default 7 days). It costs three instant queries per refresh window, cached 10 minutes with the probe and shared by all readers: `delta(<sector counter>[7d])` for the three SATA counters (one query per attribute id) and `increase(smartctl_device_media_errors[7d])`. A drive with a stable, small number of remapped sectors is not an incident; one that is still remapping is. When growth is seen the alert raises and pushes; after a quiet window the level falls back by itself, with no acknowledge file and no stored baseline, so the verdict stays a pure function of Prometheus plus the status model's own hysteresis memory. **No history means no growth means no alert**: if Prometheus holds less than the window (new exporter, short retention), the query sees what exists and an alert needs that history to show an increase. A first sighting of a drive with a non-zero count never alerts by itself. The detail line shows the current count and whether it grew in the window ("3 reallocated sectors, grew in the last 7 days"); it does not show *when*, because that would need a range scan. *My call, flagged in §12.*

**Temperature lines** join the threshold table next to the node's: **NVMe warn 70 °C, crit 80 °C; SATA warn 55 °C, crit 60 °C**, hysteresis 5 °C like the others, editable in Settings → Notifications with the existing lines (four new keys, additive: a saved `thresholds.json` without them loads the defaults, as the table's existing keys do). *My guesses from the lab's drives (IronWolf HDDs idle at 39 to 42 °C; the NVMe at 30 °C); Jag to confirm.* The node's own "hottest sensor" line (75/85) is unchanged and does not read drive temperatures.

**The node rolls up.** The model gives each node a `conditions` map; a derived `drives` entry holds the worst of its drives (the keyed per-drive conditions of §3 do the alerting). The node's state is the worst of all conditions. The node's reason string (already drawn in the state's colour on the node card, above the services line) names the drive: "drive sdb failed its health check". The services line stays.

## 6. Alerts and push

No new machinery. The model's conditions already drive push (ADR 0006: push has no lines of its own). Consequences:
- A crit drive condition goes out at once, with the existing grouping rules otherwise; warnings group and respect quiet hours.
- Hysteresis and "back to normal" behave as for CPU and temperature; a restart keeps held levels through the existing snapshot.
- The Alerts page, its history and its Ack and Snooze work unchanged. An alert's subject is the drive ("sdb on nas"); the lock-screen text stays title and subject only (existing privacy rule).
- **Blind is its own alert.** If a node that had drive series has none, or `up` for its smartctl scrape is 0, JagHelm raises one warning, "Drive monitoring has no signal on nas", in the *unknown* state (steel ring), never red and never as a healthy drive. It does not turn the node amber; the node keeps its other readings. A node that never had drive data raises nothing. It is **not a node condition**: it is an event source of its own, one entity per node (`drives-source:<node>`), following the precedent of `upMissing.js` and the Arcane agent-offline events, so push, the Alerts page and the history see it like any other source failure. Its severity is warning; its look is the unknown (steel ring) state.

## 7. Optional module

JagHelm is public; most installs have no smartctl exporter. The module is built so that none of this exists for them:

- **Auto-detect.** Drives are active only when Prometheus holds `smartctl_devices` for at least one node. One cheap probe (`count(smartctl_devices)`), cached 10 minutes, decides. With no series: no Drives block, no extra chart lines, no condition on any node, no alert, no extra queries beyond the probe, and the status model's output is byte-identical to today's.
- **Switch.** `JAGHELM_DRIVES=off` (env) turns it off even when series exist; The switch is that host environment variable, and nothing else: Settings → Notifications displays it as a read-only "Drive health" switch (on or off, naming `JAGHELM_DRIVES`), with no stored toggle. Documented in docs/CONFIGURATION.md with the metric contract and the exporter's required flags (power-mode check on standby).
- **Per-node scope.** A node's Drives block appears only when that node has drive series. Raspberry Pi nodes (SD cards, no SMART) show nothing, not an empty state.
- **Demo mode.** The demo fixtures gain drives so the public demo shows the feature; a demo test keeps the fixture honest.
- **Failure isolation.** The source follows the loop's rule: a throw in reading or judging drives is logged once and never stops the status step, and the rest of the model builds without drives.

## 8. UI

All of this reuses existing components and tokens; nothing is invented. The signed-off mocks are the two screens from the 2026-10-29 session.

**Node side panel (desktop) and node sheet (phone).** A **Drives** block directly under the status card, before History. It is a panel of rows (`rounded-xl border border-border bg-surface-2`), one per drive: `StatusLamp`, the drive's name in mono, the status word when not healthy, temperature at the right, and a second line of text-2 detail (model, "failed its health check", "3 reallocated sectors, grew in the last 7 days"). Tapping or pressing Enter on a row expands it in place (the `details`/disclosure pattern already used by Backups) to the bad-sector counts, the health check, and power-on hours when the exporter provides them (§4, Phase 0). Last self-test result is not in the exporter's contract and is dropped. Healthy stays quiet: a healthy row is a small lamp and plain text. The block's heading carries a count ("3 · 1 failing"). Phone: rows stack the same way; nothing needs a different layout. The block is named **Drives**, never "Disk", so it cannot be mistaken for the capacity meter.

**Status card.** When a drive is the reason, the node's status card shows it ("Critical, for 2 min · drive sdb failed its health check"), from the model's reason, not from client code.

**Node card (Overview, Infrastructure).** No new meter and no new line: the model's reason (already drawn in the state's colour above the services line) names the drive. The card's lamp reflects the roll-up.

**Temperature chart.** The chart gains one line per drive, in the chart colour slots **in order** after the node sensor (slot 1): Rose, Lime, Plum, Orange, Teal (the design system forbids skipping slots and keeps status green for status only). Legend swatches in the usage chart's style. With more than five drives, the five hottest are drawn and the legend says "+N more". Drive lines move in plateaus (the exporter's interval) and are flat for a drive in standby; the chart's caption says "drives update about every 10 minutes".

**Alerts and Needs attention.** Unchanged components. A drive alert opens the node panel with the drive row highlighted and scrolled into view (a new deep-link parameter on the existing detail route).

**Standby.** JagHelm cannot see whether a drive is asleep (that is the exporter's power-mode flag). So a one-line footnote under the Drives block, "Sleeping drives show their last reading", is shown on any node with a non-NVMe drive, and never on NVMe-only nodes.

**Accessibility and polish.** Status is lamp, word and colour together (rule 3); tap targets and focus rings from the existing row; contrast comes from the checked pairings, since no new colour is introduced. Gallery states (CI-screenshotted in both themes and densities): block healthy, warn, crit, blind, standby note, expanded row, phone width, chart with drive lines.

## 9. Failure modes

| Situation | Behaviour |
|---|---|
| No smartctl series anywhere | Module absent (§7) |
| Prometheus unreachable | The model's existing "no signal" handling; no drive verdicts invented |
| Exporter down or scrape failing | "Drive monitoring has no signal" (§6); node not turned amber |
| Drive in standby | Last cached values; standby note shown |
| New drive appears | Row appears; growth conditions have no history yet, so no alert from a first sighting alone (§5) |
| Drive removed | Row disappears after the series goes stale; a held alert clears via the model's normal path |
| Counter reset (replaced drive, same name) | The window sees a drop, not growth; no alert |
| Label mismatch (`node` does not match a JagHelm node) | Series ignored, one warning logged until it changes (the existing refused-source pattern) |

## 10. Privacy and security

Reads only; no new credential. Drive serial numbers, if the exporter exposes them, are never displayed or logged (model name only). Push text stays title plus subject. The exporter's own port is unauthenticated and bound to the LAN (homelab-infra's concern, documented there).

## 11. Test plan and phasing

**Phase 1, server (one PR).** `server/drives.js` (probe, read, cache, normalise), threshold-table rows and Settings lines, conditions in `buildStatus`, reasons, the blind alert, `JAGHELM_DRIVES`, demo fixtures, docs (CONFIGURATION, INTEGRATIONS, README note). Tests: judging table tests (every row of §5, hysteresis, windows, counter reset, standby values), a model build with and without drives (without: output identical to today), a push-cycle test as `thresholds.test.js` does, the blind alert, optional-module off paths, failure isolation. No UI.
**Phase 2, UI (one PR).** Drives block, status card reason, temperature lines, deep link, the read-only Settings display of the switch, gallery states and baselines, e2e of the node panel, phone layout.
**Then:** Jag's one UAT pass with a ~10 item visual checklist (his preferred review), including forcing a warning with a lowered temperature line to watch a push arrive.

## 12. Decisions

**Needed from Jag:**
1. *Counters judged by growth over 7 days, not "above zero" or an acknowledge baseline* (§5). Reason: stateless and cannot alarm forever. Cost: a drive with a stable pile of remapped sectors is quiet after a week.
2. *Temperature lines*: NVMe 70/80, SATA 55/60 (§5).
3. *Blind is a warning in the unknown state and does not turn the node amber* (§6).
4. *Media errors are critical, bad-sector growth is a warning* (§5), consistent with "push for any SMART warning" but differing in urgency.

**Settled, recorded for the builder:** placement A; no Overview section; node reason line carries the drive; chart slots in order; auto-detect plus an off switch; two PRs.

**Settled after the cold-reader check (2026-10-29, my calls, small):** per-drive condition keys (§3); no-history-no-alert and no "when it grew" timestamp (§5); the blind alert is its own event source (§6); real exporter output captured first as a fixture (§4); temperature lines additive in the stored config (§5); self-test dropped from the expanded row (§8); the standby footnote is shown for any non-NVMe node (§8).
