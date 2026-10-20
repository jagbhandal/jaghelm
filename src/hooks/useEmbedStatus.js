/**
 * useEmbedStatus — one app frame's load state (#269). Logic only: IframeView
 * (src/views/IframeView.jsx) is today's presentation.
 *
 * status:
 * - 'loading': the frame hasn't loaded yet.
 * - 'slow': still not loaded after `slowAfterMs` (8 s). The frame keeps loading
 *   behind the notice and shows when it loads. Slow is never "blocked": an app
 *   that is starting up, or far away, just takes longer.
 * - 'ok': the frame loaded.
 * - 'blocked': the app's headers refuse framing. The page can't see that (a
 *   cross-origin frame's headers are unreadable, and Chromium fires `load` for
 *   a refused frame too), so the server reads them (`fetchEmbedCheck`). When
 *   it can't, the frame shows whatever the browser puts in it.
 *
 * The server checks the URL it has saved for the tab, so the hook asks only
 * when `savedUrl` (the saved config's URL for this tab) is the URL the frame
 * shows. An edited URL is asked about when its save lands, never before (the
 * answer would be about the old URL), and never per keystroke.
 *
 * `blockedBy` is the header line that blocks (null when not known), `attempt`
 * keys the iframe element so Retry gets a new one (a reload of that frame
 * only), and `onLoad` goes on the iframe. `reloads` counts the reloads asked
 * from outside (the app bar's Reload, #296): each one is a Retry too.
 *
 * @param {{ tabId: string, url: string, savedUrl?: string, slowAfterMs?: number,
 *   checkEmbed?: typeof fetchEmbedCheck, reloads?: number }} args
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchEmbedCheck } from '../api/embedCheck.js';

export const SLOW_AFTER_MS = 8000;

export function useEmbedStatus({
  tabId,
  url,
  savedUrl,
  slowAfterMs = SLOW_AFTER_MS,
  checkEmbed = fetchEmbedCheck,
  reloads = 0,
}) {
  const [retries, setRetries] = useState(0);
  const attempt = retries + reloads;
  // State is kept with the attempt and URL it is about, so a retry or a new URL
  // starts from 'loading' and no answer about the last one leaks into it.
  const key = `${attempt} ${url}`;
  // How far this attempt got: 'loading' | 'slow' | 'loaded'.
  const [progress, setProgress] = useState({ key, phase: 'loading' });
  // fetchEmbedCheck's answer; none while asking.
  const [check, setCheck] = useState({ key, answer: null });

  useEffect(() => {
    const timer = setTimeout(
      () => setProgress((p) => (p.key === key && p.phase === 'loaded' ? p : { key, phase: 'slow' })),
      slowAfterMs
    );
    return () => clearTimeout(timer);
  }, [key, slowAfterMs]);

  // Asked once the server has this URL saved, per attempt: a retry asks
  // afresh, so a fix to the app's headers shows up.
  const saved = savedUrl === url;
  useEffect(() => {
    if (!saved) return undefined;
    let current = true;
    checkEmbed(tabId, url, { fresh: attempt > 0 }).then((answer) => {
      if (current) setCheck({ key, answer });
    });
    return () => {
      current = false;
    };
  }, [key, saved, tabId, url, attempt, checkEmbed]);

  const onLoad = useCallback(() => setProgress({ key, phase: 'loaded' }), [key]);
  const retry = useCallback(() => setRetries((n) => n + 1), []);

  const phase = progress.key === key ? progress.phase : 'loading';
  const answer = check.key === key ? check.answer : null;
  const blocked = answer?.verdict === 'blocked';
  const status = blocked ? 'blocked' : phase === 'loaded' ? 'ok' : phase;

  return { status, blockedBy: blocked ? answer.header : null, attempt, onLoad, retry };
}
