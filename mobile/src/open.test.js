import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openTarget } from './open.js';

describe('openTarget (read-only)', () => {
  beforeEach(() => { window.open = vi.fn(); });
  it('navigates to a service url and never writes', () => {
    openTarget({ kind: 'service', uid: 'vm-101:gitea', url: 'http://h/gitea' });
    expect(window.open).toHaveBeenCalledWith('http://h/gitea', '_blank', 'noopener');
  });
  it('is a no-op for a target with no url', () => {
    openTarget({ kind: 'cron', job: 'backup' });
    expect(window.open).not.toHaveBeenCalled();
  });
});
