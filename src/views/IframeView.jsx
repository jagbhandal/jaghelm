import React, { useState, useRef, useEffect } from 'react';

export default function IframeView({ url, title }) {
  const [status, setStatus] = useState('loading'); // loading | ok | blocked
  const iframeRef = useRef(null);
  const timerRef = useRef(null);
  // Mirror the latest status into a ref so the timeout callback below reads the
  // current value rather than the (stale) `status` captured when the effect ran.
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    setStatus('loading');
    // X-Frame-Options / CSP blocks don't fire onError on the iframe.
    // We use a two-pronged detection:
    // 1. Try to read iframe.contentWindow — cross-origin blocked iframes throw on access
    // 2. Timeout fallback — if after 8s we still can't confirm it loaded, show the fallback
    timerRef.current = setTimeout(() => {
      // Read the live status via the ref — a slow-but-fine iframe that has
      // already resolved to 'ok' must NOT be flipped to 'blocked' by this timer.
      if (statusRef.current === 'loading') setStatus('blocked');
    }, 8000);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [url]);

  const handleLoad = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    // If the iframe loaded successfully (even cross-origin), onload fires.
    // But X-Frame-Options blocked pages also fire onload with an about:blank document.
    // We check if the iframe appears to have content by probing contentWindow.
    try {
      const doc = iframeRef.current?.contentDocument;
      // If we CAN access contentDocument and it's essentially empty, it was blocked
      if (doc && (!doc.body || doc.body.innerHTML === '')) {
        setStatus('blocked');
        return;
      }
    } catch {
      // Cross-origin — this is expected for a working cross-origin iframe. That's fine.
    }
    setStatus('ok');
  };

  if (status === 'blocked') {
    return (
      <div className="iframe-container">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 60px)', gap: '16px' }}>
          <span style={{ fontSize: '48px' }}>🔒</span>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '20px' }}>Embedding Blocked</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', maxWidth: '440px', textAlign: 'center', lineHeight: 1.6 }}>
            <strong>{title || url}</strong> is blocking iframe embedding via X-Frame-Options or CSP headers.
            {title?.toLowerCase().includes('kuma') && (
              <span style={{ display: 'block', marginTop: 8, color: 'var(--text-secondary)' }}>
                To fix: In Uptime Kuma → Settings → General, add your dashboard domain to the
                allowed iframe origins, or set the environment variable <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--bg-card-inner)', padding: '2px 6px', borderRadius: 4 }}>UPTIME_KUMA_DISABLE_FRAME_SAMEORIGIN=true</code>
              </span>
            )}
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <a href={url} target="_blank" rel="noopener noreferrer" style={{ padding: '10px 24px', background: 'var(--accent)', color: '#fff', borderRadius: '10px', textDecoration: 'none', fontSize: '14px', fontWeight: 500 }}>
              Open in New Tab
            </a>
            <button onClick={() => setStatus('loading')} style={{ padding: '10px 24px', background: 'var(--bg-card-inner)', color: 'var(--text-primary)', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '14px', fontWeight: 500, cursor: 'pointer' }}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="iframe-container">
      {status === 'loading' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 60px)', gap: 12 }}>
          <div className="skeleton" style={{ width: 24, height: 24, borderRadius: '50%' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)' }}>Loading {title || url}…</span>
        </div>
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
      <iframe ref={iframeRef} src={url} title={title || 'Embedded'} onLoad={handleLoad} onError={() => setStatus('blocked')}
        style={{ display: status === 'ok' ? 'block' : 'none' }}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups" />
    </div>
  );
}
