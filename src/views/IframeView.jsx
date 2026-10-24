import React, { useEffect, useId, useRef, useState } from 'react';
import { SLOW_AFTER_MS, useEmbedStatus } from '../hooks/useEmbedStatus.js';

// One app tab's frame and its loading / slow / blocked notices. The state is
// useEmbedStatus's; this is only how it looks today (legacy CSS variables).
// AppFrames keeps it mounted, hidden, while another tab is open (#269).

const notice = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'calc(100vh - 60px)',
  gap: '16px',
  padding: '24px 16px',
  boxSizing: 'border-box',
};
const heading = { fontFamily: 'var(--font-display)', fontSize: '20px', textAlign: 'center' };
const text = {
  color: 'var(--text-muted)',
  fontSize: '14px',
  maxWidth: '440px',
  textAlign: 'center',
  lineHeight: 1.6,
  margin: 0,
};
const primary = {
  padding: '10px 24px',
  background: 'var(--accent)',
  color: '#fff',
  borderRadius: '10px',
  border: 'none',
  textDecoration: 'none',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
};
const secondary = {
  padding: '10px 24px',
  background: 'var(--bg-card-inner)',
  color: 'var(--text-primary)',
  borderRadius: '10px',
  border: '1px solid var(--border-color)',
  textDecoration: 'none',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
};
const code = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  background: 'var(--bg-card-inner)',
  padding: '2px 6px',
  borderRadius: 4,
  overflowWrap: 'anywhere',
};

function OpenInNewTab({ url, style }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" style={style}>
      Open in new tab
    </a>
  );
}

function SlowNotice({ title, url, seconds, onRetry }) {
  return (
    <div style={notice}>
      <h3 style={heading}>{title} is slow to load</h3>
      <p style={text}>
        It hasn&apos;t finished loading after {seconds} seconds. It may still be starting up, and
        it shows here as soon as it loads.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
        <button type="button" onClick={onRetry} style={primary}>
          Retry
        </button>
        <OpenInNewTab url={url} style={secondary} />
      </div>
    </div>
  );
}

function BlockedNotice({ title, url, blockedBy, onRetry, onShowAnyway, focusShow }) {
  const [showHow, setShowHow] = useState(false);
  const showButton = useRef(null);
  // After "Stop showing it anyway" brings this panel back, focus lands on the way forward again.
  useEffect(() => {
    if (focusShow) showButton.current?.focus();
  }, [focusShow]);
  const howId = useId();
  const origin = window.location.origin;
  return (
    <div style={notice}>
      <span style={{ fontSize: '48px' }} aria-hidden="true">
        🔒
      </span>
      <h3 style={heading}>{title} won&apos;t open inside JagHelm</h3>
      <p style={text}>
        Its server tells browsers not to show it inside another site (an{' '}
        <code style={code}>X-Frame-Options</code> or <code style={code}>frame-ancestors</code>{' '}
        header). JagHelm can&apos;t override that, so it says so instead of showing a blank page.
      </p>
      <p style={text}>
        Open it in a new tab, or allow JagHelm&apos;s address in that app&apos;s proxy or embedding
        settings.
      </p>
      <p style={text}>
        {'If JagHelm has this wrong, show it anyway. The choice is remembered for this app, and Settings → Apps & links can undo it.'}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
        <OpenInNewTab url={url} style={primary} />
        <button type="button" ref={showButton} onClick={onShowAnyway} style={secondary}>
          Show it anyway
        </button>
        <button
          type="button"
          aria-expanded={showHow}
          aria-controls={howId}
          onClick={() => setShowHow((s) => !s)}
          style={secondary}
        >
          How to allow embedding
        </button>
      </div>
      <div
        id={howId}
        hidden={!showHow}
        style={{ ...text, textAlign: 'left', display: showHow ? 'flex' : 'none', flexDirection: 'column', gap: 8 }}
      >
        {showHow && (
          <>
            {blockedBy && (
              <p style={{ margin: 0 }}>
                {title} sends <code style={code}>{blockedBy}</code>.
              </p>
            )}
            <p style={{ margin: 0 }}>Change it in the app&apos;s settings, or in the reverse proxy in front of it:</p>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li>
                Allow JagHelm&apos;s address with{' '}
                <code style={code}>Content-Security-Policy: frame-ancestors &apos;self&apos; {origin}</code>.
                Browsers then ignore <code style={code}>X-Frame-Options</code>, which can&apos;t name
                another site.
              </li>
              <li>
                If the app already sends a <code style={code}>frame-ancestors</code> list, add{' '}
                <code style={code}>{origin}</code> to that list. A second header doesn&apos;t help:
                browsers apply every one.
              </li>
            </ul>
            {title.toLowerCase().includes('kuma') && (
              <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
                Uptime Kuma: in Settings → General, add your dashboard domain to the allowed iframe
                origins, or set the environment variable{' '}
                <code style={code}>UPTIME_KUMA_DISABLE_FRAME_SAMEORIGIN=true</code>
              </p>
            )}
            <div>
              <button type="button" onClick={onRetry} style={secondary}>
                Check again
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function IframeView({
  tab,
  savedUrl,
  slowAfterMs = SLOW_AFTER_MS,
  reloads = 0,
  onEmbedAnyway,
}) {
  const { id, url } = tab;
  const title = tab.label || url;
  const [noteDismissed, setNoteDismissed] = useState(false);
  // Which control takes focus when the view swaps the blocked panel for the
  // frame ('undo') or back ('show'): the one that was just pressed is gone.
  const [focusNext, setFocusNext] = useState(null);
  const undoButton = useRef(null);
  const { status, blockedBy, refused, attempt, onLoad, retry } = useEmbedStatus({
    tabId: String(id),
    url,
    savedUrl,
    slowAfterMs,
    reloads,
    embedAnyway: tab.embedAnyway === true,
  });

  // Focus moves once per choice, then the request is dropped: a later re-check
  // (Reload, an edited URL) must not pull focus back from where the user went.
  useEffect(() => {
    if (focusNext === 'undo' && undoButton.current) {
      undoButton.current.focus();
      setFocusNext(null);
    } else if (focusNext === 'show' && status === 'blocked') {
      setFocusNext(null); // BlockedNotice focused its button in this commit
    }
  }, [focusNext, status, refused, noteDismissed]);
  const [said, setSaid] = useState('');
  const choose = (on) => {
    setNoteDismissed(false);
    setSaid(on ? `Showing ${title} anyway…` : `${title} is no longer shown anyway.`);
    setFocusNext(on ? 'undo' : 'show');
    onEmbedAnyway?.(tab.id, on);
  };

  return (
    <div className="iframe-container">
      <div role="status" aria-live="polite" className="sr-only">
        {said}
      </div>
      {status === 'loading' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 60px)', gap: 12 }}>
          <div className="skeleton" style={{ width: 24, height: 24, borderRadius: '50%' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)' }}>Loading {title}…</span>
        </div>
      )}
      {status === 'slow' && (
        <SlowNotice title={title} url={url} seconds={Math.round(slowAfterMs / 1000)} onRetry={retry} />
      )}
      {refused && !noteDismissed && (
        <div
          role="note"
          style={{ ...text, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px' }}
        >
          <span style={{ flex: 1 }}>
            {title} asks not to be shown inside another site
            {blockedBy ? (
              <>
                {' '}
                (<code style={code}>{blockedBy}</code>)
              </>
            ) : null}
            , so the frame below may be blank: your browser still refuses it if the site really
            blocks it. You chose to show it anyway.
          </span>
          {onEmbedAnyway && (
            <button
              type="button"
              ref={undoButton}
              onClick={() => choose(false)}
              style={secondary}
            >
              Stop showing it anyway
            </button>
          )}
          <button type="button" onClick={() => setNoteDismissed(true)} style={secondary}>
            Dismiss
          </button>
        </div>
      )}
      {status === 'blocked' && (
        <BlockedNotice
          title={title}
          url={url}
          blockedBy={blockedBy}
          onRetry={retry}
          onShowAnyway={() => choose(true)}
          focusShow={focusNext === 'show'}
        />
      )}
      {/*
        Sandbox trade-off: `allow-popups` is retained intentionally.

        Risk: a compromised framed app can spawn pop-up phishing windows.
        Reason kept: the typical embed targets in this dashboard (Grafana,
        Portainer, Gitea, Uptime Kuma, Dockge, Proxmox web UI) all rely on
        target="_blank" / window.open for normal operator workflows — share
        links, log views, "open in new tab", external doc links. Without
        allow-popups those silently no-op, producing dead clicks that look
        like app bugs.

        Mitigation in place: `allow-popups-to-escape-sandbox` is NOT granted,
        so any spawned window still inherits the sandbox (no allow-scripts
        unless we add it). Framed apps must be trusted operator tools, which
        matches the homelab threat model.

        Revisit if we ever expose this view to untrusted users or third-party
        URLs.
      */}
      {/* `key={attempt}` gives Retry a fresh iframe element, so the same `src`
          is fetched again (and onLoad fires again) for this frame only. The
          frame keeps loading, hidden, behind the slow notice. */}
      <iframe key={attempt} src={url} title={title || 'Embedded'} onLoad={onLoad}
        style={{ display: status === 'ok' ? 'block' : 'none' }}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups" />
    </div>
  );
}
