/*
 * Settings → Notifications' push parts (#320, #268, spec §7).
 *
 * PushCategories: what kinds of event page the phones, the five categories
 * the Android app's Notification Settings switches (#539) and recoveries,
 * each with what it covers, and what a phone starts with (the server's
 * defaults). Each phone chooses its own in the app, so this lists them and
 * says so; the devices below show what each one chose. Read-only: there is
 * one place to change them, the phone.
 *
 * PushDevices: each registered phone, a row each: its name (a heading, h3),
 * its Android and app versions (a browser has neither: it is a name, and
 * `platform: 'web'`, #653); when it registered, was last seen and last
 * had a push accepted by Google; its last failed send in words, in the
 * warning's word colour; what it gets (its categories, or that push is
 * switched off in its app); the last test push's outcome for it; and its
 * actions, "Send test" and Remove (a Confirm that names it by its display
 * name, never its id). The header's "Send test push" sends one to every
 * phone, with the outcome under it. Push off (no Firebase key on the
 * server): a note says so and how to turn it on, and nothing can be sent.
 * `stalled` (Google out of reach) shows as a warning line under the header.
 *
 * Neither ever shows a token: a phone is its `id`, a fingerprint, which
 * travels as the Confirm's value and is never drawn.
 *
 * Props (PushDevices): `id` (the panel's anchor), `enabled`, `stalled` (a
 * sentence or null), `devices` (GET /api/push/devices' `devices`), `test`
 * (its `test`), `now` (ms, what the ages are counted from), `busy` (a test
 * push on its way: its buttons wait), `notice` (`{ tone, text }`: why an
 * action was refused), `onTest(id | null)`, `onRemove(id)`, `readOnly`, and
 * `unread` (`{ loading, error, onRetry }`: the phones aren't read yet, or
 * couldn't be, and why, in place of everything under the header).
 */
import { Button } from './button.jsx';
import { Confirm } from './confirm.jsx';
import { Panel } from './panel.jsx';
import { Unread } from './threshold-table.jsx';
import { agoText } from './lib/ago.js';
import { cn } from './lib/utils.js';

/** The categories as the Android app names them, with what each covers (server/push/dispatch.js categoryOf). */
export const PUSH_CATEGORIES = Object.freeze([
  Object.freeze({
    key: 'service',
    label: 'Services',
    covers: 'A service goes down or comes back, and Uptime Kuma failing',
  }),
  Object.freeze({
    key: 'host',
    label: 'Hosts',
    covers: 'A node stops answering or crosses a threshold, and Prometheus failing',
  }),
  Object.freeze({
    key: 'ups',
    label: 'UPS',
    covers: 'The UPS on battery or low, mains back, and the NUT exporter failing',
  }),
  Object.freeze({ key: 'cron', label: 'Cron', covers: 'A job or a backup fails or is overdue' }),
  Object.freeze({
    key: 'watchtower',
    label: 'Updates',
    covers: 'Arcane updates and releases, an agent offline, the weekly vulnerability digest',
  }),
]);

/** "Services, Hosts and UPS". */
function listText(words) {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** What a phone gets, from the prefs it chose in the app. */
export function prefsText(prefs) {
  if (!prefs) return null;
  if (!prefs.enabled) return 'Push is switched off in the app on this phone';
  const on = PUSH_CATEGORIES.filter((c) => prefs.categories?.[c.key] !== false).map((c) => c.label);
  if (on.length === 0) return 'Every category is switched off in the app';
  const recoveries = prefs.notifyRecoveries ? 'with recoveries' : 'without recoveries';
  return `Gets ${on.length === PUSH_CATEGORIES.length ? 'every category' : listText(on)}, ${recoveries}`;
}

function PushCategories({ title = 'What pages the phones', defaults, className, ...props }) {
  const start = defaults ?? { categories: {}, notifyRecoveries: true };
  const onOff = (on) => (on ? 'On' : 'Off');
  return (
    <Panel
      flush
      title={title}
      description="Each phone chooses its own categories in the JagHelm app, under Notification Settings: this is the list it chooses from, with what a new phone starts with. Each phone below shows what it chose."
      className={className}
      {...props}
    >
      <dl data-slot="push-categories" className="divide-y divide-border">
        {PUSH_CATEGORIES.map((c) => (
          <div key={c.key} className="flex items-baseline gap-4 px-panel py-2.5">
            <dt className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-body-sm font-semibold text-text-1">{c.label}</span>
              <span className="text-caption text-text-3">{c.covers}</span>
            </dt>
            <dd className="text-caption text-text-2">
              New phones: {onOff(start.categories?.[c.key] !== false)}
            </dd>
          </div>
        ))}
        <div className="flex items-baseline gap-4 px-panel py-2.5">
          <dt className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-body-sm font-semibold text-text-1">Recoveries</span>
            <span className="text-caption text-text-3">Also when a problem clears</span>
          </dt>
          <dd className="text-caption text-text-2">New phones: {onOff(start.notifyRecoveries)}</dd>
        </div>
      </dl>
      <p className="border-t border-border px-panel py-3 text-caption text-text-3">
        Whatever a phone chose, it is always told when the status model itself fails or
        services.yaml stops parsing, and a test push ignores its categories.
      </p>
    </Panel>
  );
}

/** "Registered 12 d ago", or nothing for a time it doesn't have. */
function ago(label, at, now) {
  const ms = at ? Date.parse(at) : NaN;
  return Number.isFinite(ms) ? `${label} ${agoText(now - ms)}` : null;
}

function DeviceRow({ device, test, now, enabled, busy, readOnly, onTest, onRemove }) {
  const meta = [
    device.os ? `Android ${device.os}` : null,
    device.appVersion ? `app ${device.appVersion}` : null,
  ].filter(Boolean);
  const times = [
    ago('Registered', device.registeredAt, now),
    ago('last seen', device.lastSeenAt, now),
    device.lastDeliveredAt
      ? ago('last push delivered', device.lastDeliveredAt, now)
      : 'no push delivered yet',
  ].filter(Boolean);
  const result = test?.results?.find((r) => r.device === device.id) ?? null;
  const off = device.prefs && !device.prefs.enabled;
  // A browser with alerts on (#653), not a phone running the app.
  const web = device.platform === 'web';
  return (
    <li data-slot="device-row" data-device={device.id} className="@container">
      <div className="flex flex-col gap-2 px-panel py-3 @xl:flex-row @xl:items-start @xl:gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="text-body font-semibold text-text-1">{device.name}</h3>
          {meta.length > 0 ? <p className="text-caption text-text-3">{meta.join(' · ')}</p> : null}
          <p className="text-body-sm text-text-2">{times.join(' · ')}</p>
          {device.lastError ? (
            <p className="text-body-sm text-warn-fg wrap-anywhere">
              {ago('Last failed', device.lastError.at, now)}: {device.lastError.sentence}
            </p>
          ) : null}
          <p className={cn('text-body-sm', off ? 'text-text-3' : 'text-text-2')}>
            {prefsText(device.prefs)}
          </p>
          {result ? (
            <p data-slot="device-test" className="text-body-sm text-text-1">
              <span className="font-semibold">Test push:</span> {result.sentence}
            </p>
          ) : null}
        </div>
        {readOnly ? null : (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              tone="accent"
              disabled={!enabled || busy}
              onClick={() => onTest?.(device.id)}
            >
              Send test <span className="sr-only">to {device.name}</span>
            </Button>
            <Confirm
              trigger={
                <Button variant="ghost" size="sm" aria-label={`Remove ${device.name}`}>
                  Remove
                </Button>
              }
                      title={web ? 'Remove this browser?' : 'Remove this phone?'}
              name={device.name}
              detail={meta.join(' · ') || undefined}
              value={device.id}
              description={
                web
                  ? 'It gets no more alerts. Turn alerts on again in that browser (Settings → Notifications) to register it again.'
                  : 'It gets no more pushes. It registers again the next time the JagHelm app opens on it, unless push is turned off there.'
              }
              confirmLabel={web ? 'Remove browser' : 'Remove phone'}
              destructive
              onConfirm={(id) => onRemove?.(id)}
            />
          </div>
        )}
      </div>
    </li>
  );
}

function PushDevices({
  title = 'Devices',
  enabled = false,
  stalled = null,
  devices = [],
  test = null,
  now = Date.now(),
  busy = false,
  notice = null,
  onTest,
  onRemove,
  readOnly = false,
  unread = null,
  className,
  ...props
}) {
  const children = unread ? <Unread {...unread} /> : null;
  const allTest = test && test.device == null ? test : null;
  const canTestAll = enabled && devices.length > 0 && !readOnly;
  return (
    <Panel
      flush
      title={title}
      description="Phones running the JagHelm app, and browsers with alerts turned on, register here."
      actions={
        canTestAll ? (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => onTest?.(null)}>
            Send test push
          </Button>
        ) : null
      }
      className={className}
      {...props}
    >
      {children == null && !enabled ? (
        <div
          data-slot="push-off"
          className="flex flex-col gap-1 border-b border-border px-panel py-3"
        >
          <p className="text-body-sm font-semibold text-text-1">Push is off on this server</p>
          <p className="text-body-sm text-text-2">
            No Firebase service account and no Web Push keys are set up, so JagHelm sends no pushes.
            For the Android app, put the service account’s key on the host, set{' '}
            <code className="font-mono">FCM_SERVICE_ACCOUNT</code> in JagHelm’s .env to its path,
            and run docker compose up -d again (docs/mobile/PUSH-SETUP.md). For browsers, set the
            three <code className="font-mono">VAPID_</code> variables (docs/GET-STARTED.md). The
            thresholds above still drive the board.
          </p>
        </div>
      ) : null}
      {children == null && stalled ? (
        <p role="status" className="border-b border-border px-panel py-3 text-body-sm text-warn-fg">
          Pushes are waiting on the server: {stalled}.
        </p>
      ) : null}
      {children == null && (allTest || notice) ? (
        <div className="flex flex-col gap-1 border-b border-border px-panel py-3">
          {allTest ? (
            <p data-slot="test-all" role="status" className="text-body-sm text-text-1">
              <span className="font-semibold">Test push to every phone:</span> {allTest.sentence}
            </p>
          ) : null}
          {notice ? (
            <p
              role="alert"
              className={cn(
                'text-body-sm',
                notice.tone === 'error' ? 'text-crit-fg' : 'text-text-2'
              )}
            >
              {notice.text}
            </p>
          ) : null}
        </div>
      ) : null}
      {children ??
        (devices.length === 0 ? (
          <p className="px-panel py-4 text-body-sm text-text-2">
            No phone or browser is registered yet. Sign in to the JagHelm app on a phone and allow
            notifications, or turn on alerts in a browser; it shows here.
          </p>
        ) : (
          <ul data-slot="device-list" className="divide-y divide-border">
            {devices.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                test={test}
                now={now}
                enabled={enabled}
                busy={busy}
                readOnly={readOnly}
                onTest={onTest}
                onRemove={onRemove}
              />
            ))}
          </ul>
        ))}
    </Panel>
  );
}

export { PushCategories, PushDevices };
