import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SystemStatusCard from './SystemStatusCard.jsx';

describe('SystemStatusCard', () => {
  describe('content rendering', () => {
    it('renders the silkscreen "System status" label', () => {
      render(
        <SystemStatusCard
          severity="healthy"
          headline="Everything's healthy"
          subline="17 services up across 3 nodes"
          counts="17 up · 0 down · 3 nodes"
        />
      );
      expect(screen.getByText('System status')).toBeInTheDocument();
    });

    it('renders the full headline text', () => {
      render(
        <SystemStatusCard
          severity="critical"
          headline="Two services down"
          word="down"
          subline="jellyfin · vaultwarden"
          counts="14 up · 2 down · 3 nodes"
        />
      );
      // headline is split into parts; all parts together produce the full sentence
      expect(screen.getByText(/Two services/)).toBeInTheDocument();
    });

    it('renders the prose subline in the DOM', () => {
      render(
        <SystemStatusCard
          severity="healthy"
          headline="Everything's healthy"
          subline="17 services up across 3 nodes — UPS on mains"
          counts="17 up · 0 down · 3 nodes"
        />
      );
      expect(screen.getByText('17 services up across 3 nodes — UPS on mains')).toBeInTheDocument();
    });

    it('renders the mono counts footer', () => {
      render(
        <SystemStatusCard
          severity="critical"
          headline="Two services down"
          subline="jellyfin · vaultwarden"
          counts="14 up · 2 down · 1 unknown · 3 nodes"
        />
      );
      expect(screen.getByText('14 up · 2 down · 1 unknown · 3 nodes')).toBeInTheDocument();
    });
  });

  describe('status WORD coloring', () => {
    it('the matching word span has the critical (red) severity class', () => {
      const { container } = render(
        <SystemStatusCard
          severity="critical"
          headline="Two services down"
          word="down"
          subline="x"
          counts="y"
        />
      );
      const wordSpan = container.querySelector('.sys-status-card__word--critical');
      expect(wordSpan).not.toBeNull();
      expect(wordSpan.textContent.toLowerCase()).toBe('down');
    });

    it('the matching word span carries the critical color inline style', () => {
      const { container } = render(
        <SystemStatusCard
          severity="critical"
          headline="Two services down"
          word="down"
          subline="x"
          counts="y"
        />
      );
      const wordSpan = container.querySelector('.sys-status-card__word--critical');
      expect(wordSpan).not.toBeNull();
      expect(wordSpan.style.color).toBe('var(--red)');
    });

    it('the matching word span has the healthy (green) severity class', () => {
      const { container } = render(
        <SystemStatusCard
          severity="healthy"
          headline="Everything's healthy"
          word="healthy"
          subline="x"
          counts="y"
        />
      );
      const wordSpan = container.querySelector('.sys-status-card__word--healthy');
      expect(wordSpan).not.toBeNull();
    });

    it('renders headline without a colored word span when `word` prop is absent', () => {
      const { container } = render(
        <SystemStatusCard
          severity="unknown"
          headline="No signal"
          subline="Can't reach JagHelm"
          counts="—"
        />
      );
      expect(screen.getByText('No signal')).toBeInTheDocument();
      expect(container.querySelector('[class*="sys-status-card__word"]')).toBeNull();
    });

    it('renders headline without a colored word span when `word` is not found in headline', () => {
      const { container } = render(
        <SystemStatusCard
          severity="critical"
          headline="Five services down"
          word="vanished"
          subline="x"
          counts="y"
        />
      );
      expect(container.querySelector('[class*="sys-status-card__word"]')).toBeNull();
    });
  });

  describe('severity modifier class (drives tint + border via CSS)', () => {
    it('critical card carries sys-status-card--critical', () => {
      const { container } = render(
        <SystemStatusCard severity="critical" headline="x" subline="y" counts="z" />
      );
      expect(container.querySelector('.sys-status-card--critical')).not.toBeNull();
    });

    it('caution card carries sys-status-card--caution', () => {
      const { container } = render(
        <SystemStatusCard severity="caution" headline="x" subline="y" counts="z" />
      );
      expect(container.querySelector('.sys-status-card--caution')).not.toBeNull();
    });

    it('healthy card carries sys-status-card--healthy', () => {
      const { container } = render(
        <SystemStatusCard severity="healthy" headline="x" subline="y" counts="z" />
      );
      expect(container.querySelector('.sys-status-card--healthy')).not.toBeNull();
    });

    it('unknown card carries sys-status-card--unknown', () => {
      const { container } = render(
        <SystemStatusCard severity="unknown" headline="x" subline="y" counts="z" />
      );
      expect(container.querySelector('.sys-status-card--unknown')).not.toBeNull();
    });
  });
});
