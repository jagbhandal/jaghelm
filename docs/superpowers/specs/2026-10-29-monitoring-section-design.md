# Monitoring section — design

- **Date:** 2026-10-29
- **Status:** Draft. Design only; no code. Sign-off on §12 before a plan is written.
- **Inputs:** Jag's decisions in the 2026-10-29 session (§2); a read of Beszel's source (what a monitoring UI offers); an inventory of the five Grafana dashboards and twelve alert rules in homelab-infra (`grafana/`); ADR 0002, 0004, 0006; `docs/design-system.md` ("Chart colours"); `docs/superpowers/specs/2026-10-24-what-changed-timeline-design.md` and `2026-10-29-drive-health-design.md` (the two neighbours); `server/promHistory.js`, `server/diskForecast.js`, `server/push/alertRules.js`, `src/ui/chart.jsx`, `src/shell/ShellAttention.jsx`, `src/components/settings/sections.js`.

## 1. Problem

Charts live in Grafana, a second app with its own look, its own login and 48 panels across five dashboards. Most panels are too granular to read ("a vomit of charts"), and the few that matter (days until a disk fills, which container is leaking, what the lab costs to run) are hard to find. JagHelm already reads the same Prometheus, already draws history charts in its own design system, and already decides what is wrong. It has no page for *how things are trending*, so Grafana stays on for that alone, along with a second alerting path (Grafana rules to Discord) that duplicates most of JagHelm's own.

## 2. Goals and non-goals

**Decisions from Jag (2026-10-29), binding on this spec:**

1. A **Monitoring** tab inside JagHelm, in JagHelm's design system. Grafana is retired at the end, not at the start.
2. **Only the necessary graphs**, chosen for the question they answer, each in the chart type that suits its data. Not limited to the two types Beszel uses.
3. **All graphs always show**, healthy or not. A **banner on top appears only when something is wrong**, and each row has a *View graph* link that scrolls to the matching chart and highlights it.
4. **Power draw** and **estimated monthly cost** are required graphs.
5. **Settings → System** gets an electricity-rate field, with a **rate history** (dated rates), so a provider change never rewrites old months. Jag is in Ohio: the rate is an all-in price per kWh.
6. The **phone screen is in the first slice.**
7. The Services & Traffic dashboard (Loki access logs) and the "Change vs last week" view are **out** for now.

**Goals.** Nine charts and two stat tiles (§5). Banner and *View graph* wired to the existing status model. Energy settings with rate history. Grafana's alert rules either covered by JagHelm or deliberately dropped (§8). A retirement checklist for Grafana and Tempo (§9).

**Non-goals.** No new datastore: Prometheus stays JagHelm's metrics source (ADR 0002). No arbitrary PromQL from the client, no metric browser, no dashboards editor. No log search (Loki stays a peek). No Discord or webhook delivery. No second status model: the banner shows the verdicts push already sends (ADR 0006).

## 3. How this fits the existing design

- **ADR 0006 (one severity table).** The banner is `ShellAttention` fed by the header's existing `/api/status` poll, so the banner, the Overview strip, the Alerts page and push cannot disagree. The Monitoring page judges nothing. Chart threshold lines are *drawn from* the same thresholds (`status/thresholds.js`), never a second set.
- **ADR 0004 (config copy on read) and 0001 (atomic writes).** The energy settings are a new `display-config.json` key read and written the way `alerts` is (§6).
- **What-changed timeline spec.** Grafana's deploy and image-update annotations are the timeline's job (its §4 kinds `deploy.*`). Monitoring links to it; it does not re-draw markers.
- **Drive-health spec.** The Drives section (§5, chart 8) shows that module's judgement and temperatures. It adds no drive logic.
- **Overview vs Monitoring.** Overview answers *what is wrong now*. Monitoring answers *where is it heading and why*. They overlap only in the banner (§4), which links back to Alerts for anything with no chart.

## 4. Banner and *View graph*

- Rendered only when the status model has at least one issue **that has a chart on this page**. Healthy: nothing is drawn above the charts, and the page is just the charts. A line under the banner, "N other issues → Alerts", appears only when issues exist that have no chart (a node down, a service down).
- Implementation: `ShellAttention` with `linkOf` extended to return a `chart` target. Each row keeps its status word, lamp, reason and age (design system: status is word + colour + shape). A row whose issue maps to a chart gets a **View graph** action; others get none.
- The target is a URL, `/monitoring?focus=<chart-id>`, so the same link works from a push notification, from the Overview's rows and by hand.
- **Highlight.** The focused chart scrolls into view with the header offset, takes keyboard focus, and shows a ring in the *selected* colour (violet means selected, never status) plus a text tag in the chart header with a status lamp and the reason ("Warning · 91% full"). A live region announces it. The ring clears on the next click or Escape. The chart also draws the breached threshold line or the affected span, so the problem is visible even without the tag.

| Issue (status model) | Opens chart |
|---|---|
| `host_threshold` cpu | 4 CPU (the node's panel) |
| `host_threshold` memory | 5 Memory and swap |
| `host_threshold` disk, disk forecast | 3 Disk runway |
| `host_threshold` temperature | 4 CPU, temperature drill-down |
| `ups_on_battery` | 1 Power draw, and the runtime tile |
| drive and RAID conditions (`hdd`, `ssd`, `nvme`, `lvmthin`) | 8 Drives |
| container restart loop, OOM (new, §8) | 7 Restarts and OOM kills |
| container memory growth (new) | 6 Container memory growers |
| `host_unreachable`, `service_down`, `source_down`, cron, Arcane | none (Alerts / entity detail) |

## 5. The charts

Chart type follows the question. Ranges: 1 h, 24 h, 7 d (existing) and **30 d** (new; Prometheus keeps 30 days, so it is the ceiling). Every long-range line chart also carries a **max** band, because an average hides spikes (borrowed from Beszel's Avg/Max toggle).

| # | Question | Chart type | Source (Prometheus) | Status |
|---|---|---|---|---|
| 1 | What does the lab draw? | Line, watts, with the day's min and max | `nut_load * nut_real_power_nominal_watts` | new series, new `ups` kind |
| 2 | What does it cost? | Daily bars in money, plus a projected-month figure; the rate in force shown per bar on hover | the same, bucketed per local day (§6) | new |
| 3 | Which disk fills first? | Ranked horizontal bars of days left; drill-in is a line with a dashed projection to full | `server/diskForecast.js` (exists) | exists; new view |
| 4 | Is a node's CPU off? | Small multiples (one line per node, shared scale), warn line from thresholds; drill-down: iowait and temperature | `node.cpu`, `node.temperature` (exist), iowait new | mostly exists |
| 5 | Is memory or swap under strain? | Small multiples, memory plus swap as two series | `node.memory` (exists), `node.swap` new | partly new |
| 6 | Which container is leaking? | Ranked bars of 7-day memory growth, a sparkline per row | `homelab:container_mem_growth_7d_bytes` (Prometheus recording rule) | new; depends on the rule |
| 7 | What restarted or was OOM-killed, and when? | Event strip on a shared time axis, one row per container that had events | Grafana's proven expression (container start-time age and CPU-counter reset, `container_oom_events_total`) | new |
| 8 | Are the drives healthy? | State lamps and table (SMART, RAID member count), plus a temperature line per drive | drive-health module, `drive.temperature` (exists), `node_md_disks` | mostly exists |
| 9 | Is traffic normal? | Mirrored area (in above zero, out below), per node | `node_network_{receive,transmit}_bytes_total` | new |

**Stat tiles** (numbers, not charts): **month-to-date cost** (from chart 2) and **UPS runtime at current load** (already read by `refreshUPS`).

**Footnote on charts 1 and 2:** the figure covers only what is plugged into the UPS, and is the UPS's load percentage times its nominal watts, not a metered reading. (Live check on 2026-10-29: 27% of 330 W, about 89 W; 24 h average about 88 W.) See decision D7 for an optional "other loads" correction.

**Chart kit.** `src/ui/chart.jsx` draws up to six line series. This spec needs, in `src/ui` with the usual tests and gallery states: stacked and mirrored area, bars (ranked and daily), threshold lines, small multiples, the event strip, and the max band. Each follows the design-system chart rules (six categorical slots, status colour never draws a series, `role=img` with a text summary, keyboard crosshair). `ChartGroup` already gives a shared time axis.

**Layout.** Sections with plain-language headings that state the question: *Power and cost*, *Capacity*, *Resources*, *Containers*, *Drives*. Charts are never hidden when healthy. A hard ceiling of nine charts: a tenth needs a spec change.

## 6. Energy settings, rate history and the cost maths

**Settings → System → "Energy cost"** (a new part beside Password, Backup, Data refresh). A currency symbol (up to 3 characters, default `$`) and a list of rates, each a row of **effective-from date** and **price per kWh**, with add and remove. The newest row is the current rate. Empty list: the cost chart shows an empty state linking to this setting, and the power chart still draws.

`display-config.json` key `energy`, sanitised the way `sanitizeAlerts` is (a bad entry is dropped, a save is never refused):

```json
{ "energy": { "currency": "$", "rates": [ { "from": "2026-01-01", "perKwh": 0.14 } ] } }
```

Rules: `from` is a real calendar date (`YYYY-MM-DD`, in the configured time zone), unique, kept sorted; `perKwh` is a number above 0 and at most 10; at most 24 rows; a day before the first `from` uses the first rate; the list is stored sorted and de-duplicated. The time zone is `alerts.timezone` (the server's own zone when unset). All of it is non-secret.

**Cost, computed on the server, deterministically.**

1. Read hourly average watts for the range (`query_range`, step 1 h, at most about 720 points).
2. Convert each hour to kWh (watts / 1000), bucket by **local calendar day** in the configured zone (a day is 23 or 25 hours twice a year across US DST; bucketing by local date, not by 24-hour windows, handles it).
3. Each day's cost = its kWh times the rate whose `from` is the latest on or before that day.
4. **Month to date** = sum of days since the 1st (today is partial and drawn lighter, with its word "so far").
5. **Projected month** = month to date + (days left in the month times the trailing 7-day mean daily cost at the *current* rate). A trailing week smooths a backup night; Grafana used a single day.
6. Prometheus keeps 30 days, so on the 31st of a long month the first day is missing. The tile then says "since the 2nd" rather than guess.

The client receives finished numbers (kWh and money per day, the rate in force), never raw PromQL.

## 7. Server and API

- **One read, `GET /api/monitoring?range=…`**, returns every chart's data (and the cost bundle). Charts are defined server-side in one table like `HISTORY_SERIES`; the client sends a range only, never PromQL (the existing rule). Same auth and failure words as `/api/history`; a failed chart reports its own failure sentence (`failureWords.js`) and never draws an empty line that looks healthy.
- **Caching** follows `promHistory.js`: keyed by (chart, range), valid until the range's next step, concurrent reads share one query, failures cached briefly.
- **Steps:** 1 h at 60 s, 24 h at 300 s, 7 d at 1800 s (existing); 30 d at 7200 s (361 points, new).
- **Polling budget.** The page adds one request per refresh while it is open, on top of the header's status poll that already feeds the banner. This needs an explicit exception in `tickBudget.js`, as the drawer history had, and is enforced by `App.polling.test.jsx` and `e2e/budgets.spec.mjs`.
- **Routes and nav.** `/monitoring` in `routes.js`; "Monitoring" in the **Monitor** group after Infrastructure; a lazy loader in `lazyViews.js`; a render branch in `App.jsx`; a palette entry. The view is a lazy chunk, so the first-load budget is untouched.
- **Phone.** A `src/phone/views/Monitoring.jsx` at the same URL below 768 px, reached from the **More** sheet (the five tabs stay as they are, decision D2). Single column; small multiples become a compact list of rows with a sparkline that opens a full chart; 44 px touch targets; the same banner and *View graph*.

## 8. Alerts: what to keep from Grafana

JagHelm's own judging already covers most of Grafana's twelve rules. Disposition (verify each "covered" against `main` before the rule is paused):

| Grafana rule | JagHelm today | Disposition |
|---|---|---|
| Node Unreachable | `host_unreachable` | covered, drop |
| UPS On Battery | `ups_on_battery` | covered, drop |
| Disk Usage High (85%) | warn 90%, crit 95%, plus the days-until-full forecast | covered, drop (optionally lower warn to 85%) |
| Memory Low | memory warn 90% | covered, drop |
| Memory Pressure (PSI) | none | drop; show PSI on the node page if wanted |
| Monitoring gap | `source_down`, the grey no-signal state | covered, drop |
| CPU Sustained High (30 min) | warn 90% held 2 cycles (about a minute) | **keep the idea:** lengthen the hold so a backup night does not page |
| Container Restart Loop | none | **gap:** new condition (restarts in an hour above a limit), feeds chart 7 |
| Container under a temporary name | Arcane update pushes, Missing-container card | covered if Missing raises an attention item; verify, then drop |
| Container gone after the update run | same | same |
| HA push receiver down (Loki) | none | optional (D5) |
| JagHelm data stale | JagHelm cannot watch itself | **external watcher:** an Uptime Kuma HTTP monitor on JagHelm (Kuma's Discord path is independent) |

So alert parity is three small items (CPU hold, restart-loop condition, Kuma monitor) plus the optional HA rule, not a rules engine. JagHelm keeps Web Push as its only channel; Ack, Snooze, quiet hours, grouping and known causes (#669) apply to the new condition unchanged.

## 9. Retiring Grafana (and Tempo)

Done in homelab-infra, after the JagHelm work ships, as its own PRs. **Not before** these hold:

1. Charts 1 to 9 live on desktop and phone, and Jag has used the page for a stretch of real days (UAT checklist, not a diff review).
2. §8's three items shipped, and Grafana's rules ran in parallel with JagHelm's with no page that JagHelm missed.
3. The Kuma monitor on JagHelm is green and tested by stopping JagHelm once.

Then, each its own PR with the handbook pages updated in the same PR (docs closed loop): pause, then remove the Grafana stack and its provisioning and alert-rule export; remove the **Discord Alerts** contact point; remove JagHelm's Grafana app-tab preset and the embedding setting; retire **Tempo** (no dashboard panel uses it and it has had no producer since OpenClaw). **Prometheus, Loki and Alloy stay**: JagHelm reads Prometheus, and Loki serves the log peek and the Ilaaj agents. Pages to update: `docs/operations/observability.md`, `docs/services/grafana.md`, `docs/services/tempo.md`, `docs/services/prometheus-metrics.md`, the services index and a decision record.

## 10. Failure modes

- **Prometheus down or slow:** each chart shows its fixed failure sentence; the banner is unaffected (it reads the status model). Cached good data is not presented as fresh.
- **Recording rule `homelab:container_mem_growth_7d_bytes` missing:** chart 6 reports "not available" with the cause, never an empty list that reads as healthy. The rule lives in Prometheus config in homelab-infra and is part of the dependency list in §9.
- **No UPS data** (`JAGHELM_UPS_NAME` unset or exporter quiet): charts 1 and 2 and the runtime tile show a "no UPS data" state; the rest of the page is unaffected.
- **No rate configured:** chart 2 shows the empty state with a link to Settings; kWh is still shown.
- **A node off** (MS-S1 is not always on): its series have gaps that break the line honestly; it is never drawn as zero.
- **Stale status:** the banner follows the one stale-status rule (`statusFreshness.js`): last-known rows, drawn as no signal.
- **Bad `energy` config:** sanitised on read, never fails a boot or a save.

## 11. Privacy, security, tests and phasing

**Security.** `/api/monitoring` has the same auth as `/api/history`. No new outbound call. The energy rate is not a secret, but it is household financial data: it is stored only in `display-config.json` and never sent to a third party or put in logs.

**Tests.** Server: cost bucketing (DST days, month boundaries, partial today, missing first day), rate-in-force lookup, `sanitizeEnergy`, series definitions, failure words, cache. UI: each new chart component has its test, gallery states (healthy, flagged, loading, failed) in both themes and densities, axe, the contrast script. Page: banner mapping table in §4, focus and highlight (keyboard and live region), phone view. CI gates: tick-budget exception, first-load budget, e2e budgets. Demo fixtures cover the whole page. Changelog fragments per PR. Docs: `ARCHITECTURE.md` and `design-system.md` (chart types) in the same PRs.

**Phasing.** Each is a separate PR; the phone screen ships with its page slice.

| Phase | Content | Size |
|---|---|---|
| A | `energy` settings, sanitiser, Settings → System "Energy cost" with rate history; cost maths and `ups` series on the server | M |
| B | Chart kit additions in `src/ui` (area, mirrored, bars, threshold lines, small multiples, event strip, max band) with gallery states | L |
| C | Monitoring route, nav, lazy view, phone screen; banner and *View graph*; Power and cost, Disk runway | M |
| D | Resources: CPU, memory and swap, network (series and charts) | M |
| E | Containers: growers, restarts and OOM strip; Drives section | M |
| F | Alert parity (§8): CPU hold, restart-loop condition; Kuma monitor (homelab-infra) | S to M |
| G | Grafana and Tempo retirement (homelab-infra, §9) | M |

Jag reviews by UAT: each phase ends with a short visual checklist, not a list of diffs.

## 12. Decisions

**Adopted 2026-10-29**, when Jag asked for the story cards and the build to start: every recommended option below (the bold ones). He can override any of them by commenting on the epic before the affected card starts. D5 and D7 change scope if overridden.

- **D1. Banner scope.** **Show only issues that have a chart here, with a link to Alerts for the rest** (recommended), or mirror the Overview's full list.
- **D2. Phone navigation.** **Monitoring under More** (recommended; the five tabs stay), or replace a tab.
- **D3. Container growth source.** **Use the existing Prometheus recording rule** (recommended; cheap), or compute the slope in JagHelm from raw series (no config dependency, costlier query).
- **D4. Projected month.** **Month to date plus the trailing 7-day mean at the current rate** (recommended), or Grafana's one-day mean times 720 hours.
- **D5. "HA push receiver down."** Port as a Loki-backed condition (JagHelm already reads Loki), or **drop it and rely on the runbook** (recommended: one known failure mode, easy to notice when Ring goes quiet).
- **D6. 30-day range.** **Add, at a 2-hour step** (recommended), or stop at 7 days.
- **D7. UPS-only measurement.** Add an optional "other loads (watts)" constant to Energy cost so wall-powered devices are counted (more accurate, one more field), or **leave it out and keep the footnote** (recommended to start).
- **D8. Decision record.** **Add ADR 0008, "Grafana retired; Prometheus is JagHelm's metrics store"** (recommended), to sit beside ADR 0002.
