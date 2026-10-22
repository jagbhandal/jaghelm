import { render, screen, fireEvent, act } from '@testing-library/react';
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

  // A ResizeObserver that records what it watches, as the browser's does, and
  // reports a resize only to the observers watching that element.
  const stubObserver = () => {
    const observers = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb) {
          this.cb = cb;
          this.watched = new Set();
          observers.push(this);
        }
        observe(el) {
          this.watched.add(el);
        }
        unobserve(el) {
          this.watched.delete(el);
        }
        disconnect() {
          this.watched.clear();
        }
      }
    );
    return {
      watched: () => observers.flatMap((o) => [...o.watched]),
      // The browser reports `el`'s box resized, to `height` px tall.
      resize: (el, height) => {
        const entry = { target: el, borderBoxSize: [{ blockSize: height }] };
        for (const o of observers) if (o.watched.has(el)) o.cb([entry], o);
      },
    };
  };

  // requestAnimationFrame runs the measure at once; the content's natural
  // height (the item at height: auto) is `natural.px`.
  const stubLayout = (px) => {
    vi.stubGlobal('requestAnimationFrame', (fn) => {
      fn();
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const natural = { px };
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => natural.px);
    return natural;
  };

  // A panel as the board draws one: a box stretched to the item's grid height
  // (flex: 1), and the content in it.
  const Panel = ({ lines = ['Gitea', 'Grafana'] }) => (
    <div data-testid="panel" className="section-header">
      <div data-testid="content">
        {lines.map((line) => (
          <p key={line} data-testid={`line-${line}`}>
            {line}
          </p>
        ))}
      </div>
    </div>
  );

  // MutationObserver callbacks run as microtasks.
  const settle = () => act(async () => {});

  it('watches the panel and everything in it, never the handles, and re-measures when the panel resizes (#248)', async () => {
    const ro = stubObserver();
    const natural = stubLayout(400);
    const onContentHeight = vi.fn();
    const { container } = render(
      <GridItem {...baseProps({ onContentHeight })}>
        <Panel />
      </GridItem>
    );
    await settle();

    const watched = ro.watched();
    for (const id of ['panel', 'content', 'line-Gitea', 'line-Grafana'])
      expect(watched).toContain(screen.getByTestId(id));
    expect(watched).not.toContain(handle());
    for (const el of container.querySelectorAll('.helmgrid-resize-handle'))
      expect(watched).not.toContain(el);
    expect(onContentHeight).toHaveBeenLastCalledWith('panel-a', 400);

    // Made wider, the panel's content takes less height: measured again.
    ro.resize(screen.getByTestId('content'), 380);
    natural.px = 250;
    ro.resize(screen.getByTestId('content'), 230);
    expect(onContentHeight).toHaveBeenLastCalledWith('panel-a', 250);
  });

  it("re-measures when the content's own height changes inside the stretched panel: a web font swapping in (#498)", async () => {
    const ro = stubObserver();
    const natural = stubLayout(927);
    const onContentHeight = vi.fn();
    render(
      <GridItem {...baseProps({ onContentHeight })}>
        <Panel />
      </GridItem>
    );
    await settle();
    expect(onContentHeight).toHaveBeenLastCalledWith('panel-a', 927);

    // The board's web fonts arrive after that measure: the text is shorter, so
    // the content is, while the panel, stretched to its grid height, keeps its
    // box. Only the content's box changes; the panel must be measured again,
    // or it stays a row too tall.
    ro.resize(screen.getByTestId('content'), 911);
    natural.px = 917;
    ro.resize(screen.getByTestId('content'), 901);
    expect(onContentHeight).toHaveBeenLastCalledWith('panel-a', 917);
  });

  it('re-measures when the content changes with no box resizing: a line removed from the stretched panel', async () => {
    stubObserver();
    const natural = stubLayout(400);
    const onContentHeight = vi.fn();
    const { rerender } = render(
      <GridItem {...baseProps({ onContentHeight })}>
        <Panel />
      </GridItem>
    );
    await settle();
    expect(onContentHeight).toHaveBeenLastCalledWith('panel-a', 400);

    natural.px = 360;
    rerender(
      <GridItem {...baseProps({ onContentHeight })}>
        <Panel lines={['Gitea']} />
      </GridItem>
    );
    await settle();
    expect(onContentHeight).toHaveBeenLastCalledWith('panel-a', 360);
  });

  it('watches content drawn after the first measure, and stops watching what is gone', async () => {
    const ro = stubObserver();
    const natural = stubLayout(400);
    const onContentHeight = vi.fn();
    const { rerender } = render(
      <GridItem {...baseProps({ onContentHeight })}>
        <Panel />
      </GridItem>
    );
    await settle();
    const gone = screen.getByTestId('line-Grafana');

    rerender(
      <GridItem {...baseProps({ onContentHeight })}>
        <Panel lines={['Gitea', 'Jellyfin']} />
      </GridItem>
    );
    await settle();
    const added = screen.getByTestId('line-Jellyfin');
    expect(ro.watched()).toContain(added);
    expect(ro.watched()).not.toContain(gone);

    natural.px = 440;
    ro.resize(added, 20);
    expect(onContentHeight).toHaveBeenLastCalledWith('panel-a', 440);
  });

  it('a measure skipped while the panel is resized runs when the resize ends', async () => {
    stubObserver();
    const natural = stubLayout(400);
    const onContentHeight = vi.fn();
    const { rerender } = render(
      <GridItem {...baseProps({ onContentHeight, isResizing: true })}>
        <Panel />
      </GridItem>
    );
    await settle();
    expect(onContentHeight).not.toHaveBeenCalled();

    natural.px = 480;
    rerender(
      <GridItem {...baseProps({ onContentHeight, isResizing: false })}>
        <Panel />
      </GridItem>
    );
    await settle();
    expect(onContentHeight).toHaveBeenLastCalledWith('panel-a', 480);
  });

  it('a bar animating its width changes no height: no measure each frame (#498)', async () => {
    const ro = stubObserver();
    stubLayout(400);
    const onContentHeight = vi.fn();
    render(
      <GridItem {...baseProps({ onContentHeight })}>
        <Panel />
      </GridItem>
    );
    await settle();
    const bar = screen.getByTestId('line-Gitea');
    ro.resize(bar, 6); // its first size, as the observer reports on watching it
    const measured = onContentHeight.mock.calls.length;

    // A meter's fill grows over 1 s: a resize every frame, its height the same.
    for (let frame = 0; frame < 10; frame++) ro.resize(bar, 6);
    expect(onContentHeight).toHaveBeenCalledTimes(measured);
  });

  it('a text change that makes the panel taller is measured, through its box', async () => {
    const ro = stubObserver();
    const natural = stubLayout(400);
    const onContentHeight = vi.fn();
    render(
      <GridItem {...baseProps({ onContentHeight })}>
        <Panel />
      </GridItem>
    );
    await settle();
    const line = screen.getByTestId('line-Gitea');
    ro.resize(line, 20);

    // Longer text wraps to two lines: the line's box grows, and so the panel.
    natural.px = 420;
    line.textContent = 'Gitea, with a much longer name that wraps to two lines';
    ro.resize(line, 40);
    expect(onContentHeight).toHaveBeenLastCalledWith('panel-a', 420);
  });

  it("doesn't measure again on its own measuring, or on the layout moving it", async () => {
    stubObserver();
    stubLayout(400);
    const onContentHeight = vi.fn();
    const { rerender } = render(
      <GridItem {...baseProps({ onContentHeight })}>
        <Panel />
      </GridItem>
    );
    await settle();
    expect(onContentHeight).toHaveBeenCalledTimes(1);

    // The grid moves the item (its style and its handle's label change): its
    // content is the same, so nothing is measured.
    rerender(
      <GridItem {...baseProps({ onContentHeight, style: { left: 40 }, gridX: 5 })}>
        <Panel />
      </GridItem>
    );
    await settle();
    expect(onContentHeight).toHaveBeenCalledTimes(1);
  });
});
