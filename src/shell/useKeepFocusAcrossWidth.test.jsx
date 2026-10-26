import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useKeepFocusAcrossWidth } from './useKeepFocusAcrossWidth.js';

// Two trees for one row, as the phone screens and the wide Overview are: the
// row is a new element when `wide` flips.
function Page({ wide }) {
  useKeepFocusAcrossWidth(wide, '#main');
  return (
    <main id="main">
      {wide ? (
        <div>
          <a href="/x" data-slot="issue-row" aria-label="Backup, Failed">
            wide
          </a>
        </div>
      ) : (
        <button type="button" data-slot="issue-row" aria-label="Backup, Failed">
          phone
        </button>
      )}
      <button type="button" data-slot="issue-row" aria-label="Other, Down">
        other
      </button>
    </main>
  );
}

// The resize that crosses the width comes before the render of the other tree.
const cross = (view, wide) => {
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
  view.rerender(<Page wide={wide} />);
};

describe('useKeepFocusAcrossWidth (#510)', () => {
  it('moves focus to the same row in the other tree, both ways', () => {
    const view = render(<Page wide={false} />);
    screen.getByRole('button', { name: 'Backup, Failed' }).focus();
    cross(view, true);
    expect(screen.getByRole('link', { name: 'Backup, Failed' })).toHaveFocus();
    cross(view, false);
    expect(screen.getByRole('button', { name: 'Backup, Failed' })).toHaveFocus();
  });

  it('leaves focus alone when it was on the body', () => {
    const view = render(<Page wide={false} />);
    document.body.focus();
    cross(view, true);
    expect(document.body).toHaveFocus();
  });

  it('does not take focus from a row the visitor moved to meanwhile', () => {
    const view = render(<Page wide={false} />);
    screen.getByRole('button', { name: 'Backup, Failed' }).focus();
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    screen.getByRole('button', { name: 'Other, Down' }).focus();
    view.rerender(<Page wide />);
    expect(screen.getByRole('button', { name: 'Other, Down' })).toHaveFocus();
  });
});
