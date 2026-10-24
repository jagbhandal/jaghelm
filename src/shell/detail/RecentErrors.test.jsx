import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { RecentErrors } from './RecentErrors.jsx';
import { useLogPeek, LOG_READ_EVERY_MS } from './useLogPeek.js';
import { forgetAnswers } from '../../hooks/useData.js';

// "Recent errors" (#672): read when a detail opens and never before, at most
// once a minute after, nothing for a covered sheet; lines as text; Loki
// unavailable, or a read that fails, as words and never a throw.

let asked;
let answer;

function respond(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  });
}

/** A status poll stand-in the test can answer by hand. */
function poll() {
  const listeners = new Set();
  return {
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    tick: () => listeners.forEach((l) => l()),
    count: () => listeners.size,
  };
}

const NODE = { kind: 'node', entity: 'edge' };
const OK = {
  state: 'ok',
  lines: [{ at: Date.UTC(2026, 9, 24, 12, 0, 0), text: 'ERROR boom <b>x</b>' }],
};

beforeEach(() => {
  forgetAnswers();
  asked = [];
  answer = () => respond(OK);
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      asked.push(String(url));
      return answer(String(url));
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('RecentErrors', () => {
  it('reads once as it opens, naming the entity, and draws the lines as text', async () => {
    render(<RecentErrors target={{ kind: 'container', entity: 'apps/db' }} updated={poll()} />);
    expect(screen.getByText('Reading logs…')).toBeInTheDocument();
    expect(await screen.findByText('ERROR boom <b>x</b>')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="detail-logs"] b')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Recent errors' })).toBeInTheDocument();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/\/logs\?entity=apps%2Fdb$/);
  });

  it('none: its own words; unavailable: the server\'s sentence', async () => {
    answer = () => respond({ state: 'none', lines: [] });
    const { unmount } = render(<RecentErrors target={NODE} updated={poll()} />);
    expect(
      await screen.findByText('No errors in the last 6 h.')
    ).toBeInTheDocument();
    unmount();
    answer = () => respond({ state: 'unavailable', lines: [], reason: 'Loki refused the connection' });
    render(<RecentErrors target={NODE} updated={poll()} />);
    expect(
      await screen.findByText('Logs unavailable: Loki refused the connection.')
    ).toBeInTheDocument();
  });

  it('silent names what sent nothing and is not the all-clear', async () => {
    answer = () => respond({ state: 'silent', lines: [], reason: 'db on vm-103' });
    render(<RecentErrors target={NODE} updated={poll()} />);
    expect(
      await screen.findByText(
        'No logs received from db on vm-103 in the last 6 h: check the Loki host label.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/No errors/)).toBeNull();
  });

  it('a failed read, an old server and a stray body are all "unavailable", never a throw', async () => {
    for (const make of [
      () => respond({ error: 'nope' }, 404),
      () => Promise.reject(new Error('network down')),
      () => respond('not an answer'),
    ]) {
      answer = make;
      forgetAnswers();
      const { unmount } = render(<RecentErrors target={NODE} updated={poll()} />);
      expect(await screen.findByText('Logs unavailable.')).toBeInTheDocument();
      unmount();
    }
  });

  it('reads nothing for no target or a covered sheet, then reads when it is on top', async () => {
    const { rerender } = render(<RecentErrors target={NODE} updated={poll()} paused />);
    await act(async () => {});
    expect(asked).toHaveLength(0);
    rerender(<RecentErrors target={NODE} updated={poll()} paused={false} />);
    await screen.findByText('ERROR boom <b>x</b>');
    expect(asked).toHaveLength(1);
  });

  it('a status answer reads again only after a minute', async () => {
    const updated = poll();
    function Probe() {
      const r = useLogPeek(NODE, updated);
      return <p>{r.state}</p>;
    }
    render(<Probe />);
    await screen.findByText('ok');
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now');
    spy.mockReturnValue(now + LOG_READ_EVERY_MS - 1_000);
    act(() => updated.tick());
    expect(asked).toHaveLength(1);
    spy.mockReturnValue(now + LOG_READ_EVERY_MS + 1_000);
    act(() => updated.tick());
    await waitFor(() => expect(asked).toHaveLength(2));
    spy.mockRestore();
  });

  it('another target starts afresh and the poll is let go on close', async () => {
    const updated = poll();
    const { rerender, unmount } = render(<RecentErrors target={NODE} updated={updated} />);
    await screen.findByText('ERROR boom <b>x</b>');
    answer = () => new Promise(() => {});
    rerender(<RecentErrors target={{ kind: 'node', entity: 'nas' }} updated={updated} />);
    expect(screen.getByText('Reading logs…')).toBeInTheDocument();
    unmount();
    expect(updated.count()).toBe(0);
  });
});
