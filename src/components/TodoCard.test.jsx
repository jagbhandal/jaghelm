import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import TodoCard from './TodoCard.jsx';
import { OverlayProvider } from '../context/OverlayContext.jsx';
import { getTodos, saveTodos } from '../hooks/useData';

vi.mock('../hooks/useData', () => ({
  getTodos: vi.fn(),
  saveTodos: vi.fn(),
}));

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Pin a west-of-UTC zone for this file: `new Date('2026-10-20')` is UTC midnight,
// which is the evening of Oct 19 in Toronto, so the bug only shows west of UTC.
let savedTz;
beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = 'America/Toronto';
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

beforeEach(() => {
  vi.clearAllMocks(); // restoreMocks doesn't reset the module mocks' call history
  getTodos.mockResolvedValue([]);
  saveTodos.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

// TodoCard toasts a failed save, and useToast needs the provider the app wraps it in.
const renderCard = () =>
  render(
    <OverlayProvider>
      <TodoCard config={{ sections: {} }} />
    </OverlayProvider>
  );

const addTodo = (text) => {
  fireEvent.change(screen.getByPlaceholderText('Add a task...'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '+' }));
};

describe('TodoCard on a plain-HTTP origin (no crypto.randomUUID)', () => {
  // An insecure context (http://<lan-ip>:3099) has crypto.getRandomValues but
  // not crypto.randomUUID, which is secure-context only.
  beforeEach(() => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
  });

  it('adds a todo with a UUID v4 id', async () => {
    expect(globalThis.crypto.randomUUID).toBeUndefined();
    renderCard();
    await waitFor(() => expect(getTodos).toHaveBeenCalled());

    addTodo('Renew the cert');

    expect(screen.getByText('Renew the cert')).toBeInTheDocument();
    expect(saveTodos).toHaveBeenCalledTimes(1);
    const [saved] = saveTodos.mock.calls[0];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ text: 'Renew the cert', done: false, due: null });
    expect(saved[0].id).toMatch(UUID_V4);
  });

  it('gives each added todo its own id', async () => {
    renderCard();
    await waitFor(() => expect(getTodos).toHaveBeenCalled());

    addTodo('one');
    addTodo('two');

    const saved = saveTodos.mock.calls.at(-1)[0];
    expect(saved.map((t) => t.text)).toEqual(['one', 'two']);
    expect(saved[0].id).not.toBe(saved[1].id);
  });
});

describe('TodoCard when a save fails', () => {
  it('says so and shows what the server holds instead of the unsaved change', async () => {
    renderCard();
    await waitFor(() => expect(getTodos).toHaveBeenCalledTimes(1));
    saveTodos.mockRejectedValue(new Error('HTTP 500'));

    addTodo('Never saved');

    expect(screen.getByText('Never saved')).toBeInTheDocument();
    expect(await screen.findByText("Couldn't save the checklist")).toBeInTheDocument();
    // The re-read returns the server's list ([]), so the unsaved todo goes away.
    await waitFor(() => expect(screen.queryByText('Never saved')).not.toBeInTheDocument());
    expect(getTodos).toHaveBeenCalledTimes(2);
  });
});

describe('TodoCard due dates west of UTC (America/Toronto)', () => {
  const renderWithDue = async (due) => {
    getTodos.mockResolvedValue([{ id: 'a', text: 'Patch the NAS', done: false, due }]);
    renderCard();
    return screen.findByText('Patch the NAS');
  };
  const at = (y, m, d, h = 12, min = 0) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(y, m - 1, d, h, min));
  };

  it('runs in a zone west of UTC (guards the tests below)', () => {
    // Toronto is UTC-4 in October (EDT): getTimezoneOffset() is +240 minutes.
    expect(new Date(2026, 9, 20).getTimezoneOffset()).toBe(240);
  });

  it('shows a todo due 2026-10-20 as "Oct 20", not overdue on Oct 20', async () => {
    at(2026, 10, 20);
    const item = (await renderWithDue('2026-10-20')).closest('.todo-item');
    const label = screen.getByText('Oct 20');
    expect(label).toHaveClass('todo-due');
    expect(label).not.toHaveClass('overdue');
    expect(item).not.toHaveClass('overdue');
  });

  it('is still not overdue late on its due day (after UTC has rolled over)', async () => {
    at(2026, 10, 20, 21, 30); // 01:30 UTC on Oct 21
    const item = (await renderWithDue('2026-10-20')).closest('.todo-item');
    expect(screen.getByText('Oct 20')).not.toHaveClass('overdue');
    expect(item).not.toHaveClass('overdue');
  });

  it('is overdue from the day after its due date', async () => {
    at(2026, 10, 21, 0, 30);
    const item = (await renderWithDue('2026-10-20')).closest('.todo-item');
    expect(screen.getByText('Oct 20')).toHaveClass('overdue');
    expect(item).toHaveClass('overdue');
  });

  it('is not overdue once done', async () => {
    at(2026, 10, 25);
    getTodos.mockResolvedValue([{ id: 'a', text: 'Patch the NAS', done: true, due: '2026-10-20' }]);
    renderCard();
    const item = (await screen.findByText('Patch the NAS')).closest('.todo-item');
    expect(screen.getByText('Oct 20')).not.toHaveClass('overdue');
    expect(item).not.toHaveClass('overdue');
  });
});
