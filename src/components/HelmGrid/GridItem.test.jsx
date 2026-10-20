import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import GridItem from './GridItem.jsx';

// GridItem exposes a keyboard-only move/resize handle so a panel is reachable
// without a mouse. These tests lock in that the handle exists, is labelled with
// its grid position, and maps arrow / Shift+arrow keys to the right callbacks.

const baseProps = (over = {}) => ({
  itemId: 'panel-a',
  style: {},
  className: 'helmgrid-item',
  dragHandle: '.section-header',
  draggable: true,
  resizable: true,
  isDragging: false,
  isResizing: false,
  onDragStart: vi.fn(),
  onResizeStart: vi.fn(),
  onContentHeight: vi.fn(),
  gridX: 3,
  gridY: 1,
  gridW: 4,
  gridH: 2,
  gridLabel: 'UPS Power',
  onKeyboardMove: vi.fn(),
  onKeyboardResize: vi.fn(),
  ...over,
});

const renderItem = (over) =>
  render(
    <GridItem {...baseProps(over)}>
      <div className="section-header">Panel A</div>
    </GridItem>
  );

const handle = () => screen.getByRole('button', { name: /reposition/i });

describe('GridItem keyboard handle', () => {
  it('renders a handle labelled with the panel name, 1-based position, and resize hint', () => {
    renderItem();
    const btn = handle();
    // Human-readable name (not the raw itemId), column 3+1=4, row 1+1=2, 4x2.
    expect(btn).toHaveAccessibleName(/reposition ups power/i);
    expect(btn).toHaveAccessibleName(/column 4, row 2, 4 by 2 cells/i);
    expect(btn).toHaveAccessibleName(/shift plus arrow keys resize/i);
    // aria-keyshortcuts enumerates the modifier combos too (WAI-ARIA).
    expect(btn.getAttribute('aria-keyshortcuts')).toMatch(/Shift\+ArrowUp/);
  });

  it('falls back to a generic name when no label is provided (never the raw id)', () => {
    renderItem({ gridLabel: undefined });
    expect(handle()).toHaveAccessibleName(/reposition this panel/i);
    expect(handle()).not.toHaveAccessibleName(/panel-a/i);
  });

  it('maps arrow keys to a move by one cell in the right direction', () => {
    const onKeyboardMove = vi.fn();
    renderItem({ onKeyboardMove });
    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(onKeyboardMove).toHaveBeenCalledWith('panel-a', 1, 0);
    fireEvent.keyDown(handle(), { key: 'ArrowUp' });
    expect(onKeyboardMove).toHaveBeenCalledWith('panel-a', 0, -1);
  });

  it('maps Shift+arrow to a resize, not a move', () => {
    const onKeyboardMove = vi.fn();
    const onKeyboardResize = vi.fn();
    renderItem({ onKeyboardMove, onKeyboardResize });
    fireEvent.keyDown(handle(), { key: 'ArrowDown', shiftKey: true });
    expect(onKeyboardResize).toHaveBeenCalledWith('panel-a', 0, 1);
    fireEvent.keyDown(handle(), { key: 'ArrowLeft', shiftKey: true });
    expect(onKeyboardResize).toHaveBeenCalledWith('panel-a', -1, 0);
    expect(onKeyboardMove).not.toHaveBeenCalled();
  });

  it('ignores Shift+arrow resize when the item is not resizable', () => {
    const onKeyboardResize = vi.fn();
    renderItem({ resizable: false, onKeyboardResize });
    fireEvent.keyDown(handle(), { key: 'ArrowRight', shiftKey: true });
    expect(onKeyboardResize).not.toHaveBeenCalled();
    // …and the label + shortcuts drop the resize affordance.
    expect(handle()).not.toHaveAccessibleName(/resize/i);
    expect(handle().getAttribute('aria-keyshortcuts')).not.toMatch(/Shift/);
  });

  it('ignores non-arrow keys', () => {
    const onKeyboardMove = vi.fn();
    const onKeyboardResize = vi.fn();
    renderItem({ onKeyboardMove, onKeyboardResize });
    fireEvent.keyDown(handle(), { key: 'Enter' });
    fireEvent.keyDown(handle(), { key: 'a' });
    expect(onKeyboardMove).not.toHaveBeenCalled();
    expect(onKeyboardResize).not.toHaveBeenCalled();
  });

  it('omits the handle entirely when the grid is not draggable (mobile)', () => {
    renderItem({ draggable: false });
    expect(screen.queryByRole('button', { name: /reposition/i })).not.toBeInTheDocument();
  });
});

describe('GridItem content height', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // A ResizeObserver that records what it watches and can be fired by hand.
  const stubObserver = () => {
    const observers = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb) {
          this.cb = cb;
          this.watched = [];
          observers.push(this);
        }
        observe(el) {
          this.watched.push(el);
        }
        unobserve() {}
        disconnect() {}
      }
    );
    return observers;
  };

  it('watches the panel, not the keyboard handle, and re-measures when the panel resizes (#248)', () => {
    const observers = stubObserver();
    // requestAnimationFrame runs the measure at once.
    vi.stubGlobal('requestAnimationFrame', (fn) => {
      fn();
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    let natural = 400;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => natural);
    const onContentHeight = vi.fn();
    render(
      <GridItem {...baseProps({ onContentHeight })}>
        <div data-testid="panel" className="section-header">
          Panel A
        </div>
      </GridItem>
    );

    const watched = observers.flatMap((o) => o.watched);
    expect(watched).toEqual([screen.getByTestId('panel')]);
    expect(onContentHeight).toHaveBeenLastCalledWith('panel-a', 400);

    // Made wider, the panel's content takes less height: measured again.
    natural = 250;
    observers[0].cb([]);
    expect(onContentHeight).toHaveBeenLastCalledWith('panel-a', 250);
  });
});
