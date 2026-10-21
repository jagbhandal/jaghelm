import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AppShell, ShellApps, ShellPage, ShellSection } from '@ui/app-shell';

// The frame (#296): the chrome is the new UI, each piece its own `.jh-ui`
// root with the screen's switches; the page area is not one, so today's views
// inside it keep their look; a page of the new UI brings its own root.

function Shell({ children }) {
  return (
    <AppShell
      switches={{ theme: 'light' }}
      header={<header>head</header>}
      sidebar={<nav aria-label="Main">side</nav>}
      tabs={<nav aria-label="Tabs">tabs</nav>}
    >
      {children}
    </AppShell>
  );
}

const root = (el) => el.closest('.jh-ui');

describe('AppShell', () => {
  it('draws the header, the sidebar and the tabs each in its own root, with the switches', () => {
    render(<Shell />);
    for (const el of [
      screen.getByRole('banner'),
      screen.getByRole('navigation', { name: 'Main' }),
      screen.getByRole('navigation', { name: 'Tabs' }),
    ]) {
      expect(root(el)).not.toBeNull();
      expect(root(el)).toHaveAttribute('data-theme', 'light');
    }
    // The sidebar from 768px; the tabs below it.
    expect(root(screen.getByRole('navigation', { name: 'Main' }))).toHaveClass('hidden', 'md:block');
    expect(root(screen.getByRole('navigation', { name: 'Tabs' }))).toHaveClass('md:hidden');
  });

  it("puts the page in <main>, outside every root, so today's views keep their look", () => {
    render(
      <Shell>
        <p>an old view</p>
      </Shell>
    );
    const main = screen.getByRole('main');
    expect(main).toContainElement(screen.getByText('an old view'));
    expect(root(main)).toBeNull();
    expect(main.closest('[data-slot="app-shell"]')).not.toHaveClass('jh-ui');
  });

  it('a ShellPage is its own root, with the shell’s switches, its title the h1', () => {
    render(
      <Shell>
        <ShellPage title="Alerts" description="What needs attention">
          <p>rows</p>
        </ShellPage>
      </Shell>
    );
    const heading = screen.getByRole('heading', { level: 1, name: 'Alerts' });
    expect(root(heading)).toHaveAttribute('data-theme', 'light');
    expect(root(heading)).toHaveAttribute('data-slot', 'shell-page');
    expect(screen.getByText('What needs attention')).toBeInTheDocument();
  });

  it('a ShellSection is its own root, with the shell’s switches, its children stacked', () => {
    render(
      <Shell>
        <p>an old view</p>
        <ShellSection data-testid="section">
          <p>status</p>
        </ShellSection>
      </Shell>
    );
    const section = screen.getByTestId('section');
    expect(root(screen.getByText('status'))).toBe(section);
    expect(section).toHaveAttribute('data-theme', 'light');
    expect(section).toHaveAttribute('data-slot', 'shell-section');
    expect(section).toHaveClass('flex', 'flex-col', 'gap-6');
    // Today's page shows between its children, not the root's own background.
    expect(section).toHaveClass('bg-transparent');
    // Beside today's view, which stays outside every root.
    expect(root(screen.getByText('an old view'))).toBeNull();
  });

  it('ShellApps is a region named by the open app, and nothing when none is', () => {
    const { rerender } = render(<ShellApps label="Grafana, open inside JagHelm" />);
    expect(screen.getByRole('region', { name: 'Grafana, open inside JagHelm' })).toBeInTheDocument();
    rerender(<ShellApps />);
    expect(screen.queryByRole('region')).toBeNull();
  });
});
