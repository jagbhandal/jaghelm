import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Button } from '@ui/button';
import { Banner } from '@ui/banner';

describe('Banner', () => {
  it('names what failed and why, as today’s cause-naming banners do', () => {
    render(
      <Banner
        title="Live metrics unavailable"
        cause="Prometheus unreachable"
        detail="Updated 3 min ago"
        action={<Button size="sm">Retry</Button>}
      />
    );
    const banner = screen.getByText('Live metrics unavailable').closest('[data-slot="banner"]');
    expect(banner).toHaveAttribute('data-tone', 'crit');
    // What failed: bold, in the tone's word colour.
    expect(screen.getByText('Live metrics unavailable')).toHaveClass('font-bold', 'text-crit-fg');
    // Why: text-2. The detail: a quieter 12px line.
    expect(screen.getByText('Prometheus unreachable')).toHaveClass('text-text-2');
    expect(screen.getByText('Updated 3 min ago')).toHaveClass('text-caption', 'text-text-3');
    expect(banner).toContainElement(screen.getByRole('button', { name: 'Retry' }));
  });

  it('is the mock’s drawer status box: the tone’s tint inside a subtle edge, 14px of padding, 12px radius', () => {
    render(<Banner tone="warn" title="Backup overdue" cause="Last success 27 h ago" />);
    const banner = screen.getByText('Backup overdue').closest('[data-slot="banner"]');
    expect(banner).toHaveClass('bg-warn-tint', 'border', 'border-border', 'rounded-xl', 'p-3.5');
    expect(banner.className).not.toMatch(/shadow/);
  });

  it('shows the tone as the lamp’s shape, never colour alone', () => {
    const shapes = {
      crit: 'lucide-circle-minus',
      warn: 'lucide-circle-slash',
      unknown: 'lucide-circle',
      maintenance: 'lucide-wrench',
      info: 'lucide-info',
    };
    for (const [tone, shape] of Object.entries(shapes)) {
      const { container, unmount } = render(
        <Banner tone={tone} title={`${tone} title`} cause="Why" />
      );
      const icon = container.querySelector(`svg[data-tone="${tone}"]`);
      expect(icon).toHaveClass(shape, `text-${tone}-fg`);
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      unmount();
    }
  });

  it('keeps healthy quiet: an ok banner has no tint', () => {
    render(<Banner tone="ok" title="Connected" cause="Answered in 142 ms" />);
    const banner = screen.getByText('Connected').closest('[data-slot="banner"]');
    expect(banner.className).not.toMatch(/bg-ok/);
    expect(banner.querySelector('svg[data-tone="ok"]')).toHaveClass('fill-current', 'text-ok-fg');
  });

  it('requires a cause in a failing tone: it throws in development', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const tone of ['crit', 'warn', 'unknown']) {
        expect(() => render(<Banner tone={tone} title="Live metrics unavailable" />)).toThrow(
          /cause/
        );
      }
    } finally {
      quiet.mockRestore();
    }
    // Planned work and plain information need no cause.
    render(<Banner tone="maintenance" title="Planned work on JagNAS tonight" />);
    expect(screen.getByText('Planned work on JagNAS tonight')).toBeInTheDocument();
  });

  it('logs a missing cause in a production build instead of taking the screen down', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('DEV', false);
    try {
      render(<Banner title="Live metrics unavailable" />);
      expect(screen.getByText('Live metrics unavailable')).toBeInTheDocument();
      expect(logged).toHaveBeenCalledWith(expect.stringMatching(/cause/));
    } finally {
      vi.unstubAllEnvs();
      logged.mockRestore();
    }
  });

  it('is not a live region: the screen announces each cause once, from one place', () => {
    render(<Banner title="Live metrics unavailable" cause="Prometheus unreachable" />);
    const banner = screen.getByText('Live metrics unavailable').closest('[data-slot="banner"]');
    expect(banner).not.toHaveAttribute('role');
    expect(banner).not.toHaveAttribute('aria-live');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('becomes an alert only when asked, for a banner that stands alone', () => {
    render(<Banner role="alert" title="Can’t reach JagHelm" cause="The server didn’t answer" />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Can’t reach JagHelmThe server didn’t answer'
    );
  });
});
