import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { RefreshCw, X } from 'lucide-react';
import { IconButton } from '@ui/icon-button';

const NO_RING = /(^|\s|:)outline-(none|hidden|0)(\s|$)/;

describe('IconButton', () => {
  it('is a square ghost button named by its label, the icon hidden from assistive tech', () => {
    render(
      <IconButton label="Reload Grafana">
        <RefreshCw />
      </IconButton>
    );
    const btn = screen.getByRole('button', { name: 'Reload Grafana' });
    expect(btn).toHaveAttribute('data-slot', 'icon-button');
    // The mock's 34px ghost icon buttons: square, text-2, surface-2 under the pointer.
    expect(btn).toHaveClass('size-control', 'px-0', 'rounded-lg', 'text-text-2');
    expect(btn.className).toContain('hover:bg-surface-2');
    expect(btn).not.toHaveClass('h-control');
    expect(btn.className).not.toMatch(NO_RING);
    expect(btn.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('comes at sm, and in the Button’s other variants', () => {
    render(
      <IconButton label="Close" size="sm" variant="secondary">
        <X />
      </IconButton>
    );
    const btn = screen.getByRole('button', { name: 'Close' });
    expect(btn).toHaveClass('size-control-sm', 'bg-surface-1', 'border-border');
  });

  it('keeps the mock’s 8px radius at sm, where a ghost text button takes 6px', () => {
    render(
      <IconButton label="Close" size="sm">
        <X />
      </IconButton>
    );
    const btn = screen.getByRole('button', { name: 'Close' });
    expect(btn).toHaveClass('size-control-sm', 'rounded-lg', 'px-0');
    expect(btn).not.toHaveClass('rounded-md');
  });

  it('requires an accessible name: it throws in development', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() =>
        render(
          <IconButton>
            <X />
          </IconButton>
        )
      ).toThrow(/label/);
    } finally {
      quiet.mockRestore();
    }
  });

  it('logs a missing name in a production build instead of taking the screen down', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('DEV', false);
    try {
      render(
        <IconButton label="">
          <X />
        </IconButton>
      );
      expect(screen.getByRole('button')).toBeInTheDocument();
      expect(logged).toHaveBeenCalledWith(expect.stringMatching(/label/));
    } finally {
      vi.unstubAllEnvs();
      logged.mockRestore();
    }
  });

  it('takes its name from aria-label or aria-labelledby instead of a label', () => {
    render(
      <>
        <span id="close-name">Close the drawer</span>
        <IconButton aria-labelledby="close-name">
          <X />
        </IconButton>
        <IconButton aria-label="Reload">
          <RefreshCw />
        </IconButton>
      </>
    );
    expect(screen.getByRole('button', { name: 'Close the drawer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('activates with Enter and Space', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <IconButton label="Toggle theme" onClick={onClick}>
        <X />
      </IconButton>
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Toggle theme' })).toHaveFocus();
    await user.keyboard('{Enter} ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('when disabled, is skipped by Tab', async () => {
    const user = userEvent.setup();
    render(
      <>
        <IconButton label="Reload" disabled>
          <RefreshCw />
        </IconButton>
        <IconButton label="Close">
          <X />
        </IconButton>
      </>
    );
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });
});
