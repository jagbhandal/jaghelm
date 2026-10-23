/*
 * ListFilters (#313): a list page's filters in one row that wraps, under the
 * section's heading (the Services and Infrastructure pages): the search (an
 * Input, filling the row, at least 192px), then a Select for each filter
 * (State, Node, Role, Tag), 176px each, and "Clear filters" (a ghost accent
 * Button) while any is set. Each control is named (`label`), the search by
 * its placeholder's words.
 *
 * It holds nothing: `search` is `{ value, onChange(text), label }`, each of
 * `filters` `{ id, label, value, items, onValueChange(value) }` (its items
 * `[{ value, label }]`, the first for "every one"), and `onClear` clears
 * them all (none, no button).
 */
import { X } from 'lucide-react';
import { Button } from './button.jsx';
import { Input } from './input.jsx';
import { Select } from './select.jsx';
import { cn } from './lib/utils.js';

function ListFilters({ search, filters = [], onClear, className, ...props }) {
  return (
    <div
      data-slot="list-filters"
      role="group"
      aria-label="Filters"
      className={cn('flex flex-wrap items-center gap-3', className)}
      {...props}
    >
      {search && (
        <Input
          type="search"
          aria-label={search.label}
          placeholder={search.label}
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
          className="w-auto min-w-48 flex-1"
        />
      )}
      {filters.map((f) => (
        <Select
          key={f.id}
          data-filter={f.id}
          aria-label={f.label}
          items={f.items}
          value={f.value}
          onValueChange={(value) => f.onValueChange(value)}
          className="w-44"
        />
      ))}
      {onClear && (
        <Button variant="ghost" tone="accent" onClick={onClear}>
          <X aria-hidden="true" />
          Clear filters
        </Button>
      )}
    </div>
  );
}

export { ListFilters };
