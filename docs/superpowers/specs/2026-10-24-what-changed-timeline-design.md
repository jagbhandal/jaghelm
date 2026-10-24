# "What changed" timeline — design

- **Date:** 2026-10-24
- **Status:** Draft for Jag's answers to §12 (card #677, epic #333). Design only; no code.
- **Inputs:** card #677; ADR 0002 and its #267 and #312/#671 notes; `docs/ARCHITECTURE.md` 4.2 (refresh and registries), 4.7 (status model, push, alert history), 5 (Overview, Edit layout, detail sheets); `server/gitea.js`, `server/cron-store.js`, `server/containerRegistry.js`, `server/discovery.js`, `server/arcane/poller.js`, `server/routes/events.js`.

## 1. Problem

When something breaks, the first question is "what changed?". The answer is spread over places that each keep a different slice: Alerts history (alerts and Arcane notices), the Pipeline panel (latest commits and CI), the Jobs section (last three runs per job), grey presence breadcrumbs (a container gone, for 24 hours), and nothing at all for a deploy, a container being recreated, or an edit Jag made in Settings. Jag reconstructs the answer by hand, and most of the evidence is gone by then.

## 2. Goals and non-goals

**Goals.** One newest-first feed of changes, on the Overview and per node or service in its detail. Bounded (30 days, 1000 rows). Built only from sources JagHelm already reads. A restart or first boot never floods it.

**Non-goals.** No new service, database or poller. No write action toward the homelab. No log search (Loki stays a peek). No metrics history. No replacement for the Alerts page or push. No per-user read state, no notifications from the timeline (push stays the only pager).

## 3. How this fits ADR 0002

ADR 0002 rejects a persisted status ring (#312, #671) because a ring is a *state sample*: Kuma already holds the real beats, JagHelm would only be a second, worse copy, and an empty one after restart is honestly labelled "since restart". An event log is different: an event is a *past fact that no live source can give back* (the container was recreated at 03:12, the deploy happened, I changed a threshold). If it is not written down when seen, it is lost. The alert history (#267) is already this kind of thing and ADR 0002 already allows it as a note.

**Proposed amendment:** one more note in ADR 0002, "the change timeline is kept on disk" (own file, 30 days, 1000 events, atomic, not a database), same shape as the #267 note. The rule it states: *facts that cannot be re-read are kept; state that can be re-read is not.* No other ADR text changes.

## 4. Event taxonomy

Alerts and recoveries are **not copied**: the alert history already persists them (and Arcane update, held-back, agent and release notices, per #581). The timeline reads them at request time and merges. The new store holds only what the alert history lacks.

| # | Kind | Real source | Detected by | Phase |
| --- | --- | --- | --- | --- |
| 1 | `alert` / `recovery` | alert history (`push/alertHistory.js`) | merged on read; type maps to kind, no copy | 1 |
| 2 | `deploy.jaghelm` | `REVISION` (`/api/health`) | revision differs from the one stored at last boot; written at boot | 1 |
| 3 | `container.recreated` | Prometheus/cAdvisor via `discovery.js` | `container_start_time_seconds` of a name moved (one more query in the existing batch; cAdvisor reports creation time, so this is a recreate or deploy, not an in-place `docker restart`) | 1 |
| 4 | `container.appeared` / `container.gone` | `containerRegistry.js` (first seen, established, absent window) | registry transitions already computed each cycle; `gone` uses the existing establish and grace gates, so one-shot jobs and scrape blips are skipped | 1 |
| 5 | `ci.run` | `gitea.js` poll (every 5 min) | a (repo, sha, branch) whose CI result is new or changed, final states only (success, failure) | 2 |
| 6 | `backup.run` | `cron-store.js` reports for jobs in `backupJobs` (includes PVE vzdump webhook runs, Arcane runs) | a report with a new run id/time | 2 |
| 7 | `config.changed` | the Settings write routes (display config, services config, integrations save) | route succeeded; records *which key or section*, never values | 2 |
| 8 | `node.rebooted` | `node_boot_time_seconds`, already inside the uptime query | boot time moved forward by more than a minute | 3 |
| 9 | `source.recovered` / `source.failed` | status model sources | already in alert history as `sources`; no new work | via #1 |
| 10 | `update.applied` | Arcane notices and Watchtower digests | already in alert history; mapped by type | via #1 |

Kinds 9 and 10 cost nothing beyond the merge. Kinds 2 to 8 are the ones needing new detection code, all on data already read.

## 5. Event schema

One shape for stored and merged events:

| Field | Meaning |
| --- | --- |
| `id` | decimal string, grows by one; the file keeps the last (as #267), merged alert rows get `a<id>` so the two id spaces never collide |
| `ts` | epoch ms when it happened (the source's time if it gives one, else when seen) |
| `kind` | one of §4 |
| `subject` | model entity id (`services/vm103:immich`, `nodes/pve`) or null; the key the drawers filter on |
| `severity` | `critical`, `warning`, `info` (the one severity table, ADR 0006; most new kinds are `info`, a failed CI or backup is `warning`) |
| `text` | one plain sentence, at most 160 characters, built from fixed words plus names |
| `ref` | optional link: an entity id the app opens, or a Gitea commit URL |
| `key` | dedupe key, e.g. `container.recreated:immich:<startTime>`, `ci.run:repo:sha:failure`, `deploy.jaghelm:<sha>` |

A write with a `key` already present in the store is a no-op. That is the whole dedupe rule.

## 6. Storage

`DATA_DIR/timeline.json`, `0600`, `{ v: 1, lastId, seeded, events }`, written with `atomicWriteFileSync` (ADR 0001), only when an event was added or aged out (dirty flag, once per refresh cycle at the end, never per event). **Not** inside `push-snapshot.json`: the timeline has no exactly-once-with-the-outbox need, and that file is already rewritten with each page.

Caps: 30 days and 1000 events (about 250 KB at the cap; a rewrite stays under a millisecond). A flapping source keeps the newest. A noise limit per `subject` and `kind` of 20 per hour drops the rest into one `…and N more` row.

Restart and damage: no file is an empty log. A file that does not parse is moved aside once (`timeline.json.corrupt-<time>`, newest only), one warning with size and count, never its text (#504), and the log starts empty. A row that fails validation is dropped, counted in one warning. A failed write is logged and the in-memory log carries on; the next change writes again. No migration: `v` is checked, an unknown `v` is treated as no file. The new keys need no config entry: there is no setting in the MVP.

## 7. Ingestion

Emission points are the places that already diff something each cycle; the timeline adds one call per point, `timeline.record(event)`, and never a poll of its own.

| Point | Emits | Note |
| --- | --- | --- |
| `server/index.js` boot | `deploy.jaghelm` | compares `REVISION` with `timeline.json`'s last; no stored one (first boot) records nothing |
| `refresh.js` cycle, after discovery | 3, 4, 8 | compares this cycle's container and node facts with the registry's last cycle |
| `gitea.js` poll result | 5 | on a poll that answered |
| cron report route | 6 | already writes the run to `cron-store.js` |
| Settings POST routes | 7 | after the write succeeds |
| read time | 1, 9, 10 | merged from the alert history |

**Startup and first-boot rule.** A source gets a silent *baseline* before it may emit: the first cycle after boot (and the first after a source was down) records what it sees as the baseline and emits nothing. `seeded` in the file marks each source baselined; a source that errors is not baselined, and never emits from a partial read (same rule as the Arcane poller, "every fetch succeeded"). A restart therefore sees the same containers, finds no change, and emits only `deploy.jaghelm` if the revision moved. The one honest gap: a container recreated *while JagHelm was down* is never recorded; the `deploy.jaghelm` row says how long JagHelm was down, so the gap is visible.

**Flap control.** `container.gone` reuses the registry's gates (establish 60 s, grace 90 s). `ci.run` fires on final states only. Alerts keep their existing hysteresis. The per-subject rate limit in §6 is the last backstop.

## 8. API

`GET /api/timeline`, behind the token like every `/api` read, `Cache-Control: no-store`. Same query reader as `/api/events` (`limit` 50, max 200; `before` cursor; `subject` repeatable, max 50; `kind` comma list; `severity` comma list; anything else is a 400 saying which). Answer: `{ events, next }` newest first, the merged rows sorted by `ts` then id, so a page cursor is `ts:id` and new events never move a page being read. Demo mode answers a fixture log through the same reader (as `demoEvents.js`).

## 9. UI

- **Overview:** a "What changed" section, last 8 rows, "All changes" link to a full list (`/changes`, with the filters in the URL like Alerts). A row: time (viewer's calendar), kind icon plus word, the sentence, severity shape (word and shape, not colour alone). Healthy and quiet reads as one quiet line, not a wall.
- **Detail drawer and phone sheet:** "Recent changes" for a node or service, `subject` filter, last 5, in the detail's own lazy chunk, fetched when the detail opens, not per tick.
- **Phone:** the same list inside the existing Alerts tab as a second segment, no new tab.
- **Edit layout:** the section is a normal movable and hideable section in `overviewSections.js`, default below Pipeline, so the layout versioning and `.catch` defaults already cover a saved layout that lacks it.
- **Budget:** first load is about 205.8 of 230 kB. The Overview section, the list page and the hook ship in one lazy chunk loaded when the section scrolls near (or the page opens); the first load gains only the section's registry entry (target under 0.5 kB, measured by `scripts/first-load.mjs` and reported in the PR). If the placeholder row needs height, it reserves it, so CLS stays under 0.1.

## 10. Privacy and failure modes

**Redaction.** Every `text` passes through the log-peek cleaner (`redactSecrets` and the control, bidi and ANSI strip, cut at 160) *before* it is stored, so the file never holds what the API must not show. Config events name the key or section changed ("Thresholds changed"), never old or new values. No commit message bodies: a CI row shows repo, short sha and branch.

| Failure | Behaviour |
| --- | --- |
| a source is down | no events from it, no baseline reset; the source's own alert is already in the feed |
| file unreadable or corrupt | empty log, aside once, one warning |
| disk full | write logged, memory carries on, never a 500 |
| clock steps back | rows keep `ts`; order uses `ts` then id; aging uses the later of now and the newest row |
| two instances | unsupported, as ADR 0002 |
| old client against old server | `/api/timeline` 404 is "needs a newer server", section hides |

## 11. Test plan and phasing

**Tests (red first).** Unit: store (cap, age, dedupe key, atomic write, corrupt file moved aside, bad row dropped, unknown `v`), each emitter (baseline silent, change emits once, source error emits nothing, restart emits nothing), redaction, query reader (limits, cursor, 400s), merge order with alert rows. Contract test for the route and auth (401 without a token). Component tests for the section, the sheet list and the old-server 404. One Playwright spec: seed a log, see the Overview section, open a service detail, see its rows, hide the section in Edit layout. Gallery baselines for the new section only. A first-load check reports the new number.

| Phase | Ships | Builder rounds |
| --- | --- | --- |
| 1 (MVP) | store, route, merge of alerts, `deploy.jaghelm`, `container.recreated`, `container.appeared`/`gone`, Overview section, ADR note | 3 |
| 2 | `ci.run`, `backup.run`, `config.changed`, detail drawer and phone segment, `/changes` page | 2 |
| 3 | `node.rebooted`, tuning from a week of real use | 1 |

Rough total: 5 to 6 builder rounds, plus one review pass per phase.

## 12. Open questions for Jag

1. **Keep alerts in the same feed, merged on read?** Recommend yes: one feed is the point, and nothing is copied. The cost is two id spaces, handled by prefixing.
2. **In-place `docker restart` is invisible** (cAdvisor reports creation time). Accept "recreated" only, or add Docker restart counts from Arcane's container list later? Recommend accept for the MVP; Arcane's count is a phase 3 option if you miss it.
3. **Retention:** 30 days and 1000 events like the alert history, or shorter (14 days)? Recommend 30 and 1000: same as Alerts, about 250 KB.
4. **Config-change rows say which section, not what value.** Enough, or do you want old to new for non-secret values? Recommend section only: values risk secrets and add redaction surface.
5. **Where does it live on the Overview?** Recommend a section below Pipeline, movable in Edit layout, with the phone version as a segment of the Alerts tab rather than a new tab.
