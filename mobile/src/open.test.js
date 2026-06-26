import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openTarget } from './open.js';

describe('openTarget (read-only)', () => {
  beforeEach(() => { window.open = vi.fn(); });

  it('navigates to an http url with noopener,noreferrer', () => {
    openTarget({ kind: 'service', uid: 'vm-101:gitea', url: 'http://h/gitea' });
    expect(window.open).toHaveBeenCalledWith('http://h/gitea', '_blank', 'noopener,noreferrer');
  });

  it('navigates to an https url with noopener,noreferrer', () => {
    openTarget({ kind: 'service', uid: 'vm-101:gitea', url: 'https://h/gitea' });
    expect(window.open).toHaveBeenCalledWith('https://h/gitea', '_blank', 'noopener,noreferrer');
  });

  it('is a no-op for a target with no url', () => {
    openTarget({ kind: 'cron', job: 'backup' });
    expect(window.open).not.toHaveBeenCalled();
  });

  it('is a no-op for a javascript: url (scheme blocked)', () => {
    openTarget({ kind: 'service', url: 'javascript:alert(1)' });
    expect(window.open).not.toHaveBeenCalled();
  });

  it('is a no-op for a data: url (scheme blocked)', () => {
    openTarget({ kind: 'service', url: 'data:text/html,<h1>x</h1>' });
    expect(window.open).not.toHaveBeenCalled();
  });

  it('is a no-op for a malformed url', () => {
    openTarget({ kind: 'service', url: 'not a url !!!' });
    expect(window.open).not.toHaveBeenCalled();
  });

  // Defense-in-depth: new URL() normalizes case + rejects leading whitespace, so
  // these obfuscated javascript: payloads are blocked by the same scheme guard.
  it('is a no-op for a mixed-case Javascript: url', () => {
    openTarget({ kind: 'service', url: 'JaVaScRiPt:alert(1)' });
    expect(window.open).not.toHaveBeenCalled();
  });

  it('is a no-op for a whitespace-prefixed javascript: url', () => {
    openTarget({ kind: 'service', url: '\t javascript:alert(1)' });
    expect(window.open).not.toHaveBeenCalled();
  });
});
