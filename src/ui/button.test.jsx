import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Check } from 'lucide-react';
// Through the alias, as app code will import it (components.json, vite.config.js).
import { Button, buttonVariants } from '@ui/button';
import { cn } from '@ui/lib/utils';

// A class that would take the focus ring away; the base style draws the ring
// on :focus-visible (tailwind.css), so no control may remove it.
const NO_RING = /(^|\s|:)outline-(none|hidden|0)(\s|$)/;

describe('Button', () => {
  it('renders a native button, named by its text, as the secondary md button by default', () => {
    render(<Button>Change password</Button>);
    const btn = screen.getByRole('button', { name: 'Change password' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn).toHaveAttribute('data-slot', 'button');
    // The mock's .jh-btn: surface-1, a subtle edge, 13px semibold, 34px (h-control).
    expect(btn).toHaveClass(
      'bg-surface-1',
      'border-border',
      'text-text-1',
      'font-semibold',
      'text-body-sm',
      'h-control',
      'px-3',
      'shadow-control'
    );
    expect(btn.className).not.toMatch(NO_RING);
  });

  it.each([
    ['primary', ['bg-accent', 'text-on-accent', 'font-bold', 'hover:bg-accent-hover']],
    ['secondary', ['bg-surface-1', 'border-border', 'text-text-1']],
    ['ghost', ['text-text-2', 'hover:bg-surface-2']],
    ['danger', ['text-crit-fg', 'border-crit-border', 'bg-surface-1']],
  ])('draws the %s variant from the role tokens', (variant, classes) => {
    render(<Button variant={variant}>Go</Button>);
    const btn = screen.getByRole('button', { name: 'Go' });
    for (const c of classes) expect(btn.className).toContain(c);
    // Every size and colour class survives cn(): text-body-sm is a size, not a colour.
    expect(btn).toHaveClass('text-body-sm');
  });

  it('never fills a danger button with a status solid', () => {
    render(<Button variant="danger">Remove</Button>);
    expect(screen.getByRole('button').className).not.toMatch(/bg-crit-solid/);
  });

  it.each([
    ['primary', 'md', 'px-3.5'],
    ['primary', 'sm', 'px-3'],
    ['secondary', 'md', 'px-3'],
    ['secondary', 'sm', 'px-2.5'],
    ['danger', 'sm', 'px-2.5'],
    ['ghost', 'md', 'px-2.5'],
    ['ghost', 'sm', 'px-2.5'],
  ])('%s at %s has the mock’s padding (%s) and height', (variant, size, px) => {
    render(
      <Button variant={variant} size={size}>
        Go
      </Button>
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass(px, size === 'sm' ? 'h-control-sm' : 'h-control');
  });

  it('draws a ghost sm button as the mock’s row action: 10px padding, 6px radius', () => {
    render(
      <>
        <Button variant="ghost" size="sm">
          Remove
        </Button>
        <Button variant="ghost">Reload</Button>
      </>
    );
    const row = screen.getByRole('button', { name: 'Remove' });
    expect(row).toHaveClass('rounded-md', 'px-2.5', 'h-control-sm');
    expect(row).not.toHaveClass('rounded-lg');
    expect(screen.getByRole('button', { name: 'Reload' })).toHaveClass('rounded-lg');
  });

  it('draws a ghost button in accent-text with tone="accent", and keeps it under the pointer', () => {
    render(
      <>
        <Button variant="ghost" size="sm" tone="accent">
          Edit
        </Button>
        <Button variant="secondary" tone="accent">
          Save
        </Button>
      </>
    );
    const edit = screen.getByRole('button', { name: 'Edit' });
    expect(edit).toHaveClass(
      'text-accent-text',
      'not-data-disabled:hover:bg-surface-2',
      'not-data-disabled:hover:text-accent-text'
    );
    expect(edit.className).not.toMatch(/text-text-[12]/);
    expect(edit).not.toHaveAttribute('tone');
    // tone colours a ghost button only.
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveClass('text-text-1');
    expect(save).not.toHaveClass('text-accent-text');
  });

  it('activates with Enter and Space once focused with Tab', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Export</Button>);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Export' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('when disabled, is skipped by Tab and ignores clicks', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <>
        <Button disabled onClick={onClick}>
          Export
        </Button>
        <Button>Import</Button>
      </>
    );
    const btn = screen.getByRole('button', { name: 'Export' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('data-disabled');
    expect(btn).toHaveClass('data-disabled:opacity-55');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Import' })).toHaveFocus();
    await user.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("lets the caller's className override the component's own utilities", () => {
    render(<Button className="px-6 text-caption">Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toHaveClass('px-6', 'text-caption', 'text-text-1');
    expect(btn).not.toHaveClass('px-3');
    expect(btn).not.toHaveClass('text-body-sm');
  });

  it('carries a Lucide icon in currentColor, hidden from assistive tech', () => {
    render(
      <Button variant="primary">
        <Check />
        Use suggestion
      </Button>
    );
    const btn = screen.getByRole('button', { name: 'Use suggestion' });
    const svg = btn.querySelector('svg.lucide');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('styles a link as a button through buttonVariants()', () => {
    render(
      <a href="#open" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
        Open in new tab
      </a>
    );
    const link = screen.getByRole('link', { name: 'Open in new tab' });
    expect(link).toHaveClass('bg-accent', 'h-control-sm');
  });
});

describe('cn', () => {
  it('merges conditional classes and resolves conflicts', () => {
    const disabled = false;
    expect(cn('p-2', disabled && 'opacity-50', { 'text-sm': true }, 'p-4')).toBe('text-sm p-4');
  });

  it("knows JagHelm's type steps are sizes, so a colour never drops one", () => {
    expect(cn('text-body-sm text-text-1')).toBe('text-body-sm text-text-1');
    expect(cn('text-caption text-crit-fg')).toBe('text-caption text-crit-fg');
    expect(cn('text-title-xs', 'text-on-accent')).toBe('text-title-xs text-on-accent');
    expect(cn('text-body-sm', 'text-caption')).toBe('text-caption');
    expect(cn('text-text-2', 'text-accent-text')).toBe('text-accent-text');
  });

  it("knows the control heights and the shadows, so a caller's class replaces them", () => {
    expect(cn('h-control', 'h-control-sm')).toBe('h-control-sm');
    expect(cn('h-control', 'h-9')).toBe('h-9');
    expect(cn('h-control px-3', 'size-control')).toBe('px-3 size-control');
    expect(cn('h-segment', 'h-row')).toBe('h-row');
    expect(cn('p-panel', 'p-2')).toBe('p-2');
    expect(cn('shadow-control', 'shadow-pop')).toBe('shadow-pop');
  });

  it('knows the layers, the duration and the easing, so only one of each is kept', () => {
    expect(cn('z-dialog', 'z-toast')).toBe('z-toast');
    expect(cn('z-overlay', 'z-10')).toBe('z-10');
    expect(cn('duration-standard', 'duration-300')).toBe('duration-300');
    expect(cn('duration-300', 'duration-standard')).toBe('duration-standard');
    expect(cn('ease-in', 'ease-standard')).toBe('ease-standard');
    expect(cn('transition-colors duration-standard ease-standard')).toBe(
      'transition-colors duration-standard ease-standard'
    );
  });
});
