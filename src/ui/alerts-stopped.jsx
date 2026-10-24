/*
 * "Alerts on this phone stopped" (#653): shown on any page when alerts were on
 * for this device and no longer are (the permission taken back, the browser's
 * subscription gone and not mendable). A phone that silently stops getting
 * alerts is the failure this exists for, so it says so where it can't be
 * missed, with the one button that fixes it. Fixed to the top, a stand-alone
 * alert (the banner's role="alert" rule).
 */
import { Banner } from './banner.jsx';
import { Button } from './button.jsx';

export default function AlertsStopped({ onTurnOn, busy = false }) {
  return (
    <div data-slot="alerts-stopped" className="fixed inset-x-0 top-0 z-40 p-3 sm:mx-auto sm:max-w-xl">
      <div className="rounded-xl border border-border bg-surface-1">
        <Banner
          role="alert"
          tone="warn"
          title="Alerts on this phone stopped"
          cause="JagHelm can no longer send alerts to this device. Turn them back on."
          action={
            <Button variant="primary" size="sm" disabled={busy} onClick={onTurnOn}>
              Turn them back on
            </Button>
          }
        />
      </div>
    </div>
  );
}
