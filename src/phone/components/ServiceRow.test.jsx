import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ServiceRow from './ServiceRow.jsx';

// The Phone board's service row (#671): a since-restart strip says so.
const service = (extra = {}) => ({
  uid: 'apps:cadvisor',
  display_name: 'cAdvisor',
  nodeName: 'App Server',
  modelState: 'ok',
  state: 'ok',
  word: 'Up',
  ping: 12,
  stale: false,
  beats: [{ state: 'ok', time: 1, ping: 12 }],
  ...extra,
});

describe('ServiceRow strip history (#671)', () => {
  it('a since-restart strip has the words and unrecorded slots', () => {
    const { container } = render(<ServiceRow service={service({ beatsHistory: 'since-restart' })} />);
    expect(screen.getByText('history since restart')).toBeInTheDocument();
    expect(container.querySelector('[data-beat="unrecorded"]')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Heartbeats/ })).toHaveAccessibleName(/earlier checks not recorded/);
  });

  it('a Kuma strip, or an old server with no field, has neither', () => {
    for (const beatsHistory of ['kuma', undefined]) {
      const { container, unmount } = render(<ServiceRow service={service({ beatsHistory })} />);
      expect(screen.queryByText('history since restart')).toBeNull();
      expect(container.querySelector('[data-beat="unrecorded"]')).toBeNull();
      unmount();
    }
  });
});
