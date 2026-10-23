import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Palette, Server } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { UiRoot } from './root.jsx';
import { SettingsIndex, SettingsNav, SettingsSectionPage } from './settings.jsx';

const SECTIONS = [
  {
    id: 'nodes',
    label: 'Nodes & Services',
    description: 'Node names and roles.',
    icon: <Server />,
    href: '/settings/nodes',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Theme, font.',
    icon: <Palette />,
    href: '/settings/appearance',
    hits: ['Font Family', 'Logo'],
  },
];

describe('SettingsIndex', () => {
  it('draws a card per section: a link named by it, described by its line and its matches', () => {
    render(<SettingsIndex sections={SECTIONS} />);
    const nodes = screen.getByRole('link', { name: 'Nodes & Services' });
    expect(nodes).toHaveAttribute('href', '/settings/nodes');
    expect(nodes).toHaveAccessibleDescription('Node names and roles.');
    expect(nodes.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    const appearance = screen.getByRole('link', { name: 'Appearance' });
    expect(appearance).toHaveAccessibleDescription('Theme, font. Matches: Font Family, Logo');
  });

  it('is a search: the words go to onQueryChange; none found is a status', async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    const { rerender } = render(
      <SettingsIndex sections={SECTIONS} onQueryChange={onQueryChange} />
    );
    expect(screen.getByRole('search', { name: 'Settings' })).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'f');
    expect(onQueryChange).toHaveBeenLastCalledWith('f');
    rerender(<SettingsIndex query=" zzz " sections={[]} onQueryChange={onQueryChange} />);
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('No setting matches “zzz”.');
  });

  it('a card calls onNavigate with its address', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn((e) => e.preventDefault());
    render(<SettingsIndex sections={SECTIONS} onNavigate={onNavigate} />);
    await user.click(screen.getByRole('link', { name: 'Appearance' }));
    expect(onNavigate).toHaveBeenCalledWith(expect.anything(), '/settings/appearance');
  });
});

describe('SettingsSectionPage and SettingsNav', () => {
  it('heads the page with a breadcrumb back to the index, its name as the h1 and its line', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn((e) => e.preventDefault());
    render(
      <SettingsSectionPage
        title="Appearance"
        description="Theme, font."
        onNavigate={onNavigate}
        nav={<SettingsNav sections={SECTIONS} current="appearance" onNavigate={onNavigate} />}
      >
        <p>The section</p>
      </SettingsSectionPage>
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Appearance');
    expect(screen.getByText('Theme, font.')).toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    await user.click(within(crumbs).getByRole('link', { name: 'Settings' }));
    expect(onNavigate).toHaveBeenLastCalledWith(expect.anything(), '/settings');
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('link', { name: 'Appearance' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(within(nav).getByRole('link', { name: 'Nodes & Services' })).not.toHaveAttribute(
      'aria-current'
    );
    await user.click(within(nav).getByRole('link', { name: 'Nodes & Services' }));
    expect(onNavigate).toHaveBeenLastCalledWith(expect.anything(), '/settings/nodes');
    // The section's own content is outside the page's roots: today's markup.
    expect(screen.getByText('The section').closest('.jh-ui')).toBeNull();
  });

  it('inside a UiRoot (the gallery), its head and list take that root’s switches', () => {
    render(
      <UiRoot theme="light" density="compact">
        <SettingsSectionPage title="System" nav={<SettingsNav sections={SECTIONS} />}>
          <p>The section</p>
        </SettingsSectionPage>
      </UiRoot>
    );
    const head = screen.getByRole('heading', { level: 1 }).closest('.jh-ui');
    expect(head).toHaveAttribute('data-theme', 'light');
    expect(head).toHaveAttribute('data-density', 'compact');
    const nav = screen.getByRole('navigation', { name: 'Settings sections' }).closest('.jh-ui');
    expect(nav).toHaveAttribute('data-theme', 'light');
  });
});
