import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BackHeader from './BackHeader.jsx';

describe('BackHeader', () => {
  it('renders a title and fires onBack', () => {
    const onBack = vi.fn();
    render(<BackHeader title="Gitea" onBack={onBack} />);
    expect(screen.getByText('Gitea')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(onBack).toHaveBeenCalled();
  });
});
