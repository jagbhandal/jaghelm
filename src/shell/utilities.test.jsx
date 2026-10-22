import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGiteaActivity, getTodos, saveTodos } from '../hooks/useData.js';
import { ConfigProvider } from '../context/ConfigContext.jsx';
import { OverlayProvider } from '../context/OverlayContext.jsx';
import { PIPELINE_ROWS, linkGroups, pipelineRows, usePipeline, useTodos } from './utilities.js';
import { ChecklistPanel } from './Utilities.jsx';

vi.mock('../hooks/useData.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getGiteaActivity: vi.fn(),
  getTodos: vi.fn(),
  saveTodos: vi.fn(),
}));

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const wrapper = ({ children }) => (
  <OverlayProvider>
    <ConfigProvider config={{ refreshInterval: 30 }} setConfig={() => {}}>
      {children}
    </ConfigProvider>
  </OverlayProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  getTodos.mockResolvedValue([]);
  saveTodos.mockResolvedValue(undefined);
  getGiteaActivity.mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('linkGroups', () => {
  it('draws every group with a link, in the config’s order, not only the first three', () => {
    const groups = linkGroups({
      devops: [{ name: 'Grafana', url: 'https://grafana.example' }],
      personal: [{ name: 'Home Assistant', url: 'https://ha.example' }],
      management: [],
      home_lab: [{ name: 'Proxmox', url: 'https://pve.example' }],
    });
    expect(groups.map((g) => [g.key, g.title])).toEqual([
      ['devops', 'Dev & Monitoring'],
      ['personal', 'Personal'],
      ['home_lab', 'Home Lab'],
    ]);
    expect(groups[1].links[0]).toMatchObject({
      name: 'Home Assistant',
      href: 'https://ha.example',
      monogram: 'HA',
    });
  });

  it('leaves out a link it can’t open, and a group left with none', () => {
    const groups = linkGroups({
      a: [
        { name: 'Bad', url: 'javascript:alert(1)' },
        { name: '', url: 'https://nameless.example/' },
      ],
      b: [{ name: 'No address' }],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].links).toEqual([
      expect.objectContaining({ name: 'nameless.example/', href: 'https://nameless.example/' }),
    ]);
  });

  it('is empty for no links, or links that aren’t groups', () => {
    for (const links of [undefined, null, {}, [], 'x']) expect(linkGroups(links)).toEqual([]);
  });
});

describe('pipelineRows', () => {
  const at = (h) => new Date(Date.parse('2026-10-20T09:00:00Z') - h * 3_600_000).toISOString();
  const activity = [
    {
      repo: 'infra',
      fullName: 'me/infra',
      commits: [
        { sha: 'aaaaaaa', message: 'Newest', date: at(1) },
        { sha: 'ccccccc', message: 'Oldest', date: at(30) },
      ],
    },
    {
      repo: 'app',
      fullName: 'me/app',
      commits: [{ sha: 'bbbbbbb', message: 'Middle', date: at(5) }],
    },
  ];

  it('lists the newest commits across the repos, newest first', () => {
    const rows = pipelineRows(activity);
    expect(rows.map((r) => [r.title, r.repo, r.sha])).toEqual([
      ['Newest', 'infra', 'aaaaaaa'],
      ['Middle', 'app', 'bbbbbbb'],
      ['Oldest', 'infra', 'ccccccc'],
    ]);
    expect(rows[0].at).toBe(Date.parse(at(1)));
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
  });

  it(`keeps at most ${PIPELINE_ROWS}, and a commit with no date goes last, with no age`, () => {
    const many = [
      {
        repo: 'r',
        commits: [
          { sha: 'nodate0', message: 'No date', date: '' },
          ...Array.from({ length: 8 }, (_, i) => ({ sha: `s${i}`, message: `m${i}`, date: at(i) })),
        ],
      },
    ];
    const rows = pipelineRows(many);
    expect(rows).toHaveLength(PIPELINE_ROWS);
    expect(rows.map((r) => r.sha)).not.toContain('nodate0');
    expect(pipelineRows(many, 20).at(-1)).toMatchObject({ sha: 'nodate0', at: null });
  });

  it('has no rows for anything but the list', () => {
    for (const body of [null, { configured: false }, {}, [null, { repo: 'x' }]])
      expect(pipelineRows(body)).toEqual([]);
  });
});

describe('usePipeline', () => {
  it('is not known before the first answer, and not set up on { configured: false }', async () => {
    let answer;
    getGiteaActivity.mockReturnValue(new Promise((r) => (answer = r)));
    const { result } = renderHook(() => usePipeline(), { wrapper });
    expect(result.current.configured).toBeNull();
    await act(async () => answer({ configured: false }));
    expect(result.current).toMatchObject({ configured: false, rows: [], failed: null });
  });

  it('is set up on a list, even an empty one, and on a 502 (a Gitea that is set up and failing)', async () => {
    const { result } = renderHook(() => usePipeline(), { wrapper });
    await waitFor(() => expect(result.current.configured).toBe(true));
    expect(result.current.rows).toEqual([]);

    getGiteaActivity.mockRejectedValue(new Error('HTTP 502'));
    const failing = renderHook(() => usePipeline(), { wrapper });
    await waitFor(() => expect(failing.result.current.failed).toBe('HTTP 502'));
    expect(failing.result.current.configured).toBe(true);
  });

  it('keeps the last rows through a failure, and polls every third refresh interval', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getGiteaActivity.mockResolvedValue([
      {
        repo: 'infra',
        commits: [{ sha: 'aaaaaaa', message: 'Pin', date: '2026-10-20T08:00:00Z' }],
      },
    ]);
    const { result } = renderHook(() => usePipeline(), { wrapper });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(getGiteaActivity).toHaveBeenCalledTimes(1);

    getGiteaActivity.mockRejectedValue(new Error('HTTP 500'));
    await act(() => vi.advanceTimersByTimeAsync(89_000));
    expect(getGiteaActivity).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(getGiteaActivity).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ configured: true, failed: 'HTTP 500' });
    expect(result.current.rows).toHaveLength(1);
  });

  it('asks nothing while not active', async () => {
    renderHook(() => usePipeline({ active: false }), { wrapper });
    await act(async () => {});
    expect(getGiteaActivity).not.toHaveBeenCalled();
  });
});

describe('useTodos', () => {
  const renderTodos = () => renderHook(() => useTodos(), { wrapper });

  it('is null until the first read lands, then the list with its due days as words', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 20, 12));
    getTodos.mockResolvedValue([
      { id: 'a', text: 'Past', done: false, due: '2026-10-19' },
      { id: 'b', text: 'Today', done: false, due: '2026-10-20' },
      { id: 'c', text: 'Done and past', done: true, due: '2026-10-01' },
    ]);
    const { result } = renderTodos();
    expect(result.current.todos).toBeNull();
    await waitFor(() => expect(result.current.todos).toHaveLength(3));
    expect(result.current.todos.map((t) => [t.dueLabel, t.overdue])).toEqual([
      ['Oct 19', true],
      ['Oct 20', false],
      ['Oct 1', false],
    ]);
  });

  describe('on a plain-HTTP origin (no crypto.randomUUID, #236)', () => {
    beforeEach(() => {
      const real = globalThis.crypto;
      vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
    });

    it('adds, ticks and deletes, saving the whole list each time', async () => {
      expect(globalThis.crypto.randomUUID).toBeUndefined();
      getTodos.mockResolvedValue([{ id: 'x', text: 'Kept', done: false, due: null }]);
      const { result } = renderTodos();
      await waitFor(() => expect(result.current.todos).toHaveLength(1));

      act(() => result.current.add({ text: 'Renew the cert', due: '2026-10-21' }));
      let saved = saveTodos.mock.calls.at(-1)[0];
      expect(saved.map((t) => t.text)).toEqual(['Kept', 'Renew the cert']);
      expect(saved[1]).toMatchObject({ done: false, due: '2026-10-21' });
      expect(saved[1].id).toMatch(UUID_V4);

      const id = saved[1].id;
      act(() => result.current.toggle(id));
      saved = saveTodos.mock.calls.at(-1)[0];
      expect(saved.find((t) => t.id === id).done).toBe(true);

      act(() => result.current.remove('x'));
      saved = saveTodos.mock.calls.at(-1)[0];
      expect(saved.map((t) => t.id)).toEqual([id]);
      expect(result.current.todos.map((t) => t.text)).toEqual(['Renew the cert']);
      expect(saveTodos).toHaveBeenCalledTimes(3);
    });
  });

  it('two changes in one go both save: each builds on the last', async () => {
    const { result } = renderTodos();
    await waitFor(() => expect(result.current.todos).toEqual([]));
    act(() => {
      result.current.add({ text: 'one' });
      result.current.add({ text: 'two' });
    });
    expect(saveTodos.mock.calls.at(-1)[0].map((t) => t.text)).toEqual(['one', 'two']);
  });

  it('a failed save says so and shows what the server holds', async () => {
    const { result } = renderHook(() => useTodos(), { wrapper });
    await waitFor(() => expect(result.current.todos).toEqual([]));
    saveTodos.mockRejectedValue(new Error('HTTP 500'));
    act(() => result.current.add({ text: 'Never saved' }));
    expect(result.current.todos.map((t) => t.text)).toEqual(['Never saved']);
    expect(await screen.findByText("Couldn't save the checklist")).toBeInTheDocument();
    await waitFor(() => expect(result.current.todos).toEqual([]));
    expect(getTodos).toHaveBeenCalledTimes(2);
  });

  it('a failed read adds nothing (no save over a list that never came), and Retry reads again', async () => {
    getTodos.mockRejectedValue(new Error('HTTP 500'));
    const { result } = renderTodos();
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.todos).toBeNull();
    act(() => result.current.add({ text: 'Lost' }));
    expect(saveTodos).not.toHaveBeenCalled();

    getTodos.mockResolvedValue([{ id: 'a', text: 'Back', done: false }]);
    await act(() => result.current.retry());
    expect(result.current).toMatchObject({ failed: false });
    expect(result.current.todos.map((t) => t.text)).toEqual(['Back']);
  });
});

// The rendered panels, end to end through the hooks: the shell's ChecklistPanel.
describe('ChecklistPanel', () => {
  it('draws the list it read', async () => {
    getTodos.mockResolvedValue([{ id: 'a', text: 'Patch the NAS', done: false, due: null }]);
    render(<ChecklistPanel />, { wrapper });
    expect(await screen.findByRole('checkbox', { name: 'Patch the NAS' })).toBeInTheDocument();
    expect(screen.getByText('1 open')).toBeInTheDocument();
  });

  it('says the read failed, with Retry', async () => {
    getTodos.mockRejectedValue(new Error('HTTP 500'));
    render(<ChecklistPanel />, { wrapper });
    expect(await screen.findByText("Couldn't load the checklist")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
