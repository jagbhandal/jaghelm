import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SettingsIcon } from './primitives.jsx';

// Regression: a Dashboard-Icons slug ("gitea") or a filename ("gitea.svg")
// is a legitimate icon value (typed into the ServicesTab override input, or
// stored in older configs). It must resolve to an <img>, NOT be printed as
// raw text — the "I see a filename instead of the icon" bug.
describe('SettingsIcon — bare slug / filename icons', () => {
  it('renders a bare slug as an <img>, not as text', () => {
    const { container } = render(<SettingsIcon value="gitea" />);
    expect(container.querySelector('img')).not.toBeNull();
    expect(container.textContent).not.toContain('gitea');
  });

  it('renders a filename (slug.svg) as an <img>', () => {
    const { container } = render(<SettingsIcon value="gitea.svg" />);
    expect(container.querySelector('img')).not.toBeNull();
    expect(container.textContent).not.toContain('gitea.svg');
  });

  it('renders an emoji fallback as text (no <img>)', () => {
    const { container } = render(<SettingsIcon value="" fallback="🖥" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('🖥');
  });

  it('renders a full URL as an <img>', () => {
    const { container } = render(<SettingsIcon value="https://example.com/x.png" />);
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('renders an arbitrary text label as text, not a blank image', () => {
    const { container } = render(<SettingsIcon value="My Server" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('My Server');
  });
});
