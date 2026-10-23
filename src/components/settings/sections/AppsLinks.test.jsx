import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import AppsLinks from './AppsLinks.jsx';
import { ConfigProvider } from '../../../context/ConfigContext.jsx';
import { OverlayProvider } from '../../../context/OverlayContext.jsx';

// Settings → Apps & links (#317): what was Tabs and Links, where links open
// (Layout's) and the Launch page's web search (Widgets'), as they were.
function Harness({ initial }) {
  const [config, setConfig] = useState(initial);
  window.__config = config;
  return (
    <OverlayProvider>
      <ConfigProvider config={config} setConfig={setConfig}>
        <AppsLinks />
      </ConfigProvider>
    </OverlayProvider>
  );
}

const CONFIG = {
  tabs: [{ id: 'grafana', label: 'Grafana', type: 'iframe', url: 'https://grafana.example' }],
  links: { tools: [{ name: 'Gitea', icon: '🔗', url: 'https://git.example' }] },
};

describe('Settings → Apps & links', () => {
  it('has the embedded apps and the Quick Launch links, each a part of the page', () => {
    render(<Harness initial={CONFIG} />);
    const apps = screen.getByRole('region', { name: 'Embedded apps' });
    expect(apps).toHaveTextContent('Grafana');
    expect(screen.getByRole('button', { name: '+ Add Tab' })).toBeInTheDocument();
    const links = screen.getByRole('region', { name: 'Quick Launch links' });
    expect(links).toHaveTextContent('Gitea');
    expect(screen.getByRole('button', { name: '+ Add Link Group' })).toBeInTheDocument();
  });

  it('says where links open, New Tab by default', async () => {
    const user = userEvent.setup();
    render(<Harness initial={CONFIG} />);
    expect(screen.getByRole('button', { name: 'New Tab' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Same Tab' }));
    expect(window.__config.linkTarget).toBe('_self');
  });

  // #307: the web search is on the Launch page, so its switch says so.
  it('has the Launch page’s web search: its switch, on by default, and its engine', async () => {
    const user = userEvent.setup();
    render(<Harness initial={CONFIG} />);
    expect(
      screen.getByRole('checkbox', { name: 'Show the web search on the Launch page' })
    ).toBeChecked();
    await user.selectOptions(screen.getByLabelText('Search Engine'), 'duckduckgo');
    expect(window.__config.searchEngine).toBe('duckduckgo');
  });
});
