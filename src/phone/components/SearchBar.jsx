import React from 'react';
import { Input } from '@ui/input';

/**
 * Controlled search input. value/onChange(text). type=search for mobile UX.
 * The web look (#303) is the shared Input, 44px tall for a thumb.
 */
export default function SearchBar(props) {
  if (__ANDROID_LOOK__) return <AndroidSearchBar {...props} />;
  return <WebSearchBar {...props} />;
}

function AndroidSearchBar({ value, onChange, placeholder = 'Search' }) {
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

function WebSearchBar({ value, onChange, placeholder = 'Search' }) {
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
