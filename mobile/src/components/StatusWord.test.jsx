import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusWord from './StatusWord.jsx';

// Severity → CSS color variable
const SEVERITY_COLOR = {
  critical: 'var(--red)',
  caution: 'var(--amber)',
  healthy: 'var(--green)',
  unknown: 'var(--steel)',
};

describe('StatusWord', () => {
  describe('word text in DOM', () => {
    it('renders the word uppercased in the DOM', () => {
      render(<StatusWord word="down" severity="critical" />);
      expect(screen.getByText('DOWN')).toBeInTheDocument();
    });

    it('renders an already-uppercase word correctly', () => {
      render(<StatusWord word="ON BATTERY" severity="caution" />);
      expect(screen.getByText('ON BATTERY')).toBeInTheDocument();
    });

    it('renders the word for each severity level', () => {
      const { rerender } = render(<StatusWord word="OK" severity="healthy" />);
      expect(screen.getByText('OK')).toBeInTheDocument();

      rerender(<StatusWord word="unknown" severity="unknown" />);
      expect(screen.getByText('UNKNOWN')).toBeInTheDocument();
    });
  });

  describe('severity color', () => {
    it.each([
      ['critical', 'var(--red)'],
      ['caution', 'var(--amber)'],
      ['healthy', 'var(--green)'],
      ['unknown', 'var(--steel)'],
    ])('%s severity applies color %s', (severity, expectedColor) => {
      const { container } = render(<StatusWord word="TEST" severity={severity} />);
      const span = container.firstChild;
      expect(span).toHaveStyle({ color: expectedColor });
    });
  });

  describe('typography', () => {
    it('uses font-weight 500 — never 700', () => {
      const { container } = render(<StatusWord word="UP" severity="healthy" />);
      const span = container.firstChild;
      expect(span).toHaveStyle({ fontWeight: 500 });
      // Explicitly NOT 700
      expect(span).not.toHaveStyle({ fontWeight: 700 });
    });

    it('uses the mono font family', () => {
      const { container } = render(<StatusWord word="UP" severity="healthy" />);
      const span = container.firstChild;
      expect(span).toHaveStyle({ fontFamily: 'var(--mono)' });
    });

    it('text-transform is uppercase', () => {
      const { container } = render(<StatusWord word="ok" severity="healthy" />);
      const span = container.firstChild;
      expect(span).toHaveStyle({ textTransform: 'uppercase' });
    });
  });
});
