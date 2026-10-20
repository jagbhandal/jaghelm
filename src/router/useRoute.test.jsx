import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { useRoute, navigate, followLink } from './useRoute.js';

// The router on the History API (#296): the URL is the page. A link pushes an
// entry, Back and Forward come back through popstate, and a path with no page
// is replaced by the Overview's, so Back never returns to it.

function Where() {
  const { route, params } = useRoute();
  return (
    <p data-testid="where">
      {route.id}
      {params.id ? `:${params.id}` : ''}
      {params.section ? `:${params.section}` : ''}
    </p>
  );
}
const where = () => screen.getByTestId('where').textContent;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('useRoute', () => {
  it('reads the page from the URL', () => {
    window.history.replaceState(null, '', '/apps/grafana');
    render(<Where />);
    expect(where()).toBe('app:grafana');
  });

  it('navigate() pushes an entry and re-renders', () => {
    render(<Where />);
    const before = window.history.length;
    act(() => navigate('/alerts'));
    expect(where()).toBe('alerts');
    expect(window.location.pathname).toBe('/alerts');
    expect(window.history.length).toBe(before + 1);
  });

  it('navigate() to the page already open adds no entry', () => {
    window.history.replaceState(null, '', '/alerts');
    render(<Where />);
    const before = window.history.length;
    act(() => navigate('/alerts'));
    expect(window.history.length).toBe(before);
  });

  it('navigate(…, { replace }) replaces the entry', () => {
    render(<Where />);
    const before = window.history.length;
    act(() => navigate('/settings/tabs', { replace: true }));
    expect(where()).toBe('settings:tabs');
    expect(window.history.length).toBe(before);
  });

  it('follows Back and Forward (popstate)', () => {
    render(<Where />);
    act(() => navigate('/alerts'));
    act(() => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(where()).toBe('overview');
  });

  it('replaces a path with no page by the Overview', () => {
    window.history.replaceState(null, '', '/launch');
    const before = window.history.length;
    render(<Where />);
    expect(where()).toBe('overview');
    expect(window.location.pathname).toBe('/');
    expect(window.history.length).toBe(before);
  });

  it('keeps the query and hash out of the match', () => {
    window.history.replaceState(null, '', '/alerts?x=1#top');
    render(<Where />);
    expect(where()).toBe('alerts');
  });

  it('scrolls to the top on a new page, not on a replace', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    render(<Where />);
    act(() => navigate('/alerts'));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    scrollTo.mockClear();
    act(() => navigate('/settings', { replace: true }));
    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
  });
});

describe('followLink', () => {
  function Link({ href }) {
    return (
      <a href={href} onClick={(e) => followLink(e, href)}>
        go
      </a>
    );
  }

  it('navigates in the page on a plain click', () => {
    render(
      <>
        <Where />
        <Link href="/alerts" />
      </>
    );
    fireEvent.click(screen.getByText('go'));
    expect(where()).toBe('alerts');
  });

  it('leaves a modified or middle click to the browser (a new tab)', () => {
    // jsdom can't open a tab: stop the browser's own action after the link's handler.
    const stop = (e) => e.preventDefault();
    document.addEventListener('click', stop);
    render(
      <>
        <Where />
        <Link href="/alerts" />
      </>
    );
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
      act(() => {
        screen.getByText('go').dispatchEvent(event);
      });
      expect(where(), JSON.stringify(init)).toBe('overview');
    }
    document.removeEventListener('click', stop);
  });
});
