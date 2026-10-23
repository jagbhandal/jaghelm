import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { IssueRow } from '@ui/issue-row';

const NO_RING = /(^|\s|:)outline-(none|hidden|0)(\s|$)/;

// The mock's first issue.
const immich = {
  id: 'immich',
  state: 'crit',
  word: 'Down',
  title: 'Immich',
  where: 'Service · Production (vm-103)',
  reason: 'Kuma: HTTP 502 for 4 min',
  age: '4 m',
};

describe('IssueRow', () => {
  it('is a button named title, word, where and described by its reason and age', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<IssueRow issue={immich} onOpen={onOpen} />);
    const row = screen.getByRole('button', {
      name: 'Immich, Down, Service · Production (vm-103)',
    });
    expect(row).toHaveAccessibleDescription('Kuma: HTTP 502 for 4 min 4 m');
    expect(row).toHaveAttribute('type', 'button');
    await user.click(row);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith();
  });

  it("shows the mock's row: the word in its colour, what, where, why and since when", () => {
    render(<IssueRow issue={immich} onOpen={() => {}} />);
    const row = screen.getByRole('button');
    expect(row).toHaveAttribute('data-slot', 'issue-row');
    expect(row).toHaveAttribute('data-state', 'crit');
    expect(screen.getByText('Down')).toHaveClass('font-bold', 'text-crit-fg');
    for (const text of [
      'Immich',
      'Service · Production (vm-103)',
      'Kuma: HTTP 502 for 4 min',
      '4 m',
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    // The lamp adds the shape; the word beside it names the status.
    const lamp = row.querySelector('[data-slot="status-lamp"]');
    expect(lamp).toHaveAttribute('data-shape', 'bar');
    expect(lamp).toHaveAttribute('aria-hidden', 'true');
    expect(row).toHaveClass('hover:bg-row-hover', '@container');
    expect(row.className).not.toMatch(NO_RING);
    // The chevron says it opens something.
    expect(row.querySelector('svg.lucide')).toHaveAttribute('aria-hidden', 'true');
  });

  it('lays out as the phone row below 672px and the desktop columns from there', () => {
    render(<IssueRow issue={immich} onOpen={() => {}} />);
    const grid = screen.getByRole('button').firstElementChild;
    expect(grid).toHaveClass('grid-cols-[12px_minmax(0,1fr)_auto]', 'min-h-14');
    expect(grid.className).toContain(
      '@2xl:grid-cols-[18px_96px_minmax(140px,1.1fr)_minmax(200px,2fr)_44px_16px]'
    );
    expect(grid).toHaveClass('@2xl:min-h-12', '@2xl:px-panel');
    // Where shows on the desktop row only, as the mock's phone row leaves it out.
    expect(screen.getByText('Service · Production (vm-103)')).toHaveClass('hidden', '@2xl:block');
  });

  it('is a link with an href', () => {
    render(<IssueRow issue={immich} href="/services/immich" />);
    const row = screen.getByRole('link', { name: 'Immich, Down, Service · Production (vm-103)' });
    expect(row).toHaveAttribute('href', '/services/immich');
  });

  it("a link's onOpen opens it in the page on a plain click; a modified or middle click is the browser's", () => {
    const onOpen = vi.fn();
    render(<IssueRow issue={immich} href="/?entity=services/vm-103:immich" onOpen={onOpen} />);
    const row = screen.getByRole('link');
    const modified = {
      Ctrl: { ctrlKey: true },
      Meta: { metaKey: true },
      Shift: { shiftKey: true },
      Alt: { altKey: true },
      'the middle button': { button: 1 },
    };
    // fireEvent.click is false when a handler cancelled the click (#515).
    for (const [name, init] of Object.entries(modified)) {
      expect(fireEvent.click(row, init), `${name}: not cancelled`).toBe(true);
      expect(onOpen, `${name}: not the page's`).not.toHaveBeenCalled();
    }
    // The page opens it itself (#309): the browser doesn't load the link.
    expect(fireEvent.click(row), 'a plain click is the page’s').toBe(false);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith();
  });

  it('is plain content with nothing to open: no button, no name, no chevron (#279)', () => {
    const { container } = render(<IssueRow issue={immich} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    const row = container.firstChild;
    expect(row.tagName).toBe('DIV');
    expect(row).not.toHaveAttribute('aria-label');
    expect(row).not.toHaveClass('hover:bg-row-hover');
    expect(row.querySelector('svg.lucide')).toBeNull();
    expect(screen.getByText('Immich')).toBeInTheDocument();
  });

  it("reads its state's word without one, and spells an abbreviation out", () => {
    const { rerender } = render(
      <IssueRow issue={{ state: 'unknown', title: 'Wiki.js' }} onOpen={() => {}} />
    );
    expect(screen.getByRole('button', { name: 'Wiki.js, No signal' })).toBeInTheDocument();
    rerender(
      <IssueRow issue={{ state: 'unknown', word: 'UNKN', title: 'Wiki.js' }} onOpen={() => {}} />
    );
    expect(screen.getByRole('button', { name: 'Wiki.js, unknown' })).toBeInTheDocument();
    expect(screen.getByText('UNKN')).toBeInTheDocument();
  });

  // #480: a stale status keeps its rows' words, drawn as no signal.
  it('no signal beside a last known word: the lamp is named No signal, and so is the row first', () => {
    const stale = { ...immich, state: 'unknown' };
    const { rerender } = render(<IssueRow issue={stale} />);
    expect(screen.getByRole('img', { name: 'No signal' })).toBeInTheDocument();
    expect(screen.getByText('Down')).toBeInTheDocument();
    rerender(<IssueRow issue={stale} onOpen={() => {}} />);
    expect(
      screen.getByRole('button', {
        name: 'Immich, No signal, Down, Service · Production (vm-103)',
      })
    ).toBeInTheDocument();
  });
});
