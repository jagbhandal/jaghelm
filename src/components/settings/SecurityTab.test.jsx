import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
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

// #348: a refused change must say so, in the server's words or the status.
describe('SecurityTab change password', () => {
  afterEach(() => vi.unstubAllGlobals());

  const submit = async (answer) => {
    vi.stubGlobal('fetch', vi.fn(async () => answer));
    const user = userEvent.setup();
    const { container } = render(<SecurityTab />);
    const [cur, next, confirm] = container.querySelectorAll('input[type="password"]');
    await user.type(cur, 'oldpass1');
    await user.type(next, 'newpass12');
    await user.type(confirm, 'newpass12');
    await user.click(screen.getByRole('button', { name: /change password/i }));
  };

  it('shows the server\'s error for a 400', async () => {
    await submit(Response.json({ error: 'Current password is wrong' }, { status: 400 }));
    expect(await screen.findByText('Current password is wrong')).toBeInTheDocument();
  });

  it('says the status for a refusal that is not JSON, not a parse error', async () => {
    await submit(new Response('<html>Bad gateway</html>', { status: 502 }));
    await waitFor(() => expect(screen.getByText('Failed to change password (HTTP 502).')).toBeInTheDocument());
  });
});
