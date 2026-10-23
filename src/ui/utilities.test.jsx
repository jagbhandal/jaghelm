import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import {
  Checklist,
  LaunchLayout,
  Pipeline,
  QuickLaunch,
  UtilitiesRail,
  WeatherClock,
  WebSearch,
  shortAgo,
} from '@ui/utilities';

const GROUPS = [
  {
    key: 'daily',
    title: 'Daily',
    links: [
      { id: 'a', name: 'Nextcloud', href: 'https://cloud.example/', monogram: 'Ne' },
      { id: 'b', name: 'Home Assistant', href: 'https://ha.example/', monogram: 'HA' },
    ],
  },
  {
    key: 'admin',
    title: 'Admin',
    links: [{ id: 'c', name: 'Proxmox', href: 'https://pve.example/', monogram: 'Pr' }],
  },
];

const NOW = Date.parse('2026-10-20T09:00:00Z');
const ROWS = [
  {
    id: '1',
    title: 'Pin the proxy image',
    repo: 'infrastructure',
    sha: 'a41c9e2',
    at: NOW - 12 * 60_000,
  },
  {
    id: '2',
    title: 'Group the media services',
    repo: 'dashboard',
    sha: '5e2b7d9',
    at: NOW - 3 * 3_600_000,
  },
];

const TODOS = [
  {
    id: 't1',
    text: 'Rotate the B2 key',
    done: false,
    due: '2026-10-19',
    dueLabel: 'Oct 19',
    overdue: true,
  },
  {
    id: 't2',
    text: 'Replace the UPS battery',
    done: false,
    due: null,
    dueLabel: null,
    overdue: false,
  },
  {
    id: 't3',
    text: 'Review the digest',
    done: true,
    due: '2026-10-01',
    dueLabel: 'Oct 1',
    overdue: false,
  },
];

describe('shortAgo', () => {
  it('says an age as the mock does: now, minutes, hours, days', () => {
    expect(shortAgo(0)).toBe('now');
    expect(shortAgo(59_000)).toBe('now');
    expect(shortAgo(-5_000)).toBe('now');
    expect(shortAgo(12 * 60_000)).toBe('12 m');
    expect(shortAgo(3 * 3_600_000 + 59 * 60_000)).toBe('3 h');
    expect(shortAgo(4 * 86_400_000)).toBe('4 d');
  });
});

describe('QuickLaunch', () => {
  it('is a panel named Quick Launch, every group a list named by its overline', () => {
    render(<QuickLaunch groups={GROUPS} hint="in Ctrl K too" />);
    const panel = screen.getByRole('region', { name: 'Quick Launch' });
    expect(panel).toHaveAttribute('data-slot', 'quick-launch');
    expect(within(panel).getByText('in Ctrl K too')).toHaveClass('font-mono', 'text-caption');
    const daily = within(panel).getByRole('list', { name: 'Daily' });
    expect(
      within(daily)
        .getAllByRole('link')
        .map((l) => l.textContent)
    ).toEqual(['NeNextcloud', 'HAHome Assistant']);
    expect(within(panel).getByRole('list', { name: 'Admin' })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { level: 3, name: 'Daily' })).toHaveClass(
      'text-overline',
      'uppercase'
    );
  });

  it('opens each link in the target given, without an opener, named by its name alone', () => {
    render(<QuickLaunch groups={GROUPS} target="_self" />);
    const link = screen.getByRole('link', { name: 'Nextcloud' });
    expect(link).toHaveAttribute('href', 'https://cloud.example/');
    expect(link).toHaveAttribute('target', '_self');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // The monogram is the sidebar's chip, hidden from assistive tech.
    expect(link.querySelector('[data-slot="app-chip"]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows `empty` with no group, and no hint', () => {
    render(<QuickLaunch groups={[]} hint="in Ctrl K too" empty={<p>No links yet</p>} />);
    expect(screen.getByRole('region', { name: 'Quick Launch' })).toHaveTextContent('No links yet');
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText('in Ctrl K too')).toBeNull();
  });
});

describe('Pipeline', () => {
  it('lists each commit: its message, "repo · sha" and its age', () => {
    render(<Pipeline items={ROWS} now={NOW} />);
    const panel = screen.getByRole('region', { name: 'Pipeline' });
    const rows = within(panel).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Pin the proxy image');
    expect(rows[0]).toHaveTextContent('infrastructure · a41c9e2');
    expect(within(rows[0]).getByText('a41c9e2')).toHaveClass('font-mono');
    const age = rows[0].querySelector('time');
    expect(age).toHaveTextContent('12 m ago');
    expect(age).toHaveAttribute('dateTime', new Date(NOW - 12 * 60_000).toISOString());
    expect(rows[1].querySelector('time')).toHaveTextContent('3 h ago');
  });

  it('says "No recent commits" with none, and with a banner shows only the banner', () => {
    const { rerender } = render(<Pipeline items={[]} />);
    expect(screen.getByText('No recent commits')).toBeInTheDocument();
    rerender(<Pipeline items={[]} banner={<p>Gitea is down</p>} />);
    expect(screen.getByText('Gitea is down')).toBeInTheDocument();
    expect(screen.queryByText('No recent commits')).toBeNull();
  });

  it('keeps the last rows under a banner', () => {
    render(<Pipeline items={ROWS} banner={<p>Gitea is down</p>} now={NOW} />);
    expect(screen.getByText('Gitea is down')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  const CI_ROWS = [
    {
      id: 'f',
      title: 'Log every request',
      repo: 'app',
      ref: 'fix/access-log-245',
      sha: 'f00dfee',
      state: 'crit',
      word: 'Failed',
      at: NOW - 12 * 60_000,
    },
    {
      id: 'r',
      title: 'Raise the job timeout',
      repo: 'app',
      ref: 'main',
      sha: '3f7e2a0',
      state: 'unknown',
      word: 'Running',
      at: NOW - 60_000,
    },
    { id: 'n', title: 'No CI here', repo: 'scripts', ref: 'main', sha: 'e7a3310', at: NOW },
  ];

  it('a failed run: a red lamp with its bar, named "Failed", over "repo · branch · sha" (#532)', () => {
    render(<Pipeline items={CI_ROWS} now={NOW} />);
    const [failed] = screen.getAllByRole('listitem');
    const lamp = within(failed).getByRole('img', { name: 'Failed' });
    expect(lamp).toHaveAttribute('data-state', 'crit');
    expect(lamp).toHaveAttribute('data-shape', 'bar');
    expect(lamp).toHaveClass('text-crit-solid');
    expect(failed).toHaveTextContent('app · fix/access-log-245 · f00dfee');
    expect(within(failed).getByText('f00dfee')).toHaveClass('font-mono');
  });

  it('a running run is the no-signal ring named "Running", never green or red (#532)', () => {
    render(<Pipeline items={CI_ROWS} now={NOW} />);
    const lamp = within(screen.getAllByRole('listitem')[1]).getByRole('img', { name: 'Running' });
    expect(lamp).toHaveAttribute('data-shape', 'ring');
    expect(lamp).not.toHaveClass('text-ok-solid', 'text-crit-solid');
  });

  it('a row without CI has no lamp, its title in line with the others; with no CI at all, no lamp column (#532)', () => {
    const { rerender } = render(<Pipeline items={CI_ROWS} now={NOW} />);
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[2]).queryByRole('img')).toBeNull();
    expect(rows[2]).toHaveTextContent('scripts · main · e7a3310');
    expect(rows[2].children).toHaveLength(rows[0].children.length);
    rerender(<Pipeline items={ROWS} now={NOW} />);
    expect(screen.queryAllByRole('img')).toEqual([]);
    expect(screen.getAllByRole('listitem')[0].children).toHaveLength(rows[0].children.length - 1);
  });
});

describe('Checklist', () => {
  const handlers = () => ({ onAdd: vi.fn(), onToggle: vi.fn(), onRemove: vi.fn() });

  it('counts the open ones and lists each with its box, due day and Delete', () => {
    render(<Checklist todos={TODOS} {...handlers()} />);
    const panel = screen.getByRole('region', { name: 'Checklist' });
    expect(within(panel).getByText('2 open')).toBeInTheDocument();
    const list = within(panel).getByRole('list', { name: 'Tasks' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('checkbox', { name: 'Rotate the B2 key' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
    expect(screen.getByRole('checkbox', { name: 'Review the digest' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    // Overdue is said in words, not by colour alone.
    expect(screen.getByText('Oct 19 · overdue')).toHaveClass('text-warn-fg');
    expect(screen.getByText('Oct 1')).toHaveClass('text-text-3');
    expect(screen.getByText('Review the digest')).toHaveClass('line-through');
    expect(screen.getByRole('button', { name: 'Delete “Rotate the B2 key”' })).toBeInTheDocument();
  });

  it('adds a task with its due day, trimmed, and clears the field; an empty one adds nothing', async () => {
    const user = userEvent.setup();
    const h = handlers();
    render(<Checklist todos={[]} {...h} />);
    expect(screen.getByText('Nothing on the list')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(h.onAdd).not.toHaveBeenCalled();

    await user.type(screen.getByRole('textbox', { name: 'New task' }), '  Renew the cert  ');
    await user.type(screen.getByLabelText('Due day (optional)'), '2026-10-21');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(h.onAdd).toHaveBeenCalledWith({ text: 'Renew the cert', due: '2026-10-21' });
    expect(screen.getByRole('textbox', { name: 'New task' })).toHaveValue('');

    await user.type(screen.getByRole('textbox', { name: 'New task' }), 'Patch the NAS{Enter}');
    expect(h.onAdd).toHaveBeenLastCalledWith({ text: 'Patch the NAS', due: null });
  });

  it('lays the add row out by its own width: one row from 24rem, else the task over the day and Add', () => {
    render(<Checklist todos={[]} {...handlers()} />);
    const form = screen.getByRole('textbox', { name: 'New task' }).closest('form');
    expect(form).toHaveClass('@container');
    const grid = form.firstElementChild;
    expect(grid).toHaveClass(
      'grid-cols-[minmax(0,1fr)_auto]',
      '@sm:grid-cols-[minmax(0,1fr)_9rem_auto]'
    );
    expect(screen.getByRole('textbox', { name: 'New task' })).toHaveClass(
      'col-span-2',
      '@sm:col-span-1'
    );
    // The day is the shared field, a date Input: empty, in text-3.
    expect(screen.getByLabelText('Due day (optional)')).toHaveAttribute('data-slot', 'input');
    expect(screen.getByLabelText('Due day (optional)')).toHaveAttribute('data-empty');
  });

  it('ticks and deletes by id', async () => {
    const user = userEvent.setup();
    const h = handlers();
    render(<Checklist todos={TODOS} {...h} />);
    await user.click(screen.getByRole('checkbox', { name: 'Rotate the B2 key' }));
    expect(h.onToggle).toHaveBeenCalledWith('t1');
    await user.click(screen.getByRole('button', { name: 'Delete “Replace the UPS battery”' }));
    expect(h.onRemove).toHaveBeenCalledWith('t2');
  });

  it('while loading (todos null) is busy, with no field to add to; a banner stands in when it failed', () => {
    const { rerender } = render(<Checklist todos={null} {...handlers()} />);
    const panel = screen.getByRole('region', { name: 'Checklist' });
    expect(panel).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(/open$/)).toBeNull();
    rerender(<Checklist todos={null} banner={<p>Couldn't load</p>} {...handlers()} />);
    expect(panel).not.toHaveAttribute('aria-busy');
    expect(screen.getByText("Couldn't load")).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('UtilitiesRail and LaunchLayout', () => {
  it('the rail is a region named Utilities, its panels stacked 16px apart', () => {
    render(
      <UtilitiesRail>
        <QuickLaunch groups={GROUPS} />
      </UtilitiesRail>
    );
    const rail = screen.getByRole('region', { name: 'Utilities' });
    expect(rail).toHaveClass('flex-col', 'gap-4');
    // Not an <aside>: inside the page's <main> a complementary landmark would
    // be nested in another (axe's landmark-complementary-is-top-level).
    expect(rail.tagName).toBe('SECTION');
  });

  it('lays Quick Launch across the top, the others two to a row from 672px', () => {
    render(
      <LaunchLayout
        quickLaunch={<QuickLaunch groups={GROUPS} />}
        pipeline={<Pipeline items={ROWS} now={NOW} />}
        checklist={<Checklist todos={[]} onAdd={vi.fn()} onToggle={vi.fn()} onRemove={vi.fn()} />}
      />
    );
    const layout = document.querySelector('[data-slot="launch-layout"]');
    expect(layout).toHaveClass('@container');
    const grid = layout.firstElementChild;
    expect(grid).toHaveClass('grid-cols-1', '@2xl:grid-cols-2');
    expect(grid.firstElementChild).toHaveClass('@2xl:col-span-2');
    expect(
      [...grid.querySelectorAll('[data-slot]')]
        .map((el) => el.dataset.slot)
        .filter((s) => ['quick-launch', 'pipeline', 'checklist'].includes(s))
    ).toEqual(['quick-launch', 'pipeline', 'checklist']);
  });
});

// #307: weather and the clock in the rail and on the Launch page, and the web
// search on the Launch page.
describe('WeatherClock', () => {
  const WEATHER = { temperature: '48°F', condition: 'Overcast', code: 3, place: 'Toronto' };
  const TIME = new Date(NOW).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const DAY = new Date(NOW).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  it('is a panel named Weather and time: the reading and its place, then the time and day', () => {
    render(<WeatherClock weather={WEATHER} now={NOW} />);
    const panel = screen.getByRole('region', { name: 'Weather and time' });
    expect(panel).toHaveAttribute('data-slot', 'weather-clock');
    const weather = panel.querySelector('[data-slot="weather"]');
    expect(weather).toHaveTextContent('48°F · Overcast');
    expect(within(weather).getByText('Toronto')).toHaveClass('text-text-3');
    // The condition's icon is drawn for it, and hidden: the words say it.
    expect(weather.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    const time = within(panel).getByText(TIME);
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('dateTime', new Date(NOW).toISOString());
    expect(within(panel).getByText(DAY)).toHaveClass('text-text-3');
    // Weather first, the clock at the row's end, as the mock has it.
    expect(panel.querySelector('[data-slot="clock"]')).toHaveClass('ml-auto');
  });

  it('draws only what it is given, named by it, and nothing with neither', () => {
    const { rerender, container } = render(<WeatherClock now={NOW} />);
    expect(screen.getByRole('region', { name: 'Time' })).toHaveTextContent(TIME);
    expect(document.querySelector('[data-slot="weather"]')).toBeNull();
    rerender(<WeatherClock weather={WEATHER} />);
    expect(screen.getByRole('region', { name: 'Weather' })).toHaveTextContent('48°F');
    expect(document.querySelector('[data-slot="clock"]')).toBeNull();
    rerender(<WeatherClock />);
    expect(container).toBeEmptyDOMElement();
  });

  it('leaves the condition out when the code has no words, with a thermometer for its icon', () => {
    render(<WeatherClock weather={{ temperature: '-3°C', condition: null, code: 42 }} />);
    const weather = document.querySelector('[data-slot="weather"]');
    expect(weather).toHaveTextContent(/^-3°C$/);
    expect(weather.querySelector('svg')).toHaveClass('lucide-thermometer');
  });

  it('while the first reading is on its way, a placeholder; when it failed, says so', () => {
    const { rerender } = render(<WeatherClock weather={{ loading: true, place: 'Toronto' }} />);
    const panel = screen.getByRole('region', { name: 'Weather' });
    expect(panel).toHaveAttribute('aria-busy', 'true');
    expect(within(panel).getByText('Loading the weather')).toHaveClass('sr-only');
    rerender(<WeatherClock weather={{ failed: true, place: 'Toronto' }} />);
    expect(panel).not.toHaveAttribute('aria-busy');
    expect(panel).toHaveTextContent('No weather reading');
    expect(panel).toHaveTextContent('Toronto');
  });
});

describe('WebSearch', () => {
  it('is a search landmark with a field named for its engine and a Search button', () => {
    render(<WebSearch engine="DuckDuckGo" onSearch={vi.fn()} />);
    const form = screen.getByRole('search', { name: 'Web search' });
    expect(form).toHaveAttribute('data-slot', 'web-search');
    const field = within(form).getByRole('searchbox', { name: 'Search the web with DuckDuckGo' });
    expect(field).toHaveAttribute('placeholder', 'Search DuckDuckGo');
    expect(field).toHaveAttribute('data-slot', 'input');
    expect(within(form).getByRole('button', { name: 'Search' })).toHaveAttribute('type', 'submit');
  });

  it('hands over the words, trimmed, and clears the field; empty words search nothing', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<WebSearch engine="Google" onSearch={onSearch} />);
    const field = screen.getByRole('searchbox');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.type(field, '   {Enter}');
    expect(onSearch).not.toHaveBeenCalled();
    await user.clear(field);
    await user.type(field, '  zfs scrub schedule {Enter}');
    expect(onSearch).toHaveBeenCalledExactlyOnceWith('zfs scrub schedule');
    expect(field).toHaveValue('');
  });
});

describe('LaunchLayout with the extras (#307)', () => {
  it('puts weather and the clock, then the search, across the top, before Quick Launch', () => {
    render(
      <LaunchLayout
        extras={<WeatherClock now={NOW} />}
        search={<WebSearch engine="Google" onSearch={vi.fn()} />}
        quickLaunch={<QuickLaunch groups={GROUPS} />}
      />
    );
    const top = document.querySelector('[data-slot="launch-top"]');
    expect(top).toHaveClass('@2xl:col-span-2', 'flex-wrap');
    expect(
      [...document.querySelectorAll('[data-slot]')]
        .map((el) => el.dataset.slot)
        .filter((s) => ['weather-clock', 'web-search', 'quick-launch'].includes(s))
    ).toEqual(['weather-clock', 'web-search', 'quick-launch']);
  });

  it('draws no top row without either', () => {
    render(<LaunchLayout quickLaunch={<QuickLaunch groups={GROUPS} />} />);
    expect(document.querySelector('[data-slot="launch-top"]')).toBeNull();
  });
});
