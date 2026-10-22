import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import HelmGrid, { HEIGHTS_PREF, RESERVE_MS } from './HelmGrid.jsx';
import { calcCellWidth } from './gridMath.js';

// HelmGrid's layout from the first frame (#243): one column in the page's
// flow, and, wider, each panel starting at the height it last measured.

const MARGIN = [16, 16];
const ROW = 36;

const item = (i, x, y, w, h) => ({ i, x, y, w, h, minW: 2, minH: 2 });
// Two panels side by side, a third under them, in the desktop's 24 columns.
const LAYOUTS = {
  lg: [item('right', 12, 0, 12, 3), item('left', 0, 0, 12, 3), item('under', 0, 3, 24, 4)],
};

const Board = ({ fixed = false }) => (
  <HelmGrid layouts={LAYOUTS} rowHeight={ROW} margin={MARGIN} draggable={!fixed} resizable={!fixed}>
    {['left', 'right', 'under'].map((id) => (
      <div key={id}>
        <div className="glass-card">
          <div className="section-header">
            <span className="section-title">{id}</span>
          </div>
        </div>
      </div>
    ))}
  </HelmGrid>
);

const items = (container) => [...container.querySelectorAll('.helmgrid-item')];
const title = (el) => el.querySelector('.section-title').textContent;

// The window's width: jsdom has no layout, so every element is this wide.
const atWidth = (px) => vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(px);

// A panel `w` columns wide at 1440px, in pixels, as HelmGrid draws it.
const widthAt1440 = (w) => {
  const cell = calcCellWidth(1440, 24, MARGIN);
  return Math.round(w * (cell + MARGIN[0]) - MARGIN[0]);
};
const rowsPx = (px) => {
  const rows = Math.ceil((px + MARGIN[1]) / (ROW + MARGIN[1]));
  return rows * (ROW + MARGIN[1]) - MARGIN[1];
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HelmGrid in one column (sm), fixed in place', () => {
  it("draws the panels in the page's flow, top to bottom, each at its own height", () => {
    atWidth(390);
    const { container } = render(<Board fixed />);
    const board = container.querySelector('.helmgrid');
    expect(board).toHaveClass('helmgrid-flow');
    expect(board.style.position).toBe('');
    expect(board.style.height).toBe('');
    // The layout's order: by row, then by column.
    expect(items(container).map(title)).toEqual(['left', 'right', 'under']);
    for (const el of items(container)) {
      expect(el.style.position).toBe('');
      expect(el.style.height).toBe('');
      expect(el.style.top).toBe('');
    }
  });

  it('has no handles', () => {
    atWidth(390);
    const { container } = render(<Board fixed />);
    expect(container.querySelector('.helmgrid-move-handle')).toBeNull();
    expect(container.querySelector('.helmgrid-resize-handle')).toBeNull();
  });

  it('measures nothing', () => {
    atWidth(390);
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get');
    vi.stubGlobal('requestAnimationFrame', (fn) => {
      fn();
      return 1;
    });
    render(<Board fixed />);
    expect(scrollHeight).not.toHaveBeenCalled();
  });

  it('one column that can be dragged stays the grid it was, its panels placed', () => {
    atWidth(390);
    const { container } = render(<Board />);
    expect(container.querySelector('.helmgrid')).not.toHaveClass('helmgrid-flow');
    for (const el of items(container)) expect(el.style.position).toBe('absolute');
    expect(container.querySelector('.helmgrid-move-handle')).not.toBeNull();
  });

  it('keeps every panel mounted from one to the other', () => {
    atWidth(390);
    const { container, rerender } = render(<Board />);
    const before = items(container).map((el) => el.querySelector('.glass-card'));
    rerender(<Board fixed />);
    expect(container.querySelector('.helmgrid')).toHaveClass('helmgrid-flow');
    const after = items(container).map((el) => el.querySelector('.glass-card'));
    expect(new Set(after)).toEqual(new Set(before));
  });
});

describe('HelmGrid wider: the height a panel last measured', () => {
  // GridItem measures at once (requestAnimationFrame), each panel's content
  // `natural[id]` px tall.
  const measuring = (natural) => {
    vi.stubGlobal('requestAnimationFrame', (fn) => {
      fn();
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function () {
      const id = this.querySelector?.('.section-title')?.textContent;
      return natural[id] ?? 0;
    });
  };
  const box = (container, id) => items(container).find((el) => title(el) === id).style;

  it('starts a panel at the height it last measured at that width, before it measures', () => {
    atWidth(1440);
    localStorage.setItem(HEIGHTS_PREF, JSON.stringify({ left: [widthAt1440(12), 500] }));
    const { container } = render(<Board />);
    expect(box(container, 'left').height).toBe(`${rowsPx(500)}px`);
    // The panel under it starts under that height, not under the 3 saved rows.
    expect(parseFloat(box(container, 'under').top)).toBeGreaterThanOrEqual(rowsPx(500) + 16);
    // Its neighbour has no height kept: its saved 3 rows.
    expect(box(container, 'right').height).toBe(`${3 * (ROW + 16) - 16}px`);
  });

  it('a height kept at another width is not used', () => {
    atWidth(1440);
    localStorage.setItem(HEIGHTS_PREF, JSON.stringify({ left: [widthAt1440(12) + 40, 500] }));
    const { container } = render(<Board />);
    expect(box(container, 'left').height).toBe(`${3 * (ROW + 16) - 16}px`);
  });

  it('keeps each height it measures, with the width it measured at', async () => {
    atWidth(1440);
    measuring({ left: 420, right: 120, under: 300 });
    render(<Board />);
    await act(async () => {});
    expect(JSON.parse(localStorage.getItem(HEIGHTS_PREF))).toEqual({
      left: [widthAt1440(12), 420],
      right: [widthAt1440(12), 120],
      under: [widthAt1440(24), 300],
    });
  });

  it('keeps the room while the content comes in, then takes its own height', async () => {
    vi.useFakeTimers();
    atWidth(1440);
    localStorage.setItem(HEIGHTS_PREF, JSON.stringify({ left: [widthAt1440(12), 500] }));
    // Its content, so far, is a placeholder 200px tall.
    measuring({ left: 200 });
    const { container } = render(<Board />);
    await act(async () => {});
    expect(box(container, 'left').height).toBe(`${rowsPx(500)}px`);

    await act(async () => {
      vi.advanceTimersByTime(RESERVE_MS);
    });
    expect(box(container, 'left').height).toBe(`${rowsPx(200)}px`);
  });

  it('a panel whose content fills the room it kept grows with it', async () => {
    atWidth(1440);
    localStorage.setItem(HEIGHTS_PREF, JSON.stringify({ left: [widthAt1440(12), 500] }));
    measuring({ left: 640 });
    const { container } = render(<Board />);
    await act(async () => {});
    expect(box(container, 'left').height).toBe(`${rowsPx(640)}px`);
  });

  it('a stored value that is not a list of heights is ignored', () => {
    atWidth(1440);
    localStorage.setItem(HEIGHTS_PREF, '[1, 2]');
    const { container } = render(<Board />);
    expect(box(container, 'left').height).toBe(`${3 * (ROW + 16) - 16}px`);
  });
});
