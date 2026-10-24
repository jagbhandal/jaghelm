/*
 * Settings → Notifications' push parts (#320, #268, spec §7).
 *
 * PushCategories: what kinds of event page the phones, the five categories
 * and recoveries, each with what it covers, and what a new device starts
 * with (the server's defaults). The devices below show what each one gets.
 * Read-only.
 *
 * PushDevices: each registered device (a browser with alerts on, #653), a row
 * each: its name (a heading, h3); when it registered, was last seen and last
 * had a push accepted by its push service; its last failed send in words, in the
 * warning's word colour; what it gets (its categories, or that push is
 * switched off for it); the last test push's outcome for it; and its
 * actions, "Send test" and Remove (a Confirm that names it by its display
 * name, never its id). The header's "Send test push" sends one to every
 * phone, with the outcome under it. Push off (no Web Push keys on the
 * server): a note says so and how to turn it on, and nothing can be sent.
 * `stalled` (the push service out of reach) shows as a warning line under the header.
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

/** The categories, with what each covers (server/push/dispatch.js categoryOf). */
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

/** What a device gets, from its prefs. */
export function prefsText(prefs) {
  if (!prefs) return null;
  if (!prefs.enabled) return 'Push is switched off for this device';
  const on = PUSH_CATEGORIES.filter((c) => prefs.categories?.[c.key] !== false).map((c) => c.label);
  if (on.length === 0) return 'Every category is switched off for this device';
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
      description="The kinds of event that page a device, with what a new device starts with. Each device below shows what it gets."
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
        Whatever a device gets, it is always told when the status model itself fails or
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
  const times = [
    ago('Registered', device.registeredAt, now),
    ago('last seen', device.lastSeenAt, now),
    device.lastDeliveredAt
      ? ago('last push delivered', device.lastDeliveredAt, now)
      : 'no push delivered yet',
  ].filter(Boolean);
  const result = test?.results?.find((r) => r.device === device.id) ?? null;
  const off = device.prefs && !device.prefs.enabled;
  return (
    <li data-slot="device-row" data-device={device.id} className="@container">
      <div className="flex flex-col gap-2 px-panel py-3 @xl:flex-row @xl:items-start @xl:gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="text-body font-semibold text-text-1">{device.name}</h3>
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
              title="Remove this browser?"
              name={device.name}
              value={device.id}
              description="It gets no more alerts. Turn alerts on again in that browser (Settings → Notifications) to register it again."
              confirmLabel="Remove browser"
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
      description="Browsers and installed apps with alerts turned on register here."
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
            No Web Push keys are set up, so JagHelm sends no pushes. Set the three{' '}
            <code className="font-mono">VAPID_</code> variables in JagHelm’s .env and run docker
            compose up -d again (docs/GET-STARTED.md). The thresholds above still drive the
            board.
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
