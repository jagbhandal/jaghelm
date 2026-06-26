import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SearchBar from './SearchBar.jsx';

describe('SearchBar', () => {
  it('is controlled and reports typed text', () => {
    const onChange = vi.fn();
    render(<SearchBar value="" onChange={onChange} placeholder="Search services" />);
    const input = screen.getByPlaceholderText('Search services');
    fireEvent.change(input, { target: { value: 'git' } });
    expect(onChange).toHaveBeenCalledWith('git');
  });
});
