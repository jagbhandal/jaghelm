import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import HelmGrid, { HEIGHTS_PREF } from './HelmGrid.jsx';
import { calcCellWidth } from './gridMath.js';

// HelmGrid's layout from the first frame (#243): one column in the page's
// flow, and, wider, each panel at the height it last measured while the
// board's data comes in (`reserve`).

const MARGIN = [16, 16];
const ROW = 36;

const item = (i, x, y, w, h) => ({ i, x, y, w, h, minW: 2, minH: 2 });
// Two panels side by side, a third under them, in the desktop's 24 columns.
const LAYOUTS = {
  lg: [item('right', 12, 0, 12, 3), item('left', 0, 0, 12, 3), item('under', 0, 3, 24, 4)],
};

const Board = ({ fixed = false, reserve = false }) => (
  <HelmGrid
    layouts={LAYOUTS}
    rowHeight={ROW}
    margin={MARGIN}
    draggable={!fixed}
    resizable={!fixed}
    reserve={reserve}
  >
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

  it('while the data comes in, a panel starts at the height it last measured at that width', () => {
    atWidth(1440);
    localStorage.setItem(HEIGHTS_PREF, JSON.stringify({ left: [widthAt1440(12), 500] }));
    const { container } = render(<Board reserve />);
    expect(box(container, 'left').height).toBe(`${rowsPx(500)}px`);
    // The panel under it starts under that height, not under the 3 saved rows.
    expect(parseFloat(box(container, 'under').top)).toBeGreaterThanOrEqual(rowsPx(500) + 16);
    // Its neighbour has no height kept: its saved 3 rows.
    expect(box(container, 'right').height).toBe(`${3 * (ROW + 16) - 16}px`);
  });

  it('a height kept at another width is not used', () => {
    atWidth(1440);
    localStorage.setItem(HEIGHTS_PREF, JSON.stringify({ left: [widthAt1440(12) + 40, 500] }));
    const { container } = render(<Board reserve />);
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

  it('keeps the room until the data is in, then takes its own height in one step', async () => {
    atWidth(1440);
    const stored = JSON.stringify({ left: [widthAt1440(12), 500] });
    localStorage.setItem(HEIGHTS_PREF, stored);
    // Its content, so far, is a placeholder 200px tall.
    measuring({ left: 200, right: 120, under: 300 });
    const { container, rerender } = render(<Board reserve />);
    await act(async () => {});
    // However long the data takes: no time limit.
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(box(container, 'left').height).toBe(`${rowsPx(500)}px`);
    // A placeholder's height is never kept.
    expect(localStorage.getItem(HEIGHTS_PREF)).toBe(stored);

    rerender(<Board />);
    await act(async () => {});
    expect(box(container, 'left').height).toBe(`${rowsPx(200)}px`);
    // The data in, the heights measured are kept.
    expect(JSON.parse(localStorage.getItem(HEIGHTS_PREF))).toEqual({
      left: [widthAt1440(12), 200],
      right: [widthAt1440(12), 120],
      under: [widthAt1440(24), 300],
    });
  });

  it('with the data in, a kept height is not used', () => {
    atWidth(1440);
    localStorage.setItem(HEIGHTS_PREF, JSON.stringify({ left: [widthAt1440(12), 500] }));
    const { container } = render(<Board />);
    expect(box(container, 'left').height).toBe(`${3 * (ROW + 16) - 16}px`);
  });

  it('a panel whose content fills the room it kept grows with it', async () => {
    atWidth(1440);
    localStorage.setItem(HEIGHTS_PREF, JSON.stringify({ left: [widthAt1440(12), 500] }));
    measuring({ left: 640 });
    const { container } = render(<Board reserve />);
    await act(async () => {});
    expect(box(container, 'left').height).toBe(`${rowsPx(640)}px`);
  });

  it('a stored value that is not a list of heights is ignored', () => {
    atWidth(1440);
    localStorage.setItem(HEIGHTS_PREF, '[1, 2]');
    const { container } = render(<Board reserve />);
    expect(box(container, 'left').height).toBe(`${3 * (ROW + 16) - 16}px`);
  });
});

// A panel placed on the grid, or drawn at a new width, takes its content's
// height in the frame that draws it, with no frame in between (#561): the
// first frame of a phone turned tablet drew every panel at its saved rows,
// and a narrower window each at the height of its wider content, cutting it.
describe('HelmGrid: the first frame at a new width has each panel at its content', () => {
  // No frame comes; each panel's content is `natural[id]` px tall.
  const content = (natural) => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function () {
      const id = this.querySelector?.('.section-title')?.textContent;
      return natural[id] ?? 0;
    });
  };
  const box = (container, id) => items(container).find((el) => title(el) === id).style;

  it("from the page's flow to the grid (a phone turned tablet)", () => {
    atWidth(500);
    content({ left: 420, right: 220, under: 300 });
    const { container, rerender } = render(<Board fixed />);
    expect(container.querySelector('.helmgrid')).toHaveClass('helmgrid-flow');

    rerender(<Board />);
    expect(container.querySelector('.helmgrid')).not.toHaveClass('helmgrid-flow');
    expect(box(container, 'left').height).toBe(`${rowsPx(420)}px`);
    expect(box(container, 'right').height).toBe(`${rowsPx(220)}px`);
    expect(box(container, 'under').height).toBe(`${rowsPx(300)}px`);
  });

  it('the window made narrower, its text wrapping to more lines', () => {
    const observers = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb) {
          this.cb = cb;
          observers.push(this);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    const width = atWidth(1440);
    const natural = { left: 420, right: 220, under: 300 };
    content(natural);
    const { container } = render(<Board />);
    expect(box(container, 'left').height).toBe(`${rowsPx(420)}px`);
    const wide = box(container, 'left').width;

    width.mockReturnValue(1280);
    Object.assign(natural, { left: 560, right: 300, under: 380 });
    act(() => {
      for (const o of observers) o.cb([], o);
    });
    expect(box(container, 'left').width).not.toBe(wide);
    expect(box(container, 'left').height).toBe(`${rowsPx(560)}px`);
    expect(box(container, 'right').height).toBe(`${rowsPx(300)}px`);
    expect(box(container, 'under').height).toBe(`${rowsPx(380)}px`);
  });
});
