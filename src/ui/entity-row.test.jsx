import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { EntityRow } from '@ui/entity-row';
import { UptimeBar } from '@ui/uptime-bar';

// Vitest runs from the repository's root.
const tokens = readFileSync('src/ui/tokens.css', 'utf8');
const NO_RING = /(^|\s|:)outline-(none|hidden|0)(\s|$)/;
const ups = (n) => Array.from({ length: n }, () => 'ok');

// The mock's Immich and Nginx Proxy Manager rows.
const IMMICH = {
  state: 'crit',
  word: 'Down',
  name: 'Immich',
  detail: 'Kuma: HTTP 502 for 4 min',
  meta: '—',
};
const NPM = {
  state: 'ok',
  word: 'Up',
  name: 'Nginx Proxy Manager',
  detail: '31 proxy hosts',
  meta: '14 ms',
};

const part = (row, slot) => row.querySelector(`[data-slot="entity-${slot}"]`);
const classes = (el) => el.className.split(/\s+/);

describe('EntityRow', () => {
  it('is a button named "name, word", described by its detail, meta and trailing summary', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <EntityRow
        {...IMMICH}
        trailing={<UptimeBar beats={[...ups(25), 'crit', 'crit', 'crit', 'crit', 'crit']} />}
        onOpen={onOpen}
      />
    );
    const row = screen.getByRole('button', { name: 'Immich, Down' });
    expect(row).toHaveAttribute('type', 'button');
    expect(row).toHaveAccessibleDescription(
      'Kuma: HTTP 502 for 4 min Heartbeats: 5 failures in the last 30 checks, including the latest'
    );
    // The dash stays on screen; it says nothing, so it is no part of the description.
    expect(screen.getByText('—')).toBeInTheDocument();
    await user.click(row);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith();
  });

  it("draws the mock's service row: lamp, name, detail in its state's colour, meta, chevron", () => {
    render(<EntityRow {...IMMICH} onOpen={() => {}} />);
    const row = screen.getByRole('button');
    // The lamp at the start of its column (12px narrow, 16px wide), as the mock's.
    const column = row.querySelector('[data-slot="status-lamp"]').parentElement;
    expect(column).toHaveClass('flex', 'w-3', '@2xl:w-4');
    expect(column.className).not.toMatch(/justify-/);
    expect(row).toHaveAttribute('data-slot', 'entity-row');
    expect(row).toHaveAttribute('data-state', 'crit');
    // The name says the state, so the lamp is its shape only.
    const lamp = row.querySelector('[data-slot="status-lamp"]');
    expect(lamp).toHaveAttribute('data-shape', 'bar');
    expect(lamp).toHaveAttribute('aria-hidden', 'true');
    expect(part(row, 'name')).toHaveClass('font-semibold', 'text-text-1');
    expect(part(row, 'detail')).toHaveClass('text-crit-fg');
    expect(part(row, 'meta')).toHaveClass('text-caption', 'text-text-3', 'text-right', 'max-w-16');
    expect(row.querySelector('svg.lucide')).toHaveAttribute('aria-hidden', 'true');
    expect(row.className).not.toMatch(NO_RING);
  });

  it('tints a critical row from 672px, as the Overview board, and shows the hover with the tint', () => {
    const { rerender } = render(<EntityRow {...IMMICH} onOpen={() => {}} />);
    const row = screen.getByRole('button');
    // The tint on the row's grid (container queries style what is inside the
    // container), the hover on the row behind it: both translucent, so both show.
    expect(part(row, 'grid')).toHaveClass('@2xl:bg-crit-tint');
    expect(row).toHaveClass('hover:bg-row-hover');
    rerender(<EntityRow {...NPM} onOpen={() => {}} />);
    expect(part(screen.getByRole('button'), 'grid').className).not.toMatch(/-tint(\s|$)/);
  });

  it('prints a healthy detail in text-1 and every other state in its word colour', () => {
    const cases = {
      ok: 'text-text-1',
      warn: 'text-warn-fg',
      crit: 'text-crit-fg',
      unknown: 'text-unknown-fg',
      maintenance: 'text-maintenance-fg',
    };
    for (const [state, colour] of Object.entries(cases)) {
      const { container, unmount } = render(<EntityRow {...NPM} state={state} />);
      expect(part(container.firstChild, 'detail'), state).toHaveClass(colour);
      unmount();
    }
  });

  it('is as tall as the density: h-row (40px, 32 compact) wide, 12px more on a phone', () => {
    render(<EntityRow {...NPM} onOpen={() => {}} />);
    const grid = part(screen.getByRole('button'), 'grid');
    expect(grid).toHaveClass(
      'min-h-[calc(var(--jh-row-h)+12px)]',
      '@2xl:min-h-row',
      '@2xl:px-panel'
    );
    expect(tokens).toMatch(/\.jh-ui \{[^}]*--jh-row-h: 40px;/);
    expect(tokens).toMatch(/\.jh-ui\[data-density='compact'\] \{[^}]*--jh-row-h: 32px;/);
  });

  describe('truncation order (the card: the name is never truncated before the secondary content)', () => {
    // jsdom lays nothing out, so these read the flex settings a browser
    // applies; the PR measures the same rows in Chromium at 320 to 820px.
    it('the detail takes none of the name’s room: no width of its own, it fills what is left', () => {
      render(<EntityRow {...NPM} meta="14 ms" trailing={<UptimeBar beats={ups(30)} />} />);
      const row = document.querySelector('[data-slot="entity-row"]');
      // The name's column starts at the name's own width (flex: 1 1 auto)...
      expect(part(row, 'main')).toHaveClass('flex-auto', 'min-w-0');
      // ...to which the detail adds nothing (width 0): it fills the column on
      // a phone (min-width 100 %) and, wide, grows into what the name leaves.
      const detail = part(row, 'detail');
      expect(detail).toHaveClass('w-0', 'min-w-full', '@2xl:min-w-0', '@2xl:flex-1', 'truncate');
      const name = part(row, 'name');
      expect(name).toHaveClass('truncate');
      expect(classes(name).some((c) => /(^|:)(flex-1|grow|basis-0|w-0)$/.test(c))).toBe(false);
      // Wide, the name keeps at least the mock's column, so details line up.
      expect(part(row, 'main')).toHaveClass('@2xl:flex-row');
      expect(name).toHaveClass('@2xl:min-w-[calc(42.857%-6px)]');
    });

    it('the meta and the trailing figure grow into what the name leaves, never into the name', () => {
      render(
        <EntityRow
          {...NPM}
          meta="14 ms"
          trailing={<UptimeBar beats={ups(30)} />}
          onOpen={() => {}}
        />
      );
      const row = screen.getByRole('button');
      // They start from nothing (basis 0), so they never take from the name's
      // starting width, and grow (a thousand times the name's share) up to
      // their own width: the meta's 64px, the strip's beats. The strip,
      // short of room, keeps its newest beats on the right.
      for (const slot of ['meta', 'trailing']) {
        expect(part(row, slot), slot).toHaveClass('basis-0', 'grow-1000', 'min-w-0');
      }
      expect(part(row, 'meta')).toHaveClass('max-w-16', 'truncate');
      expect(part(row, 'trailing')).toHaveClass('max-w-max', 'overflow-hidden', 'justify-end');
      // The lamp and the chevron keep their size.
      expect(row.querySelector('svg.lucide')).toHaveClass('shrink-0');
    });

    it('narrow: the name has its own line over the detail; no meta, no chevron', () => {
      render(<EntityRow {...NPM} trailing={<UptimeBar beats={ups(12)} />} onOpen={() => {}} />);
      const row = document.querySelector('[data-slot="entity-row"]');
      expect(part(row, 'main')).toHaveClass('flex-col');
      expect(part(row, 'name')).toHaveClass('truncate', 'block');
      expect(part(row, 'detail')).toHaveClass('truncate', 'text-caption', '@2xl:text-body-sm');
      // The mock's 20px lines: a 56px row on a phone, as the Phone board's.
      expect(part(row, 'detail')).toHaveClass('leading-5', '@2xl:leading-5');
      expect(part(row, 'meta')).toHaveClass('hidden', '@2xl:block');
      expect(row.querySelector('svg.lucide')).toHaveClass('hidden', '@2xl:block');
    });

    it("narrow: a heartbeat strip shows its newest 12, as the Phone board's, so the detail keeps its room", () => {
      render(<EntityRow {...IMMICH} trailing={<UptimeBar beats={ups(30)} />} onOpen={() => {}} />);
      const trailing = part(screen.getByRole('button'), 'trailing');
      // Below 672px every beat but the last 12 is hidden; the strip's name
      // still sums up all 30. Chromium: at 358px, 30 beats leave "Kuma: HTTP
      // 502 for 4 min" whole (the PR's measurements).
      expect(trailing).toHaveClass('@max-2xl:[&_[data-slot=beat]:nth-last-child(n+13)]:hidden');
      const beats = trailing.querySelectorAll('[data-slot="beat"]');
      expect(beats).toHaveLength(30);
      expect(beats[0].parentElement.lastElementChild).toBe(beats[29]);
    });
  });

  it('is a link with an href', () => {
    render(<EntityRow {...NPM} href="/services/npm" />);
    expect(screen.getByRole('link', { name: 'Nginx Proxy Manager, Up' })).toHaveAttribute(
      'href',
      '/services/npm'
    );
  });

  it("a link's onOpen opens it in the page on a plain click; a modified or middle click is the browser's (#309)", () => {
    const onOpen = vi.fn();
    render(<EntityRow {...NPM} href="/?entity=services/edge:npm" onOpen={onOpen} />);
    const row = screen.getByRole('link', { name: 'Nginx Proxy Manager, Up' });
    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      expect(fireEvent.click(row, init), JSON.stringify(init)).toBe(true);
    }
    expect(onOpen).not.toHaveBeenCalled();
    expect(fireEvent.click(row), 'a plain click is the page’s').toBe(false);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith();
  });

  it('is plain content with nothing to open: no button, the lamp named, no chevron', () => {
    const { container } = render(<EntityRow {...IMMICH} />);
    expect(screen.queryByRole('button')).toBeNull();
    const row = container.firstChild;
    expect(row.tagName).toBe('DIV');
    expect(row).not.toHaveAttribute('aria-label');
    expect(screen.getByRole('img', { name: 'Down' })).toHaveAttribute('data-slot', 'status-lamp');
    expect(row.querySelector('svg.lucide')).toBeNull();
    expect(row.className).not.toMatch(/hover:/);
  });

  it("reads its state's word without one, and leaves out parts it isn't given", () => {
    const { container } = render(<EntityRow state="unknown" name="Wiki.js" onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'Wiki.js, No signal' })).toBeInTheDocument();
    for (const slot of ['detail', 'meta', 'trailing']) {
      expect(part(container.firstChild, slot)).toBeNull();
    }
  });

  // #480: under a stale status a row keeps the word it last had ("Up"), and
  // its lamp is what is known now.
  it('names a lamp drawn as no signal "No signal", never by the last known word (#300)', () => {
    const { unmount } = render(
      <EntityRow state="unknown" word="Up" name="Immich" detail="3 users" />
    );
    expect(screen.getByRole('img', { name: 'No signal' })).toHaveAttribute('data-state', 'unknown');
    unmount();
    render(<EntityRow state="unknown" word="Down" name="Immich" onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'Immich, No signal' })).toBeInTheDocument();
  });

  it('muted (#300): a healthy row says its detail in text-2; any other state keeps its colour', () => {
    const { container, rerender } = render(<EntityRow {...NPM} muted />);
    const row = () => container.firstChild;
    expect(row()).toHaveAttribute('data-muted', '');
    expect(part(row(), 'detail')).toHaveClass('text-text-2');
    expect(part(row(), 'detail')).not.toHaveClass('text-text-1');
    expect(part(row(), 'name')).toHaveClass('font-semibold', 'text-text-1');
    rerender(<EntityRow {...IMMICH} muted />);
    expect(row()).not.toHaveAttribute('data-muted');
    expect(part(row(), 'detail')).toHaveClass('text-crit-fg');
    expect(part(row(), 'grid')).toHaveClass('@2xl:bg-crit-tint');
    rerender(<EntityRow {...NPM} />);
    expect(row()).not.toHaveAttribute('data-muted');
    expect(part(row(), 'detail')).toHaveClass('text-text-1');
  });

  it('where (#300): the node after the name, in mono text-3, giving way before the name', () => {
    const { container } = render(<EntityRow {...NPM} where="Network Edge" onOpen={() => {}} />);
    const row = container.firstChild;
    const heading = part(row, 'heading');
    expect(heading).toHaveClass('flex', 'min-w-0', '@2xl:min-w-[calc(42.857%-6px)]', '@2xl:shrink');
    expect(part(row, 'name')).toHaveTextContent('Nginx Proxy Manager');
    expect(part(row, 'name')).toHaveClass('truncate', 'font-semibold', 'min-w-0');
    const where = part(row, 'where');
    expect(where).toHaveTextContent('Network Edge');
    expect(where).toHaveClass(
      'font-mono',
      'text-caption',
      'text-text-3',
      'truncate',
      'shrink-1000'
    );
    expect(heading).toContainElement(where);
    // Said too, when the row opens: its name says only the name and word.
    expect(
      screen.getByRole('button', { name: 'Nginx Proxy Manager, Up' })
    ).toHaveAccessibleDescription('Network Edge 31 proxy hosts 14 ms');
  });

  it('without where, the name is the column itself, as before', () => {
    const { container } = render(<EntityRow {...NPM} />);
    expect(part(container.firstChild, 'heading')).toBeNull();
    expect(part(container.firstChild, 'name')).toHaveClass('@2xl:min-w-[calc(42.857%-6px)]');
  });

  // #300 review: the Phone board's row says "metric · latency" under the name.
  it('narrow: the meta follows the detail on its line ("31 proxy hosts · 14 ms"), never said twice', () => {
    const { container } = render(<EntityRow {...NPM} onOpen={() => {}} />);
    const detail = part(container.firstChild, 'detail');
    expect(detail).toHaveClass('flex', '@2xl:block', 'truncate');
    expect(detail).toHaveTextContent('31 proxy hosts · 14 ms');
    const copy = detail.querySelector('[data-slot="entity-detail-meta"]');
    expect(copy).toHaveAttribute('aria-hidden', 'true');
    expect(copy).toHaveClass('shrink-0', '@2xl:hidden');
    expect(detail.querySelector('[data-slot="entity-detail-text"]')).toHaveClass(
      'min-w-0',
      'truncate'
    );
    // Described once: the meta's own element says it.
    expect(screen.getByRole('button')).toHaveAccessibleDescription('31 proxy hosts 14 ms');
  });

  it('narrow: a meta with no detail has the line to itself; a dash, none', () => {
    const { container, rerender } = render(<EntityRow {...NPM} detail={undefined} />);
    const line = () => part(container.firstChild, 'detail');
    expect(line()).toHaveTextContent(/^14 ms$/);
    expect(line()).toHaveClass('@2xl:hidden');
    rerender(<EntityRow {...IMMICH} />);
    expect(line()).toHaveTextContent(/^Kuma: HTTP 502 for 4 min$/);
    expect(line().querySelector('[data-slot="entity-detail-meta"]')).toBeNull();
    rerender(<EntityRow {...IMMICH} detail={undefined} />);
    expect(line()).toBeNull();
  });

  it('passes className and other props to the row', () => {
    render(<EntityRow {...NPM} className="border-b" data-testid="npm" />);
    expect(screen.getByTestId('npm')).toHaveClass('border-b', '@container');
  });
});
