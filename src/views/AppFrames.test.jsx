import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import AppFrames from './AppFrames.jsx';
import { useAppFrames } from '../hooks/useAppFrames.js';

// An app tab's frame and its states (#269): loading, slow, shown, blocked. The
// server's embed check (/api/embed-check/:tabId) says whether the app's headers
// refuse framing; the page alone can't, since a blocked frame still fires load.

const vault = { id: 'vault', label: 'Vaultwarden', type: 'iframe', url: 'https://vault.example/' };
const kuma = { id: 'kuma', label: 'Uptime Kuma', type: 'iframe', url: 'https://kuma.example/' };

function Harness({ tabs, active }) {
  return <AppFrames frames={useAppFrames(tabs, active)} />;
}

let answers; // tab id → body, or a Promise of one, or an Error
let checks; // every embed-check request: { id, query }

function respond(body) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  answers = {};
  checks = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const m = /^\/api\/embed-check\/([^?]+)\?(.*)$/.exec(String(url));
      if (!m) return Promise.reject(new Error(`unexpected ${url}`));
      const id = decodeURIComponent(m[1]);
      checks.push({ id, query: new URLSearchParams(m[2]) });
      const a = answers[id];
      if (a instanceof Error) return Promise.reject(a);
      return Promise.resolve(a).then((body) => respond(body ?? {}));
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms) => act(() => vi.advanceTimersByTimeAsync(ms));
const frameOf = (tab) => document.querySelector(`iframe[src="${tab.url}"]`);

describe('a slow app', () => {
  it('shows "slow to load" with Retry after 8 s, never "blocked"', async () => {
    answers.vault = { url: vault.url, verdict: 'allowed' };
    render(<Harness tabs={[vault]} active="vault" />);
    await advance(0);
    expect(screen.getByText('Loading Vaultwarden…')).toBeInTheDocument();

    await advance(7999);
    expect(screen.queryByText(/slow to load/)).toBeNull();
    await advance(1);
    expect(screen.getByRole('heading', { name: 'Vaultwarden is slow to load' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText(/won't open|blocked/i)).toBeNull();

    // It was still loading behind the notice: when it loads, it shows.
    fireEvent.load(frameOf(vault));
    expect(screen.queryByText(/slow to load/)).toBeNull();
    expect(frameOf(vault)).toBeVisible();
  });

  it('is slow, not blocked, when the server could not read its headers', async () => {
    answers.vault = { url: vault.url, verdict: 'unknown', reason: 'timed out' };
    render(<Harness tabs={[vault]} active="vault" />);
    await advance(8000);
    expect(screen.getByRole('heading', { name: 'Vaultwarden is slow to load' })).toBeInTheDocument();
    expect(screen.queryByText(/won't open/)).toBeNull();
  });

  it('is slow, not blocked, when the check itself fails', async () => {
    answers.vault = new Error('offline');
    render(<Harness tabs={[vault]} active="vault" />);
    await advance(8000);
    expect(screen.getByRole('heading', { name: 'Vaultwarden is slow to load' })).toBeInTheDocument();
  });
});

describe('a blocked app', () => {
  it('says it won\'t open here, and offers "Open in new tab" and "How to allow embedding"', async () => {
    answers.vault = { url: vault.url, verdict: 'blocked', header: 'X-Frame-Options: SAMEORIGIN' };
    render(<Harness tabs={[vault]} active="vault" />);
    await advance(0);
    // A blocked frame still fires load in Chromium: that is not "shown".
    fireEvent.load(frameOf(vault));

    expect(
      screen.getByRole('heading', { name: "Vaultwarden won't open inside JagHelm" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Open it in a new tab, or allow JagHelm's address in that app's proxy or embedding settings."
      )
    ).toBeInTheDocument();
    const open = screen.getByRole('link', { name: 'Open in new tab' });
    expect(open).toHaveAttribute('href', vault.url);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open.getAttribute('rel')).toContain('noopener');
    expect(frameOf(vault)).not.toBeVisible();
    expect(screen.queryByText(/slow to load/)).toBeNull();

    const how = screen.getByRole('button', { name: 'How to allow embedding' });
    expect(how).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/X-Frame-Options: SAMEORIGIN/)).toBeNull();
    fireEvent.click(how);
    expect(how).toHaveAttribute('aria-expanded', 'true');
    const help = document.getElementById(how.getAttribute('aria-controls'));
    expect(help).toHaveTextContent('X-Frame-Options: SAMEORIGIN');
    expect(help).toHaveTextContent(`frame-ancestors 'self' ${window.location.origin}`);
    expect(help).not.toHaveTextContent('UPTIME_KUMA_DISABLE_FRAME_SAMEORIGIN');
  });

  it('turns a slow notice into the blocked one when the check answers late', async () => {
    let answer;
    answers.vault = new Promise((r) => (answer = r));
    render(<Harness tabs={[vault]} active="vault" />);
    await advance(8000);
    expect(screen.getByRole('heading', { name: 'Vaultwarden is slow to load' })).toBeInTheDocument();
    answer({ url: vault.url, verdict: 'blocked', header: "Content-Security-Policy: frame-ancestors 'none'" });
    await advance(0);
    expect(screen.queryByText(/slow to load/)).toBeNull();
    expect(screen.getByRole('heading', { name: "Vaultwarden won't open inside JagHelm" })).toBeInTheDocument();
  });

  it('keeps the Uptime Kuma hint in the how-to', async () => {
    answers.kuma = { url: kuma.url, verdict: 'blocked', header: 'X-Frame-Options: SAMEORIGIN' };
    render(<Harness tabs={[kuma]} active="kuma" />);
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'How to allow embedding' }));
    expect(screen.getByText(/UPTIME_KUMA_DISABLE_FRAME_SAMEORIGIN=true/)).toBeInTheDocument();
  });

  it('ignores an answer for another URL (an edit not saved yet)', async () => {
    answers.vault = { url: 'https://old-vault.example/', verdict: 'blocked', header: 'X-Frame-Options: DENY' };
    render(<Harness tabs={[vault]} active="vault" />);
    await advance(0);
    fireEvent.load(frameOf(vault));
    expect(screen.queryByText(/won't open/)).toBeNull();
    expect(frameOf(vault)).toBeVisible();
  });

  it('asks about the tab by id and the page origin, never by URL', async () => {
    render(<Harness tabs={[vault]} active="vault" />);
    await advance(0);
    expect(checks).toHaveLength(1);
    expect(checks[0].id).toBe('vault');
    expect(checks[0].query.get('origin')).toBe(window.location.origin);
    expect([...checks[0].query.keys()]).toEqual(['origin']);
  });
});

describe('frames stay loaded', () => {
  it('hides an app it switches away from, keeping the same frame', async () => {
    const { rerender } = render(<Harness tabs={[vault, kuma]} active="vault" />);
    await advance(0);
    const v = frameOf(vault);
    fireEvent.load(v);
    rerender(<Harness tabs={[vault, kuma]} active="kuma" />);
    await advance(0);
    expect(frameOf(vault)).toBe(v);
    expect(v).not.toBeVisible();
    expect(v.closest('[aria-hidden="true"]')).not.toBeNull();
    rerender(<Harness tabs={[vault, kuma]} active="vault" />);
    expect(frameOf(vault)).toBe(v);
    expect(v).toBeVisible();
    // Coming back is not a new visit: no new check, no loading notice.
    expect(checks.filter((c) => c.id === 'vault')).toHaveLength(1);
    expect(screen.queryByText('Loading Vaultwarden…')).toBeNull();
  });

  it('unmounts the frame of a tab removed from the config', async () => {
    const { rerender } = render(<Harness tabs={[vault, kuma]} active="vault" />);
    rerender(<Harness tabs={[vault, kuma]} active="kuma" />);
    await advance(0);
    expect(frameOf(vault)).not.toBeNull();
    rerender(<Harness tabs={[kuma]} active="kuma" />);
    expect(frameOf(vault)).toBeNull();
    expect(frameOf(kuma)).not.toBeNull();
  });

  it('Retry reloads only that frame and checks its headers afresh', async () => {
    answers.vault = { url: vault.url, verdict: 'unknown', reason: 'timed out' };
    answers.kuma = { url: kuma.url, verdict: 'unknown', reason: 'timed out' };
    const { rerender } = render(<Harness tabs={[vault, kuma]} active="vault" />);
    rerender(<Harness tabs={[vault, kuma]} active="kuma" />);
    await advance(8000);
    const v = frameOf(vault);
    const k = frameOf(kuma);

    // Only the shown app's Retry is reachable; the hidden one's is aria-hidden.
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await advance(0);

    expect(frameOf(vault)).toBe(v);
    expect(frameOf(kuma)).not.toBe(k);
    expect(frameOf(kuma)).not.toBeNull();
    expect(screen.getByText('Loading Uptime Kuma…')).toBeInTheDocument();
    const kumaChecks = checks.filter((c) => c.id === 'kuma');
    expect(kumaChecks).toHaveLength(2);
    expect(kumaChecks[1].query.get('fresh')).toBe('1');
    expect(checks.filter((c) => c.id === 'vault')).toHaveLength(1);
  });

  it('a blocked app\'s "Check again" in the how-to retries it', async () => {
    answers.vault = { url: vault.url, verdict: 'blocked', header: 'X-Frame-Options: DENY' };
    render(<Harness tabs={[vault]} active="vault" />);
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'How to allow embedding' }));
    answers.vault = { url: vault.url, verdict: 'allowed' };
    const before = frameOf(vault);
    const help = document.getElementById(
      screen.getByRole('button', { name: 'How to allow embedding' }).getAttribute('aria-controls')
    );
    fireEvent.click(within(help).getByRole('button', { name: 'Check again' }));
    await advance(0);
    expect(frameOf(vault)).not.toBe(before);
    fireEvent.load(frameOf(vault));
    expect(screen.queryByText(/won't open/)).toBeNull();
    expect(frameOf(vault)).toBeVisible();
  });
});
