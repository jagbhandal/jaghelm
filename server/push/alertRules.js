// @ts-check
/**
 * What Settings → Notifications' "Alert rules" (#669) say, as pure functions:
 * the display config's `alerts` key read into rules, the quiet hours' clock,
 * a known cause's tag, and the one push a burst or a night's worth becomes.
 * No I/O and no clock of its own (the caller passes the time), so the sender,
 * the routes and the Settings page all judge by the same rules. The page
 * imports this file too (it holds nothing of Node's).
 *
 * The `alerts` key (all optional; a missing one reads as its default, a bad
 * one is dropped, never refusing a save, `sanitizeAlerts`):
 *
 *   groupWindowSeconds  0 to 600, default 60. Alerts queued within it of the
 *                       first become one push; 0 sends each at once
 *   quietHours          { enabled (false), start ("22:00"), end ("07:00"),
 *                       mode ("critical": only critical pages still ring;
 *                       "silent": none do) }; what is held is sent as one
 *                       summary when the quiet hours end
 *   timezone            an IANA name from the runtime's list (or UTC). Unset
 *                       reads as the server's own zone on an install with no
 *                       saved `alerts`, and as America/Toronto (what every
 *                       earlier version used) on one whose `alerts` was saved
 *                       without it, so an upgrade changes nothing (#703)
 *   knownCauses         [{ match, label }], at most 20: an alert whose
 *                       service or host name holds `match` (any case) gets
 *                       the label. Unset reads as DEFAULT_CAUSES; [] is none
 */

export const GROUP_WINDOW_DEFAULT_S = 60;
export const GROUP_WINDOW_MAX_S = 600;
export const QUIET_MODES = Object.freeze(['critical', 'silent']);
/** The zone an install that saved `alerts` before the time zone could be chosen keeps (#703). */
export const LEGACY_TIMEZONE = 'America/Toronto';
export const MAX_CAUSES = 20;
export const MATCH_MAX = 80;
export const LABEL_MAX = 120;
/** The cause an install with no saved `knownCauses` starts with (Omada's scheduled upgrade reboots both APs at once). */
export const DEFAULT_CAUSES = Object.freeze([
  Object.freeze({ match: 'omada', label: 'Omada AP auto-upgrade reboot' }),
]);

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const isObject = (/** @type {unknown} */ v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** @type {Set<string> | null} */
let zoneList = null;
/** The zones a person may choose: the runtime's IANA list plus UTC, sorted, UTC first. */
export function timezoneChoices() {
  if (!zoneList) {
    /** @type {string[]} */
    let names = [];
    try {
      names = /** @type {any} */ (Intl).supportedValuesOf('timeZone');
    } catch {
      names = [];
    }
    zoneList = new Set(['UTC', ...(names.length > 0 ? names : [LEGACY_TIMEZONE])]);
  }
  return [...zoneList];
}

/** Whether `name` is an IANA zone the runtime knows (or UTC); a free-text value never is. */
export function validTimezone(/** @type {unknown} */ name) {
  if (typeof name !== 'string' || name === '' || name.length > 64) return false;
  timezoneChoices();
  if (zoneList?.has(name)) return true;
  // The list names each zone once, by ICU's spelling (Asia/Calcutta); IANA's
  // other spellings of it (Asia/Kolkata, Etc/UTC) are zones too, in IANA's
  // own capitals. Free text never is.
  if (!/^[A-Z][A-Za-z0-9_+-]*(\/[A-Z][A-Za-z0-9_+-]*)+$/.test(name)) return false;
  try {
    const known = new Intl.DateTimeFormat('en-CA', { timeZone: name }).resolvedOptions().timeZone;
    return zoneList?.has(known) === true;
  } catch {
    return false;
  }
}

/**
 * The zone this process runs in (the container's TZ, UTC if unset), as a name
 * on the list; UTC when the runtime names it some other way ("Etc/UTC").
 */
export function systemTimezone() {
  try {
    const name = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return validTimezone(name) ? name : 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Where the effective zone comes from: "saved" (`alerts.timezone`), "legacy"
 * (`alerts` saved without one: America/Toronto) or "server" (no saved
 * `alerts`: the server's own zone).
 * @param {unknown} raw  the stored `alerts` value
 * @returns {'saved' | 'legacy' | 'server'}
 */
export function timezoneSource(raw) {
  const a = sanitizeAlerts(raw);
  if (a === undefined) return 'server';
  return a.timezone === undefined ? 'legacy' : 'saved';
}

/**
 * The `alerts` value as the config keeps it: only the parts that are valid.
 * undefined for anything that is no object. Pure, never throws.
 * @param {unknown} raw
 */
export function sanitizeAlerts(raw) {
  if (!isObject(raw)) return undefined;
  const src = /** @type {Record<string, any>} */ (raw);
  /** @type {Record<string, unknown>} */
  const out = {};
  const w = src.groupWindowSeconds;
  if (Number.isInteger(w) && w >= 0 && w <= GROUP_WINDOW_MAX_S) out.groupWindowSeconds = w;
  if (isObject(src.quietHours)) {
    const q = src.quietHours;
    /** @type {Record<string, unknown>} */
    const quiet = {};
    if (typeof q.enabled === 'boolean') quiet.enabled = q.enabled;
    if (typeof q.start === 'string' && HHMM.test(q.start)) quiet.start = q.start;
    if (typeof q.end === 'string' && HHMM.test(q.end)) quiet.end = q.end;
    if (QUIET_MODES.includes(q.mode)) quiet.mode = q.mode;
    if (Object.keys(quiet).length > 0) out.quietHours = quiet;
  }
  if (validTimezone(src.timezone)) out.timezone = src.timezone;
  if (Array.isArray(src.knownCauses)) {
    const causes = [];
    for (const item of src.knownCauses) {
      if (!isObject(item)) continue;
      const match = typeof item.match === 'string' ? item.match.trim() : '';
      const label = typeof item.label === 'string' ? item.label.trim() : '';
      if (match === '' || label === '' || match.length > MATCH_MAX || label.length > LABEL_MAX)
        continue;
      causes.push({ match, label });
      if (causes.length === MAX_CAUSES) break;
    }
    out.knownCauses = causes;
  }
  return out;
}

const minutesOf = (/** @type {string} */ hhmm) => {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

/**
 * @typedef {object} AlertRules
 * @property {number} groupWindowMs
 * @property {{ enabled: boolean, start: string, end: string, mode: 'critical' | 'silent' }} quiet
 * @property {string} timezone
 * @property {ReadonlyArray<{ match: string, label: string }>} causes
 */

/**
 * The rules in force from a stored `alerts` value (anything): every missing or
 * bad part is its default.
 * @param {unknown} raw
 * @param {string} [serverZone]  the zone of the server, for an install with no saved `alerts`
 * @returns {AlertRules}
 */
export function resolveAlerts(raw, serverZone = systemTimezone()) {
  const a = sanitizeAlerts(raw) ?? {};
  const q = /** @type {any} */ (a.quietHours) ?? {};
  return {
    groupWindowMs: /** @type {any} */ (a.groupWindowSeconds ?? GROUP_WINDOW_DEFAULT_S) * 1000,
    quiet: {
      enabled: q.enabled ?? false,
      start: q.start ?? '22:00',
      end: q.end ?? '07:00',
      mode: q.mode ?? 'critical',
    },
    timezone:
      /** @type {any} */ (a.timezone) ??
      (sanitizeAlerts(raw) === undefined ? serverZone : LEGACY_TIMEZONE),
    causes: /** @type {any} */ (a.knownCauses) ?? DEFAULT_CAUSES,
  };
}

/** @type {Map<string, Intl.DateTimeFormat>} */
const clocks = new Map();
/** Minutes since local midnight in `timezone` at `at` (ms). */
function localMinutes(/** @type {string} */ timezone, /** @type {number} */ at) {
  let fmt = clocks.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    });
    clocks.set(timezone, fmt);
  }
  const parts = fmt.formatToParts(new Date(at));
  const get = (/** @type {string} */ type) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (get('hour') % 24) * 60 + get('minute');
}

/**
 * Whether `at` is inside the quiet hours, and if so when they end (ms).
 * Equal start and end is no quiet time at all. An end is found by counting
 * minutes on, so across a clock change it can be an hour out: the summary
 * is then an hour early or late, never lost.
 * @param {AlertRules} rules
 * @param {number} at
 * @returns {{ quiet: false } | { quiet: true, endsAt: number }}
 */
export function quietAt(rules, at) {
  const { enabled, start, end } = rules.quiet;
  if (!enabled) return { quiet: false };
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (s === e) return { quiet: false };
  const m = localMinutes(rules.timezone, at);
  const inside = s < e ? m >= s && m < e : m >= s || m < e;
  if (!inside) return { quiet: false };
  const delta = (e - m + 1440) % 1440;
  return { quiet: true, endsAt: at - (at % 60_000) + delta * 60_000 };
}

/** The part of an event's body that names its subject (webPush.js buildWebPayload's body). */
export const subjectOf = (/** @type {any} */ event) => String(event?.body ?? '').split(' · ')[0];

/**
 * The known cause for an alert: the label of the first rule whose `match` is
 * in the alert's subject, its id or its entity, in any case; null for none. Never for a
 * test push.
 * @param {any} event
 * @param {ReadonlyArray<{ match: string, label: string }>} causes
 * @returns {string | null}
 */
export function causeFor(event, causes) {
  if (!event || event.type === 'push_test' || causes.length === 0) return null;
  const text =
    `${subjectOf(event)} ${String(event.id ?? '')} ${String(event.entity ?? '')}`.toLowerCase();
  for (const { match, label } of causes) {
    if (text.includes(match.toLowerCase())) return label;
  }
  return null;
}

const NOUN = {
  service_down: ['service down', 'services down'],
  host_unreachable: ['host unreachable', 'hosts unreachable'],
  host_threshold: ['host alert', 'host alerts'],
  ups_on_battery: ['UPS on battery', 'UPS on battery'],
  service_temp_name: ['container on a temporary name', 'containers on temporary names'],
  container_missing: ['container missing', 'containers missing'],
  cron_failed: ['job failed', 'jobs failed'],
  cron_overdue: ['job overdue', 'jobs overdue'],
  source_down: ['source down', 'sources down'],
  arcane_agent_offline: ['agent offline', 'agents offline'],
};
const RECOVERED = new Set([
  'service_recovered',
  'host_recovered',
  'host_threshold_cleared',
  'ups_restored',
  'cron_recovered',
  'service_temp_name_cleared',
  'container_returned',
  'source_recovered',
  'arcane_agent_recovered',
]);
const RANK = { info: 0, warning: 1, critical: 2 };

/** The node an event names after "on" in its subject ("Jellyfin on apps" → "apps"), or null. */
const nodeOfSubject = (/** @type {string} */ subject) => {
  const at = subject.lastIndexOf(' on ');
  return at === -1 ? null : subject.slice(at + 4);
};

/**
 * The one event a burst (or a night's held alerts) is sent as. `kind` is
 * "group" (a burst inside the window) or "digest" (the quiet hours' summary).
 * The event is a plain one the Web Push payload builder reads: its `members`
 * are the tags of the alerts it stands for, for Snooze and Ack.
 *
 *   5 services down on apps          title (the node when all share one)
 *   Jellyfin, Grafana, Immich +2     body: the first names, then a count
 *
 * @param {any[]} events  two or more
 * @param {'group' | 'digest'} kind
 * @param {{ tagOf: (event: any) => string, cause?: (event: any) => string | null }} read
 */
export function summarize(events, kind, read) {
  const n = events.length;
  const types = new Set(events.map((e) => String(e.type)));
  const subjects = events.map((e) => subjectOf(e));
  const nodes = new Set(subjects.map(nodeOfSubject));
  const node = nodes.size === 1 ? [...nodes][0] : null;
  const names = subjects.map((s) => (node ? s.slice(0, s.lastIndexOf(' on ')) : s));

  let what;
  if (types.size === 1) {
    const [type] = [...types];
    const noun = /** @type {Record<string, string[]>} */ (NOUN)[type];
    what = noun
      ? `${n} ${n === 1 ? noun[0] : noun[1]}`
      : RECOVERED.has(type)
        ? `${n} recovered`
        : `${n} alerts`;
  } else if ([...types].every((t) => RECOVERED.has(t))) {
    what = `${n} recovered`;
  } else {
    what = `${n} alerts`;
  }
  const title =
    kind === 'digest' ? `While you were away: ${what}` : `${what}${node ? ` on ${node}` : ''}`;

  const shown = [...new Set(names)].slice(0, 3);
  const rest = n - shown.length;
  const labels = [...new Set(events.map((e) => read.cause?.(e)).filter(Boolean))];
  const body = [`${shown.join(', ')}${rest > 0 ? ` +${rest}` : ''}`, ...labels.slice(0, 2)].join(
    ' · '
  );

  const severity = events
    .map((e) => (e.severity in RANK ? e.severity : 'info'))
    .reduce(
      (a, b) => (RANK[/** @type {'info'} */ (b)] > RANK[/** @type {'info'} */ (a)] ? b : a),
      'info'
    );
  return {
    type: kind === 'digest' ? 'alert_digest' : 'alert_group',
    id: kind,
    title,
    body,
    severity,
    count: n,
    members: [...new Set(events.map((e) => read.tagOf(e)))].slice(0, 50),
  };
}
