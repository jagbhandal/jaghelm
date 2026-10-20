import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { RefreshCw } from 'lucide-react';
import { IconButton } from '@ui/icon-button';
import { Tooltip } from '@ui/tooltip';

const NO_RING = /(^|\s|:)outline-(none|hidden|0)(\s|$)/;
const popup = () => document.querySelector('[data-slot="tooltip"]');

describe('Tooltip', () => {
  it('opens at once on keyboard focus, drawn as a small popover, and Escape closes it', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Reload Grafana">
        <IconButton label="Reload Grafana">
          <RefreshCw />
        </IconButton>
      </Tooltip>
    );
    await user.tab();
    const trigger = screen.getByRole('button', { name: 'Reload Grafana' });
    expect(trigger).toHaveFocus();
    await waitFor(() => expect(popup()).toHaveTextContent('Reload Grafana'));
    expect(popup()).toHaveClass(
      'bg-surface-2',
      'border-border-strong',
      'rounded-md',
      'text-caption',
      'text-text-1',
      'shadow-pop',
      'transition-opacity'
    );
    expect(popup().className).not.toMatch(NO_RING);
    expect(popup().className).not.toMatch(/(^|\s)duration-/);
    expect(popup().parentElement).toHaveClass('z-dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(popup()).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('opens under the pointer', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Reload Grafana" delay={0}>
        <IconButton label="Reload Grafana">
          <RefreshCw />
        </IconButton>
      </Tooltip>
    );
    await user.hover(screen.getByRole('button', { name: 'Reload Grafana' }));
    await waitFor(() => expect(popup()).toHaveTextContent('Reload Grafana'));
    await user.unhover(screen.getByRole('button', { name: 'Reload Grafana' }));
    await waitFor(() => expect(popup()).toBeNull());
  });

  it('describes its trigger when it says more than the trigger’s name, without opening', () => {
    render(
      <Tooltip content="Still loaded: opens where you left it">
        <span tabIndex={0} role="img" aria-label="Still loaded" />
      </Tooltip>
    );
    const lamp = screen.getByRole('img', { name: 'Still loaded' });
    expect(lamp).toHaveAccessibleDescription('Still loaded: opens where you left it');
    expect(popup()).toBeNull();
  });

  it('adds no description that would only repeat the name', () => {
    render(
      <Tooltip content="Reload Grafana">
        <IconButton label="Reload Grafana">
          <RefreshCw />
        </IconButton>
      </Tooltip>
    );
    const trigger = screen.getByRole('button', { name: 'Reload Grafana' });
    expect(trigger).not.toHaveAttribute('aria-describedby');
  });

  it('is portalled as a .jh-ui root with the switches of the screen around its trigger', async () => {
    const user = userEvent.setup();
    render(
      <div className="jh-ui" data-theme="light" data-typeface="montserrat" data-testid="screen">
        <Tooltip content="Reload Grafana">
          <IconButton label="Reload Grafana">
            <RefreshCw />
          </IconButton>
        </Tooltip>
      </div>
    );
    await user.tab();
    await waitFor(() => expect(popup()).not.toBeNull());
    expect(screen.getByTestId('screen')).not.toContainElement(popup());
    const root = popup().closest('.jh-ui');
    expect(root).toHaveAttribute('data-theme', 'light');
    expect(root).toHaveAttribute('data-typeface', 'montserrat');
  });
});
