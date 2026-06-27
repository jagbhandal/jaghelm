import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SubsystemCell from './SubsystemCell.jsx';

/** Convenience factory — override only the fields you care about. */
const makeCell = (overrides = {}) => ({
  key: 'services',
  label: 'Services',
  severity: 'healthy',
  word: 'OK',
  detail: '3 / 3',
  ...overrides,
});

describe('SubsystemCell', () => {
  describe('content rendering', () => {
    it('renders the mono lab label', () => {
      render(<SubsystemCell cell={makeCell({ label: 'Services' })} />);
      expect(screen.getByText('Services')).toBeInTheDocument();
    });

    it('renders the status word via StatusWord', () => {
      render(<SubsystemCell cell={makeCell({ word: 'OK' })} />);
      expect(screen.getByText('OK')).toBeInTheDocument();
    });

    it('renders the mono detail line', () => {
      render(<SubsystemCell cell={makeCell({ detail: '3 / 3' })} />);
      expect(screen.getByText('3 / 3')).toBeInTheDocument();
    });

    it('renders the node label (Nodes cell)', () => {
      render(<SubsystemCell cell={makeCell({ key: 'nodes', label: 'Nodes', word: 'OK', detail: '3 online' })} />);
      expect(screen.getByText('Nodes')).toBeInTheDocument();
      expect(screen.getByText('3 online')).toBeInTheDocument();
    });
  });

  describe('unreachable / unknown cell — NO SIGNAL renders steel, NOT green', () => {
    it('renders the NO SIGNAL word for an unknown cell', () => {
      render(<SubsystemCell cell={makeCell({ severity: 'unknown', word: 'NO SIGNAL', detail: '—' })} />);
      expect(screen.getByText('NO SIGNAL')).toBeInTheDocument();
    });

    it('an unknown cell StatusWord has word--unknown class (NOT word--healthy)', () => {
      const { container } = render(
        <SubsystemCell cell={makeCell({ key: 'nodes', severity: 'unknown', word: 'NO SIGNAL', detail: '—' })} />
      );
      const statusWord = container.querySelector('.status-word');
      expect(statusWord).not.toBeNull();
      expect(statusWord.classList.contains('word--unknown')).toBe(true);
      expect(statusWord.classList.contains('word--healthy')).toBe(false);
    });

    it('an unknown cell StatusWord has steel inline color (var(--steel))', () => {
      const { container } = render(
        <SubsystemCell cell={makeCell({ key: 'ups', severity: 'unknown', word: 'NO SIGNAL', detail: '—' })} />
      );
      const statusWord = container.querySelector('.status-word');
      expect(statusWord).not.toBeNull();
      expect(statusWord.style.color).toBe('var(--steel)');
    });
  });

  describe('lamp shape rule', () => {
    it('ups + caution → bolt shape (path, no circle)', () => {
      const { container } = render(
        <SubsystemCell cell={makeCell({ key: 'ups', severity: 'caution', word: 'ON BATTERY', detail: '47% · 8m' })} />
      );
      expect(container.querySelector('path')).not.toBeNull();
      expect(container.querySelector('circle')).toBeNull();
    });

    it('critical (services down) → slash shape (circle + line)', () => {
      const { container } = render(
        <SubsystemCell cell={makeCell({ key: 'services', severity: 'critical', word: 'DOWN', detail: '1 / 3' })} />
      );
      expect(container.querySelector('circle')).not.toBeNull();
      expect(container.querySelector('line')).not.toBeNull();
    });

    it('unknown → ring shape (hollow circle, fill=none)', () => {
      const { container } = render(
        <SubsystemCell cell={makeCell({ key: 'nodes', severity: 'unknown', word: 'NO SIGNAL', detail: '—' })} />
      );
      const circle = container.querySelector('circle');
      expect(circle).not.toBeNull();
      expect(circle.getAttribute('fill')).toBe('none');
      expect(container.querySelector('line')).toBeNull();
    });

    it('healthy → disc shape (filled circle, no line, no path)', () => {
      const { container } = render(
        <SubsystemCell cell={makeCell({ key: 'services', severity: 'healthy', word: 'OK', detail: '3 / 3' })} />
      );
      const circle = container.querySelector('circle');
      expect(circle).not.toBeNull();
      expect(circle.getAttribute('fill')).not.toBe('none');
      expect(container.querySelector('line')).toBeNull();
      expect(container.querySelector('path')).toBeNull();
    });

    it('nodes + caution (hot) → disc shape (not bolt — bolt is ups-only)', () => {
      const { container } = render(
        <SubsystemCell cell={makeCell({ key: 'nodes', severity: 'caution', word: 'DEGRADED', detail: '1 hot · 94%' })} />
      );
      // disc = filled circle, no line, no bolt path
      const circle = container.querySelector('circle');
      expect(circle).not.toBeNull();
      expect(circle.getAttribute('fill')).not.toBe('none');
      expect(container.querySelector('path')).toBeNull();
      expect(container.querySelector('line')).toBeNull();
    });

    it('cron + caution (failed) → disc shape (not bolt)', () => {
      const { container } = render(
        <SubsystemCell cell={makeCell({ key: 'cron', severity: 'caution', word: 'FAILED', detail: '1 job' })} />
      );
      expect(container.querySelector('circle')).not.toBeNull();
      expect(container.querySelector('path')).toBeNull();
    });
  });

  describe('severity modifier class (drives tint + border via CSS)', () => {
    it('applies subsystem-cell--critical for critical severity', () => {
      const { container } = render(
        <SubsystemCell cell={makeCell({ severity: 'critical', word: 'DOWN' })} />
      );
      expect(container.querySelector('.subsystem-cell--critical')).not.toBeNull();
    });

    it('applies subsystem-cell--caution for caution severity', () => {
      const { container } = render(
        <SubsystemCell cell={makeCell({ severity: 'caution', word: 'DEGRADED' })} />
      );
      expect(container.querySelector('.subsystem-cell--caution')).not.toBeNull();
    });

    it('applies subsystem-cell--healthy for healthy severity', () => {
      const { container } = render(
        <SubsystemCell cell={makeCell({ severity: 'healthy', word: 'OK' })} />
      );
      expect(container.querySelector('.subsystem-cell--healthy')).not.toBeNull();
    });

    it('applies subsystem-cell--unknown for unknown severity', () => {
      const { container } = render(
        <SubsystemCell cell={makeCell({ severity: 'unknown', word: 'NO SIGNAL' })} />
      );
      expect(container.querySelector('.subsystem-cell--unknown')).not.toBeNull();
    });
  });
});
