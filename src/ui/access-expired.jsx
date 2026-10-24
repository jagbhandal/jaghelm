/*
 * "Sign in again" (#653): shown when the dashboard's Cloudflare Access session
 * has ended. Access answers every request from the page with a redirect to
 * its own sign-in, which the page can't follow, so nothing loads and nothing
 * says why. This says why, on top of whatever the page last drew, with the
 * one thing that fixes it: Reload, which is a navigation, and a navigation is
 * what Access can answer with its sign-in. It names Access and never a URL.
 *
 * Fixed to the top of the window, above the shell; a stand-alone alert (the
 * banner's role="alert" rule), so it is announced once.
 */
import { Banner } from './banner.jsx';
import { Button } from './button.jsx';

export default function AccessExpired({ onReload = () => window.location.reload() }) {
  return (
    <div data-slot="access-expired" className="fixed inset-x-0 top-0 z-50 p-3 sm:mx-auto sm:max-w-xl">
      {/* Opaque under the banner's tint, so the page below doesn't show through. */}
      <div className="rounded-xl border border-border bg-surface-1">
        <Banner
          role="alert"
          tone="warn"
          title="Sign in again"
          cause="Your Cloudflare Access session has ended, so JagHelm can't load. Reload to sign in."
          action={
            <Button variant="primary" size="sm" onClick={onReload}>
              Reload
            </Button>
          }
        />
      </div>
    </div>
  );
}
