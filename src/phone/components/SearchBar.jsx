import React from 'react';

/** Controlled search input. value/onChange(text). type=search for mobile UX. */
export default function SearchBar({ value, onChange, placeholder = 'Search' }) {
  return (
    <input
      className="search-bar"
      type="search"
      inputMode="search"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      aria-label={placeholder}
    />
  );
}
