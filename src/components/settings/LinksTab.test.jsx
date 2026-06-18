import { render, screen, fireEvent } from '@testing-library/react';
import { useState, useRef } from 'react';
import { describe, it, expect } from 'vitest';
import LinksTab from './LinksTab';
import { ConfigProvider } from '../../context/ConfigContext.jsx';

// LinksTab does link CRUD. It now reads `config`, `update`, and `setConfig` from
// ConfigContext. The `update(path, value)` deep-setter is computed by the
// provider from the (captured) setConfig using setIn — structural-sharing
// immutability. These tests lock in that add/edit produce the right config AND
// don't mutate the previous config object — the immutability setIn preserves.

// Controlled wrapper that captures every {prev,next} config commit so tests can
// assert immutability of the prior object. The captured setConfig is handed to
// ConfigProvider, which derives the `update` deep-setter LinksTab consumes — so
// both the `update` path and the direct `setConfig` path flow through here.
function Harness({ initialConfig, onCommit }) {
  const [config, setConfigState] = useState(initialConfig);
  const refs = useRef([]);
  const setConfig = (updater) => {
    setConfigState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      refs.current.push({ prev, next });
      onCommit?.(refs.current);
      return next;
    });
  };
  return (
    <ConfigProvider config={config} setConfig={setConfig}>
      <LinksTab />
    </ConfigProvider>
  );
}

const makeConfig = (links) => ({
  title: 'JAGHELM',
  links: links ?? {
    personal: [{ name: 'Email', icon: '📧', url: 'https://mail.example.com' }],
  },
});

describe('LinksTab CRUD', () => {
  it('renders existing groups and their links', () => {
    render(<Harness initialConfig={makeConfig()} />);
    expect(screen.getByText('personal')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('1 link')).toBeInTheDocument();
  });

  it('adds a link to a group immutably', () => {
    let captured = [];
    render(<Harness initialConfig={makeConfig()} onCommit={(r) => (captured = r)} />);

    fireEvent.click(screen.getByRole('button', { name: '+ Add Link' }));
    fireEvent.change(screen.getByPlaceholderText('Name'), {
      target: { value: 'Grafana' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://...'), {
      target: { value: 'grafana.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    // The new link is rendered.
    expect(screen.getByText('Grafana')).toBeInTheDocument();

    const { prev, next } = captured[captured.length - 1];
    // New group array has both links; url got the https:// prefix.
    expect(next.links.personal).toHaveLength(2);
    expect(next.links.personal[1]).toMatchObject({
      name: 'Grafana',
      url: 'https://grafana.example.com',
    });
    // The previous config's group array was NOT mutated.
    expect(prev.links.personal).toHaveLength(1);
    expect(prev.links.personal).not.toBe(next.links.personal);
  });

  it('edits an existing link immutably', () => {
    let captured = [];
    render(<Harness initialConfig={makeConfig()} onCommit={(r) => (captured = r)} />);

    // Click the link row to enter edit mode.
    fireEvent.click(screen.getByText('Email'));
    const nameInput = screen.getByPlaceholderText('Name');
    fireEvent.change(nameInput, { target: { value: 'Webmail' } });

    const { prev, next } = captured[captured.length - 1];
    expect(next.links.personal[0].name).toBe('Webmail');
    // Prior object untouched (the JSON.parse clone guarantees this today).
    expect(prev.links.personal[0].name).toBe('Email');
    expect(prev.links.personal[0]).not.toBe(next.links.personal[0]);
  });

  it('deletes a link immutably', () => {
    let captured = [];
    render(
      <Harness
        initialConfig={makeConfig({
          personal: [
            { name: 'Email', icon: '📧', url: 'https://a.example.com' },
            { name: 'Docs', icon: '📄', url: 'https://b.example.com' },
          ],
        })}
        onCommit={(r) => (captured = r)}
      />
    );

    // Enter edit mode on the first link, then delete it.
    fireEvent.click(screen.getByText('Email'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const { prev, next } = captured[captured.length - 1];
    expect(next.links.personal).toHaveLength(1);
    expect(next.links.personal[0].name).toBe('Docs');
    // Prior array still has both entries.
    expect(prev.links.personal).toHaveLength(2);
  });

  it('adds a new link group via setConfig immutably', () => {
    let captured = [];
    render(<Harness initialConfig={makeConfig()} onCommit={(r) => (captured = r)} />);

    fireEvent.click(screen.getByRole('button', { name: '+ Add Link Group' }));
    fireEvent.change(screen.getByPlaceholderText(/group name/i), {
      target: { value: 'Media' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    const { prev, next } = captured[captured.length - 1];
    // Key is slugified to lowercase.
    expect(next.links).toHaveProperty('media');
    expect(next.links.media).toEqual([]);
    // The previous links object did not gain the key.
    expect(prev.links).not.toHaveProperty('media');
  });
});
