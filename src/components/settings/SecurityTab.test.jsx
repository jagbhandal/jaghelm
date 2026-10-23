import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SecurityTab from './SecurityTab.jsx';

// Session Info says what the server does (#250): sessions survive restarts,
// end after 30 days without use, and 90 days after sign-in at most.
describe('SecurityTab session info', () => {
  it('states the session lifetime the server keeps', () => {
    render(<SecurityTab />);
    expect(screen.getByText(/stay signed in across restarts and updates/i)).toBeInTheDocument();
    expect(screen.getByText(/30 days without use, and 90 days after sign-in at most/i)).toBeInTheDocument();
    expect(screen.queryByText(/24 hours/i)).toBeNull();
  });
});
