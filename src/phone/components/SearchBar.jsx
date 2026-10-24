import React from 'react';
import { Input } from '@ui/input';

/**
 * Controlled search input. value/onChange(text). type=search for mobile UX.
 * It is the shared Input (#303), 44px tall for a thumb.
 */
export default function SearchBar({ value, onChange, placeholder = 'Search' }) {
  return (
    <Input
      type="search"
      inputMode="search"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      aria-label={placeholder}
      className="h-11 text-body"
    />
  );
}
