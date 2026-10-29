import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AlertsContent } from './AlertsPage.jsx';
import { NO_FILTERS, driveOfIssue } from './alertsView.js';
import { hdd, nasWith } from '../testing/driveFixtures.js';

// A drive alert in Needs attention opens its node with the drive marked
// (#728), as History's rows and a push do.

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const UPDATED = Object.freeze({ subscribe: () => () => {}, get: () => NOW, staleAfter: 72_000 });
const HISTORY = { state: 'ready', events: [], failed: false, retry() {} };

function page(drives) {
  const { status } = nasWith(drives);
  const linkOf = vi.fn((id, opts) => ({ href: `/?entity=${id}&drive=${opts?.drive ?? ''}` }));
  render(
    <AlertsContent
      status={status}
      reach="ok"
      updated={UPDATED}
      filters={NO_FILTERS}
      onFilters={() => {}}
      history={HISTORY}
      linkOf={linkOf}
      now={NOW}
    />
  );
  return linkOf;
}

describe('driveOfIssue', () => {
  const entity = (state, drives) => ({ kind: 'node', state, drives });
  it('is the worst drive, when its state is the node’s own', () => {
    const e = entity('crit', [
      { device: 'sda', state: 'warn' },
      { device: 'sdc', state: 'crit' },
      { device: 'sdb', state: 'crit' },
    ]);
    expect(driveOfIssue(e)).toBe('sdb');
  });
  it('is null for a node amber for something else, a healthy drive set or a non-node', () => {
    expect(driveOfIssue(entity('crit', [{ device: 'sda', state: 'warn' }]))).toBeNull();
    expect(driveOfIssue(entity('warn', [{ device: 'sda', state: 'ok' }]))).toBeNull();
    expect(driveOfIssue({ kind: 'service', state: 'crit', drives: [] })).toBeNull();
    expect(driveOfIssue({ kind: 'node', state: 'crit' })).toBeNull();
  });
});

describe('the Alerts page’s Needs attention', () => {
  it('links a failing drive’s node with that drive', () => {
    const linkOf = page([hdd('sda'), hdd('sdb', { smartPassed: false })]);
    expect(linkOf).toHaveBeenCalledWith('nodes/nas', { drive: 'sdb' });
  });
});
