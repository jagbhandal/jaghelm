/*
 * "Alerts on this device" (#653, Settings → Notifications): turning on Web
 * Push for the browser or installed app this page runs in, so JagHelm's
 * alerts reach it without the Android app. One panel, one state at a time
 * (`state`, webPushData.js stateOf), each said in words with what to do:
 *
 *   off          the one button, "Enable alerts on this device". The browser's
 *                permission prompt appears on that click and never before.
 *   on           the device is listed; "Send test alert" and "Turn off"; the
 *                last test's outcome for it (`test`, one sentence).
 *   expired      the browser's subscription ended or no longer matches the
 *                server's key; "Turn on again".
 *   denied       the browser blocks notifications for the site; how to allow
 *                them again (a button can't, the browser decides).
 *   unsupported  this browser has no Web Push.
 *   insecure     the page is not https.
 *   install      iPhone and iPad push only to an app added to the Home Screen.
 *   server-off   the server has no VAPID keys (`reason`: unset, incomplete,
 *                invalid, unreachable), and the exact fix.
 *   loading      still reading.
 *
 * Neither the subscription's endpoint nor its keys are ever drawn: the panel
 * knows a name and a state. `notice` is why the last action failed; `busy`
 * waits the buttons. `title` is only for a page that draws several (the gallery). `readOnly` (the public demo) shows the state and sends
 * nothing.
 */
import { Button } from './button.jsx';
import { Panel } from './panel.jsx';
import { cn } from './lib/utils.js';

const SERVER_OFF = {
  unset: 'JagHelm has no Web Push keys, so it sends no alerts to browsers.',
  incomplete: 'Only some of JagHelm’s three Web Push settings are set.',
  invalid: 'JagHelm’s Web Push settings are not a valid key pair.',
  unreachable: 'JagHelm did not answer, so Web Push could not be checked. Reload to try again.',
};

const WORDS = {
  loading: { title: 'Checking this device…' },
  unsupported: {
    title: 'This browser can’t receive alerts',
    body: 'It has no Web Push. Chrome, Edge, Firefox and Safari 16.4 or later do; so does the installed app on Android.',
  },
  insecure: {
    title: 'Alerts need a secure address',
    body: 'Browsers allow push only on https. Open JagHelm at its https address (the installed app uses it already).',
  },
  install: {
    title: 'Add JagHelm to the Home Screen first',
    body: 'On iPhone and iPad, alerts work from the installed app only. In Safari tap Share, then Add to Home Screen, open JagHelm from there and come back to this page. Needs iOS or iPadOS 16.4 or later.',
  },
  denied: {
    title: 'Notifications are blocked for JagHelm',
    body: 'This browser has them switched off for this site, and only you can switch them on. Open the site settings (the icon beside the address, or the app’s info page on Android), set Notifications to Allow, then reload this page.',
  },
  off: {
    title: 'Alerts are off on this device',
    body: 'Turn them on to get JagHelm’s alerts here, with the screen off too. The browser asks for permission when you tap the button.',
  },
  expired: {
    title: 'This device’s alerts need turning on again',
    body: 'The browser’s subscription ended, or JagHelm no longer has it. Turn alerts on again to register this device.',
  },
};

function serverOff(reason) {
  return {
    title: 'Web Push is off on this server',
    body: `${SERVER_OFF[reason] ?? SERVER_OFF.unset} To turn it on: run node scripts/vapid-keys.mjs once, put the three lines it prints (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT) in JagHelm’s .env on the host, and run docker compose up -d again (docs/GET-STARTED.md).`,
  };
}

function WebPushDevice({
  title = 'Alerts on this device',
  state = 'loading',
  reason = null,
  name = 'This device',
  busy = false,
  notice = null,
  test = null,
  onEnable,
  onDisable,
  onTest,
  readOnly = false,
  className,
  ...props
}) {
  const words = state === 'server-off' ? serverOff(reason) : (WORDS[state] ?? WORDS.loading);
  const on = state === 'on';
  return (
    <Panel
      flush
      title={title}
      description="Get JagHelm’s alerts in this browser or installed app, without the Android app."
      className={className}
      data-state={state}
      {...props}
    >
      <div data-slot="web-push" className="flex flex-col gap-3 px-panel py-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-body font-semibold text-text-1">{words.title}</p>
          {words.body ? <p className="text-body-sm text-text-2">{words.body}</p> : null}
          {on ? <p className="text-body-sm text-text-2">Listed below as {name}.</p> : null}
        </div>
        {notice ? (
          <p
            role="alert"
            className={cn('text-body-sm', notice.tone === 'error' ? 'text-crit-fg' : 'text-text-2')}
          >
            {notice.text}
          </p>
        ) : null}
        {test ? (
          <p data-slot="web-push-test" role="status" className="text-body-sm text-text-1">
            <span className="font-semibold">Test alert:</span> {test}
          </p>
        ) : null}
        {readOnly ? (
          <p className="text-body-sm text-text-3">This is a read-only demo: nothing is changed here.</p>
        ) : state === 'off' || state === 'expired' ? (
          <div>
            <Button variant="primary" size="sm" disabled={busy} onClick={onEnable}>
              {state === 'expired' ? 'Turn on again' : 'Enable alerts on this device'}
            </Button>
          </div>
        ) : on ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" disabled={busy} onClick={onTest}>
              Send test alert
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onDisable}>
              Turn off
            </Button>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

export { WebPushDevice };
