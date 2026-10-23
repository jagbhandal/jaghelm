import { describe, it, expect, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { forgetRemoved, markRemoved, useRemovedJobs, wasRemoved } from './removedJobs.js';
import { focusAfterRemove, removeError } from './detail/removal.js';
import { setReadOnlyServer } from '../api/client.js';

// A Remove takes the job off the lists at once (#578), until the model drops
// it; it comes back when it reports again.

const job = (lastRun) => ({ id: 'jobs/pi-2:sync', kind: 'job', lastRun });
const statusWith = (...entities) => ({ entities });

afterEach(() => {
  forgetRemoved();
  setReadOnlyServer(false);
});

describe('removed jobs', () => {
  it('a removed job is left out while the model still has it as it was', () => {
    markRemoved('jobs/pi-2:sync', 1000);
    const { result } = renderHook(() => useRemovedJobs(statusWith(job(1000))));
    expect(wasRemoved(result.current, job(1000))).toBe(true);
    // One that reported again since is listed at once.
    expect(wasRemoved(result.current, job(2000))).toBe(false);
    expect(wasRemoved(result.current, { id: 'jobs/pi-2:other', lastRun: 1000 })).toBe(false);
  });

  it('is forgotten once the model drops it, so a later report lists it again', () => {
    markRemoved('jobs/pi-2:sync', 1000);
    const { result, rerender } = renderHook(({ status }) => useRemovedJobs(status), {
      initialProps: { status: statusWith(job(1000)) },
    });
    expect(result.current.size).toBe(1);
    act(() => rerender({ status: statusWith() }));
    expect(result.current.size).toBe(0);
    expect(wasRemoved(result.current, job(1000))).toBe(false);
  });

  it('on a read-only server (the demo), stays removed for the visit', () => {
    setReadOnlyServer(true);
    markRemoved('jobs/pi-2:sync', 1000);
    const { result, rerender } = renderHook(({ status }) => useRemovedJobs(status), {
      initialProps: { status: statusWith(job(5000)) },
    });
    expect(wasRemoved(result.current, job(5000))).toBe(true);
    act(() => rerender({ status: statusWith() }));
    expect(result.current.size).toBe(1);
  });

  it('says why a Remove failed', () => {
    expect(removeError('sync', new Error('HTTP 500'))).toEqual({
      title: "Couldn't remove sync",
      cause: 'JagHelm answered HTTP 500. Nothing was removed.',
    });
    expect(removeError('sync', new TypeError('Failed to fetch')).cause).toBe(
      "JagHelm couldn't be reached. Nothing was removed."
    );
    expect(removeError('.', Object.assign(new Error('x'), { code: 'DOT_NAME' })).cause).toBe(
      'A job or node named "." or ".." can\'t be removed from a browser. Nothing was removed.'
    );
  });

  it('focus after a Remove: the next row in its list, else the one before, else its heading', () => {
    document.body.innerHTML = `
      <section data-slot="jobs-section"><h2 data-slot="jobs-title" tabindex="-1">Jobs</h2>
        <div data-slot="jobs-list">
          <a data-entity="jobs/a:1"></a><a data-entity="jobs/a:2"></a><a data-entity="backups/b:3"></a>
        </div>
      </section>`;
    const row = (id) => document.querySelector(`[data-entity="${id}"]`);
    expect(focusAfterRemove('jobs/a:1')).toBe(row('jobs/a:2'));
    expect(focusAfterRemove('jobs/a:2')).toBe(row('backups/b:3'));
    expect(focusAfterRemove('backups/b:3')).toBe(row('jobs/a:2'));
    expect(focusAfterRemove('jobs/elsewhere:4')).toBeNull();
    // The only one: its list's heading, never the body.
    document.body.innerHTML = `
      <section data-slot="jobs-list-section"><h2 data-slot="jobs-title" tabindex="-1">Jobs</h2>
        <div data-slot="jobs-list"><a data-entity="jobs/a:1"></a></div>
      </section>`;
    expect(focusAfterRemove('jobs/a:1')).toBe(document.querySelector('[data-slot="jobs-title"]'));
    document.body.innerHTML = '';
  });
});
